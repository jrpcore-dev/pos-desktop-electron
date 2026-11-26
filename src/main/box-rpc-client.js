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
const catalogCore = require("./catalog-core");
const productsCore = require("./products-core");
const cashCore = require("./cash-core");
const pricesCore = require("./prices-core");
const promosCore = require("./promos-core");
const pins = require("./pins");
const protocol = require("./protocol");
const salesCore = require("./sales-core");
const salesLocal = require("./sales-local");
const salesCancelCore = require("./sales-cancel-core");
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
  "taecel:mixed-sale": 40000,
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
  "get-categories",
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
// Catálogo (categorías, proveedores): crear y editar con las reglas de
// catalog-core, las mismas que aplica el Host.
const catalogAdd = (table, noun) => (db, [data = {}]) => {
  const n = catalogCore.normalize(table, data);
  if (!n.success) return n;
  if (catalogCore.nameTaken(db, table, n.values.name)) {
    return fail("NAME_TAKEN", catalogCore.ENTITIES[table].exists);
  }
  const uid = crypto.randomUUID();
  const after = catalogCore.provisionalRow(db, table, n.values, uid);
  return {
    args: [{ ...data, ...n.values, uid }],
    effect: { rows: [{ table, before: null, after }] },
    tables: [table],
    label: `${noun} nuevo · ${n.values.name}`,
    result: { id: after.id, row: after },
  };
};
const catalogUpdate = (table, noun) => (db, [id, data = {}]) => {
  const n = catalogCore.normalize(table, data);
  if (!n.success) return n;
  const before = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
  if (!before) return fail(catalogCore.ENTITIES[table].notFound, `${catalogCore.ENTITIES[table].label} no encontrado`);
  if (catalogCore.nameTaken(db, table, n.values.name, before.id)) {
    return fail("NAME_TAKEN", catalogCore.ENTITIES[table].exists);
  }
  const cols = Object.keys(n.values);
  const pick = (row) => {
    const out = { id: row.id, uid: row.uid || undefined };
    for (const c of cols) out[c] = row[c];
    return out;
  };
  return {
    args: [before.id, { ...data, ...n.values, uid: before.uid || undefined }],
    effect: { rows: [{ table, before: pick(before), after: { ...pick(before), ...n.values } }] },
    tables: [table],
    label: `${noun} editado · ${n.values.name}`,
    result: {},
  };
};

// Productos · mismas columnas que escribe el Host (products-core). El stock
// nunca viaja como cantidad exacta: el inicial es un delta y editar no lo toca.
const PRODUCT_COLS = Object.keys(productsCore.values({}));
const pickProduct = (row) => {
  const out = { id: row.id, uid: row.uid || undefined, min_stock: row.min_stock, is_active: row.is_active };
  for (const c of PRODUCT_COLS) out[c] = row[c];
  return out;
};
const pricesOf = (db, productId) =>
  db.prepare("SELECT id, type, qty, price, unit FROM product_prices WHERE product_id = ? ORDER BY id").all(productId);
// La referencia que entiende el Host: un producto creado aquí va por uid.
const productRef = (row) => (row && row.id < 0 && row.uid ? { productUid: row.uid } : {});
// La fila actual de un producto. Una pantalla puede seguir con el id
// provisional (negativo) cuando la réplica ya lo cambió por el del Host: se
// ubica por el uid de su alta.
const uidOfProvisional = (db, id) => {
  if (!(Number(id) < 0)) return null;
  // El más reciente: un id provisional se vuelve a usar cuando el anterior ya
  // se cambió por el del Host.
  for (const op of opQueue.list(db).reverse()) {
    if (op.channel !== "add-product") continue;
    const after = op.effect && op.effect.rows && op.effect.rows[0] && op.effect.rows[0].after;
    if (after && Number(after.id) === Number(id) && after.uid) return after.uid;
  }
  return null;
};
const localProduct = (db, id) => {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(id));
  if (row) return row;
  const uid = uidOfProvisional(db, id);
  return uid ? db.prepare("SELECT * FROM products WHERE uid = ?").get(uid) || null : null;
};
// Creado aquí y su alta todavía no sube: sólo esta caja lo tiene.
const onlyHere = (db, row) => {
  if (!row || !row.uid) return false;
  if (row.id < 0) return true;
  return opQueue
    .list(db, [opQueue.STATUS.PENDING, opQueue.STATUS.SYNCING, opQueue.STATUS.NEEDS_AUTH])
    .some((op) => op.channel === "add-product" && op.args && op.args[0] && op.args[0].uid === row.uid);
};

// Retiros y entradas de dinero · mismas reglas que el Host (cash-core). El
// total de la caja se mueve como suma; la fila lleva uid e id negativo.
const sqliteNowUtc = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const cashOp = (kind) => (db, [data = {}]) => {
  const n = cashCore.normalize(kind, data);
  if (!n.success) return n;
  const deviceId = activation.getSetting(db, "box_device_id") || null;
  const register = cashCore.registerFor(db, data || {}, deviceId);
  if (!register) return fail("NO_OPEN_REGISTER", cashCore.KINDS[kind].noRegister);
  const { col } = cashCore.KINDS[kind];
  const uid = crypto.randomUUID();
  const min = Number(db.prepare("SELECT MIN(id) AS m FROM cash_register_expenses").get().m) || 0;
  const after = {
    id: Math.min(min, 0) - 1,
    uid,
    register_id: register.id,
    amount: n.amount,
    reason: n.reason,
    category: n.category,
    kind: kind === "in" ? "in" : null,
    status: null,
    created_at: sqliteNowUtc(),
  };
  const total = (Number(register[col]) || 0) + n.amount;
  return {
    args: [{ ...data, amount: n.amount, reason: n.reason, category: n.category, uid, registerId: register.id }],
    effect: {
      rows: [{ table: "cash_register_expenses", before: null, after }],
      adds: [{ table: "cash_register", id: register.id, col, delta: n.amount }],
    },
    tables: ["cash_register", "cash_register_expenses"],
    label: `${kind === "in" ? "Entrada" : "Retiro"} de ${fmtMoney(n.amount)} · ${n.reason || "Sin motivo"}`,
    result: kind === "in" ? { cashIn: total, id: after.id } : { expenses: total, id: after.id },
  };
};

