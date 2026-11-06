"use strict";
/*
 * Emparejar una caja en un Host cuya `paired_devices` vino de otra versión.
 *
 * ensureColumn no agrega UNIQUE ni quita NOT NULL: sin la reconstrucción de
 * activation.ensureSchema, cada intento terminaba en PAIR_HOST_ERROR.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-pair-legacy-schema.cjs
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const activation = require(path.join(__dirname, "..", "src", "main", "activation.js"));

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failed += 1;
};

const openWith = (sql) => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);");
  if (sql) db.exec(sql);
  return db;
};

const pair = (db, deviceId) =>
  activation.registerPairing(db, {
    deviceId,
    deviceName: "Caja",
    token: "a".repeat(64),
    deviceType: "desktop_box",
    protocolVersion: "1",
    approved: 0,
    scopes: [],
  });

const LEGACY = {
  "sin device_id, token libre":
    "CREATE TABLE paired_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, device_name TEXT, token TEXT, created_at DATETIME, last_seen DATETIME);",
  "sin device_id, token NOT NULL UNIQUE":
    "CREATE TABLE paired_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, device_name TEXT, token TEXT NOT NULL UNIQUE, created_at DATETIME);",
  "device_id sin UNIQUE, token NOT NULL":
    "CREATE TABLE paired_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, device_name TEXT, token TEXT NOT NULL);",
  "device_id UNIQUE, token NOT NULL":
    "CREATE TABLE paired_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT UNIQUE, device_name TEXT, token TEXT NOT NULL);",
  "device_id como llave, sin id":
    "CREATE TABLE paired_devices (device_id TEXT PRIMARY KEY, device_name TEXT, token TEXT NOT NULL);",
};

for (const [label, sql] of Object.entries(LEGACY)) {
  const db = openWith(sql);
  activation.ensureSchema(db);
  let res = null;
  try {
    res = pair(db, "box-nueva");
  } catch (err) {
    console.log(`     ${err.message}`);
  }
  check(res && res.approved === 0 && res.deviceCode === "A", `${label}: la caja queda pendiente`);
  check(
    db.prepare("SELECT 1 FROM paired_devices WHERE approved = 0 AND revoked = 0").get(),
    `${label}: aparece como solicitud en el Host`,
  );
  db.close();
}

// Filas válidas y triggers sobreviven; duplicados y filas sin device_id no.
{
  const db = openWith(`
    CREATE TABLE change_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT, row_id TEXT);
    CREATE TABLE paired_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, device_name TEXT, paired_token_hash TEXT, token TEXT NOT NULL);
    CREATE TRIGGER trg_change_log_paired_devices_insert AFTER INSERT ON paired_devices
    BEGIN INSERT INTO change_log (tbl, row_id) VALUES ('paired_devices', NEW.id); END;
    INSERT INTO paired_devices (id, device_id, device_name, paired_token_hash, token) VALUES
      (7, 'box-a', 'Vieja', 'h1', 't1'),
      (8, 'box-a', 'Reciente', 'h2', 't2'),
      (9, NULL, 'Sin id', NULL, 't3'),
      (10, 'tel-1', 'Sin hash', NULL, 't4');
    DELETE FROM change_log;
  `);
  activation.ensureSchema(db);
  const rows = db
    .prepare("SELECT id, device_id, device_name, paired_token_hash FROM paired_devices ORDER BY id")
    .all();
  check(rows.length === 2, "reconstrucción: quedan sólo las filas utilizables");
  check(
    rows[0].id === 8 && rows[0].device_name === "Reciente",
    "reconstrucción: conserva id y el duplicado más reciente",
  );
  check(rows[1].paired_token_hash === "", "reconstrucción: hash ausente queda vacío");
  check(
    activation.isPaired(db, "tel-1", "cualquiera") === false,
    "reconstrucción: una fila sin hash sigue sin autenticar",
  );
  pair(db, "box-nueva");
  check(
    db
      .prepare("SELECT 1 FROM change_log WHERE row_id = (SELECT id FROM paired_devices WHERE device_id = 'box-nueva')")
      .get(),
    "reconstrucción: el trigger de réplica sigue activo",
  );
  db.close();
}

// Una tabla que ya sirve no se toca, aunque arrastre columnas viejas.
{
  const db = openWith();
  activation.ensureSchema(db);
  db.exec("ALTER TABLE paired_devices ADD COLUMN token TEXT;");
  db.exec("CREATE UNIQUE INDEX idx_paired_devices_token ON paired_devices(token);");
  pair(db, "box-a");
  activation.ensureSchema(db);
  check(
    db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_paired_devices_token'").get(),
    "tabla sana: no se reconstruye",
  );
  pair(db, "box-b");
  pair(db, "box-a");
  check(db.prepare("SELECT COUNT(*) c FROM paired_devices").get().c === 2, "tabla sana: re-emparejar no duplica");
  db.close();
}

if (failed) {
  console.log(`\n${failed} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\nTodo OK");
