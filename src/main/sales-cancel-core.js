"use strict";

// Reglas para cancelar una venta, compartidas por el Host (su handler) y la
// caja (que la cancela en su copia sin esperar y la sube por la cola).
//   · Una venta con recarga Taecel no se cancela desde el POS.
//   · Una caja sólo cancela SUS ventas (el Host local puede todas).
//   · Fuera del administrador: con la caja abierta, o cerrada hoy o ayer.
// Fiado sigue en el Host (el saldo del cliente vive allá).
// Lo mismo para devolver sólo un producto o parte (checkItem/planItem/applyItem).

const credit = require("./credit");

const MX_UTC_OFFSET = 6;

const mxDateOf = (sqliteUtc) =>
  new Date(new Date(String(sqliteUtc).replace(" ", "T") + "Z").getTime() - MX_UTC_OFFSET * 3600000)
    .toISOString()
    .slice(0, 10);
const mxYesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
};

// Cerrada hoy o ayer (hora de México).
const withinCancelWindow = (closedAt) => (closedAt ? mxDateOf(closedAt) >= mxYesterday() : false);

const fail = (code, error) => ({ success: false, code, error });

// `caller` = device_id de la caja que pide (null = el propio Host).
const check = (db, sale, { role, caller } = {}) => {
  if (!sale) return fail("SALE_NOT_FOUND", "Venta no encontrada");
  if (sale.status === "cancelado") return fail("ALREADY_CANCELLED", "Esta venta ya fue cancelada");
  const service = db
    .prepare("SELECT 1 FROM sale_items WHERE sale_id = ? AND service_transaction_id IS NOT NULL LIMIT 1")
    .get(sale.id);
  if (service) {
    return fail(
      "SERVICE_SALE_NOT_CANCELLABLE",
      "Esta venta contiene una recarga. No se puede cancelar desde el POS; gestiona la reversión con Taecel.",
    );
  }
  const reg = sale.register_id
    ? db.prepare("SELECT status, closed_at, device_id FROM cash_register WHERE id = ?").get(sale.register_id)
    : null;
  if (caller) {
    const owner = sale.device_id || (reg && reg.device_id) || null;
    if (owner !== caller) {
      return fail("SALE_NOT_OWNED", "Esa venta pertenece a otra caja y no se puede cancelar desde aquí");
    }
  }
  const canCancel =
    role === "admin" ||
    (reg && reg.status === "open") ||
    (reg && reg.status === "closed" && withinCancelWindow(reg.closed_at));
  if (!canCancel) return fail("OUT_OF_WINDOW", "No se puede cancelar esta venta fuera del plazo permitido");
  return { success: true, register: reg };
};

const SQLITE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// La cancelación en el Host: venta y partidas canceladas, el stock vuelve con
// su movimiento de devolución y el fiado se revierte. `cancelledAt` sólo se
// toma de una caja (la hora que ella ya mostró); si no, la del Host.
const apply = (db, sale, { cashierName, reason, cashierId, caller, cancelledAt } = {}) => {
  const at = caller && SQLITE_TS.test(String(cancelledAt || "")) ? String(cancelledAt) : null;
  const by = cashierName || null;
  const device = caller || null;
  db.transaction(() => {
    db.prepare(
      "UPDATE sales SET status='cancelado', cancelled_at=COALESCE(?, CURRENT_TIMESTAMP), cancelled_by=?, cancelled_by_device=? WHERE id=?",
    ).run(at, by, device, sale.id);
    db.prepare(
      "UPDATE sale_items SET status='cancelado', cancelled_at=COALESCE(?, CURRENT_TIMESTAMP), cancelled_by=?, cancelled_by_device=? WHERE sale_id=? AND (status IS NULL OR status != 'cancelado')",
    ).run(at, by, device, sale.id);
    const items = db.prepare("SELECT product_id, stock_deducted FROM sale_items WHERE sale_id = ?").all(sale.id);
    const restore = db.prepare(
      "UPDATE products SET stock = stock + ?, day_sold = MAX(COALESCE(day_sold, 0) - ?, 0) WHERE id = ?",
    );
    const mov = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference, notes, cashier_id) VALUES (?, 'devolution', ?, ?, ?, ?)",
    );
    for (const it of items) {
      if (it.product_id && (it.stock_deducted || 0) > 0) {
        restore.run(it.stock_deducted, it.stock_deducted, it.product_id);
        mov.run(it.product_id, it.stock_deducted, `Cancelación venta #${sale.id}`, reason || "", cashierId || null);
      }
    }
    // Fiado: lo que quedaba a cuenta del cliente se revierte.
    credit.reverseSale(db, sale, { cashierName, deviceId: caller });
  })();
};

