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

const crypto = require("crypto");
const { hashPin } = require("./pins");

const ensureColumnOn = (db, table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

// 3a.i · device_id estable del Host: se genera una sola vez y vive en settings.
const HOST_DEVICE_ID_KEY = "host_device_id";
const ensureHostDeviceId = (db) => {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(HOST_DEVICE_ID_KEY);
  if (row && row.value) return row.value;
  const value = `host-${crypto.randomBytes(12).toString("hex")}`;
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  ).run(HOST_DEVICE_ID_KEY, value);
  return value;
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
    device_id TEXT,
    folio TEXT,
    synced_at DATETIME,
    client_created_at DATETIME,
    conflict_resolved INTEGER DEFAULT 0,
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
    stock_deducted REAL DEFAULT 0,
    service_transaction_id INTEGER
  )`);

  // ─── RECARGAS / SERVICIOS (TAECEL) ─────────────────────────────
  // Ledger propio del proveedor. No se replica a las cajas: la verdad vive en
  // el Host y las cajas la consultan por RPC. `client_request_id` es la llave
  // de idempotencia del renderer; `provider_trans_id` es el transID de Taecel.
  // La referencia completa se guarda cifrada; para buscar y reconciliar se usan
  // `reference_masked` y `reference_hash`.
  db.exec(`CREATE TABLE IF NOT EXISTS service_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_request_id TEXT NOT NULL UNIQUE,
    ref_cte TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'taecel',
    provider_trans_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'requesting',
    provider_status TEXT,
    provider_message TEXT,
    category_id INTEGER,
    carrier_id TEXT,
    carrier_name TEXT,
    carrier_logo TEXT,
    product_code TEXT NOT NULL,
    product_name TEXT,
    reference_masked TEXT,
    reference_hash TEXT,
    reference_enc TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    register_id INTEGER,
    cashier_id INTEGER,
    cashier_name TEXT,
    device_id TEXT,
    sale_id INTEGER,
    sale_folio TEXT,
    provider_folio TEXT,
    saldo_final_cents INTEGER,
    cargo_cents INTEGER,
    abono_cents INTEGER,
    comision_cents INTEGER,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at DATETIME,
    check_attempts INTEGER NOT NULL DEFAULT 0,
    next_check_at DATETIME,
    applied_at DATETIME,
    failed_at DATETIME,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT,
    raw_status_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  // 3g/C · qué APARATO hizo la venta. `sales` sólo se puede atribuir a una
  // caja a través de `register_id`, y una venta sin caja (`register_id IS NULL`)
  // no se podía filtrar de ninguna forma: una caja habría leído y cancelado
  // ventas hechas en otra. Las filas antiguas quedan a NULL, que es lo que
  // significa "no sabido"; los filtros de más abajo las tratan como ajenas.
  ensureColumn("sales", "device_id", "TEXT");
  // Bloque 4/5 · folio continuo por dispositivo y sincronización offline.
  // El folio lo asigna la caja (o el Host para ventas locales) y el índice
  // UNIQUE es la última defensa contra duplicados al sincronizar.
  ensureColumn("sales", "folio", "TEXT");
  ensureColumn("sales", "synced_at", "DATETIME");
  ensureColumn("sales", "client_created_at", "DATETIME");
  ensureColumn("sales", "conflict_resolved", "INTEGER DEFAULT 0");
  ensureColumn("sales", "cancelled_by_device", "TEXT");
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_folio ON sales(folio) WHERE folio IS NOT NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sales_device ON sales(device_id)`,
  );
  // Contador de folios por dispositivo. `device_key` es el device_id de la
  // caja o "host" para el Host. La secuencia nunca se reinicia.
  db.exec(`CREATE TABLE IF NOT EXISTS folio_counters (
    device_key TEXT PRIMARY KEY,
    next_seq INTEGER NOT NULL DEFAULT 1
  )`);
  // Cola de ventas de la caja. Vive también en el Host (vacía) para que el
  // mismo esquema sirva en ambos roles sin migraciones condicionales.
  db.exec(`CREATE TABLE IF NOT EXISTS pending_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    register_id INTEGER,
    cashier_id INTEGER,
    cashier_name TEXT,
    local_created_at DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_sales_folio ON pending_sales(folio)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_pending_sales_status ON pending_sales(status, id)`,
  );
  // Resolución idempotente de conflictos de stock: una fila por venta.
  db.exec(`CREATE TABLE IF NOT EXISTS stock_conflict_resolutions (
    sale_id INTEGER PRIMARY KEY,
    payload_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    resolved_by TEXT,
    resolved_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
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
      "service_transaction_id",
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
        stock_deducted REAL DEFAULT 0,
        service_transaction_id INTEGER
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
  ensureColumn("sale_items", "cancelled_by_device", "TEXT");
  ensureColumn("sale_items", "returned_qty", "REAL DEFAULT 0");
  // Recarga Taecel enlazada a la línea de venta. La usan la impresión, el
  // historial y el candado de cancelación (SERVICE_SALE_NOT_CANCELLABLE).
  ensureColumn("sale_items", "service_transaction_id", "INTEGER");

  // Vendesaldo quedó reemplazado por Taecel. Se borran sus credenciales en
  // claro para que no queden en la BD ni en los respaldos.
  try {
    db.prepare(
      "DELETE FROM settings WHERE key IN ('vendesaldo_user','vendesaldo_pass','vendesaldo_apikey')",
    ).run();
  } catch (err) {}

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
  // 3g/C · filtro por aparato en las ventas sin caja. Cada `db.exec` es de un
  // solo statement: pasar dos literales como argumentos extras se ignora en
  // silencio y el índice no llega a crearse.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sales_device_id ON sales(device_id)`,
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
    `CREATE INDEX IF NOT EXISTS idx_sale_items_service_tx ON sale_items(service_transaction_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_tx_status_next ON service_transactions(status, next_check_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_tx_requested ON service_transactions(requested_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_tx_register ON service_transactions(register_id, status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_tx_sale ON service_transactions(sale_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_tx_reference ON service_transactions(reference_hash)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_tx_device ON service_transactions(device_id, requested_at)`,
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
  // Línea base de stock COMPARTIDA (multicaja): el Host fija cada día MX
  // `day_open_stock` (stock a la medianoche) y mantiene `day_sold` (vendido
  // de hoy) con cada venta. Ambas columnas viajan con `products` y se
  // replican a las cajas. Sin ellas, cada equipo calculaba el "inicial del
  // día" con SUS ventas locales y una caja mostraba "17 de 17" en vez de
  // "17 de 18".
  ensureColumn("products", "day_open_stock", "REAL");
  ensureColumn("products", "day_sold", "REAL DEFAULT 0");
  // Precio fijo de promoción (excluyente con % automático). >0 = aplica a
  // cualquier cantidad.
  ensureColumn("products", "promo_fixed_price", "REAL DEFAULT 0");

  // Migration: add cashier_id to cash_register
  ensureColumn("cash_register", "cashier_id", "INTEGER");
  // Migration: add opened_by and closed_by to cash_register
  ensureColumn("cash_register", "opened_by", "INTEGER");
  ensureColumn("cash_register", "closed_by", "INTEGER");

  // 3a.i · device_id de caja: backfill con el id del Host (sin NULL) + índice.
  const hostDeviceId = ensureHostDeviceId(db);
  ensureColumn("cash_register", "device_id", "TEXT");
  db.prepare(
    "UPDATE cash_register SET device_id = ? WHERE device_id IS NULL",
  ).run(hostDeviceId);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_cash_register_device ON cash_register(device_id)`,
  );

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

  // 3b · sesiones de caja persistidas: solo hashes, el token nunca en claro.
  db.exec(`
  CREATE TABLE IF NOT EXISTS box_sessions (
    token_hash TEXT PRIMARY KEY,
    cashier_id INTEGER NOT NULL,
    device_id TEXT,
    device_type TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked INTEGER NOT NULL DEFAULT 0
  )
`);

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

  // 3d · change_log + triggers de réplica (aditivo e idempotente).
  ensureChangeLog(db);
};

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3d — change_log para la réplica Host → caja.
//
// Tabla aditiva + triggers AFTER INSERT/UPDATE/DELETE en las tablas
// replicables. Cada fila del log guarda el id de la fila afectada como TEXT
// (en `settings` ese id es la propia `key`). Las operaciones masivas dejan un
// único marcador 'bulk' (ver `bulkMarker`) en lugar de inundar el log.
//
// DECISIÓN: los costos NO se replican a las cajas. `products.cost_price` y
// las columnas de PIN de `cashiers` viajan como 0/vacío; el plan de réplica
// (`replicaPlan`) es la única fuente de verdad de qué columnas salen.
// ─────────────────────────────────────────────────────────────────────────────
const CHANGE_LOG_TABLE = "change_log";
const REPLICATED_TABLES = [
  "categories",
  "customer_tiers",
  "products",
  "product_prices",
  "customers",
  "tier_prices",
  "customer_prices",
  "cashiers",
  "settings",
];
const REPLICATED_DENY_COLUMNS = ["cost_price"]; // costos: no viajan a la caja
// 3f · columnas que sólo interesan en el Host. `updated_at` es metadato de
// reconciliación: si viajara, la caja lo pisaría al aplicar el cambio y sólo
// quedaría su hora local en vez de la del Host.
const REPLICATED_LOCAL_COLUMNS = ["updated_at"];
// 3f · tablas de entidad que llevan `updated_at`. `settings` queda fuera: es
// clave/valor, no hay fila-entidad que marcar, y su `change_log.ts` ya dice
// cuándo cambió.
const UPDATED_AT_TABLES = REPLICATED_TABLES.filter((t) => t !== "settings");
// 3f · tumba-sigilo: «(tbl, row_id) ya no está en el conjunto replicable».
// A diferencia de `change_log` no se compacta, así que aunque la caja pierda
// el evento `delete` le sigue quedando de dónde reconciliar.
const TOMBSTONE_TABLE = "replica_tombstones";
const REPLICATED_CASHIER_COLUMNS = ["id", "name", "role", "is_active", "pin_hash", "pin_salt"]; // PIN cacheado (solo cajas aprobadas)
// Subconjunto de `settings` que la caja necesita para vender/mostrar tickets.
const REPLICATED_SETTINGS_KEYS = [
  "store_name",
  "store_address",
  "store_rfc",
  "store_phone",
  "store_email",
  "store_logo",
  "store_website",
  "owner_name",
  "currency",
  "print_enabled",
  "print_two_tickets",
  "print_tax_breakdown",
  "print_header_note",
  "print_footer_note",
  "rounding_enabled",
  "rounding_mode",
  "sale_without_stock",
  "pin_for_void",
];
// 3e · Fila replicable por tabla (fuente única de verdad). Las tablas no
// listadas replican TODAS sus filas. Lo consumen por igual los triggers, el
// snapshot y /api/replica/changes, así que esos tres caminos no pueden desviarse.
//
// `products` se decide por `is_active`: es EXACTAMENTE el criterio con el que
// la propia app pregunta «¿se vende esto?» (búsqueda, escaneo y listados usan
// `is_active = 1`). El catálogo `bd sku.xlsx` queda fuera solo porque nadie lo
// puede vender, no porque sea «catálogo»: excluir por `is_catalog` se lleva
// por delante 4 productos que están activos Y también constan en el XLSX.
const REPLICATED_FILTERS = Object.freeze({
  // `nullValue` separa «nulo» de «valor buscado»: un `is_active` NULL no lo
  // devuelve ninguna consulta de venta, así que tampoco viaja.
  products: Object.freeze({ column: "is_active", value: 1, nullValue: 0 }),
});

// Condición SQL sobre la fila referenciada (`NEW`, `OLD` o el nombre de la
// tabla). Cadena vacía si esa tabla no tiene filtro.
const replicaFilterSql = (tbl, ref) => {
  const f = REPLICATED_FILTERS[tbl];
  if (!f) return "";
  return `COALESCE(${ref}.${f.column}, ${f.nullValue}) = ${f.value}`;
};

const changeLogNow = "CAST(strftime('%s','now') AS INTEGER) * 1000";
const sqlList = (items) => items.map((k) => `'${String(k).replace(/'/g, "''")}'`).join(",");