// Precios especiales por nivel y por cliente · mismas reglas que el Host
// (prices-core). La pareja es la llave; lo creado aquí viaja por uid.
const uidIfLocal = (row) => (row && row.id < 0 && row.uid ? row.uid : undefined);
const ownerRow = (db, name, id) =>
  name === "customer_prices"
    ? db.prepare("SELECT id, uid, name FROM customers WHERE id = ?").get(Number(id))
    : db.prepare("SELECT id, name FROM customer_tiers WHERE id = ?").get(Number(id));
const pairPrice = (db, name, ownerId, productId) => {
  const t = pricesCore.TABLES[name];
  const row = db.prepare(`SELECT price FROM ${name} WHERE ${t.owner} = ? AND product_id = ?`).get(ownerId, productId);
  return row ? row.price : null;
};
const setPairOp = (name) => (db, [ownerId, productId, price]) => {
  const t = pricesCore.TABLES[name];
  const value = pricesCore.validPrice(price);
  if (!value) return fail("INVALID_PRICE", "Precio inválido");
  const owner = ownerRow(db, name, ownerId);
  if (!owner) return fail("OWNER_NOT_FOUND", t.notFound);
  const product = db.prepare("SELECT id, uid, name FROM products WHERE id = ?").get(Number(productId));
  if (!product) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
  const refs =
    name === "customer_prices"
      ? { customerUid: uidIfLocal(owner), productUid: uidIfLocal(product) }
      : { productUid: uidIfLocal(product) };
  return {
    args: [owner.id, product.id, value, refs],
    effect: {
      pairs: [
        {
          table: name,
          ownerId: owner.id,
          ownerUid: owner.uid || undefined,
          productId: product.id,
          productUid: product.uid || undefined,
          before: pairPrice(db, name, owner.id, product.id),
          after: value,
        },
      ],
    },
    tables: [name],
    label: `Precio de ${product.name} para ${owner.name} · ${fmtMoney(value)}`,
    result: {},
  };
};
const deletePairOp = (name) => (db, [id]) => {
  const t = pricesCore.TABLES[name];
  const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(Number(id));
  // Ya no está: quitarlo otra vez no es error (igual que en el Host).
  if (!row) return { args: [id], effect: null, tables: [], label: "Precio quitado", result: {} };
  const owner = ownerRow(db, name, row[t.owner]) || { id: row[t.owner] };
  const product = db.prepare("SELECT id, uid, name FROM products WHERE id = ?").get(row.product_id) || { id: row.product_id };
  const refs =
    name === "customer_prices"
      ? { customerId: owner.id, customerUid: uidIfLocal(owner), productId: product.id, productUid: uidIfLocal(product) }
      : { tierId: owner.id, productId: product.id, productUid: uidIfLocal(product) };
  return {
    args: [row.id > 0 ? row.id : null, refs],
    effect: {
      pairs: [
        {
          table: name,
          ownerId: owner.id,
          ownerUid: owner.uid || undefined,
          productId: product.id,
          productUid: product.uid || undefined,
          before: row.price,
          after: null,
        },
      ],
    },
    tables: [name],
    label: `Precio quitado · ${product.name || "producto"}${owner.name ? ` · ${owner.name}` : ""}`,
    result: {},
  };
};

