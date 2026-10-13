"use strict";

// A2 · compactación de `change_log` y `replica_tombstones`.
//
// Las dos tablas crecen con cada escritura y nadie las acorta: sin mantenimiento
// una tienda con dos años de historia arrastraría un log gigante en cada
// arranque y en cada `/api/replica/changes`. Se poda al arrancar y una vez al
// día.
//
// RETENCIÓN PROPUESTA
//   · change_log     7 días, con suelo de 1000 filas: por debajo de esas
//                    filas más nuevas NUNCA se borra, así una tienda parada
//                    una semana no pierde su único historial y no obliga a las
//                    cajas a rehacer la descarga entera por nada.
//   · replica_tombstones  30 días. Crecen con las BAJAS, no con el tráfico
//                    (una fila por entidad borrada), y son la red de seguridad
//                    de una caja que pierde un evento: se guardan el triple.
//
// SUBIR `change_log_first_seq`
// Ese valor es «lo más antiguo que el Host todavía puede servir». Se fija en el
// `seq` del ÚLTIMO fila borrada + 1, no en el `seq` mínimo que quede: si se
// usara el mínimo, una caja que ya está al día (su cursor es justo la última
// fila que se podó) recibiría un `LOG_COMPACTED` y se bajaría 27 000 filas sin
// motivo. Sólo se sube, nunca se baja (el marcador `bulk` de una importación
// puede estar más alto).
//
// Si no se borró NADA, no se toca: mover el límite sin podar sería un resync
// regalado.

const activation = require("./activation");
const { CHANGE_LOG_TABLE, TOMBSTONE_TABLE } = require("./db-schema");

const DAY_MS = 24 * 60 * 60 * 1000;
const CHANGE_LOG_RETENTION_MS = 7 * DAY_MS;
const TOMBSTONE_RETENTION_MS = 30 * DAY_MS;
const KEEP_MIN_ROWS = 1000;
const FIRST_SEQ_KEY = "change_log_first_seq";
const RUN_EVERY_MS = DAY_MS;

const compact = (db, now = Date.now()) => {
  const out = { deleted: 0, tombstones: 0, firstSeq: null };
  if (!db) return out;

  const cutoffLog = now - CHANGE_LOG_RETENTION_MS;
  const cond =
    `ts < ? AND seq <= (SELECT COALESCE(MAX(seq), 0) - ${KEEP_MIN_ROWS} FROM ${CHANGE_LOG_TABLE})`;

  let doomedMax = null;
  try {
    const doomed = db
      .prepare(`SELECT MAX(seq) AS m FROM ${CHANGE_LOG_TABLE} WHERE ${cond}`)
      .get(cutoffLog);
    doomedMax = doomed && doomed.m != null ? Number(doomed.m) : null;
  } catch (err) {
    return out; // tabla aún no creada: nada que podar
  }

  if (doomedMax !== null) {
    out.deleted = db
      .prepare(`DELETE FROM ${CHANGE_LOG_TABLE} WHERE ${cond}`)
      .run(cutoffLog).changes;
  }

  try {
    out.tombstones = db
      .prepare(`DELETE FROM ${TOMBSTONE_TABLE} WHERE ts < ?`)
      .run(now - TOMBSTONE_RETENTION_MS).changes;
  } catch (err) {
    // Tabla de tumbas ausente en una BD de una entrega anterior.
  }

  if (out.deleted > 0) {
    const boundary = doomedMax + 1;
    const current = Number(activation.getSetting(db, FIRST_SEQ_KEY) || 0);
    if (Number.isFinite(boundary) && boundary > current) {
      activation.setSetting(db, FIRST_SEQ_KEY, String(boundary));
      out.firstSeq = boundary;
    }
  }

  return out;
};

module.exports = {
  compact,
  CHANGE_LOG_RETENTION_MS,
  TOMBSTONE_RETENTION_MS,
  KEEP_MIN_ROWS,
  FIRST_SEQ_KEY,
  RUN_EVERY_MS,
  DAY_MS,
};
