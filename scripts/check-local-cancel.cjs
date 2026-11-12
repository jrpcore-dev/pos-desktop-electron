"use strict";
/*
 * Local-first · cancelar una venta propia en la caja.
 *
 *   A) En línea: se cancela al momento (venta, partidas y stock) y sube sola;
 *      el Host la cancela con la misma hora y el stock no vuelve dos veces.
 *   B) Sin Host: se cancela igual; al volver sube y cuadra.
 *   C) La réplica trae la venta y el producto del Host antes de que suba: la
 *      cancelación y su stock se vuelven a aplicar encima.
 *   D) Reglas iguales que el Host: venta de otra caja, recarga, fiado sin
 *      Host, venta que aún no sube, ya cancelada.
 *   E) El administrador ya la canceló en el Host: la cola no queda en
 *      conflicto.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-cancel.cjs
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
const salesCancelCore = require(path.join(REPO, "src/main/sales-cancel-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lcancel-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3581;

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
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'cashier', '', 1, ?, ?)").run(p.hash, p.salt);
for (const [id, code] of [["box-a", "A"], ["box-b", "B"]]) {
  activation.registerPairing(host, { deviceId: id, deviceName: id, token: `tok-${code}`, deviceType: "desktop_box", approved: 1 });
  activation.approveDevice(host, id);
  host.prepare("UPDATE paired_devices SET device_code = ? WHERE device_id = ?").run(code, id);
}
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id, expenses, cash_in) VALUES (1, date('now'), 'open', 1, 'box-a', 0, 0)").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id, expenses, cash_in) VALUES (2, date('now'), 'open', 1, 'box-b', 0, 0)").run();
host.prepare("INSERT INTO products (id, barcode, name, price, stock, is_active) VALUES (1, '750', 'Coca', 20, 10, 1)").run();
host.prepare("INSERT INTO customers (id, name) VALUES (1, 'Luis')").run();
// Ventas ya en el Host (positivas): 2 Cocas cada una.
const sale = (id, { device = "box-a", register = 1, method = "cash", service = null } = {}) => {
  host.prepare(
    "INSERT INTO sales (id, folio, total, payment_method, status, register_id, device_id, customer_id, credit_amount) VALUES (?, ?, 40, ?, 'completado', ?, ?, ?, ?)",
  ).run(id, `A-${id}`, method, register, device, method === "credit" ? 1 : null, method === "credit" ? 40 : null);
  host.prepare(
    "INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, stock_deducted, service_transaction_id) VALUES (?, 1, 2, 20, 2, ?)",
  ).run(id, service);
};
for (const id of [1, 2, 3, 6]) sale(id);
sale(4, { device: "box-b", register: 2 });
sale(5, { service: 99 });
sale(7, { method: "credit" });
// Handler del Host: el MISMO de main.js (sales-cancel-core).
ipcRegistry.set("cancel-sale", (e, { saleId, cashierName, reason, role, cashierId, cancelledAt } = {}) => {
  const s = host.prepare("SELECT * FROM sales WHERE id = ?").get(saleId);
  const caller = rpcContext.currentDeviceId();
  const ok = salesCancelCore.check(host, s, { role, caller });
  if (!ok.success) return ok;
  salesCancelCore.apply(host, s, { cashierName, reason, cashierId, caller, cancelledAt });
  return { success: true };
});

// ── Caja ─────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, `http://127.0.0.1:${PORT}`);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
clientLink.savePairedToken(box, "tok-A");

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const stock = (db) => db.prepare("SELECT stock FROM products WHERE id = 1").get().stock;
const status = (db, id) => (db.prepare("SELECT status FROM sales WHERE id = ?").get(id) || {}).status;
const itemStatus = (db, id) => (db.prepare("SELECT status FROM sale_items WHERE sale_id = ?").get(id) || {}).status;
// El mismo enganche que main.js.
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables, ids, meta) => {
      if (tables.includes("products")) boxRpc.reapplyPendingOps(box, meta && meta.resync ? null : ids && ids.products);
      for (const t of ["sales", "sale_items"]) if (tables.includes(t)) boxRpc.reapplyPendingRows(box, t);
    },
  });
const cancel = (saleId) => boxRpc.forward(box, "cancel-sale", [{ saleId, cashierName: "Ana", role: "cashier", cashierId: 1 }]);

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  check(stock(box) === 10 && status(box, 1) === "completado", "(la caja ve la venta y el stock)");

  console.log("=== A · en línea ===");
  const t0 = performance.now();
  const a = await cancel(1);
  const ms = performance.now() - t0;
  check(a.success === true && a.queued === true, "se cancela al momento", a);
  check(ms < 100, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  check(status(box, 1) === "cancelado" && itemStatus(box, 1) === "cancelado", "venta y partidas canceladas en la caja");
  check(stock(box) === 12, "el stock vuelve en la caja", stock(box));
  const boxAt = box.prepare("SELECT cancelled_at FROM sales WHERE id = 1").get().cancelled_at;
  await boxRpc.syncOps(box);
  check(status(host, 1) === "cancelado" && stock(host) === 12, "el Host la cancela y devuelve el stock", [status(host, 1), stock(host)]);
  const hs = host.prepare("SELECT cancelled_at, cancelled_by_device FROM sales WHERE id = 1").get();
  check(hs.cancelled_at === boxAt && hs.cancelled_by_device === "box-a", "con la hora y la caja que la canceló", hs);
  check(
    host.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'devolution' AND reference = 'Cancelación venta #1'").get().n === 1,
    "con su movimiento de devolución",
  );
  await new Promise((r) => setTimeout(r, 400));
  check(stock(box) === 12 && status(box, 1) === "cancelado", "la réplica no devuelve el stock dos veces", stock(box));

  console.log("=== B · sin Host ===");
  stopLive();
  await apiServer.stopServer();
  const b = await cancel(2);
  check(b.success === true && status(box, 2) === "cancelado" && stock(box) === 14, "se cancela sin Host", [b, stock(box)]);
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await boxRpc.syncOps(box);
  await waitFor(() => status(host, 2) === "cancelado");
  check(status(host, 2) === "cancelado" && stock(host) === 14, "sube y el Host cuadra", [status(host, 2), stock(host)]);
  await waitFor(() => opQueue.countOpen(box) === 0);
  check(stock(box) === 14 && opQueue.countOpen(box) === 0, "la caja también y la cola queda vacía", stock(box));

  console.log("=== C · la réplica llega antes que la cancelación ===");
  stopLive();
  await apiServer.stopServer();
  const c = await cancel(3);
  check(c.success === true && stock(box) === 16, "(cancelada sin Host)");
  await waitFor(() => opQueue.list(box, ["syncing"]).length === 0);
  // La réplica pisa venta, partidas y producto con lo del Host (sin cancelar).
  box.prepare("UPDATE sales SET status = 'completado', cancelled_at = NULL WHERE id = 3").run();
  box.prepare("UPDATE sale_items SET status = NULL WHERE sale_id = 3").run();
  box.prepare("UPDATE products SET stock = 14 WHERE id = 1").run();
  boxRpc.reapplyPendingRows(box, "sales");
  boxRpc.reapplyPendingRows(box, "sale_items");
  boxRpc.reapplyPendingOps(box, ["1"]);
  check(status(box, 3) === "cancelado" && itemStatus(box, 3) === "cancelado", "la cancelación se vuelve a aplicar");
  check(stock(box) === 16, "y su stock encima del del Host", stock(box));
  // Un resync que aún no trae la venta: nunca se inventa una fila a medias.
  box.pragma("foreign_keys = OFF");
  box.prepare("DELETE FROM sale_items WHERE sale_id = 3").run();
  box.prepare("DELETE FROM sales WHERE id = 3").run();
  boxRpc.reapplyPendingRows(box, "sales");
  boxRpc.reapplyPendingRows(box, "sale_items");
  check(!box.prepare("SELECT 1 FROM sales WHERE id = 3").get(), "sin la venta, no se crea una a medias");
  box.pragma("foreign_keys = ON");

  console.log("=== D · mismas reglas que el Host ===");
  const other = await cancel(4);
  check(other.success === false && other.code === "SALE_NOT_OWNED", "venta de otra caja", other);
  const service = await cancel(5);
  check(service.success === false && service.code === "SERVICE_SALE_NOT_CANCELLABLE", "venta con recarga", service);
  const credit = await cancel(7);
  check(credit.success === false && credit.code === "HOST_REQUIRED", "fiado sin Host pide conexión", credit);
  check(status(box, 7) === "completado", "(y no se toca)");
  const again = await cancel(1);
  check(again.success === false && again.code === "ALREADY_CANCELLED", "ya cancelada", again);
  box.pragma("foreign_keys = OFF");
  box.prepare("INSERT INTO sales (id, folio, total, payment_method, status, register_id, device_id) VALUES (-1, 'A-9', 10, 'cash', 'completado', 1, 'box-a')").run();
  box.pragma("foreign_keys = ON");
  const local = await cancel(-1);
  check(local.success === false && local.code === "NOT_YET_ON_HOST", "venta que aún no sube", local);
  box.prepare("DELETE FROM sales WHERE id = -1").run();
  // Plazo: caja cerrada hace días y sin ser admin.
  box.prepare("UPDATE cash_register SET status = 'closed', closed_at = datetime('now', '-5 days') WHERE id = 1").run();
  const late = await cancel(6);
  check(late.success === false && late.code === "OUT_OF_WINDOW", "fuera del plazo", late);
  box.prepare("UPDATE cash_register SET status = 'open', closed_at = NULL WHERE id = 1").run();

  console.log("=== E · el administrador ya la canceló en el Host ===");
  const e = await cancel(6);
  check(e.success === true && status(box, 6) === "cancelado", "(cancelada en la caja sin Host)");
  salesCancelCore.apply(host, host.prepare("SELECT * FROM sales WHERE id = 6").get(), { cashierName: "Dueño" });
  check((await apiServer.startServer(host, PORT)).success === true, "(vuelve el Host)");
  await boxRpc.syncOps(box);
  await waitFor(() => opQueue.countOpen(box) === 0);
  check(opQueue.countOpen(box) === 0 && opQueue.list(box, ["conflict"]).length === 0, "sube sin conflicto");
  check(status(host, 3) === "cancelado" && status(host, 6) === "cancelado", "todo lo pendiente subió");
  check(stock(host) === 18, "el stock del Host cuenta cada cancelación una vez", stock(host));

  await apiServer.stopServer();
  console.log(`\n=== cancelar venta local-first: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
