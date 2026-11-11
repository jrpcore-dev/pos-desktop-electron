"use strict";

// Reportes que ayudan a decidir (no sólo a ver cuánto se vendió):
//   · productMovement     → cómo se vendió un producto día por día en el
//                           periodo, contra el periodo anterior de igual largo,
//                           y para cuántos días le alcanza el stock.
//   · purchaseSuggestions → qué pedir y cuánto: lo que se acaba antes de la
//                           entrega de su proveedor que sigue a la próxima.
// Las fechas son de México (las ventas se guardan en UTC: −6 h), igual que el
// resto de los reportes y los avisos de la campana.

const MX_SHIFT = "-6 hours";
const VELOCITY_DAYS = 28; // ritmo de venta: últimas 4 semanas (igual que los avisos)
const SAFETY_DAYS = 2; // colchón al sugerir cuánto pedir
const ROWS = 6; // productos en la lista de "Movimiento"
const NO_DELIVERY_CYCLE = 7; // proveedor sin días de entrega: semanal
const DAY_KEYS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"]; // getUTCDay()
const DAY_SHORT = { lun: "lun", mar: "mar", mie: "mié", jue: "jue", vie: "vie", sab: "sáb", dom: "dom" };
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const toDate = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const isoOf = (dt) => dt.toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const dt = toDate(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoOf(dt);
};
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const mxToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

// Unidades vendidas por día (fecha de México) de un producto en [start, end].
const unitsByDay = (db, productId, start, end, dev) => {
  const rows = db
    .prepare(
      `SELECT DATE(s.created_at, '${MX_SHIFT}') AS day, SUM(si.quantity) AS units
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id = ?
          AND DATE(s.created_at, '${MX_SHIFT}') BETWEEN ? AND ?
          AND (s.status IS NULL OR s.status != 'cancelado')${dev.sql}
        GROUP BY day`,
    )
    .all(productId, start, end, ...dev.args);
  return new Map(rows.map((r) => [r.day, Number(r.units) || 0]));
};

// Ritmo de venta diario (últimos VELOCITY_DAYS días) de uno o varios productos.
const dailyPace = (db, today) => {
  const since = addDays(today, -VELOCITY_DAYS);
  const rows = db
    .prepare(
      `SELECT si.product_id AS id, SUM(si.stock_deducted) AS sold
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE DATE(s.created_at, '${MX_SHIFT}') > ?
          AND (s.status IS NULL OR s.status != 'cancelado')
          AND si.product_id IS NOT NULL
        GROUP BY si.product_id`,
    )
    .all(since);
  return new Map(rows.map((r) => [r.id, (Number(r.sold) || 0) / VELOCITY_DAYS]));
};

const coverOf = (stock, daily) => (daily > 0 ? Math.max(stock, 0) / daily : null);

