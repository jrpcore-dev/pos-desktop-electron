"use strict";
/*
 * Fixture de esquema compartido por los harness de scripts/ (PASO 3).
 *
 * El esquema NO está escrito a mano aquí: se construye con
 * src/main/db-schema.js (createTables/runMigrations/ensureColumn extraídos de
 * main.js en el paso 2), es decir, con el MISMO código que la app ejecuta al
 * arrancar.
 *
 * ARREGLO (PASO A): el bug de instalación nueva (`SQLITE_ERROR: no such
 * column: stock_deducted` al arrancar sobre una BD vacía) ya está corregido en
 * src/main/db-schema.js — sale_items se crea ahora en su forma final y la
 * reconstrucción copia solo las columnas existentes, así que una BD vacía
 * arranca sin errores (prueba permanente: scripts/check-empty-db.cjs).
 * Este fixture mantiene a propósito la forma LEGADA (product_id NOT NULL +
 * stock_deducted) para seguir ejercitando el camino de migración real: la
 * reconstrucción sustituye la tabla por la canónica (product_id nullable).
 * Es el mismo estado en el que está cualquier BD vieja del cliente.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.resolve(__dirname, "..");
const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
const dbSchema = require(path.join(REPO, "src", "main", "db-schema.js"));
const activation = require(path.join(REPO, "src", "main", "activation.js"));

// Misma definición que main.js:99-108 (runMigrations usa la función SQL nomar).
const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();

const LEGACY_SALE_ITEMS = `
CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  price_at_sale REAL NOT NULL,
  discount_percent REAL DEFAULT 0,
  stock_deducted REAL DEFAULT 0
)`;

// Secuencia idéntica a la de arranque de main.js (líneas 96-98, 113, 117, 130).
const startupSequence = (db) => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    db.function("nomar", nomarize);
  } catch (e) {}
  dbSchema.createTables(db);
  activation.ensureSchema(db);
  dbSchema.runMigrations(db);
};

let ddlCache = null;

// Construye una BD temporal, la migra y devuelve el DDL resultante (tablas +
// índices). Se ejecuta una sola vez por proceso y se cachea.
const buildDdl = () => {
  if (ddlCache) return ddlCache;
  const file = path.join(os.tmpdir(), `vendia-fixture-${process.pid}.db`);
  for (const f of [file, file + "-wal", file + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch (e) {}
  }
  const db = new Database(file);
  db.exec(LEGACY_SALE_ITEMS);
  // Dos pasadas: la reconstrucción de cash_register_expenses (register_id
  // nullable) se dispara en la segunda, como en una BD real que arranca dos veces.
  startupSequence(db);
  startupSequence(db);
  ddlCache = db
    .prepare(
      // ORDER BY rowid = orden de creación: así cada índice se materializa
      // DESPUÉS de su tabla (con "ORDER BY type,name" los índices saldrían
      // antes que las tablas y exec() fallaría con "no such table").
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all()
    .map((r) => r.sql);
  db.close();
  for (const f of [file, file + "-wal", file + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch (e) {}
  }
  return ddlCache;
};

const applySchema = (db) => {
  db.pragma("foreign_keys = ON");
  try {
    db.function("nomar", nomarize);
  } catch (e) {}
  db.exec(buildDdl().join(";\n"));
  // Como en main.js:392, activation.ensureSchema corre en cada arranque y es
  // quien genera el código de activación si no existe.
  activation.ensureSchema(db);
  return db;
};

const createMemoryDb = () => applySchema(new Database(":memory:"));

const createFileDb = (file) => {
  for (const f of [file, file + "-wal", file + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch (e) {}
  }
  const db = new Database(file);
  applySchema(db);
  return db;
};

module.exports = {
  REPO,
  Database,
  nomarize,
  buildDdl,
  applySchema,
  createMemoryDb,
  createFileDb,
};