// Clave de fila en el log: `key` para settings, `id` para el resto.
const changeLogRowId = (tbl, ref) => `CAST(${ref}.${tbl === "settings" ? "key" : "id"} AS TEXT)`;

// 3f · Sentencias que los triggers escriben además del evento. Van dentro de
// los ya existentes para que se apaguen juntos en el modo lote y haya UN solo
// sitio que vigilar. La única excepción es el refresco de `updated_at` en un
// UPDATE, que necesita `WHEN` propio: ver `changeLogTouchTrigger`.
const tombstoneClear = (tbl, ref) =>
  `  DELETE FROM ${TOMBSTONE_TABLE} WHERE tbl = '${tbl}' AND row_id = ${changeLogRowId(tbl, ref)};`;

const tombstoneWrite = (tbl, ref) =>
  `  INSERT OR REPLACE INTO ${TOMBSTONE_TABLE} (tbl, row_id, ts) ` +
  `VALUES ('${tbl}', ${changeLogRowId(tbl, ref)}, ${changeLogNow});`;

// Refresca `updated_at`. SQLite no deja asignar a `NEW` desde un trigger, así
// que sólo cabe un UPDATE sobre la propia tabla; la condición de parada evita
// que el trigger se dispare a sí mismo si algún día se activa
// `recursive_triggers`.
const touchUpdatedAt = (tbl, ref) => {
  if (!UPDATED_AT_TABLES.includes(tbl)) return null;
  return (
    `  UPDATE ${tbl} SET updated_at = ${changeLogNow} ` +
    `WHERE id = ${ref}.id AND (updated_at IS NULL OR updated_at <> ${changeLogNow});`
  );
};

