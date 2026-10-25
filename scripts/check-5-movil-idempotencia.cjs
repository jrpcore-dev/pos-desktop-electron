"use strict";
/*
 * Escrituras de la app móvil con Idempotency-Key.
 *
 *   - un reenvío con la misma clave (respuesta perdida) NO vuelve a sumar stock
 *     y devuelve la respuesta original con `idempotent-replay: true`;
 *   - la misma clave con otro cuerpo → 422 y no toca nada;
 *   - sin clave sigue funcionando como antes (apps viejas);
 *   - un 4xx no consume la clave: se puede corregir y reenviar;
 *   - aplica a stock, lote, alta de producto y deshacer.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-5-movil-idempotencia.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-5-movil-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3526;
const BASE = `http://127.0.0.1:${PORT}`;
const DEVICE = "mobile-1";

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

const db = fixture.createFileDb(path.join(TMP, "movil.db"));
const p = hashPin("1234");
db.prepare(
  "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','admin','',1,?,?)",
).run(p.hash, p.salt);
db.prepare(
  "INSERT INTO products (id, barcode, name, price, stock, sale_unit, cost_price) VALUES (1,'001','Leche',8,100,'piece',5)",
).run();
db.prepare(
  "INSERT INTO products (id, barcode, name, price, stock, sale_unit, cost_price) VALUES (2,'002','Pan',3,50,'piece',1)",
).run();
activation.registerPairing(db, {
  deviceId: DEVICE,
  deviceName: DEVICE,
  token: `tok-${DEVICE}`,
  cashierId: 1,
  deviceType: "mobile",
  approved: 1,
});

let token = null;
const req = async (method, url, { key, body, device = DEVICE } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "x-device-id": device,
      "x-device-token": `tok-${device}`,
      ...(token ? { authorization: token } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data, replay: res.headers.get("idempotent-replay") === "true" };
};
const stockOf = (id) => db.prepare("SELECT stock FROM products WHERE id = ?").get(id).stock;
const movementsOf = (id) =>
  db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?").get(id).c;

(async () => {
  console.log("=== 5 · idempotencia de escrituras del móvil ===");
  const started = await apiServer.startServer(db, PORT);
  check(started.success === true, "startServer arranca", started.error);

  const login = await req("POST", "/api/auth", { body: { id: 1, pin: "1234" } });
  token = login.data && login.data.token;
  check(login.status === 200 && !!token, "login del móvil", JSON.stringify(login.data));

  // 1 · stock: el reenvío no duplica
  const body = { quantity: 5, cost: 0, notes: "", registerExpense: false };
  let r = await req("PATCH", "/api/products/1/stock", { key: "k-stock-1", body });
  check(r.status === 200 && stockOf(1) === 105, "PATCH stock con clave aplica una vez", `${r.status} stock=${stockOf(1)}`);
  check(!r.replay, "la primera respuesta no es replay");
  r = await req("PATCH", "/api/products/1/stock", { key: "k-stock-1", body });
  check(r.status === 200 && r.replay, "reenvío con la misma clave → 200 replay", `${r.status} replay=${r.replay}`);
  check(stockOf(1) === 105 && movementsOf(1) === 1, "el reenvío NO vuelve a sumar ni a registrar movimiento", `stock=${stockOf(1)} mov=${movementsOf(1)}`);
  check(r.data && r.data.product && r.data.product.stock === 105, "el replay devuelve el producto original", JSON.stringify(r.data));

  // 2 · misma clave, otro cuerpo → conflicto
  r = await req("PATCH", "/api/products/1/stock", { key: "k-stock-1", body: { ...body, quantity: 9 } });
  check(r.status === 422 && r.data.code === "IDEMPOTENCY_CONFLICT", "misma clave con otra cantidad → 422", `${r.status} ${JSON.stringify(r.data)}`);
  check(stockOf(1) === 105, "el conflicto no toca el stock", `stock=${stockOf(1)}`);

  // 3 · sin clave: comportamiento de siempre (apps viejas)
  r = await req("PATCH", "/api/products/1/stock", { body });
  await req("PATCH", "/api/products/1/stock", { body });
  check(r.status === 200 && stockOf(1) === 115, "sin clave cada petición aplica (compatibilidad)", `stock=${stockOf(1)}`);

  // 4 · un 4xx no consume la clave
  r = await req("PATCH", "/api/products/1/stock", { key: "k-stock-bad", body: { ...body, quantity: -1 } });
  check(r.status === 400, "cantidad inválida → 400", String(r.status));
  r = await req("PATCH", "/api/products/1/stock", { key: "k-stock-bad", body: { ...body, quantity: -1 } });
  check(r.status === 400 && !r.replay, "el 400 no se guardó: se vuelve a validar", `${r.status} replay=${r.replay}`);

  // 5 · la clave es por dispositivo
  activation.registerPairing(db, {
    deviceId: "mobile-2",
    deviceName: "mobile-2",
    token: "tok-mobile-2",
    cashierId: 1,
    deviceType: "mobile",
    approved: 1,
  });
  const ownToken = token;
  const login2 = await req("POST", "/api/auth", { body: { id: 1, pin: "1234" }, device: "mobile-2" });
  token = login2.data && login2.data.token;
  r = await req("PATCH", "/api/products/1/stock", { key: "k-stock-1", body, device: "mobile-2" });
  check(r.status === 200 && !r.replay && stockOf(1) === 120, "otro teléfono con la misma clave no choca", `${r.status} stock=${stockOf(1)}`);
  token = ownToken;

  // 6 · lote
  const items = [
    { product_id: 1, quantity: 2, cost: "", notes: "Recepción en lote" },
    { product_id: 2, quantity: 3, cost: "", notes: "Recepción en lote" },
  ];
  r = await req("POST", "/api/products/stock/batch", { key: "k-batch-1", body: { items } });
  check(r.status === 200 && r.data.applied === 2, "lote con clave aplica", JSON.stringify(r.data).slice(0, 120));
  r = await req("POST", "/api/products/stock/batch", { key: "k-batch-1", body: { items } });
  check(r.status === 200 && r.replay, "reenvío del lote → replay", `${r.status} replay=${r.replay}`);
  check(stockOf(1) === 122 && stockOf(2) === 53, "el lote se aplicó una sola vez", `leche=${stockOf(1)} pan=${stockOf(2)}`);

  // 7 · alta de producto sin código (antes podía duplicarse)
  const prod = { barcode: null, name: "Tortillas", cost_price: 10, price: 14, sale_unit: "weight", stock: 0, box_qty: 0, box_price: 0 };
  r = await req("POST", "/api/products", { key: "k-prod-1", body: prod });
  check(r.status === 200 && r.data.product, "alta con clave crea el producto", JSON.stringify(r.data).slice(0, 120));
  r = await req("POST", "/api/products", { key: "k-prod-1", body: prod });
  const count = db.prepare("SELECT COUNT(*) c FROM products WHERE name = 'Tortillas'").get().c;
  check(r.status === 200 && r.replay && count === 1, "reenvío del alta no duplica el producto", `${r.status} replay=${r.replay} count=${count}`);

  // 8 · deshacer: el reenvío devuelve éxito, no "no encontrado"
  const mov = db
    .prepare("SELECT id FROM stock_movements WHERE product_id = 2 ORDER BY id DESC LIMIT 1")
    .get();
  r = await req("DELETE", `/api/stock/movements/${mov.id}`, { key: `undo-${mov.id}` });
  check(r.status === 200 && stockOf(2) === 50, "deshacer con clave", `${r.status} pan=${stockOf(2)}`);
  r = await req("DELETE", `/api/stock/movements/${mov.id}`, { key: `undo-${mov.id}` });
  check(r.status === 200 && r.replay && stockOf(2) === 50, "reenvío de deshacer → replay, no 404 ni doble resta", `${r.status} replay=${r.replay} pan=${stockOf(2)}`);

  // 9 · caja·paquete·pieza ("boxpack"): la búsqueda trae los datos del paquete
  // y el costo de una recepción sin costo capturado se calcula por caja.
  db.prepare(
    `INSERT INTO products (id, barcode, name, price, stock, sale_unit, cost_price, box_qty, box_price, pack_qty, pack_price)
     VALUES (50,'050','Galletas',35,0,'boxpack',240,60,300,6,7)`,
  ).run();
  r = await req("GET", "/api/products/search?q=Galletas");
  const found = r.data && r.data.products && r.data.products[0];
  check(!!found && found.pack_qty === 6 && found.pack_price === 7, "la búsqueda devuelve pack_qty y pack_price", JSON.stringify(found));
  r = await req("PATCH", "/api/products/50/stock", { key: "k-boxpack", body: { quantity: 18, cost: 0, notes: "", registerExpense: false } });
  const bpMov = db.prepare("SELECT cost FROM stock_movements WHERE product_id = 50 ORDER BY id DESC LIMIT 1").get();
  check(r.status === 200 && stockOf(50) === 18, "boxpack: 3 paquetes (18 pz) suman 18 piezas", `${r.status} stock=${stockOf(50)}`);
  check(!!bpMov && Math.abs(bpMov.cost - 72) < 0.001, "boxpack: costo = $240/caja ÷ 60 × 18 = $72", JSON.stringify(bpMov));
  check(r.data && r.data.product && r.data.product.pack_qty === 6, "la respuesta del stock incluye pack_qty", JSON.stringify(r.data && r.data.product));

  await apiServer.stopServer();
  db.close();

  console.log(`\n[check-5-movil-idempotencia] ${fail === 0 ? "OK" : "FALLÓ"} · pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  try { apiServer.stopServer(); } catch (err) {}
  process.exit(1);
});
