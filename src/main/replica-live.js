"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3f · Bucle de réplica EN TIEMPO REAL del lado de la CAJA.
//
// La caja no sondea el Host: se conecta una vez al túnel SSE de la 3e
// (`GET /api/events`) y sólo hace HTTP cuando el Host le avisa de que hay
// cambios. El cursor es el MISMO `replica_last_seq` de la descarga inicial, así
// que:
//   · un reinicio no pierde nada (reanuda con `?since=`),
//   · una desconexión tampoco (y si el tramo ya no está, el Host contesta
//     `resync` y se vuelve a bajar el snapshot entero),
//   · aplicar dos veces el mismo cambio es inocuo: son upserts y borrados por
//     clave primaria.
//
// No escribe en las tablas replicables por su cuenta: delega en
// `replicaEngine.applyChanges`, que sigue siendo la única puerta. Al aplicar
// devuelve tablas/ids y eso se entrega al proceso principal para que emita
// `db-changed` con el coalescer que ya existe — por eso ninguna pantalla se
// reescribe: `useDbChanges` ya estaba escuchando.
//
// El EventSource del navegador no existe en el proceso principal, así que el
// frame se parsea a mano. Es un formato de tres líneas y nos ahorra meter un
// WebSocket donde sólo hace falta recibir.
// ─────────────────────────────────────────────────────────────────────────────

const activation = require("./activation");
const clientLink = require("./client-link");
const replicaEngine = require("./replica-engine");

const KEYS = Object.freeze({
  STATE: "replica_live_state",
  ERROR: "replica_live_error",
  AT: "replica_live_at",
  RECONNECTS: "replica_live_reconnects",
});

const DEFAULT_PAGE = 2000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
// Un solo bucle por BD: si alguien llamara dos veces, la segunda es no-op en
// vez de dos conexiones compitiendo por el mismo cursor.
let active = null;

const sleep = (ctx, ms) =>
  new Promise((resolve) => {
    ctx.timer = setTimeout(resolve, ms);
    // No retiene el proceso: los harness tienen que poder salir limpios.
    ctx.timer.unref?.();
  });

const setLive = (ctx, state, error) => {
  activation.setSetting(ctx.db, KEYS.STATE, state);
  activation.setSetting(ctx.db, KEYS.ERROR, error ? String(error) : "");
  activation.setSetting(ctx.db, KEYS.AT, String(Date.now()));
};

// Lee en cada intento, no una sola vez: si el usuario relinkeó la caja, el
// próximo reconnect ya va a la URL nueva sin reiniciar el proceso.
const credentials = (db) => {
  const hostUrl = String(activation.getSetting(db, clientLink.SETTINGS.HOST_URL) || "").replace(/\/+$/, "");
  const deviceId = activation.getSetting(db, clientLink.SETTINGS.BOX_DEVICE_ID);
  const token = clientLink.readPairedToken(db);
  return { hostUrl, deviceId, token };
};

// Un frame SSE son líneas `campo: valor` separadas por una línea en blanco.
// `id` es el seq: no hace falta guardarlo, la caja reanuda con su propio
// cursor persistido, que es más fiable (sobrevive a un apagón).
const parseFrames = (text) => {
  const frames = [];
  let buffer = text;
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let event = "message";
    const dataLines = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    let data = null;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch (err) {
      continue;
    }
    frames.push({ event, data });
  }
  return { frames, buffer };
};

const pullDelta = async (ctx, opts = {}) => {
  if (ctx.pulling) return; // un solo vuelo a la vez: el bucle se re-entraría
  ctx.pulling = true;
  try {
    const creds = credentials(ctx.db);
    let since = replicaEngine.state(ctx.db).last_seq;
    for (;;) {
      const r = await replicaEngine.getJson(
        `${creds.hostUrl}/api/replica/changes?since=${since}&limit=${DEFAULT_PAGE}`,
        creds,
      );
      if (!r.ok) {
        // El tramo pedido ya no está: abajo se vuelve a bajar el snapshot.
        if (r.code === "LOG_COMPACTED" || r.resync) {
          await handleResync(ctx, r.code);
          return;
        }
        throw new Error(r.error || r.code);
      }
      const changes = r.data.changes || [];
      if (changes.length) {
        const applied = replicaEngine.applyChanges(ctx.db, changes);
        if (applied.applied && typeof ctx.onChanged === "function") {
          ctx.onChanged(applied.tables, applied.ids, applied);
        }
      }
      if (!r.data.has_more) break;
      const next = Number(r.data.next_seq);
      if (!Number.isFinite(next) || next <= since) break; // nada que avanzar
      since = next;
    }
    // B8 · durante la espera de reconexión se sondea SIN pisar el estado: el
    // flujo sigue caído aunque el HTTP conteste, y enseñar "conectado" mientras
    // pasa eso engaña a quien esté mirando `replica-status`.
    if (!opts.quiet) setLive(ctx, "connected", null);
  } finally {
    ctx.pulling = false;
  }
};

