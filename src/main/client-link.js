"use strict";

// 3c · lado caja: descubrir el Host, emparejar como `desktop_box` y vigilar el
// vínculo. No abre servidores ni registra IPC por su cuenta: main.js decide
// cuándo exponerlo. Todas las funciones reciben `db` (la BD local de la caja)
// para poder probarse sin Electron.
const crypto = require("crypto");
const dgram = require("dgram");
const activation = require("./activation");
const protocol = require("./protocol");
// A3 · al volverse cliente, la caja se queda SIN triggers de réplica: sólo
// consume la del Host, y su propio `change_log`/tumbas no tienen lector.
const dbSchema = require("./db-schema");

const DISCOVERY_PORT = 3457;
const DISCOVERY_MSG = "POS_DISCOVERY";
const RESPONSE_MSG = "POS_SERVER";
const DEFAULT_API_PORT = 3456;
const DEFAULT_TIMEOUT_MS = 2500;
const DEVICE_TYPE = "desktop_box";

// Settings locales de la caja. `sync_completed` arranca en "0": mientras no
// valga "1" la caja NO vende.
const SETTINGS = Object.freeze({
  DEVICE_ROLE: "device_role",
  HOST_URL: "host_url",
  // B6 · ANTES esta clave era `host_device_id`, la MISMA que el Host guarda
  // como identidad propia (db-schema HOST_DEVICE_ID_KEY). En una sola BD se
  // pisaban: `ensureHostDeviceId` leía aquí el id del Host VECINO y lo usaba
  // como device_id local de la caja. Ahora cada uno tiene la suya.
  HOST_DEVICE_ID: "linked_host_device_id",
  SYNC_COMPLETED: "sync_completed",
  BOX_DEVICE_ID: "box_device_id",
  BOX_PAIRED_TOKEN: "box_paired_token",
});

// Nombre con el que se escribía el Host remoto antes de separar las claves. Se
// sigue aceptando al escribir para que una caja ya emparejada no pierda su
// vínculo al actualizar.
const LEGACY_HOST_DEVICE_ID = "host_device_id";

const fail = (code, error, extra = {}) => ({ success: false, code, error, ...extra });
const trimUrl = (u) => String(u || "").replace(/\/+$/, "");

// ── Token de emparejamiento: NUNCA en claro ─────────────────────────────────
// Se cifra con safeStorage del proceso main. Si no hay safeStorage (fuera de
// Electron, antes de `app.ready` o en un build sin él) NO se persiste nada y
// el llamador lo sabe; nunca se escribe el token en claro. Un residuo en
// claro de versiones anteriores se borra al primer uso.
const TOKEN_ENC_PREFIX = "enc:v1:";
let secretCipher = null;

// Cifrador basado en safeStorage. Devuelve null si no está disponible.
const safeStorageCipher = () => {
  let ss = null;
  try {
    // En RUN_AS_NODE require("electron") devuelve la ruta al binario.
    const electron = require("electron");
    ss = electron && electron.safeStorage;
  } catch (err) {
    ss = null;
  }
  if (!ss || typeof ss.encryptString !== "function") return null;
  return {
    available: typeof ss.isEncryptionAvailable === "function" ? () => ss.isEncryptionAvailable() : () => true,
    encrypt: (plain) => ss.encryptString(String(plain)).toString("base64"),
    decrypt: (b64) => ss.decryptString(Buffer.from(String(b64), "base64")),
  };
};

const setSecretCipher = (next) => {
  secretCipher = next || null;
  return secretCipher !== null;
};

const cipherReady = () => Boolean(secretCipher && (typeof secretCipher.available !== "function" || secretCipher.available()));

const deleteSetting = (db, key) => {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
};

// Devuelve true si quedó persistida (cifrada), false si no se guardó nada.
const savePairedToken = (db, token) => {
  if (!token) return { persisted: false, reason: "token vacío" };
  if (!cipherReady()) {
    deleteSetting(db, SETTINGS.BOX_PAIRED_TOKEN); // sin cifrar no se guarda
    return { persisted: false, reason: "safeStorage no disponible" };
  }
  activation.setSetting(
    db,
    SETTINGS.BOX_PAIRED_TOKEN,
    TOKEN_ENC_PREFIX + secretCipher.encrypt(String(token)),
  );
  return { persisted: true };
};

