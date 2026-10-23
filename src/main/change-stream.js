"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3e · Túnel de eventos Host → caja sobre SSE (`GET /api/events`).
//
// Por qué SSE y no WebSocket: la caja sólo necesita recibir, no hablar. El
// protocolo ya trae reanudación (`Last-Event-ID`), reconexión automática y
// pasa por proxies sin handshake de upgrade. Menos superficie para el mismo
// servicio.
//
// Un ÚNICO sonda mira `change_log` cada COALESCE_MS y emite un solo evento por
// ventana a cada caja conectada. El `id` de cada evento es el `seq` máximo de
// esa ventana, así que la caja reanuda sólo con `Last-Event-ID` y el Host no
// guarda estado por cliente más allá de su cursor.
//
// Contrato de eventos:
//   hello      {seq, first_seq, busy}            al conectar: dónde estamos
//   changes    {seq, first_seq, tables, count}   coalescido (100-250 ms)
//   resync     {reason, first_seq}               el hueco pedido ya no existe
//   busy       {reason}                          import masivo empezado
//   ready      {reason, seq, first_seq}          import masivo terminado
//   heartbeat  {seq, busy}                       cada HEARTBEAT_MS
//
// El latido se envía como evento y NO como comentario `: hb`: un comentario es
// invisible para `EventSource`, y así la caja puede medir su propio retraso
// comparando el `seq` del latido con el suyo.
//
// Dependencias explícitas: recibe `changeLogTable` y `getSetting` en vez de
// leerlos de `db`, que es una instancia de better-sqlite3 y no conoce nada
// del esquema.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_COALESCE_MS = 150; // dentro del rango pedido (100-250 ms)
const DEFAULT_HEARTBEAT_MS = 5000;
const CHANGE_LOG_FIRST_SEQ_KEY = "change_log_first_seq";