// Trigger de una tabla/operación. `WHEN` filtra el ruido: los PINs de cajero,
// las claves de settings que la caja no usa y las filas que no están en el
// conjunto replicable no generan eventos.
const changeLogTrigger = (tbl, op) => {
  const whens = [];
  if (tbl === "cashiers" && op === "UPDATE") {
    const cols = REPLICATED_CASHIER_COLUMNS.filter((c) => c !== "id");
    whens.push(cols.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(" OR "));
  } else if (tbl === "settings") {
    whens.push(`${op === "DELETE" ? "OLD" : "NEW"}.key IN (${sqlList(REPLICATED_SETTINGS_KEYS)})`);
  }
  const filter = replicaFilterSql(tbl, op === "DELETE" ? "OLD" : "NEW");
  if (filter) whens.push(filter);
  // 3f · el refresco de `updated_at` es un UPDATE sobre ESTA misma tabla. Sin
  // esta cláusula, el trigger de `_insert` dispararía el de `_update` y una
  // sola inserción escribiría dos eventos en el log.
  if (op === "UPDATE" && UPDATED_AT_TABLES.includes(tbl)) {
    whens.push("NEW.updated_at IS OLD.updated_at");
  }
  const when = whens.length ? `WHEN ${whens.join(" AND ")}` : "";
  const source = op === "DELETE" ? "OLD" : "NEW";
  const body = [
    `  INSERT INTO ${CHANGE_LOG_TABLE} (tbl, row_id, op, ts) ` +
      `VALUES ('${tbl}', ${changeLogRowId(tbl, source)}, '${op === "DELETE" ? "delete" : "upsert"}', ${changeLogNow});`,
    op === "DELETE" ? tombstoneWrite(tbl, source) : tombstoneClear(tbl, source),
    // En INSERT la fila siempre acaba de nacer, así que el toque es inevitable
    // y va plegado aquí. El del UPDATE vive en `changeLogTouchTrigger`.
    op === "INSERT" ? touchUpdatedAt(tbl, source) : null,
  ].filter(Boolean);
  return (
    `CREATE TRIGGER IF NOT EXISTS trg_change_log_${tbl}_${op.toLowerCase()} ` +
    `AFTER ${op} ON ${tbl}\n${when}\nBEGIN\n${body.join("\n")}\nEND`
  );
};

