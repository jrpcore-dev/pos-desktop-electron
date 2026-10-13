"use strict";

// 3g/D · traductor IPC→HTTP de la caja: los canales con scope `rpc` no se
// ejecutan aquí, viajan al Host. Tres puertas: /api/rpc (lista blanca),
// /api/sales (con Idempotency-Key) y /api/auth (PIN → token de sesión).
const crypto = require("crypto");
const activation = require("./activation");
const clientLink = require("./client-link");
const dbSchema = require("./db-schema");
// 3g/D · registro de listeners CRUDOS: el puente lo usa para ejecutar en la
// caja las claves de `save-setting` que son del propio aparato.
const ipcRegistry = require("./ipc-registry");

const TIMEOUT_MS = 8000;

// Claves de `save-setting` que el negocio comparte entre cajas (van al Host).
const BUSINESS_SETTING_KEYS = new Set(dbSchema.REPLICATED_SETTINGS_KEYS);

const fail = (code, error) => ({ success: false, code, error });

// Lo que la caja sabe del Host: su URL, su propio id y sus dos tokens.
const credentials = (db) => ({
  hostUrl: String(
    activation.getSetting(db, clientLink.SETTINGS.HOST_URL) || "",
  ).replace(/\/+$/, ""),
  deviceId: activation.getSetting(db, clientLink.SETTINGS.BOX_DEVICE_ID) || "",
  pairedToken: clientLink.readPairedToken(db) || "",
  sessionToken: clientLink.readSessionToken(db) || "",
});

const postJson = async (creds, path, body, extraHeaders = {}) => {
  const headers = {
    "content-type": "application/json",
    ...(creds.deviceId ? { "x-device-id": creds.deviceId } : {}),
    ...(creds.pairedToken ? { "x-device-token": creds.pairedToken } : {}),
    ...(creds.sessionToken ? { authorization: creds.sessionToken } : {}),
    ...extraHeaders,
  };
  const res = await fetch(`${creds.hostUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {}
  return { status: res.status, data };
};

// 401 del Host = la sesión de PIN ya no sirve: se borra y el renderer la pide.
const expired = (db, data) => {
  clientLink.clearSessionToken(db);
  return fail("SESSION_EXPIRED", (data && data.error) || "La sesión expiró en el Host");
};

const unreachable = (err) =>
  fail(
    "HOST_UNREACHABLE",
    `No se pudo contactar con el Host (${err && err.message})`,
  );

// POST /api/rpc · los canales de la lista blanca del Host (rpc-channels.js).
const rpcCall = async (db, channel, args = []) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  let res;
  try {
    res = await postJson(creds, "/api/rpc", { channel, args });
  } catch (err) {
    return unreachable(err);
  }
  if (!res.data) return fail("HOST_UNREACHABLE", "El Host no contestó");
  if (res.status === 401) return expired(db, res.data);
  // Éxito: el Host envuelve el valor del handler en {success, result}.
  if (res.status === 200 && res.data.success) {
    return res.data.result === undefined ? null : res.data.result;
  }
  return res.data; // fallo del Host ({success:false, code, error}) tal cual.
};

// POST /api/sales · la venta viaja con Idempotency-Key; el cajero que la firma
// lo decide el token de sesión, no el payload (3a.i).
const recordSale = async (db, payload = {}) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  const body = {
    cart: payload.cart,
    total: payload.total,
    paymentMethod: payload.paymentMethod,
    discountTotal: payload.discountTotal,
  };
  if (payload.customerId !== null && payload.customerId !== undefined) {
    body.customer_id = payload.customerId;
  }
  let res;
  try {
    res = await postJson(creds, "/api/sales", body, {
      "idempotency-key": crypto.randomUUID(),
    });
  } catch (err) {
    return unreachable(err);
  }
  if (!res.data) return fail("HOST_UNREACHABLE", "El Host no contestó");
  if (res.status === 401) return expired(db, res.data);
  return res.data; // éxito o fallo del Host: mismo contrato que el IPC local.
};

// POST /api/auth · el PIN se comprueba en el Host y el token resultante
// queda cifrado en safeStorage (nunca en claro).
const verifyPin = async (db, id, pin) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  let res;
  try {
    res = await postJson(creds, "/api/auth", { id, pin });
  } catch (err) {
    return unreachable(err);
  }
  if (!res.data) return fail("HOST_UNREACHABLE", "El Host no contestó");
  if (res.status !== 200 || res.data.success !== true) {
    // 401 aquí es "PIN inválido", NO sesión caducada: no se borra nada.
    const code =
      res.data.code || (res.status === 401 ? "PIN_INVALID" : "HOST_REJECTED");
    return fail(code, res.data.error || "PIN inválido");
  }
  if (res.data.token) clientLink.saveSessionToken(db, res.data.token);
  return { success: true, cashier: res.data.cashier };
};

// Punto de entrada del guard: el canal entra igual que por IPC y sale traducido.
const forward = (db, channel, args = []) => {
  if (channel === "verify-cashier-pin") return verifyPin(db, args[0], args[1]);
  if (channel === "record-sale") return recordSale(db, args[0]);
  // save-setting: negocio (nombre del local, moneda, ticket…) → Host; lo del
  // propio aparato (báscula, impresora) se escribe AQUÍ, en la BD de la caja.
  if (channel === "save-setting" && !BUSINESS_SETTING_KEYS.has(String(args[0]))) {
    const listener = ipcRegistry.get("save-setting");
    if (!listener) return fail("RPC_CHANNEL_UNKNOWN", "El Host no expone save-setting");
    return listener(null, ...args);
  }
  return rpcCall(db, channel, args);
};

module.exports = { forward, rpcCall, recordSale, verifyPin };
