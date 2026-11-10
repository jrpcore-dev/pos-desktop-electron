"use strict";

// Promociones por categoría/marca (group_promos) y paquetes (bundles +
// bundle_items). Reglas compartidas por el Host (sus handlers) y la caja.
// Mismo patrón que clientes y productos: lo creado en una caja lleva `uid`
// hasta que el Host le da su `id`; la categoría de una promo y los productos
// de un paquete creados en una caja viajan por uid y el Host los traduce.
//
// Local-first: crear, editar y activar/desactivar. Borrar sigue en el Host.

const productsCore = require("./products-core");

const fail = (code, error) => ({ success: false, code, error });
const findByUid = (db, table, uid) =>
  uid ? db.prepare(`SELECT * FROM ${table} WHERE uid = ?`).get(String(uid)) || null : null;
// El id en ESTA base: por uid si lo hay; si no, un id definitivo (positivo).
const resolveId = (db, table, id, uid) => {
  const row = findByUid(db, table, uid);
  if (row) return row.id;
  return Number(id) > 0 ? Number(id) : null;
};
const activeOf = (v) => (v === false || v === 0 ? 0 : 1);
const datesOk = (start, end) => !(start && end && start > end);
const DATES_FAIL = () => fail("INVALID_DATES", "La fecha de inicio es posterior a la de fin");

// ── Promo por categoría o marca ─────────────────────────────────────────────
// `categoryId` ya resuelto (id de ESTA base).
const normalizeGroupPromo = (promo = {}, categoryId = null) => {
  const scope = promo.scope === "brand" ? "brand" : "category";
  const percent = parseFloat(promo.percent);
  if (!(percent > 0 && percent < 100)) return fail("INVALID_PERCENT", "El descuento debe estar entre 1% y 99%");
  const cat = scope === "category" ? categoryId : null;
  const brand = scope === "brand" ? String(promo.brand || "").trim() : "";
  if (scope === "category" && !cat) return fail("CATEGORY_REQUIRED", "Elige la categoría");
  if (scope === "brand" && !brand) return fail("BRAND_REQUIRED", "Elige la marca");
  const start = promo.start_date || "";
  const end = promo.end_date || "";
  if (!datesOk(start, end)) return DATES_FAIL();
  return {
    success: true,
    values: {
      name: String(promo.name || "").trim(),
      scope,
      category_id: cat,
      brand,
      percent,
      start_date: start,
      end_date: end,
      is_active: activeOf(promo.is_active),
    },
  };
};

// La categoría elegida, en ESTA base (creada en una caja: por uid).
const categoryOf = (db, promo = {}) => {
  if (promo.scope === "brand") return { success: true, id: null };
  if (promo.category_uid) {
    const row = findByUid(db, "categories", promo.category_uid);
    if (!row) return fail("CATEGORY_PENDING", "La categoría nueva aún no llega al Host; intenta de nuevo");
    return { success: true, id: row.id };
  }
  return { success: true, id: parseInt(promo.category_id, 10) || null };
};

// Host · guardar. Con `uid` es idempotente y la edición desde una caja se
// ubica por uid.
const saveGroupPromo = (db, promo = {}) => {
  const cat = categoryOf(db, promo);
  if (!cat.success) return cat;
  const n = normalizeGroupPromo(promo, cat.id);
  if (!n.success) return n;
  const cols = Object.keys(n.values);
  const target = resolveId(db, "group_promos", promo.id, promo.uid);
  if (target) {
    db.prepare(`UPDATE group_promos SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`).run(
      ...Object.values(n.values),
      target,
    );
    return { success: true, id: target };
  }
  // Edición de una promo creada en una caja que aún no llega: se espera.
  if (Number(promo.id) < 0) return fail("PROMO_PENDING", "La promoción nueva aún no llega al Host; intenta de nuevo");
  const info = db
    .prepare(`INSERT INTO group_promos (${[...cols, "uid"].join(", ")}) VALUES (${[...cols, "uid"].map(() => "?").join(", ")})`)
    .run(...Object.values(n.values), promo.uid ? String(promo.uid) : null);
  return { success: true, id: Number(info.lastInsertRowid) };
};