// Un delta con un hueco silencioso es peor que no vender: se deja la caja en
// «sin vender» y se vuelve a bajar el snapshot entero.
const handleResync = async (ctx, reason) => {
  if (ctx.resyncing) return;
  ctx.resyncing = true;
  try {
    replicaEngine.resetSync(ctx.db);
    if (typeof ctx.onResync === "function") ctx.onResync(reason);
    const r = await replicaEngine.downloadSnapshot(ctx.db);
    if (r && r.success && typeof ctx.onChanged === "function") {
      ctx.onChanged(r.tables || [], {}, { resync: true, reason });
    }
    if (!r || !r.success) throw new Error((r && r.error) || "resync fallido");
  } finally {
    ctx.resyncing = false;
  }
};

const handleFrame = async (ctx, frame) => {
  const d = frame.data || {};
  const seq = Number(d.seq) || 0;
  switch (frame.event) {
    case "hello":
    case "changes":
    case "ready":
      // `ready` manda aunque el seq no avance: cierra un import masivo y puede
      // traer un hueco que sólo se ve al reanudar.
      if (frame.event === "ready" || seq > replicaEngine.state(ctx.db).last_seq) {
        await pullDelta(ctx);
      }
      break;
    case "busy":
      // Import masivo: los triggers están apagados, así que no hay delta que
      // perseguir. Se espera al `ready`, que ya trae por dónde reanudar.
      setLive(ctx, "busy", null);
      break;
    case "resync":
      await handleResync(ctx, d.reason || "LOG_COMPACTED");
      break;
    case "heartbeat":
      // Red de seguridad: si un pull se cayó en seco (sin que se cerrara el
      // flujo) no llegará ningún `changes` nuevo, pero el seq del latido sigue
      // avanzando. El latido tardío es lo que repara el hueco.
      if (!d.busy && seq > replicaEngine.state(ctx.db).last_seq) await pullDelta(ctx);
      break;
    default:
      break;
  }
};

// B8 · red de seguridad bajo el SSE. El flujo es lo primero, pero mientras
// espera a que vuelva el bucle no se queda ciego: dentro de la espera se pide
// el delta a `/api/replica/changes` cada 4 s (ventana objetivo 3-5 s).
//
// · El cursor manda: aplicar dos veces el mismo cambio es inocuo (upserts y
//   borrados por clave primaria), así que esto sólo puede añadir, no romper.
// · Un tramo ya podado sigue contestando `resync`, igual que por el flujo, así
//   que la compactación de A2 también queda cubierta en este camino.
// · El estado no se toca (`quiet`): sigue habiendo una caída que arreglar, y
//   `replica-status` tiene que poder verla.
const POLL_MS = 4000;

// 3g/F · huella de "el Host contesta": el badge de la caja y la venta viven
// del HTTP, no del SSE (que puede estar en reconstrucción con el flujo caído).
let lastHostOkAt = 0;
const markHostOk = () => {
  lastHostOkAt = Date.now();
};

const sleepWhilePolling = async (ctx, waitMs) => {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0 || !ctx.running) return;
    await sleep(ctx, Math.min(POLL_MS, left));
    if (!ctx.running) return;
    try {
      const creds = credentials(ctx.db);
      if (!creds.hostUrl || !creds.deviceId || !creds.token) return;
      await pullDelta(ctx, { quiet: true });
      markHostOk();
    } catch (err) {
      // El Host sigue sin estar: se reintenta en la vuelta siguiente del bucle.
    }
  }
};

