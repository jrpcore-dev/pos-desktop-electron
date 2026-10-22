"use strict";
/*
 * Bloque 6/G · Prueba headless OBLIGATORIA de durabilidad.
 *
 * Escenario: el Host muere. Se restaura su respaldo en una PC nueva, una caja
 * se reconecta y sube su cola offline. Debe conservar:
 *   · host_device_id (identidad del negocio),
 *   · código de activación,
 *   · cajas emparejadas (para que reconecten sin volver a emparejar),
 * y no debe duplicar ni perder ventas aunque la red se corte a mitad de subida.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-6g-promotion.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
const dbSchema = require(path.join(REPO, "src", "main", "db-schema.js"));
const activation = require(path.join(REPO, "src", "main", "activation.js"));
const salesCore = require(path.join(REPO, "src", "main", "sales-core.js"));
const queue = require(path.join(REPO, "src", "main", "offline-queue.js"));
const backupService = require(path.join(REPO, "src", "main", "backup-service.js"));

const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();

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

const dir = path.join(os.tmpdir(), "opencode");
fs.mkdirSync(dir, { recursive: true });
const tag = `${process.pid}-${Date.now()}`;
const HOST_OLD = path.join(dir, `6g-host-old-${tag}.db`);
const HOST_NEW = path.join(dir, `6g-host-new-${tag}.db`);
const BOX = path.join(dir, `6g-box-${tag}.db`);
const BACKUP = path.join(dir, `6g-backup-${tag}.db`);
const files = [HOST_OLD, HOST_NEW, BOX, BACKUP];
files.forEach((f) =>
  [f, `${f}-wal`, `${f}-shm`].forEach((x) => {
    try {
      fs.unlinkSync(x);
    } catch (e) {}
  }),
);

const initDb = (file) => {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.function("nomar", nomarize);
  dbSchema.createTables(db);
  activation.ensureSchema(db);
  dbSchema.runMigrations(db);
  return db;
};

const HOST_DEVICE_ID = "host-identidad-del-negocio";
const ACTIVATION_CODE = "AAAA-BBBB-CCCC";
const BOX_DEVICE = "box-caja-1";

(async () => {
  console.log("=== BLOQUE 6/G · restaurar Host y reconectar caja ===");

  // ── 1) Host original con identidad, cajero, producto y caja emparejada ──
  const oldHost = initDb(HOST_OLD);
  activation.setSetting(oldHost, "host_device_id", HOST_DEVICE_ID);
  activation.setSetting(oldHost, "activation_code", ACTIVATION_CODE);
  activation.setSetting(oldHost, "activation_enabled", "1");
  oldHost
    .prepare(
      "INSERT INTO cashiers (id, name, pin_hash, pin_salt, role, is_active) VALUES (7, 'Ana', 'hash', 'salt', 'cashier', 1)",
    )
    .run();
  oldHost
    .prepare(
      "INSERT INTO products (id, barcode, name, search_name, price, stock, sale_unit) VALUES (1, '7501', 'Refresco', 'refresco', 10, 100, 'piece')",
    )
    .run();
  oldHost
    .prepare(
      `INSERT INTO paired_devices
        (device_id, device_name, paired_token_hash, cashier_id, device_code, device_type, scopes, protocol_version, approved)
       VALUES (?, 'Caja 1', 'token-hash', 7, 'A', 'desktop_box', ?, '2.0', 1)`,
    )
    .run(BOX_DEVICE, JSON.stringify(["catalog:read", "sales:write", "register:*"]));
  await oldHost.backup(BACKUP);
  oldHost.close();

  const verified = backupService.verifyDbFile(BACKUP, { requireIdentity: true });
  check(verified.ok, "el respaldo pasa integrity_check y trae tablas de identidad", verified.error);

  // ── 2) PC nueva: restaurar (misma secuencia que restore-backup) ─────────
  check(!fs.existsSync(HOST_NEW) || fs.statSync(HOST_NEW).size === 0, "la PC nueva arranca vacía");
  const newHost = initDb(HOST_NEW);
  backupService.restoreIntoLiveDb(newHost, BACKUP);
  dbSchema.runMigrations(newHost);
  activation.ensureSchema(newHost);

  check(
    activation.getSetting(newHost, "host_device_id") === HOST_DEVICE_ID,
    "se conserva host_device_id",
  );
  check(
    activation.getSetting(newHost, "activation_code") === ACTIVATION_CODE,
    "se conserva el código de activación",
  );
  check(
    !!newHost
      .prepare("SELECT 1 FROM paired_devices WHERE device_id = ? AND approved = 1")
      .get(BOX_DEVICE),
    "la caja sigue emparejada y aprobada (reconecta sin re-emparejar)",
  );
  const identity = backupService.verifyDbFile(HOST_NEW, { requireIdentity: true });
  check(identity.ok, "el Host restaurado tiene todas las tablas de identidad");

  // ── 3) La caja tiene 2 ventas en cola (hechas sin Host) ────────────────
  const boxDb = initDb(BOX);
  const mk = (n) => ({
    folio: `A-${String(n).padStart(6, "0")}`,
    idempotencyKey: `box-key-${n}`,
    payload: {
      cart: [{ id: 1, quantity: 1, finalPrice: 10 }],
      total: 10,
      paymentMethod: "cash",
      discountTotal: 0,
      cashierName: "Ana",
    },
    registerId: null,
    cashierId: 7,
    cashierName: "Ana",
    localCreatedAt: `2026-10-20T18:0${n}:00.000Z`,
  });
  queue.enqueue(boxDb, mk(1));
  queue.enqueue(boxDb, mk(2));
  check(queue.countBlocking(boxDb) === 2, "la caja tiene 2 ventas pendientes");

  // Host simulado: idempotencia real en idempotency_keys + una respuesta
  // perdida después de guardar la primera venta.
  const idem = {
    get: newHost.prepare(
      "SELECT response_json FROM idempotency_keys WHERE device_id = ? AND endpoint = 'POST /api/sales' AND key = ?",
    ),
    set: newHost.prepare(
      "INSERT OR REPLACE INTO idempotency_keys (device_id, endpoint, key, request_hash, response_json, status_code) VALUES (?, 'POST /api/sales', ?, 'h', ?, 200)",
    ),
  };
  let cut = true;
  let lostResponses = 0;
  const sender = async (row) => {
    const prev = idem.get.get(BOX_DEVICE, row.idempotencyKey);
    if (prev) {
      return { ...JSON.parse(prev.response_json), deduped: true };
    }
    const result = newHost.transaction(() =>
      salesCore.createSaleTx(newHost, {
        ...row.payload,
        deviceId: BOX_DEVICE,
        folio: row.folio,
        registerId: row.registerId,
        syncedAt: new Date().toISOString(),
        clientCreatedAt: row.localCreatedAt,
        cashierId: row.cashierId,
        cashierName: row.cashierName,
        requireRegister: false,
      }),
    )();
    const body = {
      success: true,
      saleId: Number(result.saleId),
      folio: result.folio,
    };
    idem.set.run(BOX_DEVICE, row.idempotencyKey, JSON.stringify(body));
    if (cut && row.folio === "A-000001") {
      cut = false;
      lostResponses++;
      throw new Error("ECONNRESET: respuesta perdida tras guardar");
    }
    return body;
  };

  const first = await queue.sync(boxDb, sender);
  check(first.synced === 0, "la respuesta perdida no se cuenta como subida");
  check(first.stop === "HOST_UNREACHABLE", "el corte se trata como red caída, no como rechazo");
  check(first.pending === 2, "las dos siguen pendientes, no se pierde ninguna");
  check(lostResponses === 1, "se simuló una respuesta perdida real");

  // Reconexión: la primera se reenvía con la MISMA clave y se deduplica.
  const second = await queue.sync(boxDb, sender);
  check(second.synced === 2, "al reconectar sube lo que faltaba (la primera se deduplica)");
  check(second.pending === 0, "cola vacía tras reconectar");
  const sales = newHost
    .prepare("SELECT id, folio, device_id, cashier_name, synced_at FROM sales ORDER BY id")
    .all();
  check(sales.length === 2, "el Host nuevo tiene 2 ventas, CERO duplicados", String(sales.length));
  check(
    sales.map((s) => s.folio).join(",") === "A-000001,A-000002",
    "folios continuos y sin huecos",
    sales.map((s) => s.folio).join(","),
  );
  check(
    sales.every((s) => s.device_id === BOX_DEVICE),
    "las ventas conservan la caja de origen",
  );
  check(
    sales.every((s) => s.cashier_name === "Ana"),
    "se conserva el cajero que vendió",
  );
  check(
    sales.every((s) => !!s.synced_at),
    "el Host guarda synced_at en cada venta sincronizada",
  );
  const third = await queue.sync(boxDb, sender);
  check(third.synced === 0, "una tercera pasada no vuelve a subir nada");
  check(
    newHost.prepare("SELECT COUNT(*) c FROM sales").get().c === 2,
    "siguen siendo 2 ventas: idempotencia estable",
  );

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  newHost.close();
  boxDb.close();
  files.forEach((f) =>
    [f, `${f}-wal`, `${f}-shm`].forEach((x) => {
      try {
        fs.unlinkSync(x);
      } catch (e) {}
    }),
  );
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
