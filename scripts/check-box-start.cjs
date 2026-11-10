"use strict";
/*
 * Arranque de la caja: descarga inicial y primera sesión.
 *
 *   A) Dos descargas iniciales a la vez (la pantalla de vinculación se vuelve
 *      a montar): se suman en una, sin filas repetidas.
 *   B) Una página llega cortada (HTTP 200 sin cuerpo válido): se reintenta
 *      sola y la descarga termina.
 *   C) Entrar y abrir caja al instante: la petición espera la sesión del
 *      Host en vez de salir sin ella (antes: "sesión expirada").
 *   D) Un 401 de una petición vieja no borra la sesión nueva.
 *   E) Un login que el Host procesó pero cuya respuesta se perdió (TIMEOUT)
 *      no revoca la sesión que la caja sigue usando.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-box-start.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const ipcRegistry = require(path.join(REPO, "src/main/ipc-registry.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-bstart-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3578;

let pass = 0;
let fail = 0;
const check = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  }
};

clientLink.setSecretCipher({
  available: () => true,
  encrypt: (plain) => Buffer.from("T:" + plain, "utf8").toString("base64"),
  decrypt: (b64) => Buffer.from(String(b64), "base64").toString("utf8").slice(2),
});

// ── Host ─────────────────────────────────────────────────────────────────────
const host = fixture.createFileDb(path.join(TMP, "host.db"));
const p = hashPin("1111");
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
for (let i = 1; i <= 30; i++) {
  host.prepare("INSERT INTO categories (name) VALUES (?)").run(`Cat ${i}`);
  host.prepare("INSERT INTO products (barcode, name, price, stock, sale_unit, is_active) VALUES (?, ?, 10, 5, 'piece', 1)").run(`P${i}`, `Prod ${i}`);
}
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
let opened = 0;
ipcRegistry.set("open-cash-register", () => {
  opened += 1;
  return { success: true, registerId: 1 };
});

// ── Caja ─────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, `http://127.0.0.1:${PORT}`);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
clientLink.savePairedToken(box, "tok-a");

// Espía de fetch: puede cortar UNA respuesta de página a propósito.
const realFetch = global.fetch;
let breakNextPage = false;
let brokenPages = 0;
global.fetch = async (url, opts) => {
  const res = await realFetch(url, opts);
  if (breakNextPage && String(url).includes("/api/replica/snapshot")) {
    breakNextPage = false;
    brokenPages += 1;
    return new Response('{"success":true,"rows":[', { status: 200, headers: { "content-type": "application/json" } });
  }
  return res;
};

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");

  console.log("=== A · dos descargas a la vez ===");
  const [a1, a2] = await Promise.all([replicaEngine.downloadSnapshot(box), replicaEngine.downloadSnapshot(box)]);
  check(a1.success === true && a2.success === true, "las dos terminan bien", [a1.error, a2.error]);
  check(box.prepare("SELECT COUNT(*) c FROM products").get().c === 30, "sin filas repetidas");

  console.log("=== B · una página llega cortada ===");
  replicaEngine.resetSync(box);
  breakNextPage = true;
  const retries = [];
  const b = await replicaEngine.downloadSnapshot(box, { onRetry: (info) => retries.push(info) });
  check(brokenPages === 1, "(se cortó una página)");
  check(b.success === true, "la descarga termina sola", b);
  check(retries.length === 1 && retries[0].code === "HOST_BAD_RESPONSE" && /incompleta/.test(retries[0].error), "y deja el motivo real", retries);
  check(box.prepare("SELECT COUNT(*) c FROM categories").get().c === 30, "con todo completo");

  console.log("=== C · entrar y abrir caja al instante ===");
  box.prepare("INSERT OR REPLACE INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
  const login = await boxRpc.loginLocalFirst(box, 1, "1111");
  check(login.success === true, "entra con la copia local", login);
  const open = await boxRpc.forward(box, "open-cash-register", [{ cashierId: 1, initialCash: 100 }]);
  check(open && open.success === true && opened === 1, "abre caja sin pedir sesión otra vez", open);
  check(!!clientLink.readSessionToken(box), "y la sesión sigue guardada");

  console.log("=== D · un 401 viejo no borra la sesión nueva ===");
  const good = clientLink.readSessionToken(box);
  // Una petición que salió con una sesión ya revocada…
  clientLink.saveSessionToken(box, "sesion-vieja");
  const slow = boxRpc.forward(box, "open-cash-register", [{ cashierId: 1, initialCash: 100 }]);
  // …y mientras viaja llega la buena.
  clientLink.saveSessionToken(box, good);
  const r = await slow;
  check(r && r.success === true, "se reintenta con la sesión nueva", r);
  check(clientLink.readSessionToken(box) === good, "y no la borra");

  console.log("=== E · un login cuya respuesta se pierde no tumba la sesión ===");
  // El Host procesa el login, pero la respuesta nunca llega a la caja
  // (TIMEOUT en los registros de la Caja 2).
  const lost = await realFetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": "box-a", "x-device-token": clientLink.readPairedToken(box) },
    body: JSON.stringify({ id: 1, pin: "1111" }),
  }).then((x) => x.json());
  check(lost && lost.success === true, "(el Host emitió otra sesión que la caja no recibió)");
  const still = await boxRpc.forward(box, "open-cash-register", [{ cashierId: 1, initialCash: 100 }]);
  check(still && still.success === true, "la sesión que tiene la caja sigue sirviendo", still);

  await apiServer.stopServer();
  console.log(`\n=== arranque de la caja: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