// ── Paquetes ────────────────────────────────────────────────────────────────
// slots: [{ qty, productIds: [..], productUids: [..] }] → productos ya en ids
// de ESTA base. Un producto creado en una caja que aún no llega: se espera.
const resolveSlots = (db, slots) => {
  const out = [];
  for (const s of Array.isArray(slots) ? slots : []) {
    const ids = [];
    for (const raw of s.productIds || []) {
      const n = Number(raw);
      if (n > 0) ids.push(n);
    }
    for (const uid of s.productUids || []) {
      const id = productsCore.resolveId(db, null, uid);
      if (!id) return fail("PRODUCT_PENDING", "Un producto nuevo del paquete aún no llega al Host; intenta de nuevo");
      ids.push(id);
    }
    out.push({ qty: Math.max(1, parseInt(s.qty, 10) || 1), productIds: [...new Set(ids)] });
  }
  return { success: true, slots: out.filter((s) => s.productIds.length > 0) };
};

const normalizeBundle = (bundle = {}, slots = []) => {
  const name = String(bundle.name || "").trim();
  const price = parseFloat(bundle.price);
  if (!name) return fail("NAME_REQUIRED", "Ponle nombre al paquete");
  if (!(price > 0)) return fail("INVALID_PRICE", "Indica el precio del paquete");
  const units = slots.reduce((n, s) => n + s.qty, 0);
  if (units < 2) return fail("TOO_FEW", "Un paquete lleva al menos 2 productos");
  const seen = new Set();
  for (const s of slots) {
    for (const id of s.productIds) {
      if (seen.has(id)) return fail("DUPLICATED", "Un producto no puede estar en dos lugares del paquete");
      seen.add(id);
    }
  }
  const start = bundle.start_date || "";
  const end = bundle.end_date || "";
  if (!datesOk(start, end)) return DATES_FAIL();
  return {
    success: true,
    values: { name, price, start_date: start, end_date: end, is_active: activeOf(bundle.is_active) },
    slots,
  };
};

// Filas de bundle_items de unos lugares ya resueltos.
const itemsOf = (slots) => {
  const out = [];
  slots.forEach((s, i) => {
    for (const pid of s.productIds) out.push({ slot: i, qty: s.qty, product_id: pid });
  });
  return out;
};

const saveBundle = (db, bundle = {}) => {
  const r = resolveSlots(db, bundle.slots);
  if (!r.success) return r;
  const n = normalizeBundle(bundle, r.slots);
  if (!n.success) return n;
  const v = n.values;
  return db.transaction(() => {
    let id = resolveId(db, "bundles", bundle.id, bundle.uid);
    if (id) {
      db.prepare("UPDATE bundles SET name=?, price=?, start_date=?, end_date=?, is_active=? WHERE id=?").run(
        v.name,
        v.price,
        v.start_date,
        v.end_date,
        v.is_active,
        id,
      );
      db.prepare("DELETE FROM bundle_items WHERE bundle_id = ?").run(id);
    } else {
      if (Number(bundle.id) < 0) return fail("BUNDLE_PENDING", "El paquete nuevo aún no llega al Host; intenta de nuevo");
      id = Number(
        db
          .prepare("INSERT INTO bundles (name, price, start_date, end_date, is_active, uid) VALUES (?, ?, ?, ?, ?, ?)")
          .run(v.name, v.price, v.start_date, v.end_date, v.is_active, bundle.uid ? String(bundle.uid) : null)
          .lastInsertRowid,
      );
    }
    const ins = db.prepare("INSERT INTO bundle_items (bundle_id, slot, qty, product_id) VALUES (?, ?, ?, ?)");
    for (const it of itemsOf(n.slots)) ins.run(id, it.slot, it.qty, it.product_id);
    return { success: true, id };
  })();
};

const setBundleActive = (db, id, active, uid = null) => {
  const target = resolveId(db, "bundles", id, uid);
  if (!target) {
    return Number(id) < 0
      ? fail("BUNDLE_PENDING", "El paquete nuevo aún no llega al Host; intenta de nuevo")
      : fail("BUNDLE_NOT_FOUND", "Paquete no encontrado");
  }
  db.prepare("UPDATE bundles SET is_active = ? WHERE id = ?").run(active ? 1 : 0, target);
  return { success: true };
};

module.exports = {
  findByUid,
  resolveId,
  normalizeGroupPromo,
  categoryOf,
  saveGroupPromo,
  resolveSlots,
  normalizeBundle,
  itemsOf,
  saveBundle,
  setBundleActive,
};
