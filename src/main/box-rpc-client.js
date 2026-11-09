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
const customersCore = require("./customers-core");
const pins = require("./pins");
const protocol = require("./protocol");
const salesCore = require("./sales-core");
// 3g/D · registro de listeners CRUDOS: el puente lo usa para ejecutar en la
// caja las claves de `save-setting` que son del propio aparato.
const ipcRegistry = require("./ipc-registry");
const replicaLive = require("./replica-live");
const replicaEngine = require("./replica-engine");
const rpcContext = require("./rpc-context");
const opQueue = require("./op-queue");

const TIMEOUT_MS = 8000;
// Cobrar no espera a la red: si el Host no contesta en este tiempo la venta se
// guarda en la cola. La Idempotency-Key evita el doble registro aunque el Host
// sí la haya recibido y sólo se perdiera la respuesta.
const SALE_ONLINE_TIMEOUT_MS = 1500;
// Tras un fallo de red no se vuelve a intentar durante este rato: la siguiente
// venta va directo a la cola y sólo una cada tanto paga el intento.
const HOST_DOWN_WINDOW_MS = 20000;
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
  // Movimientos de caja: mejor esperar a que el Host termine que cortar a
  // las 8 s y enseñar un error de algo que sí se hizo.
  "open-cash-register": 20000,
  "close-cash-register": 20000,
  "register-cash-expense": 20000,
  "register-cash-income": 20000,
  "delete-cash-expense": 20000,
  "cancel-sale": 20000,
  "cancel-sale-item": 20000,
};

// Escrituras que NO se pueden repetir a ciegas (abrir caja cierra la que esté
// abierta; un retiro duplicado descuadra el corte). Viajan con
// Idempotency-Key y, si la red falla o vence el tiempo, se reintentan con la
// MISMA llave: el Host devuelve la respuesta original en vez de ejecutar dos
// veces. Así un timeout ya no termina en "error" con la caja abierta.
const IDEMPOTENT_RPC = new Set(Object.keys(RPC_TIMEOUTS).filter((c) => !c.startsWith("taecel:") && c !== "import-products-content"));
const IDEMPOTENT_RETRIES = 2;

// ── Lectura local (paso 1 local-first) ──────────────────────────────────────
// Con la copia del Host completa, estas pantallas (Caja, Transacciones,
// Movimientos, cortes, proveedores) se resuelven con la BD de la caja: sin
// viaje por la red y también sin Host. Se ejecuta el MISMO handler que en el
// Host, con el contexto de esta caja (callerDeviceId → su device_id), así que
// los filtros "sólo lo de esta caja" son idénticos.
const LOCAL_READ_CHANNELS = new Set([
  "get-cash-register-status",
  "get-previous-register-today",
  "get-sales-for-today",
  "get-outside-register-sales",
  "get-cash-register-expenses",
  "get-closed-registers",
  "get-register-movements",
  "get-register-products",
  "get-register-sales-detail",
  "get-sale-details",
  "get-sales-by-date",
  "get-sales-by-range",
  "get-expenses-by-date",
  "get-expenses-by-range",
  "get-stock-movements",
  "list-sale-devices",
  "find-sales-by-folio",
  "get-suppliers",
  "get-top-products",
  "get-daily-sales-week",
  // Clientes: la caja tiene su copia y ve al momento lo que crea o edita.
  "search-customers",
  "get-recent-customers",
  "get-customer",
  "get-customer-by-qr",
  "get-customer-prices",
  "get-customer-pricing",
]);
const localReady = (db) => {
  const st = replicaEngine.state(db);
  return st.sync_completed && replicaEngine.missingTables(db).length === 0;
};
const runLocal = (db, channel, args) => {
  const listener = ipcRegistry.get(channel);
  if (!listener) return null;
  const deviceId = activation.getSetting(db, "box_device_id") || null;
  return rpcContext.runWithCallContext({ deviceId, cashierId: null }, () => listener(null, ...args));
};

// "Lee lo que escribiste": el Host informa en cada respuesta hasta qué evento
// va (x-replica-seq). Tras una escritura se espera a tenerlo aplicado en local
// antes de devolver, para que la pantalla que relee local vea su acción.
const READ_CHANNEL_RE = /^(get|list|find)-|^taecel:(status|get-|history|transaction-status)/;
let latestHostSeq = 0;
const noteHostSeq = (headers) => {
  const seq = Number(headers && headers.get && headers.get("x-replica-seq"));
  if (Number.isFinite(seq) && seq > latestHostSeq) latestHostSeq = seq;
};
// La pantalla no se queda esperando a la réplica: pasado este rato sigue y el
// cambio llega solo, con su aviso de datos nuevos.
const WRITE_SETTLE_MS = 1000;
const settleWrite = async (db) => {
  if (!localReady(db)) return;
  await replicaLive.waitForSeq(db, latestHostSeq, WRITE_SETTLE_MS);
};

