"use strict";
/*
 * PASO 3 · Harness 2b (móvil + scopes), movido desde
 * C:\Users\jacob\AppData\Local\Temp\opencode\vendia-2b\harness.js y adaptado:
 *   - el esquema ya NO está escrito a mano: se construye con src/main/db-schema.js
 *     (scripts/db-fixture.js), igual que en la app real.
 *
 * Uso (Electron, better-sqlite3):
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\harness-2b.cjs --repo=<repo> --phase=before|after [--out=f.json] [--compare=f.json]
 *
 * - Fase "before": solo flujos móviles (auth, search, barcode, crear producto,
 *   aumentar stock, batch, historial, deshacer, pair). No hay makeRequireScope.
 * - Fase "after": lo mismo + pruebas de scope/migración.
 * - --compare=resultado.json: exige que `flows` sea idéntico.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const fixture = require("./db-fixture");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a.replace(/^--/, ""), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);

const REPO = args.repo || fixture.REPO;
const PHASE = args.phase || "after";
const OUT = args.out || path.join(os.tmpdir(), `vendia-2b-${PHASE}.json`);
const PORT = Number(args.port || 3916);
const TEST_PORT = PORT + 1;

const Database = fixture.Database;
const pins = require(path.join(REPO, "src", "main", "pins.js"));
const activation = require(path.join(REPO, "src", "main", "activation.js"));
const api = require(path.join(REPO, "src", "main", "api-server.js"));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vendia-2b-"));
const dbFile = path.join(tmpRoot, "test.db");

const makeDb = () => {
  const db = fixture.createFileDb(dbFile);
  const { salt, hash } = pins.hashPin("1234");
  db.prepare(
    "INSERT INTO cashiers (id,name,role,pin,pin_hash,pin_salt,is_active) VALUES (1,'Ana','admin','',?,?,1)",
  ).run(hash, salt);
  db.prepare("INSERT INTO categories (id,name) VALUES (1,'Bebidas')").run();
  db.prepare(
    "INSERT INTO products (id,barcode,name,price,stock,cost_price,sale_unit,min_stock,category_id,is_active,box_qty,box_price) VALUES (1,'7501234567890','Coca Cola 600ml',18,5,12,'piece',2,1,1,0,0)",
  ).run();
  return db;
};

const stripProduct = (p) =>
  p && {
    barcode: p.barcode,
    name: p.name,
    price: p.price,
    stock: p.stock,
    cost_price: p.cost_price,
    sale_unit: p.sale_unit,
    min_stock: p.min_stock,
    box_qty: p.box_qty,
    box_price: p.box_price,
  };

const stripMovement = (m) => ({
  product_id: m.product_id,
  quantity: m.quantity,
  cost: m.cost,
  notes: m.notes,
  name: m.name,
  sale_unit: m.sale_unit,
});

const main = async () => {
  const db = makeDb();

  const base = `http://127.0.0.1:${PORT}`;
  const req = async (method, url, opts = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (opts.token) headers["Authorization"] = opts.token;
    if (opts.deviceId) headers["x-device-id"] = opts.deviceId;
    if (opts.deviceToken) headers["x-device-token"] = opts.deviceToken;
    const res = await fetch(base + url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  };

  const start = await api.startServer(db, PORT);
  if (!start.success) throw new Error("startServer: " + start.error);

  const flows = {};

  const auth = await req("POST", "/api/auth", { body: { id: 1, pin: "1234" } });
  const token = auth.data.token;
  flows.auth = {
    status: auth.status,
    success: auth.data.success,
    cashier: auth.data.cashier,
    hasToken: !!token,
  };

  const search = await req("GET", "/api/products/search?q=coca", { token });
  flows.search = {
    status: search.status,
    success: search.data.success,
    products: (search.data.products || []).map(stripProduct),
  };

  const bar = await req("GET", "/api/products/7501234567890", { token });
  flows.barcode = {
    status: bar.status,
    success: bar.data.success,
    product: stripProduct(bar.data.product),
  };

  const cats = await req("GET", "/api/categories", { token });
  flows.categories = {
    status: cats.status,
    success: cats.data.success,
    categories: cats.data.categories,
  };

  const cash = await req("GET", "/api/cashiers", { token });
  flows.cashiers = {
    status: cash.status,
    success: cash.data.success,
    cashiers: cash.data.cashiers,
  };

  const created = await req("POST", "/api/products", {
    token,
    body: {
      barcode: "750999",
      name: "Sabritas",
      price: 15,
      cost_price: 10,
      sale_unit: "piece",
      stock: 3,
      category_id: 1,
    },
  });
  const newId = created.data.product && created.data.product.id;
  flows.createProduct = {
    status: created.status,
    success: created.data.success,
    message: created.data.message,
    product: stripProduct(created.data.product),
  };

  const stock = await req("PATCH", "/api/products/1/stock", {
    token,
    body: { quantity: 7, cost: 84, notes: "compra", registerExpense: false },
  });
  flows.addStock = {
    status: stock.status,
    success: stock.data.success,
    message: stock.data.message,
    product: stripProduct(stock.data.product),
  };

  const batch = await req("POST", "/api/products/stock/batch", {
    token,
    body: { items: [{ product_id: newId, quantity: 4, cost: 40, notes: "lote" }] },
  });
  flows.batchStock = {
    status: batch.status,
    success: batch.data.success,
    applied: batch.data.applied,
    issues: batch.data.issues,
    products: (batch.data.products || []).map(stripProduct),
  };

  const hist = await req("GET", "/api/stock/history/today", { token });
  flows.historyToday = {
    status: hist.status,
    success: hist.data.success,
    movements: (hist.data.movements || []).map(stripMovement),
  };

  const mv = db
    .prepare("SELECT id FROM stock_movements WHERE product_id = 1 ORDER BY id DESC LIMIT 1")
    .get();
  const undo = await req("DELETE", `/api/stock/movements/${mv.id}`, { token });
  flows.undoStock = {
    status: undo.status,
    success: undo.data.success,
    message: undo.data.message,
    product: stripProduct(undo.data.product),
  };

  const code = activation.getActivationCode(db);
  const pair = await req("POST", "/api/activation/pair", {
    body: {
      deviceId: "mobile-1",
      deviceName: "Teléfono Ana",
      code: activation.normalizeCode(code),
    },
  });
  flows.pair = {
    status: pair.status,
    success: pair.data.success,
    hasToken: !!pair.data.pairedToken,
  };

  const scopeTests = {};
  const checks = [];
  const check = (name, pass, extra) =>
    checks.push({ name, pass: !!pass, extra: extra === undefined ? null : extra });

  if (PHASE === "after") {
    if (typeof api.makeRequireScope !== "function")
      throw new Error("api-server no exporta makeRequireScope");
    const express = require(path.join(REPO, "node_modules", "express"));
    const requireScope = api.makeRequireScope(db);
    const testApp = express();
    testApp.use(express.json());
    testApp.get("/t/sales", [requireScope("sales:write")], (req, res) => res.json({ success: true }));
    testApp.get("/t/catalog", [requireScope("catalog:read")], (req, res) => res.json({ success: true }));
    const testServer = testApp.listen(TEST_PORT);
    await new Promise((r) => testServer.once("listening", r));
    const tbase = `http://127.0.0.1:${TEST_PORT}`;
    const treq = async (p, headers = {}) => {
      const res = await fetch(tbase + p, { headers });
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return { status: res.status, data };
    };

    // Switch OFF (default): scope nuevo sin pairing -> 403; legado -> 200.
    scopeTests.newScopeNoPairSwitchOff = await treq("/t/sales");
    scopeTests.legacyNoPairSwitchOff = await treq("/t/catalog");

    // mobile emparejado pidiendo scope nuevo -> 403; legado -> 200.
    const mp = await req("POST", "/api/activation/pair", {
      body: { deviceId: "mobile-scope", deviceName: "Tel", code: activation.normalizeCode(code) },
    });
    const mHeaders = { "x-device-id": "mobile-scope", "x-device-token": mp.data.pairedToken };
    scopeTests.mobileSalesWrite = await treq("/t/sales", mHeaders);
    scopeTests.mobileCatalog = await treq("/t/catalog", mHeaders);

    // desktop_box pendiente -> 403 en escritura; aprobado -> pasa.
    const dp = await req("POST", "/api/activation/pair", {
      body: {
        deviceId: "box-1",
        deviceName: "Caja 2",
        deviceType: "desktop_box",
        code: activation.normalizeCode(code),
      },
    });
    scopeTests.desktopPairPending = !!dp.data.pending;
    const dHeaders = { "x-device-id": "box-1", "x-device-token": dp.data.pairedToken };
    scopeTests.desktopPendingWrite = await treq("/t/sales", dHeaders);
    scopeTests.approveResult = activation.approveDevice(db, "box-1");
    scopeTests.desktopApprovedWrite = await treq("/t/sales", dHeaders);

    // Migración sobre BD existente (sin las columnas nuevas) sin pérdida.
    const migFile = path.join(tmpRoot, "mig.db");
    const mig = new Database(migFile);
    mig.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE paired_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL UNIQUE, device_name TEXT DEFAULT '',
        paired_token_hash TEXT NOT NULL, cashier_id INTEGER,
        activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME, revoked INTEGER DEFAULT 0
      );
    `);
    mig.prepare(
      "INSERT INTO paired_devices (device_id, device_name, paired_token_hash, cashier_id, revoked) VALUES (?,?,?,?,0)",
    ).run("legacy-1", "Viejo", "deadbeef", null);
    activation.ensureSchema(mig);
    const cols = mig.prepare("PRAGMA table_info(paired_devices)").all().map((c) => c.name);
    const row = mig
      .prepare("SELECT device_id, device_name, device_type, approved FROM paired_devices WHERE device_id='legacy-1'")
      .get();
    scopeTests.migration = { cols, row };
    mig.close();

    check("switch OFF · scope nuevo sin pairing -> 403", scopeTests.newScopeNoPairSwitchOff.status === 403, scopeTests.newScopeNoPairSwitchOff);
    check("switch OFF · scope legado sin pairing -> 200 (idéntico a hoy)", scopeTests.legacyNoPairSwitchOff.status === 200, scopeTests.legacyNoPairSwitchOff);
    check("mobile con token pidiendo sales:write -> 403", scopeTests.mobileSalesWrite.status === 403, scopeTests.mobileSalesWrite);
    check("mobile con token pidiendo catalog:read -> 200", scopeTests.mobileCatalog.status === 200, scopeTests.mobileCatalog);
    check("desktop_box pendiente escribe -> 403", scopeTests.desktopPendingWrite.status === 403, scopeTests.desktopPendingWrite);
    check("desktop_box aprobado escribe -> 200", scopeTests.desktopApprovedWrite.status === 200, scopeTests.desktopApprovedWrite);
    check(
      "migración conserva fila y añade columnas",
      scopeTests.migration.row &&
        scopeTests.migration.row.device_id === "legacy-1" &&
        scopeTests.migration.row.device_name === "Viejo" &&
        scopeTests.migration.row.device_type === "mobile" &&
        scopeTests.migration.row.approved === 1 &&
        scopeTests.migration.cols.includes("scopes") &&
        scopeTests.migration.cols.includes("protocol_version") &&
        scopeTests.migration.cols.includes("device_code"),
      scopeTests.migration,
    );

    testServer.close();
  }

  api.stopServer();
  db.close();

  if (args.compare) {
    const other = JSON.parse(fs.readFileSync(args.compare, "utf8"));
    const same = JSON.stringify(other.flows) === JSON.stringify(flows);
    check("baseline before/after idéntico", same, same ? null : { before: other.flows, after: flows });
  }

  const failed = checks.filter((c) => !c.pass);
  const out = { phase: PHASE, repo: REPO, flows, scopeTests, checks };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log(`\n=== Harness 2b · fase ${PHASE} ===`);
  console.log(`flows: ${Object.keys(flows).join(", ")}`);
  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
    if (!c.pass && c.extra) console.log("     " + JSON.stringify(c.extra));
  }
  console.log(`\n[harness-2b] ${failed.length === 0 ? "OK" : "FALLÓ"} · checks=${checks.length} fallos=${failed.length} · ${OUT}`);
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("[harness-2b] error:", e && e.stack ? e.stack : e);
  process.exit(2);
});
