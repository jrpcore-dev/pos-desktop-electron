"use strict";

// Reglas de productos compartidas por el Host (sus handlers) y la caja (que
// aplica lo mismo en su copia antes de subirlo). Mismo patrón que clientes y
// catálogo: un producto creado en una caja lleva `uid` hasta que el Host le da
// su `id`, y el Host lo traduce al recibirlo (edición, stock, ventas).
//
// Local-first: crear y editar. El stock nunca viaja como cantidad exacta desde
// la caja: el inicial es un delta sobre 0 y editar no lo toca (ajustar a una
// cantidad exacta sigue en el Host). Borrar e importar también.

const fail = (code, error, extra = {}) => ({ success: false, code, error, ...extra });

const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();

const autoMinStock = (stock) => Math.max(1, Math.floor((parseFloat(stock) || 0) * 0.4));

const BARCODE_TAKEN = "Ya existe un producto con este código de barras";
const BARCODE_TAKEN_OTHER = "Ya existe otro producto con este código de barras";

// ── Promos por cantidad (product_prices) ────────────────────────────────────
const PRICE_TIER_TYPES = ["mayoreo", "combo", "llevapaga", "piezan"];
const PRICE_TIER_UNITS = ["piece", "box", "pack", "weight"];

const normalizePrices = (prices) => {
  const out = [];
  for (const p of Array.isArray(prices) ? prices : []) {
    if (!p || typeof p !== "object") continue;
    const type = PRICE_TIER_TYPES.includes(p.type) ? p.type : "combo";
    const unit = PRICE_TIER_UNITS.includes(p.unit) ? p.unit : "piece";
    // Por kilo la cantidad admite decimales ("desde 2.5 kg").
    const qty = unit === "weight" ? parseFloat(p.qty) || 0 : parseInt(p.qty, 10) || 0;
    const price = parseFloat(p.price) || 0;
    if (!(qty > 0) || !(price > 0)) continue;
    // lleva `qty`, paga `price` unidades enteras: 3×2 sí, 2×3 no.
    if (type === "llevapaga" && !(Number.isInteger(price) && price < qty)) continue;
    // cada `qty`-ésima unidad con `price`% menos.
    if (type === "piezan" && !(qty >= 2 && price <= 100)) continue;
    if ((type === "llevapaga" || type === "piezan") && unit === "weight") continue;
    out.push({ type, qty, price, unit });
  }
  return out;
};

const savePrices = (db, productId, prices) =>
  db.transaction(() => {
    db.prepare("DELETE FROM product_prices WHERE product_id = ?").run(productId);
    const stmt = db.prepare(
      "INSERT INTO product_prices (product_id, type, qty, price, unit) VALUES (?, ?, ?, ?, ?)",
    );
    for (const p of normalizePrices(prices)) stmt.run(productId, p.type, p.qty, p.price, p.unit);
  })();

// ── Columnas que escribe un alta o una edición (sin stock) ──────────────────
// Lo que la caja guarda en su copia es EXACTAMENTE lo que guardará el Host.
const values = (data = {}, current = null) => {
  // Campos que el formulario no envía se conservan en la edición.
  const keep = (key) => (current && !(key in data) ? current[key] ?? null : data[key] || null);
  return {
    barcode: current ? data.barcode || "" : data.barcode,
    name: data.name,
    search_name: nomarize(data.name),
    brand: data.brand,
    price: data.price,
    category_id: data.category_id || null,
    supplier_id: data.supplier_id || null,
    expiry_date: keep("expiry_date"),
    image_path: keep("image_path"),
    cost_price: data.cost_price || 0,
    discount_percent: data.discount_percent || 0,
    has_discount: data.has_discount ? 1 : 0,
    allow_manual_discount: data.allow_manual_discount ? 1 : 0,
    promo_fixed_price: data.promo_fixed_price || 0,
    promo_start_date: data.promo_start_date || "",
    promo_end_date: data.promo_end_date || "",
    sale_unit: data.sale_unit || "piece",
    box_qty: data.box_qty || 0,
    box_price: data.box_price || 0,
    pack_qty: data.pack_qty || 0,
    pack_price: data.pack_price || 0,
  };
};
const minStockFor = (data, stock) =>
  parseFloat(data.min_stock) > 0 ? parseFloat(data.min_stock) : autoMinStock(stock);

const findByUid = (db, uid) =>
  uid ? db.prepare("SELECT * FROM products WHERE uid = ?").get(String(uid)) || null : null;

// El id en ESTA base: por uid si lo hay; si no, un id definitivo (positivo).
const resolveId = (db, id, uid) => {
  const byUid = findByUid(db, uid);
  if (byUid) return byUid.id;
  return Number(id) > 0 ? Number(id) : null;
};
const PENDING = () => fail("PRODUCT_PENDING", "El producto nuevo aún no llega al Host; intenta de nuevo");

const setCols = (cols) => cols.map((c) => `${c} = ?`).join(", ");