// ── Devolver un producto (o parte) de la venta ─────────────────────────────
// Mismas reglas que la venta completa, pero la recarga se revisa sólo en ese
// renglón (una venta con recarga sí puede devolver sus otros productos).
const checkItem = (db, sale, item, { role, caller } = {}) => {
  if (!sale) return fail("SALE_NOT_FOUND", "Venta no encontrada");
  if (sale.status === "cancelado") return fail("ALREADY_CANCELLED", "Esta venta ya fue cancelada");
  if (!item) return fail("ITEM_NOT_FOUND", "Producto no encontrado");
  if (item.status === "cancelado") return fail("ALREADY_CANCELLED", "Este producto ya fue cancelado");
  if (item.service_transaction_id) {
    return fail("SERVICE_SALE_NOT_CANCELLABLE", "Esta línea es una recarga Taecel y no se puede cancelar desde el POS.");
  }
  const reg = sale.register_id
    ? db.prepare("SELECT status, closed_at, device_id FROM cash_register WHERE id = ?").get(sale.register_id)
    : null;
  if (caller) {
    const owner = sale.device_id || (reg && reg.device_id) || null;
    if (owner !== caller) {
      return fail("SALE_NOT_OWNED", "Esa venta pertenece a otra caja y no se puede cancelar desde aquí");
    }
  }
  const canCancel =
    role === "admin" ||
    (reg && reg.status === "open") ||
    (reg && reg.status === "closed" && withinCancelWindow(reg.closed_at));
  if (!canCancel) return fail("OUT_OF_WINDOW", "No se puede cancelar este producto fuera del plazo permitido");
  return { success: true, register: reg };
};

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// Cuánto se devuelve: cantidad (a 3 decimales, nunca más de lo que queda),
// importe con el descuento del renglón y el stock que vuelve (por unidad
// vendida, así caja/paquete regresan sus piezas).
const planItem = (item, quantity) => {
  const itemQuantity = Number(item.quantity || 0);
  const alreadyReturned = Number(item.returned_qty || 0);
  const remaining = Math.max(0, itemQuantity - alreadyReturned);
  const requested = Math.abs(Number(quantity) || 1);
  const cancelQty = Math.min(Math.max(0.001, r3(requested)), remaining);
  const newReturned = r3(alreadyReturned + cancelQty);
  const unitPrice = Number(item.price_at_sale || 0);
  const discount = Number(item.discount_percent || 0);
  const refundAmount = unitPrice * cancelQty * (1 - Math.min(100, Math.max(0, discount)) / 100);
  const stockPerUnit =
    itemQuantity > 0 ? (Number(item.stock_deducted || 0) || itemQuantity) / itemQuantity : 1;
  const done = newReturned + 0.0001 >= itemQuantity;
  return {
    remaining,
    cancelQty,
    newReturned,
    refundAmount,
    restoreStock: r3(stockPerUnit * cancelQty),
    isPartial: remaining - cancelQty > 0.0001,
    itemStatus: done ? "cancelado" : "parcial",
  };
};

// La devolución en el Host. Si ya no queda nada activo, la venta se cancela
// (y el fiado se revierte); si no, baja su total (y lo fiado, en proporción).
const applyItem = (db, sale, item, { quantity, cashierName, reason, cashierId, caller, cancelledAt } = {}) => {
  const plan = planItem(item, quantity);
  if (plan.remaining <= 0) return fail("ALREADY_CANCELLED", "Este producto ya fue cancelado");
  const at = caller && SQLITE_TS.test(String(cancelledAt || "")) ? String(cancelledAt) : null;
  const by = cashierName || null;
  const device = caller || null;
  let saleCancelled = false;
  db.transaction(() => {
    db.prepare(
      "UPDATE sale_items SET status=?, returned_qty=?, cancelled_at=COALESCE(?, CURRENT_TIMESTAMP), cancelled_by=?, cancelled_by_device=? WHERE id=?",
    ).run(plan.itemStatus, plan.newReturned, at, by, device, item.id);
    if (item.product_id && plan.restoreStock > 0) {
      db.prepare(
        "UPDATE products SET stock = stock + ?, day_sold = MAX(COALESCE(day_sold, 0) - ?, 0) WHERE id = ?",
      ).run(plan.restoreStock, plan.restoreStock, item.product_id);
      db.prepare(
        "INSERT INTO stock_movements (product_id, type, quantity, reference, notes, cashier_id) VALUES (?, 'devolution', ?, ?, ?, ?)",
      ).run(
        item.product_id,
        plan.restoreStock,
        `${plan.isPartial ? "Devolución parcial" : "Cancelación"} producto venta #${sale.id}`,
        reason || "",
        cashierId || null,
      );
    }
    const activeCount = db
      .prepare("SELECT COUNT(*) as c FROM sale_items WHERE sale_id = ? AND (status IS NULL OR status != 'cancelado')")
      .get(sale.id).c;
    // Fiado: la venta se lee dentro de la transacción (devoluciones previas
    // ya pudieron bajar lo fiado).
    const fresh = db.prepare("SELECT * FROM sales WHERE id = ?").get(sale.id);
    if (activeCount === 0) {
      saleCancelled = true;
      db.prepare(
        "UPDATE sales SET status='cancelado', cancelled_at=COALESCE(?, CURRENT_TIMESTAMP), cancelled_by=?, cancelled_by_device=? WHERE id=?",
      ).run(at, by, device, sale.id);
      credit.reverseSale(db, fresh, { cashierName, deviceId: caller });
    } else {
      db.prepare("UPDATE sales SET total = MAX(0, ROUND(total - ?, 2)) WHERE id = ?").run(plan.refundAmount, sale.id);
      credit.refundSalePart(db, fresh, plan.refundAmount, { cashierName, deviceId: caller });
    }
  })();
  return {
    success: true,
    refundAmount: Number(plan.refundAmount.toFixed(2)),
    cancelledQty: plan.cancelQty,
    isPartial: plan.isPartial,
    saleCancelled,
    itemStatus: plan.itemStatus,
  };
};

module.exports = { check, apply, checkItem, planItem, applyItem, withinCancelWindow };
