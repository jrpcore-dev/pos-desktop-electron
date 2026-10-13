"use strict";

// A1 · aviso de cambios al renderer DEL HOST.
//
// El proceso main escribe en la BD por decenas de caminos distintos (venta
// local, venta que llega por /api/sales, entrada de stock, edición de un
// producto…), así que enganchar `db-changed` en cada uno de ellos significa
// olvidarse de uno y que el renderer se quede viejo en silencio. El único punto
// que TODOS esos caminos tienen en común es `change_log`: si una fila llegó a
// la BD, el trigger dejó su rastro ahí.
//
// Por eso se vigila SÓLO esa tabla y desde un único sonda. El aviso ya viene
// coalescido de fábrica: el sonda agrupa todo lo nuevo de la ventana y lo
// entrega de una vez a `emitDbChanged`, que además recoge tablas/ids durante
// ~150 ms antes de despachar al renderer.
//
// Arranca en el último `seq` conocido: el historial viejo no es un cambio, es
// el estado que el renderer ya pidió al abrir.

const { CHANGE_LOG_TABLE, REPLICATED_TABLES } = require("./db-schema");

const DEFAULT_MS = 150;
// Una importación sin modo lote puede dejar miles de filas de golpe: se leen
// por trozos y, si aún queda fondo, se vuelve a tirar enseguida en vez de
// bloquear el bucle de eventos con una consulta enorme.
const CHUNK = 5000;
const BULK_TABLE = "__bulk__";

const maxSeqOf = (db) => {
  try {
    const row = db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM ${CHANGE_LOG_TABLE}`)
      .get();
    return Number(row && row.s) || 0;
  } catch (err) {
    return 0;
  }
};

// Devuelve `stop()`. Inofensivo si se llama dos veces.
const startChangeLogWatch = (db, { onRows, intervalMs = DEFAULT_MS } = {}) => {
  if (!db || typeof onRows !== "function") return () => {};
  let stopped = false;
  let timer = null;
  let last = maxSeqOf(db);

  const tick = () => {
    if (stopped) return;
    let delay = intervalMs;
    try {
      const rows = db
        .prepare(
          `SELECT seq, tbl, row_id, op FROM ${CHANGE_LOG_TABLE} WHERE seq > ? ORDER BY seq LIMIT ${CHUNK}`,
        )
        .all(last);
      if (rows.length) {
        last = Number(rows[rows.length - 1].seq) || last;
        if (rows.length === CHUNK) delay = 0; // queda fondo: seguimos ya
        const tables = new Set();
        const ids = {};
        for (const r of rows) {
          // La marca de lote significa «cambió todo»: se avisa de las tablas
          // completas, no de `__bulk__`, que ninguna pantalla escucha.
          if (r.tbl === BULK_TABLE) {
            for (const t of REPLICATED_TABLES) tables.add(t);
            continue;
          }
          if (!r.tbl) continue;
          tables.add(r.tbl);
          if (r.row_id === null || r.row_id === undefined) continue;
          (ids[r.tbl] = ids[r.tbl] || []).push(String(r.row_id));
        }
        if (tables.size) onRows([...tables], ids);
      }
    } catch (err) {
      // Una BD cerrándose a mitad de tick no puede tumbar el sonda.
    }
    if (stopped) return;
    timer = setTimeout(tick, delay);
    timer.unref?.();
  };

  timer = setTimeout(tick, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
};

module.exports = { startChangeLogWatch };
