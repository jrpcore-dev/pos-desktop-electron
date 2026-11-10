"use strict";
/*
 * Local-first · productos en la caja.
 *
 *   A) En línea: crear es inmediato (id provisional, stock inicial, promo por
 *      cantidad); sube solo y la réplica cambia la fila por la del Host sin
 *      duplicarla ni dejar promos sueltas.
 *   B) Sin Host: crear, vender, meter stock y editar el producto nuevo. Al
 *      volver todo sube ligado por uid y el stock cuadra en los dos lados.
 *   C) Editar no toca el stock: lo vendido en el Host mientras tanto se queda.
 *   D) Fijar el stock a una cantidad exacta sigue necesitando el Host.
 *   E) Código repetido: otra caja se adelantó con el mismo código. El alta
 *      queda en revisión y la venta se liga al producto que ya existe.
 *   E2) Código interno repetido: el Host le da al que llega después el
 *      siguiente libre; la venta sigue en su producto, no en el ajeno.
 *   F) Reenviar la misma alta no duplica ni suma dos veces el stock inicial.
 *   G) Borrar un producto que aún no llega al Host: se avisa, no se manda.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-products.cjs
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
const offlineQueue = require(path.join(REPO, "src/main/offline-queue.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
const ipcRegistry = require(path.join(REPO, "src/main/ipc-registry.js"));
const catalogCore = require(path.join(REPO, "src/main/catalog-core.js"));
const productsCore = require(path.join(REPO, "src/main/products-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lprod-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3577;

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
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '001', 'Leche', 8, 10, 'piece', 1)").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'box-a')").run();
// Handlers del Host: los MISMOS de main.js (products-core + catalog-core).
let hostAdds = 0;
ipcRegistry.set("add-product", (e, raw) => {
  hostAdds += 1;
  const refs = catalogCore.resolveRefs(host, raw);
  return refs.success ? productsCore.add(host, refs.data) : refs;
});
ipcRegistry.set("update-product", (e, id, raw) => {
  const refs = catalogCore.resolveRefs(host, raw);
  return refs.success ? productsCore.update(host, id, refs.data) : refs;
});
// add-stock mínimo con la misma resolución por uid que main.js.
ipcRegistry.set("add-stock", (e, { productId, productUid, quantity }) => {
  const id = productsCore.resolveId(host, productId, productUid);
  if (!id) return { success: false, code: "PRODUCT_PENDING", error: "aún no llega" };
  host.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(Number(quantity), id);
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

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const byUid = (db, uid) => db.prepare("SELECT * FROM products WHERE uid = ?").all(uid);
const byCode = (db, code) => db.prepare("SELECT * FROM products WHERE barcode = ?").all(code);
const pricesOf = (db, id) => db.prepare("SELECT * FROM product_prices WHERE product_id = ?").all(id);
// El mismo enganche y en el mismo orden que main.js.
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables, ids, meta) => {
      if (tables.includes("products")) boxRpc.reapplyPendingRows(box, "products");
      if (tables.includes("products") || tables.includes("product_prices")) boxRpc.reapplyPendingPrices(box);
      if (meta && meta.resync) boxRpc.rematerializeSales(box);
      else {
        if (tables.includes("sales") || tables.includes("sale_items")) boxRpc.dropOrphanSaleItems(box);
        if (tables.includes("products") && ids && ids.products) {
          const moved = boxRpc.relinkSaleProducts(box);
          boxRpc.reapplyPendingSales(box, [...ids.products, ...moved]);
        }
      }
      if (tables.includes("products")) boxRpc.reapplyPendingOps(box, meta && meta.resync ? null : ids && ids.products);
    },
  });
const sell = (id, qty, price) =>
  boxRpc.forward(box, "record-sale", [{
    cart: [{ id, quantity: qty, price, finalPrice: price, name: "x" }],
    total: qty * price,
    paymentMethod: "card",
    discountTotal: 0,
    cashierId: 1,
    cashierName: "Ana",
    registerId: 1,
  }]);
const product = (extra = {}) => ({
  name: "Galletas",
  brand: "Marca",
  price: 12,
  cost_price: 8,
  sale_unit: "piece",
  has_discount: 0,
  prices: [],
  ...extra,
});
const flush = async () => {
  await boxRpc.syncOps(box);
  await boxRpc.syncPending(box);
};

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea ===");
  const t0 = performance.now();
  const a = await boxRpc.forward(box, "add-product", [
    product({ barcode: "100", stock: 10, has_discount: 1, prices: [{ type: "mayoreo", qty: 3, price: 10, unit: "piece" }] }),
  ]);
  const ms = performance.now() - t0;
  check(a.success === true && a.id < 0, "se crea al momento con id provisional", a);
  check(ms < 100, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  const aRow = box.prepare("SELECT * FROM products WHERE id = ?").get(a.id);
  check(aRow && aRow.stock === 10 && !!aRow.uid, "con su stock inicial en la caja", aRow);
  check(pricesOf(box, a.id).length === 1 && pricesOf(box, a.id)[0].id < 0, "y su promo por cantidad");
  await boxRpc.syncOps(box);
  const aHost = byUid(host, aRow.uid)[0];
  check(aHost && aHost.stock === 10 && pricesOf(host, aHost.id).length === 1, "el Host lo guarda con stock y promo", aHost);
  await waitFor(() => byUid(box, aRow.uid).length === 1 && byUid(box, aRow.uid)[0].id > 0 && pricesOf(box, byUid(box, aRow.uid)[0].id).some((x) => x.id > 0));
  const aBox = byUid(box, aRow.uid)[0];
  check(aBox && aBox.id === aHost.id && aBox.stock === 10, "la réplica cambia la provisional por la del Host", aBox);
  check(byCode(box, "100").length === 1, "sin duplicar");
  check(box.prepare("SELECT COUNT(*) c FROM product_prices WHERE id < 0 OR product_id < 0").get().c === 0, "sin promos sueltas");
  check(pricesOf(box, aBox.id).length === 1, "con una sola promo");

  console.log("=== B · sin Host: crear, vender, meter stock y editar ===");
  stopLive();
  await apiServer.stopServer();
  const b = await boxRpc.forward(box, "add-product", [product({ barcode: "200", stock: 5 })]);
  check(b.success === true && b.id < 0, "se crea sin Host", b);
  const bUid = box.prepare("SELECT uid FROM products WHERE id = ?").get(b.id).uid;
  const sale = await sell(b.id, 2, 12);
  check(sale.success === true && sale.pending === true, "se vende sin Host", sale);
  const st = await boxRpc.forward(box, "add-stock", [{ productId: b.id, quantity: "3", cashierId: 1 }]);
  check(st.success === true, "entra stock sin Host", st);
  const ed = await boxRpc.forward(box, "update-product", [b.id, product({ barcode: "200", name: "Galletas María", price: 13 })]);
  check(ed.success === true, "se edita sin Host", ed);
  const bLocal = box.prepare("SELECT * FROM products WHERE id = ?").get(b.id);
  check(bLocal.stock === 6 && bLocal.name === "Galletas María" && bLocal.price === 13, "la caja ya ve 5 − 2 + 3 = 6 y el nombre nuevo", bLocal);
  const opsOrder = opQueue.list(box, ["pending", "syncing"]).map((o) => o.channel);
  check(opsOrder[0] === "add-product", "el alta va primero en la cola", opsOrder);

  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await flush();
  const bHost = byUid(host, bUid)[0];
  check(bHost && bHost.stock === 6 && bHost.name === "Galletas María", "el Host queda igual: 6 y editado", bHost);
  const hostSale = host.prepare("SELECT * FROM sales WHERE folio = ?").get(sale.folio);
  const hostItem = hostSale && host.prepare("SELECT * FROM sale_items WHERE sale_id = ?").get(hostSale.id);
  check(hostItem && bHost && hostItem.product_id === bHost.id, "la venta queda ligada al producto real", hostItem);
  await waitFor(() => {
    const r = byUid(box, bUid)[0];
    return r && r.id > 0 && box.prepare("SELECT id FROM sales WHERE folio = ?").get(sale.folio)?.id > 0;
  });
  const bBox = byUid(box, bUid)[0];
  check(bBox && bBox.id === bHost.id && bBox.stock === 6, "la caja también: 6, sin descontar dos veces", bBox);
  check(byCode(box, "200").length === 1, "sin duplicar");

  console.log("=== C · editar no toca el stock ===");
  stopLive();
  await apiServer.stopServer();
  const ec = await boxRpc.forward(box, "update-product", [1, product({ barcode: "001", name: "Leche entera", price: 9 })]);
  check(ec.success === true, "se edita sin Host", ec);
  host.prepare("UPDATE products SET stock = stock - 3 WHERE id = 1").run(); // venta en el Host
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await flush();
  const leche = host.prepare("SELECT * FROM products WHERE id = 1").get();
  check(leche.stock === 7 && leche.name === "Leche entera" && leche.price === 9, "lo vendido en el Host se queda", leche);
  await waitFor(() => box.prepare("SELECT stock FROM products WHERE id = 1").get().stock === 7);
  check(box.prepare("SELECT stock FROM products WHERE id = 1").get().stock === 7, "y la caja lo ve");

  console.log("=== D · stock exacto necesita al Host ===");
  stopLive();
  await apiServer.stopServer();
  const exact = await boxRpc.forward(box, "update-product", [1, product({ barcode: "001", name: "Leche entera", stock: 50 })]);
  check(exact.success === false && exact.code === "HOST_REQUIRED", "se avisa", exact);
  check(box.prepare("SELECT stock FROM products WHERE id = 1").get().stock === 7, "y no cambia nada");

  console.log("=== E · código repetido ===");
  const e = await boxRpc.forward(box, "add-product", [product({ barcode: "300", name: "Chicle", price: 2 })]);
  check(e.success === true, "(Chicle creado en la caja sin Host)");
  const eUid = box.prepare("SELECT uid FROM products WHERE id = ?").get(e.id).uid;
  const eSale = await sell(e.id, 1, 2);
  check(eSale.success === true, "(y vendido)");
  const dupLocal = await boxRpc.forward(box, "add-product", [product({ barcode: "300", name: "Otro" })]);
  check(dupLocal.success === false && dupLocal.code === "BARCODE_TAKEN", "la caja frena su propio código repetido", dupLocal);
  host.prepare("INSERT INTO products (barcode, name, price, stock, sale_unit, is_active) VALUES ('300', 'Chicle Host', 2, 20, 'piece', 1)").run();
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await flush();
  const conflicts = opQueue.list(box, ["conflict"]);
  check(conflicts.length === 1 && conflicts[0].channel === "add-product", "el alta queda en revisión", conflicts.map((o) => o.lastError));
  check(!byUid(host, eUid).length && byCode(host, "300").length === 1, "el Host no duplica el código");
  const eHostSale = host.prepare("SELECT * FROM sales WHERE folio = ?").get(eSale.folio);
  const eItem = eHostSale && host.prepare("SELECT * FROM sale_items WHERE sale_id = ?").get(eHostSale.id);
  check(eItem && eItem.product_id === byCode(host, "300")[0].id, "la venta se liga al producto que ya existía", eItem);
  check(byCode(host, "300")[0].stock === 19, "y le descuenta lo vendido");
  check(offlineQueue.list(box, ["conflict", "pending"]).length === 0, "ninguna venta atorada");

  console.log("=== E2 · código interno repetido: el Host le da otro ===");
  stopLive();
  await apiServer.stopServer();
  const code = await boxRpc.forward(box, "get-next-barcode", []);
  const internal = typeof code === "string" ? code : productsCore.nextInternalBarcode(box);
  const i = await boxRpc.forward(box, "add-product", [product({ barcode: internal, name: "Tamal", price: 15, stock: 4 })]);
  check(i.success === true, "(Tamal con código interno, sin Host)");
  const iUid = box.prepare("SELECT uid FROM products WHERE id = ?").get(i.id).uid;
  const iSale = await sell(i.id, 1, 15);
  check(iSale.success === true, "(y vendido)");
  // Otra caja, también sin red, dio el mismo código a otro producto y subió antes.
  host.prepare("INSERT INTO products (barcode, name, price, stock, sale_unit, is_active) VALUES (?, 'Atole', 10, 9, 'piece', 1)").run(internal);
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await flush();
  const tamal = byUid(host, iUid)[0];
  check(tamal && tamal.barcode !== internal && productsCore.isInternalBarcode(tamal.barcode), "el Host le da el siguiente código libre", tamal);
  check(tamal && tamal.stock === 3, "con su stock: 4 − 1 vendido", tamal);
  check(host.prepare("SELECT stock FROM products WHERE barcode = ?").get(internal).stock === 9, "el Atole de la otra caja no se toca");
  const iHostSale = host.prepare("SELECT * FROM sales WHERE folio = ?").get(iSale.folio);
  const iItem = iHostSale && host.prepare("SELECT * FROM sale_items WHERE sale_id = ?").get(iHostSale.id);
  check(iItem && tamal && iItem.product_id === tamal.id, "la venta va al Tamal, no al Atole", iItem);
  check(!opQueue.list(box, ["conflict"]).some((o) => o.label && o.label.includes("Tamal")), "nada en revisión");
  await waitFor(() => byUid(box, iUid).length === 1 && byUid(box, iUid)[0].id > 0);
  const tamalBox = byUid(box, iUid)[0];
  check(tamalBox && tamalBox.barcode === tamal.barcode && tamalBox.stock === 3, "la caja ve el código nuevo y el stock", tamalBox);
  check(byCode(box, internal).length === 1 && byCode(box, internal)[0].name === "Atole", "y el Atole aparte");

  console.log("=== H · editar el stock de un producto recién creado ===");
  stopLive();
  await apiServer.stopServer();
  const h = await boxRpc.forward(box, "add-product", [product({ barcode: "800", name: "Nieve", price: 25, stock: 5 })]);
  const hUid = box.prepare("SELECT uid FROM products WHERE id = ?").get(h.id).uid;
  const hEdit = await boxRpc.forward(box, "update-product", [h.id, product({ barcode: "800", name: "Nieve", price: 25, stock: 8 })]);
  check(hEdit.success === true, "sin Host: se puede fijar su stock (sólo existe aquí)", hEdit);
  check(box.prepare("SELECT stock FROM products WHERE id = ?").get(h.id).stock === 8, "la caja ya ve 8");
  const hSale = await sell(h.id, 1, 25);
  check(hSale.success === true, "(se vende 1)");
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await flush();
  await waitFor(() => byUid(host, hUid)[0]?.stock === 7);
  check(byUid(host, hUid)[0]?.stock === 7, "el Host queda en 8 − 1 = 7 (viajó como diferencia)", byUid(host, hUid)[0]);
  await waitFor(() => byUid(box, hUid)[0]?.id > 0 && byUid(box, hUid)[0]?.stock === 7);
  check(byUid(box, hUid)[0]?.stock === 7, "y la caja también", byUid(box, hUid)[0]);
  // La pantalla sigue con el id provisional aunque la réplica ya lo cambió.
  const stale = await boxRpc.forward(box, "update-product", [h.id, product({ barcode: "800", name: "Nieve de limón", price: 26 })]);
  check(stale.success === true, "editar con el id viejo de la pantalla también funciona", stale);
  const staleStock = await boxRpc.forward(box, "add-stock", [{ productId: h.id, quantity: "2", cashierId: 1 }]);
  check(staleStock.success === true, "y sumarle stock", staleStock);
  await flush();
  await waitFor(() => byUid(host, hUid)[0]?.stock === 9 && byUid(host, hUid)[0]?.name === "Nieve de limón");
  check(byUid(host, hUid)[0]?.stock === 9 && byUid(host, hUid)[0]?.name === "Nieve de limón", "llegan al producto correcto en el Host", byUid(host, hUid)[0]);
  const hostOnly = await boxRpc.forward(box, "update-product", [1, product({ barcode: "001", name: "Leche entera", price: 9, stock: 40 })]);
  check(hostOnly.success === true && host.prepare("SELECT stock FROM products WHERE id = 1").get().stock === 40, "un producto del Host con stock exacto sigue yendo al Host", hostOnly);

  console.log("=== F · reenviar la misma alta ===");
  const before = byUid(host, bUid)[0];
  const again = productsCore.add(host, { ...product({ barcode: "200", stock: 5 }), uid: bUid });
  const after = byUid(host, bUid)[0];
  check(again.success === true && again.id === before.id && after.stock === before.stock, "un solo producto, sin sumar stock otra vez", after);

  console.log("=== G · borrar algo que aún no llega ===");
  stopLive();
  await apiServer.stopServer();
  const g = await boxRpc.forward(box, "add-product", [product({ barcode: "400" })]);
  const del = await boxRpc.forward(box, "delete-product", [g.id]);
  check(del.success === false && del.code === "NOT_YET_ON_HOST", "se avisa en vez de mandarlo", del);

  console.log(`\n=== productos local-first: ${pass} PASS / ${fail} FAIL ===`);
  void hostAdds;
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
