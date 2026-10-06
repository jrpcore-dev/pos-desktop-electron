const express = require("express");
const crypto = require("crypto");
const { verifyPin } = require("./pins");
const activation = require("./activation");

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
let activeTokens = {};
const authAttempts = new Map(); // { cashierId: { count, windowStart } }
const pairAttempts = new Map(); // { deviceId: { count, windowStart } }

const pruneAttempts = (now) => {
  for (const [k, e] of authAttempts) {
    if (now - e.windowStart >= RATE_WINDOW_MS) authAttempts.delete(k);
  }
  for (const [k, e] of pairAttempts) {
    if (now - e.windowStart >= activation.PAIR_RATE_WINDOW_MS) pairAttempts.delete(k);
  }
};

const startServer = async (db, port = 3456) => {
  if (server) return { success: true, port };

  const app = express();
  app.use(express.json());

  const safe = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("API error:", err.message);
      res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
  };

  // ─── CANDADO DE ACTIVACIÓN POR NEGOCIO ─────────────────────────────
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization;
    const sess = token && activeTokens[token];
    if (!sess) return res.status(401).json({ success: false, error: "No autorizado" });
    if (Date.now() - sess.createdAt > TOKEN_TTL_MS) {
      delete activeTokens[token];
      return res.status(401).json({ success: false, error: "Sesión expirada" });
    }
    req.cashierId = sess.cashierId;
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

  const protect = [requireAuth, requirePaired];

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

    // Poda de tokens vencidos para acotar la memoria.
    for (const [k, t] of Object.entries(activeTokens)) {
      if (now - t.createdAt > TOKEN_TTL_MS) delete activeTokens[k];
    }

    const token = crypto.randomBytes(32).toString("hex");
    activeTokens[token] = { cashierId: cashier.id, createdAt: now };

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

  app.get("/api/cashiers", requirePaired, safe((req, res) => {
    const cashiers = db.prepare("SELECT id, name, is_active FROM cashiers ORDER BY name").all();
    res.json({ success: true, cashiers });
  }));

  // Detalle completo de cajeros: solo con token válido.
  app.get("/api/cashiers/full", protect, safe((req, res) => {
    const cashiers = db.prepare("SELECT id, name, role, is_active FROM cashiers ORDER BY name").all();
    res.json({ success: true, cashiers });
  }));

  // IMPORTANT: /search must come BEFORE :barcode or Express matches "search" as barcode
  app.get("/api/products/search", protect, safe((req, res) => {
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

  app.get("/api/products/:barcode", protect, safe((req, res) => {
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

  app.post("/api/products", protect, safe((req, res) => {
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

  app.patch("/api/products/:id/stock", protect, safe((req, res) => {
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
        const openReg = db.prepare("SELECT id FROM cash_register WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
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

  app.get("/api/categories", protect, safe((req, res) => {
    const categories = db.prepare("SELECT id, name FROM categories ORDER BY name").all();
    res.json({ success: true, categories });
  }));

  // Health-check sin autenticación para el indicador de conexión del móvil.
  app.get("/api/health", safe((req, res) => {
    res.json({ success: true, ok: true });
  }));

  // Escaneos/recepciones de hoy del cajero actual (origen App móvil).
  app.get("/api/stock/history/today", protect, safe((req, res) => {
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
  app.delete("/api/stock/movements/:movementId", protect, safe((req, res) => {
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
  app.post("/api/products/stock/batch", protect, safe((req, res) => {
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

  // Emparejamiento por código de activación: público porque un teléfono nuevo
  // no tiene cómo autenticarse aún. El código se valida en tiempo constante y
  // con su propio rate limit (evita fuerza bruta del código en la LAN).
  app.post("/api/activation/pair", safe((req, res) => {
    const { deviceId, code, deviceName } = req.body || {};
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
        error: "Demasiados intentos. Espera 15 minutos.",
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
      return res.status(401).json({ success: false, error: "Código de activación incorrecto" });
    }

    pairAttempts.delete(key);
    const token = crypto.randomBytes(32).toString("hex");
    activation.registerPairing(db, { deviceId, deviceName, token });
    res.json({ success: true, pairedToken: token });
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
  if (server) {
    server.close();
    server = null;
    activeTokens = {};
    console.log("API Server stopped");
  }
};

const getStatus = () => ({
  running: server !== null,
  port: server ? server.address().port : null,
});

module.exports = { startServer, stopServer, getStatus };
