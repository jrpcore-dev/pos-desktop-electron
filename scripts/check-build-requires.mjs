// Verificación estática del build y del app empaquetado (obligatoria antes de
// cerrar cada entrega, ya que `npm run package` EXIT=0 NO detecta ni requires
// rotos ni el renderer ausente).
//
// 1) Recorre cada require relativo de los archivos emitidos a .vite/build
//    (main externo + módulos copiados) y resuelve el destino añadiendo
//    extensión, como hace Node en runtime (cubre "Cannot find module './scopes'").
// 2) Inspecciona el app.asar de out/ (sin GUI): verifica que contenga
//    .vite/renderer/main_window/index.html + sus assets y .vite/build completo.
//    El árbol de ORIGEN `.vite/renderer` es un artefacto transitorio que Forge
//    borra al empacar, así que NO se le exige en modo empaquetado.
//
// Uso: node scripts/check-build-requires.mjs   (desde la raíz del proyecto)
import { readdirSync, existsSync, statSync, readFileSync, rmSync, mkdtempSync } from "fs";
import { join, dirname, resolve } from "path";
import os from "os";
import asarPkg from "@electron/asar";
const { extractAll } = asarPkg;

const root = process.cwd();
const buildDir = join(root, ".vite", "build");
const reqRe = /require\(\s*["'](\.[^"')]+)["']\s*\)/g;
const missing = [];
const checked = [];
let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.error("  ✗ " + msg);
};

const resolveNode = (base) => {
  const cands = [base, base + ".js", base + ".cjs", base + ".json", join(base, "index.js")];
  return cands.find((c) => existsSync(c));
};

const scan = (file) => {
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = reqRe.exec(src)) !== null) {
    const base = resolve(dirname(file), m[1]);
    checked.push(m[1]);
    if (!resolveNode(base)) fail(`${file.replace(root, ".")}: require("${m[1]}") -> no existe`);
  }
};

const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      walk(p);
    } else if (name.endsWith(".js")) scan(p);
  }
};

// 1) requires relativos en el build de origen
console.log("[check-build-requires] .vite/build");
if (!existsSync(buildDir)) {
  fail(".vite/build no existe: corre primero npm run package");
} else {
  walk(buildDir);
  console.log(`   ${checked.length} requires relativos inspeccionados`);
}

// 2) app empaquetado (artefacto real de arranque)
const findAsars = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...findAsars(p));
    else if (ent === "app.asar") out.push(p);
  }
  return out;
};
const asars = findAsars(join(root, "out"));
console.log("[check-build-requires] out/ (app empaquetado)");
if (asars.length === 0) {
  fail("no hay app.asar en out/: falta npm run package");
} else {
  for (const asar of asars) {
    const tmp = mkdtempSync(join(os.tmpdir(), "asar-check-"));
    try {
      extractAll(asar, tmp);
      const rel = asar.replace(root, ".");
      const renderer = join(tmp, ".vite", "renderer", "main_window", "index.html");
      const mainJs = join(tmp, ".vite", "build", "main.js");
      if (!existsSync(renderer)) fail(`${rel}: falta .vite/renderer/main_window/index.html`);
      else {
        const assets = readdirSync(join(tmp, ".vite", "renderer", "main_window")).filter((f) => f !== "index.html");
        if (assets.length === 0) fail(`${rel}: renderer sin assets`);
        const m = readFileSync(renderer, "utf8").match(/<script[^>]+src="([^"]+)"/);
        if (m && !existsSync(resolve(dirname(renderer), m[1]))) fail(`${rel}: asset JS citado en index.html no existe`);
      }
      if (!existsSync(mainJs)) fail(`${rel}: falta .vite/build/main.js`);
      else {
        const before = missing.length;
        walk(join(tmp, ".vite", "build"));
        console.log(`   ${rel}: renderer + build completos (${checked.length} requires globales)`);
        missing.filter((x) => !x.startsWith("  ")).forEach((x) => fail(x));
      }
    } catch (err) {
      fail(`${asar.replace(root, ".")}: no se pudo leer el asar (${err.message})`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

console.log(`\n[check-build-requires] ${problems === 0 ? "OK · arranque-list@ listo" : `FALLÓ · ${problems} problema(s)`}`);
process.exit(problems === 0 ? 0 : 1);