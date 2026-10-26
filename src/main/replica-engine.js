"use strict";

// 3d · motor de réplica del lado de la CAJA.
//
// Descarga inicial contra /api/replica/snapshot y /api/replica/changes del
// Host. Escribe en las MISMAS tablas que el Host (mismo esquema de db-schema,
// sin tablas *_cache) para que los handlers de lectura existentes funcionen
// sin duplicar nada. Sólo este motor escribe ahí y por una ruta interna:
// nunca hay IPC que escriba en las tablas replicables.
//
// La bajada va a tablas staging (stg_replica_<tabla>) y se aplica con un swap
// atómico; es reanudable por cursor y `sync_completed` pasa a "1" sólo DESPUÉS
// del swap. Si el log se compactó, se pide resync completo.
const activation = require("./activation");
const clientLink = require("./client-link");
const dbSchema = require("./db-schema");
const protocol = require("./protocol");

const STAGING_PREFIX = "stg_replica_";
const DEFAULT_PAGE_SIZE = 2000;
const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000; // resync completo cada 24 h

const KEYS = Object.freeze({
  LAST_SEQ: "replica_last_seq",
  SNAPSHOT_SEQ: "replica_snapshot_seq",
  // Fase 3 · identidad de la BD del Host con la que se bajó el snapshot.
  // Cambia al promover una caja o restaurar un respaldo: entonces el cursor
  // ya no significa nada y el Host pide resync.
  HOST_EPOCH: "replica_host_epoch",
  SYNCED_AT: "replica_synced_at",
  // Fase 4 · último momento en que la caja confirmó ir al día con el Host
  // (snapshot o delta aplicado). `SYNCED_AT` sigue siendo el del snapshot y
  // decide el resync de 24 h; éste decide los avisos de "datos viejos".
  FRESH_AT: "replica_fresh_at",
  STATE: "replica_state",
  MODE: "replica_mode",
  ERROR: "replica_error",
});

// Orden de swap: padres antes que hijos (la caja arranca sin ventas propias).
const SWAP_ORDER = [
  "categories",
  "customer_tiers",
  "products",
  "product_prices",
  "customers",
  "tier_prices",
  "customer_prices",
  "cashiers",
  "group_promos",
  "bundles",
  "bundle_items",
];

const fail = (code, error, extra = {}) => ({ success: false, code, error, ...extra });
const trimUrl = (u) => String(u || "").replace(/\/+$/, "");
const cursorKey = (table) => `replica_cursor_${table}`;

const getJson = async (url, { deviceId, token, epoch, timeoutMs = 15000 }) => {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "x-device-id": deviceId,
        "x-device-token": token,
        "x-protocol-version": protocol.PROTOCOL_VERSION,
        ...(epoch ? { "x-host-epoch": epoch } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, code: "HOST_UNREACHABLE", error: `No se pudo contactar al Host: ${err.message}` };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {}
  // 403 · el cuerpo trae el código real (NOT_APPROVED / SCOPE_MISSING…);
  // NOT_PAIRED queda como respaldo para los 403 sin código. El mensaje del
  // Host viaja igual y ahora además se conserva el scope que faltaba.
  if (res.status === 403)
    return {
      ok: false,
      code: (data && data.code) || "NOT_PAIRED",
      scopeRequired: (data && data.scopeRequired) || undefined,
      error: (data && data.error) || "Emparejamiento inválido",
    };
  if (!res.ok || !data) return { ok: false, code: "HOST_ERROR", error: `El Host respondió HTTP ${res.status}`, status: res.status };
  if (data.success === false) {
    return { ok: false, code: data.code || "HOST_ERROR", resync: data.resync === true, error: data.error };
  }
  return { ok: true, data };
};

const state = (db) => {
  const lastSeq = Number(activation.getSetting(db, KEYS.LAST_SEQ) || 0);
  const syncedAt = Number(activation.getSetting(db, KEYS.SYNCED_AT) || 0);
  const freshAt = Number(activation.getSetting(db, KEYS.FRESH_AT) || 0) || syncedAt;
  return {
    last_seq: lastSeq,
    snapshot_seq: Number(activation.getSetting(db, KEYS.SNAPSHOT_SEQ) || 0),
    synced_at: syncedAt || null,
    fresh_at: freshAt || null,
    sync_completed: activation.getSetting(db, clientLink.SETTINGS.SYNC_COMPLETED) === "1",
    state: activation.getSetting(db, KEYS.STATE) || "idle",
    mode: activation.getSetting(db, KEYS.MODE) || "offline",
    error: activation.getSetting(db, KEYS.ERROR) || null,
    stale: syncedAt ? Date.now() - syncedAt > RESYNC_AFTER_MS : true,
  };
};

