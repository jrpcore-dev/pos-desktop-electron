// Diagnóstico de logos del catálogo Taecel (solo lectura).
// Uso: ELECTRON_RUN_AS_NODE=1 electron.exe scripts/check-taecel-logos.cjs [ruta.db]
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");
const REPO = fixture.REPO;
const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
const { localLogoKey } = require(path.join(REPO, "src", "main", "taecel.js"));

const dbPath =
  process.argv[2] ||
  path.join(os.homedir(), "AppData", "Roaming", "JRP POS", "db", "pos-system.db");
if (!fs.existsSync(dbPath)) {
  console.error("No existe la BD:", dbPath);
  process.exit(1);
}

const SVG_DIR = path.join(REPO, "src", "renderer", "assets", "operators");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const row = db
  .prepare("SELECT value FROM settings WHERE key = 'taecel_catalog_json'")
  .get();
if (!row) {
  console.log("Sin catálogo Taecel cacheado en:", dbPath);
  process.exit(0);
}

const catalog = JSON.parse(row.value);
const ops = catalog.operators || [];
let conSvg = 0;
console.log(`Catálogo de ${dbPath}`);
console.log(`operadores=${ops.length} · fetchedAt=${new Date(catalog.fetchedAt).toISOString()}`);
console.log("");
console.log("logoKey (nuevo)".padEnd(18), "name".padEnd(28), "svg");
console.log("-".repeat(64));
for (const op of ops) {
  const key = localLogoKey(op.name);
  const svg = path.join(SVG_DIR, `${key}.svg`);
  const has = fs.existsSync(svg);
  if (has) conSvg++;
  console.log(
    String(key).padEnd(18),
    String(op.name).slice(0, 26).padEnd(28),
    has ? "si" : "-",
  );
}
console.log("");
console.log(`con SVG local: ${conSvg}/${ops.length} · sin logo: ${ops.length - conSvg}`);
db.close();
