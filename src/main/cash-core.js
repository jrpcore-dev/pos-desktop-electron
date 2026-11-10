"use strict";

// Retiros (gastos) y entradas de dinero de la caja abierta. Reglas compartidas
// por el Host (sus handlers) y la caja, que aplica lo mismo en su copia antes
// de subirlo. Mismo patrón que clientes y productos: el movimiento hecho en
// una caja lleva `uid` hasta que el Host le da su `id`.
//
// Los totales de la caja (`cash_register.expenses` / `cash_in`) se mueven como
// suma o resta, nunca como cantidad exacta: un retiro de otra caja o del Host
// hecho al mismo tiempo no se pisa.
//
// Local-first: registrar. Cancelar un movimiento sigue en el Host.

const salesCore = require("./sales-core");

const fail = (code, error) => ({ success: false, code, error });

const KINDS = Object.freeze({
  out: { col: "expenses", noRegister: "No hay caja abierta para registrar gasto" },
  in: { col: "cash_in", noRegister: "No hay caja abierta para registrar la entrada" },
});

// Lo que se guarda, igual en el Host y en la caja.
const normalize = (kind, data = {}) => {
  const value = Number(data.amount);
  if (!(value > 0)) return fail("INVALID_AMOUNT", "Ingresa un monto válido.");
  if (kind === "in") {
    // El motivo de una entrada no es obligatorio: sin él queda "Sin motivo",
    // visible en los movimientos (una entrada no puede causar faltante).
    return { success: true, amount: value, reason: String(data.reason || "").trim() || "Sin motivo", category: null };
  }
  // El motivo lo pide la pantalla; aquí no se vuelve obligatorio (igual que antes).
  const reason = String(data.reason || "").trim();
  // category 'supplier' = pago a proveedor/mercancía; NULL = otro gasto.
  return { success: true, amount: value, reason, category: data.category === "supplier" ? "supplier" : null };
};

// La caja a la que va: la que se indicó (la caja abierta cuando se hizo) si es
// de este dispositivo; si no, la abierta del cajero.
const registerFor = (db, data, deviceId) => {
  const id = Number(data.registerId);
  if (id) {
    const row = db.prepare("SELECT * FROM cash_register WHERE id = ?").get(id);
    if (row && (!deviceId || !row.device_id || row.device_id === deviceId)) return row;
  }
  return salesCore.findOpenRegister(db, data.cashierId, data.role, deviceId);
};

const findByUid = (db, uid) =>
  uid ? db.prepare("SELECT * FROM cash_register_expenses WHERE uid = ?").get(String(uid)) || null : null;

// Registra el movimiento. Con `uid` es idempotente: el mismo retiro repetido
// devuelve el ya guardado sin volver a sumarlo.
const add = (db, kind, data = {}, deviceId = null) => {
  const k = KINDS[kind];
  if (!k) throw new Error(`cash-core: tipo desconocido ${kind}`);
  const n = normalize(kind, data);
  if (!n.success) return n;
  const uid = data.uid ? String(data.uid) : null;
  return db.transaction(() => {
    const mine = findByUid(db, uid);
    if (mine) {
      const reg = db.prepare(`SELECT ${k.col} AS total FROM cash_register WHERE id = ?`).get(mine.register_id);
      return { success: true, id: mine.id, registerId: mine.register_id, total: reg ? reg.total : null };
    }
    const register = registerFor(db, data, deviceId);
    if (!register) return fail("NO_OPEN_REGISTER", k.noRegister);
    db.prepare(`UPDATE cash_register SET ${k.col} = COALESCE(${k.col}, 0) + ? WHERE id = ?`).run(n.amount, register.id);
    const info = db
      .prepare(
        "INSERT INTO cash_register_expenses (register_id, amount, reason, category, kind, uid) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(register.id, n.amount, n.reason, n.category, kind === "in" ? "in" : null, uid);
    const total = db.prepare(`SELECT ${k.col} AS total FROM cash_register WHERE id = ?`).get(register.id).total;
    return { success: true, id: Number(info.lastInsertRowid), registerId: register.id, total };
  })();
};

module.exports = { KINDS, normalize, registerFor, findByUid, add };
