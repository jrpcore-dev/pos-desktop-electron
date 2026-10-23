"use strict";

// ─── Bloque 4 · cola de ventas offline de la caja ───────────────────────────
// Cuando el Host no responde, la venta NO se pierde: queda en `pending_sales`
// (SQLite de la caja) con su folio, su Idempotency-Key y la caja que estaba
// abierta. Al reconectar se sube EN ORDEN. El Host deduplica por la clave, así
// que un corte a mitad de subida no crea ventas dobles.
//
// Estados:
//   pending    → esperando turno / reintento
//   syncing    → en vuelo (se devuelve a pending si el proceso muere)
//   needs_auth → el Host rechazó la sesión; hace falta re-login
//   conflict   → el Host rechazó el payload (folio duplicado, etc.)
//   synced     → aceptada por el Host (se conserva para auditoría)
//   cancelled  → el usuario la quitó antes de subir

const salesCore = require("./sales-core");

const STATUS = Object.freeze({
  PENDING: "pending",
  SYNCING: "syncing",
  NEEDS_AUTH: "needs_auth",
  CONFLICT: "conflict",
  SYNCED: "synced",
  CANCELLED: "cancelled",
});

const nowIso = () => new Date().toISOString();

const enqueue = (db, row = {}) => {
  const info = db
    .prepare(
      `INSERT INTO pending_sales
       (folio, payload_json, idempotency_key, register_id, cashier_id, cashier_name,
        local_created_at, status, attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
    )
    .run(
      String(row.folio),
      JSON.stringify(row.payload || {}),
      String(row.idempotencyKey),
      row.registerId == null ? null : Number(row.registerId),
      row.cashierId == null ? null : Number(row.cashierId),
      row.cashierName == null ? null : String(row.cashierName),
      row.localCreatedAt || nowIso(),
    );
  return { id: info.lastInsertRowid, folio: row.folio, status: STATUS.PENDING };
};

const mapRow = (r) => ({
  id: r.id,
  folio: r.folio,
  payload: JSON.parse(r.payload_json || "{}"),
  idempotencyKey: r.idempotency_key,
  registerId: r.register_id,
  cashierId: r.cashier_id,
  cashierName: r.cashier_name,
  localCreatedAt: r.local_created_at,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  createdAt: r.created_at,
  syncedAt: r.synced_at,
});

const list = (db, statuses = null) => {
  const rows = statuses && statuses.length
    ? db
        .prepare(
          `SELECT * FROM pending_sales WHERE status IN (${statuses
            .map(() => "?")
            .join(",")}) ORDER BY id ASC`,
        )
        .all(...statuses)
    : db.prepare("SELECT * FROM pending_sales ORDER BY id ASC").all();
  return rows.map(mapRow);
};

const get = (db, id) => {
  const row = db.prepare("SELECT * FROM pending_sales WHERE id = ?").get(id);
  return row ? mapRow(row) : null;
};

const countBlocking = (db) =>
  db
    .prepare(
      "SELECT COUNT(*) AS c FROM pending_sales WHERE status NOT IN ('synced','cancelled')",
    )
    .get().c;

const countPending = (db) =>
  db
    .prepare(
      "SELECT COUNT(*) AS c FROM pending_sales WHERE status IN ('pending','syncing','needs_auth','conflict')",
    )
    .get().c;

const summary = (db) => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(local_created_at) AS oldest,
              SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) AS conflicts,
              SUM(CASE WHEN status = 'needs_auth' THEN 1 ELSE 0 END) AS needs_auth
       FROM pending_sales
       WHERE status IN ('pending','syncing','needs_auth','conflict')`,
    )
    .get();
  const oldest = row && row.oldest ? new Date(row.oldest).getTime() : null;
  return {
    count: Number(row && row.count) || 0,
    conflicts: Number(row && row.conflicts) || 0,
    needsAuth: Number(row && row.needs_auth) || 0,
    oldest: row && row.oldest ? row.oldest : null,
    oldestAgeMs: oldest && Number.isFinite(oldest) ? Date.now() - oldest : null,
  };
};

const cancel = (db, id) => {
  const info = db
    .prepare(
      "UPDATE pending_sales SET status = 'cancelled', last_error = ? WHERE id = ? AND status IN ('pending','needs_auth','conflict')",
    )
    .run("cancelada por el usuario", id);
  return { success: info.changes > 0 };
};

const retryConflicts = (db) => {
  const info = db
    .prepare(
      "UPDATE pending_sales SET status = 'pending', last_error = NULL WHERE status IN ('needs_auth','conflict')",
    )
    .run();
  return { success: true, retried: info.changes };
};

// Fase 2 · tras un login correcto, lo que esperaba sesión vuelve a la cola.
// Los `conflict` NO: esos requieren que alguien los revise.
const resumeNeedsAuth = (db) => {
  const info = db
    .prepare(
      "UPDATE pending_sales SET status = 'pending', last_error = NULL WHERE status = 'needs_auth'",
    )
    .run();
  return { resumed: info.changes };
};

const _set = (db, id, status, error) => {
  db.prepare(
    "UPDATE pending_sales SET status = ?, last_error = ?, attempts = attempts + 1 WHERE id = ?",
  ).run(status, error == null ? null : String(error), id);
};

