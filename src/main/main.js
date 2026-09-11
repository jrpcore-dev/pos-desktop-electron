const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const legacyUserData = path.join(app.getPath("appData"), "JRP POS");
const overrideUserData = process.env.VENDIA_USERDATA;
if (overrideUserData) {
  app.setPath("userData", overrideUserData);
} else if (fs.existsSync(legacyUserData)) {
  app.setPath("userData", legacyUserData);
}

app.setAppUserModelId("com.vendia.desktop");

const dbDir = path.join(app.getPath("userData"), "db");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const logDir = path.join(app.getPath("userData"), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const errorLogPath = path.join(logDir, "vendia-error.log");

const appendErrorLog = (entry) => {
  try {
    if (
      fs.existsSync(errorLogPath) &&
      fs.statSync(errorLogPath).size > 5 * 1024 * 1024
    ) {
      const old = path.join(logDir, "vendia-error.old.log");
      if (fs.existsSync(old)) fs.unlinkSync(old);
      fs.renameSync(errorLogPath, old);
    }
    fs.appendFileSync(errorLogPath, entry);
  } catch (e) {}
};

process.on("uncaughtException", (err) => {
  appendErrorLog(
    `[${new Date().toISOString()}] uncaughtException\n${err && err.stack ? err.stack : String(err)}\n---\n`,
  );
});
process.on("unhandledRejection", (reason) => {
  appendErrorLog(
    `[${new Date().toISOString()}] unhandledRejection\n${reason instanceof Error ? reason.stack : String(reason)}\n---\n`,
  );
});

ipcMain.handle("log-error", (e, payload) => {
  appendErrorLog(
    `[${new Date().toISOString()}] renderer\n${String(payload)}\n---\n`,
  );
});

const dbPath = path.join(dbDir, "pos-system.db");
let db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();
try {
  db.function("nomar", nomarize);
} catch (e) {}

const ensureColumn = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const createTables = () => {
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    price_at_sale REAL NOT NULL,
    discount_percent REAL DEFAULT 0
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

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
  // Make product_id nullable (recreate table) using a fresh PRAGMA check
  const siColsFresh = db.prepare("PRAGMA table_info(sale_items)").all();
  const pcol = siColsFresh.find((c) => c.name === "product_id");
  if (pcol && pcol.notnull === 1) {
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
      `INSERT INTO sale_items_v2 (id, sale_id, product_id, product_name, quantity, price_at_sale, discount_percent, stock_deducted) SELECT id, sale_id, product_id, product_name, quantity, price_at_sale, discount_percent, stock_deducted FROM sale_items`,
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
};

createTables();

const runMigrations = () => {
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
};

runMigrations();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const apiServer = require("./api-server");
const discovery = require("./discovery");

let mainWin = null;
let isQuitting = false;
let tray = null;

// ─── AUTO-UPDATER (GitHub Releases) ─────────────────────────────────────────
let updateState = null;
let updateDownloading = false;

const sendUpdateStatus = (payload) => {
  updateState = payload;
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("update:status", payload);
  }
};

const setupAutoUpdater = () => {
  autoUpdater.autoDownload = false; // Solo descarga si el usuario hace clic
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({ status: "available", version: info && info.version });
  });
  autoUpdater.on("download-progress", (p) => {
    sendUpdateStatus({
      status: "downloading",
      percent: p && p.percent != null ? Math.round(p.percent) : 0,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({ status: "downloaded", version: info && info.version });
  });
  autoUpdater.on("update-not-available", () => {
    if (updateState && updateState.status !== "idle") {
      sendUpdateStatus({ status: "idle" });
    }
  });
  autoUpdater.on("error", (err) => {
    const message = err && err.message ? err.message : String(err);
    if (!updateDownloading) {
      // Error de check (repo/release no disponible, red, etc.): no hay
      // actualización real -> ocultar el botón en vez de mostrarlo.
      if (updateState && updateState.status !== "idle") {
        sendUpdateStatus({ status: "idle" });
      }
      return;
    }
    updateDownloading = false;
    sendUpdateStatus({ status: "error", message });
  });

  const check = () => {
    if (!app.isPackaged) return;
    if (updateState && updateState.status === "downloaded") return;
    autoUpdater.checkForUpdates().catch(() => {});
  };

  if (app.isPackaged) {
    setTimeout(check, 8000);
    setInterval(check, 4 * 60 * 60 * 1000);
  }
};

ipcMain.handle("update:download", async () => {
  if (!app.isPackaged) {
    return { success: false, error: "No disponible en desarrollo" };
  }
  try {
    updateDownloading = true;
    await autoUpdater.downloadUpdate();
    updateDownloading = false;
    return { success: true };
  } catch (err) {
    updateDownloading = false;
    const message = err && err.message ? err.message : String(err);
    if (!updateState || updateState.status !== "error") {
      sendUpdateStatus({ status: "error", message });
    }
    return { success: false, error: message };
  }
});

ipcMain.handle("update:install", () => {
  if (updateState && updateState.status === "downloaded") {
    autoUpdater.quitAndInstall();
    return { success: true };
  }
  return { success: false, error: "No hay actualización descargada" };
});

ipcMain.handle("update:get-state", () => updateState || { status: "idle" });

const createTray = () => {
  try {
    const devIcon = path.join(__dirname, "../../build/Icon.ico");
    const prodIcon = path.join(process.resourcesPath, "Icon.ico");
    const iconPath = fs.existsSync(devIcon) ? devIcon : prodIcon;
    const icon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createFromDataURL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMgmEAANwzAAPkCkNyAAAAAElFTkSuQmCC",
        );
    tray = new Tray(icon);
    tray.setToolTip("Sistema Ventas - POS (servidor activo)");
    const menu = Menu.buildFromTemplate([
      {
        label: "Abrir Sistema",
        click: () => {
          if (!mainWin || mainWin.isDestroyed()) {
            createMainWindow();
          } else {
            mainWin.show();
            mainWin.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "Salir",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => {
      if (!mainWin || mainWin.isDestroyed()) {
        createMainWindow();
      } else {
        mainWin.show();
        mainWin.focus();
      }
    });
  } catch (err) {
    console.error("Error creating tray:", err.message);
  }
};

// Debe coincidir con --secondary y --secondary-foreground en src/renderer/index.css
// (modo claro = :root, modo oscuro = .dark). Si alguien cambia esos tokens de
// diseño, debe actualizar también estos valores.
const TITLEBAR_COLORS = {
  light: { color: "#f1f5f9", symbolColor: "#0f1729" },
  dark: { color: "#1d283a", symbolColor: "#f8fafc" },
};
const TITLEBAR_HEIGHT = 56; // Altura de la barra nativa = h-14 del navbar (Layout.jsx)

ipcMain.on("set-titlebar-theme", (event, mode) => {
  if (!mainWin || mainWin.isDestroyed()) return;
  const colors = TITLEBAR_COLORS[mode === "dark" ? "dark" : "light"];
  mainWin.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
});

const createMainWindow = () => {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hidden",
    titleBarOverlay: { ...TITLEBAR_COLORS.light, height: TITLEBAR_HEIGHT },
    title: "Vendia",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWin.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  try {
    const devURL =
      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined"
        ? MAIN_WINDOW_VITE_DEV_SERVER_URL
        : null;
    if (devURL) {
      mainWin.loadURL(devURL);
    } else {
      mainWin.loadFile(
        path.join(__dirname, `../renderer/main_window/index.html`),
      );
    }
  } catch (err) {
    console.error("Error loading window:", err.message);
  }

  return mainWin;
};

app.on("ready", () => {
  // Sin menú de aplicación: evita recargas accidentales (Ctrl+R) y devtools
  Menu.setApplicationMenu(null);
  migrateLegacyBackups();
  migrateRegisterContinuity();
  maybeRunAutoBackup();
  setInterval(maybeRunAutoBackup, 6 * 60 * 60 * 1000);

  seedCatalogIfEmpty(process.env.JRP_FORCE_CATALOG_IMPORT === "1");

  createMainWindow();
  createTray();
  setupAutoUpdater();

  // Pre-compila el worker del cajón en segundo plano para que la primera
  // apertura también sea rápida (no bloquea el arranque).
  ensureDrawerWorker().catch(() => {});

  // Start local API server for mobile app
  (async () => {
    const result = await apiServer.startServer(db, 3456);
    if (result.success) {
      await discovery.startDiscovery(3456);
      console.log(`Mobile API ready on port ${3456}`);
    } else {
      console.error("Failed to start mobile API:", result.error);
    }
  })();

  // Task reminder checker every 30 seconds
  setInterval(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    try {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Mexico_City",
      });
      const now = new Date();
      const mxTimeStr = now.toLocaleString("en-US", {
        timeZone: "America/Mexico_City",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const [currH, currM] = mxTimeStr.split(":").map(Number);
      const currentMinutes = currH * 60 + currM;
      const tasks = db
        .prepare(
          "SELECT * FROM tasks WHERE task_date = ? AND completed = 0 AND task_time IS NOT NULL",
        )
        .all(today);
      for (const task of tasks) {
        if (notifiedTasks.has(task.id)) continue;
        const [h, m] = task.task_time.split(":").map(Number);
        const taskMinutes = h * 60 + m;
        const reminderMinutes = task.reminder_minutes || 30;
        if (
          currentMinutes >= taskMinutes - reminderMinutes &&
          currentMinutes <= taskMinutes + 1
        ) {
          notifiedTasks.add(task.id);
          mainWin.webContents.send("task-reminder", {
            id: task.id,
            title: task.title,
            description: task.description,
            task_time: task.task_time,
          });
        }
      }
    } catch (e) {
      console.error("[TASKS REMINDER ERROR]", e.message);
    }
  }, 30000);
});

app.on("before-quit", () => {
  isQuitting = true;
  destroyDrawerWorker();
  apiServer.stopServer();
  discovery.stopDiscovery();
});

app.on("window-all-closed", () => {
  if (isQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWin || BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    mainWin.show();
  }
});

app.on("second-instance", () => {
  if (!mainWin || mainWin.isDestroyed()) {
    createMainWindow();
  } else {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
});

// ─── PRODUCTS ───────────────────────────────────────────────

const savePrices = (productId, prices) => {
  const txn = db.transaction(() => {
    db.prepare("DELETE FROM product_prices WHERE product_id = ?").run(
      productId,
    );
    const stmt = db.prepare(
      "INSERT INTO product_prices (product_id, type, qty, price) VALUES (?, ?, ?, ?)",
    );
    for (const p of prices || []) {
      const type = p.type === "mayoreo" ? "mayoreo" : "combo";
      const qty = Math.max(1, parseInt(p.qty) || 1);
      const price = parseFloat(p.price) || 0;
      if (qty > 0 && price > 0) stmt.run(productId, type, qty, price);
    }
  });
  txn();
};

const attachPrices = (products) => {
  if (!products || !products.length) return products;
  const rows = db
    .prepare(
      `SELECT product_id, type, qty, price FROM product_prices WHERE product_id IN (${products.map(() => "?").join(",")}) ORDER BY product_id, qty`,
    )
    .all(...products.map((p) => p.id));
  const map = {};
  for (const r of rows) {
    (map[r.product_id] = map[r.product_id] || []).push({
      type: r.type,
      qty: r.qty,
      price: r.price,
    });
  }
  for (const p of products) p.prices = map[p.id] || [];
  return products;
};

const attachDaySummary = (products) => {
  if (!products || !products.length) return products;
  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const { start, end } = toUTCDateRange(mxToday());

  const movRows = db
    .prepare(
      `SELECT product_id, type, SUM(quantity) as qty
       FROM stock_movements
       WHERE product_id IN (${placeholders}) AND created_at >= ? AND created_at < ?
       GROUP BY product_id, type`,
    )
    .all(...ids, start, end);
  const saleRows = db
    .prepare(
      `SELECT si.product_id, SUM(si.stock_deducted) as qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id IN (${placeholders}) AND s.created_at >= ? AND s.created_at < ?
       GROUP BY si.product_id`,
    )
    .all(...ids, start, end);

  const todayIn = {};
  const todayOut = {};
  const todayDev = {};
  const todaySold = {};
  for (const r of movRows) {
    if (r.type === "in") todayIn[r.product_id] = r.qty || 0;
    else if (r.type === "out") todayOut[r.product_id] = r.qty || 0;
    else if (r.type === "devolution") todayDev[r.product_id] = r.qty || 0;
  }
  for (const r of saleRows) todaySold[r.product_id] = r.qty || 0;

  for (const p of products) {
    const ti = todayIn[p.id] || 0;
    const to = todayOut[p.id] || 0;
    const td = todayDev[p.id] || 0;
    const ts = todaySold[p.id] || 0;
    p.todayIn = ti;
    p.todaySold = ts;
    p.startOfDay = (p.stock || 0) - ti - td + to + ts;
  }
  return products;
};

ipcMain.handle("get-products", async (event, params) => {
  const {
    search,
    category_id,
    supplier_id,
    sortField,
    sortDir,
    page,
    rowsPerPage,
  } = params || {};
  const conditions = [];
  const queryParams = [];
  if (search && search.length >= 2) {
    conditions.push(
      "(nomar(p.name) LIKE ? OR nomar(p.brand) LIKE ? OR p.barcode LIKE ?)",
    );
    const n = `%${nomarize(search)}%`;
    const raw = `%${search.trim()}%`;
    queryParams.push(n, n, raw);
  }
  if (category_id) {
    conditions.push("p.category_id = ?");
    queryParams.push(parseInt(category_id));
  }
  if (supplier_id) {
    conditions.push("p.supplier_id = ?");
    queryParams.push(parseInt(supplier_id));
  }
  const where =
    conditions.length > 0
      ? "WHERE " + conditions.join(" AND ") + " AND p.is_active = 1"
      : "WHERE p.is_active = 1";
  const allowedSort = { name: "p.name", price: "p.price", stock: "p.stock" };
  const col = allowedSort[sortField] || "p.name";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const total = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM products p ${where}
  `,
    )
    .get(...queryParams).count;

  const limit = Math.min(Math.max(parseInt(rowsPerPage) || 10, 1), 100);
  const offset = Math.max(parseInt(page) || 0, 0) * limit;

  const products = db
    .prepare(
      `
    SELECT p.id, p.name, p.barcode, p.price, p.stock, p.cost_price, p.sale_unit,
           p.min_stock, p.box_qty, p.box_price, p.pack_qty, p.discount_percent,
           p.has_discount, p.supplier_id, p.category_id,
           p.brand, p.image_path,
           c.name as category_name, s.name as supplier_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    ${where}
    ORDER BY ${col} ${dir}
    LIMIT ? OFFSET ?
  `,
    )
    .all(...queryParams, limit, offset);

  const statsConditions =
    conditions.length > 0
      ? conditions.join(" AND ") + " AND p.is_active = 1"
      : "p.is_active = 1";
  const statsParams = conditions.length > 0 ? [...queryParams] : [];

  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) as totalCount,
      COALESCE(SUM(p.price * p.stock), 0) as totalValue,
      SUM(CASE WHEN p.stock <= COALESCE(p.min_stock, 5) THEN 1 ELSE 0 END) as lowStockCount,
      SUM(CASE WHEN p.discount_percent > 0 THEN 1 ELSE 0 END) as discountedCount
    FROM products p WHERE ${statsConditions}
  `,
    )
    .get(...statsParams);

  return { products: attachDaySummary(attachPrices(products)), total, stats };
});

ipcMain.handle("get-all-products", async () => {
  const products = db
    .prepare(
      `
    SELECT p.*, c.name as category_name, s.name as supplier_name, s.phone as supplier_phone
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    ORDER BY p.name ASC
  `,
    )
    .all();

  return { products: attachPrices(products) };
});

ipcMain.handle("get-next-barcode", async () => {
  const { m } = db
    .prepare(
      `SELECT MAX(CAST(barcode AS INTEGER)) AS m FROM products WHERE barcode GLOB '2000000[0-9]*'`,
    )
    .get();
  return String(Math.max(m || 0, 2000000000) + 1);
});

ipcMain.handle("check-barcode-exists", async (event, barcode) => {
  if (!barcode) return { exists: false };
  const row = db
    .prepare(
      `SELECT id, name, cat_name, brand, is_active, is_catalog,
              sale_unit, box_qty, box_price, category_id
       FROM products WHERE barcode = ?`,
    )
    .get(String(barcode).trim());
  if (!row) return { exists: false };
  return {
    exists: true,
    active: row.is_active === 1,
    name: row.name,
    cat_name: row.cat_name || "",
    brand: row.brand || "",
    id: row.id,
    is_catalog: row.is_catalog === 1,
    sale_unit: row.sale_unit || null,
    box_qty: row.box_qty || 0,
    box_price: row.box_price || 0,
    category_id: row.category_id,
  };
});

const autoMinStock = (stock) =>
  Math.max(1, Math.floor((parseFloat(stock) || 0) * 0.4));

ipcMain.handle("add-product", async (event, product) => {
  const {
    barcode,
    name,
    brand,
    price,
    stock,
    category_id,
    supplier_id,
    expiry_date,
    image_path,
    cost_price,
    min_stock,
    discount_percent,
    has_discount,
    sale_unit,
    box_qty,
    box_price,
    pack_qty,
    pack_price,
    prices,
  } = product;
  try {
    const existing = db
      .prepare("SELECT id, is_active FROM products WHERE barcode = ?")
      .get(barcode);
    if (existing && existing.is_active)
      return {
        success: false,
        error: "Ya existe un producto con este código de barras",
      };

    const minStock =
      parseFloat(min_stock) > 0 ? parseFloat(min_stock) : autoMinStock(stock);

    if (existing) {
      const stmt = db.prepare(`UPDATE products SET
        name=?, brand=?, price=?, stock=?, category_id=?, supplier_id=?,
        expiry_date=?, image_path=?, cost_price=?, min_stock=?, discount_percent=?, has_discount=?, is_active=1, sale_unit=?, box_qty=?, box_price=?, pack_qty=?, pack_price=?
        WHERE id=?`);
      stmt.run(
        name,
        brand,
        price,
        stock || 0,
        category_id || null,
        supplier_id || null,
        expiry_date || null,
        image_path || null,
        cost_price || 0,
        minStock,
        discount_percent || 0,
        has_discount ? 1 : 0,
        sale_unit || "piece",
        box_qty || 0,
        box_price || 0,
        pack_qty || 0,
        pack_price || 0,
        existing.id,
      );
      savePrices(existing.id, prices);
      return { success: true, id: existing.id, overwritten: true };
    }

    const stmt = db.prepare(`INSERT INTO products
      (barcode, name, brand, price, stock, category_id, supplier_id, expiry_date, image_path, cost_price, min_stock, discount_percent, has_discount, sale_unit, box_qty, box_price, pack_qty, pack_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const info = stmt.run(
      barcode,
      name,
      brand,
      price,
      stock || 0,
      category_id || null,
      supplier_id || null,
      expiry_date || null,
      image_path || null,
      cost_price || 0,
      minStock,
      discount_percent || 0,
      has_discount ? 1 : 0,
      sale_unit || "piece",
      box_qty || 0,
      box_price || 0,
      pack_qty || 0,
      pack_price || 0,
    );
    savePrices(info.lastInsertRowid, prices);
    return { success: true, id: info.lastInsertRowid };
  } catch (error) {
    let msg = error.message;
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
      msg = "Ya existe un producto con este código de barras";
    return { success: false, error: msg };
  }
});

ipcMain.handle("update-product", async (event, id, product) => {
  try {
    if (!product || !id) return { success: false, error: "Datos inválidos" };
    const {
      barcode,
      name,
      brand,
      price,
      stock,
      category_id,
      supplier_id,
      expiry_date,
      image_path,
      cost_price,
      min_stock,
      discount_percent,
      has_discount,
      is_active,
      sale_unit,
      box_qty,
      box_price,
      pack_qty,
      pack_price,
      prices,
    } = product;

    const dup = db
      .prepare("SELECT id FROM products WHERE barcode = ? AND id != ?")
      .get(barcode, id);
    if (dup)
      return {
        success: false,
        error: "Ya existe otro producto con este código de barras",
      };

    const stmt = db.prepare(`UPDATE products SET
      barcode=?, name=?, brand=?, price=?, stock=?, category_id=?, supplier_id=?,
      expiry_date=?, image_path=?, cost_price=?, min_stock=?, discount_percent=?, has_discount=?, is_active=?, sale_unit=?, box_qty=?, box_price=?, pack_qty=?, pack_price=?
      WHERE id=?`);
    const info = stmt.run(
      barcode || "",
      name,
      brand,
      price,
      stock,
      category_id || null,
      supplier_id || null,
      expiry_date || null,
      image_path || null,
      cost_price || 0,
      parseFloat(min_stock) > 0 ? parseFloat(min_stock) : autoMinStock(stock),
      discount_percent || 0,
      has_discount ? 1 : 0,
      is_active !== undefined ? is_active : 1,
      sale_unit || "piece",
      box_qty || 0,
      box_price || 0,
      pack_qty || 0,
      pack_price || 0,
      id,
    );
    savePrices(id, prices);
    return info.changes > 0
      ? { success: true }
      : { success: false, error: "Producto no encontrado" };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-product", async (event, productId) => {
  try {
    const info = db
      .prepare("UPDATE products SET is_active = 0 WHERE id = ?")
      .run(productId);
    return { success: true, changes: info.changes };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-product-by-barcode", async (event, barcode) => {
  try {
    const product = db
      .prepare("SELECT * FROM products WHERE barcode = ? AND is_active = 1")
      .get(barcode);
    return {
      success: !!product,
      product: product ? attachPrices([product])[0] : null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("search-products", async (event, query) => {
  try {
    return attachPrices(
      db
        .prepare(
          `
      SELECT p.*, c.name as category_name FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE (nomar(p.name) LIKE ? OR p.barcode LIKE ?) AND p.is_active = 1
      ORDER BY p.name LIMIT 20
    `,
        )
        .all(`%${nomarize(query)}%`, `%${query}%`),
    );
  } catch (error) {
    return [];
  }
});

ipcMain.handle("get-products-by-ids", async (event, ids) => {
  try {
    const arr = (Array.isArray(ids) ? ids : [])
      .map((v) => parseInt(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (arr.length === 0) return [];
    const placeholders = arr.map(() => "?").join(",");
    return db
      .prepare(
        `
        SELECT p.* FROM products p
        WHERE p.id IN (${placeholders}) AND p.is_active = 1
      `,
      )
      .all(...arr);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("get-top-products", async () => {
  try {
    return db
      .prepare(
        `
      SELECT p.*, c.name as category_name, COALESCE(SUM(si.quantity),0) as total_sold
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      LEFT JOIN sales s ON si.sale_id = s.id AND (s.status IS NULL OR s.status != 'cancelado')
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 20
    `,
      )
      .all();
  } catch (error) {
    return [];
  }
});

// ─── CATEGORIES ─────────────────────────────────────────────

ipcMain.handle("get-low-stock-count", async () => {
  try {
    const { count } = db
      .prepare(
        "SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND stock <= COALESCE(min_stock, 5)",
      )
      .get();
    return { success: true, count };
  } catch (error) {
    return { success: false, error: error.message, count: 0 };
  }
});

ipcMain.handle("get-categories", async () => {
  return db
    .prepare(
      `
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `,
    )
    .all();
});

ipcMain.handle("add-category", async (event, data) => {
  try {
    const info = db
      .prepare("INSERT INTO categories (name, description) VALUES (?, ?)")
      .run(data.name, data.description || "");
    return { success: true, id: info.lastInsertRowid };
  } catch (error) {
    return {
      success: false,
      error:
        error.code === "SQLITE_CONSTRAINT_UNIQUE"
          ? "Ya existe una categoría con ese nombre"
          : error.message,
    };
  }
});

ipcMain.handle("update-category", async (event, id, data) => {
  try {
    db.prepare("UPDATE categories SET name=?, description=? WHERE id=?").run(
      data.name,
      data.description || "",
      id,
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-category", async (event, id) => {
  try {
    const linked = db
      .prepare("SELECT COUNT(*) as count FROM products WHERE category_id = ?")
      .get(id);
    if (linked.count > 0)
      return {
        success: false,
        error: `No se puede eliminar: ${linked.count} producto(s) usan esta categoría`,
      };
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── SUPPLIERS ──────────────────────────────────────────────

ipcMain.handle("get-suppliers", async () => {
  return db
    .prepare(
      `
    SELECT s.*, COUNT(p.id) as product_count
    FROM suppliers s
    LEFT JOIN products p ON s.id = p.supplier_id
    GROUP BY s.id
    ORDER BY s.name
  `,
    )
    .all();
});

ipcMain.handle("add-supplier", async (event, data) => {
  try {
    const info = db
      .prepare(
        "INSERT INTO suppliers (name, contact, phone, email, address) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        data.name,
        data.contact || "",
        data.phone || "",
        data.email || "",
        data.address || "",
      );
    return { success: true, id: info.lastInsertRowid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("update-supplier", async (event, id, data) => {
  try {
    db.prepare(
      "UPDATE suppliers SET name=?, contact=?, phone=?, email=?, address=? WHERE id=?",
    ).run(
      data.name,
      data.contact || "",
      data.phone || "",
      data.email || "",
      data.address || "",
      id,
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-supplier", async (event, id) => {
  try {
    const linked = db
      .prepare("SELECT COUNT(*) as count FROM products WHERE supplier_id = ?")
      .get(id);
    if (linked.count > 0)
      return {
        success: false,
        error: `No se puede eliminar: ${linked.count} producto(s) usan este proveedor`,
      };
    db.prepare("DELETE FROM suppliers WHERE id = ?").run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── STOCK MOVEMENTS ────────────────────────────────────────

const roundCash = (amount) => {
  const base = Math.floor(amount);
  const cents = Math.round((amount - base) * 100);
  if (cents <= 29) return base;
  if (cents <= 79) return base + 0.5;
  return base + 1;
};

ipcMain.handle(
  "add-stock",
  async (
    event,
    {
      productId,
      quantity,
      cost,
      cashierId,
      registerExpense,
      supplierId,
      updateCostPrice,
    },
  ) => {
    const txn = db.transaction(() => {
      const product = db
        .prepare(
          "SELECT name, cost_price, sale_unit, box_qty FROM products WHERE id = ?",
        )
        .get(productId);
      if (!product) throw new Error("Producto no encontrado");

      const rawQty = String(quantity ?? "").trim();
      const isWeightUnit = product.sale_unit === "weight";
      const qty = isWeightUnit
        ? parseFloat(rawQty)
        : /^\d+$/.test(rawQty)
          ? parseInt(rawQty, 10)
          : NaN;
      if (!isFinite(qty) || qty <= 0)
        throw new Error(
          isWeightUnit
            ? "Cantidad no válida"
            : "Cantidad no válida. Solo números enteros.",
        );

      const isBox =
        (product.sale_unit === "box" ||
          product.sale_unit === "package" ||
          product.sale_unit === "boxpack") &&
        product.box_qty > 0;
      const totalCost =
        cost && parseFloat(cost) > 0
          ? parseFloat(cost)
          : isBox
            ? ((product.cost_price || 0) / product.box_qty) * qty
            : (product.cost_price || 0) * qty;
      const roundedCost = roundCash(totalCost);

      // Optional cost price update (the user confirmed the new unit/box cost)
      if (
        updateCostPrice !== undefined &&
        !isNaN(parseFloat(updateCostPrice))
      ) {
        const rounded =
          Math.round((parseFloat(updateCostPrice) + Number.EPSILON) * 100) /
          100;
        db.prepare("UPDATE products SET cost_price = ? WHERE id = ?").run(
          rounded,
          productId,
        );
      }

      const supplier = supplierId
        ? db
            .prepare("SELECT id, name FROM suppliers WHERE id = ?")
            .get(supplierId)
        : null;
      const supplierName = supplier?.name || null;

      db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(
        qty,
        productId,
      );
      db.prepare(
        "INSERT INTO stock_movements (product_id, type, quantity, cost, notes, cashier_id, supplier_id) VALUES (?, 'in', ?, ?, ?, ?, ?)",
      ).run(
        productId,
        qty,
        roundedCost,
        supplierName
          ? `Compra de inventario — ${supplierName}`
          : "Compra de inventario",
        cashierId || null,
        supplier ? supplier.id : null,
      );

      // Register the cost as an expense (even if no cash register is open)
      // unless the user opted to pay via "Retiro de Efectivo" (registerExpense=false).
      if (registerExpense !== false) {
        const openReg = findOpenRegister(cashierId, "cashier");
        if (roundedCost > 0) {
          if (openReg) {
            db.prepare(
              "UPDATE cash_register SET expenses = COALESCE(expenses, 0) + ? WHERE id = ?",
            ).run(roundedCost, openReg.id);
          }
          const reason = supplierName
            ? `Compra de ${product.name} — ${supplierName}`
            : `Compra de inventario: ${product.name}`;
          db.prepare(
            "INSERT INTO cash_register_expenses (register_id, amount, reason, product_id, quantity) VALUES (?, ?, ?, ?, ?)",
          ).run(
            openReg ? openReg.id : null,
            roundedCost,
            reason,
            productId,
            qty,
          );
        }
      }

      return { productName: product.name };
    });
    try {
      const result = txn();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "adjust-stock",
  async (event, { productId, quantity, notes, cashierId }) => {
    const txn = db.transaction(() => {
      const product = db
        .prepare("SELECT name, stock FROM products WHERE id = ?")
        .get(productId);
      if (!product) throw new Error("Producto no encontrado");
      const oldStock = product.stock;
      const diff = quantity - oldStock;
      const type = diff >= 0 ? "in" : "out";
      db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(
        quantity,
        productId,
      );
      if (diff !== 0) {
        db.prepare(
          "INSERT INTO stock_movements (product_id, type, quantity, notes, cashier_id) VALUES (?, ?, ?, ?, ?)",
        ).run(
          productId,
          type,
          Math.abs(diff),
          notes || "Ajuste manual",
          cashierId || null,
        );
      }
    });
    try {
      txn();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "remove-stock",
  async (event, { productId, quantity, notes, role, cashierId }) => {
    if (!role || role !== "admin") {
      return {
        success: false,
        error: "Solo el propietario puede hacer salidas de stock",
      };
    }
    const txn = db.transaction(() => {
      const product = db
        .prepare("SELECT name, stock, sale_unit FROM products WHERE id = ?")
        .get(productId);
      if (!product) throw new Error("Producto no encontrado");
      const rawQty = String(quantity ?? "").trim();
      const isWeightUnit = product.sale_unit === "weight";
      const qty = isWeightUnit
        ? parseFloat(rawQty)
        : /^\d+$/.test(rawQty)
          ? parseInt(rawQty, 10)
          : NaN;
      if (!isFinite(qty) || qty <= 0)
        throw new Error(
          isWeightUnit
            ? "Cantidad inválida"
            : "Cantidad no válida. Solo números enteros.",
        );
      if (product.stock < qty) throw new Error("Stock insuficiente");
      db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(
        qty,
        productId,
      );
      db.prepare(
        "INSERT INTO stock_movements (product_id, type, quantity, notes, cashier_id) VALUES (?, 'out', ?, ?, ?)",
      ).run(productId, qty, notes || "Salida de stock", cashierId || null);
    });
    try {
      txn();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "get-stock-movements",
  async (
    event,
    { search, type, startDate, endDate, cashierId, role, supplierId } = {},
  ) => {
    try {
      let sql = `SELECT sm.*, p.name as product_name, p.barcode, c.name as cashier_name, s.name as supplier_name
               FROM stock_movements sm
               JOIN products p ON sm.product_id = p.id
               LEFT JOIN cashiers c ON sm.cashier_id = c.id
               LEFT JOIN suppliers s ON sm.supplier_id = s.id
               WHERE 1=1`;
      const params = [];
      if (search) {
        sql += " AND (nomar(p.name) LIKE ? OR p.barcode LIKE ?)";
        const like = `%${nomarize(search)}%`;
        const raw = `%${search}%`;
        params.push(like, raw);
      }
      if (type) {
        sql += " AND sm.type = ?";
        params.push(type);
      }
      if (supplierId) {
        sql += " AND sm.supplier_id = ?";
        params.push(parseInt(supplierId));
      }
      if (startDate && !search) {
        const { start } = toUTCDateRange(startDate);
        sql += " AND sm.created_at >= ?";
        params.push(start);
      }
      if (endDate && !search) {
        const { end } = toUTCDateRange(endDate);
        sql += " AND sm.created_at < ?";
        params.push(end);
      }
      if (role !== "admin" && !search && cashierId) {
        sql += " AND sm.cashier_id = ?";
        params.push(cashierId);
      }
      sql += " ORDER BY sm.created_at DESC LIMIT 500";
      return db.prepare(sql).all(...params);
    } catch (error) {
      return [];
    }
  },
);

ipcMain.handle("get-product-day-summary", async (event, { productId } = {}) => {
  const empty = {
    lastChange: null,
    previo: null,
    lastDay: null,
    isToday: false,
    showHistory: false,
    adds: [],
    todayIn: 0,
    todayOut: 0,
  };
  try {
    if (!productId) return empty;
    const product = db
      .prepare("SELECT id, stock FROM products WHERE id = ?")
      .get(productId);
    if (!product) return empty;

    const toMXL = (utc) =>
      new Date(String(utc).replace(" ", "T") + "Z").toLocaleDateString(
        "en-CA",
        { timeZone: "America/Mexico_City" },
      );
    const todayMX = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Mexico_City",
    });
    const yesterdayMX = new Date(Date.now() - 86400000).toLocaleDateString(
      "en-CA",
      {
        timeZone: "America/Mexico_City",
      },
    );

    const movements = db
      .prepare(
        "SELECT id, type, quantity, created_at FROM stock_movements WHERE product_id = ? ORDER BY created_at ASC",
      )
      .all(productId);
    const saleItems = db
      .prepare(
        `SELECT si.stock_deducted AS qty, s.created_at
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE si.product_id = ?
           ORDER BY s.created_at ASC`,
      )
      .all(productId);

    const events = [];
    for (const m of movements) {
      events.push({
        t: m.created_at,
        type: m.type,
        qty: m.quantity,
        delta:
          m.type === "in" || m.type === "devolution" ? m.quantity : -m.quantity,
      });
    }
    for (const s of saleItems) {
      events.push({
        t: s.created_at,
        type: "sale",
        qty: s.qty || 0,
        delta: -(s.qty || 0),
      });
    }
    events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

    const currentStock = product.stock || 0;

    // ── Último cambio de stock (movimiento o venta) ──
    let lastChange = null;
    if (events.length > 0) {
      const last = events[events.length - 1];
      lastChange = {
        delta: last.delta,
        created_at: last.t,
        isToday: toMXL(last.t) === todayMX,
      };
    }

    // ── Historial de cargas (último día con carga) ──
    let netAfter = 0;
    const addEvents = [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === "in") {
        addEvents.unshift({
          created_at: ev.t,
          quantity: ev.qty,
          stockAfter: currentStock - netAfter,
        });
      }
      netAfter += ev.delta;
    }

    // ── Stock previo: fijo, anclado a la última carga ──
    let previo = null;
    if (addEvents.length > 0) {
      const lastAdd = addEvents[addEvents.length - 1];
      previo =
        lastChange && lastChange.delta >= 0
          ? lastAdd.stockAfter - lastAdd.quantity
          : lastAdd.stockAfter;
    } else if (events.length > 0) {
      previo = currentStock - events.reduce((s, e) => s + e.delta, 0);
    }

    // ── Acumulado de hoy para el badge ──
    const todayEvents = events.filter((e) => toMXL(e.t) === todayMX);
    const todayIn = todayEvents
      .filter((e) => e.type === "in")
      .reduce((s, e) => s + e.qty, 0);
    const todayOut = todayEvents
      .filter((e) => e.delta < 0)
      .reduce((s, e) => s + e.delta, 0);

    let lastDay = null;
    let isToday = false;
    let showHistory = false;
    let adds = [];
    if (addEvents.length > 0) {
      lastDay = toMXL(addEvents[addEvents.length - 1].created_at);
      const dayAdds = addEvents.filter((a) => toMXL(a.created_at) === lastDay);
      isToday = lastDay === todayMX;
      showHistory = lastDay === todayMX || lastDay === yesterdayMX;
      adds = dayAdds.map((a) => ({
        created_at: a.created_at,
        quantity: a.quantity,
        stockAfter: a.stockAfter,
      }));
    }

    if (!lastChange) return empty;

    return {
      lastChange,
      previo,
      lastDay,
      isToday,
      showHistory,
      adds,
      todayIn,
      todayOut,
    };
  } catch (error) {
    return empty;
  }
});

// ─── SALES ──────────────────────────────────────────────────

ipcMain.handle(
  "record-sale",
  async (
    event,
    { cart, total, paymentMethod, discountTotal, cashierName, cashierId, role },
  ) => {
    const recordSale = db.transaction(() => {
      const openReg = findOpenRegister(cashierId, role);
      const registerId = openReg ? openReg.id : null;

      const saleStmt = db.prepare(
        "INSERT INTO sales (total, payment_method, discount_total, register_id, cashier_name) VALUES (?, ?, ?, ?, ?)",
      );
      const saleInfo = saleStmt.run(
        total,
        paymentMethod || "cash",
        discountTotal || 0,
        registerId,
        cashierName || "Usuario Principal",
      );
      const saleId = saleInfo.lastInsertRowid;

      const itemStmt = db.prepare(
        "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale, discount_percent, stock_deducted) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const stockStmt = db.prepare(
        "UPDATE products SET stock = stock - ? WHERE id = ?",
      );

      for (const item of cart) {
        // Manual items: null product_id, skip stock update
        // Normal items: use numeric id, update stock
        const isManual = item.isManual || typeof item.id !== "number";
        const productId = isManual ? null : item.id;
        const productName = item.name || (isManual ? "Producto manual" : null);
        let stockDeducted = 0;
        if (!isManual) {
          stockDeducted = item.isBoxItem
            ? item.quantity * (item.box_qty || 1)
            : item.isPackItem
              ? item.quantity * (item.pack_qty || 1)
              : item.quantity;
        }
        itemStmt.run(
          saleId,
          productId,
          productName,
          item.quantity,
          item.finalPrice || item.price,
          item.discount_percent || 0,
          stockDeducted,
        );
        if (!isManual) {
          const prod = db
            .prepare("SELECT stock FROM products WHERE id = ?")
            .get(item.id);
          if (!prod || prod.stock < stockDeducted) {
            throw new Error(
              `Stock insuficiente para "${productName}". Quedan ${prod ? prod.stock : 0}`,
            );
          }
          stockStmt.run(stockDeducted, item.id);
        }
      }
      return { success: true, saleId };
    });

    try {
      return recordSale();
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "cancel-sale",
  async (event, { saleId, cashierName, reason, role, cashierId }) => {
    try {
      if (!saleId) return { success: false, error: "Venta inválida" };
      const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId);
      if (!sale) return { success: false, error: "Venta no encontrada" };
      if (sale.status === "cancelado")
        return { success: false, error: "Esta venta ya fue cancelada" };

      const reg = sale.register_id
        ? db
            .prepare("SELECT status, closed_at FROM cash_register WHERE id = ?")
            .get(sale.register_id)
        : null;
      const canCancel =
        role === "admin" ||
        (reg && reg.status === "open") ||
        (reg && reg.status === "closed" && isWithinCancelWindow(reg.closed_at));
      if (!canCancel)
        return {
          success: false,
          error: "No se puede cancelar esta venta fuera del plazo permitido",
        };

      const doCancel = db.transaction(() => {
        db.prepare(
          "UPDATE sales SET status='cancelado', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?",
        ).run(cashierName || null, saleId);
        db.prepare(
          "UPDATE sale_items SET status='cancelado', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE sale_id=? AND (status IS NULL OR status != 'cancelado')",
        ).run(cashierName || null, saleId);
        const items = db
          .prepare(
            "SELECT product_id, stock_deducted FROM sale_items WHERE sale_id = ?",
          )
          .all(saleId);
        const restoreStmt = db.prepare(
          "UPDATE products SET stock = stock + ? WHERE id = ?",
        );
        const movStmt = db.prepare(
          "INSERT INTO stock_movements (product_id, type, quantity, reference, notes, cashier_id) VALUES (?, 'devolution', ?, ?, ?, ?)",
        );
        for (const it of items) {
          if (it.product_id && (it.stock_deducted || 0) > 0) {
            restoreStmt.run(it.stock_deducted, it.product_id);
            movStmt.run(
              it.product_id,
              it.stock_deducted,
              `Cancelación venta #${saleId}`,
              reason || "",
              cashierId || null,
            );
          }
        }
      });
      doCancel();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "cancel-sale-item",
  async (
    event,
    { saleId, itemId, cashierName, reason, role, cashierId, quantity },
  ) => {
    try {
      if (!saleId || !itemId)
        return { success: false, error: "Datos inválidos" };
      const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId);
      if (!sale) return { success: false, error: "Venta no encontrada" };
      if (sale.status === "cancelado")
        return { success: false, error: "Esta venta ya fue cancelada" };

      const item = db
        .prepare("SELECT * FROM sale_items WHERE id = ? AND sale_id = ?")
        .get(itemId, saleId);
      if (!item) return { success: false, error: "Producto no encontrado" };
      if (item.status === "cancelado")
        return { success: false, error: "Este producto ya fue cancelado" };

      const reg = sale.register_id
        ? db
            .prepare("SELECT status, closed_at FROM cash_register WHERE id = ?")
            .get(sale.register_id)
        : null;
      const canCancel =
        role === "admin" ||
        (reg && reg.status === "open") ||
        (reg && reg.status === "closed" && isWithinCancelWindow(reg.closed_at));
      if (!canCancel)
        return {
          success: false,
          error: "No se puede cancelar este producto fuera del plazo permitido",
        };

      const itemQuantity = Number(item.quantity || 0);
      const alreadyReturned = Number(item.returned_qty || 0);
      const remaining = Math.max(0, itemQuantity - alreadyReturned);
      if (remaining <= 0)
        return { success: false, error: "Este producto ya fue cancelado" };

      const requested = Math.abs(Number(quantity) || 1);
      const cancelQty = Math.min(
        Math.max(0.001, Math.round(requested * 1000) / 1000),
        remaining,
      );

      const isPartial = remaining - cancelQty > 0.0001;
      const newReturned =
        Math.round((alreadyReturned + cancelQty) * 1000) / 1000;

      const unitPrice = Number(item.price_at_sale || 0);
      const discount = Number(item.discount_percent || 0);
      const refundAmount =
        unitPrice *
        cancelQty *
        (1 - Math.min(100, Math.max(0, discount)) / 100);

      const stockPerUnit =
        itemQuantity > 0
          ? (Number(item.stock_deducted || 0) || itemQuantity) / itemQuantity
          : 1;
      const restoreStock = Math.round(stockPerUnit * cancelQty * 1000) / 1000;

      let saleCancelled = false;

      const doCancel = db.transaction(() => {
        if (newReturned + 0.0001 >= itemQuantity) {
          db.prepare(
            "UPDATE sale_items SET status='cancelado', returned_qty=?, cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?",
          ).run(newReturned, cashierName || null, itemId);
        } else {
          db.prepare(
            "UPDATE sale_items SET status='parcial', returned_qty=?, cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?",
          ).run(newReturned, cashierName || null, itemId);
        }

        if (item.product_id && restoreStock > 0) {
          db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(
            restoreStock,
            item.product_id,
          );
          db.prepare(
            "INSERT INTO stock_movements (product_id, type, quantity, reference, notes, cashier_id) VALUES (?, 'devolution', ?, ?, ?, ?)",
          ).run(
            item.product_id,
            restoreStock,
            `${isPartial ? "Devolución parcial" : "Cancelación"} producto venta #${saleId}`,
            reason || "",
            cashierId || null,
          );
        }

        const activeCount = db
          .prepare(
            "SELECT COUNT(*) as c FROM sale_items WHERE sale_id = ? AND (status IS NULL OR status != 'cancelado')",
          )
          .get(saleId).c;

        if (activeCount === 0) {
          saleCancelled = true;
          db.prepare(
            "UPDATE sales SET status='cancelado', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?",
          ).run(cashierName || null, saleId);
        } else {
          db.prepare(
            "UPDATE sales SET total = MAX(0, ROUND(total - ?, 2)) WHERE id = ?",
          ).run(refundAmount, saleId);
        }
      });
      doCancel();
      return {
        success: true,
        refundAmount: Number(refundAmount.toFixed(2)),
        cancelledQty: cancelQty,
        isPartial,
        saleCancelled,
        itemStatus:
          newReturned + 0.0001 >= itemQuantity ? "cancelado" : "parcial",
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

const MX_UTC_OFFSET = 6;

const mxToday = () =>
  new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Mexico_City",
  });

function toUTCDateRange(mxDateStr) {
  if (!mxDateStr) return { start: null, end: null };
  const start = `${mxDateStr} ${String(MX_UTC_OFFSET).padStart(2, "0")}:00:00`;
  const [y, m, d] = mxDateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const end = `${nextStr} ${String(MX_UTC_OFFSET).padStart(2, "0")}:00:00`;
  return { start, end };
}

// ─── REGISTER HELPERS ──────────────────────────────────────
function findOpenRegister(cashierId, role) {
  if (role === "admin" || !cashierId) {
    return (
      db
        .prepare(
          "SELECT * FROM cash_register WHERE status = 'open' ORDER BY id DESC LIMIT 1",
        )
        .get() || null
    );
  }
  return (
    db
      .prepare(
        "SELECT * FROM cash_register WHERE status = 'open' AND cashier_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(cashierId) ||
    db
      .prepare(
        "SELECT * FROM cash_register WHERE status = 'open' ORDER BY id DESC LIMIT 1",
      )
      .get() ||
    null
  );
}

function isWithinCancelWindow(closedAt) {
  if (!closedAt) return false;
  const closedDateStr = new Date(
    new Date(closedAt.replace(" ", "T") + "Z").getTime() -
      MX_UTC_OFFSET * 3600000,
  )
    .toISOString()
    .slice(0, 10);
  const today = mxToday();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString("en-CA", {
    timeZone: "America/Mexico_City",
  });
  return closedDateStr >= yesterday;
}

ipcMain.handle(
  "get-sales-for-today",
  async (event, { date, registerId } = {}) => {
    try {
      const today = date || mxToday();
      const { start, end } = toUTCDateRange(today);
      let sales;
      if (registerId) {
        sales = db
          .prepare(
            `SELECT s.*, 
              CASE WHEN cr.status = 'open' THEN 1 
                   WHEN cr.status = 'closed' AND date(cr.closed_at, '-6 hours') >= date(?, '-1 day') THEN 1 
                   ELSE 0 END as can_cancel
            FROM sales s 
            LEFT JOIN cash_register cr ON s.register_id = cr.id
            WHERE s.created_at >= ? AND s.created_at < ? AND s.register_id = ?
            ORDER BY s.created_at DESC`,
          )
          .all(today, start, end, registerId);
      } else {
        sales = db
          .prepare(
            `SELECT s.*, 
              CASE WHEN cr.status = 'open' THEN 1 
                   WHEN cr.status = 'closed' AND date(cr.closed_at, '-6 hours') >= date(?, '-1 day') THEN 1 
                   ELSE 0 END as can_cancel
            FROM sales s 
            LEFT JOIN cash_register cr ON s.register_id = cr.id
            WHERE s.created_at >= ? AND s.created_at < ?
            ORDER BY s.created_at DESC`,
          )
          .all(today, start, end);
      }
      const itemRows = db
        .prepare(
          `SELECT si.sale_id, COALESCE(p.name, si.product_name) AS name,
                  SUM(CASE WHEN si.status = 'cancelado' THEN 0
                       ELSE si.quantity - COALESCE(si.returned_qty, 0) END) AS qty
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           LEFT JOIN products p ON si.product_id = p.id
           WHERE s.created_at >= ? AND s.created_at < ?
           ${registerId ? "AND s.register_id = ?" : ""}
           GROUP BY si.sale_id, name
           ORDER BY name ASC`,
        )
        .all(...(registerId ? [start, end, registerId] : [start, end]));
      const bySale = {};
      itemRows.forEach((r) => {
        (bySale[r.sale_id] = bySale[r.sale_id] || []).push({
          name: r.name,
          qty: r.qty,
        });
      });
      const itemDetail = db
        .prepare(
          `SELECT si.id, si.sale_id, si.product_id,
                  COALESCE(p.name, si.product_name) AS product_name,
                  si.quantity, si.price_at_sale, si.discount_percent,
                  si.stock_deducted, si.returned_qty, si.status,
                  si.cancelled_at, si.cancelled_by,
                  COALESCE(p.sale_unit, 'piece') AS sale_unit
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           LEFT JOIN products p ON si.product_id = p.id
           WHERE s.created_at >= ? AND s.created_at < ?
           ${registerId ? "AND s.register_id = ?" : ""}
           ORDER BY si.id ASC`,
        )
        .all(...(registerId ? [start, end, registerId] : [start, end]));
      const itemsBySale = {};
      itemDetail.forEach((i) => {
        (itemsBySale[i.sale_id] = itemsBySale[i.sale_id] || []).push(i);
      });
      sales = sales.map((s) => ({
        ...s,
        products: bySale[s.id] || [],
        items: itemsBySale[s.id] || [],
      }));
      return { success: true, sales };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("get-outside-register-sales", async () => {
  try {
    const today = mxToday();
    const [y, m, d] = today.split("-").map(Number);
    const yesterdayDt = new Date(Date.UTC(y, m - 1, d - 1));
    const yesterday = `${yesterdayDt.getUTCFullYear()}-${String(
      yesterdayDt.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(yesterdayDt.getUTCDate()).padStart(2, "0")}`;
    const { start } = toUTCDateRange(yesterday);
    const { end } = toUTCDateRange(today);
    const sales = db
      .prepare(
        "SELECT * FROM sales WHERE register_id IS NULL AND (status IS NULL OR status != 'cancelado') AND created_at >= ? AND created_at < ? ORDER BY created_at DESC",
      )
      .all(start, end);
    const itemRows = db
      .prepare(
        `SELECT si.sale_id, COALESCE(p.name, si.product_name) AS name,
                SUM(CASE WHEN si.status = 'cancelado' THEN 0
                     ELSE si.quantity - COALESCE(si.returned_qty, 0) END) AS qty
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         WHERE s.register_id IS NULL AND s.created_at >= ? AND s.created_at < ?
         GROUP BY si.sale_id, name
         ORDER BY name ASC`,
      )
      .all(start, end);
    const bySale = {};
    itemRows.forEach((r) => {
      (bySale[r.sale_id] = bySale[r.sale_id] || []).push({
        name: r.name,
        qty: r.qty,
      });
    });
    const result = sales.map((s) => ({
      ...s,
      products: bySale[s.id] || [],
    }));
    return { success: true, sales: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-sales-by-range", async (event, { startDate, endDate }) => {
  try {
    const { start } = toUTCDateRange(startDate);
    const { end } = toUTCDateRange(endDate);
    const sales = db
      .prepare(
        "SELECT * FROM sales WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 500",
      )
      .all(start, end);
    const total = db
      .prepare(
        "SELECT COALESCE(SUM(total),0) as total FROM sales WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado')",
      )
      .get(start, end).total;
    const count = db
      .prepare(
        "SELECT COUNT(*) as c FROM sales WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado')",
      )
      .get(start, end).c;
    const byMethod = db
      .prepare(
        "SELECT payment_method, COUNT(*) as count, SUM(total) as total FROM sales WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado') GROUP BY payment_method",
      )
      .all(start, end);
    return { success: true, sales, total, count, byMethod };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-sale-details", async (event, saleId) => {
  try {
    const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId);
    const items = db
      .prepare(
        `
      SELECT si.*, COALESCE(p.name, si.product_name) AS name, p.barcode, p.sale_unit AS sale_unit FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `,
      )
      .all(saleId);
    return { success: true, sale, items };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-sales-by-date", async (event, { date }) => {
  try {
    const { start, end } = toUTCDateRange(date);
    const today = mxToday();
    const sales = db
      .prepare(
        `SELECT s.*,
          CASE WHEN cr.status = 'open' THEN 1 
               WHEN cr.status = 'closed' AND date(cr.closed_at, '-6 hours') >= date(?, '-1 day') THEN 1 
               ELSE 0 END as can_cancel
        FROM sales s 
        LEFT JOIN cash_register cr ON s.register_id = cr.id
        WHERE s.created_at >= ? AND s.created_at < ?
        ORDER BY s.created_at DESC`,
      )
      .all(today, start, end);
    const total = db
      .prepare(
        "SELECT COALESCE(SUM(total),0) as total FROM sales WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado')",
      )
      .get(start, end).total;
    const count = sales.filter((s) => s.status !== "cancelado").length;
    const byMethod = db
      .prepare(
        "SELECT payment_method, COUNT(*) as count, SUM(total) as total FROM sales WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado') GROUP BY payment_method",
      )
      .all(start, end);
    return { success: true, sales, total, count, byMethod };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "get-expenses-by-range",
  async (event, { startDate, endDate }) => {
    try {
      const { start } = toUTCDateRange(startDate);
      const { end } = toUTCDateRange(endDate);
      const expenses = db
        .prepare(
          `
      SELECT e.*, cr.name as register_name, opener.name AS register_opener_name
      FROM cash_register_expenses e
      LEFT JOIN cash_register cr ON e.register_id = cr.id
      LEFT JOIN cashiers opener ON cr.opened_by = opener.id
      WHERE e.created_at >= ? AND e.created_at < ?
      ORDER BY e.created_at DESC
    `,
        )
        .all(start, end);
      const activeExpenses = expenses.filter((e) => e.status !== "cancelado");
      const totalExpenses = activeExpenses.reduce(
        (sum, e) => sum + e.amount,
        0,
      );
      return {
        success: true,
        expenses,
        totalExpenses,
        count: activeExpenses.length,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("get-expenses-by-date", async (event, { date }) => {
  try {
    const { start, end } = toUTCDateRange(date);
    const expenses = db
      .prepare(
        `
      SELECT e.*, cr.name as register_name, opener.name AS register_opener_name
      FROM cash_register_expenses e
      LEFT JOIN cash_register cr ON e.register_id = cr.id
      LEFT JOIN cashiers opener ON cr.opened_by = opener.id
      WHERE e.created_at >= ? AND e.created_at < ?
      ORDER BY e.created_at DESC
    `,
      )
      .all(start, end);
    const activeExpenses = expenses.filter((e) => e.status !== "cancelado");
    const totalExpenses = activeExpenses.reduce((sum, e) => sum + e.amount, 0);
    return {
      success: true,
      expenses,
      totalExpenses,
      count: activeExpenses.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── SETTINGS ───────────────────────────────────────────────

ipcMain.handle("get-setting", async (event, key) => {
  try {
    const setting = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key);
    return setting ? setting.value : null;
  } catch (error) {
    return null;
  }
});

ipcMain.handle("save-setting", async (event, key, value) => {
  try {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run(key, value);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-all-settings", async () => {
  try {
    const rows = db.prepare("SELECT key, value FROM settings").all();
    const result = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  } catch (error) {
    return {};
  }
});

ipcMain.handle("get-server-status", () => {
  const api = apiServer.getStatus();
  return {
    running: api.running,
    port: api.port || 3456,
  };
});

// ─── CASHIERS ────────────────────────────────────────────────

ipcMain.handle("get-cashiers", async () => {
  try {
    return db
      .prepare("SELECT id, name, role, is_active FROM cashiers ORDER BY name")
      .all();
  } catch (error) {
    return [];
  }
});

ipcMain.handle("add-cashier", async (event, cashier) => {
  try {
    const info = db
      .prepare(
        "INSERT INTO cashiers (name, pin, role, is_active) VALUES (?, ?, ?, ?)",
      )
      .run(cashier.name, cashier.pin || "0000", cashier.role || "cashier", 1);
    return { success: true, id: info.lastInsertRowid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("update-cashier", async (event, id, cashier) => {
  try {
    if (cashier.pin) {
      db.prepare(
        "UPDATE cashiers SET name=?, pin=?, role=?, is_active=? WHERE id=?",
      ).run(
        cashier.name,
        cashier.pin,
        cashier.role || "cashier",
        cashier.is_active,
        id,
      );
    } else {
      db.prepare(
        "UPDATE cashiers SET name=?, role=?, is_active=? WHERE id=?",
      ).run(cashier.name, cashier.role || "cashier", cashier.is_active, id);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("verify-cashier-pin", async (event, id, pin) => {
  try {
    const cashier = db
      .prepare("SELECT id, name, pin, role FROM cashiers WHERE id = ?")
      .get(id);
    if (!cashier) return { success: false, error: "Cajero no encontrado" };
    if (cashier.pin !== pin) return { success: false, error: "PIN incorrecto" };
    return {
      success: true,
      cashier: { id: cashier.id, name: cashier.name, role: cashier.role },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-cashier", async (event, id) => {
  try {
    db.prepare("DELETE FROM cashiers WHERE id = ?").run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("is-first-time", async () => {
  try {
    const setting = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("store_name");
    return !setting;
  } catch (error) {
    return true;
  }
});

// ─── CASH REGISTER ──────────────────────────────────────────

ipcMain.handle(
  "register-cash-expense",
  async (event, { amount, reason, cashierId, role }) => {
    try {
      const register = findOpenRegister(cashierId, role);
      if (!register)
        return {
          success: false,
          error: "No hay caja abierta para registrar gasto",
        };

      const registerExpense = db.transaction(() => {
        const newExpenses = (register.expenses || 0) + amount;
        db.prepare("UPDATE cash_register SET expenses = ? WHERE id = ?").run(
          newExpenses,
          register.id,
        );
        db.prepare(
          "INSERT INTO cash_register_expenses (register_id, amount, reason) VALUES (?, ?, ?)",
        ).run(register.id, amount, reason);
        return newExpenses;
      });
      const newExpenses = registerExpense();
      return { success: true, expenses: newExpenses };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "get-cash-register-status",
  async (event, { cashierId, role } = {}) => {
    try {
      let register = findOpenRegister(cashierId, role);
      if (!register) {
        register = db
          .prepare(
            "SELECT * FROM cash_register WHERE date = ? ORDER BY id DESC LIMIT 1",
          )
          .get(mxToday());
      }
      if (register) {
        const opener = db
          .prepare("SELECT name, role FROM cashiers WHERE id = ?")
          .get(register.opened_by);
        register.opener_name = opener?.name || null;
        register.opener_role = opener?.role || null;
        if (register.status === "open") {
          const cashRow = db
            .prepare(
              "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE register_id = ? AND payment_method = 'cash' AND (status IS NULL OR status != 'cancelado')",
            )
            .get(register.id);
          register.currentCash =
            (register.opening_balance || 0) +
            (cashRow?.total || 0) -
            (register.expenses || 0);
        }
      }
      return { success: true, register };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "open-cash-register",
  async (event, { openingBalance, cashierId, role }) => {
    try {
      const today = mxToday();
      const openRegisters = db
        .prepare(
          "SELECT * FROM cash_register WHERE status = 'open' ORDER BY id ASC",
        )
        .all();
      for (const existing of openRegisters) {
        // Auto-close the previous register before opening new one
        const sales = db
          .prepare(
            "SELECT payment_method, SUM(total) as total FROM sales WHERE register_id = ? AND (status IS NULL OR status != 'cancelado') GROUP BY payment_method",
          )
          .all(existing.id);
        const cashSales =
          sales.find((s) => s.payment_method === "cash")?.total || 0;
        const cardSales =
          sales.find((s) => s.payment_method === "card")?.total || 0;
        const transferSales =
          sales.find((s) => s.payment_method === "transfer")?.total || 0;
        const totalExpenses = existing.expenses || 0;
        const expectedClose =
          (existing.opening_balance || 0) + cashSales - totalExpenses;

        db.prepare(
          `UPDATE cash_register SET
            cash_sales=?, card_sales=?, transfer_sales=?, expenses=?,
            expected_close=?, declared_close=?, difference=?, name='Cierre automático', status='closed', closed_at=CURRENT_TIMESTAMP, closed_by=?
            WHERE id=?`,
        ).run(
          cashSales,
          cardSales,
          transferSales,
          totalExpenses,
          expectedClose,
          expectedClose,
          0,
          cashierId || null,
          existing.id,
        );
      }

      db.prepare(
        "INSERT INTO cash_register (date, opening_balance, cashier_id, opened_by) VALUES (?, ?, ?, ?)",
      ).run(today, openingBalance || 0, cashierId || null, cashierId || null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "close-cash-register",
  async (
    event,
    { declaredClose, expenses, name, cashierId, role, registerId, force },
  ) => {
    try {
      let register;
      if (registerId) {
        register = db
          .prepare(
            `SELECT cr.*, c.role AS opener_role
             FROM cash_register cr
             LEFT JOIN cashiers c ON cr.opened_by = c.id
             WHERE cr.id = ? AND cr.status = 'open'`,
          )
          .get(registerId);
      } else {
        register = db
          .prepare(
            `SELECT cr.*, c.role AS opener_role
             FROM cash_register cr
             LEFT JOIN cashiers c ON cr.opened_by = c.id
             WHERE cr.status = 'open'
             ORDER BY cr.id DESC LIMIT 1`,
          )
          .get();
      }
      if (!register) return { success: false, error: "No hay caja abierta" };

      const openerIsAdmin = register.opener_role === "admin";
      const isOwnRegister =
        String(register.opened_by) === String(cashierId) ||
        String(register.cashier_id) === String(cashierId);
      if (!force && role !== "admin" && !openerIsAdmin && !isOwnRegister) {
        return {
          success: false,
          error: "No hay caja abierta que puedas cerrar hoy",
        };
      }

      // Get sales by payment method (only for this register)
      const sales = db
        .prepare(
          "SELECT payment_method, SUM(total) as total FROM sales WHERE register_id = ? AND (status IS NULL OR status != 'cancelado') GROUP BY payment_method",
        )
        .all(register.id);
      const cashSales =
        sales.find((s) => s.payment_method === "cash")?.total || 0;
      const cardSales =
        sales.find((s) => s.payment_method === "card")?.total || 0;
      const transferSales =
        sales.find((s) => s.payment_method === "transfer")?.total || 0;
      const totalExpenses = (register.expenses || 0) + (expenses || 0);
      const expectedClose =
        register.opening_balance + cashSales - totalExpenses;
      const difference =
        expectedClose >= 0
          ? (declaredClose || 0) - expectedClose
          : expectedClose + (declaredClose || 0);

      db.prepare(
        `UPDATE cash_register SET
      cash_sales=?, card_sales=?, transfer_sales=?, expenses=?,
      expected_close=?, declared_close=?, difference=?, name=?, status='closed', closed_at=CURRENT_TIMESTAMP, closed_by=?
      WHERE id=?`,
      ).run(
        cashSales,
        cardSales,
        transferSales,
        totalExpenses,
        expectedClose,
        declaredClose || 0,
        difference,
        name || null,
        cashierId || null,
        register.id,
      );

      return { success: true, expectedClose, difference };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "get-closed-registers",
  async (event, { cashierId, role } = {}) => {
    try {
      let query = `
      SELECT cr.*,
        opener.name AS opener_name,
        closer.name AS closer_name,
        (SELECT COUNT(*) FROM sales WHERE register_id = cr.id AND (status IS NULL OR status != 'cancelado')) as sale_count,
        (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE s.register_id = cr.id AND (s.status IS NULL OR s.status != 'cancelado') AND (si.status IS NULL OR si.status != 'cancelado')) as total_items,
        (SELECT COALESCE(SUM(s.total), 0) FROM sales s WHERE s.register_id = cr.id AND (s.status IS NULL OR s.status != 'cancelado')) as total_sales
      FROM cash_register cr
      LEFT JOIN cashiers opener ON cr.opened_by = opener.id
      LEFT JOIN cashiers closer ON cr.closed_by = closer.id
      WHERE cr.status = 'closed'
    `;
      const params = [];

      if (role !== "admin" && cashierId) {
        query += ` AND cr.closed_by = ? AND cr.closed_at >= datetime('now', '-7 days')`;
        params.push(cashierId);
      }

      query += ` ORDER BY cr.closed_at DESC`;

      const registers = db.prepare(query).all(...params);
      return { success: true, registers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "get-cash-register-expenses",
  async (event, { cashierId, role } = {}) => {
    try {
      const register = findOpenRegister(cashierId, role);
      if (!register) return { success: true, expenses: [] };
      const expenses = db
        .prepare(
          "SELECT * FROM cash_register_expenses WHERE register_id = ? AND (status IS NULL OR status != 'cancelado') ORDER BY created_at DESC",
        )
        .all(register.id);
      return { success: true, expenses };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("get-previous-register-today", async () => {
  try {
    const register = db
      .prepare(
        "SELECT * FROM cash_register WHERE status = 'closed' AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1",
      )
      .get();
    return { success: true, register: register || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "delete-cash-expense",
  async (event, { expenseId, cashierId, role }) => {
    try {
      if (!expenseId) return { success: false, error: "Gasto inválido" };
      const expense = db
        .prepare("SELECT * FROM cash_register_expenses WHERE id = ?")
        .get(expenseId);
      if (!expense) return { success: false, error: "Gasto no encontrado" };

      const register = expense.register_id
        ? db
            .prepare(
              `SELECT cr.*, c.role AS opener_role
               FROM cash_register cr
               LEFT JOIN cashiers c ON cr.opened_by = c.id
               WHERE cr.id = ?`,
            )
            .get(expense.register_id)
        : null;
      if (expense.status === "cancelado")
        return { success: false, error: "Este gasto ya fue cancelado" };

      if (register && register.status === "open") {
        const openerIsAdmin = register.opener_role === "admin";
        const isOwnRegister =
          String(register.opened_by) === String(cashierId) ||
          String(register.cashier_id) === String(cashierId);
        if (role !== "admin" && !openerIsAdmin && !isOwnRegister) {
          return {
            success: false,
            error: "No puedes cancelar gastos de esta caja",
          };
        }
      } else {
        // Closed register: only cancel within the 1-day window (admin always ok)
        if (
          role !== "admin" &&
          !(
            register &&
            register.closed_at &&
            isWithinCancelWindow(register.closed_at)
          )
        ) {
          return {
            success: false,
            error: "No puedes cancelar gastos fuera del plazo permitido",
          };
        }
      }

      const doCancel = db.transaction(() => {
        db.prepare(
          "UPDATE cash_register_expenses SET status='cancelado', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?",
        ).run(cashierId || null, expenseId);
        let newExpenses = null;
        if (register && register.status === "open") {
          newExpenses = Math.max(
            0,
            (register.expenses || 0) - (expense.amount || 0),
          );
          db.prepare("UPDATE cash_register SET expenses = ? WHERE id = ?").run(
            newExpenses,
            register.id,
          );
        }
        if (expense.product_id && (expense.quantity || 0) > 0) {
          db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(
            expense.quantity,
            expense.product_id,
          );
          db.prepare(
            "INSERT INTO stock_movements (product_id, type, quantity, reference, notes, cashier_id) VALUES (?, 'out', ?, ?, ?, ?)",
          ).run(
            expense.product_id,
            expense.quantity,
            `expense:${expense.id}`,
            "Cancelación de compra (gasto)",
            cashierId || null,
          );
        }
        return newExpenses;
      });
      const expenses = doCancel();
      return { success: true, expenses };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("get-register-sales-detail", async (event, registerId) => {
  try {
    const register = db
      .prepare(
        `
      SELECT cr.*, opener.name AS opener_name, closer.name AS closer_name
      FROM cash_register cr
      LEFT JOIN cashiers opener ON cr.opened_by = opener.id
      LEFT JOIN cashiers closer ON cr.closed_by = closer.id
      WHERE cr.id = ?
    `,
      )
      .get(registerId);
    if (!register) return { success: false, error: "Caja no encontrada" };

    const sales = db
      .prepare(
        `SELECT s.*,
          CASE WHEN cr.status = 'open' THEN 1 
               WHEN cr.status = 'closed' AND date(cr.closed_at, '-6 hours') >= date(?, '-1 day') THEN 1 
               ELSE 0 END as can_cancel
        FROM sales s 
        LEFT JOIN cash_register cr ON s.register_id = cr.id
        WHERE s.register_id = ?
        ORDER BY s.created_at DESC
        LIMIT 500`,
      )
      .all(mxToday(), registerId);

    const items = db
      .prepare(
        `
      SELECT si.*, s.status, COALESCE(p.name, si.product_name) AS product_name, p.barcode, p.sale_unit AS sale_unit, s.created_at as sale_created_at
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN products p ON si.product_id = p.id
      WHERE s.register_id = ?
      ORDER BY s.created_at DESC
      LIMIT 500
    `,
      )
      .all(registerId);

    const expenses = db
      .prepare(
        `SELECT e.*,
          CASE WHEN cr.status = 'open' THEN 1 
               WHEN cr.status = 'closed' AND date(cr.closed_at, '-6 hours') >= date(?, '-1 day') THEN 1 
               ELSE 0 END as can_cancel
        FROM cash_register_expenses e
        LEFT JOIN cash_register cr ON e.register_id = cr.id
        WHERE e.register_id = ?
        ORDER BY e.created_at DESC
        LIMIT 500`,
      )
      .all(mxToday(), registerId);

    const totalSales = db
      .prepare(
        "SELECT COALESCE(SUM(total),0) as t FROM sales WHERE register_id = ? AND (status IS NULL OR status != 'cancelado')",
      )
      .get(registerId).t;
    const totalItems = db
      .prepare(
        "SELECT COALESCE(SUM(si.quantity),0) as t FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE s.register_id = ? AND (s.status IS NULL OR s.status != 'cancelado') AND (si.status IS NULL OR si.status != 'cancelado')",
      )
      .get(registerId).t;
    const saleCount = db
      .prepare(
        "SELECT COUNT(*) as c FROM sales WHERE register_id = ? AND (status IS NULL OR status != 'cancelado')",
      )
      .get(registerId).c;
    const totalExpenses = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as t FROM cash_register_expenses WHERE register_id = ? AND (status IS NULL OR status != 'cancelado')",
      )
      .get(registerId).t;

    return {
      success: true,
      register,
      sales,
      items,
      expenses,
      totalSales,
      totalItems,
      saleCount,
      totalExpenses,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── VENTAS SEMANALES ────────────────────────────────────────
ipcMain.handle("get-weekly-sales", async (event, { weeks = 12 }) => {
  try {
    const today = mxToday();
    const [y, m, d] = today.split("-").map(Number);
    const weeksAgo = new Date(Date.UTC(y, m - 1, d - weeks * 7));
    const start = `${weeksAgo.getUTCFullYear()}-${String(weeksAgo.getUTCMonth() + 1).padStart(2, "0")}-${String(weeksAgo.getUTCDate()).padStart(2, "0")}`;

    const rows = db
      .prepare(
        `SELECT strftime('%Y-%W', created_at) as week_key,
                strftime('%Y-%m-%d', MIN(created_at)) as week_start,
                SUM(total) as total,
                COUNT(*) as count
         FROM sales
         WHERE created_at >= ? AND (status IS NULL OR status != 'cancelado')
         GROUP BY week_key
         ORDER BY week_key ASC`,
      )
      .all(start);

    return { success: true, rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── VENTAS DIARIAS POR SEMANA ──────────────────────────────
ipcMain.handle(
  "get-daily-sales-week",
  async (event, { startDate, endDate }) => {
    try {
      const { start, end } = toUTCDateRange(startDate);
      const { end: endE } = toUTCDateRange(endDate);
      const rows = db
        .prepare(
          `SELECT DATE(created_at, '-6 hours') as date,
                SUM(total) as total,
                COUNT(*) as count
         FROM sales
         WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado')
         GROUP BY DATE(created_at, '-6 hours')
         ORDER BY date ASC`,
        )
        .all(start, endE);
      return { success: true, rows };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// ─── VENTAS SEMANALES POR MES ───────────────────────────────
ipcMain.handle(
  "get-weekly-sales-range",
  async (event, { startDate, endDate }) => {
    try {
      const rows = db
        .prepare(
          `SELECT strftime('%Y-%W', created_at, '-6 hours') as week_key,
                strftime('%Y-%m-%d', MIN(created_at), '-6 hours') as week_start,
                SUM(total) as total,
                COUNT(*) as count
         FROM sales
         WHERE created_at >= ? AND created_at < ? AND (status IS NULL OR status != 'cancelado')
         GROUP BY week_key
         ORDER BY week_key ASC`,
        )
        .all(startDate, endDate);
      return { success: true, rows };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// ─── BACKUP ──────────────────────────────────────────────────

const getBackupDir = () => {
  const dir = path.join(app.getPath("documents"), "POSBackups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const migrateLegacyBackups = () => {
  try {
    const oldDir = path.join(dbDir, "backups");
    if (!fs.existsSync(oldDir)) return;
    const files = fs.readdirSync(oldDir).filter((f) => f.endsWith(".db"));
    if (!files.length) return;
    const newDir = getBackupDir();
    const dest = fs.readdirSync(newDir).filter((f) => f.endsWith(".db"));
    files.forEach((f) => {
      if (!dest.includes(f)) {
        fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
      }
    });
  } catch (error) {
    console.error("Legacy backup migration failed:", error.message);
  }
};

const migrateRegisterContinuity = () => {
  try {
    // 1) Close old open registers, keeping only the most recent one
    const openRegs = db
      .prepare(
        "SELECT * FROM cash_register WHERE status = 'open' ORDER BY id ASC",
      )
      .all();
    for (let i = 0; i < openRegs.length - 1; i++) {
      const reg = openRegs[i];
      const sales = db
        .prepare(
          "SELECT payment_method, SUM(total) as total FROM sales WHERE register_id = ? AND (status IS NULL OR status != 'cancelado') GROUP BY payment_method",
        )
        .all(reg.id);
      const cashSales =
        sales.find((s) => s.payment_method === "cash")?.total || 0;
      const cardSales =
        sales.find((s) => s.payment_method === "card")?.total || 0;
      const transferSales =
        sales.find((s) => s.payment_method === "transfer")?.total || 0;
      const totalExpenses = reg.expenses || 0;
      const expectedClose =
        (reg.opening_balance || 0) + cashSales - totalExpenses;

      db.prepare(
        `UPDATE cash_register SET
          cash_sales=?, card_sales=?, transfer_sales=?, expenses=?,
          expected_close=?, declared_close=?, difference=?, name='Cierre automático', status='closed', closed_at=CURRENT_TIMESTAMP
          WHERE id=?`,
      ).run(
        cashSales,
        cardSales,
        transferSales,
        totalExpenses,
        expectedClose,
        expectedClose,
        0,
        reg.id,
      );
    }

    // 2) Attach orphan sales to the register matching their MX date
    const orphans = db
      .prepare("SELECT id, created_at FROM sales WHERE register_id IS NULL")
      .all();
    for (const sale of orphans) {
      const mxDate = new Date(
        sale.created_at.replace(" ", "T") + "Z",
      ).toLocaleDateString("en-CA", {
        timeZone: "America/Mexico_City",
      });
      const target = db
        .prepare(
          "SELECT id FROM cash_register WHERE date = ? ORDER BY id DESC LIMIT 1",
        )
        .get(mxDate);
      if (target) {
        db.prepare("UPDATE sales SET register_id = ? WHERE id = ?").run(
          target.id,
          sale.id,
        );
      }
    }
  } catch (error) {
    console.error("Register continuity migration failed:", error.message);
  }
};

ipcMain.handle("create-backup", async () => {
  try {
    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `pos-backup-${timestamp}.db`);
    await db.backup(backupPath);
    const stats = fs.statSync(backupPath);
    return {
      success: true,
      path: backupPath,
      size: stats.size,
      name: path.basename(backupPath),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-backups", async () => {
  try {
    const backupDir = getBackupDir();
    return fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const fp = path.join(backupDir, f);
        const stats = fs.statSync(fp);
        return { name: f, path: fp, size: stats.size, date: stats.mtime };
      })
      .sort((a, b) => b.date - a.date);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("restore-backup", async (event, backupPath) => {
  try {
    if (!fs.existsSync(backupPath))
      return { success: false, error: "Archivo de respaldo no encontrado" };
    const src = new Database(backupPath, { readonly: true });
    src.backup(db);
    src.close();
    runMigrations();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("download-backup", async (event, backupPath) => {
  try {
    if (!fs.existsSync(backupPath))
      return { success: false, error: "Archivo de respaldo no encontrado" };
    const result = await dialog.showSaveDialog({
      title: "Guardar respaldo",
      defaultPath: path.basename(backupPath),
      filters: [{ name: "Base de datos SQLite", extensions: ["db"] }],
    });
    if (result.canceled || !result.filePath)
      return { success: false, cancelled: true };
    fs.copyFileSync(backupPath, result.filePath);
    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-backup", async (event, backupPath) => {
  try {
    const backupDir = getBackupDir();
    const resolved = path.resolve(backupPath);
    if (!resolved.startsWith(backupDir + path.sep) || !resolved.endsWith(".db"))
      return { success: false, error: "Ruta de respaldo no válida" };
    if (!fs.existsSync(resolved))
      return { success: false, error: "Archivo no encontrado" };
    fs.unlinkSync(resolved);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── BACKUP AUTOMÁTICO (semanal) ────────────────────────────

const WEEKLY_BACKUP_RETAIN = 8;
const isWeeklyBackup = (name) => /^pos-weekly-.*\.db$/.test(name);

const maybeRunAutoBackup = async () => {
  try {
    const today = mxToday();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'auto_backup_last'")
      .get();
    const last = row ? row.value : null;
    if (last) {
      const days = Math.floor(
        (new Date(`${today}T00:00:00Z`) - new Date(`${last}T00:00:00Z`)) /
          86400000,
      );
      if (days >= 0 && days < 7) return;
    }
    const backupDir = getBackupDir();
    await db.backup(path.join(backupDir, `pos-weekly-${today}.db`));
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup_last', ?)",
    ).run(today);
    const weekly = fs
      .readdirSync(backupDir)
      .filter((f) => isWeeklyBackup(f))
      .map((f) => {
        const fp = path.join(backupDir, f);
        return { file: f, mtime: fs.statSync(fp).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    weekly
      .slice(WEEKLY_BACKUP_RETAIN)
      .forEach((x) => fs.unlinkSync(path.join(backupDir, x.file)));
  } catch (error) {
    console.error("Auto-backup failed:", error.message);
  }
};

// ─── IMPORTAR DATOS (CSV o .db) ───────────────────────────────

const IMPORT_COLUMNS = [
  {
    field: "barcode",
    aliases: [
      "barcode",
      "codigo",
      "código",
      "codigo_de_barras",
      "codigodebarras",
      "codigobarras",
      "bar_code",
      "barcode1",
      "upc",
      "ean",
    ],
  },
  {
    field: "name",
    aliases: [
      "name",
      "nombre",
      "producto",
      "descripcion",
      "product",
      "description",
      "item",
      "articulo",
      "nombre_producto",
      "nombreproducto",
    ],
  },
  { field: "brand", aliases: ["brand", "marca"] },
  {
    field: "price",
    aliases: [
      "price",
      "precio",
      "precio_venta",
      "preciodeventa",
      "precio_vta",
      "precioventa",
      "pvp",
      "precio_de_venta",
    ],
  },
  {
    field: "cost_price",
    aliases: [
      "cost_price",
      "costo",
      "costo_unitario",
      "preciocompra",
      "precio_compra",
      "precio_de_compra",
      "preciocosto",
      "precio_costo",
      "costoporpieza",
      "costo_por_pieza",
      "costounitario",
    ],
  },
  {
    field: "stock",
    aliases: [
      "stock",
      "cantidad",
      "existencias",
      "cantidad_disponible",
      "qty",
      "quantity",
      "stock_actual",
      "stockactual",
    ],
  },
  {
    field: "sale_unit",
    aliases: [
      "sale_unit",
      "unidad",
      "unidad_venta",
      "unidadventa",
      "unidad_de_venta",
      "unit",
      "unidades",
    ],
  },
  {
    field: "min_stock",
    aliases: [
      "min_stock",
      "stock_minimo",
      "stockminimo",
      "stock_min",
      "stockmin",
      "minimo",
      "mínimo",
    ],
  },
  {
    field: "box_qty",
    aliases: [
      "box_qty",
      "piezas_por_caja",
      "piezaspcaja",
      "qty_por_caja",
      "unidades_por_caja",
      "piezasporcaja",
      "unidadesporcaja",
    ],
  },
  {
    field: "box_price",
    aliases: [
      "box_price",
      "precio_caja",
      "preciocaja",
      "precio_de_caja",
      "precio_por_caja",
      "precioporcaja",
    ],
  },
  {
    field: "pack_qty",
    aliases: [
      "pack_qty",
      "piezas_por_paquete",
      "piezaspaquete",
      "pzas_por_paquete",
      "piezaspornaquete",
      "unidades_por_paquete",
    ],
  },
  {
    field: "pack_price",
    aliases: [
      "pack_price",
      "precio_paquete",
      "preciopaquete",
      "precio_por_paquete",
      "precioporpaquete",
    ],
  },
  {
    field: "category",
    aliases: [
      "category",
      "categoria",
      "categoría",
      "departamento",
      "categorianombre",
    ],
  },
];

const normalizeKey = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const buildColumnMap = (headers) => {
  const map = {};
  headers.forEach((h, i) => {
    const norm = normalizeKey(h);
    if (!norm) return;
    for (const col of IMPORT_COLUMNS) {
      if (col.aliases.some((a) => normalizeKey(a) === norm)) {
        map[col.field] = i;
        break;
      }
    }
  });
  return map;
};

const parseCSV = (text) => {
  const firstLine = text.slice(
    0,
    text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"),
  );
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = semis > commas ? ";" : ",";

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
};

ipcMain.handle("select-import-file", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Seleccionar archivo para importar",
      properties: ["openFile"],
      filters: [
        {
          name: "CSV o Base de datos",
          extensions: ["csv", "db", "sqlite", "sqlite3"],
        },
        { name: "Todos los archivos", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0)
      return { success: false, cancelled: true };
    return { success: true, path: result.filePaths[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("import-products-data", async (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath))
      return { success: false, error: "Archivo no encontrado" };

    const ext = path.extname(filePath).toLowerCase();
    let headers = [];
    let dataRows = [];

    if (ext === ".csv") {
      const text = fs.readFileSync(filePath, "utf8");
      const rows = parseCSV(text);
      if (rows.length < 2)
        return { success: false, error: "El CSV no tiene datos suficientes" };
      headers = rows[0].map((h) => String(h).trim());
      dataRows = rows.slice(1);
    } else {
      const src = new Database(filePath, { readonly: true });
      try {
        const table = src
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='products'",
          )
          .get();
        if (!table)
          return {
            success: false,
            error: "La base de datos no contiene una tabla 'products'",
          };
        const cols = src
          .prepare("PRAGMA table_info(products)")
          .all()
          .map((c) => c.name);
        headers = cols;
        const all = src.prepare("SELECT * FROM products").all();
        dataRows = all.map((r) =>
          cols.map((c) => (r[c] === null || r[c] === undefined ? "" : r[c])),
        );
      } finally {
        src.close();
      }
    }

    const colMap = buildColumnMap(headers);
    if (colMap.name === undefined)
      return {
        success: false,
        error: "No se encontró una columna de nombre/producto en el archivo",
      };

    const getVal = (row, field) =>
      colMap[field] !== undefined ? row[colMap[field]] : "";
    const toNum = (v) => {
      const n = parseFloat(String(v).replace(/[$, ]/g, "").trim());
      return isFinite(n) ? n : 0;
    };

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const seenBarcodes = new Set();
    const categoryCache = new Map();

    const txn = db.transaction(() => {
      const existingBarcodes = new Set(
        db
          .prepare("SELECT barcode FROM products WHERE barcode IS NOT NULL")
          .all()
          .map((r) => r.barcode),
      );
      const insert = db.prepare(
        `INSERT INTO products (barcode, name, brand, price, stock, cost_price, min_stock, sale_unit, box_qty, box_price, pack_qty, pack_price, category_id, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      );

      for (const row of dataRows) {
        try {
          const name = String(getVal(row, "name") || "").trim();
          if (!name) {
            skipped++;
            continue;
          }
          const barcode = String(getVal(row, "barcode") || "").trim();
          if (
            barcode &&
            (existingBarcodes.has(barcode) || seenBarcodes.has(barcode))
          ) {
            skipped++;
            continue;
          }
          const saleUnitRaw = String(getVal(row, "sale_unit") || "")
            .toLowerCase()
            .trim();
          const saleUnit = [
            "piece",
            "weight",
            "box",
            "package",
            "boxpack",
          ].includes(saleUnitRaw)
            ? saleUnitRaw
            : "piece";

          let categoryId = null;
          const catName = String(getVal(row, "category") || "").trim();
          if (catName) {
            if (categoryCache.has(catName)) {
              categoryId = categoryCache.get(catName);
            } else {
              let cat = db
                .prepare("SELECT id FROM categories WHERE name = ?")
                .get(catName);
              if (!cat) {
                const info = db
                  .prepare("INSERT INTO categories (name) VALUES (?)")
                  .run(catName);
                cat = { id: info.lastInsertRowid };
              }
              categoryId = cat.id;
              categoryCache.set(catName, categoryId);
            }
          }

          const impStock = Math.round(toNum(getVal(row, "stock")));
          const impMin = Math.round(toNum(getVal(row, "min_stock")));
          insert.run(
            barcode || null,
            name,
            String(getVal(row, "brand") || "").trim() || null,
            toNum(getVal(row, "price")),
            impStock,
            toNum(getVal(row, "cost_price")),
            impMin > 0 ? impMin : autoMinStock(impStock),
            saleUnit,
            Math.round(toNum(getVal(row, "box_qty"))),
            toNum(getVal(row, "box_price")),
            Math.round(toNum(getVal(row, "pack_qty"))),
            toNum(getVal(row, "pack_price")),
            categoryId,
          );
          if (barcode) seenBarcodes.add(barcode);
          imported++;
        } catch {
          errors++;
        }
      }
    });
    txn();

    return { success: true, imported, skipped, errors };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── CATÁLOGO (productos de referencia, no activos) ──────────────
const CATALOG_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "e",
  "o",
  "u",
  "en",
  "al",
  "con",
  "por",
  "para",
  "sin",
  "a",
  "que",
  "un",
  "una",
  "sus",
  "no",
]);

const titleCase = (s) => {
  if (s == null) return "";
  const clean = String(s).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean
    .split(" ")
    .map((word, i) => {
      if (!word) return "";
      if (/^[A-ZÑ]{2,4}$/.test(word)) return word;
      if (/^\d+[A-ZÑ]{1,4}$/.test(word)) return word;
      if (/^[A-ZÑ]{1,4}\d+$/.test(word)) return word;
      const lower = word.toLowerCase();
      const stripped = lower.replace(/^[^a-zñáéíóúü0-9]+/, "");
      if (
        i > 0 &&
        /^[a-zñáéíóúü]+$/.test(stripped) &&
        CATALOG_STOP_WORDS.has(stripped)
      )
        return lower;
      const lead = lower.slice(0, lower.length - stripped.length);
      const capped = stripped
        .split("-")
        .map((seg, si) => {
          if (!seg) return "";
          if (
            si > 0 &&
            CATALOG_STOP_WORDS.has(seg) &&
            /^[a-zñáéíóúü]+$/.test(seg)
          )
            return seg;
          const m = seg.search(/[a-zñáéíóúü]/);
          if (m === -1) return seg;
          return seg.slice(0, m) + seg[m].toUpperCase() + seg.slice(m + 1);
        })
        .join("-");
      return lead + capped;
    })
    .join(" ");
};

const catalogImportKey = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n");

const CATALOG_COLUMNS = [
  {
    field: "barcode",
    aliases: [
      "sku",
      "codigo",
      "codigodebarras",
      "barcode",
      "ean",
      "upc",
      "codigodelproducto",
      "codigosku",
      "codigos",
    ],
  },
  {
    field: "name",
    aliases: [
      "descripcion",
      "nombre",
      "producto",
      "articulo",
      "desc",
      "nombredelproducto",
      "descripciondelproducto",
      "denominacion",
    ],
  },
  {
    field: "box_qty",
    aliases: [
      "piezascaja",
      "unidadescaja",
      "piezasporcaja",
      "contenidocaja",
      "unidadesporcaja",
      "piezasxcaja",
      "uniidadesxcaja",
      "piezasencaja",
    ],
  },
  {
    field: "cost_box",
    aliases: ["costocaja", "costo decaja", "costo por caja", "costoxcaja"],
  },
  {
    field: "cost_price",
    aliases: [
      "costopieza",
      "costo",
      "costoporpieza",
      "costounitario",
      "preciocompra",
      "costoxpieza",
      "costodecompra",
      "costopza",
    ],
  },
  {
    field: "price",
    aliases: [
      "preciopieza",
      "precio",
      "precioventa",
      "preciodeventa",
      "pventa",
      "preciounitario",
      "precioxpieza",
      "preciopublico",
      "preciopza",
      "preciodeventa",
    ],
  },
  {
    field: "sale_unit",
    aliases: [
      "unidaddemedida",
      "unidad",
      "presentacion",
      "unidaddeventa",
      "medida",
      "um",
      "unidaddeproducto",
    ],
  },
  {
    field: "category",
    aliases: [
      "categoria",
      "categorianombre",
      "departamento",
      "grupo",
      "clasificacion",
      "familia",
      "linea",
    ],
  },
];

const buildCatalogColumnMap = (headers) => {
  const map = {};
  headers.forEach((h, i) => {
    const norm = normalizeKey(h);
    if (!norm) return;
    for (const col of CATALOG_COLUMNS) {
      if (col.aliases.some((a) => normalizeKey(a) === norm)) {
        if (map[col.field] === undefined) map[col.field] = i;
        else if (
          norm.startsWith("preciopieza") ||
          norm.startsWith("costopieza")
        )
          map[col.field] = i;
        break;
      }
    }
  });
  return map;
};

const saleUnitFromLabel = (label) => {
  const l = String(label || "")
    .toUpperCase()
    .trim();
  if (!l) return "piece";
  if (
    [
      "UNIDAD",
      "PIEZAS",
      "PIEZA",
      "PZA",
      "PZAS",
      "PZ",
      "UND",
      "UNDS",
      "PIEZA UNICA",
    ].includes(l)
  )
    return "piece";
  return "weight";
};

ipcMain.handle("select-catalog-file", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Seleccionar archivo del catálogo",
      properties: ["openFile"],
      filters: [{ name: "Excel o CSV", extensions: ["xlsx", "xls", "csv"] }],
    });
    if (result.canceled || result.filePaths.length === 0)
      return { success: false, cancelled: true };
    return { success: true, path: result.filePaths[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const runCatalogImport = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath))
      return { success: false, error: "Archivo no encontrado" };

    const ext = path.extname(filePath).toLowerCase();
    let headers = [];
    let dataRows = [];

    if (ext === ".csv") {
      const text = fs.readFileSync(filePath, "utf8");
      const rows = parseCSV(text);
      if (rows.length < 2)
        return { success: false, error: "El CSV no tiene datos suficientes" };
      headers = rows[0].map((h) => String(h).trim());
      dataRows = rows.slice(1);
    } else if (ext === ".xlsx" || ext === ".xls") {
      const XLSX = require("xlsx");
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: "",
      });
      if (rows.length < 2)
        return {
          success: false,
          error: "El archivo no tiene datos suficientes",
        };
      headers = rows[0].map((h) => String(h ?? "").trim());
      dataRows = rows.slice(1);
    } else {
      return {
        success: false,
        error: "Formato no soportado (usa Excel .xlsx o CSV)",
      };
    }

    const colMap = buildCatalogColumnMap(headers);
    if (colMap.name === undefined)
      return {
        success: false,
        error: "No se encontró una columna de nombre/descripción en el archivo",
      };

    const getVal = (row, field) =>
      colMap[field] !== undefined
        ? String(row[colMap[field]] ?? "").trim()
        : "";
    const toPrice = (v) => {
      const n = parseFloat(String(v).replace(/[$, ]/g, ""));
      return isFinite(n) && n > 0 ? n : 0;
    };

    const existingRows = new Map(
      db
        .prepare(
          "SELECT id, barcode, is_active, is_catalog FROM products WHERE barcode IS NOT NULL",
        )
        .all()
        .map((r) => [r.barcode, r]),
    );

    const insertNew = db.prepare(
      `INSERT INTO products (barcode, name, cat_name, ref_unit, price, stock, cost_price, min_stock, sale_unit, box_qty, box_price, category_id, is_active, is_catalog)
       VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, 0, 1)`,
    );
    const updateRef = db.prepare(
      `UPDATE products SET is_catalog = 1, cat_name = ?, ref_unit = ?, cost_price = ?, sale_unit = ?, box_qty = ?, box_price = ?, category_id = ? WHERE id = ?`,
    );
    const linkActive = db.prepare(
      `UPDATE products SET is_catalog = 1, cat_name = ?, ref_unit = ? WHERE id = ?`,
    );

    let imported = 0;
    let linked = 0;
    let updatedRef = 0;
    let skipped = 0;
    let errors = 0;
    const seen = new Map();

    const txn = db.transaction(() => {
      for (const row of dataRows) {
        try {
          const rawName = getVal(row, "name");
          if (!rawName) {
            skipped++;
            continue;
          }
          const catName = titleCase(rawName);
          const barcode = getVal(row, "barcode");
          const key = barcode || catName.toLowerCase();
          if (key && seen.has(key)) {
            skipped++;
            continue;
          }
          if (barcode) seen.set(barcode, true);
          else seen.set(catName.toLowerCase(), true);

          const refUnit = getVal(row, "sale_unit");
          const saleUnit = saleUnitFromLabel(refUnit);
          const cost = toPrice(getVal(row, "cost_price"));
          const price = toPrice(getVal(row, "price"));
          const boxQty = Math.round(toPrice(getVal(row, "box_qty")));
          const boxPrice =
            price > 0 && boxQty > 0
              ? Math.round(price * boxQty * 100) / 100
              : 0;
          const categoryId = null;

          const existing = barcode ? existingRows.get(barcode) : null;
          if (existing) {
            if (existing.is_active === 1) {
              linkActive.run(catName, refUnit, existing.id);
              linked++;
            } else {
              updateRef.run(
                catName,
                refUnit,
                cost,
                saleUnit,
                boxQty,
                boxPrice,
                categoryId,
                existing.id,
              );
              updatedRef++;
              if (barcode)
                existingRows.set(barcode, {
                  ...existing,
                  is_active: 0,
                  is_catalog: 1,
                });
            }
          } else {
            insertNew.run(
              barcode || null,
              catName,
              catName,
              refUnit,
              price,
              cost,
              saleUnit,
              boxQty,
              boxPrice,
              categoryId,
            );
            imported++;
          }
        } catch (err) {
          errors++;
        }
      }
    });
    txn();

    return {
      success: true,
      imported,
      linked,
      updatedRef,
      skipped,
      errors,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

ipcMain.handle("import-catalog-data", async (event, filePath) => {
  return runCatalogImport(filePath);
});

const catalogSeedFile = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "bd sku.xlsx")
    : path.join(app.getAppPath(), "bd sku.xlsx");

const seedCatalogIfEmpty = (force = false) => {
  try {
    const count = db
      .prepare("SELECT COUNT(*) c FROM products WHERE is_catalog = 1")
      .get().c;
    if (count > 0 && !force) return;
    const file = catalogSeedFile();
    if (!fs.existsSync(file)) {
      console.error("[catálogo] Archivo semilla no encontrado:", file);
      return;
    }
    const result = runCatalogImport(file);
    if (result.success) {
      console.log(
        force
          ? "[catálogo] REIMPORTACIÓN forzada:"
          : "[catálogo] Carga automática:",
        `Nuevos: ${result.imported} · Vinculados: ${result.linked} · Actualizados: ${result.updatedRef} · Omitidos: ${result.skipped}`,
      );
      const total = db
        .prepare("SELECT COUNT(*) c FROM products WHERE is_catalog = 1")
        .get().c;
      console.log(`[catálogo] Total is_catalog=1 tras carga: ${total}`);
    } else {
      console.error("[catálogo] Error en carga automática:", result.error);
    }
  } catch (error) {
    console.error("[catálogo] Error en carga automática:", error.message);
  }
};

ipcMain.handle(
  "get-catalog-products",
  async (event, { search = "", categoryId, page = 1, pageSize = 50 } = {}) => {
    try {
      const where = ["p.is_catalog = 1"];
      const params = [];
      if (search && search.trim()) {
        const n = `%${nomarize(search.trim())}%`;
        where.push(
          "(nomar(COALESCE(NULLIF(p.cat_name,''), p.name)) LIKE ? OR nomar(p.name) LIKE ? OR p.barcode LIKE ? OR nomar(COALESCE(p.brand,'')) LIKE ?)",
        );
        params.push(n, n, n, n);
      }
      if (
        categoryId !== undefined &&
        categoryId !== null &&
        categoryId !== ""
      ) {
        if (categoryId === "uncategorized") {
          where.push("p.category_id IS NULL");
        } else {
          where.push("p.category_id = ?");
          params.push(parseInt(categoryId, 10));
        }
      }
      const sqlWhere = where.join(" AND ");
      const total = db
        .prepare(`SELECT COUNT(*) c FROM products p WHERE ${sqlWhere}`)
        .get(...params).c;
      const pageN = Math.max(parseInt(page, 10) || 1, 1);
      const sizeN = Math.min(Math.max(parseInt(pageSize, 10) || 50, 5), 200);
      const rows = db
        .prepare(
          `SELECT p.id, p.barcode,
                  COALESCE(NULLIF(p.cat_name,''), p.name) AS cat_name,
                  p.name AS inv_name, p.brand, p.price, p.cost_price, p.stock,
                  p.min_stock, p.sale_unit, p.ref_unit, p.box_qty, p.box_price,
                  p.is_active, p.category_id, c.name AS category_name
           FROM products p
           LEFT JOIN categories c ON p.category_id = c.id
           WHERE ${sqlWhere}
           ORDER BY COALESCE(NULLIF(p.cat_name,''), p.name) COLLATE NOCASE ASC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, sizeN, (pageN - 1) * sizeN);
      return { success: true, rows, total, page: pageN, pageSize: sizeN };
    } catch (error) {
      return { success: false, error: error.message, rows: [], total: 0 };
    }
  },
);

ipcMain.handle("get-catalog-stats", async () => {
  try {
    const one = (q) => db.prepare(q).get().c;
    const total = one("SELECT COUNT(*) c FROM products WHERE is_catalog = 1");
    const pendientes = one(
      "SELECT COUNT(*) c FROM products WHERE is_catalog = 1 AND is_active = 0",
    );
    const registrados = one(
      "SELECT COUNT(*) c FROM products WHERE is_catalog = 1 AND is_active = 1",
    );
    const sinCategoria = one(
      "SELECT COUNT(*) c FROM products WHERE is_catalog = 1 AND category_id IS NULL",
    );
    return { success: true, total, pendientes, registrados, sinCategoria };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-catalog-categories", async () => {
  try {
    const categories = db
      .prepare(
        `SELECT c.id, c.name, COUNT(p.id) AS cnt
         FROM categories c
         JOIN products p ON p.category_id = c.id AND p.is_catalog = 1
         GROUP BY c.id
         ORDER BY c.name COLLATE NOCASE ASC`,
      )
      .all();
    const uncategorized = db
      .prepare(
        "SELECT COUNT(*) c FROM products WHERE is_catalog = 1 AND category_id IS NULL",
      )
      .get().c;
    return { success: true, categories, uncategorized };
  } catch (error) {
    return { success: false, error: error.message, categories: [] };
  }
});

ipcMain.handle("activate-catalog-product", async (event, id, data) => {
  try {
    const prod = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!prod || prod.is_catalog !== 1)
      return { success: false, error: "Producto de catálogo no encontrado" };

    const price = parseFloat(data.price) || 0;
    if (price <= 0)
      return { success: false, error: "El precio debe ser mayor a 0" };

    const boxQty = parseInt(data.box_qty, 10) || 0;
    db.prepare(
      `UPDATE products SET
         price = ?, cost_price = ?, min_stock = ?, sale_unit = ?, stock = ?,
         box_qty = ?, box_price = ?, pack_qty = ?, pack_price = ?,
         category_id = ?, supplier_id = ?, discount_percent = ?, has_discount = ?,
         is_active = 1
       WHERE id = ?`,
    ).run(
      price,
      parseFloat(data.cost_price) || 0,
      parseInt(data.min_stock, 10) > 0 ? parseInt(data.min_stock, 10) : 0,
      data.sale_unit || "piece",
      parseInt(data.stock, 10) || 0,
      boxQty,
      parseFloat(data.box_price) || 0,
      parseInt(data.pack_qty, 10) || 0,
      parseFloat(data.pack_price) || 0,
      data.category_id ? parseInt(data.category_id, 10) : prod.category_id,
      data.supplier_id ? parseInt(data.supplier_id, 10) : prod.supplier_id,
      data.has_discount ? parseFloat(data.discount_percent) || 0 : 0,
      data.has_discount ? 1 : 0,
      id,
    );
    savePrices(
      id,
      (data.prices || [])
        .map((p) => ({
          type: p.type === "mayoreo" ? "mayoreo" : "combo",
          qty: parseInt(p.qty, 10) || 0,
          price: parseFloat(p.price) || 0,
        }))
        .filter((p) => p.qty > 0 && p.price > 0),
    );
    return { success: true, id };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-catalog-product", async (event, id) => {
  try {
    const prod = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!prod || prod.is_catalog !== 1)
      return { success: false, error: "Producto de catálogo no encontrado" };
    if (prod.is_active === 1)
      return {
        success: false,
        error: "Ya está registrado en inventario. Elimínalo desde Productos.",
      };
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("update-catalog-name", async (event, id, name) => {
  try {
    const prod = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!prod || prod.is_catalog !== 1)
      return { success: false, error: "Producto de catálogo no encontrado" };
    const clean = String(name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return { success: false, error: "El nombre no puede ir vacío" };
    db.prepare("UPDATE products SET cat_name = ? WHERE id = ?").run(clean, id);
    return { success: true, cat_name: clean };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── TAREAS (TASKS) ─────────────────────────────────────────
const notifiedTasks = new Set();

ipcMain.handle(
  "add-task",
  async (
    event,
    { title, description, taskDate, taskTime, reminderMinutes },
  ) => {
    try {
      const stmt = db.prepare(
        "INSERT INTO tasks (title, description, task_date, task_time, reminder_minutes) VALUES (?, ?, ?, ?, ?)",
      );
      const result = stmt.run(
        title,
        description || "",
        taskDate,
        taskTime || null,
        reminderMinutes || 30,
      );
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "update-task",
  async (
    event,
    { id, title, description, taskDate, taskTime, reminderMinutes },
  ) => {
    try {
      db.prepare(
        "UPDATE tasks SET title = ?, description = ?, task_date = ?, task_time = ?, reminder_minutes = ? WHERE id = ?",
      ).run(
        title,
        description || "",
        taskDate,
        taskTime || null,
        reminderMinutes || 30,
        id,
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("delete-task", async (event, id) => {
  try {
    db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-tasks-by-date", async (event, date) => {
  try {
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE task_date = ? ORDER BY task_time ASC")
      .all(date);
    return { success: true, tasks };
  } catch (error) {
    return { success: false, error: error.message, tasks: [] };
  }
});

ipcMain.handle("get-today-tasks", async () => {
  try {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Mexico_City",
    });
    const tasks = db
      .prepare(
        "SELECT * FROM tasks WHERE task_date = ? AND completed = 0 ORDER BY task_time ASC",
      )
      .all(today);
    return { success: true, tasks };
  } catch (error) {
    return { success: false, error: error.message, tasks: [] };
  }
});

ipcMain.handle("complete-task", async (event, id) => {
  try {
    db.prepare("UPDATE tasks SET completed = 1 WHERE id = ?").run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── BASCULA (SCALE) ────────────────────────────────────────

const { execSync, spawn } = require("child_process");

let scaleConnected = false;
let scalePortPath = "";
let scaleBaudRate = 115200;
let scaleProcess = null;

const psReadWeightAsync = (port, baud) => {
  const script = `
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $ErrorActionPreference = "Stop"
    try {
      $port = New-Object System.IO.Ports.SerialPort "${port}", ${baud}, None, 8, One
      $port.ReadTimeout = 100
      $port.Open()
      Write-Output "SCALE_OK"
      Start-Sleep -Milliseconds 200
      $port.DiscardInBuffer()
      $port.Write("P")
      $data = ""
      $deadline = (Get-Date).AddSeconds(3)
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 50
        while ($port.BytesToRead -gt 0) {
          $data += [char]$port.ReadByte()
        }
        if ($data -match "\\r" -or $data -match "\\n") { break }
      }
      $port.Close()
      Write-Output $data
    } catch {
      Write-Output "SCALE_ERR: $($_.Exception.Message)"
    }
  `;
  const tmpFile = path.join(app.getPath("userData"), "scale-read.ps1");
  fs.writeFileSync(tmpFile, script, "utf-8");
  return new Promise((resolve, reject) => {
    const proc = spawn("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      tmpFile,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d;
    });
    proc.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
      reject(new Error(stderr.trim() || "Timeout leyendo báscula"));
    }, 8000);
    proc.on("error", (err) => {
      clearTimeout(timer);
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
      reject(err);
    });
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
      const lines = stdout.split(/\r?\n/);
      const first = (lines[0] || "").trim();
      if (first.startsWith("SCALE_ERR:")) {
        resolve({ ok: false, raw: first.slice("SCALE_ERR:".length).trim() });
      } else if (first === "SCALE_OK") {
        resolve({ ok: true, raw: lines.slice(1).join("\n").trim() });
      } else {
        resolve({ ok: true, raw: stdout.trim() });
      }
    });
  });
};

const psContinuousScript = (port, baud) => `
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $port = New-Object System.IO.Ports.SerialPort "${port}", ${baud}, None, 8, One
  $port.ReadTimeout = -1
  $port.Open()
  Start-Sleep -Milliseconds 200
  $port.DiscardInBuffer()
  while ($true) {
    if ($port.BytesToRead -eq 0) {
      try { $port.Write("P") } catch { break }
    }
    $data = ""
    while ($port.BytesToRead -gt 0) {
      try {
        $bytes = $port.ReadByte()
        if ($bytes -eq 13 -or $bytes -eq 10) {
          if ($data.Length -gt 0) {
            Write-Output $data
            $data = ""
          }
        } else {
          $data += [char]$bytes
        }
      } catch { break }
    }
    if ($data.Length -gt 0) {
      Write-Output $data
    }
    Start-Sleep -Milliseconds 50
  }
`;

ipcMain.handle("list-serial-ports", async () => {
  try {
    const result = execSync(
      `powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object { \\"\\"" + $_ + \\"\\"" }"`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();
    if (!result) return [];
    const names = result.split(/\r?\n/).filter(Boolean);
    return names.map((p) => ({
      path: p.trim(),
      manufacturer: "",
      friendlyName: p.trim(),
    }));
  } catch (error) {
    return [];
  }
});

ipcMain.handle("connect-scale", async (event, portPath, baudRate = 115200) => {
  const baud = parseInt(baudRate) || 115200;
  try {
    const probe = await psReadWeightAsync(portPath, baud);
    if (!probe.ok) {
      scaleConnected = false;
      scalePortPath = "";
      return {
        success: false,
        error: probe.raw || "No se pudo abrir el puerto",
      };
    }
    scaleConnected = true;
    scalePortPath = portPath;
    scaleBaudRate = baud;
    const match = probe.raw.match(/(-?\d+\.?\d*)/);
    const weight = match ? parseFloat(match[1]) : null;
    return {
      success: true,
      raw: probe.raw,
      weight,
      error: probe.raw
        ? undefined
        : "Puerto abierto, sin lectura (revisa baud/protocolo)",
    };
  } catch (error) {
    scaleConnected = false;
    scalePortPath = "";
    return { success: false, error: error.message || "No se pudo conectar" };
  }
});

ipcMain.handle("read-weight", async () => {
  if (!scaleConnected || !scalePortPath) {
    return { success: false, error: "Bascula no conectada" };
  }
  try {
    const probe = await psReadWeightAsync(
      scalePortPath,
      scaleBaudRate || 115200,
    );
    if (!probe.ok) {
      return {
        success: false,
        error: probe.raw || "No se pudo abrir el puerto",
      };
    }
    const match = probe.raw.match(/(-?\d+\.?\d*)/);
    if (match) {
      return { success: true, weight: parseFloat(match[1]), raw: probe.raw };
    }
    return { success: false, error: "No se pudo leer el peso", raw: probe.raw };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("disconnect-scale", async () => {
  if (scaleProcess) {
    scaleProcess.kill();
    scaleProcess = null;
  }
  scaleConnected = false;
  scalePortPath = "";
  return { success: true };
});

ipcMain.handle(
  "start-weight-stream",
  async (event, portPath, baudRate = 115200) => {
    try {
      if (scaleProcess) {
        scaleProcess.kill();
        scaleProcess = null;
      }
      const script = psContinuousScript(portPath, parseInt(baudRate));
      const tmpFile = path.join(app.getPath("userData"), "scale-stream.ps1");
      fs.writeFileSync(tmpFile, script, "utf-8");
      scaleProcess = spawn("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        tmpFile,
      ]);
      scaleConnected = true;
      scalePortPath = portPath;
      scaleBaudRate = parseInt(baudRate) || 115200;
      const win = BrowserWindow.getAllWindows()[0];
      const scaleSendError = (msg) => {
        console.error("[SCALE STDERR]", msg);
        if (win && !win.isDestroyed()) {
          win.webContents.send("scale-error", msg);
        }
      };
      scaleProcess.stderr.on("data", (data) => {
        scaleSendError(String(data).trim());
      });
      scaleProcess.on("error", (err) => {
        scaleSendError(err.message);
        scaleConnected = false;
        scaleProcess = null;
      });
      scaleProcess.on("close", (code) => {
        console.log("[SCALE CLOSED] code:", code);
        scaleConnected = false;
        scaleProcess = null;
      });
      scaleProcess.stdout.on("data", (data) => {
        const lines = String(data).split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const match = line.match(/(-?\d+\.?\d*)/);
          if (match && win && !win.isDestroyed()) {
            win.webContents.send("weight-update", {
              weight: parseFloat(match[1]),
              raw: line.trim(),
            });
          }
        }
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("stop-weight-stream", async () => {
  if (scaleProcess) {
    scaleProcess.kill();
    scaleProcess = null;
  }
  return { success: true };
});

ipcMain.handle("is-scale-connected", async () => {
  return { connected: scaleConnected };
});

// ─── IMPRESION DE TICKETS (WINDOWS SPOOLER + POS58 DRIVER) ───────
const { BrowserWindow: BW } = require("electron");

ipcMain.handle("get-printers", async () => {
  try {
    const { BrowserWindow: BW } = require("electron");
    const window = BW.getFocusedWindow();
    const printers = (await window?.webContents.getPrintersAsync?.()) ?? [];
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || "",
      status: p.status ?? 0,
      isDefault: !!p.isDefault,
    }));
  } catch (error) {
    console.error("[PRINTERS] Error al listar impresoras:", error.message);
    return [];
  }
});

ipcMain.handle("print-receipt", async (event, htmlContent) => {
  let printWin = null;
  try {
    // Verifica el nombre EXACTO de la impresora antes de imprimir
    const printers =
      (await BW.getFocusedWindow()?.webContents.getPrintersAsync?.()) ?? [];
    console.log(
      "[PRINT] Impresoras detectadas:",
      printers.map((p) => p.name),
    );

    printWin = new BW({
      show: false,
      width: 220,
      height: 700,
      backgroundColor: "#ffffff",
      webPreferences: {
        sandbox: true,
      },
    });

    await printWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const printPromise = new Promise((resolve, reject) => {
      printWin.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: "GHIA-GTP582",
          margins: { marginType: "none" },
          pageSize: { width: 58000, height: 200000 },
        },
        (success, errorType) => {
          if (success) resolve(true);
          else
            reject(
              new Error(
                errorType || "No se pudo enviar el trabajo de impresión",
              ),
            );
        },
      );
    });

    // Timeout de seguridad: si el callback nunca regresa, no te quedes colgado
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error("TIMEOUT: el callback de print nunca respondió")),
        8000,
      ),
    );

    const printed = await Promise.race([printPromise, timeoutPromise]);

    if (!printed) {
      throw new Error("La impresión no fue aceptada por el spooler");
    }

    console.log("[PRINT] Completado OK");
    return { success: true };
  } catch (error) {
    console.error("[PRINT ERROR]", error.message);
    return { success: false, error: error.message };
  } finally {
    if (printWin && !printWin.isDestroyed()) {
      printWin.destroy();
    }
  }
});

// ─── APERTURA DE CAJON (CASH DRAWER) — worker persistente ─────
// Se mantiene un solo powershell.exe vivo que compila el Add-Type una vez
// y queda escuchando por stdin: "OPEN" -> abre el cajón. Las aperturas
// posteriores tardan milisegundos en vez de ~2-3s (arranque + compilación).
const DRAWER_PRINTER = "GHIA-GTP582";
let drawerWorker = null;
let drawerWorkerWaiters = [];
let drawerWorkerReadyHandlers = [];
let drawerChain = Promise.resolve();

const drawerScriptPath = () =>
  path.join(app.getPath("temp"), "pos-drawer-worker.ps1");

function spawnDrawerWorker() {
  const psCode = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Drawer {
    [DllImport("winspool.drv")]
    public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv")]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool StartDocPrinter(IntPtr h, int l, ref DOCINFO d);
    [DllImport("winspool.drv")]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
    public struct DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
    public static void Open(string printerName) {
        IntPtr hPrinter;
        if(!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) throw new Exception("No se pudo abrir impresora");
        try {
            var di = new DOCINFO { pDocName = "Drawer", pDataType = "RAW" };
            StartDocPrinter(hPrinter, 1, ref di);
            StartPagePrinter(hPrinter);
            byte[] b = new byte[] {0x1B,0x70,0x00,0x32,0x00};
            IntPtr p = Marshal.AllocHGlobal(b.Length);
            try {
                Marshal.Copy(b, 0, p, b.Length);
                int written;
                WritePrinter(hPrinter, p, b.Length, out written);
            } finally {
                Marshal.FreeHGlobal(p);
            }
            EndPagePrinter(hPrinter);
            EndDocPrinter(hPrinter);
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
"@
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq "OPEN") {
        try {
            [Drawer]::Open("${DRAWER_PRINTER}")
            [Console]::Out.WriteLine("OK")
        } catch {
            [Console]::Out.WriteLine("ERR " + $_.Exception.Message)
        }
        [Console]::Out.Flush()
    }
}
`;
  try {
    fs.writeFileSync(drawerScriptPath(), psCode, "utf8");
  } catch (e) {
    console.error("[DRAWER] No se pudo escribir el script:", e.message);
  }

  drawerWorker = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", drawerScriptPath()],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );

  let buffer = "";
  drawerWorker.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "").trim();
      buffer = buffer.slice(idx + 1);
      if (line === "READY") {
        const handlers = drawerWorkerReadyHandlers.splice(0);
        handlers.forEach((h) => h());
      } else if (drawerWorkerWaiters.length > 0) {
        const waiter = drawerWorkerWaiters.shift();
        if (line === "OK") waiter({ success: true });
        else if (line.startsWith("ERR "))
          waiter({ success: false, error: line.slice(4) });
        else waiter({ success: false, error: "Respuesta inesperada: " + line });
      }
    }
  });

  drawerWorker.stderr.on("data", (d) => {
    console.error("[DRAWER stderr]", d.toString().trim());
  });

  const failAll = (error) => {
    const waiters = drawerWorkerWaiters.splice(0);
    waiters.forEach((w) => w({ success: false, error }));
  };

  drawerWorker.on("error", (e) => {
    console.error("[DRAWER ERROR]", e.message);
    failAll(e.message);
    drawerWorker = null;
  });

  drawerWorker.on("exit", () => {
    failAll("El proceso del cajón terminó inesperadamente");
    drawerWorker = null;
  });
}

function ensureDrawerWorker() {
  return new Promise((resolve) => {
    if (
      drawerWorker &&
      drawerWorker.exitCode === null &&
      !drawerWorker.killed
    ) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timeout = setTimeout(done, 15000);
    drawerWorkerReadyHandlers.push(() => {
      clearTimeout(timeout);
      done();
    });
    spawnDrawerWorker();
  });
}

function destroyDrawerWorker() {
  const proc = drawerWorker;
  drawerWorker = null;
  if (proc) {
    try {
      proc.stdin.end();
    } catch {}
    try {
      proc.kill();
    } catch {}
  }
  const waiters = drawerWorkerWaiters.splice(0);
  waiters.forEach((w) =>
    w({ success: false, error: "Cajón detenido al cerrar la app" }),
  );
  try {
    fs.unlinkSync(drawerScriptPath());
  } catch {}
}

ipcMain.handle("open-cash-drawer", () => {
  const task = drawerChain.then(
    () =>
      new Promise((resolve) => {
        ensureDrawerWorker().then(() => {
          const proc = drawerWorker;
          if (!proc || proc.killed || proc.exitCode !== null) {
            resolve({
              success: false,
              error: "No se pudo iniciar el proceso del cajón",
            });
            return;
          }
          const timeout = setTimeout(
            () =>
              resolve({ success: false, error: "Timeout abriendo el cajón" }),
            8000,
          );
          drawerWorkerWaiters.push((result) => {
            clearTimeout(timeout);
            resolve(result);
          });
          try {
            proc.stdin.write("OPEN\n");
          } catch (e) {
            clearTimeout(timeout);
            resolve({ success: false, error: e.message });
          }
        });
      }),
  );
  drawerChain = task.catch(() => ({
    success: false,
    error: "Error abriendo el cajón",
  }));
  return drawerChain;
});