const createChangeStream = ({
  db,
  changeLogTable,
  getSetting,
  coalesceMs = DEFAULT_COALESCE_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
}) => {
  if (!db) throw new Error("createChangeStream: falta `db`");
  if (!changeLogTable) throw new Error("createChangeStream: falta `changeLogTable`");
  if (typeof getSetting !== "function") throw new Error("createChangeStream: falta `getSetting`");

  // Seq máximo observado por el sonda. Es sólo una optimización para no tocar
  // la BD cuando no hay nada nuevo: la verdad la manda `change_log`.
  let lastSeen = 0;
  let busyReason = null;
  let pollTimer = null;
  let beatTimer = null;
  // Cada cliente guarda SU cursor: dos cajas pueden estar a distinto punto.
  const clients = new Set();

  const maxSeq = () =>
    db.prepare(`SELECT COALESCE(MAX(seq),0) s FROM ${changeLogTable}`).get().s;
  // Primer seq todavía servible. Sólo la compactación lo sube.
  const firstSeq = () => Number(getSetting(CHANGE_LOG_FIRST_SEQ_KEY) || 0);

  const write = (client, event, data, id) => {
    if (client.res.writableEnded) return;
    let frame = "";
    if (id !== undefined && id !== null) frame += `id: ${id}\n`;
    frame += `event: ${event}\n`;
    frame += `data: ${JSON.stringify(data)}\n\n`;
    client.res.write(frame);
  };

  const writeAll = (event, data, id) => {
    for (const c of clients) write(c, event, data, id);
  };

  // Tablas tocadas en el tramo (desde, hasta]. Se consulta sólo para darle a la
  // caja un índice barato de qué revalidar.
  const tablesBetween = (from, to) => {
    try {
      return db
        .prepare(
          `SELECT DISTINCT tbl FROM ${changeLogTable} WHERE seq > ? AND seq <= ? ORDER BY tbl`,
        )
        .all(from, to)
        .map((r) => r.tbl);
    } catch (err) {
      return [];
    }
  };

  const poll = () => {
    if (clients.size === 0) {
      // Nadie escuchando: no hay por qué consultar la BD en cada tick.
      lastSeen = maxSeq();
      return;
    }
    const now = maxSeq();
    if (now <= lastSeen) return;
    const boundary = firstSeq();
    for (const client of [...clients]) {
      if (client.cursor >= now) continue;
      // El tramo que esta caja pide ya no está entero: mejor bajarlo todo otra
      // vez que entregarle un delta con un hueco silencioso.
      if (client.cursor < boundary) {
        write(client, "resync", { reason: "LOG_COMPACTED", first_seq: boundary }, now);
        client.cursor = now;
        continue;
      }
      write(
        client,
        "changes",
        {
          seq: now,
          first_seq: boundary,
          tables: tablesBetween(client.cursor, now),
          count: now - client.cursor,
        },
        now,
      );
      client.cursor = now;
    }
    lastSeen = now;
  };

  const beat = () => {
    const seq = maxSeq();
    for (const client of clients) write(client, "heartbeat", { seq, busy: busyReason }, seq);
  };

  const start = () => {
    if (pollTimer || beatTimer) return;
    pollTimer = setInterval(poll, coalesceMs);
    beatTimer = setInterval(beat, heartbeatMs);
    // No retienen el proceso: los harness tienen que poder salir limpios.
    pollTimer.unref?.();
    beatTimer.unref?.();
  };

  const stop = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (beatTimer) clearInterval(beatTimer);
    pollTimer = null;
    beatTimer = null;
    for (const client of clients) {
      try {
        client.res.end();
      } catch (err) {
        /* la caja ya se había ido */
      }
    }
    clients.clear();
    lastSeen = 0;
    busyReason = null;
  };

  // Alta de una caja. `lastEventId` viene de la cabecera `Last-Event-ID`, que
  // `EventSource` reenvía solo al reconectar: no hace falta cookie ni
  // mecanismo propio de recuperación de sesión.
  const subscribe = ({ res, lastEventId, since, forceResync = null }) => {
    const now = maxSeq();
    const boundary = firstSeq();
    let cursor = Number(lastEventId);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = Number(since);
    // Sin punto de partida explícito se empieza por AHORA: una caja nueva no
    // tiene por qué recibir todo el histórico, ya bajará el snapshot.
    if (!Number.isFinite(cursor) || cursor < 0) cursor = now;

    const client = { res, cursor };
    clients.add(client);
    res.on("close", () => clients.delete(client));

    if (forceResync || cursor < boundary) {
      // Lo que traía de donde se quedó ya no está servible: se lo decimos ya,
      // sin esperar al primer tick.
      write(
        client,
        "resync",
        { reason: forceResync || "LOG_COMPACTED", first_seq: boundary },
        now,
      );
      client.cursor = now;
    } else {
      write(client, "hello", { seq: now, first_seq: boundary, busy: busyReason }, cursor);
    }
    return () => clients.delete(client);
  };

  // Host ocupado (import masivo). Las cajas dejan de perseguir deltas y
  // esperan el `ready`, que ya trae el seq desde el que reanudar.
  const hostBusy = (reason = "bulk") => {
    busyReason = reason;
    writeAll("busy", { reason }, maxSeq());
  };

  const hostReady = (reason = "bulk") => {
    const seq = maxSeq();
    busyReason = null;
    // Al terminar el lote no sabemos qué tramos pudieron quedar sin registrar,
    // así que el `ready` es además una orden de reanudar desde `seq`.
    writeAll("ready", { reason, seq, first_seq: firstSeq() }, seq);
  };

  const stats = () => ({
    clients: clients.size,
    last_seen: lastSeen,
    busy: busyReason,
    coalesce_ms: coalesceMs,
    heartbeat_ms: heartbeatMs,
  });

  return { start, stop, subscribe, hostBusy, hostReady, stats, poll };
};

module.exports = { createChangeStream, DEFAULT_COALESCE_MS, DEFAULT_HEARTBEAT_MS };
