"use strict";

// Reglas para cancelar una venta, compartidas por el Host (su handler) y la
// caja (que la cancela en su copia sin esperar y la sube por la cola).
//   · Una venta con recarga Taecel no se cancela desde el POS.
//   · Una caja sólo cancela SUS ventas (el Host local puede todas).
//   · Fuera del administrador: con la caja abierta, o cerrada hoy o ayer.
// Fiado sigue en el Host (el saldo del cliente vive allá).

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

module.exports = { check, apply, withinCancelWindow };
