"use strict";

// Reglas de clientes compartidas por el Host (sus handlers IPC/RPC) y la caja
// (que aplica lo mismo en su copia local antes de subirlo). Un solo lugar: si la
// regla cambia, cambia en los dos lados a la vez.
//
// `uid` identifica a un cliente creado en una caja antes de que el Host le dé
// su `id`: viaja en la operación y en la venta, y el Host lo traduce.

const fail = (code, error) => ({ success: false, code, error });

const normalize = (data = {}) => {
  const name = String((data && data.name) || "").trim();
  if (!name) return fail("NAME_REQUIRED", "Nombre requerido");
  return {
    success: true,
    name,
    phone: String((data && data.phone) || "").trim(),
    tier_id: (data && data.tier_id) || null,
  };
};

const findByUid = (db, uid) =>
  uid ? db.prepare("SELECT * FROM customers WHERE uid = ?").get(String(uid)) || null : null;

// El id que corresponde en ESTA base: por uid si lo hay (un cliente creado en
// una caja), si no el id recibido.
// Sin rastro del uid: con un id definitivo (positivo) el cliente se busca por id
// y, si ya no está, fue borrado; con uno provisional su alta aún no llega.
const resolveId = (db, id, uid) => {
  const byUid = findByUid(db, uid);
  if (byUid) return byUid.id;
  return Number(id) > 0 ? Number(id) : null;
};

// Host · alta. Con `uid` es idempotente: la misma alta repetida devuelve el
// cliente ya creado en vez de duplicarlo.
const addCustomer = (db, data = {}) => {
  const n = normalize(data);
  if (!n.success) return n;
  const uid = data.uid ? String(data.uid) : null;
  const existing = findByUid(db, uid);
  if (existing) return { success: true, customer: existing };
  return db.transaction(() => {
    const info = db
      .prepare("INSERT INTO customers (name, phone, tier_id, uid) VALUES (?, ?, ?, ?)")
      .run(n.name, n.phone, n.tier_id, uid);
    const id = Number(info.lastInsertRowid);
    db.prepare("UPDATE customers SET qr_code = ? WHERE id = ?").run(`CLI-${id}`, id);
    return { success: true, customer: db.prepare("SELECT * FROM customers WHERE id = ?").get(id) };
  })();
};

// Host · edición. El cliente se busca por uid cuando viene de una caja.
const updateCustomer = (db, id, data = {}) => {
  const n = normalize(data);
  if (!n.success) return n;
  const target = resolveId(db, id, data.uid);
  if (!target) return fail("CUSTOMER_PENDING", "El cliente aún no llega al Host");
  const info = db
    .prepare("UPDATE customers SET name = ?, phone = ?, tier_id = ? WHERE id = ?")
    .run(n.name, n.phone, n.tier_id, target);
  if (!info.changes) return fail("CUSTOMER_NOT_FOUND", "Cliente no encontrado");
  return { success: true };
};

const sqliteNow = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// Caja · fila provisional: id negativo (nunca choca con los del Host) hasta que
// la réplica trae la definitiva con el mismo uid y la reemplaza.
const provisionalRow = (db, n, uid) => {
  const min = Number(db.prepare("SELECT MIN(id) AS m FROM customers").get().m) || 0;
  return {
    id: Math.min(min, 0) - 1,
    uid,
    name: n.name,
    phone: n.phone,
    tier_id: n.tier_id,
    qr_code: `CLI-T${uid.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    created_at: sqliteNow(),
  };
};

module.exports = { normalize, findByUid, resolveId, addCustomer, updateCustomer, provisionalRow };
