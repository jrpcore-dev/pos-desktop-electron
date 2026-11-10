"use strict";
/*
 * Local-first · precios especiales por nivel y por cliente en la caja.
 *
 *   A) En línea: poner un precio por nivel es inmediato; sube solo y la
 *      réplica deja una sola fila (la del Host).
 *   B) Sin Host: cliente y producto nuevos con su precio especial, y quitar un
 *      precio por nivel que venía del Host. Al volver, el Host liga el precio
 *      a sus ids reales y quita el otro.
 *   C) Cambiar el mismo precio dos veces sin Host: gana el último.
 *   D) La réplica trae los precios del Host antes de que suba el cambio: lo
 *      de la caja se vuelve a aplicar encima.
 *   E) El nivel se borró en el Host mientras tanto: queda en revisión y lo
 *      local se deshace.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-prices.cjs
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
const customersCore = require(path.join(REPO, "src/main/customers-core.js"));
const productsCore = require(path.join(REPO, "src/main/products-core.js"));
const catalogCore = require(path.join(REPO, "src/main/catalog-core.js"));
const pricesCore = require(path.join(REPO, "src/main/prices-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lprice-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3580;

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
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '001', 'Leche', 20, 10, 'piece', 1)").run();
host.prepare("INSERT INTO customer_tiers (id, name, position) VALUES (1, 'Mayoreo', 1), (2, 'Tienditas', 2)").run();
host.prepare("INSERT INTO tier_prices (tier_id, product_id, price) VALUES (2, 1, 17)").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
// Handlers del Host: los MISMOS de main.js.
ipcRegistry.set("add-customer", (e, data) => customersCore.addCustomer(host, data));
ipcRegistry.set("add-product", (e, raw) => {
  const refs = catalogCore.resolveRefs(host, raw);
  return refs.success ? productsCore.add(host, refs.data) : refs;
});
ipcRegistry.set("set-customer-price", (e, customerId, productId, price, refs = {}) =>
  pricesCore.set(host, "customer_prices", { ownerId: customerId, ownerUid: refs && refs.customerUid, productId, productUid: refs && refs.productUid, price }),
);
ipcRegistry.set("delete-customer-price", (e, id, refs = null) =>
  pricesCore.remove(host, "customer_prices", id, refs && { ownerId: refs.customerId, ownerUid: refs.customerUid, productId: refs.productId, productUid: refs.productUid }),
);
ipcRegistry.set("set-tier-price", (e, tierId, productId, price, refs = {}) =>
  pricesCore.set(host, "tier_prices", { ownerId: tierId, productId, productUid: refs && refs.productUid, price }),
);
ipcRegistry.set("delete-tier-price", (e, id, refs = null) =>
  pricesCore.remove(host, "tier_prices", id, refs && { ownerId: refs.tierId, productId: refs.productId, productUid: refs.productUid }),
);

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
const tierPrice = (db, tier, product) => db.prepare("SELECT * FROM tier_prices WHERE tier_id = ? AND product_id = ?").all(tier, product);
const custPrice = (db, cust, product) => db.prepare("SELECT * FROM customer_prices WHERE customer_id = ? AND product_id = ?").all(cust, product);
const negatives = (db) =>
  db.prepare("SELECT (SELECT COUNT(*) FROM tier_prices WHERE id < 0) + (SELECT COUNT(*) FROM customer_prices WHERE id < 0) AS c").get().c;
// El mismo enganche y en el mismo orden que main.js.
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables) => {
      if (tables.includes("products")) boxRpc.reapplyPendingRows(box, "products");
      if (tables.includes("customers")) boxRpc.reapplyPendingRows(box, "customers");
      if (["customer_prices", "tier_prices", "customers", "products"].some((t) => tables.includes(t))) boxRpc.reapplyPendingPairs(box);
    },
  });
const online = async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "(vuelve el Host)");
  const stop = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await boxRpc.syncOps(box);
  await waitFor(() => opQueue.countOpen(box) === 0);
  return stop;
};

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea ===");
  const t0 = performance.now();
  const a = await boxRpc.forward(box, "set-tier-price", [1, 1, 15]);
  const ms = performance.now() - t0;
  check(a.success === true && tierPrice(box, 1, 1)[0]?.price === 15, "se guarda al momento", a);
  check(ms < 100, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  await boxRpc.syncOps(box);
  check(tierPrice(host, 1, 1)[0]?.price === 15, "el Host lo guarda");
  await waitFor(() => tierPrice(box, 1, 1)[0]?.id > 0);
  check(tierPrice(box, 1, 1).length === 1 && tierPrice(box, 1, 1)[0].id === tierPrice(host, 1, 1)[0].id, "la réplica deja una sola fila, la del Host");
  check(negatives(box) === 0, "sin filas provisionales sueltas");

  console.log("=== B · sin Host: cliente y producto nuevos con precio ===");
  stopLive();
  await apiServer.stopServer();
  const c = await boxRpc.forward(box, "add-customer", [{ name: "Doña Rosa" }]);
  const pr = await boxRpc.forward(box, "add-product", [{ barcode: "500", name: "Tortillas", price: 22, sale_unit: "piece", prices: [] }]);
  check(c.success === true && pr.success === true, "(cliente y producto creados sin Host)");
  const cid = c.customer.id;
  const cUid = c.customer.uid;
  const pUid = box.prepare("SELECT uid FROM products WHERE id = ?").get(pr.id).uid;
  const sc = await boxRpc.forward(box, "set-customer-price", [cid, pr.id, 19]);
  check(sc.success === true && custPrice(box, cid, pr.id)[0]?.price === 19, "su precio especial ya se ve", sc);
  const tierRow = tierPrice(box, 2, 1)[0];
  const dt = await boxRpc.forward(box, "delete-tier-price", [tierRow.id]);
  check(dt.success === true && tierPrice(box, 2, 1).length === 0, "quitar un precio del Host sin Host", dt);

  console.log("=== C · cambiarlo dos veces: gana el último ===");
  await boxRpc.forward(box, "set-customer-price", [cid, pr.id, 18]);
  check(custPrice(box, cid, pr.id)[0]?.price === 18, "(ahora 18)");

  stopLive = await online();
  const hostCust = host.prepare("SELECT id FROM customers WHERE uid = ?").get(cUid);
  const hostProd = host.prepare("SELECT id FROM products WHERE uid = ?").get(pUid);
  check(hostCust && hostProd && custPrice(host, hostCust.id, hostProd.id)[0]?.price === 18, "el Host lo liga a sus ids y queda el último", [hostCust, hostProd]);
  check(tierPrice(host, 2, 1).length === 0, "y quita el precio por nivel");
  await waitFor(() => {
    const bc = box.prepare("SELECT id FROM customers WHERE uid = ?").get(cUid);
    const bp = box.prepare("SELECT id FROM products WHERE uid = ?").get(pUid);
    return bc && bp && bc.id > 0 && bp.id > 0 && custPrice(box, bc.id, bp.id)[0]?.id > 0 && negatives(box) === 0;
  });
  const bc = box.prepare("SELECT id FROM customers WHERE uid = ?").get(cUid);
  const bp = box.prepare("SELECT id FROM products WHERE uid = ?").get(pUid);
  check(custPrice(box, bc.id, bp.id).length === 1 && custPrice(box, bc.id, bp.id)[0].price === 18, "la caja queda con una sola fila, ya con los ids del Host");
  check(negatives(box) === 0 && box.prepare("SELECT COUNT(*) c FROM customer_prices").get().c === 1, "sin filas sueltas");

  console.log("=== D · la réplica llega antes que el cambio ===");
  stopLive();
  await apiServer.stopServer();
  await boxRpc.forward(box, "set-tier-price", [1, 1, 14]);
  await waitFor(() => opQueue.list(box, ["syncing"]).length === 0);
  // La réplica reescribe la fila con la del Host (aún 15).
  box.prepare("UPDATE tier_prices SET price = 15 WHERE tier_id = 1 AND product_id = 1").run();
  boxRpc.reapplyPendingPairs(box);
  check(tierPrice(box, 1, 1).length === 1 && tierPrice(box, 1, 1)[0].price === 14, "se vuelve a aplicar encima", tierPrice(box, 1, 1));

  console.log("=== E · el nivel se borró en el Host ===");
  await boxRpc.forward(box, "set-tier-price", [2, 1, 16]);
  check(tierPrice(box, 2, 1)[0]?.price === 16, "(precio para Tienditas sin Host)");
  host.prepare("DELETE FROM customer_tiers WHERE id = 2").run();
  stopLive = await online();
  const conflicts = opQueue.list(box, ["conflict"]);
  check(conflicts.length === 1 && conflicts[0].channel === "set-tier-price", "queda en revisión", conflicts.map((o) => o.lastError));
  check(tierPrice(box, 2, 1).length === 0, "y lo local se deshace");
  check(tierPrice(host, 1, 1)[0]?.price === 14, "lo otro sí sube (14)");

  stopLive();
  await apiServer.stopServer();
  console.log(`\n=== precios por nivel y cliente local-first: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
