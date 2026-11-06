"use strict";

// ─── Local-first · cola de operaciones de la caja ───────────────────────────
// Lo que la caja hace sin esperar al Host (paso 2: agregar/reducir stock; los
// pasos 3-5 suman clientes, productos y promociones). Cada operación:
//
//   1. se valida en la caja y su EFECTO se aplica en la copia local al momento
//      (la pantalla ya lo ve), en la misma transacción que la encola;
//   2. viaja al Host como el mismo canal RPC de siempre, con su
//      Idempotency-Key: un reintento tras un corte nunca la duplica;
//   3. si el Host la rechaza queda en `conflict` y su efecto local se
//      deshace. NUNCA se borra: queda para revisión.
//
// Estados (los mismos nombres que la cola de ventas):
//   pending    → esperando turno / reintento
//   syncing    → en vuelo (vuelve a pending si el proceso muere)
//   needs_auth → el Host pidió sesión; sube tras el siguiente login
//   conflict   → el Host la rechazó (efecto local deshecho)
//   synced     → aceptada por el Host
//   cancelled  → quitada antes de subir (efecto local deshecho)
//
// El efecto se guarda para poder deshacerlo y REAPLICARLO: cuando la réplica
// trae del Host una fila de producto que todavía no incluye una operación
// pendiente, el stock local se corregiría hacia atrás.

const STATUS = Object.freeze({
  PENDING: "pending",
  SYNCING: "syncing",
  NEEDS_AUTH: "needs_auth",
  CONFLICT: "conflict",
  SYNCED: "synced",
  CANCELLED: "cancelled",
});

// Lo que todavía no llegó al Host (cuenta para cerrar caja y para el aviso).
const OPEN_STATUSES = [STATUS.PENDING, STATUS.SYNCING, STATUS.NEEDS_AUTH];

const nowIso = () => new Date().toISOString();

// Efecto local: por ahora sólo deltas de stock {productId, delta}.
const applyEffect = (db, effect, sign = 1) => {
  const list = (effect && Array.isArray(effect.stock) && effect.stock) || [];
  const stmt = db.prepare("UPDATE products SET stock = COALESCE(stock, 0) + ? WHERE id = ?");
  for (const e of list) {
    const delta = Number(e.delta) || 0;
    if (delta) stmt.run(sign * delta, Number(e.productId));
  }
};

const mapRow = (r) => ({
  id: r.id,
  channel: r.channel,
  args: JSON.parse(r.args_json || "[]"),
  effect: r.effect_json ? JSON.parse(r.effect_json) : null,
  label: r.label,
  idempotencyKey: r.idempotency_key,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  createdAt: r.created_at,
  syncedAt: r.synced_at,
});

const enqueue = (db, { channel, args = [], effect = null, label = null, idempotencyKey }) =>
  db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO pending_ops (channel, args_json, effect_json, label, idempotency_key, status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
      )
      .run(
        String(channel),
        JSON.stringify(args),
        effect ? JSON.stringify(effect) : null,
        label == null ? null : String(label),
        String(idempotencyKey),
        nowIso(),
      );
    applyEffect(db, effect, 1);
    return { id: Number(info.lastInsertRowid), status: STATUS.PENDING };
  })();

const list = (db, statuses = null) => {
  const rows = statuses && statuses.length
    ? db
        .prepare(
          `SELECT * FROM pending_ops WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY id`,
        )
        .all(...statuses)
    : db.prepare("SELECT * FROM pending_ops ORDER BY id").all();
  return rows.map(mapRow);
};

const countOpen = (db) =>
  db
    .prepare(`SELECT COUNT(*) AS c FROM pending_ops WHERE status IN (${OPEN_STATUSES.map(() => "?").join(",")})`)
    .get(...OPEN_STATUSES).c;

