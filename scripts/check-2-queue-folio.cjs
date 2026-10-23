"use strict";
/*
 * Fase 2 · cola offline y folios, de punta a punta (caja real → Host real).
 *
 *   - una venta que el Host guardó pero cuya respuesta se perdió (timeout) y
 *     luego se sube desde la cola recibe la respuesta ORIGINAL, no un 422;
 *   - la cola conserva el cliente de la venta;
 *   - el prefijo del folio es el código completo (A2 no comparte serie con A)
 *     y el Host rechaza folios de otra serie;
 *   - una caja reinstalada (contador local en 1) realinea su serie con el Host
 *     y la venta entra al primer reintento;
 *   - tras un login correcto, lo que esperaba sesión vuelve a subir;
 *   - una venta que llega tras el corte avisa LATE_SYNC_CLOSED_REGISTER.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-2-queue-folio.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));
const offlineQueue = require(path.join(REPO, "src/main/offline-queue.js"));
const salesCore = require(path.join(REPO, "src/main/sales-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const PORT = 3522;
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

// Cifrado de prueba (en Electron real es safeStorage).
clientLink.setSecretCipher({
  available: () => true,
  encrypt: (plain) => Buffer.from("T:" + plain, "utf8").toString("base64"),
  decrypt: (b64) => Buffer.from(String(b64), "base64").toString("utf8").slice(2),
});

// ── Host ────────────────────────────────────────────────────────────────────
const host = fixture.createMemoryDb();
const p = hashPin("1111");
host.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'cashier', '', 1, ?, ?)").run(p.hash, p.salt);
host.prepare("INSERT INTO customers (id, name) VALUES (7, 'Cliente Siete')").run();
host.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1, '001', 'Leche', 8, 100, 'piece')").run();
const pair = (id, token, code) => {
  activation.registerPairing(host, { deviceId: id, deviceName: id, token, deviceType: "desktop_box", approved: 1 });
  if (code) host.prepare("UPDATE paired_devices SET device_code = ? WHERE device_id = ?").run(code, id);
};
pair("box-a", "tok-a", "A");
pair("box-a2", "tok-a2", "A2");
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, 'box-a')").run();
host.prepare("INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (2, date('now'), 'open', 1, 'box-a2')").run();

// ── Caja (su propia BD) ─────────────────────────────────────────────────────
const makeBox = (id, token, code) => {
  const box = fixture.createMemoryDb();
  activation.setSetting(box, clientLink.SETTINGS.HOST_URL, HOST_URL);
  activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_ID, id);
  activation.setSetting(box, clientLink.SETTINGS.BOX_DEVICE_CODE, code);
  clientLink.savePairedToken(box, token);
  box.prepare("INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1, 'Ana', 'cashier', '', 1, ?, ?)").run(p.hash, p.salt);
  return box;
};
const boxA = makeBox("box-a", "tok-a", "A");
const boxA2 = makeBox("box-a2", "tok-a2", "A2");

const cart = (qty) => [{ id: 1, quantity: qty, price: 8, finalPrice: 8 }];
const salePayload = (qty, extra = {}) => ({
  cart: cart(qty),
  total: 8 * qty,
  paymentMethod: "cash",
  discountTotal: 0,
  cashierId: 1,
  cashierName: "Ana",
  registerId: 1,
  ...extra,
});
const saleRow = (id) => host.prepare("SELECT * FROM sales WHERE id = ?").get(id);

(async () => {
  const started = await apiServer.startServer(host, PORT);
  check(started.success === true, "Host arranca", started.error);
  check((await boxRpc.verifyPin(boxA, 1, "1111")).success === true, "caja A: login en el Host");
  check((await boxRpc.verifyPin(boxA2, 1, "1111")).success === true, "caja A2: login en el Host");

  console.log("=== 2.1/2.2 · timeout tras commit + cliente en la cola ===");
  // La caja manda la venta en línea; el Host la guarda; la respuesta "se
  // pierde": se simula enviando con la misma clave y luego encolando.
  const payload = salePayload(1, { customerId: 7 });
  const online = await boxRpc.recordSale(boxA, payload);
  check(online.success === true && /^A-\d{6}$/.test(online.folio), "venta en línea con folio de la serie A", JSON.stringify(online));
  const first = saleRow(online.saleId);
  check(first && first.customer_id === 7, "en línea: el cliente queda en la venta");
  // Mismo folio + misma clave en la cola (lo que pasa tras un timeout).
  const lastKey = host.prepare("SELECT key FROM idempotency_keys WHERE device_id = 'box-a' ORDER BY rowid DESC LIMIT 1").get().key;
  offlineQueue.enqueue(boxA, {
    folio: online.folio,
    payload,
    idempotencyKey: lastKey,
    registerId: 1,
    cashierId: 1,
    cashierName: "Ana",
  });
  let sync = await boxRpc.syncPending(boxA);
  check(sync.synced === 1 && sync.conflicts === 0, "la cola recibe la respuesta original (sin 422)", JSON.stringify(sync));
  check(host.prepare("SELECT COUNT(*) c FROM sales").get().c === 1, "no se duplicó la venta");

  // Venta 100% offline con cliente: al subir conserva el cliente.
  offlineQueue.enqueue(boxA, {
    folio: "A-000040",
    payload: salePayload(2, { customerId: 7 }),
    idempotencyKey: "off-1",
    registerId: 1,
    cashierId: 1,
    cashierName: "Ana",
  });
  sync = await boxRpc.syncPending(boxA);
  const off = host.prepare("SELECT * FROM sales WHERE folio = 'A-000040'").get();
  check(sync.synced === 1 && off && off.customer_id === 7, "la venta de la cola conserva su cliente", JSON.stringify({ sync, off }));

  console.log("=== 2.3 · series de folio ===");
  const a2 = await boxRpc.recordSale(boxA2, salePayload(1, { registerId: 2 }));
  check(a2.success === true && /^A2-\d{6}$/.test(a2.folio), "la caja A2 usa la serie A2 (no la de A)", JSON.stringify(a2));
  check(salesCore.folioPrefixFor("D-1A2B3C", "x") === "X1A2B3C", "código de celular → prefijo X…, nunca la letra D");
  // Una caja no puede gastar la serie del Host.
  const tokenA = clientLink.readSessionToken(boxA);
  const forged = await fetch(`${HOST_URL}/api/sales`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: tokenA,
      "x-device-id": "box-a",
      "x-device-token": "tok-a",
      "idempotency-key": "forge-1",
    },
    body: JSON.stringify({ cart: cart(1), total: 8, paymentMethod: "cash", folio: "H-000900" }),
  }).then((r) => r.json());
  check(forged.success === false && forged.code === "FOLIO_INVALID", "folio de la serie H desde una caja → FOLIO_INVALID", JSON.stringify(forged));

  console.log("=== 2.4 · caja reinstalada ===");
  activation.setSetting(boxA, "folio_next_seq", "1"); // contador perdido
  const after = await boxRpc.recordSale(boxA, salePayload(3));
  check(after.success === true, "tras reinstalar, la venta entra (se realinea con el Host)", JSON.stringify(after));
  const localNext = Number(activation.getSetting(boxA, "folio_next_seq"));
  check(localNext > 40, "el contador local adoptó la serie del Host", String(localNext));

  console.log("=== 2.6 · needs_auth vuelve a subir tras login ===");
  offlineQueue.enqueue(boxA, {
    folio: "A-000060",
    payload: salePayload(1),
    idempotencyKey: "auth-1",
    registerId: 1,
    cashierId: 1,
    cashierName: "Ana",
  });
  boxA.prepare("UPDATE pending_sales SET status = 'needs_auth' WHERE idempotency_key = 'auth-1'").run();
  await boxRpc.verifyPin(boxA, 1, "1111");
  let st = null;
  for (let i = 0; i < 50; i++) {
    st = boxA.prepare("SELECT status FROM pending_sales WHERE idempotency_key = 'auth-1'").get().status;
    if (st === "synced") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  check(st === "synced", "needs_auth → pending → synced tras el login", st);

  console.log("=== 2.7 · venta tardía ===");
  host.prepare("UPDATE cash_register SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = 2").run();
  offlineQueue.enqueue(boxA2, {
    folio: "A2-000050",
    payload: salePayload(1, { registerId: 2 }),
    idempotencyKey: "late-1",
    registerId: 2,
    cashierId: 1,
    cashierName: "Ana",
  });
  let lateRes = null;
  await offlineQueue.sync(boxA2, async (row) => {
    const res = await fetch(`${HOST_URL}/api/sales`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: clientLink.readSessionToken(boxA2),
        "x-device-id": "box-a2",
        "x-device-token": "tok-a2",
        "idempotency-key": row.idempotencyKey,
      },
      body: JSON.stringify({ ...row.payload, folio: row.folio, offline: true, register_id: 2, cashier_id: 1 }),
    });
    lateRes = await res.json();
    return lateRes;
  });
  check(lateRes && lateRes.success === true && lateRes.warnings.some((w) => w.code === "LATE_SYNC_CLOSED_REGISTER"),
    "venta tras el corte → se guarda en su turno con aviso", JSON.stringify(lateRes));

  await apiServer.stopServer();
  console.log(`\n=== Fase 2: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
});
