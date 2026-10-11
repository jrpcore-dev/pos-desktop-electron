"use strict";

// EXTRAÍDO de src/main/main.js (PASO 2): ensureColumn, createTables y
// runMigrations, con `db` como primer argumento. Las llamadas internas a
// ensureColumn(...) no cambian (se enlazan con el db recibido).
//
// PASO A (arreglo del bug de instalación nueva): dos sitios dejan de ser
// verbatim respecto de main.js —
//   1) sale_items se crea ya en su forma final (product_id nullable +
//      stock_deducted), y
//   2) la reconstrucción copia solo las columnas que existan en la tabla vieja.
// Ambos cambios son necesarios para que una BD vacía no muera con
// `SQLITE_ERROR: no such column: stock_deducted`. El resultado en bases
// existentes no cambia (ver scripts/check-empty-db.cjs y el reporte del PASO A).
//
// OJO: runMigrations usa la función SQL `nomar(...)`, que main.js registra sobre
// la conexión con db.function("nomar", nomarize) ANTES de llamarla. Cualquier
// consumidor distinto de main.js debe registrarla igual (ver scripts/).

const { hashPin } = require("./pins");

const ensureColumnOn = (db, table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const createTables = (db) => {
  const ensureColumn = (table, column, definition) => ensureColumnOn(db, table, column, definition);

  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    expiry_date TEXT,
    image_path TEXT,
    cost_price REAL DEFAULT 0,
    min_stock INTEGER DEFAULT 5,
    discount_percent REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    has_discount INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    discount_total REAL DEFAULT 0,
    cashier_name TEXT DEFAULT 'Usuario Principal',
    customer_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // PASO A: sale_items nace YA en su forma final. Antes se creaba con
  // product_id NOT NULL y SIN stock_deducted, lo que disparaba la
  // reconstrucción de más abajo en cada BD nueva y el INSERT...SELECT
  // referenciaba una columna inexistente →
  // `SQLITE_ERROR: no such column: stock_deducted` (instalación nueva que no
  // arranca). Con product_id nullable la reconstrucción no se dispara.
  db.exec(`CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER REFERENCES products(id),
    product_name TEXT,
    quantity INTEGER NOT NULL,
    price_at_sale REAL NOT NULL,
    discount_percent REAL DEFAULT 0,
    stock_deducted REAL DEFAULT 0
  )`);

  // Entrega 2c-B: idempotencia de escrituras por dispositivo (p. ej. ventas del
  // desktop_box). La inserción se hace DENTRO de la misma transacción que la
  // escritura; las claves viejas (> 7 días) se purgan al arrancar.
  db.exec(`CREATE TABLE IF NOT EXISTS idempotency_keys (
    device_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (device_id, endpoint, key)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    delivery_days TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  ensureColumn("suppliers", "delivery_days", "TEXT DEFAULT ''");

  db.exec(`CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK(type IN ('in','out','adjust','devolution')),
    quantity INTEGER NOT NULL,
    reference TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS cash_register (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    opening_balance REAL DEFAULT 0,
    cash_sales REAL DEFAULT 0,
    card_sales REAL DEFAULT 0,
    transfer_sales REAL DEFAULT 0,
    expenses REAL DEFAULT 0,
    expected_close REAL DEFAULT 0,
    declared_close REAL DEFAULT 0,
    difference REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    task_date TEXT NOT NULL,
    task_time TEXT,
    reminder_minutes INTEGER DEFAULT 30,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    route TEXT DEFAULT '/reports',
    week_key TEXT,
    status TEXT DEFAULT 'unread',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add register_id to sales
  const sCols2 = db.prepare("PRAGMA table_info(sales)").all();
  if (!sCols2.find((c) => c.name === "register_id")) {
    ensureColumn(
      "sales",
      "register_id",
      "INTEGER REFERENCES cash_register(id)",
    );
  }

  // Migrations for existing dbs
  const pCols = db.prepare("PRAGMA table_info(products)").all();
  if (!pCols.find((c) => c.name === "category_id")) {
    ensureColumn(
      "products",
      "category_id",
      "INTEGER REFERENCES categories(id)",
    );
    ensureColumn("products", "supplier_id", "INTEGER REFERENCES suppliers(id)");
    ensureColumn("products", "expiry_date", "TEXT");
    ensureColumn("products", "image_path", "TEXT");
    ensureColumn("products", "cost_price", "REAL DEFAULT 0");
    ensureColumn("products", "min_stock", "INTEGER DEFAULT 5");
    ensureColumn("products", "discount_percent", "REAL DEFAULT 0");
    ensureColumn("products", "is_active", "INTEGER DEFAULT 1");
  }
  const sCols = db.prepare("PRAGMA table_info(sales)").all();
  if (!sCols.find((c) => c.name === "payment_method")) {
    ensureColumn("sales", "payment_method", "TEXT DEFAULT 'cash'");
    ensureColumn("sales", "discount_total", "REAL DEFAULT 0");
    ensureColumn("sales", "cashier_name", "TEXT DEFAULT 'Usuario Principal'");
  }
  const siCols = db.prepare("PRAGMA table_info(sale_items)").all();
  if (!siCols.find((c) => c.name === "discount_percent")) {
    ensureColumn("sale_items", "discount_percent", "REAL DEFAULT 0");
  }

  // Ensure product_name column exists
  if (!siCols.find((c) => c.name === "product_name")) {
    ensureColumn("sale_items", "product_name", "TEXT");
  }

  // Cancellation support
  if (!sCols2.find((c) => c.name === "status")) {
    ensureColumn("sales", "status", "TEXT DEFAULT 'completado'");
  }
  ensureColumn("sales", "cancelled_at", "DATETIME");
  ensureColumn("sales", "cancelled_by", "TEXT");
  // Entrega 2c: rastro durable de conflictos de stock (venta con stock
  // resultante negativo). Aditivo, sin migración de datos.
  ensureColumn("sales", "stock_conflict", "INTEGER DEFAULT 0");
  ensureColumn("sales", "conflict_detail", "TEXT");
  ensureColumn("sales", "customer_id", "INTEGER");
  // Make product_id nullable (recreate table) using a fresh PRAGMA check
  const siColsFresh = db.prepare("PRAGMA table_info(sale_items)").all();
  const pcol = siColsFresh.find((c) => c.name === "product_id");
  if (pcol && pcol.notnull === 1) {
    // PASO A: copiar SOLO las columnas que existan en la tabla vieja. Una BD
    // anterior a stock_deducted no la tiene, y el SELECT completo reventaba
    // con `no such column: stock_deducted`. Las columnas que falten quedan
    // con su DEFAULT (stock_deducted = 0), el mismo valor que pondría
    // ensureColumn más abajo en una tabla sin reconstruir.
    const siHave = siColsFresh.map((c) => c.name);
    const siCopy = [
      "id",
      "sale_id",
      "product_id",
      "product_name",
      "quantity",
      "price_at_sale",
      "discount_percent",
      "stock_deducted",
    ].filter((c) => siHave.includes(c));
    const siList = siCopy.join(", ");
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE sale_items_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id),
        product_id INTEGER REFERENCES products(id),
        product_name TEXT,
        quantity INTEGER NOT NULL,
        price_at_sale REAL NOT NULL,
        discount_percent REAL DEFAULT 0,
        stock_deducted REAL DEFAULT 0
      )
    `);
    db.exec(
      `INSERT INTO sale_items_v2 (${siList}) SELECT ${siList} FROM sale_items`,
    );
    db.exec(`DROP TABLE sale_items`);
    db.exec(`ALTER TABLE sale_items_v2 RENAME TO sale_items`);
    db.pragma("foreign_keys = ON");
  }

  // stock_deducted must be ensured AFTER the rebuild above (the rebuild keeps it,
  // but re-ensure it defensively for any existing DB that predates the column)
  const siCancelledCols = db.prepare("PRAGMA table_info(sale_items)").all();
  if (!siCancelledCols.find((c) => c.name === "stock_deducted")) {
    ensureColumn("sale_items", "stock_deducted", "REAL DEFAULT 0");
  }

  ensureColumn("sale_items", "status", "TEXT DEFAULT 'activo'");
  ensureColumn("sale_items", "cancelled_at", "DATETIME");
  ensureColumn("sale_items", "cancelled_by", "TEXT");
  ensureColumn("sale_items", "returned_qty", "REAL DEFAULT 0");

  // ─── CUSTOMERS / TIERS ─────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS customer_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    tier_id INTEGER REFERENCES customer_tiers(id),
    qr_code TEXT UNIQUE,
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`,
  );

  db.exec(`CREATE TABLE IF NOT EXISTS tier_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tier_id INTEGER NOT NULL REFERENCES customer_tiers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    UNIQUE(tier_id, product_id)
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tier_prices_tier ON tier_prices(tier_id)`,
  );

  db.exec(`CREATE TABLE IF NOT EXISTS customer_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    UNIQUE(customer_id, product_id)
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_customer_prices_customer ON customer_prices(customer_id)`,
  );

  const tierCount = db
    .prepare("SELECT COUNT(*) AS c FROM customer_tiers")
    .get().c;
  if (tierCount === 0) {
    const ins = db.prepare(
      "INSERT INTO customer_tiers (name, position) VALUES (?, ?)",
    );
    ins.run("Normal", 0);
    ins.run("Frecuente", 1);
    ins.run("Mayorista", 2);
  }
};

const runMigrations = (db) => {
  const ensureColumn = (table, column, definition) => ensureColumnOn(db, table, column, definition);

  // ─── ÍNDICES ──────────────────────────────────────────────────
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sales_register_id ON sales(register_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_cash_register_date_status ON cash_register(date, status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_date_completed ON tasks(task_date, completed)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at)`,
  );

  // Migration: make register_id nullable in cash_register_expenses (gastos sin caja)
  {
    const expCols = db
      .prepare("PRAGMA table_info(cash_register_expenses)")
      .all();
    const expRegCol = expCols.find((c) => c.name === "register_id");
    if (expRegCol && expRegCol.notnull === 1) {
      db.pragma("foreign_keys = OFF");
      db.exec(`
      CREATE TABLE cash_register_expenses_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER REFERENCES cash_register(id),
        amount REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
      db.exec(
        `INSERT INTO cash_register_expenses_v2 (id, register_id, amount, reason, created_at)
       SELECT id, register_id, amount, reason, created_at FROM cash_register_expenses`,
      );
      db.exec(`DROP TABLE cash_register_expenses`);
      db.exec(
        `ALTER TABLE cash_register_expenses_v2 RENAME TO cash_register_expenses`,
      );
      db.pragma("foreign_keys = ON");
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_cash_register_expenses_register ON cash_register_expenses(register_id)`,
      );
    }
  }

  // Migration: add name to cash_register
  ensureColumn("cash_register", "name", "TEXT");

  // Migration: add sale_unit to products
  ensureColumn("products", "sale_unit", "TEXT DEFAULT 'piece'");

  // Migration: search_name normalizado para el buscador por relevancia
  // (se escribe en cada alta/edición/importación; el backfill es idempotente)
  ensureColumn("products", "search_name", "TEXT DEFAULT ''");
  try {
    db.exec(
      `UPDATE products SET search_name = nomar(name)
       WHERE search_name IS NULL OR search_name = ''`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_products_search_name ON products(search_name)`,
    );
  } catch (e) {}

  // Migration: add cost to stock_movements
  ensureColumn("stock_movements", "cost", "REAL DEFAULT 0");
  // Migration: add cashier_id to stock_movements
  ensureColumn("stock_movements", "cashier_id", "INTEGER");
  // Migration: add supplier_id to stock_movements (control de compras por proveedor)
  ensureColumn("stock_movements", "supplier_id", "INTEGER");

  // Index on cashier_id must be created AFTER the column is ensured
  // (avoids "no such column: cashier_id" on fresh installs / old DBs)
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_stock_movements_cashier_created ON stock_movements(cashier_id, created_at)`,
    );
  } catch (err) {
    console.error(
      "No se pudo crear el índice de stock_movements por cajero:",
      err.message,
    );
  }

  // Migration: add 'devolution' type to stock_movements (las cancelaciones y
  // devoluciones de venta no deben contarse como entradas/compra de stock,
  // así que se separan de 'in' con un tipo propio)
  try {
    const smSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movements'",
      )
      .get();
    if (smSql && !/devolution/.test(smSql.sql)) {
      db.pragma("foreign_keys = OFF");
      db.exec(`
        CREATE TABLE stock_movements_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id),
          type TEXT NOT NULL CHECK(type IN ('in','out','adjust','devolution')),
          quantity INTEGER NOT NULL,
          reference TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          cost REAL DEFAULT 0,
          cashier_id INTEGER,
          supplier_id INTEGER
        )
      `);
      db.exec(
        `INSERT INTO stock_movements_v2 (id, product_id, type, quantity, reference, notes, created_at, cost, cashier_id, supplier_id)
         SELECT id, product_id, type, quantity, reference, notes, created_at, cost, cashier_id, supplier_id FROM stock_movements`,
      );
      db.exec(`DROP TABLE stock_movements`);
      db.exec(`ALTER TABLE stock_movements_v2 RENAME TO stock_movements`);
      db.pragma("foreign_keys = ON");
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stock_movements_cashier_created ON stock_movements(cashier_id, created_at)`,
      );
    }
  } catch (err) {
    console.error(
      "No se pudo migrar stock_movements (tipo devolution):",
      err.message,
    );
  }

  // Migration: add box fields to products
  ensureColumn("products", "box_qty", "INTEGER DEFAULT 0");
  ensureColumn("products", "box_price", "REAL DEFAULT 0");

  // Migration: add pack (unidad media) fields to products
  ensureColumn("products", "pack_qty", "INTEGER DEFAULT 0");
  ensureColumn("products", "pack_price", "REAL DEFAULT 0");

  // Migration: add has_discount to products
  ensureColumn("products", "has_discount", "INTEGER DEFAULT 0");

  // Migration: catálogo de productos de referencia (no activos)
  ensureColumn("products", "is_catalog", "INTEGER DEFAULT 0");
  // Texto original de la unidad (LITROS, GRAMOS...) solo para mostrar en catálogo
  ensureColumn("products", "ref_unit", "TEXT DEFAULT ''");
  // Nombre del catálogo (normalizado del CSV), puede diferir del name de inventario
  ensureColumn("products", "cat_name", "TEXT DEFAULT ''");

  // Migration: promo / wholesale tiers per product
  // type 'combo'   -> X piezas exactas por $Y (sobrante a precio normal)
  // type 'mayoreo' -> a partir de X piezas se cobra $Y por esas X (precio/pieza)
  db.exec(`CREATE TABLE IF NOT EXISTS product_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    type TEXT NOT NULL DEFAULT 'combo',
    qty INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices(product_id)`,
  );

  // Migration: allow_manual_discount (permiso explícito de descuento manual en caja).
  // Separation of concerns: antes, el permiso se infería como
  // has_discount=1 AND discount_percent<=0 AND sin tiers (canManualDiscount).
  // El backfill es ONE-SHOT: solo se ejecuta en la primera migración (cuando la
  // columna se acaba de crear), para no pisar decisiones posteriores del gerente.
  {
    const amdCols = db.prepare("PRAGMA table_info(products)").all();
    if (!amdCols.find((c) => c.name === "allow_manual_discount")) {
      db.exec(
        "ALTER TABLE products ADD COLUMN allow_manual_discount INTEGER DEFAULT 0",
      );
      db.exec(
        `UPDATE products SET allow_manual_discount = 1
           WHERE COALESCE(allow_manual_discount, 0) = 0
             AND has_discount = 1 AND discount_percent <= 0
             AND NOT EXISTS (
               SELECT 1 FROM product_prices pp WHERE pp.product_id = products.id
             )`,
      );
    }
  }

  // Migration: vigencia opcional de promociones por cantidad (solo tiers).
  // Fechas vacías = promoción vigente siempre.
  ensureColumn("products", "allow_manual_discount", "INTEGER DEFAULT 0");
  // Vigencia única global para toda la promoción del producto
  ensureColumn("products", "promo_start_date", "TEXT DEFAULT ''");
  ensureColumn("products", "promo_end_date", "TEXT DEFAULT ''");
  // Precio fijo de promoción (excluyente con % automático). >0 = aplica a
  // cualquier cantidad.
  ensureColumn("products", "promo_fixed_price", "REAL DEFAULT 0");

  // Migration: add cashier_id to cash_register
  ensureColumn("cash_register", "cashier_id", "INTEGER");
  // Migration: add opened_by and closed_by to cash_register
  ensureColumn("cash_register", "opened_by", "INTEGER");
  ensureColumn("cash_register", "closed_by", "INTEGER");

  // Migration: recompute difference for already-closed registers whose
  // expected_close is negative (the declaration reduces the debt instead of
  // being added on top: expected + declared).
  db.prepare(
    `UPDATE cash_register
     SET difference = CASE
       WHEN expected_close < 0 THEN expected_close + COALESCE(declared_close, 0)
       ELSE COALESCE(declared_close, 0) - expected_close
     END
     WHERE status = 'closed' AND expected_close < 0`,
  ).run();

  db.exec(`
  CREATE TABLE IF NOT EXISTS cash_register_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    register_id INTEGER NOT NULL REFERENCES cash_register(id),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_cash_register_expenses_register ON cash_register_expenses(register_id)`,
  );

  // Migration: soft-delete fields for expenses (gastos cancelados)
  ensureColumn("cash_register_expenses", "status", "TEXT");
  ensureColumn("cash_register_expenses", "cancelled_at", "DATETIME");
  ensureColumn("cash_register_expenses", "cancelled_by", "INTEGER");

  // Migration: link expense (compra de inventario) to product for stock restore
  ensureColumn("cash_register_expenses", "product_id", "INTEGER");
  ensureColumn("cash_register_expenses", "quantity", "INTEGER DEFAULT 0");

  // ─── CASHIERS TABLE ──────────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS cashiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'cashier',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

  // Migration: add role column to cashiers (for existing DBs)
  ensureColumn("cashiers", "role", "TEXT DEFAULT 'cashier'");

  // Remove old default admin cashier if it still exists
  const oldAdmin = db
    .prepare("SELECT id FROM cashiers WHERE name = 'Admin' AND pin = '0000'")
    .get();
  if (oldAdmin) {
    const otherCount = db
      .prepare("SELECT COUNT(*) as count FROM cashiers WHERE name != 'Admin'")
      .get();
    if (otherCount.count > 0) {
      db.prepare("DELETE FROM cashiers WHERE id = ?").run(oldAdmin.id);
    }
  }

  // Migration: add role column to cashiers
  ensureColumn("cashiers", "role", "TEXT DEFAULT 'cashier'");

  // Migración de seguridad: PINs en texto plano → hash scrypt (salt por cajero).
  // Invisible para el usuario final: el mismo PIN de siempre sigue funcionando.
  ensureColumn("cashiers", "pin_hash", "TEXT");
  ensureColumn("cashiers", "pin_salt", "TEXT");
  const legacyPins = db
    .prepare(
      "SELECT id, pin FROM cashiers WHERE pin != '' AND (pin_hash IS NULL OR pin_hash = '')",
    )
    .all();
  for (const c of legacyPins) {
    // Cuentas con el PIN por defecto '0000' se saltan: quedan pendientes de
    // decisión del dueño del negocio, no se tocan bajo ninguna circunstancia.
    if (c.pin === "0000") continue;
    const { salt, hash } = hashPin(c.pin);
    db.prepare(
      "UPDATE cashiers SET pin = '', pin_hash = ?, pin_salt = ? WHERE id = ?",
    ).run(hash, salt, c.id);
  }
};

module.exports = { ensureColumn: ensureColumnOn, createTables, runMigrations };
