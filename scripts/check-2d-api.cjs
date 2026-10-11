"use strict";
/*
 * PASO 3 · Auxiliar 2d sobre la API HTTP, movido desde
 * C:\Users\jacob\AppData\Local\Temp\opencode\vendia-verify\check-http-2cB.cjs
 * y adaptado: el esquema ya NO está escrito a mano; se construye con
 * src/main/db-schema.js (scripts/db-fixture.js), igual que en la app real.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-2d-api.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const PORT = 3499;
const BASE = `http://127.0.0.1:${PORT}`;

const Database = fixture.Database;
const activation = require(path.join(REPO, "src", "main", "activation.js"));
const { hashPin } = require(path.join(REPO, "src", "main", "pins.js"));
const apiServer = require(path.join(REPO, "src", "main", "api-server.js"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-2d-api-"));
const DB = path.join(dir, "v.db");
const db = fixture.createFileDb(DB);

const p = hashPin("1234");
db.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'cashier', '', 1, ?, ?)").run(p.hash, p.salt);
db.prepare("INSERT INTO products (id, barcode, name, price, stock) VALUES (1, '001', 'Leche', 8, 1)").run();
db.prepare("INSERT INTO products (id, barcode, name, price, stock) VALUES (2, '002', 'Coco', 10, 5)").run();
db.prepare("INSERT INTO customers (id, name) VALUES (7, 'Ana cliente')").run();
// 3a.i: la caja del fixture pertenece a la caja que vende (dev-desk-ok).
db.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'dev-desk-ok')").run();
activation.registerPairing(db, { deviceId: "dev-desk-ok", deviceName: "Caja", token: "tok-desk-ok", cashierId: 1, deviceType: "desktop_box", approved: 1 });
activation.registerPairing(db, { deviceId: "dev-mobile", deviceName: "Celular", token: "tok-mobile", cashierId: 1, deviceType: "mobile", approved: 1 });

let pass = 0, fail = 0;
const results = [];
const assert = (cond, label, extra) => {
  if (cond) { pass++; results.push("  PASS " + label); }
  else { fail++; results.push("  FAIL " + label + (extra ? " :: " + extra : "")); }
};
const post = (url, body, headers = {}) =>
  fetch(`${BASE}${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { __raw: t }; } };

const payload = (over = {}) => ({ cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }], total: 8, paymentMethod: "cash", discountTotal: 0, ...over });
const H = (token, key, extra = {}) => ({ authorization: AUTH, "x-device-id": "dev-desk-ok", "x-device-token": token, "idempotency-key": key, ...extra });
let AUTH = null;

(async () => {
  const started = await apiServer.startServer(db, PORT);
  assert(started.success === true, "startServer arranca");

  const a = await post("/api/auth", { id: 1, pin: "1234" }, { "x-device-id": "dev-desk-ok" });
  const ab = await json(a);
  assert(a.status === 200 && ab.token, "POST /api/auth 200 con token");
  AUTH = ab.token;

  let g = await post("/api/sales", payload(), { authorization: AUTH, "x-device-id": "dev-mobile", "x-device-token": "tok-mobile", "idempotency-key": "k1" });
  let b = await json(g);
  assert(g.status === 403, "móvil con sales:write → 403", JSON.stringify(b));

  g = await post("/api/sales", payload(), { authorization: AUTH, "x-device-id": "dev-desk-ok", "x-device-token": "tok-desk-ok", "idempotency-key": "k1" });
  b = await json(g);
  assert(g.status === 200 && b.success && Number.isInteger(b.saleId), "desktop_box aprobado → 200 con saleId", JSON.stringify(b));
  assert(b.warnings && b.warnings.length === 0, "sin warnings con stock suficiente");
  const sale1 = b.saleId;
  assert(db.prepare("SELECT stock FROM products WHERE id=1").get().stock === 0, "stock 1→0 tras vender 1");

  g = await post("/api/sales", payload(), { authorization: AUTH, "x-device-id": "dev-desk-ok", "x-device-token": "tok-desk-ok" });
  b = await json(g);
  assert(g.status === 400 && b.code === "IDEMPOTENCY_KEY_REQUIRED", "sin Idempotency-Key → 400 obligatoria", JSON.stringify(b));

  // Replay con orden de claves distinto (huella canónica)
  const reordered = { discountTotal: 0, paymentMethod: "cash", total: 8, cart: [{ finalPrice: 8, price: 8, quantity: 1, id: 1 }] };
  g = await post("/api/sales", reordered, H("tok-desk-ok", "k1"));
  b = await json(g);
  assert(g.status === 200 && b.saleId === sale1, "replay mismo payload reordenado → 200 mismo saleId", JSON.stringify(b));

  g = await post("/api/sales", payload({ total: 77 }), H("tok-desk-ok", "k1"));
  b = await json(g);
  assert(g.status === 422 && b.code === "IDEMPOTENCY_CONFLICT", "misma clave + payload distinto → 422", JSON.stringify(b));

  const before = db.prepare("SELECT COUNT(*) c FROM sales").get().c;
  const badCart = { cart: [{ id: 999, quantity: 1, price: 1 }], total: 9, paymentMethod: "cash", discountTotal: 0 };
  g = await post("/api/sales", badCart, H("tok-desk-ok", "fail-1"));
  b = await json(g);
  assert(g.status === 400 && b.code === "PRODUCT_NOT_FOUND", "producto inexistente → 400 PRODUCT_NOT_FOUND", JSON.stringify(b));
  assert(db.prepare("SELECT COUNT(*) c FROM sales").get().c === before, "rollback: sin venta parcial");
  assert(db.prepare("SELECT COUNT(*) c FROM idempotency_keys WHERE key='fail-1'").get().c === 0, "rollback: sin clave guardada (misma transacción)");
  g = await post("/api/sales", payload(), H("tok-desk-ok", "fail-1"));
  b = await json(g);
  assert(g.status === 200 && b.success, "retry con la misma clave tras fallo → 200 (clave libre)", JSON.stringify(b));

  // Stock negativo + rastro durable
  db.prepare("UPDATE products SET stock = 0 WHERE id = 2").run();
  g = await post("/api/sales", { cart: [{ id: 2, quantity: 1, price: 10, finalPrice: 10 }], total: 10, paymentMethod: "cash", discountTotal: 0 }, H("tok-desk-ok", "neg1"));
  b = await json(g);
  assert(g.status === 200 && b.warnings.length === 1 && b.warnings[0].code === "STOCK_NEGATIVE" && b.warnings[0].stock_after === -1,
    "venta en negativo → 200 con STOCK_NEGATIVE stock_after=-1", JSON.stringify(b));
  const row = db.prepare("SELECT stock_conflict, conflict_detail FROM sales WHERE id = ?").get(b.saleId);
  assert(row.stock_conflict === 1 && row.conflict_detail.includes("STOCK_NEGATIVE"), "rastro stock_conflict/conflict_detail en la venta", JSON.stringify(row));

  // Concurrencia real con la MISMA clave
  const cBefore = db.prepare("SELECT COUNT(*) c FROM sales").get().c;
  const [r1, r2] = await Promise.all([
    post("/api/sales", payload({ total: 8 }), H("tok-desk-ok", "conc1")),
    post("/api/sales", payload({ total: 8 }), H("tok-desk-ok", "conc1")),
  ]);
  const j1 = await json(r1), j2 = await json(r2);
  assert(r1.status === 200 && r2.status === 200 && JSON.stringify(j1) === JSON.stringify(j2), "misma clave simultánea → ambas 200 e idénticas", `${r1.status}/${r2.status} ${JSON.stringify(j1)}`);
  assert(db.prepare("SELECT COUNT(*) c FROM sales").get().c === cBefore + 1, "misma clave simultánea → UNA sola venta");

  // 2d: customer_id guardado / no encontrado / normalización del hash
  g = await post("/api/sales", payload({ customer_id: 7 }), H("tok-desk-ok", "c1"));
  b = await json(g);
  assert(g.status === 200 && db.prepare("SELECT customer_id FROM sales WHERE id=?").get(b.saleId).customer_id === 7,
    "customer_id existente → guardado en sales.customer_id", JSON.stringify(b));

  g = await post("/api/sales", payload({ customer_id: 999 }), H("tok-desk-ok", "c2"));
  b = await json(g);
  assert(g.status === 200 && b.warnings.some((w) => w.code === "CUSTOMER_NOT_FOUND" && w.customer_id === 999),
    "customer_id inexistente → 200 + warning CUSTOMER_NOT_FOUND", JSON.stringify(b));
  assert(db.prepare("SELECT customer_id FROM sales WHERE id=?").get(b.saleId).customer_id === null,
    "customer_id inexistente → NULL en la venta");

  // normalización: null y omitido deben producir el MISMO hash de idempotencia
  g = await post("/api/sales", payload({ customer_id: null }), H("tok-desk-ok", "hash-null"));
  b = await json(g);
  const nullSale = b.saleId;
  g = await post("/api/sales", payload(), H("tok-desk-ok", "hash-null"));
  b = await json(g);
  assert(g.status === 200 && b.saleId === nullSale, "misma clave: customer_id null vs OMITIDO → mismo hash (replay)", `${g.status} ${JSON.stringify(b)}`);

  g = await post("/api/sales", payload({ customer_id: 7 }), H("tok-desk-ok", "hash-null"));
  b = await json(g);
  assert(g.status === 422, "misma clave: customer_id null vs 7 → hash distinto → 422", `${g.status} ${JSON.stringify(b)}`);

  g = await post("/api/sales", payload({ customer_id: 1.5 }), H("tok-desk-ok", "c3"));
  b = await json(g);
  assert(g.status === 400 && b.code === "INVALID_CUSTOMER", "customer_id decimal → 400 INVALID_CUSTOMER", JSON.stringify(b));

  const big = { cart: Array.from({ length: 501 }, () => ({ id: 2, quantity: 1, price: 10, finalPrice: 10 })), total: 5010, paymentMethod: "cash", discountTotal: 0 };
  g = await post("/api/sales", big, H("tok-desk-ok", "big"));
  b = await json(g);
  assert(g.status === 400 && b.code === "INVALID_PAYLOAD", "501 líneas → 400 INVALID_PAYLOAD", JSON.stringify(b));

  const h = await fetch(`${BASE}/api/health`);
  const hb = await json(h);
  assert(h.status === 200 && hb.success === true, "GET /api/health intacto (express.json() global sin romper)", JSON.stringify(hb));

  console.log("\n=== Auxiliar 2d sobre la API (scripts/, esquema real) ===");
  for (const r of results) console.log(r);
  console.log(`\n[check-2d-api] pass=${pass} fail=${fail}`);
  await apiServer.stopServer();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