const connectOnce = async (ctx) => {
  const creds = credentials(ctx.db);
  if (!creds.hostUrl || !creds.deviceId || !creds.token) {
    throw new Error("La caja no tiene Host enlazado o no tiene token de emparejamiento");
  }
  // `since` es el punto exacto en el que se quedó; el Host lo usa de cursor
  // inicial y si ya no está servible responde `resync` en vez de `hello`.
  const url = `${creds.hostUrl}/api/events?since=${replicaEngine.state(ctx.db).last_seq}`;
  const res = await fetch(url, {
    headers: {
      "x-device-id": creds.deviceId,
      "x-device-token": creds.token,
      accept: "text/event-stream",
    },
    signal: ctx.abort.signal,
  });
  if (res.status === 403) throw new Error("El Host rechazó el emparejamiento de esta caja");
  if (!res.ok || !res.body) throw new Error(`El Host respondió HTTP ${res.status}`);

  setLive(ctx, "connected", null);
  markHostOk();
  // Conectado: por si el cursor se quedó atrás de lo que ya se aplicó.
  await pullDelta(ctx);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const parsed = parseFrames(buffer);
    buffer = parsed.buffer;
    for (const frame of parsed.frames) await handleFrame(ctx, frame);
  }
  if (ctx.running) throw new Error("El Host cerró el flujo de eventos");
};

// Arranca el bucle. Devuelve `stop()`. Si ya había uno vivo para esta BD, la
// segunda llamada no hace nada.
const startLiveSync = (opts = {}) => {
  const { db, onChanged, onResync } = opts;
  if (!db) throw new Error("startLiveSync: falta `db`");
  if (active && active.db === db) return active.stop;
  if (active) active.stop();

  const ctx = {
    db,
    onChanged,
    onResync,
    running: true,
    pulling: false,
    resyncing: false,
    retry: 0,
    abort: new AbortController(),
    timer: null,
  };

  const stop = () => {
    ctx.running = false;
    ctx.abort.abort();
    if (ctx.timer) clearTimeout(ctx.timer);
    ctx.timer = null;
    setLive(ctx, "stopped", null);
    if (active === ctx) active = null;
  };
  ctx.stop = stop;
  active = ctx;

  ctx.loop = (async () => {
    while (ctx.running) {
      try {
        await connectOnce(ctx);
      } catch (err) {
        if (!ctx.running) return;
        setLive(ctx, "reconnecting", (err && err.message) || String(err));
        const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(ctx.retry, 5));
        ctx.retry += 1;
        activation.setSetting(ctx.db, KEYS.RECONNECTS, String(ctx.retry));
        await sleepWhilePolling(ctx, wait);
        continue;
      }
      if (!ctx.running) return;
      // El flujo se cerró sin error: se trata igual que una caída.
      const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(ctx.retry, 5));
      ctx.retry += 1;
      activation.setSetting(ctx.db, KEYS.RECONNECTS, String(ctx.retry));
      await sleepWhilePolling(ctx, wait);
    }
  })().catch((err) => {
    // Por si algo escapa del try: el bucle ya no puede notificar por su cuenta,
    // pero queda el motivo en settings para que `replica-status` lo enseñe.
    setLive(ctx, "reconnecting", (err && err.message) || String(err));
  });

  return stop;
};

const liveState = (db) => ({
  state: activation.getSetting(db, KEYS.STATE) || "stopped",
  error: activation.getSetting(db, KEYS.ERROR) || null,
  at: Number(activation.getSetting(db, KEYS.AT) || 0) || null,
  reconnects: Number(activation.getSetting(db, KEYS.RECONNECTS) || 0),
  running: !!(active && active.db === db),
});

// 3g/F · ¿el Host está vivo? Un SSE conectado lo prueba; con el flujo en
// reconstrucción manda la huella del último HTTP bueno (< 15 s = vivo).
const hostOkInfo = (db) => ({
  reachable:
    liveState(db).state === "connected" ||
    (lastHostOkAt > 0 && Date.now() - lastHostOkAt < 15000),
  okAt: lastHostOkAt || null,
});

module.exports = {
  KEYS,
  startLiveSync,
  liveState,
  hostOkInfo,
  parseFrames,
};