// ── Operaciones en cola (paso 2 local-first) ────────────────────────────────
// Se aplican al momento en la caja y suben solas al Host (con o sin red). Cada
// una valida en local con las MISMAS reglas que su handler del Host; el Host
// vuelve a validar al recibirla y, si la rechaza, la cola deshace el efecto.
const parseQty = (product, quantity) => {
  const raw = String(quantity ?? "").trim();
  if (product.sale_unit === "weight") return parseFloat(raw);
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
};
const QUEUED_OPS = {
  "add-stock": (db, [payload = {}]) => {
    const product = db
      .prepare("SELECT id, name, sale_unit FROM products WHERE id = ?")
      .get(payload.productId);
    if (!product) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
    const qty = parseQty(product, payload.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return fail(
        "INVALID_QUANTITY",
        product.sale_unit === "weight" ? "Cantidad no válida" : "Cantidad no válida. Solo números enteros.",
      );
    }
    return {
      effect: { stock: [{ productId: product.id, delta: qty }] },
      label: `Entrada de ${qty} · ${product.name}`,
      result: { productName: product.name },
    };
  },
  "remove-stock": (db, [payload = {}]) => {
    if (payload.role !== "admin") {
      return fail("FORBIDDEN", "Solo el propietario puede hacer salidas de stock");
    }
    const product = db
      .prepare("SELECT id, name, stock, sale_unit FROM products WHERE id = ?")
      .get(payload.productId);
    if (!product) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
    const qty = parseQty(product, payload.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return fail(
        "INVALID_QUANTITY",
        product.sale_unit === "weight" ? "Cantidad inválida" : "Cantidad no válida. Solo números enteros.",
      );
    }
    if ((Number(product.stock) || 0) < qty) {
      return fail("INSUFFICIENT_STOCK", "Stock insuficiente", {
        stock: { product: product.name, productId: product.id, available: Number(product.stock) || 0, requested: qty },
      });
    }
    return {
      effect: { stock: [{ productId: product.id, delta: -qty }] },
      label: `Salida de ${qty} · ${product.name}`,
      result: {},
    };
  },
  // Clientes · mismas reglas que el Host (customers-core). El alta nace con un
  // uid; el Host lo guarda y así reconoce al cliente en ediciones y ventas.
  "add-customer": (db, [data = {}]) => {
    const n = customersCore.normalize(data);
    if (!n.success) return n;
    const uid = crypto.randomUUID();
    const after = customersCore.provisionalRow(db, n, uid);
    return {
      args: [{ ...data, name: n.name, phone: n.phone, tier_id: n.tier_id, uid }],
      effect: { rows: [{ table: "customers", before: null, after }] },
      tables: ["customers"],
      label: `Cliente nuevo · ${n.name}`,
      result: { customer: after },
    };
  },
  "update-customer": (db, [id, data = {}]) => {
    const n = customersCore.normalize(data);
    if (!n.success) return n;
    const before = db.prepare("SELECT * FROM customers WHERE id = ?").get(Number(id));
    if (!before) return fail("CUSTOMER_NOT_FOUND", "Cliente no encontrado");
    const pick = (row) => ({ id: row.id, uid: row.uid || undefined, name: row.name, phone: row.phone, tier_id: row.tier_id });
    return {
      args: [before.id, { ...data, name: n.name, phone: n.phone, tier_id: n.tier_id, uid: before.uid || undefined }],
      effect: { rows: [{ table: "customers", before: pick(before), after: { ...pick(before), name: n.name, phone: n.phone, tier_id: n.tier_id } }] },
      tables: ["customers"],
      label: `Cliente editado · ${n.name}`,
      result: {},
    };
  },
};

// Aviso a main para que las pantallas relean (stock y movimientos locales).
let opsChangedHook = null;
const setOpsChangedHook = (fn) => {
  opsChangedHook = typeof fn === "function" ? fn : null;
};
const opsChanged = (tables = ["products", "stock_movements"]) => {
  if (opsChangedHook) {
    try {
      opsChangedHook([...tables, "pending_ops"]);
    } catch (err) {}
  }
};

