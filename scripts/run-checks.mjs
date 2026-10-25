#!/usr/bin/env node
// Fase 6 · corre TODAS las verificaciones headless del repo (npm test).
//
// Los checks .cjs cargan better-sqlite3 compilado para Electron, así que se
// ejecutan con el binario de Electron en modo Node (ELECTRON_RUN_AS_NODE=1),
// igual que se documenta en cada script. Los .mjs de solo lectura corren con
// Node normal.
//
// Uso:
//   npm test                       # todo
//   npm test -- --only=check-1     # sólo los que contengan ese texto
//   npm test -- --skip=check-3c    # saltar los que contengan ese texto
//
// `check-3c-link` necesita los puertos 3456 (TCP) y 3457 (UDP): si la app
// está abierta en esta PC se marca SALTADO en vez de fallar.

import { spawnSync } from "node:child_process";
import dgram from "node:dgram";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON = require("electron");

const arg = (name) =>
  process.argv
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3));
const only = arg("only");
const skip = arg("skip");

// Orden: primero lo barato y estructural, después los de red.
const CHECKS = [
  { file: "gen-ipc-allowlist.mjs", args: ["--check"], node: true },
  { file: "test-ipc-scopes.mjs", node: true },
  { file: "check-build-requires.mjs", node: true },
  { file: "check-role.cjs" },
  { file: "check-empty-db.cjs" },
  { file: "check-main-load.cjs" },
  { file: "harness-2b.cjs" },
  { file: "harness-2c-nucleo.cjs" },
  { file: "harness-2c-api.cjs" },
  { file: "check-2d-nucleo.cjs" },
  { file: "check-2d-api.cjs" },
  { file: "check-3a-ipc.cjs" },
  { file: "check-3a-register.cjs" },
  { file: "check-3b-sessions.cjs" },
  { file: "check-3c-link.cjs", ports: { tcp: 3456, udp: 3457 } },
  { file: "check-3d-replica.cjs" },
  { file: "check-3e-events.cjs" },
  { file: "check-3f-replica.cjs" },
  { file: "check-4c-offline-queue.cjs" },
  { file: "check-6g-promotion.cjs" },
  { file: "check-print.cjs" },
  { file: "check-scale.cjs" },
  // Auditoría multicaja (fases 0-4).
  { file: "check-0-taecel-folio.cjs" },
  { file: "check-1-security.cjs" },
  { file: "check-2-queue-folio.cjs" },
  { file: "check-3-promotion.cjs" },
  { file: "check-4-resilience.cjs" },
  // App móvil: escrituras con Idempotency-Key.
  { file: "check-5-movil-idempotencia.cjs" },
];

const tcpFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
const udpFree = (port) =>
  new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", () => resolve(false));
    sock.bind(port, () => sock.close(() => resolve(true)));
  });

const results = [];
for (const c of CHECKS) {
  if (only.length && !only.some((o) => c.file.includes(o))) continue;
  if (skip.some((s) => c.file.includes(s))) {
    results.push({ file: c.file, status: "SALTADO", note: "--skip" });
    continue;
  }
  if (c.ports) {
    const free = (await tcpFree(c.ports.tcp)) && (await udpFree(c.ports.udp));
    if (!free) {
      results.push({
        file: c.file,
        status: "SALTADO",
        note: `puertos ${c.ports.tcp}/${c.ports.udp} ocupados (¿la app está abierta?)`,
      });
      continue;
    }
  }
  const started = Date.now();
  const cmd = c.node ? process.execPath : ELECTRON;
  const run = spawnSync(cmd, [path.join("scripts", c.file), ...(c.args || [])], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const ok = run.status === 0;
  results.push({ file: c.file, status: ok ? "OK" : "FALLÓ", ms });
  const tail = `${run.stdout || ""}${run.stderr || ""}`.trim().split("\n");
  console.log(`${ok ? "✓" : "✗"} ${c.file} (${(ms / 1000).toFixed(1)} s)`);
  if (!ok) {
    // Sólo lo que falló, para no ahogar el resumen.
    const fails = tail.filter((l) => /FAIL|✗|ERROR|Error/.test(l)).slice(0, 15);
    for (const l of fails.length ? fails : tail.slice(-15)) console.log(`    ${l}`);
    if (run.error) console.log(`    ${run.error.message}`);
  }
}

const failed = results.filter((r) => r.status === "FALLÓ");
const skipped = results.filter((r) => r.status === "SALTADO");
console.log(
  `\n[run-checks] ${results.length - failed.length - skipped.length} OK · ${failed.length} fallaron · ${skipped.length} saltados`,
);
for (const s of skipped) console.log(`  saltado: ${s.file} · ${s.note}`);
process.exit(failed.length ? 1 : 0);
