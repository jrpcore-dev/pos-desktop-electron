#!/usr/bin/env node
// Genera src/renderer/ipcAllowlist.generated.js a partir de los canales IPC
// declarados en el proceso main (ipcMain.handle/on y webContents.send) y los
// canales realmente usados en el renderer (window.api.invoke/on/send).
//
// Uso:
//   node scripts/gen-ipc-allowlist.mjs            # genera el archivo
//   node scripts/gen-ipc-allowlist.mjs --check    # valida sin escribir
//
// El allowlist es la frontera de seguridad de preload.js: solo los canales
// declarados en el main pueden invocarse/escucharse desde el renderer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MAIN_DIR = path.join(ROOT, "src", "main");
const RENDERER_DIR = path.join(ROOT, "src", "renderer");
const OUT_FILE = path.join(RENDERER_DIR, "ipcAllowlist.generated.js");

const CHECK = process.argv.includes("--check");

const walk = (dir, exts, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, acc);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
};

// Lee el primer argumento de una llamada a partir del índice del "(".
// Devuelve { value, dynamic } o null si no puede determinarlo.
const readFirstArg = (src, openParenIdx) => {
  let i = openParenIdx + 1;
  while (i < src.length && /\s/.test(src[i])) i++;
  const ch = src[i];

  if (ch === '"' || ch === "'") {
    i++;
    let out = "";
    while (i < src.length && src[i] !== ch) {
      if (src[i] === "\\") {
        out += src[i] + (src[i + 1] ?? "");
        i += 2;
        continue;
      }
      out += src[i];
      i++;
    }
    return { value: out.replace(/\\(.)/g, "$1"), dynamic: false };
  }

  if (ch === "`") {
    i++;
    let out = "";
    let dynamic = false;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "$" && src[i + 1] === "{") dynamic = true;
      out += src[i];
      i++;
    }
    return { value: out, dynamic };
  }

  // No es un literal: variable, expresión, etc.
  let out = "";
  while (i < src.length && !/[,\n()]/.test(src[i])) {
    out += src[i];
    i++;
  }
  return { value: out.trim(), dynamic: true };
};

const collect = (files, regex) => {
  const found = new Set();
  const dynamic = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const re = new RegExp(regex.source, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      const arg = readFirstArg(src, m.index + m[0].length - 1);
      if (!arg) continue;
      if (arg.dynamic) {
        dynamic.push({
          file: path.relative(ROOT, file),
          expr: arg.value || "(no determinable)",
        });
        continue;
      }
      found.add(arg.value);
    }
  }
  return { found, dynamic };
};

const mainFiles = walk(MAIN_DIR, [".js"]);
const rendererFiles = walk(RENDERER_DIR, [".js", ".jsx"]).filter(
  (f) => f !== OUT_FILE,
);

