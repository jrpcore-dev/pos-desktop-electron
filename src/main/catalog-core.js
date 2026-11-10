"use strict";

// Reglas del catálogo compartidas por el Host (sus handlers) y la caja (que
// aplica lo mismo en su copia antes de subirlo). Mismo patrón que clientes
// (customers-core.js): un registro creado en una caja lleva `uid` hasta que el
// Host le da su `id`, y el Host lo traduce al recibirlo.
//
// Local-first: crear y editar. Borrar se queda en el Host.

const fail = (code, error) => ({ success: false, code, error });
const str = (v) => String(v == null ? "" : v).trim();

const ENTITIES = Object.freeze({
  categories: {
    label: "Categoría",
    fields: { name: str, description: str },
    // El nombre es UNIQUE en la tabla: se revisa antes para dar un motivo claro.
    uniqueName: true,
    exists: "Ya existe una categoría con ese nombre",
    pending: "CATEGORY_PENDING",
    notFound: "CATEGORY_NOT_FOUND",
  },
  suppliers: {
    label: "Proveedor",
    fields: { name: str, contact: str, phone: str, email: str, address: str, delivery_days: str },
    uniqueName: false,
    pending: "SUPPLIER_PENDING",
    notFound: "SUPPLIER_NOT_FOUND",
  },
});

const entity = (table) => {
  const e = ENTITIES[table];
  if (!e) throw new Error(`catalog-core: tabla desconocida ${table}`);
  return e;
};

const normalize = (table, data = {}) => {
  const e = entity(table);
  const out = {};
  for (const [col, fn] of Object.entries(e.fields)) out[col] = fn(data && data[col]);
  if (!out.name) return fail("NAME_REQUIRED", "Nombre requerido");
  return { success: true, values: out };
};

const findByUid = (db, table, uid) =>
  uid ? db.prepare(`SELECT * FROM ${table} WHERE uid = ?`).get(String(uid)) || null : null;

// El id en ESTA base: por uid si lo hay; si no, un id definitivo (positivo).
// Uno provisional sin rastro del uid es un alta que aún no llega → null.
const resolveId = (db, table, id, uid) => {
  const byUid = findByUid(db, table, uid);
  if (byUid) return byUid.id;
  return Number(id) > 0 ? Number(id) : null;
};

const nameTaken = (db, table, name, exceptId = null) => {
  if (!entity(table).uniqueName) return false;
  const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name);
  return !!row && row.id !== exceptId;
};

// Host · alta. Con `uid` es idempotente: la misma alta repetida devuelve el
// registro ya creado.
const add = (db, table, data = {}) => {
  const e = entity(table);
  const n = normalize(table, data);
  if (!n.success) return n;
  const uid = data.uid ? String(data.uid) : null;
  const existing = findByUid(db, table, uid);
  if (existing) return { success: true, id: existing.id, row: existing };
  if (nameTaken(db, table, n.values.name)) return fail("NAME_TAKEN", e.exists);
  const cols = [...Object.keys(n.values), "uid"];
  const info = db
    .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...Object.values(n.values), uid);
  const id = Number(info.lastInsertRowid);
  return { success: true, id, row: db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) };
};

// Host · edición. Viene de una caja → se ubica por uid.
const update = (db, table, id, data = {}) => {
  const e = entity(table);
  const n = normalize(table, data);
  if (!n.success) return n;
  const target = resolveId(db, table, id, data.uid);
  if (!target) return fail(e.pending, `${e.label} aún no llega al Host`);
  if (nameTaken(db, table, n.values.name, target)) return fail("NAME_TAKEN", e.exists);
  const cols = Object.keys(n.values);
  const info = db
    .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .run(...Object.values(n.values), target);
  if (!info.changes) return fail(e.notFound, `${e.label} no encontrado`);
  return { success: true };
};

const sqliteNow = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// Caja · fila provisional con id negativo hasta que la réplica trae la del Host
// con el mismo uid y la reemplaza.
const provisionalRow = (db, table, values, uid) => {
  const min = Number(db.prepare(`SELECT MIN(id) AS m FROM ${table}`).get().m) || 0;
  return { id: Math.min(min, 0) - 1, uid, ...values, created_at: sqliteNow() };
};

// Referencias de un producto a categoría/proveedor creados en una caja: viajan
// como `category_uid` / `supplier_uid` y el Host las traduce a su id.
const REFS = [
  ["category_id", "category_uid", "categories"],
  ["supplier_id", "supplier_uid", "suppliers"],
];
// Caja · id provisional → uid, para que el Host lo entienda.
const refsToUid = (db, data) => {
  if (!data || typeof data !== "object") return data;
  let out = data;
  for (const [idCol, uidCol, table] of REFS) {
    if (!(Number(data[idCol]) < 0)) continue;
    const row = db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(Number(data[idCol]));
    if (row && row.uid) out = { ...out, [idCol]: null, [uidCol]: row.uid };
  }
  return out;
};
// Host · uid → id. Si el alta todavía no llegó, se avisa en vez de guardar el
// producto sin categoría.
const resolveRefs = (db, data) => {
  if (!data || typeof data !== "object") return { success: true, data };
  let out = data;
  for (const [idCol, uidCol, table] of REFS) {
    if (!data[uidCol]) continue;
    const row = findByUid(db, table, data[uidCol]);
    if (!row) return fail(entity(table).pending, `${entity(table).label} nueva aún no llega al Host; intenta de nuevo`);
    out = { ...out, [idCol]: row.id };
  }
  return { success: true, data: out };
};

module.exports = {
  ENTITIES,
  normalize,
  findByUid,
  resolveId,
  nameTaken,
  add,
  update,
  provisionalRow,
  refsToUid,
  resolveRefs,
};