// 3e · Trigger de «salida del conjunto replicable». Un `WHEN` simple no basta
// para el UPDATE: la misma fila puede entrar (0 → 1, producto activado) o
// salir (1 → 0, desactivado). El trigger normal cubre la entrada; éste cubre la
// salida y la entrega como `delete` para que la caja la quite. Reutiliza
// `replicaFilterSql` en vez de recalcular la condición: si no, este trigger y
// los otros tres podrían discrepar sobre qué filas viajan.
const changeLogLeaveTrigger = (tbl) => {
  const inside = (ref) => replicaFilterSql(tbl, ref);
  const body = [
    `  INSERT INTO ${CHANGE_LOG_TABLE} (tbl, row_id, op, ts) ` +
      `VALUES ('${tbl}', ${changeLogRowId(tbl, "OLD")}, 'delete', ${changeLogNow});`,
    tombstoneWrite(tbl, "OLD"),
  ].filter(Boolean);
  return (
    `CREATE TRIGGER IF NOT EXISTS trg_change_log_${tbl}_leave ` +
    `AFTER UPDATE ON ${tbl}\n` +
    `WHEN ${inside("OLD")} AND NOT ${inside("NEW")}\nBEGIN\n${body.join("\n")}\nEND`
  );
};

// 3f · Refresco de `updated_at` en un trigger PROPIO y no plegado en el de
// `_update`: sólo así puede llevar `WHEN`, porque SQLite no admite sentencias
// condicionales dentro de un cuerpo. Sin esa guardia el UPDATE se ejecutaba en
// cada escritura aunque el valor no hubiera cambiado, y era —medido, 12
// corridas— lo único que hacía incumplir el coste por venta de la 3d. El nombre
// empieza por `trg_change_log_` a propósito: el modo lote lo apaga con los
// demás y no queda ningún `updated_at` a medias durante una importación.
// Su propio UPDATE vuelve a dispararse sólo si se activara
// `recursive_triggers`, y entonces el `WHEN` ya no cumple → termina solo.
const changeLogTouchTrigger = (tbl) =>
  `CREATE TRIGGER IF NOT EXISTS trg_change_log_${tbl}_touch ` +
  `AFTER UPDATE ON ${tbl}\n` +
  `WHEN NEW.updated_at IS NULL OR NEW.updated_at <> ${changeLogNow}\n` +
  `BEGIN\n  UPDATE ${tbl} SET updated_at = ${changeLogNow} WHERE id = NEW.id;\nEND`;

