"use strict";
/*
 * PASO A · Prueba PERMANENTE de instalación nueva.
 *
 * Sobre una BD vacía recién creada, la secuencia de arranque real de la app
 * (main.js:113 → activation.ensureSchema(db) → runMigrations(db)) debe
 * terminar sin error, con integrity_check = "ok" y con `sale_items` ya en su
 * forma final (product_id nullable + stock_deducted), sin pasar por la
 * reconstrucción.
 *
 * Regresión que cubre: `SQLITE_ERROR: no such column: stock_deducted`, el bug
 * de instalación nueva introducido en 89c0451 (raíz, 2026-09-08) y presente en
 * v2.0.1, v2.0.2 y v2.0.3 — reproducido antes del arreglo con el código de
 * esos tags sobre una BD vacía.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-empty-db.cjs
 * Sale con código 1 si algún check falla.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
const dbSchema = require(path.join(REPO, "src", "main", "db-schema.js"));
const activation = require(path.join(REPO, "src", "main", "activation.js"));

// Misma definición que main.js:100-106 (runMigrations usa la función SQL nomar).
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
const FILE = path.join(dir, `check-empty-db-${process.pid}.db`);
const clean = () => {
  for (const f of [FILE, FILE + "-wal", FILE + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch (e) {}
  }
};
clean();

console.log("=== PASO A · BD vacía (instalación nueva) ===");
const db = new Database(FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
try {
  db.function("nomar", nomarize);
} catch (e) {}

// Misma secuencia y mismo orden que main.js:113-130.
const startup = () => {
  dbSchema.createTables(db);
  activation.ensureSchema(db);
  dbSchema.runMigrations(db);
};

try {
  startup();
  check(true, "1ª pasada: createTables + ensureSchema + runMigrations sin error");
} catch (e) {
  check(false, "1ª pasada: createTables + ensureSchema + runMigrations sin error", `${e.code}: ${e.message}`);
}

try {
  startup(); // una BD que arranca dos veces debe ser idempotente
  check(true, "2ª pasada idempotente sin error");
} catch (e) {
  check(false, "2ª pasada idempotente sin error", `${e.code}: ${e.message}`);
}

const integrity = db.pragma("integrity_check", { simple: true });
check(integrity === "ok", "integrity_check = ok", JSON.stringify(integrity));

const si = db.prepare("PRAGMA table_info(sale_items)").all();
const byName = (n) => si.find((c) => c.name === n);
check(!!byName("stock_deducted"), "sale_items tiene la columna stock_deducted");
check(byName("product_id") && byName("product_id").notnull === 0, "sale_items.product_id es nullable");
check(
  JSON.stringify(si.map((c) => c.name)) ===
    JSON.stringify([
      "id",
      "sale_id",
      "product_id",
      "product_name",
      "quantity",
      "price_at_sale",
      "discount_percent",
      "stock_deducted",
      "service_transaction_id",
      "status",
      "cancelled_at",
      "cancelled_by",
      "cancelled_by_device",
      "returned_qty",
    ]),
  "sale_items en su forma final (columnas y orden)",
  JSON.stringify(si.map((c) => c.name)),
);

const wanted = [
  "products",
  "sales",
  "sale_items",
  "cash_register",
  "cash_register_expenses",
  "cashiers",
  "customers",
  "customer_tiers",
  "settings",
];
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name);
for (const t of wanted) check(tables.includes(t), `tabla creada: ${t}`);

let tiers = null;
try {
  tiers = db.prepare("SELECT COUNT(*) c FROM customer_tiers").get().c;
} catch (e) {
  tiers = `ERROR ${e.code}: ${e.message}`;
}
check(tiers === 3, "customer_tiers sembrado (Normal/Frecuente/Mayorista)", `c=${tiers}`);

let idx = null;
try {
  idx = db
    .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
    .get().c;
} catch (e) {
  idx = `ERROR ${e.code}: ${e.message}`;
}
check(idx > 0, "índices creados por runMigrations", `c=${idx}`);

db.close();
clean();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
