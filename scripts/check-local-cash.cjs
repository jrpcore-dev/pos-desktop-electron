"use strict";
/*
 * Local-first · retiros y entradas de dinero en la caja.
 *
 *   A) En línea: registrar es inmediato; sube solo y la réplica cambia la
 *      fila provisional por la del Host sin sumar dos veces al total.
 *   B) Sin Host: entrada y retiro; mientras, el Host suma su propio retiro a
 *      la misma caja. Al volver los totales cuadran (suma, nunca pisa).
 *   C) La réplica trae la caja del Host antes de que suba el retiro: el total
 *      local se vuelve a sumar encima.
 *   D) Reenviar el mismo retiro no lo duplica.
 *   E) Cancelar un retiro que aún no llega al Host: se avisa, no se manda.
 *   F) Sin caja abierta: se frena en la caja con el mismo mensaje del Host.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-cash.cjs
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
const opQueue = require(path.join(REPO, "src/main/op-queue.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const ipcRegistry = require(path.join(REPO, "src/main/ipc-registry.js"));
const rpcContext = require(path.join(REPO, "src/main/rpc-context.js"));
const cashCore = require(path.join(REPO, "src/main/cash-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lcash-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3579;

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
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id, expenses, cash_in) VALUES (1, date('now'), 'open', 1, 'box-a', 0, 0)").run();
// Handlers del Host: los MISMOS de main.js (cash-core con el device de la caja).
let hostCalls = 0;
ipcRegistry.set("register-cash-expense", (e, data) => {
  hostCalls += 1;
  const r = cashCore.add(host, "out", data || {}, rpcContext.currentDeviceId());
  return r.success ? { success: true, expenses: r.total, id: r.id } : r;
});
ipcRegistry.set("register-cash-income", (e, data) => {
  hostCalls += 1;
  const r = cashCore.add(host, "in", data || {}, rpcContext.currentDeviceId());
  return r.success ? { success: true, cashIn: r.total, id: r.id } : r;
});

// ── Caja ─────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, `http://127.0.0.1:${PORT}`);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
clientLink.savePairedToken(box, "tok-a");

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const reg = (db) => db.prepare("SELECT expenses, cash_in FROM cash_register WHERE id = 1").get();
const byUid = (db, uid) => db.prepare("SELECT * FROM cash_register_expenses WHERE uid = ?").all(uid);
// El mismo enganche que main.js.
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables, ids, meta) => {
      if (tables.includes("cash_register_expenses")) boxRpc.reapplyPendingRows(box, "cash_register_expenses");
      if (tables.includes("cash_register")) {
        boxRpc.reapplyPendingAdds(box, "cash_register", meta && meta.resync ? null : (ids && ids.cash_register) || []);
      }
    },
  });
const expense = (amount, reason) =>
  boxRpc.forward(box, "register-cash-expense", [{ amount, reason, cashierId: 1, role: "admin" }]);
const income = (amount, reason) =>
  boxRpc.forward(box, "register-cash-income", [{ amount, reason, cashierId: 1, role: "admin" }]);

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea ===");
  const t0 = performance.now();
  const a = await expense(50, "Garrafón");
  const ms = performance.now() - t0;
  check(a.success === true && a.id < 0 && a.expenses === 50, "se registra al momento", a);
  check(ms < 100, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  check(reg(box).expenses === 50, "el corte de la caja ya lo cuenta");
  const aUid = box.prepare("SELECT uid FROM cash_register_expenses WHERE id = ?").get(a.id).uid;
  await boxRpc.syncOps(box);
  check(byUid(host, aUid).length === 1 && reg(host).expenses === 50, "el Host lo guarda en la misma caja");
  await waitFor(() => byUid(box, aUid).length === 1 && byUid(box, aUid)[0].id > 0);
  check(byUid(box, aUid)[0].id === byUid(host, aUid)[0].id, "la réplica cambia la provisional por la del Host");
  await new Promise((r) => setTimeout(r, 300));
  check(reg(box).expenses === 50, "sin sumarlo dos veces", reg(box));

  console.log("=== B · sin Host: entrada y retiro ===");
  stopLive();
  await apiServer.stopServer();
  const i = await income(100, "Cambio del dueño");
  const e = await expense(20, "Pan");
  check(i.success === true && e.success === true, "se registran sin Host", [i, e]);
  check(reg(box).cash_in === 100 && reg(box).expenses === 70, "la caja ya ve +100 entrada y 70 de retiros", reg(box));
  // Mientras, el Host suma un retiro propio a esa misma caja.
  host.prepare("UPDATE cash_register SET expenses = expenses + 30 WHERE id = 1").run();
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await boxRpc.syncOps(box);
  await waitFor(() => reg(host).expenses === 100 && reg(host).cash_in === 100);
  check(reg(host).expenses === 100 && reg(host).cash_in === 100, "el Host suma todo: 50 + 30 + 20", reg(host));
  await waitFor(() => reg(box).expenses === 100 && reg(box).cash_in === 100);
  check(reg(box).expenses === 100 && reg(box).cash_in === 100, "la caja también, sin pisar el del Host", reg(box));

  console.log("=== C · la réplica llega antes que el retiro ===");
  stopLive();
  await apiServer.stopServer();
  const c = await expense(5, "Bolsas");
  check(c.success === true && reg(box).expenses === 105, "(retiro de 5 sin Host)");
  // Lo que va en vuelo no se reaplica (la fila siguiente del Host ya lo trae):
  // se espera a que el intento sin Host termine y quede en espera.
  await waitFor(() => opQueue.list(box, ["syncing"]).length === 0);
  // La réplica pisa la fila con la del Host (aún sin el retiro de 5).
  box.prepare("UPDATE cash_register SET expenses = 100 WHERE id = 1").run();
  boxRpc.reapplyPendingAdds(box, "cash_register", ["1"]);
  check(reg(box).expenses === 105, "se vuelve a sumar encima", reg(box));

  console.log("=== D · reenviar el mismo retiro ===");
  const before = reg(host).expenses;
  const again = cashCore.add(host, "out", { amount: 50, reason: "Garrafón", uid: aUid, cashierId: 1, role: "admin" }, "box-a");
  check(again.success === true && byUid(host, aUid).length === 1 && reg(host).expenses === before, "un solo retiro, el total no cambia");

  console.log("=== E · cancelar algo que aún no llega ===");
  const del = await boxRpc.forward(box, "delete-cash-expense", [{ expenseId: c.id, cashierId: 1, role: "admin" }]);
  check(del.success === false && del.code === "NOT_YET_ON_HOST", "se avisa en vez de mandarlo", del);

  console.log("=== F · sin caja abierta ===");
  box.prepare("UPDATE cash_register SET status = 'closed' WHERE id = 1").run();
  const none = await expense(10, "x");
  check(none.success === false && none.code === "NO_OPEN_REGISTER", "se frena en la caja", none);
  box.prepare("UPDATE cash_register SET status = 'open' WHERE id = 1").run();

  check((await apiServer.startServer(host, PORT)).success === true, "(vuelve el Host)");
  await boxRpc.syncOps(box);
  await waitFor(() => reg(host).expenses === 105 && opQueue.countOpen(box) === 0);
  check(reg(host).expenses === 105 && opQueue.countOpen(box) === 0, "lo pendiente sube y la cola queda vacía", reg(host));

  await apiServer.stopServer();
  console.log(`\n=== retiros y entradas local-first: ${pass} PASS / ${fail} FAIL ===`);
  void hostCalls;
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
