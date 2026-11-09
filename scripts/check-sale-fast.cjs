"use strict";
/*
 * Cobrar no espera a la red. Host real detrás de un proxy que puede tragarse
 * las respuestas, que es como se ve un Wi-Fi trabado desde la caja.
 *
 *   A) En línea la venta entra normal.
 *   B) Sin respuesta, se guarda en la cola en menos de 2 s (antes 8 s).
 *   C) La siguiente venta ni siquiera toca la red.
 *   D) El Host sí la había guardado y sólo se perdió la respuesta: al subir la
 *      cola NO se duplica.
 *   E) Fiado con el Host caído: avisa al momento en vez de esperar.
 *   F) Al volver el Host, la venta vuelve a ir en línea.
 *   G) Una copia local atrasada con la red trabada no retiene el cobro.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-sale-fast.cjs
 */
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-sale-fast-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const HOST_PORT = 3564;
const PROXY_PORT = 3565;

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
const p = hashPin("1111");
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '001', 'Leche', 8, 100, 'piece', 1)").run();
host.prepare("INSERT INTO customers (id, name, credit_enabled, credit_limit) VALUES (7, 'Fiado', 1, 1000)").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'box-a')").run();

// La petición llega al Host; lo que `drop` decida se queda sin respuesta.
let drop = () => false;
let sales = 0;
const proxy = http.createServer((req, res) => {
  if (req.url === "/api/sales") sales += 1;
  const up = http.request(
    { host: "127.0.0.1", port: HOST_PORT, path: req.url, method: req.method, headers: req.headers },
    (ur) => {
      if (drop(req)) return ur.resume();
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    },
  );
  up.on("error", () => res.destroy());
  req.pipe(up);
});

const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, `http://127.0.0.1:${PROXY_PORT}`);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
clientLink.savePairedToken(box, "tok-a");
box.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);

const payload = (qty, extra = {}) => ({
  cart: [{ id: 1, quantity: qty, price: 8, finalPrice: 8 }],
  total: 8 * qty,
  paymentMethod: "cash",
  discountTotal: 0,
  cashierId: 1,
  cashierName: "Ana",
  registerId: 1,
  ...extra,
});
const timed = async (fn) => {
  const t0 = performance.now();
  const r = await fn();
  return { r, ms: performance.now() - t0 };
};
const hostSales = () => host.prepare("SELECT COUNT(*) c FROM sales").get().c;