// Host · alta. Con `uid` es idempotente: la misma alta repetida devuelve el
// producto ya creado (y no vuelve a sumar su stock inicial).
const add = (db, data = {}) => {
  if (!data || !String(data.name || "").trim()) return fail("NAME_REQUIRED", "Nombre requerido");
  const uid = data.uid ? String(data.uid) : null;
  const mine = findByUid(db, uid);
  if (mine) return { success: true, id: mine.id };
  const existing = db.prepare("SELECT id, is_active, uid FROM products WHERE barcode = ?").get(data.barcode);
  if (existing && existing.is_active) return fail("BARCODE_TAKEN", BARCODE_TAKEN);
  const v = values(data);
  v.stock = data.stock || 0;
  v.min_stock = minStockFor(data, data.stock);
  return db.transaction(() => {
    if (existing) {
      // Reactivar el que estaba dado de baja. Si viene de una caja, se queda
      // con su uid para que la réplica cambie la fila provisional por ésta.
      const cols = Object.keys(v);
      db.prepare(`UPDATE products SET ${setCols(cols)}, is_active = 1, uid = COALESCE(uid, ?) WHERE id = ?`).run(
        ...Object.values(v),
        uid,
        existing.id,
      );
      savePrices(db, existing.id, data.prices);
      return { success: true, id: existing.id, overwritten: true };
    }
    const cols = [...Object.keys(v), "uid"];
    const info = db
      .prepare(`INSERT INTO products (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .run(...Object.values(v), uid);
    const id = Number(info.lastInsertRowid);
    savePrices(db, id, data.prices);
    return { success: true, id };
  })();
};

// Host · edición. Desde una caja llega sin `stock` (no lo toca); el Host local
// sí puede mandarlo (cantidad exacta, con su movimiento de ajuste).
const update = (db, id, data = {}) => {
  if (!data || !id) return fail("INVALID", "Datos inválidos");
  const target = resolveId(db, id, data.uid);
  if (!target) return PENDING();
  const dup = db.prepare("SELECT id FROM products WHERE barcode = ? AND id != ?").get(data.barcode, target);
  if (dup) return fail("BARCODE_TAKEN", BARCODE_TAKEN_OTHER);
  const current = db.prepare("SELECT * FROM products WHERE id = ?").get(target);
  if (!current) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
  // stock omitido = el usuario no lo tocó: se conserva el actual (no pisa
  // ventas hechas mientras el formulario estaba abierto).
  const parsedStock = parseFloat(data.stock);
  const newStock = Number.isFinite(parsedStock) ? parsedStock : current.stock;
  const diff = newStock - (Number(current.stock) || 0);
  const v = values(data, current);
  v.stock = newStock;
  v.min_stock = minStockFor(data, newStock);
  v.is_active = data.is_active !== undefined ? data.is_active : 1;
  return db.transaction(() => {
    const cols = Object.keys(v);
    const info = db.prepare(`UPDATE products SET ${setCols(cols)} WHERE id = ?`).run(...Object.values(v), target);
    if (!info.changes) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
    if (diff !== 0) {
      db.prepare(
        "INSERT INTO stock_movements (product_id, type, quantity, notes, cashier_id) VALUES (?, ?, ?, ?, ?)",
      ).run(target, diff > 0 ? "in" : "out", Math.abs(diff), "Ajuste al editar producto", data.cashier_id || null);
    }
    savePrices(db, target, data.prices);
    return { success: true };
  })();
};

// Host · partidas de una venta que vienen de una caja con productos creados
// allá. Por uid; si el alta se rechazó por código repetido, el código de
// barras lo liga al producto que ya existe (mismo código = mismo producto).
const resolveCart = (db, cart) => {
  if (!Array.isArray(cart) || !cart.some((it) => it && it.product_uid)) return { success: true, cart };
  const out = [];
  for (const it of cart) {
    if (!it || !it.product_uid) {
      out.push(it);
      continue;
    }
    const mine = findByUid(db, it.product_uid);
    const byCode =
      !mine && it.product_barcode
        ? db.prepare("SELECT id FROM products WHERE barcode = ? AND is_active = 1").get(String(it.product_barcode))
        : null;
    const id = (mine && mine.id) || (byCode && byCode.id);
    if (!id) return PENDING();
    out.push({ ...it, id });
  }
  return { success: true, cart: out };
};

// Caja · el mismo código activo frena el alta antes de encolarla.
const barcodeTaken = (db, barcode, exceptId = null) => {
  const row = db.prepare("SELECT id, is_active FROM products WHERE barcode = ?").get(barcode);
  if (!row) return null;
  if (exceptId != null) return row.id !== exceptId ? row : null;
  return row.is_active ? row : null;
};

module.exports = {
  nomarize,
  autoMinStock,
  PRICE_TIER_TYPES,
  PRICE_TIER_UNITS,
  normalizePrices,
  savePrices,
  values,
  minStockFor,
  findByUid,
  resolveId,
  add,
  update,
  resolveCart,
  barcodeTaken,
  BARCODE_TAKEN,
  BARCODE_TAKEN_OTHER,
};
