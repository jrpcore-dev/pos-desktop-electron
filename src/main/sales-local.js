"use strict";

// Local-first · ventas en la caja.
//
// La venta se escribe en la copia local con el MISMO código del Host
// (`createSaleTx`), así Caja, Transacciones, el corte y la reimpresión la ven
// como cualquier otra venta, sin vistas armadas a mano. Sus filas llevan id
// NEGATIVO (nunca chocan con los del Host) y el folio, que es su identificador
// global: cuando la réplica trae la venta del Host con ese folio, el índice
// único del folio reemplaza la provisional sola.
//
// `pending_sales` es la fuente: lo provisional siempre se puede reconstruir
// desde ahí (tras un resync completo, que vacía la tabla de ventas).

const salesCore = require("./sales-core");
const offlineQueue = require("./offline-queue");

const minId = (db, table) =>
  Math.min(0, Number(db.prepare(`SELECT MIN(id) AS m FROM ${table}`).get().m) || 0);

// "2026-11-09T18:20:00.000Z" → "2026-11-09 18:20:00" (formato de SQLite, UTC).
const sqliteTime = (iso) => {
  const d = new Date(iso || Date.now());
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().replace("T", " ").slice(0, 19);
};

// Escribe UNA venta de la cola en la copia local. Debe correr dentro de una
// transacción (quien llama la abre): si una regla falla, no queda nada.
// Partidas con producto creado en la caja: su id provisional cambia cuando la
// réplica trae el del Host; el uid dice cuál es ahora.
const localCart = (db, cart) => {
  if (!Array.isArray(cart) || !cart.some((it) => it && it.product_uid)) return cart;
  const byUid = db.prepare("SELECT id FROM products WHERE uid = ?");
  return cart.map((it) => {
    if (!it || !it.product_uid) return it;
    const row = byUid.get(String(it.product_uid));
    return row ? { ...it, id: row.id } : it;
  });
};

const writeLocalSale = (db, row, deviceId) => {
  const p = row.payload || {};
  const customerId = Number(p.customerId);
  const out = salesCore.createSaleTx(db, {
    cart: localCart(db, p.cart),
    total: Number(p.total),
    paymentMethod: p.paymentMethod,
    discountTotal: p.discountTotal,
    cashierName: row.cashierName ?? p.cashierName,
    cashierId: row.cashierId ?? p.cashierId,
    // Cliente creado en la caja (id provisional): se liga abajo; el Host lo
    // resuelve por uid al recibir la venta.
    customerId: customerId > 0 ? customerId : null,
    deviceId,
    registerId: row.registerId ?? p.registerId ?? null,
    folio: row.folio,
    clientCreatedAt: row.localCreatedAt,
    strictTotals: true,
    localApply: true,
  });
  const tempSaleId = Number(out.saleId);
  const saleId = minId(db, "sales") - 1;
  // Renumerar padre e hijos en la misma transacción: la FK se comprueba al
  // final, cuando las dos ya apuntan al id nuevo.
  db.pragma("defer_foreign_keys = ON");
  let itemId = minId(db, "sale_items");
  const renumberItem = db.prepare("UPDATE sale_items SET id = ?, sale_id = ? WHERE id = ?");
  for (const item of db.prepare("SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id").all(tempSaleId)) {
    itemId -= 1;
    renumberItem.run(itemId, saleId, item.id);
  }
  db.prepare("UPDATE sales SET id = ?, created_at = ? WHERE id = ?").run(
    saleId,
    sqliteTime(row.localCreatedAt),
    tempSaleId,
  );
  if (customerId < 0) db.prepare("UPDATE sales SET customer_id = ? WHERE id = ?").run(customerId, saleId);
  return { saleId, folio: out.folio, warnings: out.warnings || [] };
};

// Ventas de la cola sin fila en la copia local (instalación previa a este
// cambio, o un resync completo que vació la tabla): se vuelven a escribir.
const rematerialize = (db, deviceId, log = () => {}) => {
  let written = 0;
  for (const row of offlineQueue.unsettled(db).reverse()) {
    try {
      db.transaction(() => writeLocalSale(db, row, deviceId))();
      written += 1;
    } catch (err) {
      log(`[sales-local] la venta ${row.folio} no se pudo mostrar en local: ${err && err.message}`);
    }
  }
  return written;
};

// Partidas de una venta provisional que la réplica ya sustituyó (el folio
// reemplazó la fila) quedan sin padre: se quitan.
const dropOrphanItems = (db) =>
  db.prepare("DELETE FROM sale_items WHERE sale_id < 0 AND sale_id NOT IN (SELECT id FROM sales)").run().changes;