// 3e · Crea/elimina el conjunto completo de triggers. Centralizado porque los
// usa el arranque Y el modo lote: si estuvieran escritos en dos sitios,
// podrían desviarse y dejar una tabla sin registrar cambios.
const changeLogCreateTriggers = (db) => {
  for (const tbl of REPLICATED_TABLES) {
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      db.exec(changeLogTrigger(tbl, op));
    }
  }
  // Tablas con fila filtrada: además hacen falta los triggers de salida.
  for (const tbl of Object.keys(REPLICATED_FILTERS)) {
    db.exec(changeLogLeaveTrigger(tbl));
  }
  // 3f · refresco de `updated_at` (las 8 tablas de entidad; `settings` no).
  for (const tbl of UPDATED_AT_TABLES) {
    db.exec(changeLogTouchTrigger(tbl));
  }
};

const changeLogDropTriggers = (db) => {
  for (const tbl of REPLICATED_TABLES) {
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      db.exec(`DROP TRIGGER IF EXISTS trg_change_log_${tbl}_${op.toLowerCase()}`);
    }
  }
  for (const tbl of Object.keys(REPLICATED_FILTERS)) {
    db.exec(`DROP TRIGGER IF EXISTS trg_change_log_${tbl}_leave`);
  }
  for (const tbl of UPDATED_AT_TABLES) {
    db.exec(`DROP TRIGGER IF EXISTS trg_change_log_${tbl}_touch`);
  }
};

