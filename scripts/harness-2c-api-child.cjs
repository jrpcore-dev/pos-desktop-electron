"use strict";
// PASO 3 · Hijo del harness HTTP: proceso independiente (otra conexión a la
// misma BD) que vende la última unidad. La transacción es BEGIN IMMEDIATE,
// igual que en el endpoint real. Movido desde vendia-2c/http/concurrency-child.cjs.
const path = require("path");
const Database = require(process.argv[2]);
const salesCore = require(path.join(process.argv[3], "sales-core.js"));

const dbPath = process.argv[4];
const pid = process.pid;
const db = new Database(dbPath, { timeout: 5000 });

const payload = {
  cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }],
  total: 8,
  paymentMethod: "cash",
  discountTotal: 0,
  cashierId: 1,
  cashierName: "Ana",
  role: "cashier",
};

try {
  const result = db.transaction((p) => salesCore.createSaleTx(db, p)).immediate(payload);
  const after = db.prepare("SELECT stock FROM products WHERE id = 1").get().stock;
  console.log(JSON.stringify({ ok: true, pid, saleId: result.saleId, stockAfter: after }));
  process.exit(0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, pid, error: err.message, code: err.code }));
  process.exit(1);
}