const summary = (db) => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c,
              SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) AS conflicts,
              SUM(CASE WHEN status = 'needs_auth' THEN 1 ELSE 0 END) AS needs_auth,
              MIN(created_at) AS oldest
         FROM pending_ops WHERE status IN ('pending','syncing','needs_auth','conflict')`,
    )
    .get();
  return {
    count: Number(row && row.c) || 0,
    conflicts: Number(row && row.conflicts) || 0,
    needsAuth: Number(row && row.needs_auth) || 0,
    oldestAt: (row && row.oldest) || null,
  };
};

const _set = (db, id, status, error) => {
  db.prepare(
    "UPDATE pending_ops SET status = ?, last_error = ?, attempts = attempts + 1 WHERE id = ?",
  ).run(status, error == null ? null : String(error), id);
};

// Quita una operación que aún no subió (deshace su efecto local) o descarta
// una rechazada.
const cancel = (db, id) =>
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM pending_ops WHERE id = ?").get(id);
    if (!row || ![STATUS.PENDING, STATUS.NEEDS_AUTH, STATUS.CONFLICT].includes(row.status)) {
      return { success: false, code: "NOT_CANCELLABLE" };
    }
    // Una rechazada ya deshizo su efecto al rechazarse: sólo se descarta.
    if (row.status !== STATUS.CONFLICT) {
      applyEffect(db, row.effect_json ? JSON.parse(row.effect_json) : null, -1);
    }
    db.prepare("UPDATE pending_ops SET status = 'cancelled', last_error = 'cancelada en la caja' WHERE id = ?").run(id);
    return { success: true };
  })();

const recoverStale = (db) =>
  db
    .prepare("UPDATE pending_ops SET status = 'pending', last_error = 'reintento tras cierre' WHERE status = 'syncing'")
    .run().changes;

const resumeNeedsAuth = (db) =>
  db.prepare("UPDATE pending_ops SET status = 'pending', last_error = NULL WHERE status = 'needs_auth'").run().changes;

// La réplica acaba de escribir filas de producto que vienen del Host. Las
// operaciones que el Host todavía no tiene (`pending`/`needs_auth`) se vuelven
// a aplicar encima. Las `syncing` no: el Host puede o no haberlas aplicado ya,
// y la fila que traiga después del commit las incluirá.
const reapplyPending = (db, productIds = null) => {
  const wanted = productIds ? new Set([...productIds].map(String)) : null;
  const rows = list(db, [STATUS.PENDING, STATUS.NEEDS_AUTH]);
  let touched = 0;
  db.transaction(() => {
    for (const r of rows) {
      const stock = ((r.effect && r.effect.stock) || []).filter(
        (e) => !wanted || wanted.has(String(e.productId)),
      );
      if (!stock.length) continue;
      applyEffect(db, { stock }, 1);
      touched += stock.length;
    }
  })();
  return touched;
};

// Fallos de red: se reintenta más tarde sin marcar nada.
// Lo mismo si el Host aún no aprueba o ya no reconoce esta caja: la operación
// es válida, sólo falta el vínculo. No es un rechazo: deshacerla la perdería.
const TRANSIENT = new Set([
  "HOST_UNREACHABLE",
  "NO_HOST_LINKED",
  "HOST_ERROR",
  "HOST_BUSY",
  "NOT_APPROVED",
  "NOT_PAIRED",
]);

// Sube en orden. `send(row)` devuelve lo que contestó el Host (el valor del
// handler o un fallo {success:false, code}). Se corta en el primer fallo de
// red o de sesión para conservar el orden.
let inFlight = null;
const sync = (db, send) => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    recoverStale(db);
    const rows = list(db, [STATUS.PENDING]);
    let synced = 0;
    let conflicts = 0;
    let stop = null;
    const done = [];
    for (const row of rows) {
      _set(db, row.id, STATUS.SYNCING, null);
      let res;
      try {
        res = await send(row);
      } catch (err) {
        res = { success: false, code: "HOST_UNREACHABLE", error: err && err.message };
      }
      const code = res && res.code;
      if (res && res.success !== false && !code) {
        db.prepare(
          "UPDATE pending_ops SET status = 'synced', synced_at = ?, last_error = NULL WHERE id = ?",
        ).run(nowIso(), row.id);
        synced += 1;
        done.push(row);
        continue;
      }
      if (TRANSIENT.has(code)) {
        _set(db, row.id, STATUS.PENDING, (res && res.error) || code);
        stop = code;
        break;
      }
      if (code === "SESSION_EXPIRED" || code === "PIN_INVALID") {
        _set(db, row.id, STATUS.NEEDS_AUTH, (res && res.error) || code);
        stop = "SESSION_EXPIRED";
        break;
      }
      // Rechazo del negocio (stock insuficiente en el Host, producto borrado):
      // se deshace lo que la caja ya había aplicado y se conserva para revisión.
      db.transaction(() => {
        applyEffect(db, row.effect, -1);
        _set(db, row.id, STATUS.CONFLICT, (res && (res.error || code)) || "rechazada por el Host");
      })();
      conflicts += 1;
      done.push(row);
    }
    return { success: !stop, synced, conflicts, stop, done, pending: countOpen(db) };
  })();
  return inFlight.finally(() => {
    inFlight = null;
  });
};

module.exports = {
  STATUS,
  OPEN_STATUSES,
  enqueue,
  list,
  countOpen,
  summary,
  cancel,
  recoverStale,
  resumeNeedsAuth,
  reapplyPending,
  sync,
  applyEffect,
};
