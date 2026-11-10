"use strict";

// Precios especiales por nivel (tier_prices) y por cliente (customer_prices).
// Reglas compartidas por el Host (sus handlers) y la caja.
//
// Su llave natural es la pareja (nivel o cliente, producto), única en la
// tabla: no necesitan uid propio. Lo que sí puede ser provisional es el
// cliente o el producto creados en una caja: viajan por uid y el Host los
// traduce; si su alta aún no llega, se avisa con un código de reintento.
//
// Local-first: poner y quitar precios. Crear o borrar niveles sigue en el Host.

const productsCore = require("./products-core");

const fail = (code, error) => ({ success: false, code, error });

const TABLES = Object.freeze({
  customer_prices: {
    owner: "customer_id",
    ownerTable: "customers",
    ownerHasUid: true,
    pending: "CUSTOMER_PENDING",
    pendingMsg: "El cliente nuevo aún no llega al Host; intenta de nuevo",
    notFound: "Cliente no encontrado",
  },
  tier_prices: {
    owner: "tier_id",
    ownerTable: "customer_tiers",
    ownerHasUid: false,
    pending: "TIER_NOT_FOUND",
    pendingMsg: "Nivel de precio no encontrado",
    notFound: "Nivel de precio no encontrado",
  },
});

const table = (name) => {
  const t = TABLES[name];
  if (!t) throw new Error(`prices-core: tabla desconocida ${name}`);
  return t;
};

const validPrice = (price) => {
  const v = Number(price);
  return v > 0 ? v : null;
};

// El dueño (cliente o nivel) en ESTA base: por uid si lo hay; si no, un id
// definitivo (positivo).
const resolveOwner = (db, t, id, uid) => {
  if (uid && t.ownerHasUid) {
    const row = db.prepare(`SELECT id FROM ${t.ownerTable} WHERE uid = ?`).get(String(uid));
    if (row) return row.id;
  }
  return Number(id) > 0 ? Number(id) : null;
};

const resolvePair = (db, name, ref = {}) => {
  const t = table(name);
  const owner = resolveOwner(db, t, ref.ownerId, ref.ownerUid);
  if (!owner) return fail(t.pending, t.pendingMsg);
  const product = productsCore.resolveId(db, ref.productId, ref.productUid);
  if (!product) return fail("PRODUCT_PENDING", "El producto nuevo aún no llega al Host; intenta de nuevo");
  return { success: true, owner, product, t };
};

// Host · poner (o cambiar) el precio de la pareja. Repetirlo da lo mismo.
const set = (db, name, ref = {}) => {
  const price = validPrice(ref.price);
  if (!price) return fail("INVALID_PRICE", "Precio inválido");
  const r = resolvePair(db, name, ref);
  if (!r.success) return r;
  db.prepare(
    `INSERT INTO ${name} (${r.t.owner}, product_id, price) VALUES (?, ?, ?)
     ON CONFLICT(${r.t.owner}, product_id) DO UPDATE SET price = excluded.price`,
  ).run(r.owner, r.product, price);
  return { success: true };
};

// Host · quitar. Desde una caja llega la pareja (la fila puede no tener aún
// id del Host); sin pareja, por id como siempre. Quitar lo que ya no está no
// es error.
const remove = (db, name, id, ref = null) => {
  if (ref && (ref.ownerId || ref.ownerUid) && (ref.productId || ref.productUid)) {
    const r = resolvePair(db, name, ref);
    if (!r.success) return r;
    db.prepare(`DELETE FROM ${name} WHERE ${r.t.owner} = ? AND product_id = ?`).run(r.owner, r.product);
    return { success: true };
  }
  db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id);
  return { success: true };
};

module.exports = { TABLES, validPrice, resolvePair, set, remove };