// La réplica pisó productos con el stock del Host, que todavía no incluye lo
// vendido aquí sin subir: se vuelve a descontar. Sólo los productos que la
// réplica reescribió (los demás ya lo tienen descontado).
const reapplyStock = (db, productIds) => {
  const wanted = new Set([...(productIds || [])].map(String));
  if (!wanted.size) return 0;
  const rows = db
    .prepare(
      `SELECT si.product_id AS id, SUM(si.stock_deducted) AS qty
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.id < 0 AND si.product_id IS NOT NULL
        GROUP BY si.product_id`,
    )
    .all()
    .filter((r) => wanted.has(String(r.id)));
  const stmt = db.prepare(
    "UPDATE products SET stock = COALESCE(stock, 0) - ?, day_sold = COALESCE(day_sold, 0) + ? WHERE id = ?",
  );
  db.transaction(() => {
    for (const r of rows) stmt.run(Number(r.qty) || 0, Number(r.qty) || 0, r.id);
  })();
  return rows.length;
};

// La réplica cambió un producto creado aquí (id provisional) por el del Host:
// las partidas de ventas aún sin subir pasan al id nuevo, para que su stock se
// vuelva a descontar sobre él. Devuelve los ids que recibieron partidas.
const relinkProducts = (db) => {
  const moved = new Set();
  const byUid = db.prepare("SELECT id FROM products WHERE uid = ?");
  const move = db.prepare(
    `UPDATE sale_items SET product_id = ?
      WHERE product_id = ? AND sale_id IN (SELECT id FROM sales WHERE folio = ? AND id < 0)`,
  );
  db.transaction(() => {
    const S = offlineQueue.STATUS;
    for (const row of offlineQueue.list(db, [S.PENDING, S.SYNCING, S.NEEDS_AUTH, S.CONFLICT])) {
      for (const it of (row.payload && row.payload.cart) || []) {
        if (!it || !it.product_uid || !(Number(it.id) < 0)) continue;
        const now = byUid.get(String(it.product_uid));
        if (!now || now.id === Number(it.id)) continue;
        if (move.run(now.id, Number(it.id), row.folio).changes) moved.add(String(now.id));
      }
    }
  })();
  return moved;
};

// El cajero quitó una venta antes de que subiera: se borra de la copia local y
// su stock vuelve.
const removeLocalSale = (db, folio) =>
  db.transaction(() => {
    const sale = db.prepare("SELECT id FROM sales WHERE folio = ? AND id < 0").get(String(folio));
    if (!sale) return false;
    const items = db
      .prepare("SELECT product_id, stock_deducted FROM sale_items WHERE sale_id = ?")
      .all(sale.id);
    const stmt = db.prepare(
      "UPDATE products SET stock = COALESCE(stock, 0) + ?, day_sold = MAX(0, COALESCE(day_sold, 0) - ?) WHERE id = ?",
    );
    for (const it of items) {
      const qty = Number(it.stock_deducted) || 0;
      if (it.product_id != null && qty) stmt.run(qty, qty, it.product_id);
    }
    db.prepare("DELETE FROM sale_items WHERE sale_id = ?").run(sale.id);
    db.prepare("DELETE FROM sales WHERE id = ?").run(sale.id);
    return true;
  })();

// Marca en lo que se lee de la copia local qué ventas aún no confirma el Host
// (id negativo): la pantalla enseña "pendiente" o "en revisión" y no ofrece
// cancelarlas, que es una acción del Host.
const queueState = (db, folios) => {
  if (!folios.length) return new Map();
  const rows = db
    .prepare(
      `SELECT folio, status, last_error FROM pending_sales WHERE folio IN (${folios.map(() => "?").join(",")})`,
    )
    .all(...folios);
  return new Map(rows.map((r) => [r.folio, r]));
};
const markOne = (sale, states) => {
  if (!sale || !(Number(sale.id) < 0)) return sale;
  const q = states.get(sale.folio);
  const conflict = q && q.status === offlineQueue.STATUS.CONFLICT;
  return {
    ...sale,
    can_cancel: 0,
    pending: conflict ? "conflict" : "pending",
    pending_error: conflict ? q.last_error : null,
  };
};
const markPending = (db, result) => {
  if (!result || typeof result !== "object") return result;
  const list = Array.isArray(result.sales) ? result.sales : null;
  const one = result.sale && typeof result.sale === "object" ? result.sale : null;
  const folios = [...(list || []), ...(one ? [one] : [])]
    .filter((s) => s && Number(s.id) < 0 && s.folio)
    .map((s) => s.folio);
  if (!folios.length) return result;
  const states = queueState(db, folios);
  return {
    ...result,
    ...(list ? { sales: list.map((s) => markOne(s, states)) } : {}),
    ...(one ? { sale: markOne(one, states) } : {}),
  };
};

module.exports = {
  writeLocalSale,
  rematerialize,
  dropOrphanItems,
  relinkProducts,
  reapplyStock,
  removeLocalSale,
  markPending,
};
