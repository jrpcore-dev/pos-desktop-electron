"use strict";
/*
 * Fiado · cancelar o devolver una venta fiada nunca deja el saldo bajo cero.
 *
 * El bug: venta fiada de $9, el cliente la abona, se cancela la venta → la
 * reversa volvía a restar los $9 y la cuenta quedaba en −$9 ("Al corriente"
 * con "Saldo −$9.00"). Ahora sólo se revierte lo que todavía debe, y los
 * saldos que ya quedaron negativos se corrigen a $0 al arrancar.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-credit-reversal.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const credit = require(path.join(fixture.REPO, "src/main/credit.js"));

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
const customer = (name) =>
  Number(db.prepare("INSERT INTO customers (name, credit_enabled) VALUES (?, 1)").run(name).lastInsertRowid);
const fiar = (c, total, folio, paid = 0) => {
  const prep = credit.prepareCreditSale(db, { customerId: c, total, creditPaid: paid });
  const id = Number(
    db
      .prepare(
        "INSERT INTO sales (folio, total, payment_method, customer_id, credit_amount, credit_paid, status) VALUES (?, ?, 'credit', ?, ?, ?, 'completado')",
      )
      .run(folio, total, c, prep.amount, paid).lastInsertRowid,
  );
  credit.chargeSale(db, prep, { saleId: id, folio, total });
  return db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
};
const pay = (c, amount) => credit.recordPayment(db, { customerId: c, amount, method: "cash" });
const last = (c) =>
  db.prepare("SELECT * FROM customer_credit_movements WHERE customer_id = ? ORDER BY id DESC LIMIT 1").get(c);

console.log("=== fiado: cancelaciones y devoluciones ===");

// Pagada completa y cancelada: no mueve el saldo, pero queda en el historial.
const a = customer("A");
const sa = fiar(a, 9, "V-9");
pay(a, 9);
credit.reverseSale(db, sa, {});
check(credit.balanceOf(db, a) === 0, "venta ya pagada y cancelada → saldo $0", credit.balanceOf(db, a));
check(last(a).amount === 0 && /ya estaba pagada/.test(last(a).note), "queda el renglón en $0 con la nota", JSON.stringify(last(a)));

// Pagada en parte: sólo revierte lo que debe.
const b = customer("B");
const sb = fiar(b, 10, "V-10");
pay(b, 4);
credit.reverseSale(db, sb, {});
check(credit.balanceOf(db, b) === 0, "pagada en parte y cancelada → saldo $0", credit.balanceOf(db, b));
check(last(b).amount === -6 && /en parte/.test(last(b).note), "revierte sólo los $6 que debía", JSON.stringify(last(b)));

// Sin abonos: igual que antes.
const c = customer("C");
const sc = fiar(c, 20, "V-20");
credit.reverseSale(db, sc, {});
check(last(c).amount === -20 && credit.balanceOf(db, c) === 0, "sin abonos revierte todo", JSON.stringify(last(c)));

// Otra deuda que no se toca: abonó lo de una venta y se cancela la otra.
const d = customer("D");
fiar(d, 30, "V-30");
const sd2 = fiar(d, 5, "V-5");
pay(d, 30);
credit.reverseSale(db, sd2, {});
check(credit.balanceOf(db, d) === 0, "cancela una de dos ventas sin bajar de $0", credit.balanceOf(db, d));

// Devolución parcial de una venta ya pagada.
const e = customer("E");
const se = fiar(e, 12, "V-12");
pay(e, 12);
credit.refundSalePart(db, se, 5, {});
check(credit.balanceOf(db, e) === 0, "devolución de una venta ya pagada → saldo $0", credit.balanceOf(db, e));

// Saldos que ya quedaron negativos (antes del arreglo) → $0 y nada más.
const f = customer("F");
db.prepare("INSERT INTO customer_credit_movements (customer_id, type, amount) VALUES (?, 'reversal', -9)").run(f);
check(credit.repairNegativeBalances(db) === 1, "corrige el saldo negativo existente");
check(credit.balanceOf(db, f) === 0 && last(f).type === "adjustment", "queda en $0 con un ajuste", JSON.stringify(last(f)));
check(credit.repairNegativeBalances(db) === 0, "segunda corrida no hace nada");

console.log(`\n=== fiado cancelaciones: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
