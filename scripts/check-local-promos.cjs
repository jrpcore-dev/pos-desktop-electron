"use strict";
/*
 * Local-first · promociones por categoría/marca y paquetes en la caja.
 *
 *   A) En línea: crear una promo es inmediato; sube sola y la réplica deja
 *      una sola fila (la del Host).
 *   B) Sin Host: categoría y producto nuevos; promo sobre esa categoría y
 *      paquete con un producto del Host y el nuevo; pausar el paquete y
 *      cambiarle el precio. Al volver, el Host los liga a sus ids reales.
 *   C) Un paquete inválido se frena en la caja con la regla del Host.
 *   D) Borrar un paquete que aún no llega al Host: se avisa, no se manda.
 *   E) Reenviar el mismo paquete no lo duplica ni repite sus productos.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-promos.cjs
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
const catalogCore = require(path.join(REPO, "src/main/catalog-core.js"));
const productsCore = require(path.join(REPO, "src/main/products-core.js"));
const promosCore = require(path.join(REPO, "src/main/promos-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lpromo-${process.pid}`);
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
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
host.prepare("INSERT INTO categories (id, name) VALUES (1, 'Bebidas')").run();
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active, category_id) VALUES (1, '001', 'Refresco', 18, 10, 'piece', 1, 1)").run();
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (2, '002', 'Papas', 15, 10, 'piece', 1)").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
// Handlers del Host: los MISMOS de main.js.
ipcRegistry.set("add-category", (e, data) => {
  const r = catalogCore.add(host, "categories", data);
  return r.success ? { success: true, id: r.id } : r;
});
ipcRegistry.set("add-product", (e, raw) => {
  const refs = catalogCore.resolveRefs(host, raw);
  return refs.success ? productsCore.add(host, refs.data) : refs;
});
ipcRegistry.set("save-group-promo", (e, promo) => promosCore.saveGroupPromo(host, promo || {}));
ipcRegistry.set("save-bundle", (e, bundle) => promosCore.saveBundle(host, bundle || {}));
ipcRegistry.set("set-bundle-active", (e, id, active, refs = {}) => promosCore.setBundleActive(host, id, active, refs && refs.uid));

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
const byUid = (db, table, uid) => db.prepare(`SELECT * FROM ${table} WHERE uid = ?`).all(uid);
const itemsOf = (db, bundleId) => db.prepare("SELECT * FROM bundle_items WHERE bundle_id = ? ORDER BY slot, product_id").all(bundleId);
// El mismo enganche y en el mismo orden que main.js.
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables) => {
      if (tables.includes("products")) boxRpc.reapplyPendingRows(box, "products");
      for (const t of ["categories", "group_promos", "bundles"]) if (tables.includes(t)) boxRpc.reapplyPendingRows(box, t);
      if (["bundles", "bundle_items", "products"].some((t) => tables.includes(t))) boxRpc.reapplyPendingBundleItems(box);
    },
  });

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea ===");
  const t0 = performance.now();
  const a = await boxRpc.forward(box, "save-group-promo", [{ name: "Bebidas 10%", scope: "category", category_id: 1, percent: 10 }]);
  const ms = performance.now() - t0;
  check(a.success === true && a.id < 0, "se crea al momento", a);
  // 250 ms: sigue siendo muy por debajo de un viaje real al Host, pero tolera
  // un runner de CI cargado (ahí llegó a medir 106 ms).
  check(ms < 250, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  const aUid = box.prepare("SELECT uid FROM group_promos WHERE id = ?").get(a.id).uid;
  await boxRpc.syncOps(box);
  check(byUid(host, "group_promos", aUid).length === 1, "el Host la guarda");
  await waitFor(() => byUid(box, "group_promos", aUid)[0]?.id > 0);
  check(box.prepare("SELECT COUNT(*) c FROM group_promos").get().c === 1, "la réplica deja una sola fila");

  console.log("=== B · sin Host: categoría, producto, promo y paquete nuevos ===");
  stopLive();
  await apiServer.stopServer();
  const cat = await boxRpc.forward(box, "add-category", [{ name: "Botanas" }]);
  const prod = await boxRpc.forward(box, "add-product", [{ barcode: "700", name: "Cacahuates", price: 12, sale_unit: "piece", prices: [] }]);
  check(cat.success === true && prod.success === true, "(categoría y producto creados sin Host)");
  const catUid = cat.row.uid;
  const prodUid = box.prepare("SELECT uid FROM products WHERE id = ?").get(prod.id).uid;
  const gp = await boxRpc.forward(box, "save-group-promo", [{ name: "Botanas 15%", scope: "category", category_id: cat.id, percent: 15 }]);
  check(gp.success === true, "promo sobre la categoría nueva", gp);
  const bun = await boxRpc.forward(box, "save-bundle", [{ name: "Combo botana", price: 40, slots: [{ qty: 1, productIds: [1] }, { qty: 1, productIds: [2, prod.id] }] }]);
  check(bun.success === true && bun.id < 0, "paquete con un producto del Host y el nuevo", bun);
  check(itemsOf(box, bun.id).length === 3, "sus productos ya se ven en la caja");
  const bunUid = box.prepare("SELECT uid FROM bundles WHERE id = ?").get(bun.id).uid;
  const off = await boxRpc.forward(box, "set-bundle-active", [bun.id, false]);
  const edit = await boxRpc.forward(box, "save-bundle", [{ id: bun.id, name: "Combo botana", price: 38, is_active: false, slots: [{ qty: 1, productIds: [1] }, { qty: 1, productIds: [2, prod.id] }] }]);
  check(off.success === true && edit.success === true, "pausarlo y cambiarle el precio sin Host");
  check(box.prepare("SELECT price, is_active FROM bundles WHERE id = ?").get(bun.id).price === 38, "la caja ya lo ve a $38");

  console.log("=== C · paquete inválido ===");
  const bad = await boxRpc.forward(box, "save-bundle", [{ name: "Uno solo", price: 10, slots: [{ qty: 1, productIds: [1] }] }]);
  check(bad.success === false && bad.code === "TOO_FEW", "se frena en la caja", bad);

  console.log("=== D · borrar algo que aún no llega ===");
  const del = await boxRpc.forward(box, "delete-bundle", [bun.id]);
  check(del.success === false && del.code === "NOT_YET_ON_HOST", "se avisa en vez de mandarlo", del);

  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await boxRpc.syncOps(box);
  await waitFor(() => opQueue.countOpen(box) === 0);
  check(opQueue.list(box, ["conflict"]).length === 0, "nada en revisión", opQueue.list(box, ["conflict"]).map((o) => o.lastError));
  const hCat = byUid(host, "categories", catUid)[0];
  const hProd = byUid(host, "products", prodUid)[0];
  const hPromo = byUid(host, "group_promos", gp && box.prepare("SELECT uid FROM group_promos WHERE name = 'Botanas 15%'").get().uid)[0];
  check(hPromo && hCat && hPromo.category_id === hCat.id, "la promo queda en la categoría real del Host", hPromo);
  const hBun = byUid(host, "bundles", bunUid)[0];
  check(hBun && hBun.price === 38 && hBun.is_active === 0, "el paquete llega pausado y a $38", hBun);
  const hItems = hBun ? itemsOf(host, hBun.id).map((i) => i.product_id).sort() : [];
  check(hProd && JSON.stringify(hItems) === JSON.stringify([1, 2, hProd.id].sort()), "con sus productos reales (el nuevo con su id del Host)", hItems);
  await waitFor(() => {
    const b = byUid(box, "bundles", bunUid)[0];
    return b && b.id > 0 && itemsOf(box, b.id).length === 3 && itemsOf(box, b.id).every((i) => i.id > 0);
  });
  const bBun = byUid(box, "bundles", bunUid)[0];
  check(bBun && bBun.id === hBun.id && itemsOf(box, bBun.id).length === 3, "la caja queda igual, sin duplicar");
  check(box.prepare("SELECT COUNT(*) c FROM bundle_items WHERE id < 0 OR bundle_id < 0").get().c === 0, "sin productos de paquete sueltos");

  console.log("=== E · reenviar el mismo paquete ===");
  const again = promosCore.saveBundle(host, { uid: bunUid, name: "Combo botana", price: 38, is_active: false, slots: [{ qty: 1, productIds: [1] }, { qty: 1, productIds: [2], productUids: [prodUid] }] });
  check(again.success === true && byUid(host, "bundles", bunUid).length === 1 && itemsOf(host, hBun.id).length === 3, "un solo paquete con sus 3 productos");

  stopLive();
  await apiServer.stopServer();
  console.log(`\n=== promos y paquetes local-first: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