// Marca como pending las filas que quedaron "syncing" por un cierre abrupto.
const recoverStale = (db) => {
  const info = db
    .prepare(
      "UPDATE pending_sales SET status = 'pending', last_error = 'reintento tras cierre' WHERE status = 'syncing'",
    )
    .run();
  return { recovered: info.changes };
};

// Fase 3 · al promover una caja a Host su BD se reemplaza por el respaldo y
// su cola (`pending_sales`) desaparecía con ella. Antes de restaurar se leen
// las filas aún no subidas; después se registran como ventas del nuevo Host
// (misma caja, folio, turno y cajero). Lo que no se pueda registrar vuelve a
// `pending_sales` como `conflict`: nunca se pierde una venta.
const unsyncedRows = (db) =>
  list(db, [STATUS.PENDING, STATUS.SYNCING, STATUS.NEEDS_AUTH, STATUS.CONFLICT]);

const absorbIntoHost = (db, rows, deviceId) => {
  let absorbed = 0;
  let kept = 0;
  for (const row of rows || []) {
    const p = row.payload || {};
    // Ya estaba en el Host (la subió antes del respaldo y la respuesta se
    // perdió): está registrada, no se duplica.
    const exists = db
      .prepare("SELECT id FROM sales WHERE folio = ?")
      .get(String(row.folio || "").toUpperCase());
    if (exists) {
      absorbed += 1;
      continue;
    }
    try {
      db.transaction(() => {
        const cashier = row.cashierId
          ? db.prepare("SELECT id, name, role FROM cashiers WHERE id = ?").get(row.cashierId)
          : null;
        const register = row.registerId
          ? db.prepare("SELECT id FROM cash_register WHERE id = ?").get(row.registerId)
          : null;
        salesCore.createSaleTx(db, {
          cart: p.cart,
          total: p.total,
          paymentMethod: p.paymentMethod,
          discountTotal: p.discountTotal,
          customerId: p.customerId == null ? undefined : p.customerId,
          cashierId: cashier ? cashier.id : null,
          cashierName: (cashier && cashier.name) || row.cashierName || "Usuario Principal",
          role: cashier ? cashier.role : "cashier",
          deviceId,
          // El turno puede no estar en el respaldo (se abrió después): la
          // venta queda fuera de turno en vez de perderse.
          registerId: register ? register.id : undefined,
          requireRegister: false,
          folio: row.folio,
          syncedAt: nowIso(),
          clientCreatedAt: row.localCreatedAt || undefined,
        });
      })();
      absorbed += 1;
    } catch (err) {
      enqueue(db, {
        folio: row.folio,
        payload: p,
        idempotencyKey: row.idempotencyKey,
        registerId: row.registerId,
        cashierId: row.cashierId,
        cashierName: row.cashierName,
        localCreatedAt: row.localCreatedAt,
      });
      _set(
        db,
        db.prepare("SELECT id FROM pending_sales WHERE idempotency_key = ? ORDER BY id DESC LIMIT 1")
          .get(String(row.idempotencyKey)).id,
        STATUS.CONFLICT,
        `no se pudo registrar al promover: ${(err && err.message) || err}`,
      );
      kept += 1;
    }
  }
  return { absorbed, kept };
};

const TRANSIENT = new Set(["HOST_UNREACHABLE", "NO_HOST_LINKED", "HOST_ERROR"]);

// Sube la cola en orden. `send(row)` debe devolver el JSON del Host con
// `{success:true|false, code?}`. Nunca lanza: un throw se trata como red caída.
const sync = async (db, send, opts = {}) => {
  recoverStale(db);
  const max = Number(opts.max) || 1000;
  const rows = db
    .prepare(
      "SELECT * FROM pending_sales WHERE status = 'pending' ORDER BY id ASC LIMIT ?",
    )
    .all(max)
    .map(mapRow);
  let synced = 0;
  let conflicts = 0;
  let stop = null;
  for (const row of rows) {
    _set(db, row.id, STATUS.SYNCING, null);
    let res;
    try {
      res = await send(row);
    } catch (err) {
      res = { success: false, code: "HOST_UNREACHABLE", error: err && err.message };
    }
    if (res && res.success) {
      db.prepare(
        "UPDATE pending_sales SET status = 'synced', synced_at = ?, last_error = NULL WHERE id = ?",
      ).run(nowIso(), row.id);
      synced += 1;
      continue;
    }
    const code = (res && res.code) || "HOST_ERROR";
    if (TRANSIENT.has(code)) {
      _set(db, row.id, STATUS.PENDING, (res && res.error) || code);
      stop = code;
      break;
    }
    if (code === "SESSION_EXPIRED") {
      _set(db, row.id, STATUS.NEEDS_AUTH, (res && res.error) || code);
      stop = code;
      break;
    }
    // Rechazo definitivo (folio duplicado, payload inválido): se conserva la
    // fila marcada para revisión. NUNCA se borra.
    _set(db, row.id, STATUS.CONFLICT, (res && (res.error || code)) || "conflicto");
    conflicts += 1;
  }
  return {
    success: !stop,
    synced,
    conflicts,
    stop,
    pending: countBlocking(db),
    summary: summary(db),
  };
};

module.exports = {
  STATUS,
  enqueue,
  list,
  get,
  cancel,
  retryConflicts,
  resumeNeedsAuth,
  countPending,
  countBlocking,
  summary,
  recoverStale,
  sync,
  unsyncedRows,
  absorbIntoHost,
};
