"use strict";
/*
 * Fase 3 · promoción y respaldos.
 *
 *   - promover una caja sobre su BD VIVA conserva las ventas de su cola:
 *     se registran en el nuevo Host (o quedan en conflicto, nunca se pierden)
 *     y las que ya estaban en el respaldo no se duplican;
 *   - la época del Host cambia al promover/restaurar y una caja con la época
 *     vieja recibe `resync` en /changes y en el flujo SSE;
 *   - /api/health expone host_device_id / host_epoch / app_version;
 *   - el respaldo recibido se valida con el SHA-256 del Host;
 *   - las copias de cierre tienen retención.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3-promotion.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const backupService = require(path.join(REPO, "src/main/backup-service.js"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const offlineQueue = require(path.join(REPO, "src/main/offline-queue.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3-promo-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3523;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const check = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? " :: " + extra : ""));
  }
};

const BOX = "box-caja-1";

(async () => {
  console.log("=== 3.2 · promoción sobre la BD viva de la caja ===");
  // Host original → respaldo (ya trae la venta A-000001).
  const oldHost = fixture.createFileDb(path.join(TMP, "old-host.db"));
  activation.setSetting(oldHost, "host_device_id", "host-negocio");
  oldHost.prepare("INSERT INTO cashiers (id, name, pin, role, is_active) VALUES (7, 'Ana', '', 'cashier', 1)").run();
  oldHost.prepare("INSERT INTO customers (id, name) VALUES (5, 'Cliente')").run();
  oldHost.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1, '7501', 'Refresco', 10, 100, 'piece')").run();
  oldHost
    .prepare(
      `INSERT INTO paired_devices (device_id, device_name, paired_token_hash, device_code, device_type, scopes, approved)
       VALUES (?, 'Caja 1', 'h', 'A', 'desktop_box', '[]', 1)`,
    )
    .run(BOX);
  oldHost.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (3, date('now'), 'open', 7, ?)").run(BOX);
  oldHost
    .prepare("INSERT INTO sales (total, payment_method, register_id, cashier_name, device_id, folio) VALUES (10, 'cash', 3, 'Ana', ?, 'A-000001')")
    .run(BOX);
  const BACKUP = path.join(TMP, "pos-auto-1.db");
  await oldHost.backup(BACKUP);
  oldHost.close();

  // La caja (BD viva) tiene 3 ventas en cola: una que ya llegó al Host antes
  // del respaldo, una normal con cliente y una que no se puede registrar.
  const box = fixture.createFileDb(path.join(TMP, "box.db"));
  const row = (n, extra = {}) => ({
    folio: `A-${String(n).padStart(6, "0")}`,
    idempotencyKey: `k-${n}`,
    payload: { cart: [{ id: 1, quantity: 1, price: 10, finalPrice: 10 }], total: 10, paymentMethod: "cash", customerId: 5 },
    registerId: 3,
    cashierId: 7,
    cashierName: "Ana",
    ...extra,
  });
  offlineQueue.enqueue(box, row(1));
  offlineQueue.enqueue(box, row(2));
  offlineQueue.enqueue(box, row(3, { payload: { cart: [], total: 0, paymentMethod: "cash" } }));
  check(offlineQueue.countBlocking(box) === 3, "la caja tiene 3 ventas sin subir");

  // Misma secuencia que promote-to-host.
  const unsynced = offlineQueue.unsyncedRows(box);
  backupService.restoreIntoLiveDb(box, BACKUP);
  dbSchema.runMigrations(box);
  activation.ensureSchema(box);
  const res = offlineQueue.absorbIntoHost(box, unsynced, BOX);
  check(res.absorbed === 2 && res.kept === 1, "2 absorbidas (1 ya existía) + 1 en conflicto", JSON.stringify(res));
  const sales = box.prepare("SELECT folio, customer_id, register_id, cashier_name FROM sales ORDER BY folio").all();
  check(sales.length === 2 && sales[0].folio === "A-000001" && sales[1].folio === "A-000002",
    "no se duplicó A-000001 y A-000002 quedó registrada", JSON.stringify(sales));
  check(sales[1].customer_id === 5 && sales[1].register_id === 3 && sales[1].cashier_name === "Ana",
    "la venta absorbida conserva cliente, turno y cajero", JSON.stringify(sales[1]));
  const left = box.prepare("SELECT folio, status FROM pending_sales").all();
  check(left.length === 1 && left[0].folio === "A-000003" && left[0].status === "conflict",
    "la venta inválida queda en pending_sales como conflicto (no se pierde)", JSON.stringify(left));
  const before = dbSchema.ensureHostEpoch(box);
  const after = dbSchema.renewHostEpoch(box);
  check(before && after && before !== after, "la promoción renueva la época del Host");
  box.close();

  console.log("=== 3.3/3.4 · época: resync de cajas con la época vieja ===");
  const host = fixture.createMemoryDb();
  activation.registerPairing(host, { deviceId: BOX, deviceName: "Caja", token: "tok", deviceType: "desktop_box", approved: 1 });
  const started = await apiServer.startServer(host, PORT, { appVersion: "9.9.9-check" });
  check(started.success === true, "Host arranca", started.error);
  const H = (epoch) => ({ "x-device-id": BOX, "x-device-token": "tok", ...(epoch ? { "x-host-epoch": epoch } : {}) });
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check(health.host_epoch && health.host_device_id && health.app_version === "9.9.9-check",
    "/api/health expone host_device_id, host_epoch y app_version", JSON.stringify(health));
  const snap = await (await fetch(`${BASE}/api/replica/snapshot?table=products`, { headers: H() })).json();
  check(snap.host_epoch === health.host_epoch, "el snapshot entrega la época", JSON.stringify(snap.host_epoch));
  let ch = await (await fetch(`${BASE}/api/replica/changes?since=0`, { headers: H(snap.host_epoch) })).json();
  check(ch.success === true, "misma época → deltas normales", JSON.stringify(ch).slice(0, 120));
  dbSchema.renewHostEpoch(host); // restauración / promoción
  ch = await (await fetch(`${BASE}/api/replica/changes?since=0`, { headers: H(snap.host_epoch) })).json();
  check(ch.success === false && ch.code === "HOST_EPOCH_CHANGED" && ch.resync === true,
    "época vieja → /changes pide resync", JSON.stringify(ch));
  ch = await (await fetch(`${BASE}/api/replica/changes?since=0`, { headers: H() })).json();
  check(ch.success === true, "caja sin época (versión anterior) → sin cambios de contrato");
  // SSE: el primer frame debe ser resync.
  const ac = new AbortController();
  const sse = await fetch(`${BASE}/api/events?since=0`, { headers: H(snap.host_epoch), signal: ac.signal });
  const reader = sse.body.getReader();
  let text = "";
  for (let i = 0; i < 5 && !/\n\n/.test(text); i++) {
    const { value } = await reader.read();
    text += Buffer.from(value || []).toString("utf8");
  }
  ac.abort();
  check(/event: resync/.test(text) && /HOST_EPOCH_CHANGED/.test(text), "época vieja → SSE responde resync", text.slice(0, 160));
  await apiServer.stopServer();

  console.log("=== 3.5 · respaldos ===");
  const buf = fs.readFileSync(BACKUP);
  const recvDir = path.join(TMP, "received");
  let r = backupService.receiveBackup({ dir: recvDir, name: "pos-auto-x.db", buffer: buf, expectedSha256: "00".repeat(32) });
  check(r.success === false && r.code === "BACKUP_CHECKSUM_MISMATCH", "SHA-256 distinto al del Host → rechazado", JSON.stringify(r));
  r = backupService.receiveBackup({ dir: recvDir, name: "pos-auto-x.db", buffer: buf, expectedSha256: backupService.sha256Buffer(buf) });
  check(r.success === true, "SHA-256 correcto → aceptado", JSON.stringify(r));
  const closeDir = path.join(TMP, "close");
  fs.mkdirSync(closeDir, { recursive: true });
  for (let i = 0; i < 65; i++) {
    const f = path.join(closeDir, `pos-close-${String(i).padStart(3, "0")}.db`);
    fs.writeFileSync(f, "x");
    const t = new Date(Date.now() - (65 - i) * 60000);
    fs.utimesSync(f, t, t);
  }
  backupService.applyRetention(closeDir);
  const leftClose = fs.readdirSync(closeDir).filter((f) => f.startsWith("pos-close-"));
  check(leftClose.length === 60 && !leftClose.includes("pos-close-000.db"),
    "copias de cierre: se conservan las 60 más recientes", String(leftClose.length));

  console.log(`\n=== Fase 3: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
});
