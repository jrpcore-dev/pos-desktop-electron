"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Fiado / crédito a clientes. Vive sólo en el Host.
//
// Cada cliente con "Puede fiar" (customers.credit_enabled) tiene un estado de
// cuenta: movimientos que sólo se agregan, nunca se editan ni se borran. El
// saldo es la suma de `amount` (+ aumenta la deuda, − la reduce):
//
//   initial    saldo inicial al activar el fiado (lo que ya debía en libreta)
//   charge     venta fiada: SÓLO la parte fiada (total − lo que pagó al
//              momento). La venta de $300 donde deja $100 carga $200.
//   payment    abono desde Clientes (efectivo/tarjeta/transferencia); entra al
//              corte como "Cobranza de fiado" de la caja abierta.
//   reversal   cancelación o devolución de una venta fiada (automático).
//   adjustment ajuste del dueño (± con motivo).
//
// En la venta: sales.payment_method = 'credit', sales.credit_amount (lo
// fiado), sales.credit_paid + credit_paid_method (lo que pagó al momento, que
// en el corte suma a su método como cualquier venta).
// ─────────────────────────────────────────────────────────────────────────────

const { verifyPin } = require("./pins");

const PAY_METHODS = ["cash", "card", "transfer"];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const fail = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const balanceOf = (db, customerId) =>
  round2(
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS b FROM customer_credit_movements WHERE customer_id = ?`,
      )
      .get(customerId).b,
  );

// Fecha del cargo más viejo que sigue sin pagarse (PEPS: cada abono o
// reversa liquida primero lo más antiguo). null si no debe nada.
const oldestDebtDate = (db, customerId) => {
  const rows = db
    .prepare(
      `SELECT amount, created_at FROM customer_credit_movements
       WHERE customer_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(customerId);
  const queue = [];
  for (const r of rows) {
    if (r.amount > 0) {
      queue.push({ left: r.amount, at: r.created_at });
      continue;
    }
    let pay = -r.amount;
    while (pay > 0.004 && queue.length) {
      const take = Math.min(queue[0].left, pay);
      queue[0].left -= take;
      pay -= take;
      if (queue[0].left <= 0.004) queue.shift();
    }
  }
  return queue.length ? queue[0].at : null;
};

