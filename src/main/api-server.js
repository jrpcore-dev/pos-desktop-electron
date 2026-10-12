const express = require("express");
const crypto = require("crypto");
const { verifyPin } = require("./pins");
const activation = require("./activation");
const scopeDefs = require("./scopes");
const salesCore = require("./sales-core");
const dbSchema = require("./db-schema");
const protocol = require("./protocol");
const { createChangeStream } = require("./change-stream");

// Serialización canónica para la huella de idempotencia (Entrega 2c-B):
// claves ordenadas en cada nivel, arrays en orden y tipos JSON normales, para
// que el mismo payload con el orden de campos cambiado produzca el mismo hash.
const canonicalStringify = (value) => {
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
};
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const TOKEN_TTL_MS = (() => {
  const v = Number(process.env.API_TOKEN_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : 10 * 60 * 60 * 1000;
})();
const MAX_LOGIN_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();

let server = null;
// 3e · túnel SSE Host → caja. Vive con el servidor: startServer lo crea y
// stopServer lo cierra, así que no puede quedar un sonda huérfano entre pruebas.
let changeStream = null;
// 3b · throttle de last_used_at: se escribe como mucho una vez cada 5 minutos.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
const authAttempts = new Map(); // { cashierId: { count, windowStart } }
const pairAttempts = new Map(); // { deviceId: { count, windowStart } }

// 3b · poda de sesiones vencidas al arrancar el servidor.
const purgeExpiredSessions = (db) => {
  try {
    db.prepare("DELETE FROM box_sessions WHERE expires_at <= ?").run(Date.now());
  } catch (err) {
    // Tabla ausente en BDs de entregas anteriores: se crea en la migración.
  }
};

const pruneAttempts = (now) => {
  for (const [k, e] of authAttempts) {
    if (now - e.windowStart >= RATE_WINDOW_MS) authAttempts.delete(k);
  }
  for (const [k, e] of pairAttempts) {
    if (now - e.windowStart >= activation.PAIR_RATE_WINDOW_MS) pairAttempts.delete(k);
  }
};

// Middleware de scope sobre el emparejamiento (Entrega 2b).
//
// - Scopes NUEVOS (sales/register/events/backup, Bloques 2c-3): el
//   emparejamiento es obligatorio SIEMPRE, aunque el candado esté apagado.
// - Scopes LEGADOS (catalog/stock, set móvil actual): con el candado apagado o
//   en gracia se comportan EXACTAMENTE como hoy (sin exigir scopes).
//   Con el candado encendido exigen estar emparejado y tener el scope.
const makeRequireScope = (db) => (scope) => (req, res, next) => {
  const deviceId = req.headers["x-device-id"];
  const deviceToken = req.headers["x-device-token"];
  const isNew = scopeDefs.isNewScope(scope);

  if (isNew) {
    if (!activation.isPaired(db, deviceId, deviceToken)) {
      return res.status(403).json({
        success: false,
        needsActivation: true,
        error: "Este dispositivo no está activado para este negocio",
      });
    }
  } else if (activation.isEnabled(db) && !activation.graceActive(db)) {
    if (!activation.isPaired(db, deviceId, deviceToken)) {
      return res.status(403).json({
        success: false,
        needsActivation: true,
        error: "Este dispositivo no está activado para este negocio",
      });
    }
  } else {
    // Candado apagado (o ventana de gracia): set legado idéntico a hoy.
    return next();
  }

  const info = activation.deviceScopes(db, deviceId);
  if (!info.ok || !scopeDefs.scopeAllowed(info.scopes, scope)) {
    return res.status(403).json({
      success: false,
      error: `Permiso insuficiente para ${scope}`,
      scopeRequired: scope,
    });
  }
  req.deviceId = deviceId;
  return next();
};

const startServer = async (db, port = 3456, { appVersion } = {}) => {
  if (server) return { success: true, port };

  const app = express();
  app.use(express.json());
  // 3c · versión del build, para /api/activation/info.
  const APP_VERSION = appVersion || process.env.npm_package_version || "0.0.0";

  // 3a.i · el gasto de recepción de inventario se pega a la caja del Host.
  const hostDeviceId = dbSchema.ensureHostDeviceId(db);

  // Purga de claves de idempotencia viejas (> 7 días) y sesiones vencidas.
  try {
    db.prepare("DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-7 days')").run();
  } catch (err) {
    // Tabla ausente en BDs de entregas anteriores: se crea en la migración.
  }
  purgeExpiredSessions(db);

  const safe = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("API error:", err.message);
      res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
  };

  // ─── CANDADO DE ACTIVACIÓN POR NEGOCIO ─────────────────────────────
  // 3b · la sesión vive en la BD: el token se hashea (sha256) y se busca por
  // hash. Mismo contrato para todos los tipos de dispositivo: 401 si no existe,
  // si está revocado o si venció; 403 es solo de scope/emparejamiento.
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ success: false, error: "No autorizado" });
    const row = db
      .prepare("SELECT * FROM box_sessions WHERE token_hash = ?")
      .get(activation.hashToken(token));
    if (!row || row.revoked) {
      return res.status(401).json({ success: false, error: "No autorizado" });
    }
    const now = Date.now();
    if (row.expires_at <= now) {
      db.prepare("DELETE FROM box_sessions WHERE token_hash = ?").run(row.token_hash);
      return res.status(401).json({ success: false, error: "Sesión expirada" });
    }
    if (!row.last_used_at || now - row.last_used_at >= LAST_USED_THROTTLE_MS) {
      db.prepare("UPDATE box_sessions SET last_used_at = ? WHERE token_hash = ?").run(
        now,
        row.token_hash,
      );
    }
    req.cashierId = row.cashier_id;
    req.sessionDeviceId = row.device_id;
    next();
  };

  // Un dispositivo debe estar emparejado antes de usar la app. Con el candado
  // apagado (clientes existentes) o durante la ventana de gracia, no bloquea:
  // la migración es transparente y los teléfonos en uso se auto-emparejan.
  const requirePaired = (req, res, next) => {
    if (!activation.isEnabled(db)) return next();
    if (activation.graceActive(db)) return next();
    const deviceId = req.headers["x-device-id"];
    const deviceToken = req.headers["x-device-token"];
    if (activation.isPaired(db, deviceId, deviceToken)) {
      req.deviceId = deviceId;
      return next();
    }
    return res.status(403).json({
      success: false,
      needsActivation: true,
      error: "Este dispositivo no está activado para este negocio",
    });
  };

  // La sonda de descubrimiento (/api/auth con pin "probe") queda pública:
  // es parte de la detección del servidor, no un acceso real.
  const requirePairedExceptProbe = (req, res, next) => {
    if (!req.body || !req.body.id) return next();
    return requirePaired(req, res, next);
  };

  const requireScope = makeRequireScope(db);
  const protect = (scope) => [requireAuth, requireScope(scope)];

  // 3d · autenticación de la CAJA por su token de emparejamiento. Una caja no
  // inicia sesión de cajero (no tiene PIN en ese rol): su identidad es el
  // emparejamiento con el Host. Se exige SIEMPRE, aunque el candado de
  // activación esté apagado, y además el dispositivo debe estar aprobado.
  const requirePairedApproved = (req, res, next) => {
    const deviceId = req.headers["x-device-id"];
    const deviceToken = req.headers["x-device-token"];
    if (!activation.isPaired(db, deviceId, deviceToken)) {
      return res.status(403).json({
        success: false,
        needsActivation: true,
        error: "Este dispositivo no está activado para este negocio",
      });
    }
    const info = activation.deviceScopes(db, deviceId);
    if (!info.ok || info.approved !== true) {
      return res.status(403).json({
        success: false,
        code: "NOT_APPROVED",
        error: "El dispositivo está pendiente de aprobación en el Host",
      });
    }
    req.deviceId = deviceId;
    req.deviceScopes = info.scopes;
    next();
  };

  // Misma comprobación de scope, pero resolviendo contra los scopes del
  // dispositivo emparejado (no contra la sesión de cajero).
  const requireDeviceScope = (scope) => (req, res, next) => {
    if (!scopeDefs.scopeAllowed(req.deviceScopes || [], scope)) {
      return res.status(403).json({
        success: false,
        scopeRequired: scope,
        error: "El dispositivo no tiene el scope necesario",
      });
    }
    next();
  };

  const protectBox = (scope) => [requirePairedApproved, requireDeviceScope(scope)];

  app.post("/api/auth", requirePairedExceptProbe, safe((req, res) => {
    const { id, pin } = req.body;

    // Ping de descubrimiento/reconexión del móvil: SOLO comprueba conectividad.
    // No autentica, no emite token y queda fuera del rate limit. No se toca.
    if (!id && pin === "probe") return res.json({ success: true, cashier: null });

    if (!id || !pin) return res.status(400).json({ success: false, error: "ID y PIN requeridos" });

    const now = Date.now();
    pruneAttempts(now);

    const attempt = authAttempts.get(String(id));
    if (
      attempt &&
      now - attempt.windowStart < RATE_WINDOW_MS &&
      attempt.count >= MAX_LOGIN_ATTEMPTS
    ) {
      return res
        .status(429)
        .json({ success: false, error: "Demasiados intentos. Intenta de nuevo en 15 minutos." });
    }

    const cashier = db
      .prepare("SELECT id, name, role, pin, pin_hash, pin_salt FROM cashiers WHERE id = ? AND is_active = 1")
      .get(Number(id));
    const ok =
      cashier &&
      (cashier.pin_hash && cashier.pin_salt
        ? verifyPin(pin, cashier.pin_salt, cashier.pin_hash)
        : cashier.pin === pin);

    if (!ok) {
      const e = attempt || { count: 0, windowStart: now };
      if (now - e.windowStart >= RATE_WINDOW_MS) {
        e.count = 0;
        e.windowStart = now;
      }
      e.count += 1;
      if (e.count >= MAX_LOGIN_ATTEMPTS) e.windowStart = now;
      authAttempts.set(String(id), e);
      return res.status(401).json({ success: false, error: "PIN inválido" });
    }

    authAttempts.delete(String(id));

    // 3b · el token (32 bytes) viaja en claro una sola vez; en la BD solo
    // queda su SHA-256, nunca el valor crudo.
    purgeExpiredSessions(db);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = activation.hashToken(token);
    const devId = req.headers["x-device-id"];
    if (devId) {
      // Un login nuevo cierra la sesión anterior de esa misma (caja, dispositivo).
      db.prepare(
        "UPDATE box_sessions SET revoked = 1 WHERE cashier_id = ? AND device_id = ? AND revoked = 0",
      ).run(cashier.id, devId);
    }
    let deviceType = (req.body && req.body.deviceType) || null;
    try {
      const paired = devId
        ? db.prepare("SELECT device_type FROM paired_devices WHERE device_id = ?").get(devId)
        : null;
      if (paired && paired.device_type) deviceType = paired.device_type;
    } catch (err) {
      // paired_devices ausente: el tipo queda desconocido, no bloquea el login.
    }
    db.prepare(
      `INSERT INTO box_sessions (token_hash, cashier_id, device_id, device_type, created_at, expires_at, last_used_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(tokenHash, cashier.id, devId || null, deviceType, now, now + TOKEN_TTL_MS, now);

    // Auto-emparejamiento silencioso durante la ventana de gracia (única ruta
    // de migración): el PIN correcto ya era el acceso, así que no se pide el
    // código a los dispositivos que ya están en uso. Emite el token del
    // dispositivo para que el teléfono lo recuerde y siga entrando después.
    let pairedToken = null;
    const deviceId = req.headers["x-device-id"];
    if (deviceId) {
      const auto = activation.autoPairIfGrace(db, deviceId, cashier.id, cashier.name);
      if (auto && auto.status === "paired") pairedToken = auto.pairedToken;
    }

    res.json({
      success: true,
      token,
      pairedToken,
      cashier: { id: cashier.id, name: cashier.name, role: cashier.role },
    });
  }));

  app.get("/api/cashiers", requireScope(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const cashiers = db.prepare("SELECT id, name, is_active FROM cashiers ORDER BY name").all();
    res.json({ success: true, cashiers });
  }));

  // Detalle completo de cajeros: solo con token válido.
  app.get("/api/cashiers/full", protect(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const cashiers = db.prepare("SELECT id, name, role, is_active FROM cashiers ORDER BY name").all();
    res.json({ success: true, cashiers });
  }));

  // IMPORTANT: /search must come BEFORE :barcode or Express matches "search" as barcode
  app.get("/api/products/search", protect(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 1) return res.json({ success: true, products: [] });

    const term = `%${nomarize(q.trim())}%`;
    const rawTerm = `%${q.trim()}%`;
    const products = db.prepare(`
      SELECT id, barcode, name, price, stock, cost_price, sale_unit, min_stock, box_qty, box_price
      FROM products
      WHERE (nomar(name) LIKE ? OR barcode LIKE ?) AND is_active = 1
      ORDER BY name LIMIT 30
    `).all(term, rawTerm);

    res.json({ success: true, products });
  }));

  app.get("/api/products/:barcode", protect(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const product = db.prepare(`
      SELECT p.*, c.name as category_name, s.name as supplier_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.barcode = ? AND p.is_active = 1
    `).get(req.params.barcode);

    if (!product) return res.status(404).json({ success: false, error: "Producto no encontrado" });
    res.json({ success: true, product });
  }));

  app.post("/api/products", protect(scopeDefs.SCOPE.CATALOG_WRITE), safe((req, res) => {
    const { barcode, name, cost_price, price, sale_unit, category_id, min_stock, stock, box_qty, box_price } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Nombre requerido" });

    const exists = db.prepare("SELECT id FROM products WHERE barcode = ?").get(barcode);
    if (exists) return res.status(409).json({ success: false, error: "Ya existe un producto con ese código" });

    const stockNum = parseInt(stock) || 0;
    const minStock =
      parseInt(min_stock) > 0
        ? parseInt(min_stock)
        : Math.max(1, Math.floor(stockNum * 0.4));

    const result = db.prepare(`
      INSERT INTO products (barcode, name, cost_price, price, sale_unit, stock, category_id, min_stock, is_active, box_qty, box_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      barcode || null,
      name.trim(),
      cost_price || 0,
      price || 0,
      sale_unit || "piece",
      stockNum,
      category_id || null,
      minStock,
      parseInt(box_qty) || 0,
      parseFloat(box_price) || 0
    );

    const product = db.prepare("SELECT id, barcode, name, price, stock, cost_price, sale_unit, box_qty, box_price FROM products WHERE id = ?").get(result.lastInsertRowid);
    res.json({ success: true, product, message: "Producto registrado correctamente" });
  }));

  app.patch("/api/products/:id/stock", protect(scopeDefs.SCOPE.STOCK_WRITE), safe((req, res) => {
    const { quantity, notes, cost, supplierId, registerExpense, updateCostPrice } = req.body;
    const id = parseInt(req.params.id);

    const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(id);
    if (!product) return res.status(404).json({ success: false, error: "Producto no encontrado" });

    // Validación estricta: número finito > 0; entero salvo unidades de peso.
    const qty = Number(quantity);
    const isWeight = product.sale_unit === "weight";
    const valid =
      Number.isFinite(qty) && qty > 0 && (isWeight ? true : Number.isInteger(qty));
    if (!valid) return res.status(400).json({ success: false, error: "Cantidad inválida" });

    const runTxn = db.transaction(() => {
      const enteredCost = parseFloat(cost) || 0;
      const isBox =
        (product.sale_unit === "box" || product.sale_unit === "package") &&
        product.box_qty > 0;
      // The user enters the TOTAL cost of this purchase; if empty, use cost_price × quantity
      const totalCost =
        enteredCost > 0
          ? enteredCost
          : isBox
            ? ((product.cost_price || 0) / product.box_qty) * qty
            : (product.cost_price || 0) * qty;

      // Optional cost price update (the user confirmed the new unit/box cost)
      if (req.body.updateCostPrice !== undefined && !isNaN(parseFloat(req.body.updateCostPrice))) {
        const rounded = Math.round((parseFloat(req.body.updateCostPrice) + Number.EPSILON) * 100) / 100;
        db.prepare("UPDATE products SET cost_price = ? WHERE id = ?").run(rounded, id);
      }

      const supplier = supplierId
        ? db.prepare("SELECT id, name FROM suppliers WHERE id = ?").get(supplierId)
        : null;
      const supplierName = supplier?.name || null;

      db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
        .run(qty, id);
      db.prepare(`
        INSERT INTO stock_movements (product_id, type, quantity, cost, reference, notes, cashier_id, supplier_id)
        VALUES (?, 'in', ?, ?, 'App móvil', ?, ?, ?)
      `).run(id, qty, totalCost, supplierName ? `Compra de inventario — ${supplierName}` : (notes || "Movil"), req.cashierId || null, supplier ? supplier.id : null);

      // Register cost as expense (even if no cash register is open)
      // unless the user opted to not deduct from the register (registerExpense=false).
      if (registerExpense !== false && totalCost > 0) {
        const openReg = db.prepare("SELECT id FROM cash_register WHERE status = 'open' AND device_id = ? ORDER BY id DESC LIMIT 1").get(hostDeviceId);
        if (openReg) {
          db.prepare("UPDATE cash_register SET expenses = COALESCE(expenses, 0) + ? WHERE id = ?").run(totalCost, openReg.id);
        }
        const reason = supplierName
          ? `Compra de ${product.name} — ${supplierName}`
          : `Compra de inventario: ${product.name}`;
        db.prepare("INSERT INTO cash_register_expenses (register_id, amount, reason, product_id, quantity) VALUES (?, ?, ?, ?, ?)")
          .run(openReg ? openReg.id : null, totalCost, reason, id, qty);
      }

      return db.prepare("SELECT id, barcode, name, price, stock, cost_price, sale_unit, category_id, min_stock, box_qty, box_price FROM products WHERE id = ?").get(id);
    });

    const updated = runTxn();
    res.json({ success: true, product: updated, message: "Stock actualizado correctamente" });
  }));

  app.get("/api/categories", protect(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const categories = db.prepare("SELECT id, name FROM categories ORDER BY name").all();
    res.json({ success: true, categories });
  }));

  // Health-check sin autenticación para el indicador de conexión del móvil.
  // 3c · además declara el protocolo, para que una caja sepa si es compatible.
  app.get("/api/health", safe((req, res) => {
    res.json({
      success: true,
      ok: true,
      protocol_version: protocol.PROTOCOL_VERSION,
      min_supported: protocol.MIN_SUPPORTED,
    });
  }));

  // 3c · identidad pública mínima del Host (sin secretos): la caja la usa para
  // comprobar a qué Host se conectó antes de emparejar.
  app.get("/api/activation/info", safe((req, res) => {
    res.json({
      success: true,
      protocol_version: protocol.PROTOCOL_VERSION,
      min_supported: protocol.MIN_SUPPORTED,
      app_version: APP_VERSION,
      host_device_id: hostDeviceId,
    });
  }));

  // 3c · estado del emparejamiento de UN dispositivo (la caja que sondea).
  // Se autentica solo con los headers de emparejamiento: no exige scopes de
  // ventas, así que sirve estando pendiente. Un dispositivo REVOCADO sí puede
  // leer su estado (para saber que fue revocado), pero nada más.
  app.get("/api/activation/status", safe((req, res) => {
    const deviceId = req.headers["x-device-id"];
    const deviceToken = req.headers["x-device-token"];
    const row =
      deviceId && deviceToken
        ? db
            .prepare("SELECT paired_token_hash, device_code, approved, revoked FROM paired_devices WHERE device_id = ?")
            .get(deviceId)
        : null;
    const okToken =
      row && activation.timingSafe(activation.hashToken(deviceToken), row.paired_token_hash);
    if (!okToken) {
      return res.status(403).json({
        success: false,
        needsActivation: true,
        error: "Este dispositivo no está activado para este negocio",
      });
    }
    res.json({
      success: true,
      approved: Number(row.approved) === 1,
      revoked: Number(row.revoked) === 1,
      device_code: row.device_code || null,
      host_device_id: hostDeviceId,
      protocol_version: protocol.PROTOCOL_VERSION,
    });
  }));

  // ─── Réplica Host → caja (Entrega 3d) ────────────────────────────────────
  // Qué columnas salen lo decide un solo sitio: db-schema.replicaPlan. Los
  // costos NO se replican (quedan 0 en la caja) y los PINs tampoco.
  const replicaPlan = dbSchema.replicaPlan(db);
  // 3e · «¿esta fila está en el conjunto replicable?». Se deriva del mismo
  // descriptor que los triggers, así que el filtro del snapshot, el de
  // /changes y el del log son siempre idénticos.
  const replicaWhere = (tbl, ref) => {
    const f = dbSchema.replicaFilterSql(tbl, ref);
    return f ? ` AND ${f}` : "";
  };
  const maxSeq = () =>
    db.prepare(`SELECT COALESCE(MAX(seq),0) s FROM ${dbSchema.CHANGE_LOG_TABLE}`).get().s;
  // Primer seq que aún existe en el log. Sólo la compactación crea un hueco:
  // el marker `change_log_first_seq` es lo único que puede hacer que un `since`
  // legítimo (p. ej. 0 en una BD recién instalada) ya no sea servible.
  const firstSeq = () => Number(activation.getSetting(db, "change_log_first_seq") || 0);
  const readRow = (tbl, rowId) => {
    const cols = replicaPlan[tbl];
    if (!cols) return null;
    if (tbl === "settings") {
      if (!dbSchema.REPLICATED_SETTINGS_KEYS.includes(rowId)) return null;
      return db.prepare(`SELECT key, value FROM settings WHERE key = ?`).get(rowId) || null;
    }
    return (
      db
        .prepare(`SELECT ${cols.join(", ")} FROM ${tbl} WHERE id = ?${replicaWhere(tbl, tbl)}`)
        .get(rowId) || null
    );
  };
  // Cursor de snapshot: `settings` pagina por su `key` (texto) y sólo entrega
  // las claves replicadas (el resto —tokens, códigos— nunca sale del Host).
  const pageOf = (table, cursor, limit) => {
    const cols = replicaPlan[table];
    if (table === "settings") {
      const rows = db
        .prepare(
          `SELECT key, value FROM settings WHERE key > ? AND key IN (${dbSchema
            .REPLICATED_SETTINGS_KEYS.map(() => "?")
            .join(",")}) ORDER BY key LIMIT ?`,
        )
        .all(String(cursor || ""), ...dbSchema.REPLICATED_SETTINGS_KEYS, limit);
      return { rows, next: rows.length ? rows[rows.length - 1].key : String(cursor || "") };
    }
    const rows = db
      .prepare(
        `SELECT ${cols.join(", ")} FROM ${table} WHERE id > ?${replicaWhere(table, table)} ORDER BY id LIMIT ?`,
      )
      .all(Number(cursor) || 0, limit);
    return { rows, next: rows.length ? rows[rows.length - 1].id : Number(cursor) || 0 };
  };

  // 3e · túnel SSE. Arranca con el servidor y se cierra con él.
  changeStream = createChangeStream({
    db,
    changeLogTable: dbSchema.CHANGE_LOG_TABLE,
    getSetting: (key) => activation.getSetting(db, key),
  });
  changeStream.start();

  // Descarga inicial por tabla: cursor + snapshot_seq estable (la caja reenvía
  // el seq de la primera página para que el corte no se desplace al paginar).
  app.get("/api/replica/snapshot", protectBox(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const table = String(req.query.table || "");
    const cols = replicaPlan[table];
    if (!cols) {
      return res.status(400).json({
        success: false,
        code: "REPLICA_TABLE_UNKNOWN",
        error: `Tabla no replicable: ${table}`,
      });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 1), 5000);
    const cursor = req.query.cursor === undefined ? 0 : req.query.cursor;
    const snapshotSeq = Number(req.query.snapshot_seq) || maxSeq();
    const { rows, next } = pageOf(table, cursor, limit);
    // El total tiene que contar lo que realmente se entrega: con 3e, los
    // productos de catálogo no viajan, así que no cuentan.
    const total =
      table === "settings"
        ? db
            .prepare(
              `SELECT COUNT(*) c FROM settings WHERE key IN (${dbSchema
                .REPLICATED_SETTINGS_KEYS.map(() => "?")
                .join(",")})`,
            )
            .get(...dbSchema.REPLICATED_SETTINGS_KEYS).c
        : db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE 1=1${replicaWhere(table, table)}`).get().c;
    res.json({
      success: true,
      table,
      columns: cols,
      snapshot_seq: snapshotSeq,
      total,
      rows,
      next_cursor: next,
      has_more: rows.length === limit,
    });
  }));

  // Delta paginado con filas completas. Si el hueco pedido ya no existe en el
  // log (compactado), se pide resync completo.
  app.get("/api/replica/changes", protectBox(scopeDefs.SCOPE.CATALOG_READ), safe((req, res) => {
    const since = Number(req.query.since) || 0;
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
    const boundary = firstSeq();
    if (since < boundary) {
      return res.json({
        success: false,
        code: "LOG_COMPACTED",
        resync: true,
        first_seq: boundary,
        error: "El tramo pedido ya no está en el log: hay que volver a descargar el snapshot",
      });
    }
    const raw = db
      .prepare(
        `SELECT seq, tbl, row_id, op, ts FROM ${dbSchema.CHANGE_LOG_TABLE} WHERE seq > ? ORDER BY seq LIMIT ?`,
      )
      .all(since, limit);
    const changes = raw
      .map((c) => {
        // Claves de settings que la caja no necesita: ni se envían ni generan
        // un borrado (los triggers ya las filtran, esto es defensa en profundidad).
        if (c.tbl === "settings" && !dbSchema.REPLICATED_SETTINGS_KEYS.includes(c.row_id)) {
          return null;
        }
        if (c.op !== "upsert") return { ...c, row: null };
        // La fila se borró después de loguearse: mejor entregarla como borrado.
        const row = readRow(c.tbl, c.row_id);
        return row ? { ...c, row } : { ...c, op: "delete", row: null };
      })
      .filter(Boolean);
    const lastSeq = raw.length ? raw[raw.length - 1].seq : since;
    res.json({
      success: true,
      changes,
      next_seq: lastSeq,
      has_more: raw.length === limit,
      first_seq: boundary,
      snapshot_seq: maxSeq(),
    });
  }));

  // 3e · Túnel de eventos. La caja se conecta una vez y recibe el pulso del
  // Host sin sondear; si se cae, `EventSource` reconecta solo y reenvía
  // `Last-Event-ID`, que es todo el estado que hace falta para reanudar.
  app.get("/api/events", protectBox(scopeDefs.SCOPE.EVENTS_SUBSCRIBE), (req, res) => {
    // Si el dispositivo no tiene el scope, protectBox ya respondió 403. Llegar
    // aquí significa caja emparejada y aprobada.
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform` evita que algún proxy comprima o retenga el flujo.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx y compañía bufferizan por defecto: esto les dice que pasen el
      // flujo tal cual.
      "X-Accel-Buffering": "no",
    });
    // Sin Nagle: los frames son pequeños y el retardo de 40 ms se nota en
    // tiempo real.
    res.socket?.setNoDelay?.(true);
    res.socket?.setKeepAlive?.(true);
    res.flushHeaders?.();

    // `Last-Event-ID` es la forma estándar; `?since=` cubre a los clientes que
    // no sean EventSource (una caja que quiera apuntarlo a mano).
    const lastEventId = req.headers["last-event-id"];
    changeStream.subscribe({ res, lastEventId, since: req.query.since });
    // Importante: Express no debe cerrar la petición al terminar el handler.
    // No llamamos a res.json ni a next(): el flujo vive hasta que la caja se
    // desconecta (dispara `close` y el cliente sale del conjunto).
  });

  // Escaneos/recepciones de hoy del cajero actual (origen App móvil).
  app.get("/api/stock/history/today", protect(scopeDefs.SCOPE.STOCK_READ), safe((req, res) => {
    const movements = db
      .prepare(`
        SELECT m.id, m.product_id, m.quantity, m.cost, m.created_at, m.notes,
               p.name, p.sale_unit
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
        WHERE m.type = 'in'
          AND m.reference = 'App móvil'
          AND m.cashier_id = ?
          AND date(m.created_at, 'localtime') = date('now', 'localtime')
        ORDER BY m.id DESC
      `)
      .all(req.cashierId);
    res.json({ success: true, movements });
  }));

  // Deshacer un movimiento de recepción hecho desde el móvil.
  app.delete("/api/stock/movements/:movementId", protect(scopeDefs.SCOPE.STOCK_WRITE), safe((req, res) => {
    const id = parseInt(req.params.movementId);
    const movement = db
      .prepare("SELECT id, product_id, quantity, type, reference, cashier_id FROM stock_movements WHERE id = ?")
      .get(id);
    if (!movement)
      return res.status(404).json({ success: false, error: "Movimiento no encontrado" });
    if (movement.type !== "in" || movement.reference !== "App móvil")
      return res.status(400).json({ success: false, error: "Este movimiento no se puede deshacer desde la app móvil" });
    if (movement.cashier_id != null && String(movement.cashier_id) !== String(req.cashierId))
      return res.status(403).json({ success: false, error: "No autorizado para deshacer este movimiento" });

    db.transaction(() => {
      db.prepare("UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?").run(movement.quantity, movement.product_id);
      db.prepare("DELETE FROM stock_movements WHERE id = ?").run(id);
    })();

    const product = db
      .prepare("SELECT id, barcode, name, price, stock, cost_price, sale_unit, box_qty, box_price, min_stock FROM products WHERE id = ?")
      .get(movement.product_id);
    res.json({ success: true, product, message: "Movimiento deshecho" });
  }));

  // Recepción en lote desde la app móvil: aplica varios productos en una transacción.
  app.post("/api/products/stock/batch", protect(scopeDefs.SCOPE.STOCK_WRITE), safe((req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items || items.length === 0)
      return res.status(400).json({ success: false, error: "La lista de productos está vacía" });

    const issues = [];
    let applied = 0;

    const runBatch = db.transaction(() => {
      for (const it of items) {
        const pid = parseInt(it.product_id);
        const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(pid);
        if (!product) {
          issues.push({ product_id: pid, error: "Producto no encontrado" });
          continue;
        }
        const qty = Number(it.quantity);
        const isWeight = product.sale_unit === "weight";
        const valid = Number.isFinite(qty) && qty > 0 && (isWeight ? true : Number.isInteger(qty));
        if (!valid) {
          issues.push({ product_id: pid, name: product.name, error: "Cantidad inválida" });
          continue;
        }
        const enteredCost = parseFloat(it.cost) || 0;
        const isBox =
          (product.sale_unit === "box" || product.sale_unit === "package") && product.box_qty > 0;
        const totalCost =
          enteredCost > 0
            ? enteredCost
            : isBox
              ? ((product.cost_price || 0) / product.box_qty) * qty
              : (product.cost_price || 0) * qty;

        db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(qty, pid);
        db.prepare(`
          INSERT INTO stock_movements (product_id, type, quantity, cost, reference, notes, cashier_id, supplier_id)
          VALUES (?, 'in', ?, ?, 'App móvil', ?, ?, ?)
        `).run(pid, qty, totalCost, it.notes || "Recepción en lote", req.cashierId || null, null);
        applied += 1;
      }
    });

    runBatch();

    if (issues.length > 0 && applied === 0)
      return res.status(400).json({ success: false, error: "Ningún producto pudo aplicarse", issues });

    const appliedIds = items
      .map((it) => parseInt(it.product_id))
      .filter((pid) => !issues.some((i) => i.product_id === pid));
    const products = appliedIds.length
      ? db
          .prepare(`SELECT id, barcode, name, price, stock, cost_price, sale_unit, box_qty, box_price FROM products WHERE id IN (${appliedIds.map(() => "?").join(",")})`)
          .all(...appliedIds)
      : [];

    res.json({ success: true, applied, issues, products });
  }));

  // Venta desde el desktop_box (Entrega 2c-B). El parser global de body no se
  // toca: el límite virtual de 256KB se aplica aquí y el tope real de líneas
  // vive en el núcleo (MAX_CART_LINES). La huella de idempotencia se calcula
  // sobre una serialización canónica (claves ordenadas) de los campos del
  // cliente; la identidad del cajero siempre viene del token, nunca del body.
  app.post("/api/sales", protect(scopeDefs.SCOPE.SALES_WRITE), safe(async (req, res) => {
    const key = String(req.headers["idempotency-key"] || "").trim();
    if (!key)
      return res.status(400).json({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED", error: "Cabecera Idempotency-Key requerida" });
    if (key.length > 200)
      return res.status(400).json({ success: false, code: "IDEMPOTENCY_KEY_INVALID", error: "Idempotency-Key inválida" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 256 * 1024)
      return res.status(413).json({ success: false, error: "Payload demasiado grande" });

    const cashier = db.prepare("SELECT id, name, role FROM cashiers WHERE id = ?").get(req.cashierId);


    const rawCid = body.customer_id;
    let cidHash;
    if (rawCid === null || rawCid === undefined) cidHash = undefined;
    else cidHash = rawCid;
    const clientFields = {
      cart: body.cart,
      total: body.total,
      paymentMethod: body.paymentMethod,
      discountTotal: body.discountTotal,
      ...(cidHash !== undefined ? { customer_id: cidHash } : {}),
    };
    const payload = {
      cart: body.cart,
      total: body.total,
      paymentMethod: body.paymentMethod,
      discountTotal: body.discountTotal,
      cashierName: cashier ? cashier.name : "Usuario Principal",
      cashierId: cashier ? cashier.id : null,
      role: cashier ? cashier.role : null,
      customerId: rawCid,
      // 3a.i · la caja es la del dispositivo verificado, nunca del body.
      deviceId: req.deviceId,
      requireRegister: true,
    };
    const requestHash = sha256(canonicalStringify(clientFields));

    const getKey = db.prepare(
      "SELECT request_hash, response_json, status_code FROM idempotency_keys WHERE device_id = ? AND endpoint = 'POST /api/sales' AND key = ?",
    );
    const setKey = db.prepare(
      "INSERT INTO idempotency_keys (device_id, endpoint, key, request_hash, response_json, status_code) VALUES (?, 'POST /api/sales', ?, ?, ?, ?)",
    );

    const runTxn = db.transaction(() => {
      const existing = getKey.get(req.deviceId, key);
      if (existing) {
        if (existing.request_hash === requestHash)
          return { replay: true, statusCode: existing.status_code, body: JSON.parse(existing.response_json) };
        return { conflict: true };
      }
      const result = salesCore.createSaleTx(db, payload);
      const responseBody = { success: true, saleId: result.saleId, warnings: result.warnings || [] };
      setKey.run(req.deviceId, key, requestHash, JSON.stringify(responseBody), 200);
      return { created: true, body: responseBody };
    });

    let outcome;
    try {
      outcome = runTxn.immediate();
    } catch (err) {
      if (err && typeof err.code === "string") {
        return res.status(400).json({ success: false, code: err.code, error: err.message });
      }
      throw err;
    }
    if (outcome.conflict)
      return res.status(422).json({
        success: false,
        code: "IDEMPOTENCY_CONFLICT",
        error: "Idempotency-Key ya usada con un payload diferente",
      });
    return res.status(outcome.replay ? outcome.statusCode : 200).json(outcome.body);
  }));

  // Emparejamiento por código de activación: público porque un teléfono nuevo
  // no tiene cómo autenticarse aún. El código se valida en tiempo constante y
  // con su propio rate limit (evita fuerza bruta del código en la LAN).
  app.post("/api/activation/pair", safe((req, res) => {
    const { deviceId, code, deviceName, deviceType, protocol_version, protocolVersion } =
      req.body || {};
    if (!deviceId || !code)
      return res.status(400).json({ success: false, error: "Faltan datos de activación" });

    const now = Date.now();
    pruneAttempts(now);
    const key = String(deviceId);
    const attempt = pairAttempts.get(key);
    if (
      attempt &&
      now - attempt.windowStart < activation.PAIR_RATE_WINDOW_MS &&
      attempt.count >= activation.PAIR_MAX_ATTEMPTS
    ) {
      return res.status(429).json({
        success: false,
        code: "PAIR_RATE_LIMITED",
        retry_after_ms: activation.PAIR_RATE_WINDOW_MS,
        error: "Demasiados intentos. Espera 15 minutos.",
      });
    }

    // 3c · versión del protocolo: sin compatibilidad no se empareja. Comprueba
    // antes de contar intentos: no es un error de código.
    const proto = protocol.checkProtocol(protocolVersion || protocol_version);
    if (!proto.ok) {
      return res.status(426).json({
        success: false,
        code: proto.code,
        error: proto.error,
        protocol_version: protocol.PROTOCOL_VERSION,
        min_supported: protocol.MIN_SUPPORTED,
      });
    }

    const stored = activation.getActivationCode(db);
    if (!stored) {
      return res.status(409).json({
        success: false,
        error: "Código de activación no disponible",
      });
    }

    const submitted = activation.normalizeCode(code);
    if (!activation.timingSafe(activation.normalizeCode(stored), submitted)) {
      const e = attempt || { count: 0, windowStart: now };
      if (now - e.windowStart >= activation.PAIR_RATE_WINDOW_MS) {
        e.count = 0;
        e.windowStart = now;
      }
      e.count += 1;
      pairAttempts.set(key, e);
      return res.status(401).json({
        success: false,
        code: "PAIR_CODE_INVALID",
        attempts_left: Math.max(0, activation.PAIR_MAX_ATTEMPTS - e.count),
        retry_after_ms: activation.PAIR_RATE_WINDOW_MS,
        error: "Código de activación incorrecto",
      });
    }

    pairAttempts.delete(key);
    const token = crypto.randomBytes(32).toString("hex");

    // Auto-declaración de tipo: un desktop_box queda PENDIENTE (approved=0, sin
    // scopes de escritura) hasta que el admin lo apruebe en Configuración. Un
    // mobile se empareja como hoy (approved=1, set móvil).
    const type = deviceType || scopeDefs.DEVICE_TYPE.MOBILE;
    const isDesktop = type === scopeDefs.DEVICE_TYPE.DESKTOP_BOX;
    const list = isDesktop ? [] : scopeDefs.scopesForDeviceType(type);
    const registered = activation.registerPairing(db, {
      deviceId,
      deviceName,
      token,
      deviceType: type,
      protocolVersion: protocolVersion || protocol_version || null,
      approved: isDesktop ? 0 : 1,
      scopes: list,
    });
    res.json({
      success: true,
      pairedToken: token,
      approved: !isDesktop,
      pending: isDesktop,
      deviceType: type,
      scopes: list,
      // 3c · la caja necesita su código y con qué Host se quedó emparejada.
      device_code: registered ? registered.deviceCode : null,
      host_device_id: hostDeviceId,
      protocol_version: protocol.PROTOCOL_VERSION,
    });
  }));

  const MAX_ATTEMPTS = 3;
  let lastError = "Error desconocido al iniciar el servidor";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await new Promise((resolve) => {
      // Sin host: bind dual-stack (IPv6 :: + IPv4 mapeado). Bindear a "0.0.0.0"
      // falla con EADDRINUSE cuando hay una conexión activa en el puerto
      // (p.ej. sockets de explorer/telemetría), aunque netstat no muestre listener.
      const srv = app.listen(port);
      let settled = false;
      let errored = false;
      const finish = (r) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };

      srv.on("listening", () => {
        // En Windows a veces se emite 'listening' y luego 'error' (EADDRINUSE)
        // cuando el puerto ya estaba ocupado. Esperamos brevemente para que el
        // error gane y no reportar un falso éxito.
        setTimeout(() => {
          if (errored) return;
          server = srv;
          console.log(`API Server running on port ${port}`);
          finish({ success: true, port });
        }, 300);
      });

      srv.on("error", (err) => {
        errored = true;
        console.error("API Server error:", err.message);
        if (server === srv) server = null;
        finish({ success: false, error: err.message });
      });
    });

    if (result.success) return result;

    lastError = result.error;
    if (!/EADDRINUSE/i.test(lastError)) break;

    if (attempt < MAX_ATTEMPTS) {
      console.log(
        `[API] Puerto ${port} ocupado, reintentando en 1.5s (intento ${attempt + 1}/${MAX_ATTEMPTS})...`,
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  try {
    const output = require("child_process")
      .execSync(`netstat -ano | findstr LISTENING | findstr ":${port} "`, {
        timeout: 3000,
        encoding: "utf8",
      })
      .toString();
    console.error(`[API] Puerto ${port} en uso por:\n${output}`);
  } catch {}

  return {
    success: false,
    error: `listen EADDRINUSE: address already in use 0.0.0.0:${port}`,
  };
};

const stopServer = () => {
  // 3e · el túnel va primero: cerrar el socket sin avisar dejaría a las cajas
  // colgadas esperando frames.
  if (changeStream) {
    changeStream.stop();
    changeStream = null;
  }
  if (server) {
    server.close();
    server = null;
    // 3b · las sesiones NO se vacían: reiniciar el Host ya no desloguea.
    console.log("API Server stopped");
  }
};

const getStatus = () => ({
  running: server !== null,
  port: server ? server.address().port : null,
  // 3e · cuántas cajas están escuchando y si hay un import a medias.
  events: replicaStreamStats(),
});

// 3e · ganchos que usa el proceso de Host (main.js) sobre el túnel SSE.
// `hostBusy` / `hostReady` marcan un import masivo. Son no-op si el servidor
// no corre, para que el resto del código no tenga que comprobarlo.
const hostBusy = (reason) => changeStream?.hostBusy(reason);
const hostReady = (reason) => changeStream?.hostReady(reason);
const replicaStreamStats = () => (changeStream ? changeStream.stats() : null);

module.exports = {
  startServer,
  stopServer,
  getStatus,
  makeRequireScope,
  hostBusy,
  hostReady,
  replicaStreamStats,
};