// El token solo se devuelve si está cifrado y hay cipher para abrirlo.
const readPairedToken = (db) => {
  const raw = activation.getSetting(db, SETTINGS.BOX_PAIRED_TOKEN);
  if (!raw) return null;
  if (!raw.startsWith(TOKEN_ENC_PREFIX)) {
    deleteSetting(db, SETTINGS.BOX_PAIRED_TOKEN); // residuo en claro: se borra
    return null;
  }
  if (!cipherReady()) return null;
  try {
    return secretCipher.decrypt(raw.slice(TOKEN_ENC_PREFIX.length));
  } catch (err) {
    return null;
  }
};

const tokenPersisted = (db) =>
  String(activation.getSetting(db, SETTINGS.BOX_PAIRED_TOKEN) || "").startsWith(TOKEN_ENC_PREFIX);

const ensureBoxDeviceId = (db) => {
  let id = activation.getSetting(db, SETTINGS.BOX_DEVICE_ID);
  if (!id) {
    id = `box-${crypto.randomBytes(8).toString("hex")}`;
    activation.setSetting(db, SETTINGS.BOX_DEVICE_ID, id);
  }
  return id;
};

const getSettings = (db) => {
  const out = { deviceId: ensureBoxDeviceId(db) };
  for (const key of Object.values(SETTINGS)) {
    // El token cifrado NUNCA sale hacia el renderer: sólo se dice si existe.
    if (key === SETTINGS.BOX_PAIRED_TOKEN) continue;
    out[key] = activation.getSetting(db, key);
  }
  out.tokenPersisted = tokenPersisted(db);
  // B7 · la caja decide desde AQUÍ si puede vender, con la misma `canSell` que
  // usa main. Si se calculara en el renderer habría dos verdades distintas.
  out.canSell = canSell(db);
  return out;
};

const saveSettings = (db, patch = {}) => {
  for (const [rawKey, value] of Object.entries(patch)) {
    // B6 · `host_device_id` es la clave del Host y aquí significa el Host
    // REMOTO: se traduce a `linked_host_device_id` en lugar de tirarla.
    const key =
      rawKey === LEGACY_HOST_DEVICE_ID ? SETTINGS.HOST_DEVICE_ID : rawKey;
    if (!Object.values(SETTINGS).includes(key)) continue; // solo claves conocidas
    if (key === SETTINGS.BOX_PAIRED_TOKEN) continue; // sólo por savePairedToken
    if (value === undefined || value === null) continue;
    activation.setSetting(db, key, String(value));
  }
  // A3 · si este parche encendió el rol cliente, los triggers de réplica se
  // retiran en el acto; `ensureChangeLog` lo repetirá en cada arranque por si
  // la BD ya venía siendo de caja.
  if (patch && patch[SETTINGS.DEVICE_ROLE] !== undefined) dbSchema.ensureTriggersForRole(db);
  return getSettings(db);
};

const canSell = (db) => activation.getSetting(db, SETTINGS.SYNC_COMPLETED) === "1";

const markSyncCompleted = (db, value = true) =>
  activation.setSetting(db, SETTINGS.SYNC_COMPLETED, value ? "1" : "0");

// ─── Descubrimiento UDP (reutiliza el protocolo de src/main/discovery.js) ───
const udpDiscover = ({ timeoutMs, port = DISCOVERY_PORT }) =>
  new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const seen = new Map();
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch (err) {}
      resolve([...seen.values()]);
    };
    socket.on("message", (msg) => {
      const m = new RegExp(`^${RESPONSE_MSG}:([^:\\s]+):(\\d+)$`).exec(msg.toString().trim());
      if (m) seen.set(`${m[1]}:${m[2]}`, { ip: m[1], port: Number(m[2]) });
    });
    socket.on("error", done);
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch (err) {}
      for (const target of ["255.255.255.255", "127.0.0.1"]) {
        socket.send(DISCOVERY_MSG, port, target, () => {});
      }
      setTimeout(done, timeoutMs);
    });
  });

