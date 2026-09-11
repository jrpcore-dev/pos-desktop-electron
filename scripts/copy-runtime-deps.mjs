import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TOP_LEVEL = ["better-sqlite3", "electron-updater", "express", "xlsx"];

function findPackageDir(name, fromDir) {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function collectClosure() {
  const seen = new Set();
  const queue = [...TOP_LEVEL];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkgDir = findPackageDir(name, ROOT);
    if (!pkgDir) {
      console.warn(`[copy-runtime-deps] modulo no encontrado: ${name}`);
      continue;
    }
    seen.add(name);
    const pkgPath = path.join(pkgDir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
    for (const dep of Object.keys(deps)) queue.push(dep);
  }
  return seen;
}

export function copyRuntimeDeps(destDir) {
  const closure = collectClosure();
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const name of closure) {
    const src = findPackageDir(name, ROOT);
    if (!src) continue;
    const dest = path.join(destDir, name);
    cpSync(src, dest, { recursive: true });
    count++;
  }
  console.log(`[copy-runtime-deps] copiados ${count} modulos a ${destDir}`);
}
