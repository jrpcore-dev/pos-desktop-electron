"use strict";
/*
 * Fase 1 · seguridad del Host en multicaja.
 *
 *   - /api/rpc: un cajero NO admin no puede administrar cajeros ni ajustes;
 *     ni siquiera un admin puede escribir ajustes de identidad/respaldo;
 *   - un dispositivo revocado que vuelve con el código queda PENDIENTE, y una
 *     caja no se vuelve "móvil aprobado" re-emparejándose como móvil;
 *   - el snapshot de cajeros no lleva hash de PIN a un celular (sí a una caja);
 *   - la sesión va ligada al aparato y muere al desactivar al cajero;
 *   - /api/sales rechaza un total que no cuadra con las líneas;
 *   - la cola offline no puede firmar ventas a nombre de un cajero ajeno;
 *   - el PIN sin conexión se bloquea tras 5 intentos.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-1-security.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const ipcRegistry = require(path.join(REPO, "src/main/ipc-registry.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const PORT = 3521;
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

const db = fixture.createMemoryDb();
const pinOf = (pin) => hashPin(pin);
const addCashier = (id, name, role, pin) => {
  const p = pinOf(pin);
  db.prepare(
    "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (?, ?, ?, '', 1, ?, ?)",
  ).run(id, name, role, p.hash, p.salt);
};
addCashier(1, "Ana", "cashier", "1111");
addCashier(2, "Dueño", "admin", "2222");
addCashier(3, "Beto", "cashier", "3333");
db.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1, '001', 'Leche', 8, 50, 'piece')").run();

activation.registerPairing(db, { deviceId: "box-a", deviceName: "Caja A", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.registerPairing(db, { deviceId: "phone-1", deviceName: "Cel", token: "tok-p", deviceType: "mobile", approved: 1 });
db.prepare(
  "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'box-a')",
).run();

// Handlers falsos: lo que importa es si /api/rpc los deja pasar.
const calls = [];
for (const ch of ["add-cashier", "save-setting", "get-sales-for-today"]) {
  ipcRegistry.set(ch, (e, ...args) => {
    calls.push([ch, ...args]);
    return { success: true };
  });
}

const req = async (method, url, { headers = {}, body } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
};
const login = async (deviceId, id, pin) =>
  (await req("POST", "/api/auth", { headers: { "x-device-id": deviceId }, body: { id, pin } })).data.token;
const boxHeaders = (token, extra = {}) => ({
  authorization: token,
  "x-device-id": "box-a",
  "x-device-token": "tok-a",
  ...extra,
});
const rpc = (token, channel, args) =>
  req("POST", "/api/rpc", { headers: boxHeaders(token), body: { channel, args } });

(async () => {
  const started = await apiServer.startServer(db, PORT);
  check(started.success === true, "startServer arranca", started.error);

  console.log("=== 1.1/1.2 · rol y ajustes en /api/rpc ===");
  const ana = await login("box-a", 1, "1111");
  const owner = await login("box-a", 2, "2222");
  let r = await rpc(ana, "add-cashier", [{ name: "Intruso", pin: "9999", role: "admin" }]);
  check(r.status === 403 && r.data.code === "FORBIDDEN", "cajero normal → add-cashier 403", JSON.stringify(r));
  r = await rpc(ana, "save-setting", ["store_name", "X"]);
  check(r.status === 403 && r.data.code === "FORBIDDEN", "cajero normal → save-setting 403", JSON.stringify(r));
  r = await rpc(ana, "get-sales-for-today", []);
  check(r.status === 200 && r.data.success === true, "cajero normal → canal de caja sigue permitido", JSON.stringify(r));
  r = await rpc(owner, "add-cashier", [{ name: "Nuevo", pin: "4444" }]);
  check(r.status === 200 && r.data.success === true, "admin → add-cashier permitido", JSON.stringify(r));
  r = await rpc(owner, "save-setting", ["store_name", "Mi tienda"]);
  check(r.status === 200, "admin → ajuste de negocio permitido", JSON.stringify(r));
  r = await rpc(owner, "save-setting", ["backup_receiver_device_id", "box-a"]);
  check(r.status === 403 && r.data.code === "SETTING_NOT_ALLOWED", "admin → backup_receiver_device_id 403", JSON.stringify(r));
  check(
    !calls.some((c) => c[0] === "save-setting" && c[1] === "backup_receiver_device_id") &&
      !calls.some((c) => c[0] === "add-cashier" && c[1] && c[1].name === "Intruso"),
    "ningún handler rechazado llegó a ejecutarse",
  );

  console.log("=== 1.3 · re-emparejar ===");
  activation.revokeDevice(db, "box-a");
  activation.registerPairing(db, { deviceId: "box-a", deviceName: "Caja A", token: "tok-a2", deviceType: "mobile", approved: 1, scopes: ["catalog:read"] });
  let row = db.prepare("SELECT device_type, approved, revoked FROM paired_devices WHERE device_id = 'box-a'").get();
  check(row.approved === 0 && row.revoked === 0, "revocado + código → pendiente de aprobación", JSON.stringify(row));
  check(row.device_type === "desktop_box", "una caja re-emparejada como móvil sigue siendo caja", JSON.stringify(row));
  const sc = activation.deviceScopes(db, "box-a");
  check(sc.approved === false && sc.scopes.length === 0, "pendiente → sin scopes", JSON.stringify(sc));
  activation.approveDevice(db, "box-a");
  db.prepare("UPDATE paired_devices SET paired_token_hash = ? WHERE device_id = 'box-a'").run(activation.hashToken("tok-a"));
  check(activation.deviceScopes(db, "box-a").approved === true, "el admin la aprueba y vuelve a operar");
  activation.registerPairing(db, { deviceId: "box-a", deviceName: "Caja A", token: "tok-a3", deviceType: "desktop_box", approved: 0 });
  check(
    db.prepare("SELECT approved FROM paired_devices WHERE device_id = 'box-a'").get().approved === 0,
    "una caja aprobada que se re-empareja con código vuelve a quedar pendiente",
  );
  activation.approveDevice(db, "box-a");
  db.prepare("UPDATE paired_devices SET paired_token_hash = ? WHERE device_id = 'box-a'").run(activation.hashToken("tok-a"));

  console.log("=== 1.4 · hash de PIN sólo a cajas ===");
  const snap = (id, token) =>
    req("GET", "/api/replica/snapshot?table=cashiers", { headers: { "x-device-id": id, "x-device-token": token } });
  r = await snap("phone-1", "tok-p");
  check(r.status === 200 && r.data.rows.length > 0 && r.data.rows.every((c) => c.pin_hash === null && c.pin_salt === null),
    "celular: snapshot de cajeros sin pin_hash/pin_salt", JSON.stringify(r.data && r.data.rows && r.data.rows[0]));
  r = await snap("box-a", "tok-a");
  check(r.status === 200 && r.data.rows.some((c) => typeof c.pin_hash === "string" && c.pin_hash.length > 0),
    "caja: snapshot de cajeros con pin_hash (login sin red)", r.status);

  console.log("=== 1.5/1.6 · sesión y cajero ===");
  const anaBox = await login("box-a", 1, "1111");
  r = await req("POST", "/api/rpc", {
    headers: { ...boxHeaders(anaBox), "x-device-id": "phone-1", "x-device-token": "tok-p" },
    body: { channel: "get-sales-for-today", args: [] },
  });
  check(r.status === 401 || r.status === 403, "token de la caja usado desde otro aparato → rechazado", r.status);
  const sale = (token, key, body) =>
    req("POST", "/api/sales", { headers: boxHeaders(token, { "idempotency-key": key }), body });
  r = await sale(anaBox, "t1", { cart: [{ id: 1, quantity: 2, price: 8, finalPrice: 8 }], total: 1, paymentMethod: "card" });
  check(r.status === 400 && r.data.code === "TOTAL_MISMATCH", "total que no cuadra → 400 TOTAL_MISMATCH", JSON.stringify(r.data));
  r = await sale(anaBox, "t2", { cart: [{ id: 1, quantity: 2, price: 8, finalPrice: 8 }], total: 16, paymentMethod: "cash" });
  check(r.status === 200 && r.data.success === true, "total correcto → 200", JSON.stringify(r.data));
  r = await sale(anaBox, "t3", { cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8, discount_percent: 150 }], total: 8, paymentMethod: "cash" });
  check(r.status === 400 && r.data.code === "INVALID_DISCOUNT", "descuento > 100% → 400", JSON.stringify(r.data));
  // Beto (3) nunca inició sesión en box-a: la cola no puede firmar a su nombre.
  r = await sale(anaBox, "t4", {
    cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }], total: 8, paymentMethod: "cash",
    offline: true, cashier_id: 3, register_id: 1, folio: "A-000050",
  });
  const who = r.data && r.data.saleId ? db.prepare("SELECT cashier_name FROM sales WHERE id = ?").get(r.data.saleId) : null;
  check(r.status === 200 && who && who.cashier_name === "Ana" &&
      r.data.warnings.some((w) => w.code === "CASHIER_UNVERIFIED"),
    "cola: cajero ajeno sin sesión en la caja → queda a nombre de la sesión + aviso", JSON.stringify({ r: r.data, who }));
  // El dueño sí inició sesión en box-a: su venta offline conserva su nombre.
  r = await sale(anaBox, "t5", {
    cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }], total: 8, paymentMethod: "cash",
    offline: true, cashier_id: 2, register_id: 1, folio: "A-000051",
  });
  const who2 = r.data && r.data.saleId ? db.prepare("SELECT cashier_name FROM sales WHERE id = ?").get(r.data.saleId) : null;
  check(r.status === 200 && who2 && who2.cashier_name === "Dueño", "cola: cajero con sesión previa en la caja → se respeta", JSON.stringify(who2));
  db.prepare("UPDATE cashiers SET is_active = 0 WHERE id = 1").run();
  r = await rpc(anaBox, "get-sales-for-today", []);
  check(r.status === 401, "cajero desactivado → su sesión deja de servir (401)", r.status);
  db.prepare("UPDATE cashiers SET is_active = 1 WHERE id = 1").run();

  await apiServer.stopServer();

  console.log("=== 1.4 · PIN sin conexión ===");
  // Caja sin Host configurado: verifyPin cae al PIN cacheado.
  const boxDb = fixture.createMemoryDb();
  const p = pinOf("1111");
  boxDb.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'cashier', '', 1, ?, ?)").run(p.hash, p.salt);
  let last = null;
  for (let i = 0; i < 5; i++) last = await boxRpc.verifyPin(boxDb, 1, "0000");
  check(last && last.code === "PIN_INVALID", "5 PIN malos → PIN_INVALID", JSON.stringify(last));
  last = await boxRpc.verifyPin(boxDb, 1, "1111");
  check(last && last.code === "PIN_LOCKED", "tras 5 fallos, incluso el PIN bueno queda bloqueado", JSON.stringify(last));
  boxDb.prepare("UPDATE settings SET value = ? WHERE key = 'offline_pin_attempts'").run(JSON.stringify({ 1: { count: 0, lockedUntil: Date.now() - 1 } }));
  last = await boxRpc.verifyPin(boxDb, 1, "1111");
  check(last && last.success === true, "pasado el bloqueo, el PIN bueno entra", JSON.stringify(last));

  console.log(`\n=== Fase 1: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
});
