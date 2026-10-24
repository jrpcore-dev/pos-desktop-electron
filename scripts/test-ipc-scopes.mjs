#!/usr/bin/env node
// Entrega 2a — Harness de regresión de la clasificación de handlers IPC.
//
// Verifica:
//   1. COMPLETITUD: todo handler registrado en main.js está clasificado y no
//      hay clasificaciones huérfanas (fail-closed real).
//   2. BASELINE HOST: en rol host, el guard es passthrough EXACTO (mismos args,
//      mismo retorno, sin excepción) para TODOS los canales.
//   3. FAIL-CLOSED CLIENTE: en rol client, SYSTEM/LOCAL_READ/HOST_READ pasan y
//      HOST_WRITE o desconocidos son rechazados con IPC_SCOPE_DENIED.
//
// Uso:
//   node scripts/test-ipc-scopes.mjs
//   node scripts/test-ipc-scopes.mjs --update   # refresca el golden
//
// Sin dependencias de Electron/SQLite: se ejecuta con Node puro.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MAIN_FILE = path.join(ROOT, "src", "main", "main.js");
const SCOPES_FILE = path.join(ROOT, "src", "main", "ipc-scopes.js");
const GOLDEN_FILE = path.join(__dirname, "ipc-scopes.golden.json");
const UPDATE = process.argv.includes("--update");

const scopes = require(SCOPES_FILE);

let failures = 0;
const ok = (cond, msg) => {
  if (cond) {
    console.log(`  \u2713 ${msg}`);
  } else {
    failures++;
    console.log(`  \u2717 ${msg}`);
  }
};

