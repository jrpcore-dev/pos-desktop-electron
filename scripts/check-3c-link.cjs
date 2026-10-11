"use strict";
/*
 * ENTREGA 3c · descubrimiento y emparejamiento de una caja.
 *
 *   A) /api/health declara protocolo; /api/activation/info público mínimo;
 *      /api/activation/status autenticado por headers de emparejamiento.
 *   B) /api/activation/pair: desktop_box pendiente, device_code único A,B,C…
 *      (la H queda reservada al Host), el código se exige SIEMPRE, rate limit.
 *   C) client-link: descubrimiento UDP en loopback, IP manual, emparejamiento
 *      correcto/incorrecto/rate limit, sondeo de aprobación, revocación y
 *      rechazo cuando responde otro Host (dos Hosts en la red).
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3c-link.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const protocol = require(path.join(REPO, "src/main/protocol.js"));
const discovery = require(path.join(REPO, "src/main/discovery.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3c-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT_A = 3510;
const PORT_B = 3511;
const PORT_FAKE = 3512;
const URL_A = `http://127.0.0.1:${PORT_A}`;
const URL_B = `http://127.0.0.1:${PORT_B}`;

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

const seedCashier = (db) => {
  const p = hashPin("1234");
  db.prepare(
    "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','admin','',1,?,?)",
  ).run(p.hash, p.salt);
};

const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
};
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
};

const dbA = fixture.createFileDb(path.join(TMP, "hostA.db"));
seedCashier(dbA);
const hostIdA = activation.getSetting(dbA, "host_device_id") || null;

const dbBox1 = fixture.createFileDb(path.join(TMP, "box1.db")); // código inválido
const dbBox2 = fixture.createFileDb(path.join(TMP, "box2.db")); // empareja OK
const dbBox3 = fixture.createFileDb(path.join(TMP, "box3.db")); // segunda caja
const codeA = activation.getActivationCode(dbA);

// Cifrador de prueba: fuera de Electron no hay safeStorage (main.js lo inyecta
// en la app real). Marca los valores para probar que el token JAMÁS se guarda
// en claro en settings.
const testCipher = {
  available: () => true,
  encrypt: (plain) => Buffer.from("T:" + plain, "utf8").toString("base64"),
  decrypt: (b64) => Buffer.from(String(b64), "base64").toString("utf8").slice(2),
};
clientLink.setSecretCipher(testCipher);

(async () => {
  console.log("=== 3c · descubrimiento y emparejamiento ===");
  const started = await apiServer.startServer(dbA, PORT_A, { appVersion: "9.9.9-check" });
  check(started.success === true, "Host A arranca", started.error);

  // ─── A · health / info / status ──────────────────────────────────────────
  let r = await get(`${URL_A}/api/health`);
  check(r.status === 200 && r.data.success === true && r.data.ok === true, "/api/health conserva success/ok", JSON.stringify(r.data));
  check(
    r.data.protocol_version === protocol.PROTOCOL_VERSION && r.data.min_supported === protocol.MIN_SUPPORTED,
    "/api/health declara protocol_version y min_supported",
    JSON.stringify(r.data),
  );

  r = await get(`${URL_A}/api/activation/info`);
  check(r.status === 200, "/api/activation/info es público (sin headers)", String(r.status));
  check(
    r.data.protocol_version === protocol.PROTOCOL_VERSION &&
      r.data.min_supported === protocol.MIN_SUPPORTED &&
      r.data.app_version === "9.9.9-check" &&
      !!r.data.host_device_id,
    "/api/activation/info devuelve protocolo, versión y host_device_id",
    JSON.stringify(r.data),
  );
  check(Object.keys(r.data).sort().join(",") === "app_version,host_device_id,min_supported,protocol_version,success",
    "/api/activation/info es el mínimo pedido", JSON.stringify(Object.keys(r.data)));

  r = await get(`${URL_A}/api/activation/status`);
  check(r.status === 403, "/api/activation/status sin headers → 403", String(r.status));

  // ─── B · pair: código exigido siempre, rate limit, desktop_box ───────────
  check(activation.isEnabled(dbA) === false, "el candado de activación está APAGADO en el Host A");
  r = await post(`${URL_A}/api/activation/pair`, { deviceId: "box-x", deviceName: "X" });
  check(r.status === 400, "pair sin código → 400 (el código se exige siempre)", String(r.status));

  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: clientLink.ensureBoxDeviceId(dbBox1),
    deviceName: "Caja 1",
    code: "CODIGO-MALO",
    deviceType: "desktop_box",
    protocol_version: protocol.PROTOCOL_VERSION,
  });
  check(r.status === 401 && r.data.code === "PAIR_CODE_INVALID", "código incorrecto → 401 PAIR_CODE_INVALID", JSON.stringify(r.data));
  check(r.data.attempts_left === 4 && r.data.retry_after_ms === activation.PAIR_RATE_WINDOW_MS,
    "el 401 informa intentos restantes y ventana", JSON.stringify(r.data));
  const box1Id = clientLink.ensureBoxDeviceId(dbBox1);
  let last401 = null;
  for (let i = 0; i < 4; i++) {
    last401 = await post(`${URL_A}/api/activation/pair`, {
      deviceId: box1Id, deviceName: "Caja 1", code: "CODIGO-MALO", deviceType: "desktop_box",
    });
  }
  check(last401.status === 401 && last401.data.attempts_left === 0, "el 5º fallo agota los intentos", JSON.stringify(last401.data));
  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: box1Id, deviceName: "Caja 1", code: "CODIGO-MALO", deviceType: "desktop_box",
  });
  check(r.status === 429 && r.data.code === "PAIR_RATE_LIMITED" && r.data.retry_after_ms === activation.PAIR_RATE_WINDOW_MS,
    "tras agotar → 429 PAIR_RATE_LIMITED con retry_after_ms", JSON.stringify(r.data));
  check(dbA.prepare("SELECT COUNT(*) c FROM paired_devices WHERE device_id = ?").get(box1Id).c === 0,
    "un código incorrecto NO empareja");

  // mismatch de protocolo contra el Host A (el Host manda 2.0)
  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: "box-vieja", deviceName: "Vieja", code: codeA, deviceType: "desktop_box", protocol_version: "1.0",
  });
  check(r.status === 426 && r.data.code === "PROTOCOL_MISMATCH", "cliente con protocolo 1.0 → 426 PROTOCOL_MISMATCH", JSON.stringify(r.data));
  check(dbA.prepare("SELECT COUNT(*) c FROM paired_devices WHERE device_id = 'box-vieja'").get().c === 0,
    "con protocolo incompatible NO se empareja");

  // ─── B1 · un celular NO consume letra de caja ────────────────────────────
  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: "mobile-3c", deviceName: "Celular Ana", code: codeA,
  });
  check(r.status === 200 && r.data.approved === true && r.data.pending === false,
    "móvil: se empareja aprobado (comportamiento actual)", JSON.stringify(r.data));
  check(/^D-[0-9A-F]{6}$/.test(r.data.device_code), "móvil recibe código D-… (no letra)", String(r.data.device_code));
  check(!activation.DEVICE_CODE_LETTERS.includes(r.data.device_code),
    "el código del móvil no está en el alfabeto de letras de caja", String(r.data.device_code));
  check(dbA.prepare("SELECT device_type FROM paired_devices WHERE device_id='mobile-3c'").get().device_type === "mobile",
    "el móvil sigue siendo device_type mobile");

  // ─── B2 · emparejamiento correcto: cajas pendientes con código único ────
  const box2Id = clientLink.ensureBoxDeviceId(dbBox2);
  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: box2Id, deviceName: "Caja 2", code: codeA, deviceType: "desktop_box",
    protocol_version: protocol.PROTOCOL_VERSION,
  });
  check(r.status === 200 && r.data.pending === true && r.data.approved === false, "desktop_box → pendiente (approved=false)", JSON.stringify(r.data));
  check(r.data.device_code === "A", "primera caja → device_code «A»", String(r.data.device_code));
  check(r.data.host_device_id && r.data.protocol_version === protocol.PROTOCOL_VERSION, "pair devuelve host_device_id y protocolo", JSON.stringify(r.data));

  const box3Id = clientLink.ensureBoxDeviceId(dbBox3);
  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: box3Id, deviceName: "Caja 3", code: codeA, deviceType: "desktop_box",
    protocol_version: protocol.PROTOCOL_VERSION,
  });
  check(r.data.device_code === "B", "segunda caja → device_code «B»", String(r.data.device_code));

  check(activation.HOST_DEVICE_CODE === "H", "«H» es el código reservado al Host", activation.HOST_DEVICE_CODE);
  check(!activation.DEVICE_CODE_LETTERS.includes(activation.HOST_DEVICE_CODE), "las letras de caja excluyen la H");
  const codes = dbA.prepare("SELECT device_code FROM paired_devices ORDER BY device_code").all().map((x) => x.device_code);
  check(new Set(codes).size === codes.length && !codes.includes("H"), "códigos únicos y sin la H", JSON.stringify(codes));

  // re-emparejar conserva el mismo código
  r = await post(`${URL_A}/api/activation/pair`, {
    deviceId: box2Id, deviceName: "Caja 2", code: codeA, deviceType: "desktop_box",
    protocol_version: protocol.PROTOCOL_VERSION,
  });
  check(r.data.device_code === "A", "re-emparejar conserva el device_code", String(r.data.device_code));

  // ─── A2 · /api/activation/status con headers ────────────────────────────
  const HEAD = { "x-device-id": box2Id, "x-device-token": r.data.pairedToken };
  const tokenBox2 = r.data.pairedToken;
  r = await get(`${URL_A}/api/activation/status`, HEAD);
  check(r.status === 200 && r.data.success === true, "/api/activation/status con headers → 200", JSON.stringify(r.data));
  check(
    r.data.approved === false && r.data.revoked === false && r.data.device_code === "A" &&
      r.data.host_device_id === dbA.prepare("SELECT value FROM settings WHERE key = 'host_device_id'").get().value &&
      r.data.protocol_version === protocol.PROTOCOL_VERSION,
    "status devuelve {approved, revoked, device_code, host_device_id, protocol_version}",
    JSON.stringify(r.data),
  );
  r = await get(`${URL_A}/api/activation/status`, { "x-device-id": box2Id, "x-device-token": "token-malo" });
  check(r.status === 403, "status con token erróneo → 403", String(r.status));

  // ─── C · client-link contra el Host A ───────────────────────────────────
  // La caja 2 se emparejó por HTTP directo: persiste aquí su vínculo (lo que
  // hace pairAsBox) para poder sondear el estado.
  const saved = clientLink.saveSettings(dbBox2, {
    device_role: "client",
    host_url: URL_A,
    host_device_id: activation.getSetting(dbA, "host_device_id"),
    box_device_id: box2Id,
    box_paired_token: tokenBox2, // se ignora: sólo se guarda cifrado
    sync_completed: "0",
    evil: "x",
  });
  check(
    saved.sync_completed === "0" && saved.evil === undefined && saved.box_paired_token === undefined,
    "saveSettings solo acepta claves conocidas y NUNCA el token",
    JSON.stringify(saved),
  );
  const tk = clientLink.savePairedToken(dbBox2, tokenBox2);
  const rawToken = activation.getSetting(dbBox2, "box_paired_token");
  check(tk.persisted === true && rawToken.startsWith(clientLink.TOKEN_ENC_PREFIX), "el token se guarda CIFRADO (enc v1)", String(rawToken).slice(0, 20));
  check(!rawToken.includes(tokenBox2), "en la BD no aparece el token en claro", String(rawToken).slice(0, 20));
  check(clientLink.readPairedToken(dbBox2) === tokenBox2, "readPairedToken devuelve el token original");
  check(clientLink.getSettings(dbBox2).tokenPersisted === true && clientLink.getSettings(dbBox2).box_paired_token === undefined,
    "box-get-settings no expone el token, sólo si existe", JSON.stringify(clientLink.getSettings(dbBox2)));
  let st = await clientLink.linkStatus(dbBox2, { hostUrl: URL_A });
  check(st.success && st.approved === false && st.canSell === false, "linkStatus de la caja: pendiente y sin vender", JSON.stringify(st));
  check(clientLink.canSell(dbBox2) === false, "sin sync_completed → la caja NO vende");

  // aprobación
  activation.approveDevice(dbA, box2Id);
  st = await clientLink.linkStatus(dbBox2, { hostUrl: URL_A });
  check(st.success && st.approved === true, "al aprobar, linkStatus → approved", JSON.stringify(st));
  const wait = await clientLink.waitForApproval(dbBox2, { hostUrl: URL_A, timeoutMs: 2000, intervalMs: 100 });
  check(wait.success && wait.approved === true, "waitForApproval devuelve aprobación", JSON.stringify(wait));

  // revocación
  activation.revokeDevice(dbA, box2Id);
  const revoked = await clientLink.waitForApproval(dbBox2, { hostUrl: URL_A, timeoutMs: 2000, intervalMs: 100 });
  check(revoked.success === false && revoked.code === "PAIR_REVOKED", "revocada → PAIR_REVOKED", JSON.stringify(revoked));
  r = await get(`${URL_A}/api/activation/status`, HEAD);
  check(r.status === 200 && r.data.revoked === true, "un dispositivo revocado sí ve su estado (revoked: true)", JSON.stringify(r.data));

  // ─── C2 · emparejar con client-link (otra caja, contra el Host A) ───────
  const paired = await clientLink.pairAsBox(dbBox3, { hostUrl: URL_A, code: codeA, deviceName: "Caja 3" });
  check(paired.success === true && paired.pending === true, "pairAsBox → pendiente", JSON.stringify(paired));
  check(paired.host_device_id === activation.getSetting(dbA, "host_device_id"), "pairAsBox guarda el host_device_id del Host", JSON.stringify(paired));
  const s3 = clientLink.getSettings(dbBox3);
  check(s3.device_role === "client" && s3.host_url === URL_A && s3.sync_completed === "0",
    "settings locales: device_role/host_url/sync_completed", JSON.stringify(s3));
  check(clientLink.canSell(dbBox3) === false, "tras emparejar sigue sin vender (sync_completed = 0)");
  const waitPend = await clientLink.waitForApproval(dbBox3, { hostUrl: URL_A, timeoutMs: 900, intervalMs: 150 });
  check(waitPend.success === false && waitPend.code === "PAIR_PENDING", "antes de aprobar → PAIR_PENDING", JSON.stringify(waitPend));
  activation.approveDevice(dbA, box3Id);
  const wait3 = await clientLink.waitForApproval(dbBox3, { hostUrl: URL_A, timeoutMs: 3000, intervalMs: 100 });
  check(wait3.success === true && wait3.approved === true, "la caja 3 ve su aprobación", JSON.stringify(wait3));
  clientLink.markSyncCompleted(dbBox3, true);
  check(clientLink.canSell(dbBox3) === true, "con sync_completed = 1 la caja ya puede vender");

  // ─── C2b · el token de emparejamiento jamás en claro ────────────────────
  check(paired.token_persisted === true, "pairAsBox informa que el token quedó persistido (cifrado)", JSON.stringify(paired));
  const raw3 = activation.getSetting(dbBox3, "box_paired_token");
  const tokenBox3 = clientLink.readPairedToken(dbBox3);
  check(raw3.startsWith(clientLink.TOKEN_ENC_PREFIX), "settings guarda el token con prefijo enc:v1", String(raw3).slice(0, 20));
  check(tokenBox3 && raw3.indexOf(tokenBox3) === -1, "el token en claro NO aparece en settings", String(raw3).slice(0, 20));
  check(clientLink.getSettings(dbBox3).box_paired_token === undefined, "box-get-settings no devuelve el token", JSON.stringify(clientLink.getSettings(dbBox3)));

  // Fallback sin safeStorage: no se persiste NADA (nunca en claro)
  clientLink.setSecretCipher(null);
  const noCipher = await clientLink.linkStatus(dbBox3, { hostUrl: URL_A });
  check(noCipher.success === false && noCipher.code === "TOKEN_UNAVAILABLE",
    "sin cipher → TOKEN_UNAVAILABLE (no se usa token en claro)", JSON.stringify(noCipher));
  const notSaved = clientLink.savePairedToken(dbBox3, "token-nuevo");
  check(notSaved.persisted === false && activation.getSetting(dbBox3, "box_paired_token") === null,
    "sin cipher no se escribe ningún token en settings", JSON.stringify(notSaved));
  clientLink.setSecretCipher(testCipher);
  check(clientLink.savePairedToken(dbBox3, tokenBox3).persisted === true && clientLink.readPairedToken(dbBox3) === tokenBox3,
    "restaurado el cipher, el token vuelve a guardarse cifrado");

  // Un residuo en claro de una versión anterior se borra, no se usa
  const dbOld = fixture.createFileDb(path.join(TMP, "box-old.db"));
  activation.setSetting(dbOld, "box_paired_token", "secreto-en-claro");
  check(clientLink.readPairedToken(dbOld) === null, "un token en claro NO se devuelve", null);
  check(activation.getSetting(dbOld, "box_paired_token") === null, "y además se BORRA de settings", null);

  // emparejamiento con código incorrecto desde client-link
  const badPair = await clientLink.pairAsBox(dbBox1, { hostUrl: URL_A, code: "NO-ES-EL-CODIGO", deviceName: "Caja 1" });
  check(badPair.success === false && badPair.code === "PAIR_RATE_LIMITED", "pairAsBox distingue el rate limit del Host", JSON.stringify(badPair));

  // ─── C3 · descubrimiento UDP en loopback + IP manual ────────────────────
  const disc = await discovery.startDiscovery(PORT_A);
  check(disc.success === true, "responder de descubrimiento en el puerto del Host A", JSON.stringify(disc));
  const found = await clientLink.discoverHosts({ timeoutMs: 900 });
  check(found.success === true && found.hosts.length >= 1, "discoverHosts encuentra el Host por UDP", JSON.stringify(found));
  const host = found.hosts.find((h) => h.url === URL_A) || found.hosts[0];
  check(host.host_device_id === activation.getSetting(dbA, "host_device_id"), "el host descubierto se validó con /api/activation/info", JSON.stringify(host));
  check(host.compatible === true, "el host descubierto es compatible en protocolo", JSON.stringify(host));
  const manual = await clientLink.discoverHosts({ timeoutMs: 400, discoveryPort: 3999, manualIps: ["127.0.0.1", "127.0.0.1"], manualPort: PORT_A });
  check(manual.success === true && manual.hosts.length === 1, "IP manual como alternativa (y deduplicada)", JSON.stringify(manual));

  // ─── C4 · Host incompatible en protocolo ────────────────────────────────
  const fake = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/health") return res.end(JSON.stringify({ success: true, ok: true, protocol_version: "9.0" }));
    if (req.url === "/api/activation/info") {
      return res.end(JSON.stringify({ success: true, protocol_version: "9.0", app_version: "9.0.0", host_device_id: "host-futuro" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((res) => fake.listen(PORT_FAKE, res));
  const mismatch = await clientLink.pairAsBox(dbBox3, { hostUrl: `http://127.0.0.1:${PORT_FAKE}`, code: codeA, deviceName: "Caja 3" });
  check(mismatch.success === false && mismatch.code === "PROTOCOL_MISMATCH", "Host con protocolo 9.0 → PROTOCOL_MISMATCH", JSON.stringify(mismatch));
  const unreachable = await clientLink.discoverHosts({ timeoutMs: 300, discoveryPort: 3999, manualIps: ["127.0.0.1"], manualPort: 3999 });
  check(unreachable.success === false && unreachable.code === "HOST_NOT_FOUND", "sin Hosts válidos → HOST_NOT_FOUND", JSON.stringify(unreachable));
  fake.close();

  // ─── C5 · dos Hosts: otro host_device_id ⇒ rechazo ──────────────────────
  await apiServer.stopServer();
  const dbB = fixture.createFileDb(path.join(TMP, "hostB.db"));
  seedCashier(dbB);
  const startedB = await apiServer.startServer(dbB, PORT_B, { appVersion: "9.9.9-check" });
  check(startedB.success === true, "Host B arranca (otro device_id)", startedB.error);
  check(activation.getSetting(dbB, "host_device_id") !== activation.getSetting(dbA, "host_device_id"),
    "los dos Hosts tienen host_device_id distintos");
  // El segundo Host también tiene emparejada a la misma caja (mismo token): la
  // caja debe rechazarlo por el device_id distinto, no por falta de emparejar.
  activation.registerPairing(dbB, {
    deviceId: box3Id,
    deviceName: "Caja 3",
    token: clientLink.readPairedToken(dbBox3),
    deviceType: "desktop_box",
    protocolVersion: protocol.PROTOCOL_VERSION,
    approved: 1,
  });
  const other = await clientLink.linkStatus(dbBox3, { hostUrl: URL_B });
  check(other.success === false && other.code === "HOST_MISMATCH" &&
      other.expected === activation.getSetting(dbA, "host_device_id") &&
      other.got === activation.getSetting(dbB, "host_device_id"),
    "la caja rechaza al segundo Host (HOST_MISMATCH)", JSON.stringify(other));

  await apiServer.stopServer();
  discovery.stopDiscovery();

  console.log(`\n[check-3c-link] ${fail === 0 ? "OK" : "FALLÓ"} · pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  try { apiServer.stopServer(); } catch (err) {}
  try { discovery.stopDiscovery(); } catch (err) {}
  process.exit(1);
});
