"use strict";

// 3c · lado caja: descubrir el Host, emparejar como `desktop_box` y vigilar el
// vínculo. No abre servidores ni registra IPC por su cuenta: main.js decide
// cuándo exponerlo. Todas las funciones reciben `db` (la BD local de la caja)
// para poder probarse sin Electron.
const crypto = require("crypto");
const dgram = require("dgram");
const activation = require("./activation");
const protocol = require("./protocol");

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
  HOST_DEVICE_ID: "host_device_id",
  SYNC_COMPLETED: "sync_completed",
  BOX_DEVICE_ID: "box_device_id",
  BOX_PAIRED_TOKEN: "box_paired_token",
});

const fail = (code, error, extra = {}) => ({ success: false, code, error, ...extra });
const trimUrl = (u) => String(u || "").replace(/\/+$/, "");

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
    out[key] = activation.getSetting(db, key);
  }
  return out;
};

const saveSettings = (db, patch = {}) => {
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.values(SETTINGS).includes(key)) continue; // solo claves conocidas
    if (value === undefined || value === null) continue;
    activation.setSetting(db, key, String(value));
  }
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
  activation.setSetting(db, SETTINGS.BOX_PAIRED_TOKEN, data.pairedToken);
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
    canSell: false,
  };
};

// Estado del vínculo. Valida el device_id del Host: si responde otro, hay dos
// Hosts en la red y la caja no se fía de ninguno de los dos.
const linkStatus = async (db, opts = {}) => {
  const url = trimUrl(opts.hostUrl || activation.getSetting(db, SETTINGS.HOST_URL));
  if (!url) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  const deviceId = activation.getSetting(db, SETTINGS.BOX_DEVICE_ID);
  const token = activation.getSetting(db, SETTINGS.BOX_PAIRED_TOKEN);
  if (!deviceId || !token) return fail("NOT_PAIRED", "La caja no está emparejada");

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
