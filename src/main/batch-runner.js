"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3e · Trabajo largo sin bloquear el proceso principal.
//
// Electron corre UI, IPC, HTTP y los timers en UN solo hilo. Un
// `db.transaction()` de 27 000 filas lo ocupa varios segundos enteros, y
// mientras tanto no se pinta el Host, no laten los SSE y no responden las
// cajas. `runBatched` parte el trabajo en lotes y `yieldToLoop` devuelve el
// hilo entre lote y lote.
//
// Contraprestada consciente: al trocear se pierde la atomicidad de un único
// transacción. Es el trade correcto aquí porque (a) los imports son
// idempotentes — repetirlos omite lo ya insertado — y (b) una importación a
// medias es preferible a un Host congelado que no responde a ninguna caja.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BATCH_SIZE = 500;

// Cede el hilo al bucle de eventos (timers, IPC, sockets) y devuelve una
// promesa que se resuelve en el siguiente giro. `setImmediate` y no
// `setTimeout(0)`: corre antes que los timers ya vencidos, así el siguiente
// lote empieza el pronto posible sin comerse el turno de la E/S de red.
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Procesa `items` en lotes de `batchSize`, llamando a `worker(batch, meta)`
 * por cada uno y cediendo el hilo entre lotes.
 *
 * @param {Array} items    todo el trabajo (se recorre con `slice`, sin copiar)
 * @param {(batch: Array, meta: {from:number,to:number,total:number,index:number}) => void} worker
 * @param {{batchSize?:number, onBatch?:(meta:{done:number,total:number,index:number,ms:number}) => void}} [opts]
 * @returns {Promise<{batches:number, processed:number, ms:number}>}
 */
const runBatched = async (items, worker, opts = {}) => {
  if (!Array.isArray(items)) throw new TypeError("runBatched: `items` debe ser un array");
  if (typeof worker !== "function") throw new TypeError("runBatched: `worker` debe ser una función");

  const { batchSize = DEFAULT_BATCH_SIZE, onBatch } = opts;
  const size = Math.max(1, Math.floor(batchSize) || DEFAULT_BATCH_SIZE);
  const total = items.length;
  const started = Date.now();

  let batches = 0;
  for (let from = 0; from < total; from += size) {
    const to = Math.min(from + size, total);
    worker(items.slice(from, to), { from, to, total, index: batches });
    batches += 1;
    if (typeof onBatch === "function") {
      onBatch({ done: to, total, index: batches - 1, ms: Date.now() - started });
    }
    // El último lote no cede el hilo: no hay nada que esperar después.
    if (to < total) await yieldToLoop();
  }

  return { batches, processed: total, ms: Date.now() - started };
};

module.exports = { runBatched, yieldToLoop, DEFAULT_BATCH_SIZE };
