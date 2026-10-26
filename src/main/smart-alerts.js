"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Alertas inteligentes (bandeja `insights`). Corren sólo en el Host.
//
//   expiry      → "Posible caducidad": lote con unidades estimadas que vence
//                 en ≤ EXPIRY_WINDOW_DAYS. Acciones: reducir (merma),
//                 rebajar (descuento hasta la fecha de caducidad), ya no hay.
//   slow_stock  → "Stock sin movimiento": productos con existencia y sin
//                 ventas en SLOW_DAYS. Acción: rebajar.
//   reorder     → "Pedido sugerido · <proveedor>": sólo recomendación.
//
// Caducidad por lotes sin tocar las ventas: el sistema no sabe qué pieza
// física se vendió, así que asume PEPS (primero sale lo más viejo). Lo que
// queda de cada lote se reparte desde el stock actual empezando por el lote
// más nuevo; lo que sobra le toca a los más viejos. Ej.: stock 11, lotes
// B (10, nuevo) y A (4, viejo) → B=10, A=1. Si la realidad no coincide, el
// aviso ofrece "Ya no hay" o "Reducir" para corregir.
//
// `week_key` es la llave de deduplicación: un aviso con la misma llave no se
// vuelve a crear aunque se haya descartado.
// ─────────────────────────────────────────────────────────────────────────────

const EXPIRY_WINDOW_DAYS = 7;
const SLOW_DAYS = 30;
const SLOW_MAX_ITEMS = 8;
const VELOCITY_DAYS = 28;
const REORDER_ALERT_DAYS = 7; // avisar si alcanza para menos de esto
const REORDER_COVER_DAYS = 14; // sugerir para cubrir esto
const REORDER_MAX_ITEMS = 15;

const mxToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

const addDays = (isoDate, days) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