// ─── Modo lote (Entrega 3e) ──────────────────────────────────────────────────
// Una importación grande genera una fila de `change_log` por INSERT. Con los
// triggers apagados durante el lote no se escribe ni una, y al cerrar se deja
// UNA sola marca (`op='bulk'`) que además adelanta `change_log_first_seq`
// hasta su propio `seq`. Cualquier caja que estuviera antes de la marca cae en
// el mecanismo de hueco ya existente (`LOG_COMPACTED`) y se baja todo otra vez:
// nunca puede quedar un delta mudo con la caja creyendo que va al día.
//
// La bandera `replica_bulk_active` se escribe ANTES de apagar los triggers y
// se borra DESPUÉS de recrearlos, así que un corte de energía en cualquier
// punto se detecta en el arranque y se cierra el lote de forma conservadora.
const BULK_FLAG_KEY = "replica_bulk_active";
const BULK_TABLE = "__bulk__";
const BULK_ROW_ID = "*";
// Por debajo de este tamaño no compensa: el delta fino llega a las cajas en un
// par de frames de SSE y evita obligarlas a rehacer la descarga completa.
const BULK_MIN_ROWS = 1000;

// Lee la bandera tolerando una BD sin `settings` (sólo `change_log`, típico de
// un arranquísimo a medias): leer no puede tumbar el arranque. ESCRIBIR la
// bandera sí falla a lo grande, porque sin `settings` no hay dónde guardarla.
// La bandera es `"1"` o INEXISTENTE, nunca `"0"`: en JS `"0"` es truthy y el
// segundo lote creería que el primero sigue abierto.
const bulkFlagOn = (db) => {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
    .get();
  if (!table) return false;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(BULK_FLAG_KEY);
  return row?.value === "1";
};

const bulkFlagSet = (db) =>
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(BULK_FLAG_KEY);

const bulkFlagClear = (db) =>
  db.prepare("DELETE FROM settings WHERE key = ?").run(BULK_FLAG_KEY);

// Devuelve `true` si el lote empezó realmente (idempotente: dos begin seguidos
// no apagan dos veces ni dejan la bandera a medias).
const beginBulk = (db) => {
  if (bulkFlagOn(db)) return false;
  bulkFlagSet(db);
  changeLogDropTriggers(db);
  return true;
};

// Devuelve el `seq` de la marca, o `null` si no había lote abierto.
const endBulk = (db) => {
  if (!bulkFlagOn(db)) return null;
  const info = db
    .prepare(
      `INSERT INTO ${CHANGE_LOG_TABLE} (tbl, row_id, op, ts) VALUES (?, ?, 'bulk', ${changeLogNow})`,
    )
    .run(BULK_TABLE, BULK_ROW_ID);
  const seq = Number(info.lastInsertRowid);
  // El hueco empieza en la propia marca: todo lo anterior deja de ser servible.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "change_log_first_seq",
    String(seq),
  );
  // Los triggers vuelven ANTES de soltar la bandera. Si caemos justo aquí, al
  // arrancar `ensureChangeLog` verá la bandera y repetirá este cierre; si
  // soltáramos la bandera primero, los triggers podrían quedar ausentes para
  // siempre y la caja dejaría de recibir cambios sin enterarse.
  ensureTriggersForRole(db);
  bulkFlagClear(db);
  return { seq };
};

