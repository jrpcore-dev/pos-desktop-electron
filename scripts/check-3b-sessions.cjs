"use strict";
/*
 * ENTREGA 3b · sesiones persistidas (box_sessions).
 *
 *   - el token sobrevive a parar/arrancar el servidor sobre la MISMA BD;
 *   - en la BD solo vive su sha256 (nunca el token en claro);
 *   - vencida → 401; revocada → 401; 401 ≠ 403;
 *   - mismo contrato para todos los tipos de dispositivo;
 *   - un login nuevo revoca la sesión anterior del mismo (caja, dispositivo);
 *   - last_used_at con throttle de 5 min; poda de vencidas al arrancar.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3b-sessions.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const Database = fixture.Database;
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3b-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3508;
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

const db = fixture.createFileDb(path.join(TMP, "sessions.db"));
const p = hashPin("1234");
db.prepare(
  "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','admin','',1,?,?)",
).run(p.hash, p.salt);
db.prepare(
  "INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1,'001','Leche',8,100,'piece')",
).run();
for (const [id, type] of [["mobile-1", "mobile"], ["box-1", "desktop_box"]]) {
  activation.registerPairing(db, {
    deviceId: id,
    deviceName: id,
    token: `tok-${id}`,
    cashierId: 1,
    deviceType: type,
    approved: 1,
  });
}

const req = async (method, url, { token, headers = {}, body } = {}) => {
  // Fase 1 · la sesión va ligada al aparato: como un cliente real, se manda
  // el x-device-id con el que se hizo login (salvo que la prueba fije otro).
  const own = token ? sessionOf(token) : null;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(own && own.device_id ? { "x-device-id": own.device_id } : {}),
      ...(token ? { authorization: token } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
};
const login = (headers = {}, body = { id: 1, pin: "1234" }) =>
  req("POST", "/api/auth", { body, headers });
const sessionOf = (token) =>
  db.prepare("SELECT * FROM box_sessions WHERE token_hash = ?").get(activation.hashToken(token));
const ALL_COLUMNS = () => JSON.stringify(db.prepare("SELECT * FROM box_sessions").all());

(async () => {
  console.log("=== 3b · sesiones persistidas ===");
  let started = await apiServer.startServer(db, PORT);
  check(started.success === true, "startServer arranca", started.error);

  // 1 · login sin dispositivo
  let r = await login();
  const A = r.data.token;
  check(r.status === 200 && !!A, "POST /api/auth → 200 + token", JSON.stringify(r.data));
  const rowA = sessionOf(A);
  check(!!rowA, "la sesión queda registrada en box_sessions");

  // 2 · el token nunca se guarda en claro
  check(
    !!rowA && rowA.token_hash === activation.hashToken(A) && rowA.token_hash !== A,
    "en la BD vive el sha256, no el token",
    JSON.stringify(rowA),
  );
  check(
    !!rowA && /^[0-9a-f]{64}$/.test(rowA.token_hash),
    "hash de 64 hex (sha-256)",
    rowA && rowA.token_hash,
  );
  check(!ALL_COLUMNS().includes(A), "ninguna fila contiene el token en claro");
  check(rowA.device_id === null, "login sin x-device-id → device_id NULL", String(rowA.device_id));
  check(rowA.revoked === 0 && rowA.expires_at > Date.now(), "sesión viva y no revocada");

  // 3 · el token sirve
  r = await req("GET", "/api/products/search?q=coca", { token: A });
  check(r.status === 200, "GET con el token → 200", JSON.stringify(r.data).slice(0, 120));

  // 4 · reiniciar el servidor sobre la MISMA BD ya no desloguea
  apiServer.stopServer();
  started = await apiServer.startServer(db, PORT);
  check(started.success === true, "servidor arrancado otra vez");
  r = await req("GET", "/api/products/search?q=coca", { token: A });
  check(r.status === 200, "token válido tras parar/arrancar el servidor", JSON.stringify(r.data).slice(0, 120));

  // 5 · un login nuevo revoca la sesión anterior del mismo (caja, dispositivo)
  const M1 = (await login({ "x-device-id": "mobile-1" })).data.token;
  const M2 = (await login({ "x-device-id": "mobile-1" })).data.token;
  check(!!M1 && !!M2 && M1 !== M2, "dos logins del mismo dispositivo → dos tokens distintos");
  r = await req("GET", "/api/products/search?q=coca", { token: M1 });
  check(r.status === 401, "el token anterior del móvil queda revocado (401)", String(r.status));
  r = await req("GET", "/api/products/search?q=coca", { token: M2 });
  check(r.status === 200, "el token nuevo del móvil sigue vivo (200)", String(r.status));
  const rowM2 = sessionOf(M2);
  check(rowM2 && rowM2.device_id === "mobile-1" && rowM2.device_type === "mobile",
    "la sesión guarda device_id y device_type", JSON.stringify(rowM2));

  // 6 · mismo contrato para otro tipo de dispositivo (mismo header)
  const B1 = (await login({ "x-device-id": "box-1" })).data.token;
  r = await req("GET", "/api/products/search?q=coca", { token: B1 });
  check(r.status === 200, "la caja de escritorio usa el MISMO header → 200", String(r.status));
  const rowB1 = sessionOf(B1);
  check(rowB1 && rowB1.device_type === "desktop_box", "device_type de la caja = desktop_box", JSON.stringify(rowB1));
  check(sessionOf(M2).revoked === 0, "la sesión del móvil NO se toca al entrar la caja");

  // 7 · 401 ≠ 403 (scope nuevo con dispositivo NO emparejado en la petición)
  const SP = (await login({ "x-device-id": "sin-par" })).data.token;
  r = await req("POST", "/api/sales", { token: SP, headers: { "x-device-id": "sin-par", "x-device-token": "tok-sin-par" }, body: {} });
  const sinScope403 = r.status;
  check(sinScope403 === 403, "scope nuevo con dispositivo sin emparejar → 403 (no 401)", String(sinScope403));

  // 8 · vencida → 401 (y antes que el scope: 401, no 403)
  db.prepare("UPDATE box_sessions SET expires_at = ? WHERE token_hash = ?").run(
    Date.now() - 1000,
    activation.hashToken(A),
  );
  r = await req("GET", "/api/products/search?q=coca", { token: A });
  check(r.status === 401 && r.data.error === "Sesión expirada", "token vencido → 401 «Sesión expirada»", JSON.stringify(r.data));
  r = await req("POST", "/api/sales", { token: A, body: {} });
  check(r.status === 401, "token vencido en un scope nuevo → 401 (no 403)", String(r.status));
  // Se conserva (revocada) 30 días: /api/sales la usa para verificar al
  // cajero de las ventas de la cola offline.
  check(sessionOf(A) && sessionOf(A).revoked === 1, "la sesión vencida queda revocada en box_sessions");

  // 9 · revocada → 401
  db.prepare("UPDATE box_sessions SET revoked = 1 WHERE token_hash = ?").run(activation.hashToken(B1));
  r = await req("GET", "/api/products/search?q=coca", { token: B1 });
  check(r.status === 401 && r.data.error === "No autorizado", "token revocado → 401", JSON.stringify(r.data));

  // 10 · sesión vigente en un scope nuevo vende en SU caja
  const B2 = (await login({ "x-device-id": "box-1" })).data.token;
  db.prepare(
    "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (21, date('now'), 'open', 1, 'box-1')",
  ).run();
  r = await req("POST", "/api/sales", {
    token: B2,
    headers: { "x-device-id": "box-1", "x-device-token": "tok-box-1", "idempotency-key": "b3b-1" },
    body: {
      cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }],
      total: 8,
      paymentMethod: "cash",
      discountTotal: 0,
    },
  });
  check(r.status === 200, "sesión persistida vende en /api/sales → 200", JSON.stringify(r.data).slice(0, 140));

  // 11 · last_used_at con throttle de 5 minutos
  const rowB2a = sessionOf(B2);
  check(rowB2a.last_used_at === rowB2a.created_at, "primer uso: last_used_at = created_at",
    JSON.stringify({ last: rowB2a.last_used_at, created: rowB2a.created_at }));
  await req("GET", "/api/products/search?q=coca", { token: B2 });
  const rowB2b = sessionOf(B2);
  check(rowB2b.last_used_at === rowB2a.last_used_at, "dentro de 5 min NO se reescribe last_used_at",
    JSON.stringify({ antes: rowB2a.last_used_at, despues: rowB2b.last_used_at }));
  db.prepare("UPDATE box_sessions SET last_used_at = ? WHERE token_hash = ?").run(
    Date.now() - 6 * 60 * 1000,
    activation.hashToken(B2),
  );
  await req("GET", "/api/products/search?q=coca", { token: B2 });
  const rowB2c = sessionOf(B2);
  check(rowB2c.last_used_at > Date.now() - 5 * 60 * 1000, "pasados 5 min se actualiza last_used_at",
    JSON.stringify({ last: rowB2c.last_used_at }));

  // 12 · el mismo contrato para todos los tipos: móvil expirado también da 401
  db.prepare("UPDATE box_sessions SET expires_at = ? WHERE token_hash = ?").run(
    Date.now() - 1,
    activation.hashToken(M2),
  );
  r = await req("GET", "/api/products/search?q=coca", { token: M2 });
  check(r.status === 401, "móvil expirado → 401 (igual que la caja)", String(r.status));

  // 13 · poda de vencidas al arrancar
  db.prepare(
    `INSERT INTO box_sessions (token_hash, cashier_id, device_id, device_type, created_at, expires_at, last_used_at, revoked)
     VALUES ('vencida-hash', 1, 'box-1', 'desktop_box', ?, ?, ?, 0)`,
  ).run(
    Date.now() - 32 * 24 * 60 * 60 * 1000,
    Date.now() - 31 * 24 * 60 * 60 * 1000,
    Date.now() - 31 * 24 * 60 * 60 * 1000,
  );
  apiServer.stopServer();
  started = await apiServer.startServer(db, PORT);
  check(started.success === true, "servidor arrancado para la poda");
  check(db.prepare("SELECT COUNT(*) c FROM box_sessions WHERE token_hash = 'vencida-hash'").get().c === 0,
    "la sesión vencida hace >30 días se poda al arrancar");
  check(!!sessionOf(B2), "las sesiones vivas NO se podan");

  await apiServer.stopServer();
  db.close();

  console.log(`\n[check-3b-sessions] ${fail === 0 ? "OK" : "FALLÓ"} · pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  try { apiServer.stopServer(); } catch (err) {}
  process.exit(1);
});
