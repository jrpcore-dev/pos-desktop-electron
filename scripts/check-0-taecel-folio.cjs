"use strict";
/*
 * Fase 0 · recargas Taecel dentro de multicaja.
 *
 *   - la venta de una recarga hecha desde una caja usa la serie del Host (H-…)
 *     y NO consume folios de la serie de la caja (que lleva su contador local);
 *   - la siguiente venta de la caja con su folio local no choca;
 *   - un carrito normal no puede enlazar una línea con un service_transaction.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-0-taecel-folio.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const salesCore = require(path.join(fixture.REPO, "src/main/sales-core.js"));
const activation = require(path.join(fixture.REPO, "src/main/activation.js"));

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

const db = fixture.createMemoryDb();
const BOX = "box-a-device";
activation.registerPairing(db, {
  deviceId: BOX,
  deviceName: "Caja A",
  token: "tok-a",
  deviceType: "desktop_box",
  approved: 1,
});
const code = db.prepare("SELECT device_code FROM paired_devices WHERE device_id = ?").get(BOX).device_code;
db.prepare("INSERT INTO cashiers (id, name, role, pin, is_active) VALUES (1, 'Ana', 'cashier', '', 1)").run();
db.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1, '001', 'Leche', 8, 10, 'piece')").run();
db.prepare(
  "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, ?)",
).run(BOX);

const tx = (fn) => db.transaction(fn)();

console.log("=== Fase 0 · folio de recargas ===");

// Recarga aplicada: misma llamada que service-transactions.
const recharge = tx(() =>
  salesCore.createSaleTx(db, {
    cart: [
      { isManual: true, name: "Recarga Telcel $50.00", quantity: 1, price: 50, finalPrice: 50, serviceTransactionId: 77 },
    ],
    total: 50,
    paymentMethod: "cash",
    cashierId: 1,
    role: "cashier",
    deviceId: BOX,
    registerId: 1,
    requireRegister: true,
    folioDeviceId: null,
    allowServiceLink: true,
  }),
);
check(/^H-\d{6}$/.test(recharge.folio), "la venta de la recarga usa la serie del Host", recharge.folio);
const link = db.prepare("SELECT service_transaction_id FROM sale_items WHERE sale_id = ?").get(recharge.saleId);
check(link && link.service_transaction_id === 77, "la línea queda enlazada con el ledger");
const saleDev = db.prepare("SELECT device_id, register_id FROM sales WHERE id = ?").get(recharge.saleId);
check(saleDev.device_id === BOX && saleDev.register_id === 1, "la venta sigue siendo de la caja y de su turno");

// La caja vende con SU primer folio local: no debe chocar.
const boxFolio = `${code[0]}-000001`;
let boxSale = null;
let boxErr = null;
try {
  boxSale = tx(() =>
    salesCore.createSaleTx(db, {
      cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }],
      total: 8,
      paymentMethod: "cash",
      cashierId: 1,
      role: "cashier",
      deviceId: BOX,
      folio: boxFolio,
      strictTotals: true,
    }),
  );
} catch (err) {
  boxErr = err;
}
check(boxSale && boxSale.folio === boxFolio, "la siguiente venta de la caja usa su folio local sin choque", boxErr && boxErr.message);

// Un carrito de cliente no puede enlazar líneas con el ledger.
const forged = tx(() =>
  salesCore.createSaleTx(db, {
    cart: [{ isManual: true, name: "Varios", quantity: 1, price: 5, finalPrice: 5, serviceTransactionId: 77 }],
    total: 5,
    paymentMethod: "cash",
    cashierId: 1,
    role: "cashier",
    deviceId: BOX,
  }),
);
const forgedLink = db.prepare("SELECT service_transaction_id FROM sale_items WHERE sale_id = ?").get(forged.saleId);
check(forgedLink.service_transaction_id === null, "serviceTransactionId del carrito se ignora");

console.log(`\n=== Fase 0: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