// A3 · el rol del dispositivo leído de la propia BD. Tolera una BD sin
// `settings` (una recién nacida) y una clave basura: para algo falla a host.
const isClientRole = (db) => {
  try {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'device_role'")
      .get();
    return !!row && String(row.value || "").toLowerCase() === "client";
  } catch (err) {
    return false;
  }
};

// A3 · reescribe el conjunto completo de triggers PERO en rol cliente no
// instala ninguno. La caja no genera eventos de réplica (sólo los consume) y
// sus propios `change_log`/`replica_tombstones` crecerían sin que los lea
// nadie. Si ya existían de cuando el rol era host, aquí se eliminan.
const ensureTriggersForRole = (db) => {
  changeLogDropTriggers(db);
  if (isClientRole(db)) return false;
  changeLogCreateTriggers(db);
  return true;
};

const ensureChangeLog = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CHANGE_LOG_TABLE} (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl TEXT NOT NULL,
      row_id TEXT,
      op TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_change_log_tbl_row ON ${CHANGE_LOG_TABLE}(tbl, row_id)`,
  );
  // 3f · la tumba-sigilo se crea aquí y no en `createTables`: es parte del
  // mismo mecanismo que `change_log`, y una BD sin réplica no la necesita.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TOMBSTONE_TABLE} (
      tbl TEXT NOT NULL,
      row_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (tbl, row_id)
    );
  `);
  // 3f · las columnas se aseguran ANTES de escribir los triggers que las usan.
  // Idéntico en BD nueva y en BD existente: si el `DEFAULT` se declarara en
  // CREATE TABLE, la migración de una BD con filas lo rechazaría
  // ("Cannot add a column with non-constant default").
  for (const tbl of UPDATED_AT_TABLES) ensureColumnOn(db, tbl, "updated_at", "INTEGER");
  // 3f · `CREATE TRIGGER IF NOT EXISTS` no reescribe un cuerpo ya creado, así
  // que se dropean y se vuelven a crear: sin esto, una BD existente se
  // quedaría para siempre con los triggers de la entrega que los creó. En rol
  // cliente no se reinstalan (A3): la caja no genera eventos de réplica.
  ensureTriggersForRole(db);
  // Recuperación: si el Host murió con un lote abierto, aquí se cierra. Es
  // conservador (adelanta el hueco aunque no se haya apagado nada) y siempre
  // mejor que dejar los triggers ausentes.
  if (bulkFlagOn(db)) endBulk(db);
};

// Columnas que se replican de cada tabla (fuente única de verdad).
const replicaPlan = (db) => {
  const plan = {};
  for (const tbl of REPLICATED_TABLES) {
    const cols = db
      .prepare(`PRAGMA table_info(${tbl})`)
      .all()
      .map((c) => c.name);
    plan[tbl] =
      tbl === "cashiers"
        ? cols.filter((c) => REPLICATED_CASHIER_COLUMNS.includes(c))
        : cols.filter(
            (c) =>
              !REPLICATED_DENY_COLUMNS.includes(c) &&
              !REPLICATED_LOCAL_COLUMNS.includes(c),
          );
  }
  return plan;
};

module.exports = {
  ensureColumn: ensureColumnOn,
  ensureHostDeviceId,
  HOST_DEVICE_ID_KEY,
  createTables,
  runMigrations,
  ensureChangeLog,
  ensureTriggersForRole,
  isClientRole,
  replicaPlan,
  replicaFilterSql,
  beginBulk,
  endBulk,
  CHANGE_LOG_TABLE,
  REPLICATED_TABLES,
  REPLICATED_FILTERS,
  REPLICATED_DENY_COLUMNS,
  REPLICATED_LOCAL_COLUMNS,
  UPDATED_AT_TABLES,
  TOMBSTONE_TABLE,
  REPLICATED_CASHIER_COLUMNS,
  REPLICATED_SETTINGS_KEYS,
  BULK_FLAG_KEY,
  BULK_MIN_ROWS,
};
