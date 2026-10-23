"use strict";

// 3g/D · traductor IPC→HTTP de la caja: los canales con scope `rpc` no se
// ejecutan aquí, viajan al Host. Tres puertas: /api/rpc (lista blanca),
// /api/sales (con Idempotency-Key) y /api/auth (PIN → token de sesión).
//
// Bloque 4 · cuando el Host no responde, la venta se guarda en `pending_sales`
// y se sube sola al reconectar. Abrir/cerrar caja y gastos siguen exigiendo
// Host; cerrar caja exige además la cola vacía.
const crypto = require("crypto");
const activation = require("./activation");
const clientLink = require("./client-link");
const dbSchema = require("./db-schema");
const offlineQueue = require("./offline-queue");
const pins = require("./pins");
const protocol = require("./protocol");
const salesCore = require("./sales-core");
// 3g/D · registro de listeners CRUDOS: el puente lo usa para ejecutar en la
// caja las claves de `save-setting` que son del propio aparato.
const ipcRegistry = require("./ipc-registry");

const TIMEOUT_MS = 8000;
const OFFLINE_PIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Taecel puede tardar más que una lectura normal: el catálogo baja 700+
// productos y RequestTXN espera al operador. La caja debe esperar lo mismo que
// el Host, o cortaría una recarga que el Host sí alcanzó a enviar.
const RPC_TIMEOUTS = {
  "taecel:get-balance": 20000,
  "taecel:transaction-status": 20000,
  "taecel:get-catalog": 40000,
  "taecel:refresh-catalog": 40000,
  "taecel:recharge": 40000,
  "taecel:reconcile": 40000,
  // El import manda el archivo completo y el Host lo procesa por lotes.
  "import-products-content": 120000,
};

// Claves de `save-setting` que el negocio comparte entre cajas (van al Host).
const BUSINESS_SETTING_KEYS = new Set(dbSchema.REPLICATED_SETTINGS_KEYS);

const fail = (code, error, extra = {}) => ({ success: false, code, error, ...extra });

// Lo que la caja sabe del Host: su URL, su propio id y sus dos tokens.
const credentials = (db) => ({
  hostUrl: String(
    activation.getSetting(db, clientLink.SETTINGS.HOST_URL) || "",
  ).replace(/\/+$/, ""),
  deviceId: activation.getSetting(db, clientLink.SETTINGS.BOX_DEVICE_ID) || "",
  pairedToken: clientLink.readPairedToken(db) || "",
  sessionToken: clientLink.readSessionToken(db) || "",
});

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

// ── Folio local (Bloque 5) ──────────────────────────────────────────────────
// La caja reserva su folio ANTES de enviar. Si el Host no responde, la misma
// reserva viaja en la cola; el contador local nunca retrocede.
// Fase 2 · el prefijo es el mismo que el Host valida (`folioPrefixFor`).
const FOLIO_SEQ_KEY = "folio_next_seq";
const nextBoxFolio = (db) => {
  const code = activation.getSetting(db, "box_device_code") || "";
  const deviceId = activation.getSetting(db, "box_device_id") || "";
  const prefix = salesCore.folioPrefixFor(code, deviceId);
  const seq = Math.max(1, Number(activation.getSetting(db, FOLIO_SEQ_KEY) || 1) || 1);
  activation.setSetting(db, FOLIO_SEQ_KEY, String(seq + 1));
  return salesCore.formatFolio(prefix, seq);
};

// Fase 2 · el Host informa hasta dónde va la serie de esta caja. Tras una
// reinstalación o un respaldo restaurado el contador local quedaría atrás y
// cada venta chocaría con un folio ya usado; nunca retrocede.
const adoptHostFolioSeq = (db, data) => {
  const hostNext = Number(data && data.folio_next_seq);
  if (!Number.isFinite(hostNext) || hostNext < 1) return;
  const local = Math.max(1, Number(activation.getSetting(db, FOLIO_SEQ_KEY) || 1) || 1);
  if (hostNext > local) activation.setSetting(db, FOLIO_SEQ_KEY, String(hostNext));
};