const daysBetween = (fromIso, toIso) => {
  const a = Date.UTC(...fromIso.split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
  const b = Date.UTC(...toIso.split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
  return Math.round((b - a) / 86400000);
};

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDate = (iso) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

const fmtQty = (qty, saleUnit) => {
  if (saleUnit === "weight") return `${Number(qty.toFixed(3))} kg`;
  const n = Math.round(qty);
  return `${n} ${n === 1 ? "pza" : "pzas"}`;
};

const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;

const exists = (db, type, key) =>
  !!db.prepare(`SELECT 1 FROM insights WHERE type = ? AND week_key = ? LIMIT 1`).get(type, key);

const insert = (db, { type, title, body, route, key, payload }) =>
  db
    .prepare(
      `INSERT INTO insights (type, title, body, route, week_key, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(type, title, body, route, key, JSON.stringify(payload || {}));

// ─── Caducidad ───────────────────────────────────────────────────────────────

// Lotes activos de un producto con su cantidad estimada (PEPS).
const estimateLots = (db, productId, stock) => {
  const lots = db
    .prepare(
      `SELECT id, quantity, expiry_date, received_at FROM product_lots
       WHERE product_id = ? AND status = 'active'
       ORDER BY received_at DESC, id DESC`,
    )
    .all(productId);
  let remaining = Math.max(Number(stock) || 0, 0);
  return lots.map((lot) => {
    const est = Math.min(lot.quantity, remaining);
    remaining -= est;
    return { ...lot, estimated: est };
  });
};

const generateExpiry = (db, today) => {
  const limit = addDays(today, EXPIRY_WINDOW_DAYS);
  const products = db
    .prepare(
      `SELECT DISTINCT p.id, p.name, p.stock, p.sale_unit
       FROM product_lots l JOIN products p ON p.id = l.product_id
       WHERE l.status = 'active' AND p.is_active = 1`,
    )
    .all();
  const consume = db.prepare(`UPDATE product_lots SET status = 'consumed' WHERE id = ?`);
  let created = 0;
  for (const p of products) {
    for (const lot of estimateLots(db, p.id, p.stock)) {
      if (lot.estimated <= 0) {
        consume.run(lot.id);
        continue;
      }
      if (lot.expiry_date > limit) continue;
      const key = `lot:${lot.id}`;
      if (exists(db, "expiry", key)) continue;
      const diff = daysBetween(today, lot.expiry_date);
      const when =
        diff < 0
          ? `caducó el ${fmtDate(lot.expiry_date)}`
          : diff === 0
            ? "caduca hoy"
            : `caduca el ${fmtDate(lot.expiry_date)} (en ${diff} ${diff === 1 ? "día" : "días"})`;
      insert(db, {
        type: "expiry",
        title: "Posible caducidad",
        body: `Puede que tengas ${fmtQty(lot.estimated, p.sale_unit)} de ${p.name} que ${when}.`,
        route: "/inventory",
        key,
        payload: {
          productId: p.id,
          productName: p.name,
          lotId: lot.id,
          qty: lot.estimated,
          saleUnit: p.sale_unit,
          expiryDate: lot.expiry_date,
        },
      });
      created++;
    }
  }
  return created;
};

// ─── Stock sin movimiento ────────────────────────────────────────────────────

const generateSlowStock = (db, today) => {
  // Una por semana (llave = lunes de la semana) para no insistir a diario.
  const [y, m, d] = today.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const key = `week:${addDays(today, -dow)}`;
  if (exists(db, "slow_stock", key)) return 0;
  const since = addDays(today, -SLOW_DAYS);
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.stock, p.sale_unit,
              p.stock * COALESCE(NULLIF(p.cost_price, 0), p.price, 0) AS value
       FROM products p
       WHERE p.is_active = 1 AND p.stock > 0
         AND DATE(p.created_at, '-6 hours') <= ?
         AND NOT EXISTS (
           SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE si.product_id = p.id
             AND DATE(s.created_at, '-6 hours') > ?
             AND (s.status IS NULL OR s.status != 'cancelado')
         )
       ORDER BY value DESC`,
    )
    .all(since, since);
  if (rows.length === 0) return 0;
  const total = rows.reduce((a, r) => a + (r.value || 0), 0);
  insert(db, {
    type: "slow_stock",
    title: "Stock sin movimiento",
    body: `${rows.length} ${rows.length === 1 ? "producto" : "productos"} sin ventas en ${SLOW_DAYS} días (${fmtMoney(total)} detenidos). Una rebaja puede ayudar a moverlos.`,
    route: "/inventory",
    key,
    payload: {
      items: rows.slice(0, SLOW_MAX_ITEMS).map((r) => ({
        productId: r.id,
        name: r.name,
        stockLabel: fmtQty(r.stock, r.sale_unit),
      })),
      more: Math.max(rows.length - SLOW_MAX_ITEMS, 0),
    },
  });
  return 1;
};

// ─── Pedido sugerido ─────────────────────────────────────────────────────────

const generateReorder = (db, today) => {
  const since = addDays(today, -VELOCITY_DAYS);
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.stock, p.sale_unit, p.box_qty,
              p.supplier_id, sup.name AS supplier_name,
              SUM(si.stock_deducted) AS sold
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN suppliers sup ON sup.id = p.supplier_id
       WHERE DATE(s.created_at, '-6 hours') > ?
         AND (s.status IS NULL OR s.status != 'cancelado')
         AND p.is_active = 1
       GROUP BY p.id
       HAVING sold > 0`,
    )
    .all(since);

  const bySupplier = new Map();
  for (const r of rows) {
    const daily = r.sold / VELOCITY_DAYS;
    const stock = Math.max(r.stock || 0, 0);
    const daysLeft = stock / daily;
    if (daysLeft >= REORDER_ALERT_DAYS) continue;
    let need = daily * REORDER_COVER_DAYS - stock;
    if (need <= 0) continue;
    const isWeight = r.sale_unit === "weight";
    const box = !isWeight && r.box_qty > 1 ? r.box_qty : 0;
    let suggestion;
    if (isWeight) {
      need = Math.ceil(need * 10) / 10;
      suggestion = `${need} kg`;
    } else if (box) {
      const boxes = Math.ceil(need / box);
      suggestion = `${boxes} ${boxes === 1 ? "caja" : "cajas"} (${boxes * box} pzas)`;
    } else {
      suggestion = fmtQty(Math.ceil(need), r.sale_unit);
    }
    const sid = r.supplier_id || 0;
    if (!bySupplier.has(sid)) {
      bySupplier.set(sid, { name: r.supplier_name || "Sin proveedor", items: [] });
    }
    bySupplier.get(sid).items.push({
      productId: r.id,
      name: r.name,
      suggestion,
      daysLeft: Math.floor(daysLeft),
      stockLabel: fmtQty(stock, r.sale_unit),
    });
  }

  // Siempre fresco: se reemplazan los pedidos sugeridos sin leer de días
  // anteriores (los del día no se repiten gracias a la llave).
  db.prepare(
    `DELETE FROM insights WHERE type = 'reorder' AND status = 'unread' AND week_key NOT LIKE ?`,
  ).run(`${today}:%`);

  let created = 0;
  for (const [sid, group] of bySupplier) {
    const key = `${today}:${sid}`;
    if (exists(db, "reorder", key)) continue;
    group.items.sort((a, b) => a.daysLeft - b.daysLeft);
    const n = group.items.length;
    insert(db, {
      type: "reorder",
      title: `Pedido sugerido · ${group.name}`,
      body: `${n} ${n === 1 ? "producto se acaba" : "productos se acaban"} en menos de ${REORDER_ALERT_DAYS} días según lo que vendes.`,
      route: "/inventory",
      key,
      payload: {
        items: group.items.slice(0, REORDER_MAX_ITEMS),
        more: Math.max(n - REORDER_MAX_ITEMS, 0),
      },
    });
    created++;
  }
  return created;
};

const generateSmartAlerts = (db) => {
  const today = mxToday();
  const run = db.transaction(() => ({
    expiry: generateExpiry(db, today),
    slowStock: generateSlowStock(db, today),
    reorder: generateReorder(db, today),
  }));
  return run();
};

// ─── Acciones desde el aviso ────────────────────────────────────────────────

const DISCOUNT_OPTIONS = [10, 20, 30, 50];

const applyInsightAction = (db, { insightId, action, productId, qty, percent, role, cashierId }) => {
  const insight = db.prepare(`SELECT * FROM insights WHERE id = ?`).get(insightId);
  if (!insight) throw new Error("Aviso no encontrado");
  const payload = JSON.parse(insight.payload || "{}");
  const today = mxToday();

  const run = db.transaction(() => {
    if (action === "dismiss") {
      db.prepare(`UPDATE insights SET status = 'dismissed' WHERE id = ?`).run(insightId);
      return {};
    }

    if (action === "cleared") {
      if (insight.type !== "expiry") throw new Error("Acción no válida");
      db.prepare(`UPDATE product_lots SET status = 'cleared' WHERE id = ?`).run(payload.lotId);
      db.prepare(`UPDATE insights SET status = 'actioned' WHERE id = ?`).run(insightId);
      return {};
    }

    if (action === "reduce") {
      if (insight.type !== "expiry") throw new Error("Acción no válida");
      if (role !== "admin") throw new Error("Solo el propietario puede hacer salidas de stock");
      const product = db
        .prepare(`SELECT name, stock, sale_unit FROM products WHERE id = ?`)
        .get(payload.productId);
      if (!product) throw new Error("Producto no encontrado");
      const amount = Number(qty);
      const valid =
        product.sale_unit === "weight" ? amount > 0 : Number.isInteger(amount) && amount > 0;
      if (!valid) throw new Error("Cantidad no válida");
      const take = Math.min(amount, Math.max(product.stock, 0));
      if (take > 0) {
        db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(take, payload.productId);
        db.prepare(
          `INSERT INTO stock_movements (product_id, type, quantity, notes, cashier_id)
           VALUES (?, 'out', ?, ?, ?)`,
        ).run(
          payload.productId,
          take,
          `Merma por caducidad (vence ${fmtDate(payload.expiryDate)})`,
          cashierId || null,
        );
      }
      db.prepare(`UPDATE product_lots SET status = 'cleared' WHERE id = ?`).run(payload.lotId);
      db.prepare(`UPDATE insights SET status = 'actioned' WHERE id = ?`).run(insightId);
      return { reduced: take, productName: product.name };
    }

    if (action === "discount") {
      if (role !== "admin") throw new Error("Solo el propietario puede cambiar precios");
      const pct = Number(percent);
      if (!DISCOUNT_OPTIONS.includes(pct)) throw new Error("Descuento no válido");
      const target = insight.type === "expiry" ? payload.productId : Number(productId);
      const allowed =
        insight.type === "expiry" ||
        (insight.type === "slow_stock" &&
          (payload.items || []).some((i) => i.productId === target));
      if (!allowed) throw new Error("Acción no válida");
      const product = db.prepare(`SELECT name FROM products WHERE id = ?`).get(target);
      if (!product) throw new Error("Producto no encontrado");
      // Rebaja por caducidad: termina sola el día que vence el lote.
      const end = insight.type === "expiry" ? payload.expiryDate : null;
      db.prepare(
        `UPDATE products
         SET discount_percent = ?, has_discount = 1, promo_fixed_price = 0,
             promo_start_date = ?, promo_end_date = ?
         WHERE id = ?`,
      ).run(pct, today, end, target);
      // En caducidad el aviso queda resuelto; en stock sin movimiento puede
      // haber más productos en la lista, así que el aviso sigue abierto.
      if (insight.type === "expiry") {
        db.prepare(`UPDATE insights SET status = 'actioned' WHERE id = ?`).run(insightId);
      }
      return { productName: product.name, percent: pct };
    }

    throw new Error("Acción no válida");
  });
  return run();
};

module.exports = {
  generateSmartAlerts,
  applyInsightAction,
  estimateLots,
  DISCOUNT_OPTIONS,
};
