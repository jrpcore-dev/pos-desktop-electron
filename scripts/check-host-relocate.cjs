"use strict";
/*
 * El Host cambió de IP: la caja lo encuentra sola, sin volver a emparejar, y
 * nunca se pasa a otro Host. La búsqueda por IP evita depender del UDP de la PC.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-host-relocate.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const { createHostWatcher, FIRST_RETRY_MS, MAX_RETRY_MS } = require(path.join(REPO, "src/main/host-watcher.js"));

const PORT = 3567;
const DEAD_URL = "http://127.0.0.1:3568";
const HOST_URL_KEY = clientLink.SETTINGS.HOST_URL;
const HOST_ID_KEY = clientLink.SETTINGS.HOST_DEVICE_ID;

let failed = 0;
const check = (ok, label, extra) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failed += 1;
};

const manual = { manualIps: ["127.0.0.1"], manualPort: PORT, discoveryPort: 3569, timeoutMs: 300 };

(async () => {
  check(clientLink.parseHostAddress("192.168.1.20").ip === "192.168.1.20", "IP sola");
  check(clientLink.parseHostAddress("192.168.1.20:4000").port === 4000, "IP con puerto");
  check(clientLink.parseHostAddress("http://192.168.1.20:3456/").ip === "192.168.1.20", "dirección completa");
  check(clientLink.parseHostAddress("hola mundo") === null, "una dirección inválida se rechaza");

  const host = fixture.createMemoryDb();
  const started = await apiServer.startServer(host, PORT);
  check(started.success === true, "Host arranca", started);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/activation/info`);
  const hostId = (await res.json()).host_device_id;

  const box = fixture.createMemoryDb();
  activation.setSetting(box, HOST_URL_KEY, DEAD_URL);
  activation.setSetting(box, HOST_ID_KEY, hostId);

  const moved = await clientLink.relocateHost(box, manual);
  check(moved.success === true && moved.moved === true, "encuentra al Host en la IP nueva", moved);
  check(activation.getSetting(box, HOST_URL_KEY) === `http://127.0.0.1:${PORT}`, "guarda la dirección nueva");

  const same = await clientLink.relocateHost(box, { discoveryPort: 3569, timeoutMs: 300 });
  check(same.success === true && same.moved === false, "si la dirección sigue bien no busca nada", same);

  activation.setSetting(box, HOST_URL_KEY, DEAD_URL);
  activation.setSetting(box, HOST_ID_KEY, "otro-negocio");
  const other = await clientLink.relocateHost(box, manual);
  check(other.success === false && other.code === "HOST_MISMATCH", "nunca se pasa a otro Host", other);
  check(activation.getSetting(box, HOST_URL_KEY) === DEAD_URL, "y no toca la dirección guardada");

  const nobody = await clientLink.relocateHost(box, { discoveryPort: 3569, timeoutMs: 300 });
  check(nobody.success === false, "sin Host en la red no cambia nada", nobody);
  await apiServer.stopServer();

  // Vigilancia, con reloj simulado.
  let clock = 0;
  let ok = true;
  let calls = 0;
  let answer = { success: false };
  const seen = [];
  const watcher = createHostWatcher({
    now: () => clock,
    isHostOk: () => ok,
    relocate: async () => {
      calls += 1;
      return answer;
    },
    onMoved: (r) => seen.push(r),
  });
  await watcher.tick();
  check(calls === 0, "con el Host bien no busca");
  ok = false;
  await watcher.tick();
  check(calls === 1, "sin Host busca");
  await watcher.tick();
  check(calls === 1, "no repite enseguida");
  clock += FIRST_RETRY_MS;
  await watcher.tick();
  check(calls === 2, "reintenta tras la espera");
  clock += FIRST_RETRY_MS;
  await watcher.tick();
  check(calls === 2, "cada fallo espera más");
  clock += MAX_RETRY_MS;
  answer = { success: true, moved: true, host_url: "http://nuevo" };
  await watcher.tick();
  check(calls === 3 && seen.length === 1, "al encontrarlo avisa", seen);

  if (failed) {
    console.log(`\n${failed} verificación(es) fallaron`);
    process.exit(1);
  }
  console.log("\nTodo OK");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
