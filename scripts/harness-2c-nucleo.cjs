"use strict";
/*
 * PASO 3 · Harness del núcleo de venta (bloque 2c-A), movido desde
 * C:\Users\jacob\AppData\Local\Temp\opencode\vendia-2c\harness.cjs y adaptado:
 *   - el esquema ya NO está escrito a mano: se construye con src/main/db-schema.js
 *     (scripts/db-fixture.js), igual que en la app real;
 *   - los snapshots de `sales` incluyen la columna customer_id (entrega 2d).
 *
 * Uso (Electron con better-sqlite3):
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\harness-2c-nucleo.cjs [salida.json]
 */
const path = require("path");
const fixture = require("./db-fixture");

const outFile = process.argv[2] || path.join(__dirname, "golden-2c-nucleo.json");
const salesCore = require(path.join(fixture.REPO, "src", "main", "sales-core.js"));

const SALES_COLS =
  "total,payment_method,discount_total,cashier_name,status,stock_conflict,conflict_detail,customer_id";
const ITEM_COLS =
  "product_id,product_name,quantity,price_at_sale,discount_percent,stock_deducted";

const build = () => {
  const db = fixture.createMemoryDb();
  db.prepare("INSERT INTO cash_register (id, date, status) VALUES (1, '2026-01-01', 'open')").run();
  const ins = db.prepare(
    "INSERT INTO products (id, name, price, stock, sale_unit, box_qty, pack_qty) VALUES (?,?,?,?,?,?,?)",
  );
  ins.run(1, "Leche", 20, 2, "piece", 0, 0);
  ins.run(2, "Pan", 15, 10, "piece", 0, 0);
  ins.run(3, "Queso", 90, 5, "weight", 0, 0);
  ins.run(4, "Caja Refresco", 240, 100, "box", 12, 0);
  ins.run(5, "Paquete Galletas", 50, 40, "package", 0, 6);
  return db;
};

const setSetting = (db, key, value) =>
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(key, value);

const runSale = (db, payload) => {
  try {
    return db.transaction(() => salesCore.createSaleTx(db, payload))();
  } catch (error) {
    const failure = { success: false, error: error.message };
    if (error.code) failure.code = error.code;
    if (error.stock) failure.stock = error.stock;
    return failure;
  }
};

const normalizeResult = (r) => {
  if (r.success) {
    return {
      success: true,
      warnings: (r.warnings || []).map((w) => ({
        code: w.code,
        product_id: w.product_id,
        name: w.name,
        available_before: w.available_before,
        sold: w.sold,
        stock_after: w.stock_after,
      })),
    };
  }
  return { success: false, code: r.code || null, error: r.error };
};

const snapAny = (db) => ({
  sales: db.prepare(`SELECT ${SALES_COLS} FROM sales ORDER BY id`).all(),
  items: db.prepare(`SELECT ${ITEM_COLS} FROM sale_items ORDER BY id`).all(),
  products: db.prepare("SELECT id,stock FROM products ORDER BY id").all(),
});

const snap = (db, result) => ({ result: normalizeResult(result), ...snapAny(db) });

const scenarios = {
  normal_two: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [
        { id: 1, name: "Leche", quantity: 1, price: 20, finalPrice: 20 },
        { id: 2, name: "Pan", quantity: 2, price: 15, finalPrice: 15 },
      ],
      total: 50,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  insufficient_false: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 3, price: 20, finalPrice: 20 }],
      total: 60,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  insufficient_true: (db) => {
    setSetting(db, "sale_without_stock", "true");
    return runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 3, price: 20, finalPrice: 20 }],
      total: 60,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  concurrent_sequential: (db) => {
    setSetting(db, "sale_without_stock", "false");
    db.prepare("UPDATE products SET stock = 3 WHERE id = 1").run();
    const r1 = runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 2, price: 20, finalPrice: 20 }],
      total: 40,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
    const r2 = runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 2, price: 20, finalPrice: 20 }],
      total: 40,
      paymentMethod: "cash",
      cashierName: "Beto",
    });
    return { first: normalizeResult(r1), second: normalizeResult(r2) };
  },
  nonexistent_false: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 999, name: "Fantasma", quantity: 1, price: 10, finalPrice: 10 }],
      total: 10,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  nonexistent_true: (db) => {
    setSetting(db, "sale_without_stock", "true");
    return runSale(db, {
      cart: [{ id: 999, name: "Fantasma", quantity: 1, price: 10, finalPrice: 10 }],
      total: 10,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  qty_zero: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 0, price: 20, finalPrice: 20 }],
      total: 0,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  qty_negative: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: -2, price: 20, finalPrice: 20 }],
      total: -40,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  qty_decimal_nonweight: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 1.5, price: 20, finalPrice: 20 }],
      total: 30,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  weight_decimal: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 3, name: "Queso", quantity: 1.5, price: 90, finalPrice: 90, isWeightItem: true }],
      total: 135,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  box_item: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: 4, name: "Caja Refresco", quantity: 1, price: 240, finalPrice: 240, isBoxItem: true, box_qty: 12 }],
      total: 240,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  manual_item: (db) => {
    setSetting(db, "sale_without_stock", "false");
    return runSale(db, {
      cart: [{ id: "manual-1", name: "Producto manual", quantity: 1, price: 33, finalPrice: 33, isManual: true }],
      total: 33,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  multiline_same_product: (db) => {
    setSetting(db, "sale_without_stock", "false");
    db.prepare("UPDATE products SET stock = 0 WHERE id = 1").run();
    return runSale(db, {
      cart: [
        { id: 1, name: "Leche", quantity: 1, price: 20, finalPrice: 20 },
        { id: 1, name: "Leche", quantity: 1, price: 20, finalPrice: 20 },
      ],
      total: 40,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
  },
  cancel_restore: (db) => {
    setSetting(db, "sale_without_stock", "true");
    const r = runSale(db, {
      cart: [{ id: 1, name: "Leche", quantity: 3, price: 20, finalPrice: 20 }],
      total: 60,
      paymentMethod: "cash",
      cashierName: "Ana",
    });
    const stockAfterSale = db.prepare("SELECT stock FROM products WHERE id=1").get().stock;
    db.transaction(() => {
      const items = db.prepare("SELECT product_id, stock_deducted FROM sale_items").all();
      const restore = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
      for (const it of items) {
        if (it.product_id && (it.stock_deducted || 0) > 0) restore.run(it.stock_deducted, it.product_id);
      }
    })();
    const stockAfterCancel = db.prepare("SELECT stock FROM products WHERE id=1").get().stock;
    return { afterSale: normalizeResult(r), stockAfterSale, stockAfterCancel };
  },
};

const golden = {};
let failures = 0;
for (const [name, fn] of Object.entries(scenarios)) {
  const db = build();
  let result;
  try {
    result = fn(db);
  } catch (e) {
    failures += 1;
    console.log(`✗ escenario ${name} lanzó: ${e.code || ""} ${e.message}`);
    result = { success: false, error: e.message };
  }
  golden[name] =
    name === "concurrent_sequential" || name === "cancel_restore"
      ? { result, state: snapAny(db) }
      : snap(db, result);
  db.close();
}

require("fs").writeFileSync(outFile, JSON.stringify(golden, null, 2));
console.log("Golden escrito en", outFile);
console.log("Escenarios:", Object.keys(golden).length, "| escenarios con excepción:", failures);
process.exit(failures === 0 ? 0 : 1);
