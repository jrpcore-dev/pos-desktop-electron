"use strict";
/*
 * Fase 4 · réplica y resiliencia.
 *
 *   - compactación: una caja con el cursor justo en la última fila podada no
 *     recibe LOG_COMPACTED; una por detrás sí;
 *   - SSE: el `id` de latidos/busy/ready es el cursor de cada caja; lotes
 *     anidados no sueltan el `busy` antes de tiempo; un flujo por caja; al
 *     revocar se corta; una caja que no lee se desconecta; un error de BD
 *     dentro del sondeo no tumba el proceso;
 *   - /api/health informa host_busy;
 *   - un cambio que no se puede aplicar no avanza el cursor;
 *   - la frescura de la réplica se mide desde el último delta;
 *   - una venta offline descuenta el stock local;
 *   - watchdog: un flujo SSE mudo se corta y la caja reconecta.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-4-resilience.cjs
 */
const http = require("http");
const path = require("path");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));
const compactMod = require(path.join(REPO, "src/main/change-log-compact.js"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const { createChangeStream } = require(path.join(REPO, "src/main/change-stream.js"));

const PORT = 3525;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

clientLink.setSecretCipher({
  available: () => true,
  encrypt: (p) => Buffer.from("T:" + p, "utf8").toString("base64"),
  decrypt: (b) => Buffer.from(String(b), "base64").toString("utf8").slice(2),
});

// Respuesta SSE falsa para probar change-stream sin red.
const fakeRes = ({ slow = false } = {}) => {
  const frames = [];
  return {
    frames,
    ended: false,
    writableEnded: false,
    writableLength: slow ? 10 * 1024 * 1024 : 0,
    write(f) {
      frames.push(f);
      return !slow;
    },
    end() {
      this.ended = true;
      this.writableEnded = true;
    },
    on() {},
  };
};
const ids = (res, event) =>
  res.frames
    .filter((f) => f.includes(`event: ${event}\n`))
    .map((f) => Number((/^id: (\d+)/m.exec(f) || [])[1]));

(async () => {
  console.log("=== compactación: límite ===");
  const host = fixture.createMemoryDb();
  const now = Date.now();
  const old = now - 8 * compactMod.DAY_MS;
  const ins = host.prepare(`INSERT INTO ${dbSchema.CHANGE_LOG_TABLE} (tbl, row_id, op, ts) VALUES ('products', '1', 'upsert', ?)`);
  for (let i = 0; i < 1300; i++) ins.run(old);
  const out = compactMod.compact(host, now);
  const firstSeq = Number(activation.getSetting(host, "change_log_first_seq"));
  const minLeft = host.prepare(`SELECT MIN(seq) m FROM ${dbSchema.CHANGE_LOG_TABLE}`).get().m;
  check(out.deleted > 0 && firstSeq === minLeft - 1, "first_seq = última fila podada", JSON.stringify({ out, firstSeq, minLeft }));

  activation.registerPairing(host, { deviceId: "box", deviceName: "Caja", token: "tok", deviceType: "desktop_box", approved: 1 });
  await apiServer.startServer(host, PORT);
  const H = { "x-device-id": "box", "x-device-token": "tok" };
  let r = await (await fetch(`${BASE}/api/replica/changes?since=${firstSeq}`, { headers: H })).json();
  check(r.success === true, "cursor en la última fila podada → delta normal (sin resync)", JSON.stringify(r).slice(0, 100));
  r = await (await fetch(`${BASE}/api/replica/changes?since=${firstSeq - 1}`, { headers: H })).json();
  check(r.success === false && r.code === "LOG_COMPACTED", "cursor por detrás → LOG_COMPACTED");

  console.log("=== /api/health · host_busy ===");
  apiServer.hostBusy("import");
  let h = await (await fetch(`${BASE}/api/health`)).json();
  check(h.host_busy === "import", "ocupado → host_busy", JSON.stringify(h));
  apiServer.hostReady("import");
  h = await (await fetch(`${BASE}/api/health`)).json();
  check(h.host_busy === null, "libre → host_busy null", JSON.stringify(h));
  await apiServer.stopServer();

  console.log("=== change-stream ===");
  const sdb = fixture.createMemoryDb();
  const stream = createChangeStream({
    db: sdb,
    changeLogTable: dbSchema.CHANGE_LOG_TABLE,
    getSetting: (k) => activation.getSetting(sdb, k),
    heartbeatMs: 60000,
    coalesceMs: 60000,
  });
  const logIns = sdb.prepare(`INSERT INTO ${dbSchema.CHANGE_LOG_TABLE} (tbl, row_id, op, ts) VALUES ('products', '1', 'upsert', 0)`);
  for (let i = 0; i < 10; i++) logIns.run();
  const a = fakeRes();
  stream.subscribe({ res: a, since: "4", deviceId: "box-a" });
  stream.hostBusy("lote-1");
  stream.hostBusy("lote-2");
  stream.hostReady("lote-1");
  check(ids(a, "ready").length === 0, "lotes anidados: el primer ready no suelta el busy");
  stream.hostReady("lote-2");
  check(ids(a, "ready").length === 1, "al cerrar el último lote llega ready");
  check(ids(a, "busy").every((x) => x === 4) && ids(a, "ready")[0] === 4,
    "busy/ready llevan el cursor de la caja (4), no el seq máximo (10)", JSON.stringify({ busy: ids(a, "busy"), ready: ids(a, "ready") }));
  const a2 = fakeRes();
  stream.subscribe({ res: a2, since: "10", deviceId: "box-a" });
  check(a.ended && !a2.ended && stream.stats().clients === 1, "un flujo por caja: el anterior se cierra");
  const slow = fakeRes({ slow: true });
  stream.subscribe({ res: slow, since: "10", deviceId: "box-slow" });
  check(slow.ended && stream.stats().clients === 1, "caja que no lee (búfer lleno) → desconectada");
  const b = fakeRes();
  stream.subscribe({ res: b, since: "10", deviceId: "box-b" });
  check(stream.closeDevice("box-b") === 1 && b.ended, "closeDevice corta el flujo de la caja revocada");
  stream.start();
  sdb.close(); // BD cerrada bajo el sondeo
  let crashed = false;
  process.once("uncaughtException", () => {
    crashed = true;
  });
  // Fuerza un tick del sondeo y del latido con la BD cerrada.
  const guardedStream = createChangeStream({
    db: sdb,
    changeLogTable: dbSchema.CHANGE_LOG_TABLE,
    getSetting: () => null,
    heartbeatMs: 30,
    coalesceMs: 30,
  });
  guardedStream.start();
  await sleep(150);
  guardedStream.stop();
  stream.stop();
  check(!crashed, "error de BD dentro del sondeo/latido no tumba el proceso");

  console.log("=== réplica: cambio que falla y frescura ===");
  const box = fixture.createMemoryDb();
  replicaEngine.setState(box, { [replicaEngine.KEYS.LAST_SEQ]: "5" });
  const res1 = replicaEngine.applyChanges(box, [
    { seq: 6, tbl: "categories", row_id: "1", op: "upsert", row: { id: 1, name: "Bebidas" } },
    { seq: 7, tbl: "products", row_id: "9", op: "upsert", row: { id: 9, name: null, price: 1 } },
    { seq: 8, tbl: "categories", row_id: "2", op: "upsert", row: { id: 2, name: "Snacks" } },
  ]);
  check(res1.failed && res1.failed.seq === 7, "el cambio inválido se reporta", JSON.stringify(res1.failed));
  check(replicaEngine.state(box).last_seq === 6, "el cursor no avanza más allá del cambio fallido",
    String(replicaEngine.state(box).last_seq));
  check(!box.prepare("SELECT 1 FROM categories WHERE id = 2").get(), "lo posterior al fallo no se aplicó");
  activation.setSetting(box, replicaEngine.KEYS.SYNCED_AT, String(Date.now() - 5 * 3600 * 1000));
  replicaEngine.markFresh(box);
  const st = replicaEngine.state(box);
  check(Date.now() - st.fresh_at < 5000 && Date.now() - st.synced_at > 4 * 3600 * 1000,
    "fresh_at = último delta (snapshot de hace 5 h no cuenta como viejo)", JSON.stringify({ fresh: st.fresh_at, synced: st.synced_at }));

  console.log("=== venta offline: stock local ===");
  box.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1, '1', 'Leche', 8, 10, 'piece')").run();
  activation.setSetting(box, clientLink.SETTINGS.HOST_URL, "http://127.0.0.1:1"); // Host inalcanzable
  activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box");
  activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
  const off = await boxRpc.recordSale(box, {
    cart: [
      { id: 1, quantity: 2, price: 8, finalPrice: 8 },
      { id: 1, quantity: 1, price: 40, finalPrice: 40, isPackItem: true, pack_qty: 3 },
      { isManual: true, name: "Varios", quantity: 1, price: 5, finalPrice: 5 },
    ],
    total: 61,
    paymentMethod: "cash",
    registerId: 1,
  });
  const stock = box.prepare("SELECT stock FROM products WHERE id = 1").get().stock;
  check(off.offline === true && stock === 5, "venta en cola descuenta 2 + 1 paquete×3 del stock local", JSON.stringify({ off, stock }));

  console.log("=== watchdog del flujo SSE ===");
  // Host falso: acepta el SSE, contesta /changes vacío y luego se queda mudo.
  let sseOpened = 0;
  const fake = http.createServer((req, res) => {
    if (req.url.startsWith("/api/events")) {
      sseOpened += 1;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: hello\ndata: {\"seq\":0}\n\n");
      return; // nunca más escribe
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, changes: [], has_more: false, next_seq: 0 }));
  });
  await new Promise((ok) => fake.listen(3526, "127.0.0.1", ok));
  const live = fixture.createMemoryDb();
  activation.setSetting(live, clientLink.SETTINGS.HOST_URL, "http://127.0.0.1:3526");
  activation.setSetting(live, clientLink.SETTINGS.BOX_DEVICE_ID, "box");
  clientLink.savePairedToken(live, "tok");
  clientLink.markSyncCompleted(live, true);
  replicaEngine.setState(live, {
    [replicaEngine.KEYS.SYNCED_AT]: String(Date.now()),
    [replicaEngine.KEYS.LAST_SEQ]: "0",
  });
  const stop = replicaLive.startLiveSync({ db: live });
  await sleep(1000);
  check(replicaLive.liveState(live).state === "connected", "conecta al flujo", JSON.stringify(replicaLive.liveState(live)));
  let reconnected = false;
  for (let i = 0; i < 30 && !reconnected; i++) {
    await sleep(1000);
    reconnected = sseOpened >= 2;
  }
  stop();
  fake.close();
  check(reconnected, "flujo mudo > 15 s → se corta y reconecta", `aperturas=${sseOpened}`);

  console.log(`\n=== Fase 4: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
});