const insertMovement = (db, m) =>
  db
    .prepare(
      `INSERT INTO customer_credit_movements
         (customer_id, type, amount, method, sale_id, register_id, device_id,
          cashier_id, cashier_name, note, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.customerId,
      m.type,
      round2(m.amount),
      m.method || null,
      m.saleId || null,
      m.registerId || null,
      m.deviceId || null,
      m.cashierId || null,
      m.cashierName || null,
      m.note || null,
      m.clientRequestId || null,
    ).lastInsertRowid;

// El PIN pertenece a algún propietario activo.
const isOwnerPin = (db, pin) => {
  if (!pin) return false;
  const owners = db
    .prepare(
      `SELECT pin, pin_hash, pin_salt FROM cashiers
       WHERE role = 'admin' AND COALESCE(is_active, 1) = 1`,
    )
    .all();
  return owners.some((o) =>
    o.pin_hash && o.pin_salt ? verifyPin(String(pin), o.pin_salt, o.pin_hash) : o.pin === String(pin),
  );
};

// ─── Venta fiada (dentro de la transacción de createSaleTx) ─────────────────

// Valida y normaliza la parte fiada ANTES de insertar la venta.
const prepareCreditSale = (db, { customerId, total, creditPaid, creditPaidMethod, ownerPin }) => {
  if (!customerId) throw fail("CREDIT_CUSTOMER_REQUIRED", "Selecciona un cliente para fiar");
  const customer = db
    .prepare(`SELECT id, name, credit_enabled, credit_limit FROM customers WHERE id = ?`)
    .get(customerId);
  if (!customer) throw fail("CREDIT_CUSTOMER_REQUIRED", "Cliente no encontrado");
  if (!customer.credit_enabled)
    throw fail("CREDIT_NOT_ENABLED", `${customer.name} no tiene fiado activado`);

  const paid = round2(creditPaid || 0);
  if (!Number.isFinite(paid) || paid < 0) throw fail("CREDIT_INVALID", "Pago inválido");
  const amount = round2(total - paid);
  if (amount <= 0) throw fail("CREDIT_INVALID", "Lo pagado cubre la venta: cóbrala normal");
  const method = paid > 0 ? creditPaidMethod || "cash" : null;
  if (method && !PAY_METHODS.includes(method)) throw fail("CREDIT_INVALID", "Método de pago inválido");

  const previous = balanceOf(db, customerId);
  const limit = round2(customer.credit_limit || 0);
  const newBalance = round2(previous + amount);
  // Límite 0 = sin límite. Rebasarlo sólo con el PIN de un propietario.
  if (limit > 0 && newBalance > limit && !isOwnerPin(db, ownerPin)) {
    throw fail(
      ownerPin ? "CREDIT_PIN_INVALID" : "CREDIT_LIMIT_EXCEEDED",
      ownerPin
        ? "PIN de propietario incorrecto"
        : `Rebasa el límite de crédito ($${limit.toFixed(2)})`,
    );
  }
  return { customer, amount, paid, method, previous, newBalance, limit };
};

const chargeSale = (db, prep, { saleId, folio, total, registerId, deviceId, cashierId, cashierName }) => {
  insertMovement(db, {
    customerId: prep.customer.id,
    type: "charge",
    amount: prep.amount,
    saleId,
    registerId,
    deviceId,
    cashierId,
    cashierName,
    note:
      prep.paid > 0
        ? `Venta ${folio || "#" + saleId} ($${round2(total).toFixed(2)}, pagó $${prep.paid.toFixed(2)})`
        : `Venta ${folio || "#" + saleId}`,
  });
  return {
    customerName: prep.customer.name,
    previous: prep.previous,
    charge: prep.amount,
    paid: prep.paid,
    paidMethod: prep.method,
    newBalance: prep.newBalance,
    limit: prep.limit,
  };
};

// Cancelación total: revierte lo que quede fiado de la venta.
const reverseSale = (db, sale, { cashierName, deviceId, note } = {}) => {
  if (sale.payment_method !== "credit" || !sale.customer_id) return 0;
  const amount = round2(sale.credit_amount || 0);
  if (amount <= 0) return 0;
  insertMovement(db, {
    customerId: sale.customer_id,
    type: "reversal",
    amount: -amount,
    saleId: sale.id,
    deviceId,
    cashierName,
    note: note || `Cancelación venta ${sale.folio || "#" + sale.id}`,
  });
  db.prepare(`UPDATE sales SET credit_amount = 0 WHERE id = ?`).run(sale.id);
  return amount;
};

// Devolución parcial de una venta fiada: primero baja lo fiado y, si sobra,
// lo que pagó al momento (ese resto sale de la caja como en cualquier venta).
const refundSalePart = (db, sale, refund, { cashierName, deviceId } = {}) => {
  if (sale.payment_method !== "credit" || !sale.customer_id) return { credit: 0, paid: 0 };
  const credit = round2(Math.min(refund, sale.credit_amount || 0));
  const paidPart = round2(Math.min(Math.max(refund - credit, 0), sale.credit_paid || 0));
  if (credit > 0) {
    insertMovement(db, {
      customerId: sale.customer_id,
      type: "reversal",
      amount: -credit,
      saleId: sale.id,
      deviceId,
      cashierName,
      note: `Devolución en venta ${sale.folio || "#" + sale.id}`,
    });
  }
  db.prepare(
    `UPDATE sales SET credit_amount = MAX(0, ROUND(credit_amount - ?, 2)),
                      credit_paid = MAX(0, ROUND(credit_paid - ?, 2))
     WHERE id = ?`,
  ).run(credit, paidPart, sale.id);
  return { credit, paid: paidPart };
};

// ─── Desde la pantalla Clientes ─────────────────────────────────────────────

const recordPayment = (
  db,
  { customerId, amount, method, registerId, deviceId, cashierId, cashierName, clientRequestId },
) => {
  if (clientRequestId) {
    const dup = db
      .prepare(`SELECT id FROM customer_credit_movements WHERE client_request_id = ?`)
      .get(String(clientRequestId));
    if (dup) return { duplicate: true, ...paymentResult(db, customerId, dup.id) };
  }
  const value = round2(amount);
  if (!Number.isFinite(value) || value <= 0) throw fail("CREDIT_INVALID", "Monto inválido");
  if (!PAY_METHODS.includes(method)) throw fail("CREDIT_INVALID", "Método de pago inválido");
  const balance = balanceOf(db, customerId);
  if (balance <= 0) throw fail("CREDIT_NO_DEBT", "El cliente no tiene adeudo");
  if (value > balance + 0.004)
    throw fail("CREDIT_INVALID", `El abono supera el adeudo ($${balance.toFixed(2)})`);
  const id = insertMovement(db, {
    customerId,
    type: "payment",
    amount: -value,
    method,
    registerId,
    deviceId,
    cashierId,
    cashierName,
    note: value >= balance - 0.004 ? "Liquidación" : "Abono",
    clientRequestId: clientRequestId ? String(clientRequestId) : null,
  });
  return paymentResult(db, customerId, id, balance);
};

const paymentResult = (db, customerId, movementId, previous) => {
  const m = db.prepare(`SELECT * FROM customer_credit_movements WHERE id = ?`).get(movementId);
  const balance = balanceOf(db, customerId);
  return {
    movementId,
    amount: -m.amount,
    method: m.method,
    previous: previous != null ? previous : round2(balance - m.amount),
    balance,
  };
};

// Ajuste del dueño (±) o saldo inicial (+) al activar el fiado.
const adjust = (db, { customerId, amount, note, kind, cashierId, cashierName, deviceId }) => {
  const value = round2(amount);
  if (!Number.isFinite(value) || value === 0) throw fail("CREDIT_INVALID", "Monto inválido");
  const type = kind === "initial" ? "initial" : "adjustment";
  if (type === "initial" && value < 0) throw fail("CREDIT_INVALID", "El saldo inicial debe ser positivo");
  if (type === "adjustment" && !String(note || "").trim())
    throw fail("CREDIT_INVALID", "Escribe el motivo del ajuste");
  const balance = balanceOf(db, customerId);
  if (balance + value < -0.004) throw fail("CREDIT_INVALID", "El saldo no puede quedar negativo");
  insertMovement(db, {
    customerId,
    type,
    amount: value,
    deviceId,
    cashierId,
    cashierName,
    note: type === "initial" ? note || "Saldo inicial" : String(note).trim(),
  });
  return { balance: balanceOf(db, customerId) };
};

const summary = (db, customerId) => {
  const customer = db
    .prepare(`SELECT id, name, phone, credit_enabled, credit_limit FROM customers WHERE id = ?`)
    .get(customerId);
  if (!customer) throw fail("NOT_FOUND", "Cliente no encontrado");
  const movements = db
    .prepare(
      `SELECT m.id, m.type, m.amount, m.method, m.sale_id, s.folio, m.note,
              m.cashier_name, m.created_at
       FROM customer_credit_movements m
       LEFT JOIN sales s ON s.id = m.sale_id
       WHERE m.customer_id = ?
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 300`,
    )
    .all(customerId);
  return {
    customerId,
    enabled: !!customer.credit_enabled,
    limit: round2(customer.credit_limit || 0),
    balance: balanceOf(db, customerId),
    oldestDebtAt: oldestDebtDate(db, customerId),
    hasMovements: movements.length > 0,
    movements,
  };
};

// Saldos para la lista de Clientes: sólo clientes con movimientos.
const balances = (db) => {
  const rows = db
    .prepare(
      `SELECT customer_id, ROUND(SUM(amount), 2) AS balance
       FROM customer_credit_movements GROUP BY customer_id`,
    )
    .all();
  const out = {};
  let receivable = 0;
  let debtors = 0;
  for (const r of rows) {
    const balance = round2(r.balance);
    out[r.customer_id] = {
      balance,
      oldestDebtAt: balance > 0 ? oldestDebtDate(db, r.customer_id) : null,
    };
    if (balance > 0) {
      receivable += balance;
      debtors++;
    }
  }
  return { byCustomer: out, receivable: round2(receivable), debtors };
};

// ─── Corte de caja ───────────────────────────────────────────────────────────

// Lo que el fiado aporta a una caja: ventas fiadas (sólo la parte fiada),
// pagos al momento por método y cobranza (abonos) por método.
const registerCredit = (db, registerId) => {
  const empty = { cash: 0, card: 0, transfer: 0 };
  if (!registerId) return { creditSales: 0, paid: { ...empty }, collected: { ...empty } };
  const live = "(status IS NULL OR status != 'cancelado')";
  const creditSales = db
    .prepare(
      `SELECT COALESCE(SUM(credit_amount), 0) AS t FROM sales
       WHERE register_id = ? AND payment_method = 'credit' AND ${live}`,
    )
    .get(registerId).t;
  const paid = { ...empty };
  for (const r of db
    .prepare(
      `SELECT credit_paid_method AS m, COALESCE(SUM(credit_paid), 0) AS t FROM sales
       WHERE register_id = ? AND payment_method = 'credit' AND credit_paid > 0 AND ${live}
       GROUP BY credit_paid_method`,
    )
    .all(registerId)) {
    if (r.m in paid) paid[r.m] = round2(r.t);
  }
  const collected = { ...empty };
  for (const r of db
    .prepare(
      `SELECT method AS m, COALESCE(SUM(-amount), 0) AS t FROM customer_credit_movements
       WHERE register_id = ? AND type = 'payment' GROUP BY method`,
    )
    .all(registerId)) {
    if (r.m in collected) collected[r.m] = round2(r.t);
  }
  return { creditSales: round2(creditSales), paid, collected };
};

module.exports = {
  PAY_METHODS,
  balanceOf,
  oldestDebtDate,
  isOwnerPin,
  prepareCreditSale,
  chargeSale,
  reverseSale,
  refundSalePart,
  recordPayment,
  adjust,
  summary,
  balances,
  registerCredit,
};
