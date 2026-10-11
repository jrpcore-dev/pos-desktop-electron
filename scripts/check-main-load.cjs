"use strict";
/*
 * PASO D · Carga de humo del bundle del proceso principal.
 *
 * El problema que cubre: `npm run package` solo compila/copia,
 * `check-build-requires` solo valida RUTAS de require y `check-asar-modules`
 * solo la SINTAXIS de main.js. Un `ReferenceError` (p. ej. `createTables is not
 * defined` tras extraer funciones a db-schema.js) es de runtime y ninguno lo
 * ve: este chequeo SÍ ejecuta el bundle y falla si algo revienta al cargar.
 *
 * Cómo lo hace (sin abrir la app ni tocar datos reales):
 *   - intercepta `require("electron")` y devuelve un stub (no hay ventana,
 *     no hay `ready`, no hay servidor);
 *   - fija VENDIA_USERDATA a un directorio temporal, así que la BD y los logs
 *     que crea main.js son de un fichero desechable, nunca del real;
 *   - carga .vite/build/main.js y exige que termine sin excepción.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-main-load.cjs
 * Sale con código 1 si la carga falla.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { EventEmitter } = require("events");

const REPO = path.resolve(__dirname, "..");
const BUNDLE = path.join(REPO, ".vite", "build", "main.js");

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

console.log("=== PASO D · carga de .vite/build/main.js (sin GUI, BD temporal) ===");

check(fs.existsSync(BUNDLE), "existe .vite/build/main.js (corre antes npm run package)", BUNDLE);
if (!fs.existsSync(BUNDLE)) {
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(1);
}

// ── userData aislado: main.js escribe ahí, nunca en el real ────────────────
const TMP = path.join(os.tmpdir(), "opencode", `check-main-load-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.env.VENDIA_USERDATA = TMP;

// ── stub de electron ────────────────────────────────────────────────────────
// Devuelve siempre algo llamable/encadenable para que ninguna expresión de
// arranque revienta por el stub (el objetivo del chequeo es detectar errores
// del CÓDIGO, no del doble).
const callable = () => {
  const fn = function () {
    return stub();
  };
  return new Proxy(fn, {
    get: (t, prop) => {
      if (prop === Symbol.toPrimitive || prop === "toString") return () => "[stub]";
      if (prop === "then") return undefined;
      return stub();
    },
    apply: () => stub(),
  });
};
let stub;
stub = () => callable();

const emitter = () => {
  const e = new EventEmitter();
  return new Proxy(e, {
    get: (t, prop) => {
      if (prop in t) return t[prop];
      if (prop === "then") return undefined;
      return () => undefined;
    },
  });
};

const userData = TMP;
const electronStub = {
  app: {
    getPath: (name) => (name === "userData" ? userData : name === "appData" ? os.tmpdir() : userData),
    setPath: () => undefined,
    setAppUserModelId: () => undefined,
    requestSingleInstanceLock: () => true,
    quit: () => undefined,
    exit: () => undefined,
    isPackaged: false,
    isReady: () => false,
    getName: () => "Vendia-check",
    getVersion: () => "0.0.0-check",
    getAppPath: () => REPO,
    on: () => electronStub.app,
    once: () => electronStub.app,
    whenReady: () => Promise.resolve(),
    removeListener: () => electronStub.app,
  },
  BrowserWindow: class BrowserWindow {
    constructor() {
      return new Proxy(this, { get: (t, p) => (p in t ? t[p] : callable()) });
    }
    static getAllWindows() {
      return [];
    }
  },
  ipcMain: {
    handle: () => undefined,
    removeHandler: () => undefined,
    on: () => undefined,
    once: () => undefined,
    off: () => undefined,
    removeAllListeners: () => undefined,
  },
  dialog: emitter(),
  shell: { openPath: async () => "", openExternal: async () => undefined },
  Tray: class Tray {},
  Menu: { setApplicationMenu: () => undefined, buildFromTemplate: () => ({ popup: () => undefined }) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) },
  screen: { getPrimaryDisplay: () => ({ workArea: { width: 1920, height: 1080 } }) },
  Notification: class Notification {},
  clipboard: { readText: () => "", writeText: () => undefined },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

// ── carga real del bundle ───────────────────────────────────────────────────
let error = null;
let stage = "require(.vite/build/main.js)";
try {
  require(BUNDLE);
} catch (e) {
  error = e;
}

check(
  !error,
  "el bundle carga sin excepción",
  error ? `${error.name}: ${error.message}` : "",
);
if (error) {
  console.log("  detalle:", (error.stack || "").split("\n").slice(0, 6).join("\n         "));
  const m = /\.vite[\\/]build[\\/]main\.js:(\d+)/.exec(error.stack || "");
  if (m) {
    const line = m[1];
    const src = fs.readFileSync(BUNDLE, "utf8").split("\n")[Number(line) - 1];
    console.log(`  bundle main.js:${line} -> ${String(src).trim()}`);
  }
}

// La BD y los logs que hubiere creado main.js tienen que ser de la temporal.
const touchedReal =
  fs.existsSync(path.join(os.homedir(), "AppData", "Roaming", "JRP POS", "db", "pos-system.db")) &&
  process.env.VENDIA_USERDATA !== TMP;
check(!touchedReal, "userData apunta a la temporal (no se toca la BD real)", `VENDIA_USERDATA=${process.env.VENDIA_USERDATA}`);
const tempDb = path.join(TMP, "db");
check(fs.existsSync(tempDb), "main.js creó su db/ dentro de la temporal", tempDb);

console.log(`  (userData temporal: ${TMP})`);
console.log(`\n${pass} PASS / ${fail} FAIL`);

// Salida forzada: discovery/timers pueden dejar el proceso vivo.
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {}
process.exit(fail ? 1 : 0);
