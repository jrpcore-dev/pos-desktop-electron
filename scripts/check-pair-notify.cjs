"use strict";
/*
 * Emparejar una caja: el Host se entera y la caja sabe qué pasó.
 *
 *   A) Una caja que se empareja avisa al Host (evento y `paired_devices` en
 *      db-changed); volver a emparejar una ya aprobada también.
 *   B) Todo rechazo lleva código propio y conserva su motivo: el asistente no
 *      puede caer en el comodín PAIR_REJECTED, que escondía la causa. Un fallo
 *      interno avisa al Host sin contarle el detalle a la red.
 *   C) Un 403 del flujo en vivo es el Host contestando: la caja no sale como
 *      "desconectada" y distingue "pendiente" de "ya no me reconoce".
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-pair-notify.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const opQueue = require(path.join(REPO, "src/main/op-queue.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-pair-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3563;
const HOST_URL = `http://127.0.0.1:${PORT}`;

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

clientLink.setSecretCipher({
  available: () => true,
  encrypt: (plain) => Buffer.from("T:" + plain, "utf8").toString("base64"),
  decrypt: (b64) => Buffer.from(String(b64), "base64").toString("utf8").slice(2),
});

const host = fixture.createFileDb(path.join(TMP, "host.db"));
const makeBox = () => {
  const box = fixture.createMemoryDb();
  activation.setSetting(box, "device_role", "client");
  dbSchema.ensureTriggersForRole(box);
  return box;
};
const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};

(async () => {
  const events = [];
  const changed = [];
  const started = await apiServer.startServer(host, PORT, {
    onPairEvent: (e) => events.push(e),
    onDataChanged: (tables) => changed.push(...tables),
  });
  check(started.success === true, "Host arranca", started.error);
  const code = activation.getActivationCode(host);

  console.log("=== A · el Host se entera ===");
  const box = makeBox();
  const p1 = await clientLink.pairAsBox(box, { hostUrl: HOST_URL, code, deviceName: "Caja 3" });
  check(p1.success === true && p1.pending === true, "la caja queda pendiente", JSON.stringify(p1));
  check(
    events.some((e) => e.type === "pending" && e.deviceName === "Caja 3" && e.deviceCode === p1.device_code),
    "el Host recibe el aviso con nombre y código",
    JSON.stringify(events),
  );
  check(changed.includes("paired_devices"), "las pantallas del Host se refrescan (paired_devices)", changed.join(","));
  activation.approveDevice(host, p1.deviceId);
  events.length = 0;
  const again = await clientLink.pairAsBox(box, { hostUrl: HOST_URL, code, deviceName: "Caja 3" });
  check(again.pending === true && events.some((e) => e.type === "pending"), "re-emparejar una aprobada también avisa", JSON.stringify(events));
  activation.approveDevice(host, p1.deviceId);

  console.log("=== B · el motivo no se pierde ===");
  events.length = 0;
  const bad = await clientLink.pairAsBox(makeBox(), { hostUrl: HOST_URL, code: "XXXX-0000", deviceName: "Caja 4" });
  check(bad.code === "PAIR_CODE_INVALID", "código equivocado: motivo propio", JSON.stringify(bad));
  check(!events.some((e) => e.type === "pending"), "un código equivocado no avisa como pendiente", JSON.stringify(events));

  const original = activation.registerPairing;
  activation.registerPairing = () => {
    throw new Error("detalle interno de la BD");
  };
  events.length = 0;
  const broken = await clientLink.pairAsBox(makeBox(), { hostUrl: HOST_URL, code, deviceName: "Caja 5" });
  activation.registerPairing = original;
  check(broken.code === "PAIR_HOST_ERROR", "fallo interno: código propio, no el comodín", JSON.stringify(broken));
  check(!JSON.stringify(broken).includes("detalle interno"), "el detalle no sale a la red", JSON.stringify(broken));
  check(
    events.some((e) => e.type === "error" && /detalle interno/.test(e.reason)),
    "…pero el Host sí lo registra y avisa",
    JSON.stringify(events),
  );

  console.log("=== C · 403 no es desconexión ===");
  // Caja al día que el Host deja de aprobar.
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial");
  const stop = replicaLive.startLiveSync({ db: box });
  check(await waitFor(() => replicaLive.liveState(box).state === "connected"), "conectada");
  await apiServer.stopServer();
  await apiServer.startServer(host, PORT, {});
  await clientLink.pairAsBox(box, { hostUrl: HOST_URL, code, deviceName: "Caja 3" }); // vuelve a pendiente
  check(await waitFor(() => replicaLive.hostOkInfo(box).authIssue === "pending"), "pendiente: la caja lo distingue", JSON.stringify(replicaLive.hostOkInfo(box)));
  check(replicaLive.hostOkInfo(box).reachable === true, "…y no sale como Host desconectado");

  activation.approveDevice(host, p1.deviceId);
  check(await waitFor(() => replicaLive.hostOkInfo(box).authIssue === null, 40000), "al aprobarla el aviso desaparece solo", JSON.stringify(replicaLive.hostOkInfo(box)));

  host.prepare("UPDATE paired_devices SET paired_token_hash = 'otro' WHERE device_id = ?").run(p1.deviceId);
  await apiServer.stopServer();
  await apiServer.startServer(host, PORT, {});
  check(await waitFor(() => replicaLive.hostOkInfo(box).authIssue === "not_paired", 40000), "token que el Host ya no reconoce: not_paired", JSON.stringify(replicaLive.hostOkInfo(box)));
  check(replicaLive.hostOkInfo(box).reachable === true, "…tampoco es desconexión");

  // Un 403 de vínculo no es un rechazo del negocio: el stock no se deshace.
  for (const code of ["NOT_PAIRED", "NOT_APPROVED"]) {
    const q = makeBox();
    q.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '1', 'Leche', 8, 10, 'piece', 1)").run();
    opQueue.enqueue(q, { channel: "add-stock", args: [{}], effect: { stock: [{ productId: 1, delta: 5 }] }, idempotencyKey: code });
    await opQueue.sync(q, async () => ({ success: false, code, error: "sin vínculo" }));
    const row = opQueue.list(q)[0];
    check(
      row.status === "pending" && q.prepare("SELECT stock FROM products WHERE id = 1").get().stock === 15,
      `${code}: la operación sigue pendiente y el stock no se deshace`,
      JSON.stringify(row),
    );
  }

  console.log("=== D · cerrar sin configurar ===");
  const fresh = makeBox();
  const pf = await clientLink.pairAsBox(fresh, { hostUrl: HOST_URL, code, deviceName: "Caja 6" });
  check(pf.success === true && clientLink.getSettings(fresh).canCancelSetup === true, "una caja sin datos se puede cerrar", JSON.stringify(pf));
  const keepId = activation.getSetting(fresh, clientLink.SETTINGS.BOX_DEVICE_ID);
  const closed = clientLink.cancelBoxSetup(fresh);
  check(closed.success === true, "cerrar la devuelve a PC sin configurar", JSON.stringify(closed));
  const after = clientLink.getSettings(fresh);
  check(!after.device_role && !after.host_url && !dbSchema.isClientRole(fresh), "ya no es caja ni tiene Host", JSON.stringify(after));
  check(!clientLink.readPairedToken(fresh), "se borra el token de emparejamiento");
  check(
    fresh.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_change_log%'").get().c > 0,
    "recupera los triggers de Host",
  );
  check(activation.getSetting(fresh, clientLink.SETTINGS.BOX_DEVICE_ID) === keepId, "conserva su identidad por si se vincula después");

  // `box` ya descargó el snapshot: es una copia real del negocio.
  check(clientLink.getSettings(box).canCancelSetup === false, "una caja con datos no ofrece cerrar");
  activation.setSetting(box, clientLink.SETTINGS.SYNC_COMPLETED, "0"); // p. ej. re-vinculando
  const refused = clientLink.cancelBoxSetup(box);
  check(refused.code === "SETUP_NOT_CANCELLABLE" && dbSchema.isClientRole(box), "…y aunque se pida, sigue siendo caja", JSON.stringify(refused));
  const queued = makeBox();
  activation.setSetting(queued, clientLink.SETTINGS.HOST_URL, HOST_URL);
  queued.prepare("INSERT INTO pending_sales (folio, payload_json, idempotency_key, local_created_at) VALUES ('B-000001', '{}', 'k1', '2026-11-05')").run();
  check(clientLink.cancelBoxSetup(queued).success === false, "con ventas por subir tampoco se puede cerrar");

  stop();
  await apiServer.stopServer();
  console.log(`\n=== emparejar y avisar: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
