const express = require("express");
const crypto = require("crypto");

const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();

let server = null;
let activeTokens = {};

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

  app.post("/api/auth", safe((req, res) => {
    const { id, pin } = req.body;
    if (!pin) return res.status(400).json({ success: false, error: "PIN requerido" });

    let cashier;
    if (id) {
      cashier = db.prepare("SELECT id, name, role FROM cashiers WHERE id = ? AND pin = ? AND is_active = 1").get(id, pin);
    } else {
      // fallback: probe only
      if (pin === "probe") return res.json({ success: true, cashier: null });
      cashier = db.prepare("SELECT id, name, role FROM cashiers WHERE pin = ? AND is_active = 1").get(pin);
    }
    if (!cashier) return res.status(401).json({ success: false, error: "PIN inválido" });

    const token = crypto.randomBytes(32).toString("hex");
    activeTokens[token] = { cashierId: cashier.id, createdAt: Date.now() };
    res.json({ success: true, token, cashier: { id: cashier.id, name: cashier.name, role: cashier.role } });
  }));

  app.get("/api/cashiers", safe((req, res) => {
    const cashiers = db.prepare("SELECT id, name, role, is_active FROM cashiers ORDER BY name").all();
    res.json({ success: true, cashiers });
  }));

  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token || !activeTokens[token]) return res.status(401).json({ success: false, error: "No autorizado" });
    req.cashierId = activeTokens[token].cashierId;
    next();
  };

  // IMPORTANT: /search must come BEFORE :barcode or Express matches "search" as barcode
  app.get("/api/products/search", requireAuth, safe((req, res) => {
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

  app.get("/api/products/:barcode", requireAuth, safe((req, res) => {
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

  app.post("/api/products", requireAuth, safe((req, res) => {
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

  app.patch("/api/products/:id/stock", requireAuth, safe((req, res) => {
    const { quantity, notes, cost, supplierId, registerExpense, updateCostPrice } = req.body;
    const id = parseInt(req.params.id);
    if (!quantity || quantity <= 0) return res.status(400).json({ success: false, error: "Cantidad inválida" });

    const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(id);
    if (!product) return res.status(404).json({ success: false, error: "Producto no encontrado" });

    const enteredCost = parseFloat(cost) || 0;
    const isBox =
      (product.sale_unit === "box" || product.sale_unit === "package") &&
      product.box_qty > 0;
    // The user enters the TOTAL cost of this purchase; if empty, use cost_price × quantity
    const totalCost =
      enteredCost > 0
        ? enteredCost
        : isBox
          ? ((product.cost_price || 0) / product.box_qty) * quantity
          : (product.cost_price || 0) * quantity;

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
      .run(quantity, id);
    db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, cost, reference, notes, cashier_id, supplier_id)
      VALUES (?, 'in', ?, ?, 'App móvil', ?, ?, ?)
    `).run(id, quantity, totalCost, supplierName ? `Compra de inventario — ${supplierName}` : (notes || "Movil"), req.cashierId || null, supplier ? supplier.id : null);

    // Register cost as expense (even if no cash register is open)
    // unless the user opted to not deduct from the register (registerExpense=false).
    if (registerExpense !== false && totalCost > 0) {
      const todayMX = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
      const openReg = db.prepare("SELECT id FROM cash_register WHERE date = ? AND status = 'open'").get(todayMX);
      if (openReg) {
        db.prepare("UPDATE cash_register SET expenses = COALESCE(expenses, 0) + ? WHERE id = ?").run(totalCost, openReg.id);
      }
      const reason = supplierName
        ? `Compra de ${product.name} — ${supplierName}`
        : `Compra de inventario: ${product.name}`;
      db.prepare("INSERT INTO cash_register_expenses (register_id, amount, reason, product_id, quantity) VALUES (?, ?, ?, ?, ?)")
        .run(openReg ? openReg.id : null, totalCost, reason, id, quantity);
    }

    const updated = db.prepare("SELECT id, barcode, name, price, stock, cost_price, sale_unit, category_id, min_stock, box_qty, box_price FROM products WHERE id = ?").get(id);
    res.json({ success: true, product: updated, message: "Stock actualizado correctamente" });
  }));

  app.get("/api/categories", requireAuth, safe((req, res) => {
    const categories = db.prepare("SELECT id, name FROM categories ORDER BY name").all();
    res.json({ success: true, categories });
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
