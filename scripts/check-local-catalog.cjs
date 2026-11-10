"use strict";
/*
 * Local-first · categorías y proveedores en la caja.
 *
 *   A) En línea: crear es inmediato; sube solo y la réplica cambia la fila
 *      provisional por la del Host sin duplicarla.
 *   B) Sin Host: crear y editar un proveedor; al volver sube con su edición.
 *   C) Nombre de categoría repetido: la caja lo frena; si otra caja lo creó
 *      antes en el Host, queda en revisión y lo local se deshace.
 *   D) Un producto con la categoría y el proveedor recién creados: el Host los
 *      liga a sus ids.
 *   E) Borrar algo que aún no llega al Host: se avisa, no se manda.
 *   F) Reenviar la misma alta no duplica.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-catalog.cjs
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
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lcat-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3576;

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
// Handlers del Host: las MISMAS reglas que main.js (catalog-core).
let hostAdds = 0;
ipcRegistry.set("add-category", (e, data) => {
  hostAdds += 1;
  const r = catalogCore.add(host, "categories", data);
  return r.success ? { success: true, id: r.id } : r;
});
ipcRegistry.set("update-category", (e, id, data) => catalogCore.update(host, "categories", id, data));
ipcRegistry.set("add-supplier", (e, data) => {
  const r = catalogCore.add(host, "suppliers", data);
  return r.success ? { success: true, id: r.id } : r;
});
ipcRegistry.set("update-supplier", (e, id, data) => catalogCore.update(host, "suppliers", id, data));
// add-product mínimo con la misma traducción de referencias que main.js.
ipcRegistry.set("add-product", (e, raw) => {
  const refs = catalogCore.resolveRefs(host, raw);
  if (!refs.success) return refs;
  const d = refs.data;
  const info = host
    .prepare("INSERT INTO products (barcode, name, price, stock, sale_unit, is_active, category_id, supplier_id) VALUES (?, ?, ?, 0, 'piece', 1, ?, ?)")
    .run(d.barcode, d.name, d.price, d.category_id || null, d.supplier_id || null);
  return { success: true, id: Number(info.lastInsertRowid) };
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
ipcRegistry.set("get-categories", () => box.prepare("SELECT * FROM categories ORDER BY name").all());

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const byUid = (db, table, uid) => db.prepare(`SELECT * FROM ${table} WHERE uid = ?`).all(uid);
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables) => {
      for (const t of ["categories", "suppliers"]) if (tables.includes(t)) boxRpc.reapplyPendingRows(box, t);
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
  const a = await boxRpc.forward(box, "add-category", [{ name: "Lácteos" }]);
  const ms = performance.now() - t0;
  check(a.success === true && a.id < 0 && a.row && !!a.row.uid, "se crea al momento con id provisional", a);
  check(ms < 100, "sin esperar al Host", `${ms.toFixed(0)} ms`);
  const lacUid = a.row.uid;
  const listed = await boxRpc.forward(box, "get-categories", []);
  check(listed.some((c) => c.uid === lacUid), "aparece en la lista de la caja");
  await boxRpc.syncOps(box);
  check(byUid(host, "categories", lacUid).length === 1, "el Host la guarda con su id");
  await waitFor(() => byUid(box, "categories", lacUid).length === 1 && byUid(box, "categories", lacUid)[0].id > 0);
  check(byUid(box, "categories", lacUid)[0].id === byUid(host, "categories", lacUid)[0].id, "la réplica cambia la provisional por la del Host");
  check(box.prepare("SELECT COUNT(*) c FROM categories WHERE name = 'Lácteos'").get().c === 1, "sin duplicar");

  console.log("=== B · sin Host: crear y editar un proveedor ===");
  stopLive();
  await apiServer.stopServer();
  const b = await boxRpc.forward(box, "add-supplier", [{ name: "Lala", phone: "111" }]);
  check(b.success === true && b.id < 0, "se crea sin Host", b);
  const edit = await boxRpc.forward(box, "update-supplier", [b.id, { name: "Lala S.A.", phone: "222" }]);
  check(edit.success === true && byUid(box, "suppliers", b.row.uid)[0].name === "Lala S.A.", "se edita sin Host", edit);

  console.log("=== C · nombre repetido ===");
  const dup = await boxRpc.forward(box, "add-category", [{ name: "Lácteos" }]);
  check(dup.success === false && dup.code === "NAME_TAKEN", "la caja frena el nombre repetido", dup);
  const beb = await boxRpc.forward(box, "add-category", [{ name: "Bebidas" }]);
  check(beb.success === true, "(Bebidas creada en la caja sin Host)");
  host.prepare("INSERT INTO categories (name) VALUES ('Bebidas')").run(); // otra caja se adelantó

  console.log("=== D · producto con categoría y proveedor nuevos ===");
  const snacks = await boxRpc.forward(box, "add-category", [{ name: "Botanas" }]);
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  const prod = await boxRpc.forward(box, "add-product", [{ barcode: "777", name: "Papas", price: 15, category_id: snacks.id, supplier_id: b.id }]);
  check(prod && prod.success === true, "el producto se guarda", prod);
  const hostProd = host.prepare("SELECT category_id, supplier_id FROM products WHERE barcode = '777'").get();
  const hostSnacks = byUid(host, "categories", snacks.row.uid)[0];
  const hostLala = byUid(host, "suppliers", b.row.uid)[0];
  check(hostProd && hostSnacks && hostProd.category_id === hostSnacks.id, "queda en la categoría real del Host", hostProd);
  check(hostProd && hostLala && hostProd.supplier_id === hostLala.id && hostLala.name === "Lala S.A.", "y con el proveedor real, ya editado", hostLala);
  check(opQueue.list(box, ["conflict"]).length === 1, "Bebidas repetida queda en revisión", opQueue.list(box, ["conflict"]).map((o) => o.lastError));
  check(!byUid(box, "categories", beb.row.uid).length, "y su fila provisional se deshace");

  console.log("=== E · borrar algo que aún no llega ===");
  const pend = await boxRpc.forward(box, "add-category", [{ name: "Limpieza" }]);
  const del = await boxRpc.forward(box, "delete-category", [pend.id]);
  check(del.success === false && del.code === "NOT_YET_ON_HOST", "se avisa en vez de mandarlo", del);
  await boxRpc.syncOps(box);

  console.log("=== F · reenviar la misma alta no duplica ===");
  const before = hostAdds;
  const again = catalogCore.add(host, "categories", { name: "Lácteos", uid: lacUid });
  check(again.success === true && byUid(host, "categories", lacUid).length === 1, "misma alta, una sola categoría");
  check(hostAdds === before, "(sin pasar por la cola)");

  await apiServer.stopServer();
  console.log(`\n=== catálogo local-first: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