(async () => {
  check((await apiServer.startServer(host, HOST_PORT)).success === true, "Host arranca");
  await new Promise((r) => proxy.listen(PROXY_PORT, r));
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login en el Host");

  console.log("=== A · en línea ===");
  const a = await timed(() => boxRpc.recordSale(box, payload(1)));
  check(a.r.success === true && !a.r.offline && hostSales() === 1, "la venta entra al Host", JSON.stringify(a.r));

  console.log("=== B · el Host recibe pero no llega respuesta ===");
  drop = (req) => req.url === "/api/sales";
  const b = await timed(() => boxRpc.recordSale(box, payload(2)));
  check(b.r.success === true && b.r.offline === true, "se guarda en la cola", JSON.stringify(b.r));
  check(b.ms < 2000, "el cajero espera menos de 2 s", `${b.ms.toFixed(0)} ms`);
  await new Promise((r) => setTimeout(r, 100));
  check(hostSales() === 2, "(el Host sí la guardó: sólo se perdió la respuesta)", String(hostSales()));

  console.log("=== C · la siguiente no toca la red ===");
  const before = sales;
  const c = await timed(() => boxRpc.recordSale(box, payload(3)));
  check(c.r.offline === true && c.ms < 200, "se guarda al instante", `${c.ms.toFixed(0)} ms`);
  check(sales === before, "ni intenta llamar al Host", `${sales - before} peticiones`);

  console.log("=== E · fiado sin Host ===");
  const e = await timed(() => boxRpc.recordSale(box, payload(1, { paymentMethod: "credit", customerId: 7, creditPaid: 0 })));
  check(e.r.code === "CREDIT_REQUIRES_HOST" && e.ms < 200, "avisa al momento", `${e.ms.toFixed(0)} ms ${JSON.stringify(e.r)}`);

  console.log("=== D · la cola no duplica ===");
  drop = () => false;
  const sync = await boxRpc.syncPending(box);
  check(sync.synced === 2, "suben las dos pendientes", JSON.stringify(sync));
  check(hostSales() === 3, "3 ventas en el Host: la que ya tenía no se repite", String(hostSales()));

  console.log("=== F · vuelve a ir en línea ===");
  const f = await timed(() => boxRpc.recordSale(box, payload(4)));
  check(f.r.success === true && !f.r.offline && hostSales() === 4, "la respuesta del Host limpia el fallo", JSON.stringify(f.r));

  console.log("=== G · la copia atrasada no retiene el cobro ===");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia completa");
  const stop = replicaLive.startLiveSync({ db: box });
  for (let i = 0; i < 100 && replicaLive.liveState(box).state !== "connected"; i++) {
    await new Promise((r) => setTimeout(r, 40));
  }
  drop = (req) => req.url.startsWith("/api/replica/changes");
  const g = await timed(() => boxRpc.forward(box, "record-sale", [payload(5)]));
  check(g.r.success === true && !g.r.offline, "la venta entra", JSON.stringify(g.r));
  check(g.ms < 500, "el cobro no espera a la copia local", `${g.ms.toFixed(0)} ms`);
  const w = await timed(() => replicaLive.waitForSeq(box, 999999, 400));
  check(w.r === false && w.ms < 900, "la espera de la copia respeta su plazo aunque la red esté trabada", `${w.ms.toFixed(0)} ms`);

  console.log("=== H · iniciar sesión sin esperar al Host ===");
  const clientLink = require(path.join(REPO, "src/main/client-link.js"));
  const { hashPin } = require(path.join(REPO, "src/main/pins.js"));
  const second = hashPin("2222");
  box.prepare("INSERT OR REPLACE INTO cashiers (id, name, role, is_active, pin_hash, pin_salt, pin) VALUES (2, 'Luis', 'cashier', 1, ?, ?, '')").run(second.hash, second.salt);
  check(!!clientLink.readSessionToken(box), "(hay sesión del primer cajero)");
  drop = (req) => req.url === "/api/auth";
  const h = await timed(() => boxRpc.forward(box, "verify-cashier-pin", [2, "2222"]));
  check(h.r.success === true && h.r.cashier.id === 2, "entra con el Host trabado", JSON.stringify(h.r));
  check(h.ms < 500, "sin esperar al Host", `${h.ms.toFixed(0)} ms`);
  check(!clientLink.readSessionToken(box), "la sesión del cajero anterior ya no firma ventas");
  const bad = await timed(() => boxRpc.forward(box, "verify-cashier-pin", [1, "9999"]));
  check(bad.r.success === false, "un PIN incorrecto no entra", JSON.stringify(bad.r));
  check(bad.ms < 2500, "ni deja esperando", `${bad.ms.toFixed(0)} ms`);
  drop = () => false;
  const back = await boxRpc.forward(box, "verify-cashier-pin", [1, "1111"]);
  check(back.success === true, "el cajero original vuelve a entrar", JSON.stringify(back));
  for (let i = 0; i < 100 && !clientLink.readSessionToken(box); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  check(!!clientLink.readSessionToken(box), "la sesión del Host llega en segundo plano");
  const must = await boxRpc.forward(box, "verify-cashier-pin", [1, "1111", { needsHostSession: true }]);
  check(must.success === true && !must.offline, "recuperar sesión sí pasa por el Host", JSON.stringify(must));

  console.log("=== I · sin Host las lecturas no esperan ===");
  drop = () => true;
  await boxRpc.rpcCall(box, "get-today-tasks", [], 200);
  const fast = await timed(() => boxRpc.rpcCall(box, "get-today-tasks", []));
  check(fast.r.code === "HOST_UNREACHABLE" && fast.ms < 100, "la siguiente lectura falla al momento", `${fast.ms.toFixed(0)} ms ${JSON.stringify(fast.r)}`);
  drop = () => false;

  stop();
  await apiServer.stopServer();
  proxy.close();
  console.log(`\n=== cobro sin esperar: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
