/*
 * PASO 4 · Comprueba que los módulos externalizados que viajan DENTRO del
 * app.asar se pueden cargar con ELECTRON_RUN_AS_NODE=1 (mismo ABI que la app).
 *
 *   1. extrae out/<app>/resources/app.asar a un directorio temporal;
 *   2. hace `require` de cada módulo copiado junto al bundle;
 *   3. compara el SHA-256 de cada módulo extraído con el del repo;
 *   4. comprueba la sintaxis de .vite/build/main.js (no se ejecuta).
 *
 * (@electron/asar v4 es ESM-only, por eso este script es .mjs.)
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-asar-modules.mjs [ruta-al-asar]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as asar from "@electron/asar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const asarPath =
  process.argv[2] || path.join(REPO, "out", "Vendia-win32-x64", "resources", "app.asar");

if (!fs.existsSync(asarPath)) {
  console.error("No existe el asar:", asarPath);
  process.exit(2);
}

const dest = fs.mkdtempSync(path.join(os.tmpdir(), "asar-extract-"));
console.log("asar:", asarPath, `(${fs.statSync(asarPath).size} bytes)`);
console.log("extrayendo en:", dest);
asar.extractAll(asarPath, dest);

const buildDir = path.join(dest, ".vite", "build");
const localRequire = createRequire(path.join(buildDir, "index.cjs"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);

// Módulos externalizados que vite.main.config.mjs copia junto al bundle.
// [ruta en el repo, ruta relativa dentro de .vite/build]
const MODULES = [
  ["src/main/api-server.js", "api-server.js"],
  ["src/main/activation.js", "activation.js"],
  ["src/main/scopes.js", "scopes.js"],
  ["src/main/ipc-scopes.js", "ipc-scopes.js"],
  ["src/main/sales-core.js", "sales-core.js"],
  ["src/main/db-schema.js", "db-schema.js"],
  ["src/main/discovery.js", "discovery.js"],
  ["src/main/pins.js", "pins.js"],
  // Recargas Taecel: el Host habla con el proveedor y lleva el ledger.
  ["src/main/taecel.js", "taecel.js"],
  ["src/main/taecel-errors.js", "taecel-errors.js"],
  ["src/main/service-transactions.js", "service-transactions.js"],
  // 3g · la caja habla con el Host por estos cuatro.
  ["src/main/rpc-context.js", "rpc-context.js"],
  ["src/main/ipc-registry.js", "ipc-registry.js"],
  ["src/main/rpc-channels.js", "rpc-channels.js"],
  ["src/main/box-rpc-client.js", "box-rpc-client.js"],
  ["src/db/database.js", "db/database.js"],
];

let fail = 0;
const line = (ok, label, extra) => {
  if (!ok) fail += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? " · " + extra : ""}`);
};

console.log("\n=== Módulos copiados dentro del asar ===");
for (const [relRepo, relAsar] of MODULES) {
  const nombre = relAsar;
  const inAsar = path.join(buildDir, relAsar);
  const inRepo = path.join(REPO, relRepo);
  if (!fs.existsSync(inAsar)) {
    line(false, nombre, "NO está en el asar");
    continue;
  }
  try {
    const loaded = localRequire(inAsar);
    const tipo = typeof loaded;
    const claves = loaded && typeof loaded === "object" ? Object.keys(loaded).length : 0;
    const hayOriginal = fs.existsSync(inRepo);
    const mismo = hayOriginal ? sha(inAsar) === sha(inRepo) : null;
    line(
      mismo !== false,
      `${nombre} carga (${tipo}, ${claves} exports)`,
      `sha-asar=${sha(inAsar)} sha-repo=${hayOriginal ? sha(inRepo) : "(sin original en el repo)"}${mismo === false ? " ¡DIFIEREN!" : ""}`,
    );
  } catch (e) {
    line(false, nombre, `LANZA ${e.code || ""} ${e.message}`);
  }
}

console.log("\n=== Sintaxis del bundle main.js (sin ejecutarlo) ===");
const mainJs = path.join(buildDir, "main.js");
if (!fs.existsSync(mainJs)) {
  line(false, ".vite/build/main.js no existe en el asar");
} else {
  try {
    new vm.Script(fs.readFileSync(mainJs, "utf8"), { filename: "main.js" });
    line(true, `.vite/build/main.js analiza correctamente (${fs.statSync(mainJs).size} bytes)`);
  } catch (e) {
    line(false, ".vite/build/main.js tiene un error de sintaxis", e.message);
  }
}

console.log("\n=== node_modules copiados dentro del asar ===");
const nm = path.join(buildDir, "node_modules");
const pkgs = fs.existsSync(nm) ? fs.readdirSync(nm).length : 0;
line(pkgs > 0, `${pkgs} entradas en .vite/build/node_modules`);

console.log(`\n[check-asar-modules] ${fail === 0 ? "OK" : "FALLÓ"} · problemas=${fail}`);
process.exit(fail === 0 ? 0 : 1);
