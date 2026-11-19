"use strict";
/*
 * Local-first · ventas en la caja.
 *
 *   A) En línea: cobrar es inmediato; la venta está en la copia local (id
 *      negativo, stock descontado), sube sola y la réplica la sustituye por la
 *      del Host sin duplicar.
 *   B) La réplica trae stock del Host antes de que suba la venta: el descuento
 *      local se vuelve a aplicar encima.
 *   C) Un resync completo vacía la tabla: la venta en cola se vuelve a escribir.
 *   D) Quitar una venta de la cola la borra de la copia y devuelve el stock.
 *   E) Una venta inválida se rechaza en la caja con la misma regla del Host.
 *   F) Las lecturas marcan la venta provisional como pendiente.
 *   G) Cliente nuevo + venta, sin Host: suben juntos y quedan ligados.
 *   H) Cerrar caja justo después de cobrar: primero sube la venta, no se traba.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-sales.cjs
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
const offlineQueue = require(path.join(REPO, "src/main/offline-queue.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const ipcRegistry = require(path.join(REPO, "src/main/ipc-registry.js"));
const customersCore = require(path.join(REPO, "src/main/customers-core.js"));
const salesLocal = require(path.join(REPO, "src/main/sales-local.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-ls-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3574;

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
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '001', 'Leche', 8, 100, 'piece', 1)").run();
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (2, '002', 'Pan', 5, 50, 'piece', 1)").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'box-a')").run();
ipcRegistry.set("add-customer", (e, data) => customersCore.addCustomer(host, data));
ipcRegistry.set("update-customer", (e, id, data) => customersCore.updateCustomer(host, id, data));
let closedWith = null;
ipcRegistry.set("close-cash-register", () => {
  closedWith = host.prepare("SELECT folio FROM sales").all().map((r) => r.folio);
  return { success: true };
});

// ── Caja ─────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, `http://127.0.0.1:${PORT}`);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
clientLink.savePairedToken(box, "tok-a");
box.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
// Lectura local mínima: en la app es el handler real con la BD de la caja.
ipcRegistry.set("get-sales-for-today", () => ({
  success: true,
  sales: box.prepare("SELECT * FROM sales ORDER BY id").all().map((s) => ({ ...s, can_cancel: 1 })),
}));

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const stock = (db, id = 1) => db.prepare("SELECT stock FROM products WHERE id = ?").get(id).stock;
const boxSale = (folio) => box.prepare("SELECT * FROM sales WHERE folio = ?").get(folio);
const hostSale = (folio) => host.prepare("SELECT * FROM sales WHERE folio = ?").get(folio);
const orphans = () => box.prepare("SELECT COUNT(*) c FROM sale_items WHERE sale_id NOT IN (SELECT id FROM sales)").get().c;
// El mismo enganche que main.js pone en la réplica.
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables, ids, meta) => {
      if (meta && meta.resync) boxRpc.rematerializeSales(box);
      else {
        if (tables.includes("sales") || tables.includes("sale_items")) boxRpc.dropOrphanSaleItems(box);
        if (tables.includes("products") && ids && ids.products) boxRpc.reapplyPendingSales(box, ids.products);
      }
      if (tables.includes("products")) boxRpc.reapplyPendingOps(box, ids && ids.products);
      if (tables.includes("customers")) boxRpc.reapplyPendingRows(box, "customers");
    },
  });
const sell = (extra = {}) =>
  boxRpc.forward(box, "record-sale", [{
    cart: [{ id: 1, quantity: 2, price: 8, finalPrice: 8, name: "Leche" }],
    total: 16,
    paymentMethod: "card",
    discountTotal: 0,
    cashierId: 1,
    cashierName: "Ana",
    registerId: 1,
    ...extra,
  }]);

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea: cobrar al instante ===");
  const t0 = performance.now();
  const a = await sell();
  const ms = performance.now() - t0;
  check(a.success === true && a.saleId < 0 && !!a.folio, "la venta queda con id provisional y folio", a);
  check(ms < 100, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  check(a.offline === false, "no avisa 'sin conexión' con el Host conectado", a);
  check(boxSale(a.folio) && boxSale(a.folio).id < 0, "está en la copia local de ventas");
  check(stock(box) === 98, "el stock baja al momento en la caja", stock(box));
  await boxRpc.syncPending(box);
  check(!!hostSale(a.folio) && stock(host) === 98, "el Host la registra una sola vez", hostSale(a.folio));
  await waitFor(() => boxSale(a.folio) && boxSale(a.folio).id > 0);
  check(boxSale(a.folio) && boxSale(a.folio).id === hostSale(a.folio).id, "la réplica cambia la provisional por la del Host");
  check(box.prepare("SELECT COUNT(*) c FROM sales WHERE folio = ?").get(a.folio).c === 1, "sin duplicarla");
  check(orphans() === 0, "sin partidas sueltas");
  check(stock(box) === 98, "el stock de la caja queda igual al del Host", stock(box));

  console.log("=== B · llega stock del Host antes que la venta ===");
  stopLive();
  await apiServer.stopServer();
  const b = await sell({
    cart: [{
      id: 1,
      quantity: 2,
      price: 8,
      finalPrice: 6,
      basePriceAtSale: 8,
      discountLabelAtSale: "Descuento aplicado en caja",
      name: "Leche",
    }],
    total: 12,
    discountTotal: 4,
  });
  check(b.success === true && b.offline === true, "se cobra sin Host y avisa", b);
  check(stock(box) === 96, "(stock local 96)", stock(box));
  host.prepare("UPDATE products SET stock = stock + 10, price = 10 WHERE id = 1").run();
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await waitFor(() => stock(box) === 106, 3000);
  check(stock(box) === 106, "trae 108 del Host y vuelve a descontar lo vendido aquí", stock(box));
  await boxRpc.syncPending(box);
  await waitFor(() => boxSale(b.folio) && boxSale(b.folio).id > 0);
  check(stock(host) === 106 && stock(box) === 106, "al subir, Host y caja coinciden", [stock(host), stock(box)]);
  for (const [name, db] of [["Host", host], ["Caja", box]]) {
    const detail = db.prepare(
      `SELECT s.total, s.discount_total, si.price_at_sale, si.base_price_at_sale, si.discount_label_at_sale
       FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.folio = ?`,
    ).get(b.folio);
    check(
      detail?.total === 12 && detail.discount_total === 4 &&
      detail.price_at_sale === 6 && detail.base_price_at_sale === 8 &&
      detail.discount_label_at_sale === "Descuento aplicado en caja",
      `${name} conserva importe y descuento pese al cambio de precio`,
      detail,
    );
  }

  console.log("=== C · resync completo ===");
  stopLive();
  await apiServer.stopServer();
  const c = await sell();
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  // Un resync vacía ventas y trae el stock del Host; sin la venta de la caja.
  check((await replicaEngine.downloadSnapshot(box)).success === true, "(resync)");
  check(!boxSale(c.folio) && stock(box) === 106, "(la copia quedó como la del Host)", stock(box));
  boxRpc.rematerializeSales(box);
  check(boxSale(c.folio) && boxSale(c.folio).id < 0 && stock(box) === 104, "la venta en cola vuelve a la copia, con su stock", stock(box));
  await boxRpc.syncPending(box);

  console.log("=== D · quitar una venta de la cola ===");
  await apiServer.stopServer();
  const d = await sell();
  const before = stock(box);
  const queuedRow = () => offlineQueue.list(box).find((r) => r.folio === d.folio);
  await waitFor(() => queuedRow() && queuedRow().status === "pending");
  const row = queuedRow();
  const cancelled = boxRpc.pendingCancel(box, row.id);
  check(cancelled.success === true && !boxSale(d.folio), "se borra de la copia local");
  check(stock(box) === before + 2, "y su stock vuelve", [before, stock(box)]);

  console.log("=== E · venta inválida ===");
  const queuedBefore = offlineQueue.list(box).length;
  const e = await sell({ total: 99 });
  check(e.success === false && e.code === "TOTAL_MISMATCH", "se rechaza con la regla del Host", e);
  check(offlineQueue.list(box).length === queuedBefore, "y no entra a la cola");

  console.log("=== F · lecturas ===");
  const f = await sell();
  const listed = await boxRpc.forward(box, "get-sales-for-today", [{}]);
  const mine = listed.sales.find((s) => s.folio === f.folio);
  check(mine && mine.pending === "pending" && mine.can_cancel === 0, "la provisional sale marcada pendiente y sin cancelar", mine);
  check(listed.sales.filter((s) => s.id > 0).every((s) => !s.pending), "las confirmadas no se marcan");

  console.log("=== G · cliente nuevo y venta sin Host ===");
  const cust = await boxRpc.forward(box, "add-customer", [{ name: "Lalo" }]);
  const g = await sell({ customerId: cust.customer.id });
  check(g.success === true && boxSale(g.folio).customer_id === cust.customer.id, "la venta local queda con el cliente provisional");
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  await boxRpc.syncPending(box);
  const hostLalo = host.prepare("SELECT id FROM customers WHERE uid = ?").get(cust.customer.uid);
  check(hostLalo && hostSale(g.folio) && hostSale(g.folio).customer_id === hostLalo.id, "en el Host la venta queda con el cliente real", hostSale(g.folio));
  check(offlineQueue.countBlocking(box) === 0, "no queda nada en la cola", offlineQueue.list(box).filter((r) => r.status !== "synced" && r.status !== "cancelled"));

  console.log("=== H · cerrar caja justo después de cobrar ===");
  const h = await sell();
  const closed = await boxRpc.forward(box, "close-cash-register", [{ registerId: 1 }]);
  check(closed && closed.success === true, "cierra sin pedir esperar", closed);
  check(Array.isArray(closedWith) && closedWith.includes(h.folio), "la venta llegó al Host antes del corte");

  await apiServer.stopServer();
  console.log(`\n=== ventas local-first: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
