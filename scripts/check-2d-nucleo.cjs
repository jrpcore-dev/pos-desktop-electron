"use strict";
/*
 * PASO 3 · Auxiliar 2d sobre el núcleo de venta, movido desde
 * C:\Users\jacob\AppData\Local\Temp\opencode\vendia-verify\check-customer.cjs
 * y adaptado: el esquema ya NO está escrito a mano; se construye con
 * src/main/db-schema.js (scripts/db-fixture.js), igual que en la app real.
 * (La parte "A" del original, que reproducía el crash por fixture sin
 * customer_id, queda cubierta de forma natural: el esquema real sí tiene la
 * columna, que es como arranca la app.)
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-2d-nucleo.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");
const salesCore = require(path.join(fixture.REPO, "src", "main", "sales-core.js"));

const db = fixture.createMemoryDb();
db.prepare("INSERT INTO products (id, name, price, stock) VALUES (1, 'Leche', 20, 5)").run();
db.prepare("INSERT INTO customers (id, name) VALUES (7, 'Ana')").run();
db.prepare("INSERT INTO cash_register (id, date, status) VALUES (1, date('now'), 'open')").run();

let pass = 0;
let fail = 0;
const check = (cond, label, extra) => {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label + (extra ? " :: " + extra : "")); }
};
const base = (over = {}) => ({
  cart: [{ id: 1, quantity: 1, price: 20 }],
  total: 20,
  paymentMethod: "cash",
  discountTotal: 0,
  cashierName: "Ana",
  cashierId: 1,
  role: "cashier",
  ...over,
});

const row = () => db.prepare("SELECT id, total, customer_id FROM sales ORDER BY id DESC LIMIT 1").get();

let r = db.transaction((p) => salesCore.createSaleTx(db, p))(base({ customerId: 7 }));
check(r.success === true && row().customer_id === 7, "customerId existente (7) → guardado en sales.customer_id");
check(Array.isArray(r.warnings) && r.warnings.length === 0, "sin warnings con cliente válido");

r = db.transaction((p) => salesCore.createSaleTx(db, p))(base({ customerId: 999 }));
check(r.success === true, "customerId inexistente (999) → venta NO falla");
check(row().customer_id === null, "customerId inexistente → customer_id NULL");
check(r.warnings.some((w) => w.code === "CUSTOMER_NOT_FOUND" && w.customer_id === 999),
  "warning CUSTOMER_NOT_FOUND con customer_id=999", JSON.stringify(r.warnings));

try {
  db.transaction((p) => salesCore.createSaleTx(db, p))(base({ customerId: 1.5 }));
  check(false, "customerId decimal debería lanzar INVALID_CUSTOMER");
} catch (e) { check(e.code === "INVALID_CUSTOMER", "customerId 1.5 → INVALID_CUSTOMER", e.code); }

try {
  db.transaction((p) => salesCore.createSaleTx(db, p))(base({ customerId: 0 }));
  check(false, "customerId 0 debería lanzar INVALID_CUSTOMER");
} catch (e) { check(e.code === "INVALID_CUSTOMER", "customerId 0 → INVALID_CUSTOMER", e.code); }

try {
  db.transaction((p) => salesCore.createSaleTx(db, p))(base({ customerId: "7" }));
  check(false, "customerId string debería lanzar INVALID_CUSTOMER");
} catch (e) { check(e.code === "INVALID_CUSTOMER", "customerId string → INVALID_CUSTOMER", e.code); }

// Equivalencia null vs omitido (lo que normaliza el hash de idempotencia)
const before = db.prepare("SELECT COUNT(*) c FROM sales").get().c;
db.transaction((p) => salesCore.createSaleTx(db, p))(base({ customerId: null }));
const nullRow = db.prepare("SELECT customer_id FROM sales ORDER BY id DESC LIMIT 1").get();
db.transaction((p) => salesCore.createSaleTx(db, p))(base({}));
const omitRow = db.prepare("SELECT customer_id FROM sales ORDER BY id DESC LIMIT 1").get();
check(nullRow.customer_id === null && omitRow.customer_id === null,
  "customerId null y omitido → ambos customer_id NULL", JSON.stringify({ nullRow, omitRow }));
check(db.prepare("SELECT COUNT(*) c FROM sales").get().c === before + 2, "ambos crean venta");

const idx = db.prepare("PRAGMA index_list(sales)").all().find((i) => i.name === "idx_sales_customer");
check(Boolean(idx) && idx.unique === 0, "índice idx_sales_customer creado (por db-schema.js)", JSON.stringify(idx));
check(db.prepare("PRAGMA table_info(sales)").all().some((c) => c.name === "customer_id"),
  "columna sales.customer_id presente (por db-schema.js)");

console.log(`\n[check-2d-nucleo] pass=${pass} fail=${fail}`);
db.close();
process.exit(fail === 0 ? 0 : 1);