const handlers = collect(mainFiles, /ipcMain\.handle\s*\(/);
const onChannels = collect(mainFiles, /ipcMain\.on\s*\(/);
const senderEvents = collect(mainFiles, /webContents\.send\s*\(/);

const rInvoke = collect(rendererFiles, /window\.api\??\s*\.\s*invoke\s*\(/);
const rOn = collect(rendererFiles, /window\.api\??\s*\.\s*on\s*\(/);
const rSend = collect(rendererFiles, /window\.api\??\s*\.\s*send\s*\(/);

// setTitlebarTheme envía siempre el canal fijo "set-titlebar-theme".
const titlebarUses = rendererFiles.some((f) =>
  /window\.api\??\s*\.\s*setTitlebarTheme\s*\(/.test(fs.readFileSync(f, "utf8")),
);
if (titlebarUses) {
  rSend.found.add("set-titlebar-theme");
}

const sortSet = (s) => [...s].sort((a, b) => a.localeCompare(b));
const diff = (a, b) => sortSet(new Set([...a].filter((x) => !b.has(x))));

const report = {
  invoke: sortSet(handlers.found),
  events: sortSet(senderEvents.found),
  send: sortSet(onChannels.found),
};

const missingHandlers = diff(rInvoke.found, handlers.found);
const missingEvents = diff(rOn.found, senderEvents.found);
const invalidSends = diff(rSend.found, onChannels.found);
const unusedHandlers = diff(handlers.found, rInvoke.found);
const unusedEvents = diff(senderEvents.found, rOn.found);

const dynamicAll = [
  ...handlers.dynamic.map((d) => ({ side: "main.handle", ...d })),
  ...onChannels.dynamic.map((d) => ({ side: "main.on", ...d })),
  ...senderEvents.dynamic.map((d) => ({ side: "main.send", ...d })),
  ...rInvoke.dynamic.map((d) => ({ side: "renderer.invoke", ...d })),
  ...rOn.dynamic.map((d) => ({ side: "renderer.on", ...d })),
  ...rSend.dynamic.map((d) => ({ side: "renderer.send", ...d })),
];

console.log("=== IPC allowlist ===");
console.log(`handlers (main)      : ${report.invoke.length}`);
console.log(`eventos (main->rndr) : ${report.events.length}`);
console.log(`on/send (main)       : ${report.send.length}`);
console.log(`invoke (renderer)    : ${rInvoke.found.size}`);
console.log(`on (renderer)        : ${rOn.found.size}`);
console.log(`send (renderer)      : ${rSend.found.size}`);

if (dynamicAll.length) {
  console.log("\n-- Canales DINÁMICOS detectados (revisar a mano) --");
  for (const d of dynamicAll) console.log(`  [${d.side}] ${d.file}: ${d.expr}`);
} else {
  console.log("\nCanales dinámicos: ninguno");
}

if (missingHandlers.length) {
  console.log("\n!! renderer.invoke sin handler en main:");
  for (const c of missingHandlers) console.log(`   - ${c}`);
}
if (missingEvents.length) {
  console.log("\n!! renderer.on sin emisor en main:");
  for (const c of missingEvents) console.log(`   - ${c}`);
}
if (invalidSends.length) {
  console.log("\n!! renderer.send sin ipcMain.on en main:");
  for (const c of invalidSends) console.log(`   - ${c}`);
}
if (unusedHandlers.length) {
  console.log("\n(i) handlers sin uso detectado en renderer:");
  for (const c of unusedHandlers) console.log(`   - ${c}`);
}
if (unusedEvents.length) {
  console.log("\n(i) eventos main sin listener en renderer:");
  for (const c of unusedEvents) console.log(`   - ${c}`);
}

// Salida ESM: el preload la importa y el bundler la inlinea, de modo que no
// queda un require local en runtime (el preload corre con sandbox: true).
const content =
  "// AUTO-GENERADO por scripts/gen-ipc-allowlist.mjs — NO EDITAR A MANO.\n" +
  "// Frontera de seguridad de preload.js.\n" +
  "export const invoke = " +
  JSON.stringify(report.invoke, null, 2) +
  ";\n\n" +
  "export const events = " +
  JSON.stringify(report.events, null, 2) +
  ";\n\n" +
  "export const send = " +
  JSON.stringify(report.send, null, 2) +
  ";\n";

if (CHECK) {
  const current = fs.existsSync(OUT_FILE)
    ? fs.readFileSync(OUT_FILE, "utf8")
    : "";
  const upToDate = current === content;
  const ok =
    upToDate &&
    missingHandlers.length === 0 &&
    missingEvents.length === 0 &&
    invalidSends.length === 0 &&
    dynamicAll.length === 0;
  console.log(
    `\n[check] allowlist ${upToDate ? "actualizado" : "DESACTUALIZADO"}; ` +
      `mismatches=${missingHandlers.length + missingEvents.length + invalidSends.length}; ` +
      `dinámicos=${dynamicAll.length}`,
  );
  process.exit(ok ? 0 : 1);
}

fs.writeFileSync(OUT_FILE, content);
console.log(`\nEscrito: ${path.relative(ROOT, OUT_FILE)}`);

const hardMismatch =
  missingHandlers.length + missingEvents.length + invalidSends.length;
process.exit(hardMismatch === 0 ? 0 : 1);