// ── Movimiento de productos ─────────────────────────────────────────────────
// `dev` = filtro por caja ya armado ({sql, args}) con el alias `s`.
const productMovement = (db, { startDate, endDate, productId = null, dev = { sql: "", args: [] }, today = mxToday() } = {}) => {
  if (!startDate || !endDate) return { success: false, error: "Periodo inválido" };
  const span = daysBetween(startDate, endDate) + 1;
  const prevEnd = addDays(startDate, -1);
  const prevStart = addDays(prevEnd, -(span - 1));

  // Los más vendidos del periodo: para elegir cuál ver.
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.sale_unit, SUM(si.quantity) AS units
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
        WHERE DATE(s.created_at, '${MX_SHIFT}') BETWEEN ? AND ?
          AND (s.status IS NULL OR s.status != 'cancelado')${dev.sql}
        GROUP BY p.id
        ORDER BY units DESC
        LIMIT 15`,
    )
    .all(startDate, endDate, ...dev.args)
    .map((r) => ({ id: r.id, name: r.name, saleUnit: r.sale_unit, units: Number(r.units) || 0 }));

  // Las filas de abajo: los más vendidos con su periodo día por día en
  // miniatura, contra el anterior y su stock (dos consultas para todos).
  const top = products.slice(0, ROWS);
  let rows = [];
  if (top.length) {
    const ids = top.map((p) => p.id);
    const marks = ids.map(() => "?").join(",");
    const perDay = db
      .prepare(
        `SELECT si.product_id AS id, DATE(s.created_at, '${MX_SHIFT}') AS day, SUM(si.quantity) AS units
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id IN (${marks})
            AND DATE(s.created_at, '${MX_SHIFT}') BETWEEN ? AND ?
            AND (s.status IS NULL OR s.status != 'cancelado')${dev.sql}
          GROUP BY si.product_id, day`,
      )
      .all(...ids, startDate, endDate, ...dev.args);
    const prevTotals = db
      .prepare(
        `SELECT si.product_id AS id, SUM(si.quantity) AS units
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id IN (${marks})
            AND DATE(s.created_at, '${MX_SHIFT}') BETWEEN ? AND ?
            AND (s.status IS NULL OR s.status != 'cancelado')${dev.sql}
          GROUP BY si.product_id`,
      )
      .all(...ids, prevStart, prevEnd, ...dev.args);
    const stocks = db.prepare(`SELECT id, stock FROM products WHERE id IN (${marks})`).all(...ids);
    const pace = dailyPace(db, today);
    const dayIdx = new Map();
    for (let i = 0; i < span; i++) dayIdx.set(addDays(startDate, i), i);
    rows = top.map((p) => {
      const days = new Array(span).fill(0);
      for (const r of perDay) if (r.id === p.id && dayIdx.has(r.day)) days[dayIdx.get(r.day)] = Number(r.units) || 0;
      const prevTotal = Number((prevTotals.find((r) => r.id === p.id) || {}).units) || 0;
      const stock = Number((stocks.find((r) => r.id === p.id) || {}).stock) || 0;
      return { ...p, days, total: p.units, prevTotal, stock, coverDays: coverOf(stock, pace.get(p.id) || 0) };
    });
  }

  const id = Number(productId) || (products[0] && products[0].id) || null;
  if (!id) return { success: true, products, rows, selected: null };
  const product = db.prepare("SELECT id, name, stock, sale_unit FROM products WHERE id = ?").get(id);
  if (!product) return { success: true, products, rows, selected: null };

  const now = unitsByDay(db, id, startDate, endDate, dev);
  const prev = unitsByDay(db, id, prevStart, prevEnd, dev);
  const days = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(startDate, i);
    const prevDate = addDays(prevStart, i);
    days.push({
      date,
      label: span <= 7 ? DAY_LABELS[toDate(date).getUTCDay()] : String(toDate(date).getUTCDate()),
      units: now.get(date) || 0,
      prev: prev.get(prevDate) || 0,
      future: date > today,
    });
  }
  const total = days.reduce((a, d) => a + d.units, 0);
  const prevTotal = days.reduce((a, d) => a + d.prev, 0);
  const best = days.reduce((b, d) => (d.units > (b ? b.units : 0) ? d : b), null);
  const daily = dailyPace(db, today).get(id) || 0;
  return {
    success: true,
    products,
    rows,
    selected: {
      id: product.id,
      name: product.name,
      saleUnit: product.sale_unit,
      days,
      total,
      prevTotal,
      best: best && best.units > 0 ? { label: best.label, date: best.date, units: best.units } : null,
      stock: Number(product.stock) || 0,
      daily,
      coverDays: coverOf(Number(product.stock) || 0, daily),
    },
  };
};

// ── Lista de compra sugerida ────────────────────────────────────────────────
// Días de entrega "lun,mar,…" → días hasta la próxima (desde mañana) y hasta
// la siguiente a ésa. Lo que se pide hoy llega en la próxima, y tiene que
// alcanzar hasta la siguiente.
const deliveryWindow = (csv, today) => {
  const keys = String(csv || "").split(",").map((k) => k.trim()).filter((k) => DAY_KEYS.includes(k));
  if (!keys.length) return { next: NO_DELIVERY_CYCLE, following: NO_DELIVERY_CYCLE * 2, label: null };
  const hits = [];
  for (let i = 1; i <= 14 && hits.length < 2; i++) {
    if (keys.includes(DAY_KEYS[toDate(addDays(today, i)).getUTCDay()])) hits.push(i);
  }
  const ordered = DAY_KEYS.slice(1).concat("dom").filter((k) => keys.includes(k));
  const label = keys.length === 7 ? "diario" : ordered.map((k) => DAY_SHORT[k]).join(keys.length === 2 ? " y " : ", ");
  return { next: hits[0], following: hits[1] || hits[0] + 7, label };
};

const suggestionText = (need, saleUnit, boxQty) => {
  if (saleUnit === "weight") return `${Math.ceil(need * 10) / 10} kg`;
  const box = boxQty > 1 ? boxQty : 0;
  if (box) {
    const boxes = Math.ceil(need / box);
    return `${boxes} ${boxes === 1 ? "caja" : "cajas"}`;
  }
  return `${Math.ceil(need)} pz`;
};

const purchaseSuggestions = (db, { today = mxToday(), limit = null } = {}) => {
  const pace = dailyPace(db, today);
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.stock, p.sale_unit, p.box_qty, p.cost_price,
              p.supplier_id, sup.name AS supplier_name, sup.delivery_days, sup.phone AS supplier_phone
         FROM products p
         LEFT JOIN suppliers sup ON sup.id = p.supplier_id
        WHERE p.is_active = 1`,
    )
    .all();
  const items = [];
  for (const p of products) {
    const daily = pace.get(p.id) || 0;
    if (!(daily > 0)) continue;
    const stock = Math.max(Number(p.stock) || 0, 0);
    const win = deliveryWindow(p.delivery_days, today);
    const daysLeft = stock / daily;
    if (daysLeft >= win.following) continue; // alcanza hasta la entrega siguiente
    const need = daily * (win.following + SAFETY_DAYS) - stock;
    if (need <= 0) continue;
    const pieces = p.sale_unit === "weight" ? Math.ceil(need * 10) / 10 : Math.ceil(need);
    items.push({
      productId: p.id,
      name: p.name,
      supplierId: p.supplier_id || null,
      supplierName: p.supplier_name || "Sin proveedor",
      supplierPhone: p.supplier_phone || "",
      delivery: win.label,
      nextDeliveryInDays: win.next,
      stock,
      daily,
      daysLeft,
      // Se acaba antes de que llegue lo que se pida hoy: urgente.
      urgent: daysLeft < win.next,
      order: suggestionText(need, p.sale_unit, Number(p.box_qty) || 0),
      cost: Math.round(pieces * (Number(p.cost_price) || 0) * 100) / 100,
    });
  }
  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    success: true,
    total: items.length,
    items: limit ? items.slice(0, limit) : items,
    cost: Math.round(items.reduce((a, i) => a + i.cost, 0) * 100) / 100,
  };
};

module.exports = { productMovement, purchaseSuggestions, deliveryWindow, addDays, daysBetween };
