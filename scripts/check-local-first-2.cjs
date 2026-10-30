"use strict";
/*
 * Local-first · paso 2: agregar/reducir stock en la caja con cola.
 *
 *   A) En línea: la caja aplica al momento (sin esperar red) y la operación
 *      sube sola; Host y caja terminan con el MISMO stock (sin doble suma).
 *   B) Sin Host: se aplica local, queda en cola, aparece en Movimientos como
 *      pendiente y cerrar caja se bloquea; al volver el Host sube sola.
 *   C) La réplica pisa la fila de producto con la del Host (que aún no tiene
 *      la operación): la cola la vuelve a aplicar encima.
 *   D) El Host rechaza (stock insuficiente allá): queda "conflict", el efecto
 *      local se deshace y se puede quitar.
 *   E) Reintento de la misma operación: el Host la reconoce por su llave y no
 *      la aplica dos veces.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-local-first-2.cjs
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
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-lf2-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3562;
const HOST_URL = `http://127.0.0.1:${PORT}`;

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

// ── Host ────────────────────────────────────────────────────────────────────
const host = fixture.createFileDb(path.join(TMP, "host.db"));
const p = hashPin("1111");
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active) VALUES (1, '001', 'Leche', 8, 100, 'piece', 1)").run();
activation.registerPairing(host, { deviceId: "box-a", deviceName: "Caja 2", token: "tok-a", deviceType: "desktop_box", approved: 1 });

// Handlers del Host con la regla que importa aquí (mismo contrato que main.js).
let hostAddCalls = 0;
ipcRegistry.set("add-stock", (e, { productId, quantity }) => {
  hostAddCalls += 1;
  const qty = parseInt(quantity, 10);
  host.transaction(() => {
    host.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(qty, productId);
    host.prepare("INSERT INTO stock_movements (product_id, type, quantity, notes) VALUES (?, 'in', ?, 'Compra')").run(productId, qty);
  })();
  return { success: true, productName: "Leche" };
});
ipcRegistry.set("remove-stock", (e, { productId, quantity }) => {
  const qty = parseInt(quantity, 10);
  const info = host.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?").run(qty, productId, qty);
  if (!info.changes) return { success: false, code: "INSUFFICIENT_STOCK", error: "Stock insuficiente" };
  host.prepare("INSERT INTO stock_movements (product_id, type, quantity, notes) VALUES (?, 'out', ?, 'Salida')").run(productId, qty);
  return { success: true };
});
// Lectura local de Movimientos: la versión mínima del handler real.
ipcRegistry.set("get-stock-movements", () =>
  box.prepare("SELECT sm.*, p.name AS product_name FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id ORDER BY sm.id DESC").all(),
);

// ── Caja ────────────────────────────────────────────────────────────────────
const box = fixture.createFileDb(path.join(TMP, "box.db"));
activation.setSetting(box, "device_role", "client");
dbSchema.ensureTriggersForRole(box);
activation.setSetting(box, clientLink.SETTINGS.HOST_URL, HOST_URL);
activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, "box-a");
clientLink.savePairedToken(box, "tok-a");
box.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'admin', '', 1, ?, ?)").run(p.hash, p.salt);

const stockOf = (db) => db.prepare("SELECT stock FROM products WHERE id = 1").get().stock;
const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return fn();
};
const openOps = () => opQueue.countOpen(box);

(async () => {
  check((await apiServer.startServer(host, PORT)).success === true, "Host arranca");
  check((await replicaEngine.downloadSnapshot(box)).success === true, "copia inicial de la caja");
  check((await boxRpc.verifyPin(box, 1, "1111")).success === true, "login de la caja en el Host");
  let stopLive = replicaLive.startLiveSync({
    db: box,
    onChanged: (tables, ids) => {
      if (tables.includes("products")) boxRpc.reapplyPendingOps(box, ids && ids.products);
    },
  });
  await waitFor(() => replicaLive.liveState(box).state === "connected");

  console.log("=== A · en línea ===");
  const t0 = performance.now();
  const r1 = await boxRpc.forward(box, "add-stock", [{ productId: 1, quantity: "5", cashierId: 1 }]);
  const ms = performance.now() - t0;
  check(r1.success === true && r1.queued === true && r1.productName === "Leche", "agregar stock responde al momento", JSON.stringify(r1));
  check(stockOf(box) === 105, "la caja ya ve 105 sin esperar al Host", String(stockOf(box)));
  check(ms < 200, "la pantalla no espera a la red", `${ms.toFixed(0)} ms`);
  check(await waitFor(() => openOps() === 0), "la operación sube sola");
  check(await waitFor(() => stockOf(host) === 105 && stockOf(box) === 105), "Host y caja terminan en 105 (sin doble suma)", `host=${stockOf(host)} caja=${stockOf(box)}`);
  check(await waitFor(() => box.prepare("SELECT COUNT(*) c FROM stock_movements").get().c === 1), "el movimiento del Host llega a la copia de la caja");

  console.log("=== B · sin Host ===");
  stopLive();
  await apiServer.stopServer();
  const r2 = await boxRpc.forward(box, "add-stock", [{ productId: 1, quantity: "3", cashierId: 1 }]);
  check(r2.success === true && stockOf(box) === 108, "sin Host: se aplica local (108)", `${JSON.stringify(r2)} stock=${stockOf(box)}`);
  await boxRpc.syncOps(box);
  check(openOps() === 1, "queda en cola mientras no hay Host", String(openOps()));
  const movs = await boxRpc.forward(box, "get-stock-movements", [{}]);
  check(Array.isArray(movs) && movs[0] && movs[0].pending === "pending" && movs[0].quantity === 3, "Movimientos lo muestra arriba como pendiente", JSON.stringify(movs && movs[0]));
  const close = await boxRpc.forward(box, "close-cash-register", [{}]);
  check(close && close.code === "PENDING_OPS", "cerrar caja se bloquea con movimientos sin subir", JSON.stringify(close));
  // Cerrar caja dispara una subida en segundo plano: se espera a que termine
  // (sin Host vuelve a `pending`; mientras está en vuelo no se reaplica).
  await boxRpc.syncOps(box);
  check(opQueue.list(box, ["pending"]).length === 1, "tras el intento fallido vuelve a pendiente");

  console.log("=== C · la réplica pisa el producto ===");
  // Llega la fila del Host (105, sin la operación pendiente): no debe "perderse".
  const hostRow = host.prepare("SELECT * FROM products WHERE id = 1").get();
  replicaEngine.applyChanges(box, [{ seq: 999999, tbl: "products", op: "upsert", row_id: "1", row: hostRow }]);
  check(stockOf(box) === 105, "(la fila del Host deja 105)", String(stockOf(box)));
  boxRpc.reapplyPendingOps(box, ["1"]);
  check(stockOf(box) === 108, "la cola reaplica lo pendiente → 108", String(stockOf(box)));
  activation.setSetting(box, replicaEngine.KEYS.LAST_SEQ, "0"); // el seq de prueba no existe en el Host

  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  const sync = await boxRpc.syncOps(box);
  check(sync.synced === 1 && openOps() === 0, "al volver sube sola", JSON.stringify(sync));
  check(stockOf(host) === 108, "el Host suma la entrada hecha sin conexión (108)", String(stockOf(host)));

  console.log("=== D · el Host rechaza ===");
  host.prepare("UPDATE products SET stock = 2 WHERE id = 1").run(); // en el Host ya no hay
  await apiServer.stopServer(); // para que la caja no reciba aún el cambio
  const r3 = await boxRpc.forward(box, "remove-stock", [{ productId: 1, quantity: "50", role: "admin", cashierId: 1 }]);
  check(r3.success === true && stockOf(box) === 58, "la caja aplica la salida local (108 − 50)", `${JSON.stringify(r3)} stock=${stockOf(box)}`);
  check((await apiServer.startServer(host, PORT)).success === true, "vuelve el Host");
  // La subida de fondo pudo haberla resuelto ya; lo que importa es el estado.
  await boxRpc.syncOps(box);
  await boxRpc.syncOps(box);
  const rejected = opQueue.list(box, ["conflict"]);
  check(rejected.length === 1 && /insuficiente/i.test(rejected[0].lastError || ""), "el Host la rechaza → queda en revisión con el motivo", JSON.stringify(rejected));
  check(stockOf(box) === 108, "el efecto local se deshace (vuelve a 108)", String(stockOf(box)));
  check(boxRpc.opsSummary(box).conflicts === 1, "el aviso cuenta el rechazo");
  check(boxRpc.opsCancel(box, rejected[0].id).success === true && boxRpc.opsSummary(box).count === 0, "se puede quitar sin volver a tocar el stock");
  check(stockOf(box) === 108, "…y el stock local no cambia al quitarla", String(stockOf(box)));
  const badLocal = await boxRpc.forward(box, "remove-stock", [{ productId: 1, quantity: "500", role: "admin" }]);
  check(badLocal.code === "INSUFFICIENT_STOCK" && opQueue.list(box).length === 3, "sin stock local ni se encola", JSON.stringify(badLocal));
  const notOwner = await boxRpc.forward(box, "remove-stock", [{ productId: 1, quantity: "1", role: "cashier" }]);
  check(notOwner.code === "FORBIDDEN", "salida de stock sólo para el propietario (como en el Host)", JSON.stringify(notOwner));

  console.log("=== E · reintento sin duplicar ===");
  const before = hostAddCalls;
  const hostBefore = stockOf(host);
  const first = opQueue.list(box, ["synced"]).find((o) => o.channel === "add-stock");
  box.prepare("UPDATE pending_ops SET status = 'pending' WHERE id = ?").run(first.id);
  const s3 = await boxRpc.syncOps(box);
  check(s3.synced === 1 && hostAddCalls === before && stockOf(host) === hostBefore, "el Host reconoce la llave y no la aplica dos veces", `llamadas=${hostAddCalls - before} stock=${stockOf(host)}`);

  await apiServer.stopServer();
  console.log(`\n=== local-first 2: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