// Movimientos: lo que sigue en cola sale arriba, marcado como pendiente (o en
// revisión), con los mismos filtros de tipo y búsqueda que la consulta local.
const withPendingMovements = (db, rows, params = {}) => {
  const ops = opQueue
    .list(db, ["pending", "syncing", "needs_auth", "conflict"])
    .filter((o) => o.channel === "add-stock" || o.channel === "remove-stock");
  if (!ops.length) return rows;
  const term = String((params && params.search) || "").trim().toLowerCase();
  const extra = [];
  for (const o of ops) {
    const p = (o.args && o.args[0]) || {};
    const type = o.channel === "add-stock" ? "in" : "out";
    if (params && params.type && params.type !== type) continue;
    const product = db.prepare("SELECT name, barcode FROM products WHERE id = ?").get(p.productId) || {};
    if (term && !String(product.name || "").toLowerCase().includes(term) && !String(product.barcode || "").includes(term)) continue;
    extra.push({
      id: `op-${o.id}`,
      product_id: p.productId,
      product_name: product.name || "—",
      barcode: product.barcode || null,
      type,
      quantity: Math.abs(Number(((o.effect && o.effect.stock) || [])[0]?.delta) || 0),
      notes: p.notes || (type === "in" ? "Compra de inventario" : "Salida de stock"),
      created_at: String(o.createdAt || "").replace("T", " ").slice(0, 19),
      cashier_name: null,
      pending: o.status === "conflict" ? "conflict" : "pending",
      pending_error: o.status === "conflict" ? o.lastError : null,
    });
  }
  return [...extra.reverse(), ...rows];
};

// Ventas sin subir: la caja las muestra como si ya estuvieran en su copia local,
// marcadas `pending`. Son sólo lectura: al llegar por la réplica las reemplaza
// la venta real (mismo folio).
const PENDING_SALE_ID = "pending-";
const SALE_LIST_CHANNELS = new Set(["get-sales-for-today", "get-sales-by-date", "get-sales-by-range"]);
const mxDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

const pendingSaleRow = (db, row) => {
  const payload = row.payload || {};
  const cart = Array.isArray(payload.cart) ? payload.cart : [];
  const items = cart.map((item, i) => ({
    id: `${PENDING_SALE_ID}${row.id}-${i}`,
    sale_id: `${PENDING_SALE_ID}${row.id}`,
    product_id: typeof item.id === "number" ? item.id : null,
    name: item.name,
    product_name: item.name,
    quantity: Number(item.quantity) || 0,
    price_at_sale: Number(item.finalPrice ?? item.price) || 0,
    discount_percent: Number(item.discount_percent) || 0,
    returned_qty: 0,
    status: null,
    sale_unit: item.sale_unit || "piece",
  }));
  return {
    id: `${PENDING_SALE_ID}${row.id}`,
    folio: row.folio,
    total: Number(payload.total) || 0,
    payment_method: payload.paymentMethod,
    discount_total: Number(payload.discountTotal) || 0,
    status: "completado",
    register_id: row.registerId ?? null,
    cashier_id: row.cashierId ?? null,
    cashier_name: row.cashierName || null,
    device_code: activation.getSetting(db, "box_device_code") || null,
    created_at: String(row.localCreatedAt || "").replace("T", " ").slice(0, 19),
    can_cancel: 0,
    pending: row.status === "conflict" ? "conflict" : "pending",
    pending_error: row.status === "conflict" ? row.lastError : null,
    products: items.map((it) => ({ name: it.name, qty: it.quantity })),
    items,
  };
};

const pendingSaleMatches = (db, channel, row, params = {}) => {
  const ownId = activation.getSetting(db, "box_device_id");
  if (params.deviceId && params.deviceId !== ownId) return false;
  const day = mxDate(row.localCreatedAt);
  if (channel === "get-sales-by-range") {
    return (!params.startDate || day >= params.startDate) && (!params.endDate || day <= params.endDate);
  }
  if (channel === "get-sales-for-today" && params.registerId) {
    return String(row.registerId) === String(params.registerId);
  }
  return !params.date || day === params.date;
};

const withPendingSales = (db, channel, result, params = {}) => {
  if (!result || !result.success) return result;
  const rows = offlineQueue
    .unsettled(db)
    .filter((row) => pendingSaleMatches(db, channel, row, params))
    .map((row) => pendingSaleRow(db, row));
  if (!rows.length) return result;
  const merged = { ...result, sales: [...rows, ...(result.sales || [])] };
  if (result.total !== undefined) {
    merged.total = Number(result.total || 0) + rows.reduce((sum, r) => sum + r.total, 0);
  }
  if (result.count !== undefined) merged.count = Number(result.count || 0) + rows.length;
  if (Array.isArray(result.byMethod)) {
    const byMethod = result.byMethod.map((m) => ({ ...m }));
    for (const r of rows) {
      const entry = byMethod.find((m) => m.payment_method === r.payment_method);
      if (entry) {
        entry.count = Number(entry.count || 0) + 1;
        entry.total = Number(entry.total || 0) + r.total;
      } else {
        byMethod.push({ payment_method: r.payment_method, count: 1, total: r.total });
      }
    }
    merged.byMethod = byMethod;
  }
  return merged;
};