// ── Intento de venta estable (Bloque 4/A) ───────────────────────────────────
// La misma canasta reutiliza la MISMA clave y el MISMO folio aunque el usuario
// reintente tras un timeout. Cambia la canasta → clave nueva. Tras éxito (o
// tras encolar) se limpia.
const ATTEMPT_KEY = "box_sale_attempt";
const readAttempt = (db) => {
  try {
    const raw = activation.getSetting(db, ATTEMPT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
};
const saveAttempt = (db, value) =>
  activation.setSetting(db, ATTEMPT_KEY, JSON.stringify(value));
const clearAttempt = (db) => {
  try {
    db.prepare("DELETE FROM settings WHERE key = ?").run(ATTEMPT_KEY);
  } catch (err) {}
};

const postJson = async (
  db,
  creds,
  path,
  body,
  extraHeaders = {},
  timeoutMs = TIMEOUT_MS,
) => {
  const pendingCount = safe(() => offlineQueue.summary(db).count, 0);
  const headers = {
    "content-type": "application/json",
    "x-protocol-version": protocol.PROTOCOL_VERSION,
    "x-pending-sales": String(pendingCount),
    ...(creds.deviceId ? { "x-device-id": creds.deviceId } : {}),
    ...(creds.pairedToken ? { "x-device-token": creds.pairedToken } : {}),
    ...(creds.sessionToken ? { authorization: creds.sessionToken } : {}),
    ...extraHeaders,
  };
  const res = await fetch(`${creds.hostUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {}
  try {
    const warning = res.headers.get("x-protocol-warning");
    activation.setSetting(db, "protocol_warning", warning || "");
  } catch (err) {}
  return { status: res.status, data, headers: res.headers };
};

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch (err) {
    return fallback;
  }
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

// ── Cola offline ────────────────────────────────────────────────────────────
// Fase 4 · sin Host, la caja descuenta en SU réplica lo que vendió para que la
// búsqueda y el aviso de stock no sigan mostrando unidades que ya salieron.
// Es sólo una vista: al reconectar, el Host sube la venta y la réplica trae
// el stock real, que pisa este valor.
const deductLocalStock = (db, cart) => {
  if (!Array.isArray(cart)) return;
  const stmt = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
  for (const item of cart) {
    if (!item || item.isManual || typeof item.id !== "number") continue;
    const qty = Number(item.quantity) || 0;
    const factor = item.isBoxItem
      ? Number(item.box_qty) || 1
      : item.isPackItem
        ? Number(item.pack_qty) || 1
        : 1;
    if (qty > 0) stmt.run(qty * factor, item.id);
  }
};
const enqueueSale = (db, row) => {
  // La venta queda a salvo en disco y el intento se limpia en la MISMA
  // transacción: un cierre entre ambos pasos dejaba el intento vivo y la
  // siguiente canasta reutilizaba un folio ya encolado.
  const saved = db.transaction(() => {
    const out = offlineQueue.enqueue(db, row);
    clearAttempt(db);
    deductLocalStock(db, row.payload && row.payload.cart);
    return out;
  })();
  return {
    success: true,
    offline: true,
    pending: true,
    saleId: null,
    folio: saved.folio,
    warnings: [],
  };
};

const saleBody = (payload, folio, offline) => {
  const body = {
    cart: payload.cart,
    total: payload.total,
    paymentMethod: payload.paymentMethod,
    discountTotal: payload.discountTotal,
    folio,
  };
  if (payload.customerId !== null && payload.customerId !== undefined) {
    body.customer_id = payload.customerId;
  }
  if (payload.registerId != null) body.register_id = payload.registerId;
  if (payload.cashierId != null) body.cashier_id = payload.cashierId;
  if (payload.cashierName) body.cashier_name = payload.cashierName;
  if (offline) {
    body.offline = true;
    body.client_created_at = payload.clientCreatedAt || new Date().toISOString();
  }
  return body;
};

// POST /api/sales · la venta viaja con Idempotency-Key; el cajero que la firma
// lo decide el token de sesión, no el payload (3a.i).
const recordSale = async (db, payload = {}) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");

  const signature = sha256(
    canonical({
      cart: payload.cart,
      total: payload.total,
      paymentMethod: payload.paymentMethod,
      discountTotal: payload.discountTotal,
      customerId: payload.customerId ?? null,
      registerId: payload.registerId ?? null,
    }),
  );
  let attempt = readAttempt(db);
  if (!attempt || attempt.signature !== signature) {
    attempt = {
      signature,
      key: crypto.randomUUID(),
      folio: nextBoxFolio(db),
    };
    saveAttempt(db, attempt);
  }

  let body = saleBody(payload, attempt.folio, false);
  let res;
  try {
    res = await postJson(db, creds, "/api/sales", body, {
      "idempotency-key": attempt.key,
    });
  } catch (err) {
    return enqueueSale(db, {
      folio: attempt.folio,
      payload,
      idempotencyKey: attempt.key,
      registerId: payload.registerId,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      localCreatedAt: new Date().toISOString(),
    });
  }
  if (!res.data) {
    return enqueueSale(db, {
      folio: attempt.folio,
      payload,
      idempotencyKey: attempt.key,
      registerId: payload.registerId,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      localCreatedAt: new Date().toISOString(),
    });
  }
  if (res.status === 401) {
    // No se pierde: queda en cola y el renderer pedirá el PIN.
    expired(db, res.data);
    return enqueueSale(db, {
      folio: attempt.folio,
      payload,
      idempotencyKey: attempt.key,
      registerId: payload.registerId,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      localCreatedAt: new Date().toISOString(),
    });
  }
  adoptHostFolioSeq(db, res.data);
  // Folio repetido (reinstalación o respaldo restaurado): se reasigna una vez
  // con una clave nueva, ya con el contador alineado al del Host, y se
  // reintenta. La venta no se pierde.
  if (res.data.code === "FOLIO_INVALID" || res.data.code === "SQLITE_CONSTRAINT_UNIQUE") {
    attempt = { signature, key: crypto.randomUUID(), folio: nextBoxFolio(db) };
    saveAttempt(db, attempt);
    body = saleBody(payload, attempt.folio, false);
    try {
      res = await postJson(db, creds, "/api/sales", body, {
        "idempotency-key": attempt.key,
      });
    } catch (err) {
      return enqueueSale(db, {
        folio: attempt.folio,
        payload,
        idempotencyKey: attempt.key,
        registerId: payload.registerId,
        cashierId: payload.cashierId,
        cashierName: payload.cashierName,
        localCreatedAt: new Date().toISOString(),
      });
    }
    // Respuesta sin JSON o sesión vencida en el reintento: igual que en el
    // primer envío, la venta se encola en vez de perderse.
    if (!res.data || res.status === 401) {
      if (res.status === 401) expired(db, res.data);
      return enqueueSale(db, {
        folio: attempt.folio,
        payload,
        idempotencyKey: attempt.key,
        registerId: payload.registerId,
        cashierId: payload.cashierId,
        cashierName: payload.cashierName,
        localCreatedAt: new Date().toISOString(),
      });
    }
    adoptHostFolioSeq(db, res.data);
  }
  if (res.data.success) clearAttempt(db);
  return res.data; // éxito o fallo del Host: mismo contrato que el IPC local.
};

// Sube la cola en orden. El Host deduplica por la clave guardada en la fila.
let syncInFlight = null;
const syncPending = async (db) => {
  if (syncInFlight) return syncInFlight;
  const creds = credentials(db);
  if (!creds.hostUrl) return { success: false, code: "NO_HOST_LINKED", pending: offlineQueue.countBlocking(db) };
  syncInFlight = offlineQueue.sync(db, async (row) => {
    // Fase 2 · mismo armado que el envío en línea (`customerId` →
    // `customer_id`, etc.): antes se esparcía el payload crudo y el Host
    // perdía el cliente de toda venta subida desde la cola.
    const body = {
      ...saleBody(row.payload, row.folio, true),
      register_id: row.registerId,
      cashier_id: row.cashierId,
      cashier_name: row.cashierName,
      client_created_at: row.localCreatedAt,
    };
    const res = await postJson(db, creds, "/api/sales", body, {
      "idempotency-key": row.idempotencyKey,
    });
    if (!res.data) return { success: false, code: "HOST_UNREACHABLE" };
    if (res.status === 401) return { success: false, code: "SESSION_EXPIRED", error: "Sesión expirada" };
    adoptHostFolioSeq(db, res.data);
    return res.data;
  });
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
};

// ── PIN cacheado (Bloque 4) ─────────────────────────────────────────────────
// Fase 1 · sin red no hay rate limit del Host: la caja lleva el suyo, en
// disco para que reiniciar la app no lo borre.
const OFFLINE_PIN_MAX_ATTEMPTS = 5;
const OFFLINE_PIN_LOCK_MS = 5 * 60 * 1000;
const OFFLINE_PIN_ATTEMPTS_KEY = "offline_pin_attempts";
const readPinAttempts = (db) => {
  try {
    const raw = activation.getSetting(db, OFFLINE_PIN_ATTEMPTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
};
const writePinAttempts = (db, value) => {
  try {
    activation.setSetting(db, OFFLINE_PIN_ATTEMPTS_KEY, JSON.stringify(value));
  } catch (err) {}
};

const offlineVerifyPin = (db, id, pin) => {
  const attempts = readPinAttempts(db);
  const key = String(Number(id));
  const now = Date.now();
  const entry = attempts[key];
  if (entry && entry.lockedUntil && entry.lockedUntil > now) {
    const mins = Math.ceil((entry.lockedUntil - now) / 60000);
    return fail(
      "PIN_LOCKED",
      `Demasiados intentos sin conexión. Intenta de nuevo en ${mins} min.`,
    );
  }
  const cashier = db
    .prepare("SELECT id, name, role, pin_hash, pin_salt FROM cashiers WHERE id = ? AND is_active = 1")
    .get(Number(id));
  if (!cashier || !cashier.pin_hash || !cashier.pin_salt) {
    return fail("OFFLINE_PIN_UNAVAILABLE", "No hay PIN cacheado para este usuario");
  }
  if (!pins.verifyPin(pin, cashier.pin_salt, cashier.pin_hash)) {
    const count = (entry && !entry.lockedUntil ? Number(entry.count) || 0 : 0) + 1;
    attempts[key] =
      count >= OFFLINE_PIN_MAX_ATTEMPTS
        ? { count: 0, lockedUntil: now + OFFLINE_PIN_LOCK_MS }
        : { count };
    writePinAttempts(db, attempts);
    return fail("PIN_INVALID", "PIN inválido");
  }
  if (entry) {
    delete attempts[key];
    writePinAttempts(db, attempts);
  }
  // Fase 4 · cuenta desde el último delta confirmado con el Host.
  const syncedAt = Number(
    activation.getSetting(db, "replica_fresh_at") ||
      activation.getSetting(db, "replica_synced_at") ||
      0,
  );
  const age = syncedAt ? Date.now() - syncedAt : Infinity;
  return {
    success: true,
    offline: true,
    cashier: { id: cashier.id, name: cashier.name, role: cashier.role },
    warning:
      age > OFFLINE_PIN_MAX_AGE_MS
        ? "PIN verificado sin conexión con datos de más de 24 h. Conecta la caja pronto."
        : null,
    stale_ms: Number.isFinite(age) ? age : null,
  };
};

// POST /api/auth · el PIN se comprueba en el Host y el token resultante
// queda cifrado en safeStorage (nunca en claro).
const verifyPin = async (db, id, pin) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return offlineVerifyPin(db, id, pin);
  let res;
  try {
    res = await postJson(db, creds, "/api/auth", { id, pin });
  } catch (err) {
    return offlineVerifyPin(db, id, pin);
  }
  if (!res.data) return offlineVerifyPin(db, id, pin);
  if (res.status !== 200 || res.data.success !== true) {
    // 401 aquí es "PIN inválido", NO sesión caducada: no se borra nada.
    const code =
      res.data.code || (res.status === 401 ? "PIN_INVALID" : "HOST_REJECTED");
    return fail(code, res.data.error || "PIN inválido");
  }
  if (res.data.token) clientLink.saveSessionToken(db, res.data.token);
  // La ventana de gracia rota el token de dispositivo en cada login: si la caja
  // no guarda el nuevo, el Host la rechaza con "no está activado" en todo.
  if (res.data.pairedToken) clientLink.savePairedToken(db, res.data.pairedToken);
  // Fase 2 · con sesión nueva, las ventas que quedaron esperando login
  // vuelven a la cola y se suben ya (sin esperar al temporizador).
  if (offlineQueue.resumeNeedsAuth(db).resumed > 0) {
    syncPending(db).catch(() => {});
  }
  return { success: true, cashier: res.data.cashier };
};

// ── Estado de caja cacheado (para vender sin Host) ──────────────────────────
const REGISTER_CACHE_KEY = "last_register_snapshot";
const cacheRegister = (db, result) => {
  if (result && result.success && result.register) {
    activation.setSetting(db, REGISTER_CACHE_KEY, JSON.stringify(result.register));
  }
};
const cachedRegister = (db) => {
  try {
    const raw = activation.getSetting(db, REGISTER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
};

const HOST_REQUIRED = (what) =>
  fail("HOST_REQUIRED", `${what} requiere conexión con el Host.`);

// Punto de entrada del guard: el canal entra igual que por IPC y sale traducido.
const forward = (db, channel, args = []) => {
  if (channel === "verify-cashier-pin") return verifyPin(db, args[0], args[1]);
  if (channel === "record-sale") return recordSale(db, args[0]);
  // Cerrar caja exige que la cola esté vacía (decisión de negocio).
  if (channel === "close-cash-register") {
    const pending = offlineQueue.countBlocking(db);
    if (pending > 0) {
      return Promise.resolve(
        fail(
          "PENDING_SALES",
          `Hay ${pending} venta(s) pendiente(s) de sincronizar. Conecta el Host y espera a que suban antes de cerrar caja.`,
        ),
      );
    }
  }
  if (channel === "open-cash-register" || channel === "register-cash-expense" || channel === "delete-cash-expense") {
    // Si el Host está caído, el error de red no es claro para el cajero.
    return rpcCall(db, channel, args).then((r) => {
      if (r && r.code === "HOST_UNREACHABLE") return HOST_REQUIRED("Esta operación");
      return r;
    });
  }
  if (channel === "get-cash-register-status") {
    return rpcCall(db, channel, args).then((r) => {
      if (r && r.success) {
        cacheRegister(db, r);
        return r;
      }
      if (r && r.code === "HOST_UNREACHABLE") {
        const cached = cachedRegister(db);
        if (cached) {
          return {
            success: true,
            offline: true,
            register: cached,
            warning: "Mostrando la última caja conocida; el Host no responde.",
          };
        }
      }
      return r;
    });
  }
  // save-setting: negocio (nombre del local, moneda, ticket…) → Host; lo del
  // propio aparato (báscula, impresora) se escribe AQUÍ, en la BD de la caja.
  if (channel === "save-setting" && !BUSINESS_SETTING_KEYS.has(String(args[0]))) {
    const listener = ipcRegistry.get("save-setting");
    if (!listener) return fail("RPC_CHANNEL_UNKNOWN", "El Host no expone save-setting");
    return listener(null, ...args);
  }
  return rpcCall(db, channel, args);
};

// POST /api/rpc · los canales de la lista blanca del Host (rpc-channels.js).
const rpcCall = async (db, channel, args = [], timeoutMs = null) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  let res;
  try {
    res = await postJson(
      db,
      creds,
      "/api/rpc",
      { channel, args },
      {},
      timeoutMs || RPC_TIMEOUTS[channel] || TIMEOUT_MS,
    );
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

module.exports = {
  forward,
  rpcCall,
  recordSale,
  verifyPin,
  nextBoxFolio,
  syncPending,
  offlineVerifyPin,
  pendingSummary: (db) => offlineQueue.summary(db),
  pendingList: (db, statuses) => offlineQueue.list(db, statuses),
  pendingCancel: (db, id) => offlineQueue.cancel(db, id),
  pendingRetry: (db) => offlineQueue.retryConflicts(db),
};