// Promos por categoría/marca y paquetes · mismas reglas que el Host
// (promos-core). Lo creado aquí (la promo, el paquete, su categoría o sus
// productos) viaja por uid.
const pickCols = (row, cols) => {
  const out = { id: row.id, uid: row.uid || undefined };
  for (const c of cols) out[c] = row[c];
  return out;
};
const PROMO_COLS = ["name", "scope", "category_id", "brand", "percent", "start_date", "end_date", "is_active"];
const BUNDLE_COLS = ["name", "price", "start_date", "end_date", "is_active"];
const saveGroupPromoOp = (db, [promo = {}]) => {
  const scope = promo && promo.scope === "brand" ? "brand" : "category";
  const catId = scope === "category" ? parseInt(promo.category_id, 10) || null : null;
  if (catId && !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(catId)) {
    return fail("CATEGORY_NOT_FOUND", "Categoría no encontrada");
  }
  const n = promosCore.normalizeGroupPromo(promo || {}, catId);
  if (!n.success) return n;
  const wire = catalogCore.refsToUid(db, { ...promo, category_id: catId });
  if (promo.id) {
    const current = db.prepare("SELECT * FROM group_promos WHERE id = ?").get(Number(promo.id));
    if (!current) return fail("PROMO_NOT_FOUND", "Promoción no encontrada");
    const before = pickCols(current, PROMO_COLS);
    return {
      args: [{ ...wire, id: current.id, uid: current.uid || undefined }],
      effect: { rows: [{ table: "group_promos", before, after: { ...before, ...n.values } }] },
      tables: ["group_promos"],
      label: `Promoción editada · ${n.values.name || `${n.values.percent}%`}`,
      result: { id: current.id },
    };
  }
  const uid = crypto.randomUUID();
  const after = catalogCore.provisionalRow(db, "group_promos", n.values, uid);
  return {
    args: [{ ...wire, id: undefined, uid }],
    effect: { rows: [{ table: "group_promos", before: null, after }] },
    tables: ["group_promos"],
    label: `Promoción nueva · ${n.values.name || `${n.values.percent}%`}`,
    result: { id: after.id },
  };
};
const saveBundleOp = (db, [bundle = {}]) => {
  const byId = db.prepare("SELECT id, uid FROM products WHERE id = ?");
  // Los lugares con los ids de ESTA caja (los provisionales también cuentan).
  const localSlots = (Array.isArray(bundle.slots) ? bundle.slots : [])
    .map((s) => ({
      qty: Math.max(1, parseInt(s.qty, 10) || 1),
      productIds: [...new Set((s.productIds || []).map(Number).filter((n) => n && byId.get(n)))],
    }))
    .filter((s) => s.productIds.length > 0);
  const n = promosCore.normalizeBundle(bundle || {}, localSlots);
  if (!n.success) return n;
  const uidOf = (pid) => (pid < 0 ? (byId.get(pid) || {}).uid : undefined);
  // Hacia el Host: lo creado aquí por uid.
  const wireSlots = localSlots.map((s) => ({
    qty: s.qty,
    productIds: s.productIds.filter((pid) => pid > 0),
    productUids: s.productIds.filter((pid) => pid < 0).map(uidOf).filter(Boolean),
  }));
  const after = promosCore.itemsOf(localSlots).map((it) => ({
    slot: it.slot,
    qty: it.qty,
    productId: it.product_id,
    productUid: uidOf(it.product_id),
  }));
  if (bundle.id) {
    const current = db.prepare("SELECT * FROM bundles WHERE id = ?").get(Number(bundle.id));
    if (!current) return fail("BUNDLE_NOT_FOUND", "Paquete no encontrado");
    const before = pickCols(current, BUNDLE_COLS);
    const beforeItems = db
      .prepare("SELECT id, slot, qty, product_id FROM bundle_items WHERE bundle_id = ? ORDER BY id")
      .all(current.id);
    return {
      args: [{ ...bundle, id: current.id, uid: current.uid || undefined, slots: wireSlots }],
      effect: {
        rows: [{ table: "bundles", before, after: { ...before, ...n.values } }],
        items: [{ bundleId: current.id, bundleUid: current.uid || undefined, before: beforeItems, after }],
      },
      tables: ["bundles", "bundle_items"],
      label: `Paquete editado · ${n.values.name}`,
      result: { id: current.id },
    };
  }
  const uid = crypto.randomUUID();
  const row = catalogCore.provisionalRow(db, "bundles", n.values, uid);
  return {
    args: [{ ...bundle, id: undefined, uid, slots: wireSlots }],
    effect: {
      rows: [{ table: "bundles", before: null, after: row }],
      items: [{ bundleId: row.id, bundleUid: uid, before: [], after }],
    },
    tables: ["bundles", "bundle_items"],
    label: `Paquete nuevo · ${n.values.name}`,
    result: { id: row.id },
  };
};
const setBundleActiveOp = (db, [id, active]) => {
  const current = db.prepare("SELECT * FROM bundles WHERE id = ?").get(Number(id));
  if (!current) return fail("BUNDLE_NOT_FOUND", "Paquete no encontrado");
  const before = pickCols(current, BUNDLE_COLS);
  return {
    args: [current.id, !!active, { uid: current.uid || undefined }],
    effect: { rows: [{ table: "bundles", before, after: { ...before, is_active: active ? 1 : 0 } }] },
    tables: ["bundles"],
    label: `Paquete ${active ? "activado" : "pausado"} · ${current.name}`,
    result: {},
  };
};

// Cancelar una venta propia · mismas reglas que el Host (sales-cancel-core).
// Aquí se marca cancelada con sus partidas y el stock vuelve al momento; el
// Host la cancela al subir. Fiado va en línea (el saldo vive en el Host) y una
// venta que aún no sube no se cancela: se quita desde Pendientes.
const SALE_STATE_COLS = ["id", "status", "cancelled_at", "cancelled_by", "cancelled_by_device"];
const cancelSaleOp = (db, [payload = {}]) => {
  const { saleId, cashierName, role } = payload || {};
  const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(Number(saleId));
  if (sale && sale.id < 0) {
    return fail("NOT_YET_ON_HOST", "Esta venta todavía se está guardando en el Host. Intenta cancelarla en unos segundos.");
  }
  if (sale && sale.payment_method === "credit") return { online: true, what: "Cancelar una venta a crédito" };
  const deviceId = activation.getSetting(db, "box_device_id") || null;
  const ok = salesCancelCore.check(db, sale, { role, caller: deviceId });
  if (!ok.success) return ok;
  const at = sqliteNowUtc();
  const by = cashierName || null;
  const mark = (row) => ({ ...pickCols(row, SALE_STATE_COLS) });
  const done = (row) => ({ ...mark(row), status: "cancelado", cancelled_at: at, cancelled_by: by, cancelled_by_device: deviceId });
  const items = db.prepare("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id").all(sale.id);
  const open = items.filter((it) => it.status !== "cancelado");
  return {
    args: [{ ...payload, saleId: sale.id, cancelledAt: at }],
    effect: {
      rows: [
        { table: "sales", before: mark(sale), after: done(sale) },
        ...open.map((it) => ({ table: "sale_items", before: mark(it), after: done(it) })),
      ],
      // Igual que el Host: vuelve todo lo descontado de la venta.
      stock: items
        .filter((it) => it.product_id != null && (Number(it.stock_deducted) || 0) > 0)
        .map((it) => ({ productId: it.product_id, delta: Number(it.stock_deducted) })),
    },
    tables: ["sales", "sale_items", "products"],
    label: `Venta cancelada · ${sale.folio || "#" + sale.id}`,
    result: {},
  };
};