const pendingSaleDetails = (db, saleId) => {
  const id = Number(String(saleId).slice(PENDING_SALE_ID.length));
  const row = offlineQueue.get(db, id);
  if (!row) return fail("SALE_NOT_FOUND", "La venta ya no está en la cola");
  const sale = pendingSaleRow(db, row);
  return { success: true, sale, items: sale.items };
};

// La venta en cola cambia lo que muestran Caja y Transacciones.
const salesChanged = () => {
  if (opsChangedHook) {
    try {
      opsChangedHook(["sales"]);
    } catch (err) {}
  }
};

const enqueueOp = (db, channel, args) => {
  const prepared = QUEUED_OPS[channel](db, args);
  if (prepared && prepared.success === false) return prepared;
  opQueue.enqueue(db, {
    channel,
    args: prepared.args || args,
    effect: prepared.effect,
    label: prepared.label,
    idempotencyKey: crypto.randomUUID(),
  });
  opsChanged(prepared.tables);
  // En segundo plano: la pantalla no espera a la red.
  syncOps(db).catch(() => {});
  return { success: true, queued: true, ...prepared.result };
};

const syncOps = async (db) => {
  const send = (row) => rpcCall(db, row.channel, row.args, null, { idempotencyKey: row.idempotencyKey });
  let out = await opQueue.sync(db, send);
  // Si se unió a una subida que ya iba en curso, lo encolado después no estaba
  // en esa vuelta: se sube ahora, en orden, mientras el Host siga contestando.
  for (let i = 0; i < 5 && out.success && opQueue.list(db, [opQueue.STATUS.PENDING]).length; i++) {
    const next = await opQueue.sync(db, send);
    out = { ...next, synced: out.synced + next.synced, conflicts: out.conflicts + next.conflicts };
  }
  if (out.synced || out.conflicts) opsChanged(["products", "stock_movements", "customers"]);
  return out;
};

// Claves de `save-setting` que el negocio comparte entre cajas (van al Host).
const BUSINESS_SETTING_KEYS = new Set(dbSchema.REPLICATED_SETTINGS_KEYS);

const fail = (code, error, extra = {}) => ({ success: false, code, error, ...extra });