// Identidad del Host: /api/health + /api/activation/info. Devuelve null si el
// candidato no responde o no es un Host de verdad (deduplica después).
const inspectHost = async (url, timeoutMs) => {
  const get = async (path) => {
    const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  try {
    const health = await get("/api/health");
    if (!health || health.ok !== true) return null;
    const info = await get("/api/activation/info");
    if (!info || !info.host_device_id) return null;
    return {
      url,
      host_device_id: info.host_device_id,
      protocol_version: info.protocol_version || null,
      min_supported: info.min_supported || null,
      app_version: info.app_version || null,
      compatible: protocol.checkProtocol(info.protocol_version).ok,
    };
  } catch (err) {
    return null;
  }
};

// Devuelve los Hosts válidos y deduplicados. `manualIps` es la alternativa al
// UDP: la IP escrita a mano por el empleado.
const discoverHosts = async (opts = {}) => {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const candidates = new Map();
  const fromUdp = await udpDiscover({
    timeoutMs,
    port: opts.discoveryPort || DISCOVERY_PORT,
  });
  for (const h of fromUdp) candidates.set(`${h.ip}:${h.port}`, `http://${h.ip}:${h.port}`);
  for (const raw of [].concat(opts.manualIps || [])) {
    const ip = String(raw || "").trim();
    if (!ip) continue;
    const port = opts.manualPort || DEFAULT_API_PORT;
    candidates.set(`${ip}:${port}`, `http://${ip}:${port}`);
  }

  const hosts = [];
  for (const url of candidates.values()) {
    const info = await inspectHost(url, timeoutMs);
    if (info) hosts.push(info);
  }
  if (!hosts.length) {
    return fail("HOST_NOT_FOUND", "No se encontró ningún Host en la red", { hosts: [] });
  }
  return { success: true, hosts };
};

// Empareja esta caja contra el Host indicado. Siempre pide el código (aunque el
// candado del Host esté apagado) y se registra como desktop_box: queda
// PENDIENTE hasta que el admin lo apruebe.
const pairAsBox = async (db, { hostUrl, code, deviceName } = {}) => {
  const url = trimUrl(hostUrl);
  if (!url || !code) return fail("INVALID_PAIR_INPUT", "Faltan datos de emparejamiento");
  const deviceId = ensureBoxDeviceId(db);

  const info = await inspectHost(url, DEFAULT_TIMEOUT_MS);
  if (!info) return fail("HOST_NOT_FOUND", `No responde ningún Host en ${url}`);

  const proto = protocol.checkProtocol(info.protocol_version);
  if (!proto.ok) {
    return fail(proto.code, proto.error, {
      host_protocol: info.protocol_version,
      protocol_version: protocol.PROTOCOL_VERSION,
      min_supported: protocol.MIN_SUPPORTED,
    });
  }

  let res;
  try {
    res = await fetch(`${url}/api/activation/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        code,
        deviceName,
        deviceType: DEVICE_TYPE,
        protocol_version: protocol.PROTOCOL_VERSION,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    return fail("HOST_UNREACHABLE", `No se pudo contactar al Host: ${err.message}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {}

  if (!res.ok || !data || data.success !== true) {
    const errCode =
      (data && data.code) || (res.status === 429 ? "PAIR_RATE_LIMITED" : "PAIR_REJECTED");
    return fail(errCode, (data && data.error) || `Emparejamiento rechazado (HTTP ${res.status})`, {
      status: res.status,
      retry_after_ms: data && data.retry_after_ms,
      attempts_left: data && data.attempts_left,
    });
  }

  const hostDeviceId = data.host_device_id || info.host_device_id;
  activation.setSetting(db, SETTINGS.DEVICE_ROLE, "client");
  activation.setSetting(db, SETTINGS.HOST_URL, url);
  activation.setSetting(db, SETTINGS.HOST_DEVICE_ID, hostDeviceId);
  // A3 · el rol acaba de pasar a "client": los triggers creados con el rol
  // por defecto se retiran YA, sin esperar al próximo arranque.
  dbSchema.ensureTriggersForRole(db);
  const persisted = savePairedToken(db, data.pairedToken); // cifrado, nunca en claro
  activation.setSetting(db, SETTINGS.SYNC_COMPLETED, "0");

  return {
    success: true,
    pending: Boolean(data.pending),
    approved: Boolean(data.approved),
    device_code: data.device_code || null,
    deviceId,
    host_url: url,
    host_device_id: hostDeviceId,
    protocol_version: data.protocol_version || protocol.PROTOCOL_VERSION,
    sync_completed: "0",
    token_persisted: persisted.persisted,
    canSell: false,
  };
};

// Estado del vínculo. Valida el device_id del Host: si responde otro, hay dos
// Hosts en la red y la caja no se fía de ninguno de los dos.
const linkStatus = async (db, opts = {}) => {
  const url = trimUrl(opts.hostUrl || activation.getSetting(db, SETTINGS.HOST_URL));
  if (!url) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  const deviceId = activation.getSetting(db, SETTINGS.BOX_DEVICE_ID);
  const token = readPairedToken(db);
  if (!deviceId) return fail("NOT_PAIRED", "La caja no está emparejada");
  if (!token) {
    return fail(
      "TOKEN_UNAVAILABLE",
      "No hay token de emparejamiento: se requiere cifrado con safeStorage",
    );
  }

  let res;
  try {
    res = await fetch(`${url}/api/activation/status`, {
      headers: { "x-device-id": deviceId, "x-device-token": token },
      signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    return fail("HOST_UNREACHABLE", `No se pudo contactar al Host: ${err.message}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {}
  if (res.status === 403) return fail("NOT_PAIRED", (data && data.error) || "Emparejamiento inválido");
  if (!res.ok || !data) return fail("HOST_UNREACHABLE", `El Host respondió HTTP ${res.status}`);

  const saved = activation.getSetting(db, SETTINGS.HOST_DEVICE_ID);
  if (saved && data.host_device_id && saved !== data.host_device_id) {
    return fail("HOST_MISMATCH", "El Host respondió con otro device_id (hay dos Hosts)", {
      expected: saved,
      got: data.host_device_id,
    });
  }

  const revoked = data.revoked === true;
  const approved = data.approved === true && !revoked;
  return {
    success: true,
    approved,
    revoked,
    device_code: data.device_code || null,
    host_device_id: data.host_device_id || null,
    protocol_version: data.protocol_version || null,
    host_url: url,
    sync_completed: activation.getSetting(db, SETTINGS.SYNC_COMPLETED) || "0",
    canSell: canSell(db) && approved,
  };
};

// Sondeo de aprobación: hasta que el admin la apruebe (o la revoque).
const waitForApproval = async (db, opts = {}) => {
  const deadline = Date.now() + (opts.timeoutMs || 30000);
  const interval = opts.intervalMs || 1000;
  let last = null;
  while (Date.now() < deadline) {
    last = await linkStatus(db, opts);
    if (last.success && last.revoked) return fail("PAIR_REVOKED", "El Host revocó este dispositivo");
    if (last.success && last.approved) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return fail("PAIR_PENDING", "El Host aún no aprobó este dispositivo", {
    status: last || null,
  });
};

module.exports = {
  DISCOVERY_PORT,
  DISCOVERY_MSG,
  RESPONSE_MSG,
  DEFAULT_API_PORT,
  DEVICE_TYPE,
  SETTINGS,
  TOKEN_ENC_PREFIX,
  setSecretCipher,
  safeStorageCipher,
  savePairedToken,
  readPairedToken,
  tokenPersisted,
  ensureBoxDeviceId,
  getSettings,
  saveSettings,
  canSell,
  markSyncCompleted,
  inspectHost,
  discoverHosts,
  pairAsBox,
  linkStatus,
  waitForApproval,
};