// Devolver un producto (o parte) de una venta propia · mismas reglas y
// cálculo que el Host (sales-cancel-core). Aquí: el renglón con lo devuelto,
// el total de la venta (o la venta cancelada si ya no queda nada) y el stock
// que vuelve. Fiado va en línea.
const ITEM_STATE_COLS = [...SALE_STATE_COLS, "returned_qty"];
const cancelSaleItemOp = (db, [payload = {}]) => {
  const { saleId, itemId, cashierName, role } = payload || {};
  const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(Number(saleId));
  if (sale && sale.id < 0) {
    return fail("NOT_YET_ON_HOST", "Esta venta todavía se está guardando en el Host. Intenta en unos segundos.");
  }
  if (sale && sale.payment_method === "credit") return { online: true, what: "Devolver en una venta a crédito" };
  const item = sale
    ? db.prepare("SELECT * FROM sale_items WHERE id = ? AND sale_id = ?").get(Number(itemId), sale.id)
    : null;
  const deviceId = activation.getSetting(db, "box_device_id") || null;
  const ok = salesCancelCore.checkItem(db, sale, item, { role, caller: deviceId });
  if (!ok.success) return ok;
  const plan = salesCancelCore.planItem(item, payload.quantity);
  if (plan.remaining <= 0) return fail("ALREADY_CANCELLED", "Este producto ya fue cancelado");
  const at = sqliteNowUtc();
  const by = cashierName || null;
  const itemAfter = {
    ...pickCols(item, ITEM_STATE_COLS),
    status: plan.itemStatus,
    returned_qty: plan.newReturned,
    cancelled_at: at,
    cancelled_by: by,
    cancelled_by_device: deviceId,
  };
  const othersActive = db
    .prepare("SELECT COUNT(*) AS c FROM sale_items WHERE sale_id = ? AND id != ? AND (status IS NULL OR status != 'cancelado')")
    .get(sale.id, item.id).c;
  const saleCancelled = othersActive === 0 && plan.itemStatus === "cancelado";
  const saleBefore = { ...pickCols(sale, SALE_STATE_COLS), total: sale.total };
  const saleAfter = saleCancelled
    ? { ...saleBefore, status: "cancelado", cancelled_at: at, cancelled_by: by, cancelled_by_device: deviceId }
    : { ...saleBefore, total: Math.max(0, Math.round((Number(sale.total) - plan.refundAmount) * 100) / 100) };
  return {
    args: [{ ...payload, saleId: sale.id, itemId: item.id, quantity: plan.cancelQty, cancelledAt: at }],
    effect: {
      rows: [
        { table: "sale_items", before: pickCols(item, ITEM_STATE_COLS), after: itemAfter },
        { table: "sales", before: saleBefore, after: saleAfter },
      ],
      stock:
        item.product_id != null && plan.restoreStock > 0
          ? [{ productId: item.product_id, delta: plan.restoreStock }]
          : [],
    },
    tables: ["sales", "sale_items", "products"],
    label: `Devolución · ${item.product_name || "producto"} · ${sale.folio || "#" + sale.id}`,
    result: {
      refundAmount: Number(plan.refundAmount.toFixed(2)),
      cancelledQty: plan.cancelQty,
      isPartial: plan.isPartial,
      saleCancelled,
      itemStatus: plan.itemStatus,
    },
  };
};

