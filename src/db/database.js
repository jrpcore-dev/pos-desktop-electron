const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Asegurarse de que el directorio de la base de datos exista
const dbDir = path.resolve(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "pos-system.db");
const db = new Database(dbPath);

// Crear tablas si no existen
const createTables = () => {
  const productsSchema = `
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      brand TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL
    );
  `;

  const salesSchema = `
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const saleItemsSchema = `
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price_at_sale REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales (id),
      FOREIGN KEY (product_id) REFERENCES products (id)
    );
  `;

  const settingsSchema = `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;

  db.exec(productsSchema);
  db.exec(salesSchema);
  db.exec(saleItemsSchema);
  db.exec(settingsSchema);
  console.log("Base de datos y tablas aseguradas.");
};

createTables();

module.exports = db;
