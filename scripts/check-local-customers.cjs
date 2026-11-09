"use strict";
/*
 * Local-first · clientes en la caja (piloto del mecanismo único).
 *
 *   A) En línea: crear un cliente es inmediato; sube solo y la réplica cambia
 *      la fila provisional (id negativo) por la del Host sin duplicarla.
 *   B) Sin Host: crear, editar y venderle a un cliente nuevo; al volver el
 *      Host, el cliente sube primero y la venta queda ligada a él.
 *   C) La réplica pisa un cliente con una edición local pendiente: se reaplica.
 *   D) El Host rechaza una edición: queda en revisión y lo local se deshace.
 *   E) Reenviar la misma alta no duplica al cliente.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-customers.cjs
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
const customersCore = require(path.join(REPO, "src/main/customers-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lc-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3572;

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
host.prepare("INSERT INTO customers (id, name, phone) VALUES (5, 'Cliente del Host', '555')").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });
activation.approveDevice(host, "box-a");
host.prepare("UPDATE paired_devices SET device_code = 'A' WHERE device_id = 'box-a'").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'box-a')").run();

// Handlers del Host: las MISMAS reglas que main.js (customers-core).
let hostAdds = 0;
ipcRegistry.set("add-customer", (e, data) => {
  hostAdds += 1;
  return customersCore.addCustomer(host, data);
});
ipcRegistry.set("update-customer", (e, id, data) => customersCore.updateCustomer(host, id, data));

// ── Caja ─────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, `http://127.0.0.1:${PORT}`);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, "A");
clientLink.savePairedToken(box, "tok-a");
box.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
// Lectura local mínima (en la app es el handler real de main.js con la BD de la caja).
ipcRegistry.set("search-customers", () => box.prepare("SELECT * FROM customers ORDER BY name").all());

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const timed = async (fn) => {
  const t0 = performance.now();
  const r = await fn();
  return { r, ms: performance.now() - t0 };
};
const boxRow = (uid) => box.prepare("SELECT * FROM customers WHERE uid = ?").all(uid);
const hostRow = (uid) => host.prepare("SELECT * FROM customers WHERE uid = ?").all(uid);
const startLive = () =>
  replicaLive.startLiveSync({
    db: box,
    onChanged: (tables) => {
      if (tables.includes("customers")) boxRpc.reapplyPendingRows(box, "customers");
    },
  });

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea ===");
  const a = await timed(() => boxRpc.forward(box, "add-customer", [{ name: "Rosa", phone: "111" }]));
  check(a.r.success === true && a.r.customer.id < 0 && !!a.r.customer.uid, "se crea al momento con id provisional", a.r);
  check(a.ms < 100, "sin esperar al Host", `${a.ms.toFixed(0)} ms`);
  const rosaUid = a.r.customer.uid;
  const listed = await boxRpc.forward(box, "search-customers", [""]);
  check(listed.some((c) => c.uid === rosaUid), "aparece en la búsqueda de la caja");
  await boxRpc.syncOps(box);
  check(hostRow(rosaUid).length === 1 && hostRow(rosaUid)[0].qr_code === `CLI-${hostRow(rosaUid)[0].id}`, "el Host la guarda con su id y QR", hostRow(rosaUid));
  await waitFor(() => boxRow(rosaUid).length === 1 && boxRow(rosaUid)[0].id > 0);
  check(boxRow(rosaUid).length === 1 && boxRow(rosaUid)[0].id === hostRow(rosaUid)[0].id, "la réplica cambia la provisional por la del Host, sin duplicar", boxRow(rosaUid));

  console.log("=== B · sin Host: crear, editar y venderle ===");
  stopLive();
  await apiServer.stopServer();
  const b = await boxRpc.forward(box, "add-customer", [{ name: "Beto", phone: "222" }]);
  check(b.success === true && b.customer.id < 0, "se crea sin Host", b);
  const betoId = b.customer.id;
  const betoUid = b.customer.uid;
  const edit = await boxRpc.forward(box, "update-customer", [betoId, { name: "Beto Pérez", phone: "222" }]);
  check(edit.success === true && boxRow(betoUid)[0].name === "Beto Pérez", "se edita sin Host", edit);
  const sale = await boxRpc.forward(box, "record-sale", [{
    cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }],
    total: 8,
    paymentMethod: "cash",
    discountTotal: 0,
    cashierId: 1,
    cashierName: "Ana",
    registerId: 1,
    customerId: betoId,
  }]);
  check(sale.success === true && sale.offline === true, "se le vende sin Host", sale);
  const queued = offlineQueue.list(box, ["pending"]).at(-1);
  check(queued && queued.payload.customerUid === betoUid, "la venta guarda el uid del cliente, no el id provisional", queued && queued.payload);

  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  await boxRpc.syncPending(box);
  const hostBeto = hostRow(betoUid);
  check(hostBeto.length === 1 && hostBeto[0].name === "Beto Pérez", "el cliente sube con su edición", hostBeto);
  const hostSale = host.prepare("SELECT customer_id FROM sales ORDER BY id DESC LIMIT 1").get();
  check(hostSale && hostSale.customer_id === (hostBeto[0] && hostBeto[0].id), "la venta queda ligada al cliente en el Host", hostSale);
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await waitFor(() => boxRow(betoUid).length === 1 && boxRow(betoUid)[0].id > 0);
  check(box.prepare("SELECT COUNT(*) c FROM customers WHERE id < 0").get().c === 0, "no quedan clientes provisionales en la caja");

  console.log("=== C · la réplica no borra una edición pendiente ===");
  stopLive();
  const hostId = 5;
  await apiServer.stopServer();
  await boxRpc.forward(box, "update-customer", [hostId, { name: "Editado en caja", phone: "555" }]);
  host.prepare("UPDATE customers SET phone = '999' WHERE id = ?").run(hostId);
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  stopLive = startLive();
  await waitFor(() => replicaLive.liveState(box).state === "connected");
  await new Promise((r) => setTimeout(r, 400));
  check(box.prepare("SELECT name FROM customers WHERE id = ?").get(hostId).name === "Editado en caja", "la edición local sigue visible tras la réplica");
  await boxRpc.syncOps(box);
  check(host.prepare("SELECT name FROM customers WHERE id = ?").get(hostId).name === "Editado en caja", "y sube al Host");

  console.log("=== D · el Host rechaza: se deshace y queda en revisión ===");
  const ghost = await boxRpc.forward(box, "add-customer", [{ name: "Gina" }]);
  await boxRpc.syncOps(box);
  await waitFor(() => boxRow(ghost.customer.uid).length === 1 && boxRow(ghost.customer.uid)[0].id > 0);
  const ginaId = boxRow(ghost.customer.uid)[0].id;
  host.prepare("DELETE FROM customers WHERE id = ?").run(ginaId);
  stopLive();
  await boxRpc.forward(box, "update-customer", [ginaId, { name: "Gina Ruiz" }]);
  check(box.prepare("SELECT name FROM customers WHERE id = ?").get(ginaId).name === "Gina Ruiz", "(edición aplicada en la caja)");
  const res = await boxRpc.syncOps(box);
  check(res.conflicts === 1, "el Host la rechaza", res);
  check(box.prepare("SELECT name FROM customers WHERE id = ?").get(ginaId).name === "Gina", "lo local vuelve a como estaba");
  check(opQueue.list(box, ["conflict"]).length === 1, "queda en revisión con su motivo", opQueue.list(box, ["conflict"]).map((o) => o.lastError));

  console.log("=== E · reenviar la misma alta no duplica ===");
  const before = hostAdds;
  const again = customersCore.addCustomer(host, { name: "Rosa", phone: "111", uid: rosaUid });
  check(again.success === true && hostRow(rosaUid).length === 1, "misma alta, un solo cliente", hostRow(rosaUid));
  check(hostAdds === before, "(sin pasar por la cola)");

  await apiServer.stopServer();
  console.log(`\n=== clientes local-first: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