const setState = (db, values) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    activation.setSetting(db, key, value === null ? "" : String(value));
  }
  return state(db);
};

// Tablas staging: se conservan entre ejecuciones para poder REANUDAR la
// descarga por el cursor persistido. Sólo se vacían al empezar una tabla.
const ensureStaging = (db, table, cols) => {
  const name = `${STAGING_PREFIX}${table}`;
  // Forma vieja del staging (p. ej. una descarga interrumpida ANTES de que
  // `products` ganara `day_open_stock`/`day_sold`): `CREATE ... IF NOT
  // EXISTS` no agrega columnas y el INSERT de la nueva forma reventaría.
  // Se elimina y se REINICA el cursor: si no, al reanudar quedarían filas
  // sueltas y el swap borraría la tabla entera para recargar sólo ese pedazo.
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  if (existing) {
    const have = new Set(
      db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name),
    );
    if (cols.some((c) => !have.has(c))) {
      db.exec(`DROP TABLE IF EXISTS ${name}`);
      activation.setSetting(db, cursorKey(table), "");
    }
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${name} AS SELECT ${cols.join(", ")} FROM ${table} WHERE 0`,
  );
  return db.prepare(
    `INSERT OR REPLACE INTO ${name} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(",")})`,
  );
};

const clearStaging = (db, table) => {
  db.exec(`DELETE FROM ${STAGING_PREFIX}${table}`);
};

// Swap atómico: con foreign_keys OFF, dentro de una única transacción se vacía
// y recarga cada tabla desde su staging. `settings` no se vacía: sólo se
// actualizan las claves replicadas, para no borrar las que son de la caja.
const swap = (db, tables, plan) => {
  const insertInto = (table, cols) =>
    db.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM ${STAGING_PREFIX}${table}`,
    );
  const stagingRows = (table) =>
    db.prepare(`SELECT * FROM ${STAGING_PREFIX}${table}`).all();

  db.pragma("foreign_keys = OFF");
  try {
    const apply = db.transaction(() => {
      for (const table of SWAP_ORDER.filter((t) => tables.includes(t))) {
        db.prepare(`DELETE FROM ${table}`).run();
        insertInto(table, plan[table]).run();
      }
      if (tables.includes("settings")) {
        const upsert = db.prepare(
          `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
        );
        for (const row of stagingRows("settings")) {
          if (row.value === null || row.value === undefined) continue;
          upsert.run(row.key, String(row.value));
        }
      }
    });
    apply.exclusive();
  } finally {
    db.pragma("foreign_keys = ON");
  }
};

// Descarga inicial completa. `onProgress({table, done, total, pct})` informa el
// avance real; el cursor por tabla se persiste, así que se puede reanudar.
const downloadSnapshot = async (db, opts = {}) => {
  const hostUrl = trimUrl(opts.hostUrl || activation.getSetting(db, clientLink.SETTINGS.HOST_URL));
  if (!hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  const deviceId = activation.getSetting(db, clientLink.SETTINGS.BOX_DEVICE_ID);
  const token = clientLink.readPairedToken(db);
  if (!deviceId) return fail("NOT_PAIRED", "La caja no está emparejada");
  if (!token) return fail("TOKEN_UNAVAILABLE", "No hay token de emparejamiento: se requiere cifrado con safeStorage");

  const plan = dbSchema.replicaPlan(db);
  const tables = opts.tables || SWAP_ORDER.concat("settings");
  const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
  setState(db, { [KEYS.STATE]: "downloading", [KEYS.ERROR]: null });

  let snapshotSeq = Number(activation.getSetting(db, KEYS.SNAPSHOT_SEQ) || 0) || 0;
  let hostEpoch = null;
  let done = 0;
  const totals = {};

  for (const table of tables) {
    const cols = plan[table];
    if (!cols) return fail("REPLICA_TABLE_UNKNOWN", `Tabla no replicable: ${table}`, { table });
    const insert = ensureStaging(db, table, cols);
    let tableDone = 0;
    let cursor = activation.getSetting(db, cursorKey(table));
    cursor = table === "settings" ? String(cursor || "") : Number(cursor) || 0;
    // Cursor vacío = se empieza la tabla: se limpia el staging de un intento
    // anterior. Cursor con valor = se REANUDA y el staging ya tiene filas.
    if (cursor === "" || cursor === 0) clearStaging(db, table);

    for (;;) {
      const qs = `table=${encodeURIComponent(table)}&limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`;
      const r = await getJson(`${hostUrl}/api/replica/snapshot?${qs}${snapshotSeq ? `&snapshot_seq=${snapshotSeq}` : ""}`, {
        deviceId,
        token,
      });
      if (!r.ok) {
        setState(db, { [KEYS.STATE]: "error", [KEYS.ERROR]: r.code });
        return fail(r.code, r.error, { table, scopeRequired: r.scopeRequired });
      }
      if (!snapshotSeq) snapshotSeq = Number(r.data.snapshot_seq) || 0;
      if (r.data.host_epoch) hostEpoch = String(r.data.host_epoch);
      if (!totals[table]) totals[table] = Number(r.data.total) || 0;

      const rows = r.data.rows || [];
      const write = db.transaction((list) => {
        for (const row of list) {
          const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
          insert.run(...values);
        }
      });
      write(rows);
      cursor = r.data.next_cursor;
      activation.setSetting(db, cursorKey(table), String(cursor));
      tableDone += rows.length;
      done += rows.length;
      if (typeof opts.onProgress === "function") {
        const tableTotal = totals[table] || 0;
        opts.onProgress({
          table,
          rows: rows.length,
          table_done: tableDone,
          table_total: tableTotal,
          // Avance real de la tabla: sólo es fiable cuando el Host informó total.
          table_pct: tableTotal ? Math.min(100, Math.round((tableDone / tableTotal) * 100)) : null,
          done,
        });
      }
      if (!r.data.has_more) break;
    }
    activation.setSetting(db, cursorKey(table), "");
  }

  // Swap + marcado de sincronizado en UNA transacción: `sync_completed` sólo
  // puede valer "1" si el swap se aplicó entero (nunca a medias).
  const finalize = db.transaction(() => {
    swap(db, tables, plan);
    for (const table of tables) activation.setSetting(db, cursorKey(table), "");
    clientLink.markSyncCompleted(db, true); // sólo tras el swap
    setState(db, {
      [KEYS.LAST_SEQ]: String(snapshotSeq),
      [KEYS.SNAPSHOT_SEQ]: String(snapshotSeq),
      // Sin epoch (Host anterior a la fase 3) se conserva el que hubiera.
      [KEYS.HOST_EPOCH]: hostEpoch || undefined,
      [KEYS.SYNCED_AT]: String(Date.now()),
      [KEYS.FRESH_AT]: String(Date.now()),
      [KEYS.STATE]: "synced",
      [KEYS.MODE]: "online",
      [KEYS.ERROR]: null,
    });
  });
  // FKs OFF alrededor de la transacción final. CLAVE: `PRAGMA foreign_keys`
  // es un NO-OP dentro de un BEGIN (sólo puede cambiarse sin transacción
  // pendiente), así que el OFF interno de `swap()` no hacía efecto al ir
  // anidado en `finalize` y el primer `DELETE` de un padre (categories,
  // primero en SWAP_ORDER) con hijos locales encima reventaba con
  // "FOREIGN KEY constraint failed" al re-sincronizar una caja con datos.
  // El OFF aquí sí aplica (fuera de transacción) y el finally la restaura
  // pase lo que pase; la atomicidad swap+marcadores queda intacta.
  db.pragma("foreign_keys = OFF");
  try {
    finalize.exclusive();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return { success: true, ...state(db) };
};

// Aplica un lote de cambios del Host (filas completas). Devuelve qué cambió
// para poder emitir `db-changed` coalescido al renderer.
const applyChanges = (db, changes = []) => {
  const plan = dbSchema.replicaPlan(db);
  const tables = new Set();
  const ids = {};
  let applied = 0;
  let lastSeq = 0;

  const applyOne = db.transaction((c) => {
    const cols = plan[c.tbl];
    if (!cols) return false;
    const pk = c.tbl === "settings" ? "key" : "id";
    if (c.op === "delete") {
      if (c.row_id === null || c.row_id === undefined) return false;
      db.prepare(`DELETE FROM ${c.tbl} WHERE ${pk} = ?`).run(c.row_id);
    } else {
      const row = c.row;
      if (!row) return false;
      const values = cols.map((col) => (row[col] === undefined ? null : row[col]));
      db.prepare(
        `INSERT OR REPLACE INTO ${c.tbl} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(",")})`,
      ).run(...values);
    }
    tables.add(c.tbl);
    (ids[c.tbl] = ids[c.tbl] || new Set()).add(String(c.row_id));
    return true;
  });

  // Deltas con FKs OFF (mismo criterio que el swap): el Host es el único
  // escritor y garanticiza la integridad; aquí sólo se copian filas completas
  // y el orden de los cambios no siempre respeta padres/hijos de la caja
  // (p. ej. `products.supplier_id` apunta a `suppliers`, que NO se replica).
  // El pragma sólo aplica FUERA de transacción → el OFF rodea el bucle.
  // Fase 4 · un cambio que no se puede aplicar (esquema distinto, dato
  // corrupto) detiene el lote SIN avanzar el cursor más allá: saltarlo
  // dejaría un hueco silencioso. Quien llama decide reintentar o resync.
  let failed = null;
  db.pragma("foreign_keys = OFF");
  try {
    for (const c of changes) {
      try {
        if (applyOne(c)) applied++;
      } catch (err) {
        failed = { seq: Number(c.seq), tbl: c.tbl, error: (err && err.message) || String(err) };
        break;
      }
      if (Number(c.seq) > lastSeq) lastSeq = Number(c.seq);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }

  if (lastSeq) activation.setSetting(db, KEYS.LAST_SEQ, String(lastSeq));
  return {
    applied,
    failed,
    last_seq: lastSeq,
    tables: [...tables],
    ids: Object.fromEntries(Object.entries(ids).map(([t, s]) => [t, [...s]])),
  };
};

// Resync completo: borra el estado de descarga para empezar de cero y deja la
// caja en "sin vender" hasta que el swap se aplique otra vez.
// `keepSelling` (Fase 4 · resync periódico): los datos actuales son buenos,
// sólo se renuevan. Se reinicia la descarga pero la caja sigue vendiendo con
// lo que tiene hasta el swap atómico del final.
const resetSync = (db, { keepSelling = false } = {}) => {
  const plan = dbSchema.replicaPlan(db);
  const reset = db.transaction(() => {
    for (const table of Object.keys(plan)) {
      activation.setSetting(db, cursorKey(table), "");
      db.exec(`DROP TABLE IF EXISTS ${STAGING_PREFIX}${table}`);
    }
    if (keepSelling) {
      activation.setSetting(db, KEYS.SNAPSHOT_SEQ, "0");
      return;
    }
    clientLink.markSyncCompleted(db, false);
    setState(db, {
      [KEYS.LAST_SEQ]: "0",
      [KEYS.SNAPSHOT_SEQ]: "0",
      [KEYS.STATE]: "idle",
      [KEYS.MODE]: "offline",
      [KEYS.ERROR]: null,
    });
  });
  reset.exclusive();
  return state(db);
};

// ¿Hay que volver a descargar el snapshot completo? (resync cada 24 h)
const isStale = (db) => state(db).stale;

// La caja confirmó con el Host que va al día (aunque no hubiera cambios).
const markFresh = (db) => activation.setSetting(db, KEYS.FRESH_AT, String(Date.now()));

module.exports = {
  STAGING_PREFIX,
  KEYS,
  SWAP_ORDER,
  RESYNC_AFTER_MS,
  state,
  setState,
  ensureStaging,
  clearStaging,
  swap,
  getJson,
  downloadSnapshot,
  applyChanges,
  resetSync,
  isStale,
  markFresh,
};