const QUEUED_OPS = {
  "cancel-sale": cancelSaleOp,
  "cancel-sale-item": cancelSaleItemOp,
  "save-group-promo": saveGroupPromoOp,
  "save-bundle": saveBundleOp,
  "set-bundle-active": setBundleActiveOp,
  "set-customer-price": setPairOp("customer_prices"),
  "delete-customer-price": deletePairOp("customer_prices"),
  "set-tier-price": setPairOp("tier_prices"),
  "delete-tier-price": deletePairOp("tier_prices"),
  "register-cash-expense": cashOp("out"),
  "register-cash-income": cashOp("in"),
  "add-product": (db, [data = {}]) => {
    if (!String((data && data.name) || "").trim()) return fail("NAME_REQUIRED", "Nombre requerido");
    if (productsCore.barcodeTaken(db, data.barcode)) return fail("BARCODE_TAKEN", productsCore.BARCODE_TAKEN);
    const initial = parseFloat(data.stock) || 0;
    const v = { ...productsCore.values(data), min_stock: productsCore.minStockFor(data, data.stock), is_active: 1 };
    const prices = productsCore.normalizePrices(data.prices);
    const args = [catalogCore.refsToUid(db, data)];
    // Mismo código de un producto dado de baja: el Host lo reactiva con el
    // stock que se capture; aquí se llega al mismo número con un delta.
    const old = db.prepare("SELECT * FROM products WHERE barcode = ?").get(data.barcode);
    if (old) {
      const before = pickProduct(old);
      return {
        args,
        effect: {
          rows: [{ table: "products", before, after: { ...before, ...v } }],
          prices: [{ productId: old.id, before: pricesOf(db, old.id), after: prices }],
          stock: [{ productId: old.id, delta: initial - (Number(old.stock) || 0) }],
        },
        tables: ["products", "product_prices"],
        label: `Producto reactivado · ${v.name}`,
        result: { id: old.id, overwritten: true },
      };
    }
    const uid = crypto.randomUUID();
    const after = catalogCore.provisionalRow(db, "products", v, uid);
    args[0] = { ...args[0], uid };
    return {
      args,
      effect: {
        rows: [{ table: "products", before: null, after }],
        prices: [{ productId: after.id, productUid: uid, before: [], after: prices }],
        stock: initial ? [{ productId: after.id, productUid: uid, delta: initial }] : [],
      },
      tables: ["products", "product_prices"],
      label: `Producto nuevo · ${v.name}`,
      result: { id: after.id },
    };
  },
  // Sólo sin `stock` (forward manda al Host la edición con cantidad exacta).
  // Sin `stock`, o con stock exacto en un producto creado aquí que el Host aún
  // no tiene (ese stock viaja como diferencia: nadie más pudo venderlo).
  "update-product": (db, [id, data = {}]) => {
    if (!data || !String(data.name || "").trim()) return fail("NAME_REQUIRED", "Nombre requerido");
    const current = localProduct(db, id);
    if (!current) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
    if (productsCore.barcodeTaken(db, data.barcode, current.id)) {
      return fail("BARCODE_TAKEN", productsCore.BARCODE_TAKEN_OTHER);
    }
    const before = pickProduct(current);
    const hasStock = "stock" in data && Number.isFinite(parseFloat(data.stock));
    const delta = hasStock ? parseFloat(data.stock) - (Number(current.stock) || 0) : 0;
    const newStock = hasStock ? parseFloat(data.stock) : current.stock;
    const v = {
      ...productsCore.values(data, current),
      min_stock: productsCore.minStockFor(data, newStock),
      is_active: data.is_active !== undefined ? data.is_active : 1,
    };
    const { stock: _exact, ...wire } = catalogCore.refsToUid(db, data);
    return {
      args: [current.id, { ...wire, ...(delta ? { stock_delta: delta } : {}), uid: current.uid || undefined }],
      effect: {
        ...(delta ? { stock: [{ productId: current.id, productUid: current.uid || undefined, delta }] } : {}),
        rows: [{ table: "products", before, after: { ...before, ...v } }],
        prices: [
          {
            productId: current.id,
            productUid: current.uid || undefined,
            before: pricesOf(db, current.id),
            after: productsCore.normalizePrices(data.prices),
          },
        ],
      },
      tables: ["products", "product_prices"],
      label: `Producto editado · ${v.name}`,
      result: {},
    };
  },
  "add-category": catalogAdd("categories", "Categoría"),
  "update-category": catalogUpdate("categories", "Categoría"),
  "add-supplier": catalogAdd("suppliers", "Proveedor"),
  "update-supplier": catalogUpdate("suppliers", "Proveedor"),
  "add-stock": (db, [payload = {}]) => {
    const product = localProduct(db, payload.productId);
    if (!product) return fail("PRODUCT_NOT_FOUND", "Producto no encontrado");
    const qty = parseQty(product, payload.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return fail(
        "INVALID_QUANTITY",
        product.sale_unit === "weight" ? "Cantidad no válida" : "Cantidad no válida. Solo números enteros.",
      );
    }
    if (productsCore.stockEntryNeedsConfirmation(qty, product.barcode, payload.enteredQuantity) &&
        payload.confirmedStockQuantity !== true) {
      return fail("STOCK_QUANTITY_CONFIRMATION", "Revisa y confirma la cantidad. Podría ser un código de barras.");
    }
    return {
      args: [{ ...payload, productId: product.id, ...productRef(product) }],
      effect: { stock: [{ productId: product.id, ...productRef(product), delta: qty }] },
      label: `Entrada de ${qty} · ${product.name}`,
      result: { productName: product.name },
    };
  },
  "remove-stock": (db, [payload = {}]) => {
    if (payload.role !== "admin") {
      return fail("FORBIDDEN", "Solo el propietario puede hacer salidas de stock");
    }
    const product = localProduct(db, payload.productId);
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
      args: [{ ...payload, productId: product.id, ...productRef(product) }],
      effect: { stock: [{ productId: product.id, ...productRef(product), delta: -qty }] },
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
    const product = db.prepare("SELECT name, barcode, sale_unit FROM products WHERE id = ?").get(p.productId) || {};
    if (term && !String(product.name || "").toLowerCase().includes(term) && !String(product.barcode || "").includes(term)) continue;
    extra.push({
      id: `op-${o.id}`,
      product_id: p.productId,
      product_name: product.name || "—",
      barcode: product.barcode || null,
      sale_unit: product.sale_unit,
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

// Lecturas de ventas: las que la caja hizo y el Host aún no confirma llevan
// id negativo y se marcan "pendiente" (ver sales-local.markPending).
const SALE_READ_CHANNELS = new Set([
  "get-sales-for-today",
  "get-sales-by-date",
  "get-sales-by-range",
  "get-sale-details",
  "find-sales-by-folio",
  "get-register-sales-detail",
]);

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
  if (prepared && (prepared.success === false || prepared.online)) return prepared;
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
  const send = (row) =>
    rpcCall(db, row.channel, row.args, null, { idempotencyKey: row.idempotencyKey }).then((r) =>
      // Ya la cancelaron en el Host (el administrador): quedó como se quería.
      (row.channel === "cancel-sale" || row.channel === "cancel-sale-item") && r && r.code === "ALREADY_CANCELLED"
        ? { success: true }
        : r,
    );
  let out = await opQueue.sync(db, send);
  // Si se unió a una subida que ya iba en curso, lo encolado después no estaba
  // en esa vuelta: se sube ahora, en orden, mientras el Host siga contestando.
  for (let i = 0; i < 5 && out.success && opQueue.list(db, [opQueue.STATUS.PENDING]).length; i++) {
    const next = await opQueue.sync(db, send);
    out = { ...next, synced: out.synced + next.synced, conflicts: out.conflicts + next.conflicts };
  }
  if (out.synced || out.conflicts) {
    opsChanged([
      "sales",
      "sale_items",
      "products",
      "product_prices",
      "stock_movements",
      "customers",
      "categories",
      "suppliers",
      "cash_register",
      "cash_register_expenses",
      "customer_prices",
      "tier_prices",
      "group_promos",
      "bundles",
      "bundle_items",
    ]);
  }
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
// Cuánto estuvo trabado el proceso de ESTA caja desde la medición anterior.
// Un `netMs` alto con `boxLagMs` bajo es la red; con `boxLagMs` alto, la caja.
let boxLag = null;
const takeBoxLagMs = () => {
  try {
    if (!boxLag) {
      boxLag = require("perf_hooks").monitorEventLoopDelay({ resolution: 20 });
      boxLag.enable();
      return null;
    }
    const ms = Math.round(boxLag.max / 1e6);
    boxLag.reset();
    return ms;
  } catch (err) {
    return null;
  }
};
const recordTiming = (entry) => {
  entry.boxLagMs = takeBoxLagMs();
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

// 401 del Host = la sesión CON LA QUE SE MANDÓ ya no sirve: se borra y el
// renderer la pide. Sólo si sigue siendo la actual: una respuesta que salió
// sin sesión (el login local-first aún la estaba pidiendo) o con la del login
// anterior no puede tirar la que acaba de llegar. Antes la borraba y desde ahí
// todo pedía "sesión expirada".
const expired = (db, data, creds = null) => {
  const sent = creds ? creds.sessionToken || "" : null;
  if (sent === null || (clientLink.readSessionToken(db) || "") === sent) {
    clientLink.clearSessionToken(db);
  }
  return fail("SESSION_EXPIRED", (data && data.error) || "La sesión expiró en el Host");
};

// Login local-first: se entra al momento y la sesión del Host llega en
// segundo plano. Lo que salga hacia el Host en ese rato la espera en vez de
// viajar sin sesión (abrir caja justo después de entrar daba 401).
let loginInFlight = null;
const waitForLogin = async (db) => {
  if (!loginInFlight || clientLink.readSessionToken(db)) return;
  await loginInFlight;
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

// Local-first · la venta se escribe al momento en la copia de la caja (mismo
// código que el Host) y en la cola, en UNA transacción, y sube en segundo
// plano. El cobro no espera a la red aunque el Host esté conectado.
const recordSaleLocal = (db, payload) => {
  const deviceId = activation.getSetting(db, "box_device_id") || null;
  let row;
  let written;
  try {
    written = db.transaction(() => {
      row = {
        folio: nextBoxFolio(db),
        payload,
        idempotencyKey: crypto.randomUUID(),
        registerId: payload.registerId,
        cashierId: payload.cashierId,
        cashierName: payload.cashierName,
        localCreatedAt: new Date().toISOString(),
      };
      // Las mismas reglas del Host: si la venta no es válida, no se cobra.
      const out = salesLocal.writeLocalSale(db, row, deviceId);
      offlineQueue.enqueue(db, row);
      clearAttempt(db);
      return out;
    })();
  } catch (err) {
    return fail((err && err.code) || "SALE_FAILED", (err && err.message) || "No se pudo registrar la venta");
  }
  opsChanged(["sales", "products"]);
  syncPending(db).catch(() => {});
  return {
    success: true,
    pending: true,
    // Sólo avisa "sin conexión" cuando de verdad no la hay.
    offline: hostKnownDown(db) || replicaLive.liveState(db).state !== "connected",
    saleId: written.saleId,
    folio: written.folio,
    warnings: written.warnings,
  };
};

// POST /api/sales · la venta viaja con Idempotency-Key; el cajero que la firma
// lo decide el token de sesión, no el payload (3a.i).
const recordSale = async (db, payload = {}) => {
  // Producto creado aquí que el Host aún no conoce: la partida lleva su uid
  // (y su código, por si el Host ya tenía ese código con otro producto).
  if (Array.isArray(payload.cart) && payload.cart.some((it) => it && Number(it.id) < 0)) {
    const byId = db.prepare("SELECT uid, barcode FROM products WHERE id = ?");
    payload = {
      ...payload,
      cart: payload.cart.map((it) => {
        if (!it || !(Number(it.id) < 0) || it.product_uid) return it;
        const row = byId.get(Number(it.id));
        return row && row.uid ? { ...it, product_uid: row.uid, product_barcode: row.barcode } : it;
      }),
    };
  }
  if (Number(payload.customerId) < 0) {
    const provisional = db.prepare("SELECT uid FROM customers WHERE id = ?").get(Number(payload.customerId));
    if (provisional && provisional.uid) payload = { ...payload, customerUid: provisional.uid };
  }
  if (!credentials(db).hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  // Fiado sigue en línea (saldo y límite viven en el Host). Sin copia local
  // completa todavía, el camino de siempre.
  if (payload.paymentMethod !== "credit" && localReady(db)) return recordSaleLocal(db, payload);
  await waitForLogin(db);
  const creds = credentials(db);

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
      expired(db, cres.data, creds);
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
        expired(db, cres.data, creds);
        return fail("SESSION_EXPIRED", "La sesión con el Host caducó");
      }
      adoptHostFolioSeq(db, cres.data);
    }
    if (cres.data.success) clearAttempt(db);
    return cres.data;
  }
  // Cliente creado en la caja que el Host aún no conoce: la venta va a la cola
  // con su uid y sube después del alta (syncPending sube antes las operaciones).
  if (payload.customerUid || (Array.isArray(payload.cart) && payload.cart.some((it) => it && it.product_uid))) {
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
    expired(db, res.data, creds);
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
      if (res.status === 401) expired(db, res.data, creds);
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
  await waitForLogin(db);
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
  // Cada login revoca en el Host la sesión anterior de esta caja: si dos se
  // cruzan (el de fondo y el del aviso de sesión), sólo se guarda el último.
  const seq = ++loginSeq;
  sessionCashierId = Number(id);
  const out = await hostLogin(db, creds, id, pin, TIMEOUT_MS, () => seq === loginSeq);
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
  const pending = hostLogin(db, credentials(db), id, pin, TIMEOUT_MS, () => seq === loginSeq).catch(() => {});
  loginInFlight = pending;
  pending.finally(() => {
    if (loginInFlight === pending) loginInFlight = null;
  });
  return { success: true, cashier: local.cashier, warning: local.warning, stale_ms: local.stale_ms };
};

// ── Estado de caja cacheado (para vender sin Host) ──────────────────────────
const REGISTER_CACHE_KEY = "last_register_snapshot";
const TAECEL_CATALOG_KEY = "taecel_catalog_last";
const TAECEL_CATALOG_AT_KEY = "taecel_catalog_last_at";
// Se renueva por detrás si el guardado tiene más de esto.
const TAECEL_CATALOG_FRESH_MS = 30 * 60 * 1000;
let taecelCatalogInFlight = null;
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

const CLOSE_SYNC_WAIT_MS = 5000;
const closeWhenQueueEmpty = async (db) => {
  if (opQueue.countOpen(db) > 0 || offlineQueue.countBlocking(db) > 0) {
    await Promise.race([
      (async () => {
        await syncOps(db).catch(() => {});
        await syncPending(db).catch(() => {});
      })(),
      new Promise((r) => setTimeout(r, CLOSE_SYNC_WAIT_MS)),
    ]);
  }
  const pendingOps = opQueue.countOpen(db);
  if (pendingOps > 0) {
    return fail(
      "PENDING_OPS",
      `Hay ${pendingOps} movimiento(s) de inventario sin subir al Host. Espera a que se sincronicen antes de cerrar caja.`,
    );
  }
  const pending = offlineQueue.countBlocking(db);
  if (pending > 0) {
    return fail(
      "PENDING_SALES",
      `Hay ${pending} venta(s) pendiente(s) de sincronizar. Conecta el Host y espera a que suban antes de cerrar caja.`,
    );
  }
  return null;
};

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
      if (r && r.success && !r.pending) settleWrite(db).catch(() => {});
      return r;
    });
  }
  // Catálogo de Taecel (compañías y montos): la caja guarda el último que le
  // dio el Host y lo enseña si el Host no contesta o pide sesión. Recargar
  // sigue siendo del Host; esto sólo evita la pantalla vacía.
  // Pesa ~1.6 MB: con el que ya tiene y es reciente se contesta al momento y
  // se renueva por detrás (en la Caja 2 bajarlo tardaba hasta 28 s).
  if (channel === "taecel:get-catalog") {
    const readSaved = () => {
      try {
        const saved = JSON.parse(activation.getSetting(db, TAECEL_CATALOG_KEY) || "null");
        return saved && saved.ok ? saved : null;
      } catch (err) {
        return null;
      }
    };
    const fetchFresh = () => {
      if (!taecelCatalogInFlight) {
        taecelCatalogInFlight = rpcCall(db, channel, args)
          .then((r) => {
            if (r && r.ok) {
              try {
                activation.setSetting(db, TAECEL_CATALOG_KEY, JSON.stringify(r));
                activation.setSetting(db, TAECEL_CATALOG_AT_KEY, String(Date.now()));
              } catch (err) {}
            }
            return r;
          })
          .finally(() => {
            taecelCatalogInFlight = null;
          });
      }
      return taecelCatalogInFlight;
    };
    const saved = readSaved();
    const savedAt = Number(activation.getSetting(db, TAECEL_CATALOG_AT_KEY) || 0);
    // `fresh` evita la caché de la caja sin forzar una descarga desde Taecel.
    const bypassLocalCache = !!(args[0] && (args[0].force || args[0].fresh));
    if (saved && !bypassLocalCache) {
      if (Date.now() - savedAt > TAECEL_CATALOG_FRESH_MS) fetchFresh().catch(() => {});
      return Promise.resolve(saved);
    }
    return fetchFresh().then((r) => {
      if (r && r.ok) return r;
      const fallback = readSaved();
      return fallback ? { ...fallback, stale: true, staleReason: (r && (r.error || r.code)) || null } : r;
    });
  }
  if (channel === "touch-customer" && localReady(db)) {
    const local = runLocal(db, channel, args);
    if (Number(args[0]) > 0) rpcCall(db, channel, args).catch(() => {});
    return Promise.resolve(local || { success: true });
  }
  // Editar un producto fijando su stock a una cantidad exacta es del Host (una
  // cantidad exacta pisaría lo que otra caja vendió): va en línea.
  // Excepción: un producto creado aquí que el Host aún no tiene. Nadie más
  // pudo venderlo, así que su stock exacto se manda como diferencia (cola).
  const editedHere =
    channel === "update-product" && localReady(db) && onlyHere(db, localProduct(db, args[0]));
  const exactStock =
    channel === "update-product" && !editedHere && !!args[1] && typeof args[1] === "object" && "stock" in args[1];
  if (channel === "add-stock" && args[0]?.registerExpense === true && localReady(db)) {
    // El cajón se abre en esta caja al recibir la confirmación del gasto.
    const prepared = QUEUED_OPS[channel](db, args);
    if (prepared.success === false) return Promise.resolve(prepared);
    return syncOps(db)
      .catch(() => {})
      .then(() => rpcCall(db, channel, prepared.args, null, { idempotencyKey: crypto.randomUUID() }))
      .then((result) =>
        result?.code === "HOST_UNREACHABLE" ? HOST_REQUIRED("Registrar el pago de mercancía") : result,
      );
  }
  if (QUEUED_OPS[channel] && localReady(db) && !exactStock) {
    const out = enqueueOp(db, channel, args);
    if (!(out && out.online)) return Promise.resolve(out);
    // Lo que no puede ir en cola (p. ej. cancelar fiado) va al Host.
    return rpcCall(db, channel, args).then((r) =>
      r && r.code === "HOST_UNREACHABLE" ? HOST_REQUIRED(out.what || "Esta operación") : r,
    );
  }
  // En línea con referencias a lo creado aquí (categoría, proveedor, el propio
  // producto): primero sube lo que está en cola y viaja por uid.
  if (channel === "add-product" || channel === "update-product") {
    const i = channel === "add-product" ? 0 : 1;
    let data = catalogCore.refsToUid(db, args[i]);
    if (exactStock && Number(args[0]) < 0) {
      const row = db.prepare("SELECT uid FROM products WHERE id = ?").get(Number(args[0]));
      if (row && row.uid) data = { ...data, uid: row.uid };
    }
    const next = [...args];
    next[i] = data;
    const call =
      data !== args[i]
        ? syncOps(db)
            .catch(() => {})
            .then(() => rpcCall(db, channel, next))
        : rpcCall(db, channel, args);
    return call.then((r) => {
      if (exactStock && r && r.code === "HOST_UNREACHABLE") {
        return HOST_REQUIRED("Cambiar el stock a una cantidad exacta");
      }
      return r;
    });
  }
  // Borrar es del Host: lo que aún no llega allá no se puede borrar todavía.
  if (
    ["delete-category", "delete-supplier", "delete-product", "delete-group-promo", "delete-bundle"].includes(channel) &&
    Number(args[0]) < 0
  ) {
    return Promise.resolve(
      fail("NOT_YET_ON_HOST", "Todavía se está guardando en el Host. Intenta borrarlo en unos segundos."),
    );
  }
  if (LOCAL_READ_CHANNELS.has(channel) && localReady(db)) {
    const local = runLocal(db, channel, args);
    if (local) {
      return Promise.resolve(local).then((r) => {
        if (channel === "get-cash-register-status" && r && r.success) cacheRegister(db, r);
        if (channel === "get-stock-movements" && Array.isArray(r)) return withPendingMovements(db, r, args[0]);
        if (SALE_READ_CHANNELS.has(channel)) return salesLocal.markPending(db, r);
        return r;
      });
    }
  }
  // Cerrar caja exige que la cola esté vacía (decisión de negocio).
  // Antes se sube lo que quede (local-first: lo recién cobrado suele estar
  // subiendo todavía) y sólo si algo se atora se avisa.
  if (channel === "close-cash-register") {
    return closeWhenQueueEmpty(db).then((blocked) => blocked || rpcCall(db, channel, args));
  }
  if (
    channel === "delete-cash-expense" &&
    Number(args[0] && typeof args[0] === "object" ? args[0].expenseId : args[0]) < 0
  ) {
    // Cancelar es del Host: un retiro que aún no llega allá no se manda.
    return Promise.resolve(
      fail("NOT_YET_ON_HOST", "Este movimiento todavía se está guardando en el Host. Intenta cancelarlo en unos segundos."),
    );
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
  if (!credentials(db).hostUrl) return fail("NO_HOST_LINKED", "La caja no tiene Host configurado");
  // Sin Host, una lectura no vale 8 s de espera: falla al momento.
  if (READ_CHANNEL_RE.test(channel) && hostKnownDown(db)) {
    return fail("HOST_UNREACHABLE", "El Host no responde");
  }
  await waitForLogin(db);
  let creds = credentials(db);
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
  // Salió con una sesión que ya cambió (llegó la del login nuevo mientras
  // viajaba): una vez más con la actual antes de pedir el PIN.
  if (res.status === 401 && (clientLink.readSessionToken(db) || "") !== (creds.sessionToken || "")) {
    creds = credentials(db);
    try {
      res = await postJson(db, creds, "/api/rpc", { channel, args }, headers, timeoutMs || RPC_TIMEOUTS[channel] || TIMEOUT_MS);
    } catch (err) {
      return unreachable(err);
    }
    if (!res.data) return fail("HOST_UNREACHABLE", "El Host no contestó");
  }
  if (res.status === 401) return expired(db, res.data, creds);
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
  reapplyPendingPrices: (db) => opQueue.reapplyPrices(db),
  reapplyPendingAdds: (db, table, ids) => opQueue.reapplyAdds(db, table, ids),
  reapplyPendingPairs: (db) => opQueue.reapplyPairs(db),
  reapplyPendingBundleItems: (db) => opQueue.reapplyBundleItems(db),
  relinkSaleProducts: (db) => salesLocal.relinkProducts(db),
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
  pendingCancel: (db, id) => {
    const row = offlineQueue.get(db, id);
    const out = offlineQueue.cancel(db, id);
    if (out.success && row) {
      salesLocal.removeLocalSale(db, row.folio);
      opsChanged(["sales", "products"]);
    }
    return out;
  },
  // Réplica · lo provisional de ventas se mantiene encima de lo del Host.
  rematerializeSales: (db, log) => {
    const deviceId = activation.getSetting(db, "box_device_id") || null;
    return salesLocal.rematerialize(db, deviceId, log);
  },
  dropOrphanSaleItems: (db) => salesLocal.dropOrphanItems(db),
  reapplyPendingSales: (db, productIds) => salesLocal.reapplyStock(db, productIds),
  pendingRetry: (db) => offlineQueue.retryConflicts(db),
};
