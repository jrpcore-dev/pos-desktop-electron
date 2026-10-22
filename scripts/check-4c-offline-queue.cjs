"use strict";
/*
 * Bloque 4/C · Prueba headless OBLIGATORIA de la cola offline.
 *
 * Simula el caso más peligroso: la red se corta DESPUÉS de que el Host
 * guardó la venta pero ANTES de que la caja reciba la respuesta. Al
 * reintentar, el Host debe reconocer la Idempotency-Key y NO duplicar.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-4c-offline-queue.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
const dbSchema = require(path.join(REPO, "src", "main", "db-schema.js"));
const activation = require(path.join(REPO, "src", "main", "activation.js"));
const queue = require(path.join(REPO, "src", "main", "offline-queue.js"));

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
const FILE = path.join(dir, `check-4c-queue-${process.pid}.db`);
const clean = () => {
  for (const f of [FILE, FILE + "-wal", FILE + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch (e) {}
  }
};
clean();

const db = new Database(FILE);
db.pragma("journal_mode = WAL");
db.function("nomar", nomarize);
dbSchema.createTables(db);
activation.ensureSchema(db);
dbSchema.runMigrations(db);

const mk = (n) => ({
  folio: `A-${String(n).padStart(6, "0")}`,
  idempotencyKey: `key-${n}`,
  payload: {
    cart: [{ productId: 1, quantity: n, finalPrice: 10 }],
    total: n * 10,
    paymentMethod: "cash",
    discountTotal: 0,
    cashierId: 7,
    cashierName: "Ana",
  },
  registerId: 101,
  cashierId: 7,
  cashierName: "Ana",
  localCreatedAt: `2026-10-21T10:0${n}:00.000Z`,
});

console.log("=== BLOQUE 4/C · cola offline ===");
for (let i = 1; i <= 3; i++) queue.enqueue(db, mk(i));
check(queue.countBlocking(db) === 3, "3 ventas encoladas");
check(queue.list(db)[0].folio === "A-000001", "orden por id (primera A-000001)");

// Host simulado: deduplica por Idempotency-Key.
const server = new Map();
const attempts = [];
let cut = true;
const sender = async (row) => {
  attempts.push(row.folio);
  const already = server.get(row.idempotencyKey);
  if (already) return { success: true, saleId: already, deduped: true };
  // El Host guarda ANTES de contestar.
  server.set(row.idempotencyKey, server.size + 1);
  if (cut && row.folio === "A-000002") {
    // Se corta la red justo después de guardar: la caja no recibe respuesta.
    cut = false;
    throw new Error("ECONNRESET a mitad de la subida");
  }
  return { success: true, saleId: server.get(row.idempotencyKey) };
};

(async () => {
  const first = await queue.sync(db, sender);
  check(first.synced === 1, "primer intento: solo sube la 1", JSON.stringify(first));
  check(first.stop === "HOST_UNREACHABLE", "el corte se detecta como red caída");
  check(first.pending === 2, "quedan 2 pendientes, ninguna se pierde");
  check(queue.list(db, ["synced"]).length === 1, "la 1 quedó synced");
  check(
    queue.list(db, ["pending"]).map((r) => r.folio).join(",") === "A-000002,A-000003",
    "las pendientes conservan el orden",
  );

  // Reintento: la 2 ya estaba en el Host → debe deduplicar, no duplicar.
  const second = await queue.sync(db, sender);
  check(second.synced === 2, "reintento sube las 2 restantes", JSON.stringify(second));
  check(second.pending === 0, "cola vacía tras reconectar");
  check(server.size === 3, "el Host tiene 3 ventas, CERO duplicados", String(server.size));
  check(
    attempts.join(",") === "A-000001,A-000002,A-000002,A-000003",
    "la 2 se reintenta con la misma clave",
    attempts.join(","),
  );

  // Corte abrupto durante el envío: la fila queda 'syncing'. Al arrancar de
  // nuevo se recupera y se sube (sin pérdida).
  queue.enqueue(db, mk(4));
  db.prepare("UPDATE pending_sales SET status='syncing' WHERE folio='A-000004'").run();
  const third = await queue.sync(db, sender);
  check(third.synced === 1, "una fila 'syncing' huérfana se recupera y sube");
  check(server.size === 4, "sin duplicado tras el cierre abrupto");

  // Cancelar una venta aún en cola: no se envía.
  const row5 = queue.enqueue(db, mk(5));
  const cancelled = queue.cancel(db, row5.id);
  const fourth = await queue.sync(db, sender);
  check(cancelled.success === true, "cancelar una venta en cola devuelve ok");
  check(fourth.synced === 0, "la cancelada no se envía");
  check(server.size === 4, "el Host sigue con 4: la cancelada no llegó");
  check(
    queue.list(db, ["cancelled"]).length === 1,
    "la cancelada se conserva para auditoría",
  );

  // Conflicto definitivo: no se borra, se marca.
  db.prepare("UPDATE pending_sales SET status='pending' WHERE folio='A-000004'").run();
  queue.enqueue(db, { ...mk(6), idempotencyKey: "key-6", folio: "A-000006" });
  const conflictSender = async (row) =>
    row.folio === "A-000006"
      ? { success: false, code: "FOLIO_CONFLICT", error: "folio duplicado" }
      : { success: true, saleId: 99 };
  const fifth = await queue.sync(db, conflictSender);
  check(fifth.conflicts === 1, "un rechazo definitivo se marca como conflicto");
  check(queue.list(db, ["conflict"]).length === 1, "la venta en conflicto NO se borra");

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  db.close();
  clean();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
