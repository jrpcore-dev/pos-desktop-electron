"use strict";
/*
 * ENTREGA 3a.i · handlers IPC de caja sobre src/main/main.js real.
 *
 * Carga main.js con `electron` sustituido por un stub (sin GUI, sin servidor,
 * VENDIA_USERDATA en un directorio temporal) y ejecuta los handlers
 * registrados: abrir, vender, cancelar, cerrar y los de consulta.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3a-ipc.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { EventEmitter } = require("events");

const REPO = path.resolve(__dirname, "..");
const TMP = path.join(os.tmpdir(), "opencode", `check-3a-ipc-${process.pid}`);
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

// ── stub de electron ────────────────────────────────────────────────────────
let stub;
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

const handlers = new Map();
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
    handle: (channel, listener) => handlers.set(channel, listener),
    removeHandler: (channel) => handlers.delete(channel),
    on: () => undefined,
    once: () => undefined,
    off: () => undefined,
    removeAllListeners: () => undefined,
  },
  dialog: emitter(),
  shell: { openPath: async () => "", openExternal: async () => undefined },
  Tray: class Tray {
    on() {}
    setContextMenu() {}
    destroy() {}
  },
  Menu: { setApplicationMenu: () => undefined, buildFromTemplate: () => ({ popup: () => undefined }) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) },
  screen: { getPrimaryDisplay: () => ({ workArea: { width: 1920, height: 1080 } }) },
  Notification: class Notification {},
  clipboard: { readText: () => "", writeText: () => undefined },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

const invoke = async (channel, args) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error("sin handler: " + channel);
  return await fn(null, args || {});
};

(async () => {
  console.log("=== 3a.i · handlers IPC de caja (main.js real, BD temporal) ===");
  require(path.join(REPO, "src", "main", "main.js"));
  check(handlers.size > 50, "main.js carga y registra handlers", `handlers=${handlers.size}`);
  for (const ch of ["open-cash-register", "record-sale", "close-cash-register", "cancel-sale", "get-cash-register-status", "get-previous-register-today"]) {
    check(handlers.has(ch), `handler registrado: ${ch}`);
  }

  const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
  const dbPath = path.join(TMP, "db", "pos-system.db");
  const db2 = new Database(dbPath);
  db2.pragma("journal_mode = WAL");
  const hostId = db2
    .prepare("SELECT value FROM settings WHERE key = 'host_device_id'")
    .get().value;
  check(/^host-/.test(hostId), "host_device_id generado en el primer arranque", hostId);

  const { hashPin } = require(path.join(REPO, "src", "main", "pins.js"));
  const p = hashPin("1234");
  db2
    .prepare(
      "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','admin','',1,?,?)",
    )
    .run(p.hash, p.salt);
  db2
    .prepare(
      "INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1,'001','Leche',20,100,'piece')",
    )
    .run();
  const openRegs = () =>
    db2.prepare("SELECT id, status, device_id FROM cash_register ORDER BY id").all();

  // 1) apertura registra el device_id del Host
  let r = await invoke("open-cash-register", { openingBalance: 500, cashierId: 1, role: "admin" });
  check(r.success === true, "open-cash-register → success", JSON.stringify(r));
  let regs = openRegs();
  check(regs.length === 1 && regs[0].device_id === hostId, "la apertura registra el device_id del Host", JSON.stringify(regs));
  const hostReg1 = regs[0].id;

  // 2) venta local del Host entra en esa caja
  r = await invoke("record-sale", {
    cart: [{ id: 1, quantity: 2, price: 20, finalPrice: 20 }],
    total: 40,
    paymentMethod: "cash",
    discountTotal: 0,
    cashierName: "Ana",
    cashierId: 1,
    role: "admin",
  });
  check(r.success === true, "record-sale → success", JSON.stringify(r));
  const sale1 = db2.prepare("SELECT register_id FROM sales WHERE id = ?").get(r.saleId);
  check(sale1.register_id === hostReg1, "la venta cae en la caja del Host", `register_id=${sale1.register_id}`);

  // 3) caja de OTRO dispositivo abierta a la vez
  db2
    .prepare(
      "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (900, date('now'), 'open', 1, 'box-1')",
    )
    .run();

  // 4) segunda apertura del Host: auto-cierre SOLO de su caja
  r = await invoke("open-cash-register", { openingBalance: 100, cashierId: 1, role: "admin" });
  check(r.success === true, "segunda open-cash-register → success", JSON.stringify(r));
  regs = openRegs();
  const boxReg = regs.find((x) => x.device_id === "box-1");
  const hostOpen = regs.filter((x) => x.device_id === hostId && x.status === "open");
  check(boxReg && boxReg.status === "open", "la caja de box-1 NO se auto-cierra", JSON.stringify(boxReg));
  check(hostOpen.length === 1, "el Host queda con UNA caja abierta (la suya)", `abiertas=${hostOpen.length}`);
  const hostReg2 = hostOpen[0].id;
  check(hostReg1 !== hostReg2, "la caja vieja del Host se auto-cerró", `1=${hostReg1} 2=${hostReg2}`);

  // 5) la venta nueva cae en la caja nueva del Host, nunca en la de box-1
  r = await invoke("record-sale", {
    cart: [{ id: 1, quantity: 1, price: 20, finalPrice: 20 }],
    total: 20,
    paymentMethod: "cash",
    discountTotal: 0,
    cashierName: "Ana",
    cashierId: 1,
    role: "admin",
  });
  const sale2Id = r.saleId;
  const sale2 = db2.prepare("SELECT register_id FROM sales WHERE id = ?").get(sale2Id);
  check(sale2.register_id === hostReg2, "la 2ª venta va a la caja nueva del Host", `register_id=${sale2.register_id}`);

  // 6) cancelar: sin cambios (misma regla de ventana)
  r = await invoke("cancel-sale", { saleId: sale2Id, cashierName: "Ana", reason: "prueba", role: "admin", cashierId: 1 });
  check(r.success === true, "cancel-sale → success (sin cambios)", JSON.stringify(r));
  const cancelled = db2.prepare("SELECT status FROM sales WHERE id = ?").get(sale2Id);
  check(cancelled.status === "cancelado", "venta cancelada", cancelled.status);
  const stock = db2.prepare("SELECT stock FROM products WHERE id = 1").get().stock;
  check(stock === 98, "stock devuelto al cancelar", `stock=${stock}`);

  // 7) cerrar caja del Host: la de box-1 sigue abierta
  r = await invoke("close-cash-register", { declaredClose: 0, cashierId: 1, role: "admin" });
  check(r.success === true, "close-cash-register → success", JSON.stringify(r));
  regs = openRegs();
  check(regs.find((x) => x.id === 900).status === "open", "box-1 sigue con su caja abierta", JSON.stringify(regs));
  const hostClosed = regs.filter((x) => x.device_id === hostId && x.status === "closed");
  check(hostClosed.length === 2, "las 2 cajas del Host están cerradas", JSON.stringify(regs));

  // 8) consultas: "la caja actual" es la del Host
  r = await invoke("get-cash-register-status", { cashierId: 1, role: "admin" });
  check(r.success === true && r.register && r.register.device_id === hostId,
    "get-cash-register-status devuelve la caja del Host", JSON.stringify(r.register && { id: r.register.id, device_id: r.register.device_id }));
  r = await invoke("get-previous-register-today", {});
  check(r.success === true && r.register && r.register.device_id === hostId,
    "get-previous-register-today devuelve una caja del Host", JSON.stringify(r.register && { id: r.register.id, device_id: r.register.device_id }));

  // 9) sin caja abierta del Host, la venta local sigue funcionando (fuera de caja)
  r = await invoke("record-sale", {
    cart: [{ id: 1, quantity: 1, price: 20, finalPrice: 20 }],
    total: 20,
    paymentMethod: "cash",
    discountTotal: 0,
    cashierName: "Ana",
    cashierId: 1,
    role: "admin",
  });
  const free = db2.prepare("SELECT register_id FROM sales WHERE id = ?").get(r.saleId);
  check(r.success === true && free.register_id === null, "venta fuera de caja tras cerrar → register_id NULL", JSON.stringify(free));

  db2.close();
  console.log(`\n[check-3a-ipc] ${fail === 0 ? "OK" : "FALLÓ"} · pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
});