// ── Medición (paso 4) ───────────────────────────────────────────────────────
// Cada petición al Host deja {canal, total, host, red}. `host` sale de la
// cabecera x-host-ms; red = total - host. Main decide dónde se guarda
// (setTimingSink) y aquí además se lleva un resumen por canal en memoria.
let timingSink = null;
const setTimingSink = (fn) => {
  timingSink = typeof fn === "function" ? fn : null;
};
const TIMING_KEEP = 200; // últimas muestras por canal
const timingStats = new Map();
const recordTiming = (entry) => {
  const list = timingStats.get(entry.channel) || [];
  list.push(entry.totalMs);
  if (list.length > TIMING_KEEP) list.shift();
  timingStats.set(entry.channel, list);
  if (timingSink) {
    try {
      timingSink(entry);
    } catch (err) {}
  }
};
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
const timingSummary = () =>
  [...timingStats.entries()]
    .map(([channel, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return {
        channel,
        count: sorted.length,
        p50: pct(sorted, 0.5),
        p95: pct(sorted, 0.95),
        max: sorted[sorted.length - 1],
      };
    })
    .sort((a, b) => b.p95 - a.p95);

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
// Serie que el propio Host dijo que es la de esta caja (`expected_prefix` de un
// FOLIO_INVALID). Manda sobre la calculada: si el `box_device_code` local
// quedó desalineado con el del Host, cada venta se rechazaba con "no es de la
// serie de esta caja" y el reintento volvía a salir con el mismo prefijo.
const FOLIO_PREFIX_KEY = "box_folio_prefix";
const PREFIX_RE = /^[A-Z][A-Z0-9]{0,7}$/;
const nextBoxFolio = (db) => {
  const code = activation.getSetting(db, "box_device_code") || "";
  const deviceId = activation.getSetting(db, "box_device_id") || "";
  const hostPrefix = String(activation.getSetting(db, FOLIO_PREFIX_KEY) || "");
  const prefix = PREFIX_RE.test(hostPrefix)
    ? hostPrefix
    : salesCore.folioPrefixFor(code, deviceId);
  const seq = Math.max(1, Number(activation.getSetting(db, FOLIO_SEQ_KEY) || 1) || 1);
  activation.setSetting(db, FOLIO_SEQ_KEY, String(seq + 1));
  return salesCore.formatFolio(prefix, seq);
};

// Fase 2 · el Host informa hasta dónde va la serie de esta caja. Tras una
// reinstalación o un respaldo restaurado el contador local quedaría atrás y
// cada venta chocaría con un folio ya usado; nunca retrocede.
const adoptHostFolioSeq = (db, data) => {
  const expected = String((data && data.expected_prefix) || "").toUpperCase();
  if (PREFIX_RE.test(expected)) activation.setSetting(db, FOLIO_PREFIX_KEY, expected);
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

let lastHostFailAt = 0;
// Cualquier señal de vida posterior al fallo (una respuesta o un frame de la
// réplica) lo anula; si no, caduca sola para volver a probar.
const hostKnownDown = (db) => {
  if (!lastHostFailAt || Date.now() - lastHostFailAt >= HOST_DOWN_WINDOW_MS) return false;
  return !(Number(replicaLive.hostOkInfo(db).okAt) > lastHostFailAt);
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
  const channel = path === "/api/rpc" && body && body.channel ? body.channel : path;
  const startedAt = performance.now();
  let res;
  try {
    res = await fetch(`${creds.hostUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    lastHostFailAt = Date.now();
    recordTiming({
      at: new Date().toISOString(),
      channel,
      totalMs: Math.round(performance.now() - startedAt),
      hostMs: null,
      netMs: null,
      error: (err && (err.name === "TimeoutError" ? "TIMEOUT" : err.message)) || "fetch",
    });
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {}
  {
    const totalMs = Math.round(performance.now() - startedAt);
    const hostMs = Number(res.headers.get("x-host-ms"));
    const known = Number.isFinite(hostMs) && res.headers.get("x-host-ms") !== null;
    recordTiming({
      at: new Date().toISOString(),
      channel,
      totalMs,
      hostMs: known ? hostMs : null,
      netMs: known ? Math.max(0, totalMs - hostMs) : null,
      // Si es alto, el Host estaba trabado: el tiempo de "red" fue espera allá.
      hostLagMs: Number.isFinite(Number(res.headers.get("x-host-lag"))) && res.headers.get("x-host-lag") !== null
        ? Number(res.headers.get("x-host-lag"))
        : null,
      status: res.status,
    });
  }
  // El Host contestó con JSON: está vivo aunque el flujo de réplica esté
  // reconectando (el encabezado deja de decir "desconectado" en falso).
  if (data) {
    replicaLive.markHostOk();
    lastHostFailAt = 0;
  }
  try {
    const warning = res.headers.get("x-protocol-warning");
    activation.setSetting(db, "protocol_warning", warning || "");
  } catch (err) {}
  noteHostSeq(res.headers);
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
  salesChanged();
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
  if (payload.customerUid) {
    body.customer_uid = payload.customerUid;
  } else if (payload.customerId !== null && payload.customerId !== undefined) {
    body.customer_id = payload.customerId;
  }
  if (payload.registerId != null) body.register_id = payload.registerId;
  if (payload.cashierId != null) body.cashier_id = payload.cashierId;
  if (payload.paymentMethod === "credit") {
    body.credit_paid = payload.creditPaid || 0;
    body.credit_paid_method = payload.creditPaidMethod || null;
    if (payload.ownerPin) body.owner_pin = payload.ownerPin;
  }
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
  if (Number(payload.customerId) < 0) {
    const provisional = db.prepare("SELECT uid FROM customers WHERE id = ?").get(Number(payload.customerId));
    if (provisional && provisional.uid) payload = { ...payload, customerUid: provisional.uid };
  }
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

  const queueSale = () =>
    enqueueSale(db, {
      folio: attempt.folio,
      payload,
      idempotencyKey: attempt.key,
      registerId: payload.registerId,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      localCreatedAt: new Date().toISOString(),
    });

  let body = saleBody(payload, attempt.folio, false);
  // Fiado sólo en línea: el saldo y el límite viven en el Host. Sin conexión
  // NO se encola: se avisa para cobrar de otra forma. El intento (llave y
  // folio) se conserva: si la red cayó después de que el Host la guardó,
  // reintentar la misma venta recibe la respuesta original, no un duplicado.
  if (payload.paymentMethod === "credit") {
    const offlineFail = () =>
      fail("CREDIT_REQUIRES_HOST", "El fiado requiere conexión con el Host. Reintenta o cobra con otro método.");
    if (hostKnownDown(db)) return offlineFail();
    let cres;
    try {
      cres = await postJson(db, creds, "/api/sales", body, { "idempotency-key": attempt.key });
    } catch (err) {
      return offlineFail();
    }
    if (!cres.data) return offlineFail();
    if (cres.status === 401) {
      expired(db, cres.data);
      return fail("SESSION_EXPIRED", "La sesión con el Host caducó");
    }
    adoptHostFolioSeq(db, cres.data);
    // Mismo realineado de serie que la venta normal: una vez, con clave nueva.
    if (cres.data.code === "FOLIO_INVALID" || cres.data.code === "SQLITE_CONSTRAINT_UNIQUE") {
      attempt = { signature, key: crypto.randomUUID(), folio: nextBoxFolio(db) };
      saveAttempt(db, attempt);
      body = saleBody(payload, attempt.folio, false);
      try {
        cres = await postJson(db, creds, "/api/sales", body, { "idempotency-key": attempt.key });
      } catch (err) {
        return offlineFail();
      }
      if (!cres.data) return offlineFail();
      if (cres.status === 401) {
        expired(db, cres.data);
        return fail("SESSION_EXPIRED", "La sesión con el Host caducó");
      }
      adoptHostFolioSeq(db, cres.data);
    }
    if (cres.data.success) clearAttempt(db);
    return cres.data;
  }
  // Cliente creado en la caja que el Host aún no conoce: la venta va a la cola
  // con su uid y sube después del alta (syncPending sube antes las operaciones).
  if (payload.customerUid) {
    const queued = queueSale();
    syncPending(db).catch(() => {});
    return queued;
  }
  if (hostKnownDown(db)) return queueSale();
  let res;
  try {
    res = await postJson(
      db,
      creds,
      "/api/sales",
      body,
      { "idempotency-key": attempt.key },
      SALE_ONLINE_TIMEOUT_MS,
    );
  } catch (err) {
    return queueSale();
  }
  if (!res.data) return queueSale();
  if (res.status === 401) {
    // No se pierde: queda en cola y el renderer pedirá el PIN.
    expired(db, res.data);
    return queueSale();
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
      res = await postJson(
        db,
        creds,
        "/api/sales",
        body,
        { "idempotency-key": attempt.key },
        SALE_ONLINE_TIMEOUT_MS,
      );
    } catch (err) {
      return queueSale();
    }
    // Respuesta sin JSON o sesión vencida en el reintento: igual que en el
    // primer envío, la venta se encola en vez de perderse.
    if (!res.data || res.status === 401) {
      if (res.status === 401) expired(db, res.data);
      return queueSale();
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
  // Primero las operaciones: una venta puede usar un cliente creado aquí.
  if (opQueue.countOpen(db) > 0) await syncOps(db).catch(() => {});
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
    let res = await postJson(db, creds, "/api/sales", body, {
      "idempotency-key": row.idempotencyKey,
    });
    if (!res.data) return { success: false, code: "HOST_UNREACHABLE" };
    if (res.status === 401) return { success: false, code: "SESSION_EXPIRED", error: "Sesión expirada" };
    adoptHostFolioSeq(db, res.data);
    // Folio fuera de serie: ya con el prefijo del Host se le da uno nuevo y se
    // reintenta una vez. El Host sólo guarda la llave al aceptar, así que la
    // misma llave sirve; sin esto la venta quedaba en "Revisión" para siempre.
    if (res.data.code === "FOLIO_INVALID" && res.data.expected_prefix) {
      const folio = nextBoxFolio(db);
      db.prepare("UPDATE pending_sales SET folio = ? WHERE id = ?").run(folio, row.id);
      res = await postJson(db, creds, "/api/sales", { ...body, folio }, {
        "idempotency-key": row.idempotencyKey,
      });
      if (!res.data) return { success: false, code: "HOST_UNREACHABLE" };
      if (res.status === 401) return { success: false, code: "SESSION_EXPIRED", error: "Sesión expirada" };
      adoptHostFolioSeq(db, res.data);
    }
    return res.data;
  });
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
    salesChanged();
  }
};

// El Host cambió de dirección: lo anterior ya no cuenta como caída, y lo que
// quedó en cola puede subir sin esperar al temporizador.
const noteHostMoved = (db) => {
  lastHostFailAt = 0;
  syncPending(db).catch(() => {});
  syncOps(db).catch(() => {});
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
// queda cifrado en safeStorage (nunca en claro). Devuelve null si no hubo
// respuesta; `isCurrent` descarta el token de un login que ya quedó atrás.
const hostLogin = async (db, creds, id, pin, timeoutMs, isCurrent = () => true) => {
  let res;
  try {
    res = await postJson(db, creds, "/api/auth", { id, pin }, {}, timeoutMs);
  } catch (err) {
    return null;
  }
  if (!res.data) return null;
  if (res.status !== 200 || res.data.success !== true) {
    // 401 aquí es "PIN inválido", NO sesión caducada: no se borra nada.
    const code =
      res.data.code || (res.status === 401 ? "PIN_INVALID" : "HOST_REJECTED");
    return fail(code, res.data.error || "PIN inválido");
  }
  if (!isCurrent()) return { success: true, cashier: res.data.cashier };
  if (res.data.token) clientLink.saveSessionToken(db, res.data.token);
  // La ventana de gracia rota el token de dispositivo en cada login: si la caja
  // no guarda el nuevo, el Host la rechaza con "no está activado" en todo.
  if (res.data.pairedToken) clientLink.savePairedToken(db, res.data.pairedToken);
  // Fase 2 · con sesión nueva, las ventas que quedaron esperando login
  // vuelven a la cola y se suben ya (sin esperar al temporizador).
  if (opQueue.resumeNeedsAuth(db) > 0 || opQueue.countOpen(db) > 0) {
    syncOps(db).catch(() => {});
  }
  if (offlineQueue.resumeNeedsAuth(db).resumed > 0) {
    syncPending(db).catch(() => {});
  }
  return { success: true, cashier: res.data.cashier };
};

const verifyPin = async (db, id, pin) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return offlineVerifyPin(db, id, pin);
  const out = await hostLogin(db, creds, id, pin);
  return out || offlineVerifyPin(db, id, pin);
};

// Local-first · el PIN se valida con la copia local y se entra al momento; la
// sesión del Host se pide en segundo plano. Sólo espera al Host si el PIN no
// coincide aquí: puede haber cambiado allá y no haber llegado todavía.
let sessionCashierId = null;
let loginSeq = 0;
const loginLocalFirst = async (db, id, pin) => {
  const creds = credentials(db);
  if (!creds.hostUrl || !localReady(db)) return verifyPin(db, id, pin);
  const local = offlineVerifyPin(db, id, pin);
  if (!local.success) {
    if (local.code === "PIN_LOCKED" || hostKnownDown(db)) return local;
    const out = await hostLogin(db, creds, id, pin, SALE_ONLINE_TIMEOUT_MS);
    return out || local;
  }
  // El Host firma cada venta con el dueño del token: el del cajero anterior no
  // puede seguir vivo mientras llega el nuevo.
  if (sessionCashierId !== Number(id)) {
    clientLink.clearSessionToken(db);
    sessionCashierId = Number(id);
  }
  const seq = ++loginSeq;
  hostLogin(db, credentials(db), id, pin, TIMEOUT_MS, () => seq === loginSeq).catch(() => {});
  return { success: true, cashier: local.cashier, warning: local.warning, stale_ms: local.stale_ms };
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
  if (channel === "verify-cashier-pin") {
    // Recuperar una sesión caducada sí necesita al Host: es justo lo que falta.
    const mustReachHost = args[2] && args[2].needsHostSession;
    return mustReachHost ? verifyPin(db, args[0], args[1]) : loginLocalFirst(db, args[0], args[1]);
  }
  if (channel === "record-sale") {
    return recordSale(db, args[0]).then((r) => {
      // Venta en línea: Caja y Transacciones la reciben por la réplica y se
      // refrescan solas. Va en segundo plano: el cobro no espera a la copia.
      if (r && r.success && !r.offline) settleWrite(db).catch(() => {});
      return r;
    });
  }
  if (channel === "touch-customer" && localReady(db)) {
    const local = runLocal(db, channel, args);
    if (Number(args[0]) > 0) rpcCall(db, channel, args).catch(() => {});
    return Promise.resolve(local || { success: true });
  }
  if (QUEUED_OPS[channel] && localReady(db)) {
    return Promise.resolve(enqueueOp(db, channel, args));
  }
  if (channel === "get-sale-details" && String(args[0]).startsWith(PENDING_SALE_ID)) {
    return Promise.resolve(pendingSaleDetails(db, args[0]));
  }
  if (LOCAL_READ_CHANNELS.has(channel) && localReady(db)) {
    const local = runLocal(db, channel, args);
    if (local) {
      return Promise.resolve(local).then((r) => {
        if (channel === "get-cash-register-status" && r && r.success) cacheRegister(db, r);
        if (channel === "get-stock-movements" && Array.isArray(r)) return withPendingMovements(db, r, args[0]);
        if (SALE_LIST_CHANNELS.has(channel)) return withPendingSales(db, channel, r, args[0]);
        return r;
      });
    }
  }
  // Cerrar caja exige que la cola esté vacía (decisión de negocio).
  if (channel === "close-cash-register") {
    const pendingOps = opQueue.countOpen(db);
    if (pendingOps > 0) {
      syncOps(db).catch(() => {});
      return Promise.resolve(
        fail(
          "PENDING_OPS",
          `Hay ${pendingOps} movimiento(s) de inventario sin subir al Host. Espera a que se sincronicen antes de cerrar caja.`,
        ),
      );
    }
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
  if (
    channel === "open-cash-register" ||
    channel === "register-cash-expense" ||
    channel === "register-cash-income" ||
    channel === "delete-cash-expense"
  ) {
    // Si el Host está caído, el error de red no es claro para el cajero.
    return rpcCall(db, channel, args).then((r) => {
      if (r && r.code === "HOST_UNREACHABLE") return HOST_REQUIRED("Esta operación");
      return r;
    });
  }
  if (channel === "get-cash-register-status") {
    // Cobrar consulta esto antes de vender: sin copia local tampoco puede
    // esperar 8 s, y si el Host no contesta queda la última caja conocida.
    return rpcCall(db, channel, args, SALE_ONLINE_TIMEOUT_MS).then((r) => {
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
const rpcCall = async (db, channel, args = [], timeoutMs = null, opts = {}) => {
  const creds = credentials(db);
  if (!creds.hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  // Sin Host, una lectura no vale 8 s de espera: falla al momento.
  if (READ_CHANNEL_RE.test(channel) && hostKnownDown(db)) {
    return fail("HOST_UNREACHABLE", "El Host no responde");
  }
  // La cola de operaciones trae su propia llave (la misma en cada reintento).
  const idempotent = !!opts.idempotencyKey || IDEMPOTENT_RPC.has(channel);
  const headers = idempotent
    ? { "idempotency-key": opts.idempotencyKey || crypto.randomUUID() }
    : {};
  const attempts = idempotent ? 1 + IDEMPOTENT_RETRIES : 1;
  let res;
  for (let i = 0; i < attempts; i++) {
    try {
      res = await postJson(
        db,
        creds,
        "/api/rpc",
        { channel, args },
        headers,
        timeoutMs || RPC_TIMEOUTS[channel] || TIMEOUT_MS,
      );
      break;
    } catch (err) {
      if (i === attempts - 1) return unreachable(err);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!res.data) return fail("HOST_UNREACHABLE", "El Host no contestó");
  if (res.status === 401) return expired(db, res.data);
  // Vínculo con el Host, no respuesta del negocio: la cola lo reintenta.
  if (res.status === 403 && res.data.needsActivation) {
    return fail("NOT_PAIRED", res.data.error || "El Host no reconoce esta caja");
  }
  // Éxito: el Host envuelve el valor del handler en {success, result}.
  if (res.status === 200 && res.data.success) {
    if (!READ_CHANNEL_RE.test(channel)) await settleWrite(db);
    return res.data.result === undefined ? null : res.data.result;
  }
  return res.data; // fallo del Host ({success:false, code, error}) tal cual.
};

module.exports = {
  setTimingSink,
  setOpsChangedHook,
  noteHostMoved,
  withPendingSales,
  pendingSaleDetails,
  syncOps,
  opsSummary: (db) => opQueue.summary(db),
  opsList: (db, statuses) => opQueue.list(db, statuses),
  opsCancel: (db, id) => {
    const r = opQueue.cancel(db, id);
    if (r.success) opsChanged();
    return r;
  },
  reapplyPendingOps: (db, productIds) => opQueue.reapplyPending(db, productIds),
  reapplyPendingRows: (db, table) => opQueue.reapplyRows(db, table),
  timingSummary,
  forward,
  rpcCall,
  recordSale,
  verifyPin,
  loginLocalFirst,
  nextBoxFolio,
  syncPending,
  offlineVerifyPin,
  pendingSummary: (db) => offlineQueue.summary(db),
  pendingList: (db, statuses) => offlineQueue.list(db, statuses),
  pendingCancel: (db, id) => offlineQueue.cancel(db, id),
  pendingRetry: (db) => offlineQueue.retryConflicts(db),
};
