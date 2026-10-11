"use strict";
/*
 * PASO 3 · Harness HTTP real para la Entrega 2c-B (POST /api/sales + idempotencia),
 * movido desde C:\Users\jacob\AppData\Local\Temp\opencode\vendia-2c\http\harness.cjs
 * y adaptado:
 *   - el esquema ya NO está escrito a mano: se construye con src/main/db-schema.js
 *     (scripts/db-fixture.js), igual que en la app real;
 *   - el stderr de los hijos del test multiproceso YA NO se descarta: se captura,
 *     se pega en la salida y se comprueba que esté vacío.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\harness-2c-api.cjs [dir-temporal]
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const DIR = path.join(process.argv[2] || os.tmpdir(), "vendia-2c-http");
fs.mkdirSync(DIR, { recursive: true });
const DB_MAIN = path.join(DIR, "http-main.db");
const DB_CORE = path.join(DIR, "http-core.db");
for (const f of [DB_MAIN, DB_MAIN + "-wal", DB_MAIN + "-shm", DB_CORE, DB_CORE + "-wal", DB_CORE + "-shm"]) {
  try { fs.unlinkSync(f); } catch (e) {}
}

const better = path.join(REPO, "node_modules", "better-sqlite3");
const Database = require(better);
const activation = require(path.join(REPO, "src/main/activation.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));

const PORT = 3491;
const BASE = `http://127.0.0.1:${PORT}`;

let AUTH_TOKEN = null;
let DEVICE_ID = null;
let db = null;

let failed = 0;
const results = [];
const assert = (cond, label, extra) => {
  const ok = Boolean(cond);
  if (!ok) failed += 1;
  const suffix = extra ? ` · ${extra}` : "";
  results.push(`${ok ? "✓" : "✗"} ${label}${suffix}`);
};

// Esquema real (db-schema.js) sobre un fichero con WAL, como la app.
const buildSchema = (target) => {
  target.pragma("journal_mode = WAL");
  fixture.applySchema(target);
  activation.ensureSchema(target);
  return target;
};

const seed = (target) => {
  const p = hashPin("1234");
  target.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'cashier', '', 1, ?, ?)").run(p.hash, p.salt);
  target.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, min_stock) VALUES (1, '001', 'Leche', 8, 1, 'piece', 2)").run();
  target.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, min_stock) VALUES (2, '002', 'Coco', 10, 5, 'piece', 2)").run();
  // 3a.i: la caja del fixture pertenece a la caja que vende (dev-desk-ok).
  target.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'dev-desk-ok')").run();
  activation.registerPairing(target, { deviceId: "dev-mobile", deviceName: "Celular", token: "tok-mobile", cashierId: 1, deviceType: "mobile", approved: 1 });
  activation.registerPairing(target, { deviceId: "dev-desk-pending", deviceName: "Caja pendiente", token: "tok-desk-pending", cashierId: 1, deviceType: "desktop_box", approved: 0 });
  activation.registerPairing(target, { deviceId: "dev-desk-ok", deviceName: "Caja aprobada", token: "tok-desk-ok", cashierId: 1, deviceType: "desktop_box", approved: 1 });
};

const post = async (url, body, headers = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res;
};
const json = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { __raw: text }; }
};

// Reordena las claves de un objeto (nuevo orden de inserción) manteniendo los
// valores: sirve para probar la huella canónica.
const remapKeys = (o) => {
  const r = {};
  for (const k of Object.keys(o).reverse()) r[k] = o[k];
  return r;
};

const payloadFor = (over = {}) => ({
  cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }],
  total: 8,
  paymentMethod: "cash",
  discountTotal: 0,
  ...over,
});

const saleHeaders = (deviceToken, key) => ({
  authorization: AUTH_TOKEN,
  "x-device-id": DEVICE_ID,
  "x-device-token": deviceToken,
  "idempotency-key": key,
});

const salesCount = () => db.prepare("SELECT COUNT(*) AS c FROM sales").get().c;
const stockOf = (id) => db.prepare("SELECT stock FROM products WHERE id = ?").get(id).stock;
const keyCount = () => db.prepare("SELECT COUNT(*) AS c FROM idempotency_keys").get().c;

(async () => {
  const dbMain = new Database(DB_MAIN);
  db = dbMain;
  buildSchema(dbMain);
  seed(dbMain);

  const started = await apiServer.startServer(dbMain, PORT);
  assert(started.success === true, "startServer arranca");

  // Login para obtener el token de cajero (independiente del emparejamiento).
  const authRes = await post("/api/auth", { id: 1, pin: "1234" }, { "x-device-id": "dev-ok" });
  const authBody = await json(authRes);
  assert(authRes.status === 200 && authBody.token, "POST /api/auth 200 con token");
  AUTH_TOKEN = authBody.token;
  DEVICE_ID = "dev-desk-ok";

  // ─── 1. Scopes: celular 403, desktop_box pendiente 403, aprobado 200 ───
  let g = await post("/api/sales", payloadFor(), saleHeaders("tok-mobile", "k1"));
  let b = await json(g);
  assert(g.status === 403, "celular emparejado → 403", b.error);

  g = await post("/api/sales", payloadFor({ total: 9 }), saleHeaders("tok-desk-pending", "k1"));
  b = await json(g);
  assert(g.status === 403, "desktop_box PENDIENTE → 403", b.error);

  g = await post("/api/sales", payloadFor(), saleHeaders("tok-desk-ok", "k1"));
  b = await json(g);
  assert(g.status === 200 && b.success === true && Number.isInteger(b.saleId), "desktop_box aprobado → 200 con saleId");
  assert(b.warnings && b.warnings.length === 0, "sin warnings (stock suficiente)");

  const after1 = salesCount();
  const stockLeche = stockOf(1);
  assert(stockLeche === 0, `stock Leche 1→0 tras vender 1`, `stock=${stockLeche}`);

  g = await post("/api/sales", payloadFor(), { "x-device-id": "dev-desk-ok", "x-device-token": "tok-desk-ok", "idempotency-key": "k-auth" });
  b = await json(g);
  assert(g.status === 401, "sin token de auth → 401");

  // ─── 2. Replay con huella canónica (mismo payload, orden distinto) ───
  g = await post("/api/sales", remapKeys(payloadFor()), saleHeaders("tok-desk-ok", "k1"));
  b = await json(g);
  assert(g.status === 200 && b.success === true && b.saleId !== undefined, "replay misma clave + orden cambiado → 200 (no 422)");
  assert(salesCount() === after1, "replay NO crea otra venta");

  g = await post("/api/sales", payloadFor({ total: 77 }), saleHeaders("tok-desk-ok", "k1"));
  assert(g.status === 422, "misma clave + payload distinto → 422");

  g = await post("/api/sales", payloadFor(), saleHeaders("tok-desk-ok", ""));
  assert(g.status === 400, "sin Idempotency-Key → 400");

  // ─── 3. Warning de stock negativo + replay lo repite idéntico ───
  db.prepare("UPDATE products SET stock = 0 WHERE id = 2").run();
  g = await post("/api/sales", payloadFor({ cart: [{ id: 2, quantity: 1, price: 10, finalPrice: 10 }], total: 10 }), saleHeaders("tok-desk-ok", "neg1"));
  b = await json(g);
  assert(g.status === 200 && Array.isArray(b.warnings) && b.warnings.length === 1, "venta en negativo → 200 con warning");
  assert(b.warnings[0] && b.warnings[0].code === "STOCK_NEGATIVE" && b.warnings[0].stock_after === -1, "warning STOCK_NEGATIVE stock_after=-1", JSON.stringify(b.warnings[0]));
  const negResp = JSON.stringify(b);
  const negSale = salesCount();
  const negRow = db.prepare("SELECT stock_conflict, conflict_detail FROM sales WHERE id = ?").get(b.saleId);
  assert(negRow.stock_conflict === 1 && negRow.conflict_detail.includes("STOCK_NEGATIVE"), "rastro stock_conflict/conflict_detail guardado");

  g = await post("/api/sales", payloadFor({ cart: [{ id: 2, quantity: 1, price: 10, finalPrice: 10 }], total: 10 }), saleHeaders("tok-desk-ok", "neg1"));
  b = await json(g);
  assert(g.status === 200 && JSON.stringify(b) === negResp, "replay repite la respuesta INCLUIDOS warnings");
  assert(salesCount() === negSale, "replay no suma venta");

  // ─── 4. Concurrencia REAL por HTTP: misma Idempotency-Key simultánea ───
  const before = salesCount();
  const [c1, c2] = await Promise.all([
    post("/api/sales", payloadFor({ total: 8 }), saleHeaders("tok-desk-ok", "conc1")),
    post("/api/sales", payloadFor({ total: 8 }), saleHeaders("tok-desk-ok", "conc1")),
  ]);
  const j1 = await json(c1);
  const j2 = await json(c2);
  assert(c1.status === 200 && c2.status === 200, "misma clave simultánea → ambas 200");
  assert(JSON.stringify(j1) === JSON.stringify(j2), "misma clave simultánea → respuestas idénticas", `j1=${JSON.stringify(j1)} j2=${JSON.stringify(j2)}`);
  assert(salesCount() === before + 1, "misma clave simultánea → UNA sola venta");

  // ─── 5. Concurrencia por la última unidad (claves distintas) ───
  db.prepare("UPDATE products SET stock = 1 WHERE id = 1").run();
  const [u1, u2] = await Promise.all([
    post("/api/sales", payloadFor(), saleHeaders("tok-desk-ok", "last-a")),
    post("/api/sales", payloadFor(), saleHeaders("tok-desk-ok", "last-b")),
  ]);
  const w1 = await json(u1);
  const w2 = await json(u2);
  assert(u1.status === 200 && u2.status === 200, "última unidad simultánea (claves distintas) → ambas 200");
  assert(stockOf(1) === -1, `última unidad → stock exacto 1-2=-1`, `stock=${stockOf(1)}`);
  assert(w1.success === true && w2.success === true, "ambas ventas existen pese al negativo");

  // ─── 6. Fallo a mitad de txn: sin venta NI clave guardada ───
  const badCart = [...payloadFor().cart, { id: 99999, quantity: 1, price: 1, finalPrice: 1 }];
  const before2 = salesCount();
  const beforeKeys = keyCount();
  g = await post("/api/sales", payloadFor({ cart: badCart, total: 9 }), saleHeaders("tok-desk-ok", "fail-1"));
  b = await json(g);
  assert(g.status === 400 && b.code === "PRODUCT_NOT_FOUND", "carrito con producto inexistente → 400 PRODUCT_NOT_FOUND");
  assert(salesCount() === before2, "fallo → sin venta parcial");
  assert(keyCount() === beforeKeys, "fallo → sin clave de idempotencia guardada");

  g = await post("/api/sales", payloadFor(), saleHeaders("tok-desk-ok", "fail-1"));
  b = await json(g);
  assert(g.status === 200 && b.success, "retry misma clave tras fallo → funciona (clave libre)");

  // ─── 7. Tope de líneas + comportamiento global intacto ───
  const cart501 = Array.from({ length: 501 }, () => ({ id: 2, quantity: 1, price: 10, finalPrice: 10 }));
  g = await post("/api/sales", payloadFor({ cart: cart501, total: 5010 }), saleHeaders("tok-desk-ok", "big-1"));
  b = await json(g);
  assert(g.status === 400 && b.code === "INVALID_PAYLOAD", "501 líneas → 400 INVALID_PAYLOAD (tope MAX_CART_LINES)");

  g = await fetch(`${BASE}/api/health`);
  b = await json(g);
  assert(g.status === 200 && b.success === true, "GET /api/health intacto (parser global sin cambios)");

  // ─── 8. Concurrencia multi-proceso en el núcleo (2 conexiones independientes) ───
  {
    const cdb = new Database(DB_CORE);
    buildSchema(cdb);
    cdb.prepare("INSERT INTO cashiers (id, name, role, pin, is_active) VALUES (1, 'Ana', 'cashier', '', 1)").run();
    cdb.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1, '001', 'Leche', 8, 1, 'piece')").run();
    cdb.prepare("INSERT INTO cash_register (id, date, status, cashier_id) VALUES (1, date('now'), 'open', 1)").run();
    cdb.close();

    const electron = path.join(REPO, "node_modules", "electron", "dist", "electron.exe");
    const child = () => new Promise((resolve) => {
      const p = spawn(electron, [path.join(__dirname, "harness-2c-api-child.cjs"), better, path.join(REPO, "src/main"), DB_CORE], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      // PASO 3: el stderr de los hijos YA NO se descarta.
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => resolve({ out: out.trim(), err: err.trim(), code }));
    });
    const [r1, r2] = await Promise.all([child(), child()]);
    const parse = (r) => (r.out ? JSON.parse(r.out) : { ok: false });
    const o1 = parse(r1);
    const o2 = parse(r2);
    assert(o1.ok && o2.ok, "núcleo multi-proceso: 2 conexiones venden la última unidad", `a=${r1.out} b=${r2.out}`);
    results.push(`  · hijo A (pid ${o1.pid || "?"}) exit=${r1.code} stderr="${r1.err || ""}"`);
    results.push(`  · hijo B (pid ${o2.pid || "?"}) exit=${r2.code} stderr="${r2.err || ""}"`);
    assert(r1.err === "" && r2.err === "", "hijos multi-proceso sin stderr", `A="${r1.err}" B="${r2.err}"`);
    const coreDb = new Database(DB_CORE);
    const finalStock = coreDb.prepare("SELECT stock FROM products WHERE id = 1").get().stock;
    coreDb.close();
    assert(finalStock === -1, `núcleo multi-proceso: stock exacto ${finalStock}`);
  }

  console.log("\n=== Entrega 2c-B · Harness HTTP real (scripts/) ===");
  for (const r of results) console.log(r);
  console.log(`\n[2cB] ${failed === 0 ? "OK" : "FAIL"} · fallos=${failed} de ${results.filter((r) => r.startsWith("✓") || r.startsWith("✗")).length}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
});
