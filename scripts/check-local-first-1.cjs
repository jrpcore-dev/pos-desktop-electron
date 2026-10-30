"use strict";
/*
 * Local-first · paso 1: la caja lee LOCAL Caja, Transacciones y Movimientos.
 *
 *   A) El snapshot trae las tablas de movimientos (ventas, líneas, cortes,
 *      retiros, stock, abonos, proveedores) y de `paired_devices` SÓLO la
 *      identidad visible: el hash del token nunca sale del Host.
 *   B) Una caja con la copia completa resuelve esas lecturas con su BD, con el
 *      contexto de SU device_id y sin tocar la red; si a la copia le falta una
 *      tabla (app recién actualizada) sigue yendo al Host y pide resync.
 *   C) "Lee lo que escribiste": tras una escritura por RPC (abrir caja) o una
 *      venta en línea, la respuesta no vuelve hasta que la copia local ya tiene
 *      ese cambio. Releer local inmediatamente después ya lo ve.
 *   D) Las cajas no generan eventos de réplica (sus triggers no existen).
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-first-1.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const ipcRegistry = require(path.join(REPO, "src/main/ipc-registry.js"));
const rpcContext = require(path.join(REPO, "src/main/rpc-context.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lf1-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3561;
const HOST_URL = `http://127.0.0.1:${PORT}`;

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

clientLink.setSecretCipher({
  available: () => true,
  encrypt: (plain) => Buffer.from("T:" + plain, "utf8").toString("base64"),
  decrypt: (b64) => Buffer.from(String(b64), "base64").toString("utf8").slice(2),
});

// ── Host ────────────────────────────────────────────────────────────────────
const host = fixture.createFileDb(path.join(TMP, "host.db"));
const p = hashPin("1111");
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '001', 'Leche', 8, 100, 'piece', 1)").run();
host.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Lala')").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'closed', 1, 'box-a')").run();
host.prepare("INSERT INTO sales (id, folio, total, payment_method, register_id, device_id) VALUES (1, 'A-000001', 8, 'cash', 1, 'box-a')").run();
host.prepare("INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale) VALUES (1, 1, 'Leche', 1, 8)").run();
host.prepare("INSERT INTO stock_movements (product_id, type, quantity, reference) VALUES (1, 'in', 10, 'Compra')").run();

// Handler de escritura de prueba: lo ejecuta el Host vía /api/rpc (comparten
// proceso, así que ipcRegistry es el mismo; se distingue por contexto).
ipcRegistry.set("open-cash-register", () => {
  host
    .prepare("INSERT INTO cash_register (date, status, cashier_id, device_id) VALUES (date('now'), 'open', 1, ?)")
    .run(rpcContext.currentDeviceId());
  return { success: true };
});
// Lectura de prueba: dice desde qué BD y con qué contexto corrió.
let readsOnBox = 0;
ipcRegistry.set("get-sales-by-range", () => {
  readsOnBox += 1;
  return {
    success: true,
    deviceId: rpcContext.currentDeviceId(),
    sales: box.prepare("SELECT folio FROM sales ORDER BY id").all(),
  };
});
ipcRegistry.set("get-cash-register-status", () => ({
  success: true,
  register: box.prepare("SELECT * FROM cash_register WHERE status = 'open' AND device_id = ? ORDER BY id DESC LIMIT 1").get(rpcContext.currentDeviceId()) || null,
}));

// ── Caja ────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, HOST_URL);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
clientLink.savePairedToken(box, "tok-a");
box.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};

(async () => {
  const started = await apiServer.startServer(host, PORT);
  check(started.success === true, "Host arranca", started.error);

  console.log("=== A · snapshot con las tablas del día a día ===");
  const snap = await replicaEngine.downloadSnapshot(box);
  check(snap.success === true, "descarga inicial OK", JSON.stringify(snap).slice(0, 200));
  const count = (t) => box.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  check(count("sales") === 1 && count("sale_items") === 1, "ventas y líneas en la caja");
  check(count("cash_register") === 1 && count("stock_movements") === 1 && count("suppliers") === 1, "cortes, movimientos y proveedores en la caja");
  const pd = box.prepare("SELECT * FROM paired_devices WHERE device_id = 'box-a'").get();
  check(pd && pd.device_name === "Caja 2", "paired_devices: el nombre de la caja viaja", JSON.stringify(pd));
  check(pd && pd.paired_token_hash === "" && !pd.scopes, "paired_devices: NI el hash del token NI los scopes salen del Host", JSON.stringify(pd));
  check(replicaEngine.missingTables(box).length === 0, "la copia queda completa (sin tablas faltantes)");
  check(dbSchema.isClientRole(box) && box.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_change_log%'").get().c === 0,
    "la caja no tiene triggers de réplica (no genera eventos)");

  console.log("=== B · lectura local ===");
  const before = readsOnBox;
  const local = await boxRpc.forward(box, "get-sales-by-range", [{}]);
  check(readsOnBox === before + 1 && local.deviceId === "box-a", "la lectura corre en la caja con el contexto de SU device_id", JSON.stringify(local));
  check(local.sales.length === 1 && local.sales[0].folio === "A-000001", "…y devuelve la copia local", JSON.stringify(local));
  // Copia incompleta (app actualizada con una tabla nueva): no se lee local.
  const tablesKey = replicaEngine.KEYS.TABLES;
  const saved = activation.getSetting(box, tablesKey);
  activation.setSetting(box, tablesKey, saved.replace(",stock_movements", ""));
  check(replicaEngine.missingTables(box).includes("stock_movements"), "detecta la tabla faltante");
  check(replicaEngine.state(box).stale === true, "…y marca la copia para resync (sin dejar de vender)");
  activation.setSetting(box, tablesKey, saved);

  console.log("=== C · lee lo que escribiste ===");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  const stopLive = replicaLive.startLiveSync({ db: box });
  check(await waitFor(() => replicaLive.liveState(box).state === "connected"), "réplica en vivo conectada");
  const opened = await boxRpc.forward(box, "open-cash-register", [{ openingBalance: 100 }]);
  check(opened && opened.success === true, "abrir caja por RPC", JSON.stringify(opened));
  // SIN esperar: la respuesta sólo vuelve cuando la copia local ya lo tiene.
  const st = await boxRpc.forward(box, "get-cash-register-status", [{}]);
  check(st && st.register && st.register.status === "open", "releer local justo después ya ve la caja abierta", JSON.stringify(st));

  // Cambio hecho en el Host por otro lado (otra caja, el propio Host): llega solo.
  host.prepare("INSERT INTO sales (folio, total, payment_method, register_id, device_id) VALUES ('H-000001', 20, 'card', NULL, ?)").run(
    activation.getSetting(host, "host_device_id") || "host",
  );
  check(await waitFor(() => box.prepare("SELECT 1 AS x FROM sales WHERE folio = 'H-000001'").get() !== undefined),
    "una venta del Host aparece en la copia de la caja en vivo");

  stopLive();
  await apiServer.stopServer();
  console.log(`\n=== local-first 1: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
