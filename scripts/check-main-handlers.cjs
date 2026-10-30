"use strict";
/*
 * Handlers del proceso principal ejecutados de verdad (no sólo cargados).
 *
 * El problema que cubre: `check-main-load` sólo exige que main.js cargue. Un
 * fallo que salta al LLAMAR al handler (p. ej. una función SQL registrada con
 * db.function que consulta la BD por dentro → "This database connection is
 * busy executing a query") pasaba todos los checks y rompía ventas del día,
 * Transacciones y cortes en el Host.
 *
 * Cómo: stub de electron que captura ipcMain.handle, userData temporal (BD
 * nueva, nunca la real), una venta y un corte del Host, y se llaman los
 * handlers del día a día exigiendo success y el nombre visible "Caja 1".
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-main-handlers.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const REPO = path.resolve(__dirname, "..");
const TMP = path.join(os.tmpdir(), "opencode", `check-main-handlers-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.env.VENDIA_USERDATA = TMP;

let pass = 0;
let fail = 0;
const check = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? " :: " + extra : ""));
  }
};

const handlers = new Map();
const callable = () =>
  new Proxy(function () {}, {
    get: (t, p) => (p === "then" ? undefined : callable()),
    apply: () => callable(),
  });
const app = {
  getPath: (n) => (n === "appData" ? path.join(TMP, "appdata") : TMP),
  setPath() {},
  setAppUserModelId() {},
  requestSingleInstanceLock: () => true,
  quit() {},
  exit() {},
  isPackaged: false,
  isReady: () => false,
  getName: () => "Vendia-check",
  getVersion: () => "0.0.0-check",
  getAppPath: () => REPO,
  on: () => app,
  once: () => app,
  // Nunca "ready": ni ventana, ni servidor, ni tareas de arranque.
  whenReady: () => new Promise(() => {}),
  removeListener: () => app,
};
const electronStub = {
  app,
  BrowserWindow: class BrowserWindow {
    constructor() {
      return new Proxy(this, { get: (t, p) => (p in t ? t[p] : callable()) });
    }
    static getAllWindows() {
      return [];
    }
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler() {},
    on() {},
    once() {},
    off() {},
    removeAllListeners() {},
  },
  dialog: callable(),
  shell: callable(),
  Tray: class Tray {},
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({ popup() {} }) },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromBuffer: () => ({ isEmpty: () => true }),
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { width: 1920, height: 1080 } }) },
  Notification: class Notification {},
  clipboard: { readText: () => "", writeText() {} },
  safeStorage: { isEncryptionAvailable: () => false },
  powerMonitor: callable(),
  protocol: callable(),
  session: callable(),
  net: callable(),
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

console.log("=== handlers del día a día (BD temporal) ===");
require(path.join(REPO, "src/main/main.js"));

const Database = require("better-sqlite3");
const dbFile = path.join(TMP, "db", "pos-system.db");

(async () => {
  const call = (channel, ...args) => handlers.get(channel)(null, ...args);
  const opened = await call("open-cash-register", { openingBalance: 100, cashierId: null, role: "admin" });
  check(opened && opened.success === true, "abrir caja del Host", JSON.stringify(opened));

  const side = new Database(dbFile);
  const reg = side.prepare("SELECT id FROM cash_register WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
  const hostId = side.prepare("SELECT value FROM settings WHERE key = 'host_device_id'").get().value;
  side
    .prepare(
      "INSERT INTO sales (folio, total, payment_method, register_id, device_id, created_at) VALUES ('H-000001', 10, 'cash', ?, ?, datetime('now'))",
    )
    .run(reg.id, hostId);
  side.close();

  const today = (await call("get-sales-for-today", { registerId: reg.id })) || {};
  check(today.success === true && today.sales.length === 1, "ventas del día", JSON.stringify(today).slice(0, 200));
  check(today.sales?.[0]?.device_name === "Caja 1", "la venta del Host se llama «Caja 1»", today.sales?.[0]?.device_name);

  const d = new Date().toISOString().slice(0, 10);
  const range = (await call("get-sales-by-range", { startDate: "2000-01-01", endDate: "2100-01-01" })) || {};
  check(range.success === true && range.sales.length === 1, "Transacciones (rango)", JSON.stringify(range).slice(0, 200));
  const byDate = (await call("get-sales-by-date", { date: d })) || {};
  check(byDate.success === true, "ventas por fecha", JSON.stringify(byDate).slice(0, 200));
  const conflicts = (await call("get-stock-conflicts")) || {};
  check(conflicts.success === true, "conflictos de stock", JSON.stringify(conflicts).slice(0, 200));

  await call("close-cash-register", { declaredClose: 110, expenses: 0, name: "Corte", cashierId: null, role: "admin" });
  const closed = await call("get-closed-registers", { role: "admin" });
  const list = Array.isArray(closed) ? closed : closed && closed.registers;
  check(Array.isArray(list) && list[0] && list[0].device_name === "Caja 1", "corte del Host con nombre «Caja 1»", JSON.stringify(closed).slice(0, 200));

  const renamed = await call("rename-device", { deviceId: hostId, name: "Mostrador" });
  check(renamed && renamed.success === true, "renombrar esta PC", JSON.stringify(renamed).slice(0, 200));
  const after = (await call("get-sales-by-range", { startDate: "2000-01-01", endDate: "2100-01-01" })) || {};
  check(after.sales?.[0]?.device_name === "Mostrador", "el nombre nuevo se ve al momento", after.sales?.[0]?.device_name);

  console.log(`\n=== main handlers: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