// ── 1. Extracción de handlers registrados ───────────────────────────────────
const src = fs.readFileSync(MAIN_FILE, "utf8");
const re = /ipcMain\.handle\(\s*[\r\n\s]*["']([^"']+)["']/g;
const registered = new Set();
let m;
while ((m = re.exec(src))) registered.add(m[1]);

console.log("=== Entrega 2a · clasificación de handlers IPC ===\n");
console.log(`Handlers registrados en main.js : ${registered.size}`);

// ── 2. Completitud (fail-closed real) ───────────────────────────────────────
const classified = new Set(Object.keys(scopes.CLASSIFICATION));
const unclassified = [...registered].filter((c) => !scopes.CLASSIFICATION[c]);
const orphan = [...classified].filter((c) => !registered.has(c));
const byScope = {};
for (const ch of registered) {
  const s = scopes.scopeOf(ch);
  byScope[s] = (byScope[s] || 0) + 1;
}

console.log("\nClasificados por scope:");
for (const s of Object.values(scopes.SCOPES)) {
  console.log(`  - ${s.padEnd(11)}: ${byScope[s] || 0}`);
}

console.log("\n-- Completitud --");
ok(unclassified.length === 0, `todos los handlers clasificados (sin clasificar: ${unclassified.length})`);
if (unclassified.length) console.log(`     sin clasificar: ${unclassified.join(", ")}`);
ok(orphan.length === 0, `sin clasificaciones huérfanas (huérfanas: ${orphan.length})`);
if (orphan.length) console.log(`     huérfanas: ${orphan.join(", ")}`);

// ── 3. Baseline host: passthrough exacto para TODOS los canales ─────────────
const makeFakeIpc = () => {
  const map = new Map();
  return { map, handle: (ch, fn) => map.set(ch, fn) };
};

console.log("\n-- Baseline HOST (passthrough exacto) --");
{
  const fake = makeFakeIpc();
  scopes.installIpcScopeGuard({ ipcMain: fake, getRole: () => scopes.ROLES.HOST });

  let mismatches = 0;
  for (const channel of registered) {
    const payload = [{ event: true }, 1, "two", { three: 3 }];
    let gotArgs = null;
    fake.handle(channel, (event, ...args) => {
      gotArgs = [event, ...args];
      return { channel, echo: args };
    });
    const fn = fake.map.get(channel);
    let result;
    let threw = null;
    try {
      result = fn(...payload);
    } catch (e) {
      threw = e;
    }
    const argsOk =
      gotArgs &&
      gotArgs.length === payload.length &&
      gotArgs.every((a, i) => a === payload[i]);
    const resultOk =
      !threw &&
      result &&
      result.channel === channel &&
      result.echo &&
      result.echo.length === payload.length - 1;
    if (!argsOk || !resultOk) mismatches++;
  }
  ok(mismatches === 0, `host: ${registered.size} canales pasan sin alterar args/retorno (diffs: ${mismatches})`);
  ok(
    [...registered].every((c) => scopes.isAllowed(c, scopes.ROLES.HOST)),
    "host: todos los canales permitidos",
  );
}

// ── 4. Fail-closed en cliente ───────────────────────────────────────────────
console.log("\n-- Cliente (fail-closed) --");
{
  const fake = makeFakeIpc();
  let denied = [];
  scopes.installIpcScopeGuard({
    ipcMain: fake,
    getRole: () => scopes.ROLES.CLIENT,
    onDenied: (err) => denied.push(err),
  });

  const invoke = (channel) => {
    fake.handle(channel, () => "ok");
    return fake.map.get(channel)({});
  };
  const expectAllowed = (channel) => {
    try {
      const r = invoke(channel);
      ok(r === "ok", `cliente: "${channel}" permitido (${scopes.scopeOf(channel)})`);
    } catch (e) {
      ok(false, `cliente: "${channel}" debía permitirse pero lanzó ${e.code}`);
    }
  };
  const expectDenied = (channel) => {
    try {
      invoke(channel);
      ok(false, `cliente: "${channel}" debía rechazarse (${scopes.scopeOf(channel)})`);
    } catch (e) {
      ok(
        e.code === "IPC_SCOPE_DENIED",
        `cliente: "${channel}" rechazado con IPC_SCOPE_DENIED (${scopes.scopeOf(channel)})`,
      );
    }
  };

  expectAllowed("log-error"); // system
  expectAllowed("get-next-barcode"); // local_read
  expectAllowed("get-products"); // host_read
  expectAllowed("search-products"); // host_read
  expectDenied("record-sale"); // host_write
  expectDenied("add-product"); // host_write
  expectDenied("canal-inexistente"); // fail-closed por defecto
  ok(denied.length >= 3, `cliente: onDenied invocado ${denied.length} veces`);

  const writeChannels = [...registered].filter(
    (c) => scopes.scopeOf(c) === scopes.SCOPES.HOST_WRITE,
  );
  const leaked = writeChannels.filter((c) => scopes.isAllowed(c, scopes.ROLES.CLIENT));
  ok(leaked.length === 0, `cliente: ningún HOST_WRITE permitido (fugas: ${leaked.length})`);
}

// ── 5. Golden (detecta cualquier cambio accidental en host) ──────────────────
const golden = JSON.stringify(
  Object.fromEntries(
    [...registered].sort().map((c) => [c, scopes.scopeOf(c)]),
  ),
  null,
  2,
);

console.log("\n-- Golden --");
if (UPDATE) {
  fs.writeFileSync(GOLDEN_FILE, golden + "\n");
  console.log(`  golden actualizado: ${path.relative(ROOT, GOLDEN_FILE)}`);
} else if (fs.existsSync(GOLDEN_FILE)) {
  // Fin de línea normalizado: con core.autocrlf el checkout trae CRLF.
  const current = fs.readFileSync(GOLDEN_FILE, "utf8").replace(/\r\n/g, "\n").trim();
  ok(current === golden.trim(), "clasificación idéntica al golden (0 diffs)");
} else {
  console.log("  (sin golden; ejecuta con --update para crearlo)");
}

console.log(
  `\n[test-ipc-scopes] ${failures === 0 ? "OK" : "FALLÓ"} · fallos=${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
