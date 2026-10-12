"use strict";
/*
 * ENTREGA 3d · réplica: change_log, snapshot/changes y descarga inicial.
 *
 *   A) change_log + triggers: idempotentes, sólo las tablas/columnas
 *      replicadas (costos y PINs NO), migración sobre una copia de la BD real
 *      con datos intactos e integrity_check ok. Mide el coste de los triggers
 *      en una venta y en un import de 27k.
 *   B) API del Host: /api/replica/snapshot (cursor + snapshot_seq estable) y
 *      /api/replica/changes (since/limit con filas completas). Los costos no
 *      salen; settings sólo entrega sus claves replicadas; si el seq pedido ya
 *      no está en el log → resync.
 *   C) Motor de la caja: descarga inicial a staging con swap atómico,
 *      reanudable por cursor, `sync_completed` sólo tras el swap, catch-up
 *      desde /changes y resync a las 24 h.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3d-replica.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const Database = require(path.join(REPO, "node_modules", "better-sqlite3"));
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const clientLink = require(path.join(REPO, "src/main/client-link.js"));
const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
const salesCore = require(path.join(REPO, "src/main/sales-core.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3d-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3530;
const URL = `http://127.0.0.1:${PORT}`;

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

const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
};

// Cifrador de prueba (igual que en check-3c): fuera de Electron no hay
// safeStorage. Marca el valor para probar que el token nunca va en claro.
const testCipher = {
  available: () => true,
  encrypt: (plain) => Buffer.from("ENC:" + plain).toString("base64"),
  decrypt: (blob) => {
    const s = Buffer.from(String(blob), "base64").toString("utf8");
    return s.startsWith("ENC:") ? s.slice(4) : null;
  },
};
clientLink.setSecretCipher(testCipher);

const seedCashier = (db, id = 1, name = "Ana") => {
  const p = hashPin("1234");
  db.prepare(
    "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (?,?,'admin','',1,?,?)",
  ).run(id, name, p.hash, p.salt);
};

const seedHost = (db) => {
  seedCashier(db);
  const cat = db.prepare("INSERT INTO categories (name) VALUES (?)");
  cat.run("Bebidas");
  cat.run("Abarrotes");
  const ins = db.prepare(
    "INSERT INTO products (barcode, name, price, stock, category_id, cost_price, min_stock) VALUES (?,?,?,?,?,?,?)",
  );
  ins.run("7501055300012", "Coca-Cola 600ml", 18.5, 40, 1, 12.3, 5);
  ins.run("7501055300029", "Sabritas", 15, 3, 2, 9.1, 5); // bajo mínimo
  ins.run("7501055300036", "Leche Lala", 27.5, 12, 2, 21, 5);
  db.prepare("INSERT INTO customer_tiers (name, position) VALUES ('Mayorista', 1)").run();
  db.prepare(
    "INSERT INTO customers (name, phone, tier_id) VALUES ('Don José','5512345678',1)",
  ).run();
  db.prepare("INSERT INTO tier_prices (tier_id, product_id, price) VALUES (1,1,17)").run();
  db.prepare(
    "INSERT INTO customer_prices (customer_id, product_id, price) VALUES (1,2,13.5)",
  ).run();
  db.prepare("INSERT INTO product_prices (product_id, type, qty, price) VALUES (1,'combo',2,34)").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('store_name','JRP TEST')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('currency','MXN')").run();
  // Claves que JAMÁS deben salir del Host hacia una caja.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('activation_code','SECRET-CODE')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('box_paired_token','SECRET-TOKEN')").run();
};

const countTriggers = (db) =>
  db
    .prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_change_log%'",
    )
    .get().c;

const dropTriggers = (db) => {
  for (const t of db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_change_log%'")
    .all()) {
    db.exec(`DROP TRIGGER ${t.name}`);
  }
};

(async () => {
  // ─── A · change_log y triggers ────────────────────────────────────────────
  console.log("=== 3d A · change_log y triggers ===");
  const dbA = fixture.createFileDb(path.join(TMP, "host.db"));
  seedHost(dbA);

  check(countTriggers(dbA) === 28, "28 triggers de change_log (9 tablas × 3 ops + `_leave` de 3e)", String(countTriggers(dbA)));
  dbSchema.ensureChangeLog(dbA);
  dbSchema.ensureChangeLog(dbA);
  check(countTriggers(dbA) === 28, "ensureChangeLog es idempotente (2 pasadas)", String(countTriggers(dbA)));

  const logAll = () => dbA.prepare("SELECT seq, tbl, row_id, op FROM change_log").all();
  const seqBefore = logAll().length;

  // insert + update + delete de un producto
  dbA.prepare("INSERT INTO products (barcode, name, price, stock, cost_price) VALUES ('111','Prod X',10,5,7)").run();
  const px = dbA.prepare("SELECT id FROM products WHERE barcode='111'").get().id;
  dbA.prepare("UPDATE products SET stock = 2 WHERE id = ?").run(px);
  dbA.prepare("DELETE FROM products WHERE id = ?").run(px);
  const logP = logAll().slice(seqBefore);
  check(
    logP.length === 3 && logP.every((r) => r.tbl === "products" && r.row_id === String(px)) &&
      logP.map((r) => r.op).join(",") === "upsert,upsert,delete",
    "insert/update/delete de producto → 3 entradas con row_id y op",
    JSON.stringify(logP),
  );

  // settings: sólo las claves replicadas
  const seqS = logAll().length;
  dbA.prepare("INSERT INTO settings (key, value) VALUES ('print_enabled','1')").run();
  dbA.prepare("UPDATE settings SET value='OTRO' WHERE key='activation_code'").run();
  dbA.prepare("DELETE FROM settings WHERE key='box_paired_token'").run();
  const logS = logAll().slice(seqS);
  check(
    logS.length === 1 && logS[0].row_id === "print_enabled",
    "settings: sólo la clave replicada genera evento (activation_code/box_paired_token no)",
    JSON.stringify(logS),
  );

  // cashiers: el PIN no genera evento, el nombre sí
  const seqC = logAll().length;
  const cashierBefore = dbA.prepare("SELECT pin_hash, pin_salt FROM cashiers WHERE id=1").get();
  dbA.prepare("UPDATE cashiers SET pin_hash='nuevo', pin_salt='sal' WHERE id=1").run();
  const logPin = logAll().slice(seqC);
  check(logPin.length === 0, "cashiers: cambiar pin_hash/pin_salt NO genera evento", JSON.stringify(logPin));
  const seqC2 = logAll().length;
  dbA.prepare("UPDATE cashiers SET name='Ana Maria', role='manager' WHERE id=1").run();
  const logRole = logAll().slice(seqC2);
  check(logRole.length === 1 && logRole[0].op === "upsert", "cashiers: cambiar nombre/rol SÍ genera evento", JSON.stringify(logRole));
  // se restaura el PIN real: más adelante el harness entra con él por /api/auth
  dbA.prepare("UPDATE cashiers SET pin_hash=?, pin_salt=? WHERE id=1").run(
    cashierBefore.pin_hash,
    cashierBefore.pin_salt,
  );

  // costes de los triggers ── venta
  const measureSale = (withTriggers) => {
    const db = fixture.createFileDb(path.join(TMP, `cost-sale-${withTriggers}.db`));
    seedCashier(db);
    for (let i = 0; i < 50; i++) {
      db.prepare("INSERT INTO products (barcode, name, price, stock) VALUES (?,?,?,?)").run(
        `BC${i}`, `P${i}`, 10 + i, 100,
      );
    }
    if (!withTriggers) dropTriggers(db);
    const items = db.prepare("SELECT id, price FROM products LIMIT 5").all();
    const cart = items.map((p) => ({ productId: p.id, name: `P${p.id}`, quantity: 1, price: p.price, discountPercent: 0 }));
    const total = cart.reduce((s, l) => s + l.price, 0);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) {
      salesCore.createSaleTx(db, { cart, total, paymentMethod: "cash", cashierId: 1, cashierName: "Ana", role: "admin" });
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const logged = withTriggers ? db.prepare("SELECT COUNT(*) c FROM change_log").get().c : 0;
    db.close();
    return { ms, logged };
  };
  const saleWith = measureSale(true);
  const saleWithout = measureSale(false);
  console.log(
    `    · 50 ventas → con triggers ${saleWith.ms.toFixed(1)} ms (${saleWith.logged} eventos) · sin triggers ${saleWithout.ms.toFixed(1)} ms`,
  );
  console.log(
    `    · coste por venta: +${((saleWith.ms - saleWithout.ms) / 50).toFixed(2)} ms (eventos por venta: ${Math.round(saleWith.logged / 50)})`,
  );
  check(saleWith.ms - saleWithout.ms < 50 * 2, "el coste de los triggers por venta es < 2 ms", `${(saleWith.ms - saleWithout.ms).toFixed(1)} ms / 50 ventas`);

  // costes de los triggers ── import de 27k
  const measureImport = (withTriggers) => {
    const db = fixture.createFileDb(path.join(TMP, `cost-import-${withTriggers}.db`));
    if (!withTriggers) dropTriggers(db);
    const ins = db.prepare("INSERT INTO products (barcode, name, price, stock) VALUES (?,?,?,?)");
    const N = 27000;
    const t0 = process.hrtime.bigint();
    const tx = db.transaction(() => {
      for (let i = 0; i < N; i++) ins.run(`IMP${i}`, `Producto ${i}`, (i % 90) + 10, i % 40);
    });
    tx();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const logged = withTriggers ? db.prepare("SELECT COUNT(*) c FROM change_log").get().c : 0;
    db.close();
    return { ms, logged };
  };
  const impWith = measureImport(true);
  const impWithout = measureImport(false);
  console.log(
    `    · import de 27k → con triggers ${impWith.ms.toFixed(0)} ms (${impWith.logged} eventos) · sin triggers ${impWithout.ms.toFixed(0)} ms`,
  );
  console.log(
    `    · coste del import: +${(impWith.ms - impWithout.ms).toFixed(0)} ms (${(((impWith.ms - impWithout.ms) / 27000) * 1000).toFixed(1)} µs/fila) → proponer marcador 'bulk' (3e)`,
  );

  // migración sobre una copia de la BD real
  const REAL = path.join(process.env.APPDATA || "", "JRP POS", "db", "pos-system.db");
  check(fs.existsSync(REAL), "existe la BD real para probar la migración", REAL);
  if (fs.existsSync(REAL)) {
    const copy = path.join(TMP, "real-copy.db");
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(REAL + suffix)) fs.copyFileSync(REAL + suffix, copy + suffix);
    }
    const rdb = new Database(copy);
    rdb.pragma("foreign_keys = ON");
    const tables = (n) => n;
    const before = {
      products: rdb.prepare("SELECT COUNT(*) c FROM products").get().c,
      customers: rdb.prepare("SELECT COUNT(*) c FROM customers").get().c,
      sales: rdb.prepare("SELECT COUNT(*) c FROM sales").get().c,
      settings: rdb.prepare("SELECT COUNT(*) c FROM settings").get().c,
    };
    dbSchema.createTables(rdb);
    activation.ensureSchema(rdb);
    dbSchema.runMigrations(rdb);
    dbSchema.runMigrations(rdb); // idempotencia
    const after = {
      products: rdb.prepare("SELECT COUNT(*) c FROM products").get().c,
      customers: rdb.prepare("SELECT COUNT(*) c FROM customers").get().c,
      sales: rdb.prepare("SELECT COUNT(*) c FROM sales").get().c,
      settings: rdb.prepare("SELECT COUNT(*) c FROM settings").get().c,
    };
    const integrity = rdb.pragma("integrity_check", { simple: true });
    const onlyNewTables = rdb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM sqlite_master WHERE 0) ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    const changeLogCols = rdb.prepare("PRAGMA table_info(change_log)").all().map((c) => c.name);
    check(
      JSON.stringify(before) === JSON.stringify(after),
      "migración sobre copia de la BD real: los datos NO cambian",
      JSON.stringify({ before, after }),
    );
    check(integrity === "ok", "integrity_check = ok tras la migración", String(integrity));
    check(countTriggers(rdb) === 28, "la BD real gana los 28 triggers", String(countTriggers(rdb)));
    check(
      changeLogCols.join(",") === "seq,tbl,row_id,op,ts",
      "change_log tiene exactamente seq,tbl,row_id,op,ts",
      changeLogCols.join(","),
    );
    rdb.close();
  }

  // ─── B · API del Host ─────────────────────────────────────────────────────
  console.log("\n=== 3d B · API /api/replica/* ===");
  const started = await apiServer.startServer(dbA, PORT, { appVersion: "9.9.9-check" });
  check(started.success, "servidor del Host arranca", JSON.stringify(started));

  // sesión de caja (desktop_box) por su token de emparejamiento: una caja no
  // inicia sesión de cajero, su identidad es el emparejamiento con el Host.
  const boxId = "box-3d-001";
  const boxToken = "tok-3d";
  dbA.prepare(
    "INSERT OR REPLACE INTO paired_devices (device_id, device_name, paired_token_hash, cashier_id, activated_at, device_code, device_type, approved, revoked) VALUES (?,?,?,1,strftime('%s','now')*1000,'A','desktop_box',1,0)",
  ).run(boxId, "Caja 3d", activation.hashToken(boxToken));
  const post = async (url, body, headers = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return { status: res.status, data };
  };
  const SESSION = { "x-device-id": boxId, "x-device-token": boxToken };

  let r = await get(`${URL}/api/replica/snapshot?table=products&limit=2`, SESSION);
  check(r.status === 200 && r.data.success, "snapshot → 200 con sesión de caja", JSON.stringify(r.data).slice(0, 120));
  check(
    Array.isArray(r.data.rows) && r.data.rows.length === 2 && r.data.has_more === true,
    "snapshot pagina por cursor (limit=2, has_more)",
    JSON.stringify({ rows: r.data.rows.length, has_more: r.data.has_more, next: r.data.next_cursor }),
  );
  check(!r.data.columns.includes("cost_price"), "las columnas replicadas EXCLUYEN cost_price", r.data.columns.join(","));
  check(
    r.data.rows.every((row) => row.cost_price === undefined),
    "las filas del snapshot no traen cost_price",
    JSON.stringify(r.data.rows[0]),
  );
  const totalProducts = dbA.prepare("SELECT COUNT(*) c FROM products").get().c;
  check(r.data.total === totalProducts, "el total informado es el real", `${r.data.total} vs ${totalProducts}`);

  const seqPage1 = r.data.snapshot_seq;
  // Paginando por cursor, una fila escrita DESPUÉS puede entrar en una página
  // posterior: no es un fallo, porque `snapshot_seq` queda fijo y el log cubre
  // ese cambio. Lo que hay que garantizar es que la caja no la tenga DOS VECES.
  dbA.prepare("INSERT INTO products (barcode, name, price, stock) VALUES ('NUEVO','Durante paginacion',5,1)").run();
  const cursor = r.data.next_cursor;
  // se recogen TODAS las páginas como haría la caja y se comprueba que
  // aplicar el delta posterior no duplica la fila.
  r = await get(`${URL}/api/replica/snapshot?table=products&limit=2&cursor=${cursor}&snapshot_seq=${seqPage1}`, SESSION);
  check(r.data.snapshot_seq === seqPage1, "el snapshot_seq reenviado se mantiene estable", `${r.data.snapshot_seq} vs ${seqPage1}`);
  let cursorAll = "";
  const allRows = [];
  for (;;) {
    const page = await get(
      `${URL}/api/replica/snapshot?table=products&limit=2&cursor=${encodeURIComponent(cursorAll)}&snapshot_seq=${seqPage1}`,
      SESSION,
    );
    allRows.push(...page.data.rows);
    cursorAll = page.data.next_cursor;
    if (!page.data.has_more) break;
  }
  check(
    allRows.filter((x) => x.barcode === "NUEVO").length <= 1,
    "la fila escrita durante la paginación aparece como máximo una vez en el snapshot",
    String(allRows.filter((x) => x.barcode === "NUEVO").length),
  );

  r = await get(`${URL}/api/replica/snapshot?table=settings&limit=50`, SESSION);
  const keys = (r.data.rows || []).map((x) => x.key);
  check(keys.includes("store_name") && keys.includes("currency"), "settings replicadas: store_name y currency", keys.join(","));
  check(!keys.includes("activation_code") && !keys.includes("box_paired_token"), "settings: activation_code y box_paired_token NUNCA salen", keys.join(","));

  r = await get(`${URL}/api/replica/snapshot?table=sales&limit=5`, SESSION);
  check(r.status === 400 && r.data.code === "REPLICA_TABLE_UNKNOWN", "tabla no replicable → 400 REPLICA_TABLE_UNKNOWN", JSON.stringify(r.data));

  r = await get(`${URL}/api/replica/snapshot?table=products&limit=2`, {});
  check(r.status === 403, "snapshot sin emparejar → 403", String(r.status));

  // /api/replica/changes
  r = await get(`${URL}/api/replica/changes?since=0&limit=1000`, SESSION);
  check(r.status === 200 && r.data.success && Array.isArray(r.data.changes), "changes → 200 con filas", JSON.stringify(r.data).slice(0, 100));
  const upserts = r.data.changes.filter((c) => c.op === "upsert" && c.tbl === "products");
  const withRow = upserts.find((c) => c.row && c.row.barcode === "7501055300012");
  check(!!withRow && withRow.row.cost_price === undefined, "changes entrega la fila COMPLETA y sin cost_price", JSON.stringify(withRow && withRow.row).slice(0, 160));
  const costRow = dbA.prepare("SELECT cost_price FROM products WHERE barcode='7501055300012'").get();
  check(costRow.cost_price === 12.3, "en el Host el cost_price sí existe (no se replica, no se borra)", String(costRow.cost_price));

  const delTarget = dbA.prepare("SELECT id FROM products WHERE barcode='7501055300036'").get().id;
  dbA.prepare("DELETE FROM products WHERE id = ?").run(delTarget);
  r = await get(`${URL}/api/replica/changes?since=${seqPage1}&limit=100`, SESSION);
  const del = r.data.changes.find((c) => c.op === "delete" && c.row_id === String(delTarget));
  check(!!del, "un borrado en el Host viaja como op=delete con su row_id", JSON.stringify(r.data.changes.slice(-2)));

  // compactación: si el seq pedido ya no está → resync
  dbA.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('change_log_first_seq', ?)").run(String(seqPage1 + 5));
  r = await get(`${URL}/api/replica/changes?since=1&limit=10`, SESSION);
  check(
    r.data.success === false && r.data.resync === true && r.data.code === "LOG_COMPACTED",
    "si el seq pedido ya compactó → resync completo",
    JSON.stringify(r.data),
  );
  dbA.prepare("DELETE FROM settings WHERE key='change_log_first_seq'").run();

  // ─── C · motor de la caja ────────────────────────────────────────────────
  console.log("\n=== 3d C · replica-engine (descarga inicial) ===");
  const dbBox = fixture.createFileDb(path.join(TMP, "box.db"));
  seedCashier(dbBox, 9, "Cajero local"); // la caja NO debe tocar esto en la descarga
  dbBox.prepare("INSERT INTO products (barcode, name, price, stock) VALUES ('LOCAL','Producto local',5,1)").run();
  const localCashier = dbBox.prepare("SELECT COUNT(*) c FROM cashiers").get().c;

  clientLink.saveSettings(dbBox, {
    device_role: "client",
    host_url: URL,
    host_device_id: activation.getSetting(dbA, "host_device_id"),
    box_device_id: boxId,
    box_paired_token: "tok-3d",
    sync_completed: "0",
  });
  clientLink.savePairedToken(dbBox, "tok-3d");

  let st = replicaEngine.state(dbBox);
  check(st.sync_completed === false && st.mode === "offline", "la caja arranca sin sincronizar y en offline", JSON.stringify(st));

  const progress = [];
  const res = await replicaEngine.downloadSnapshot(dbBox, { pageSize: 2, onProgress: (p) => progress.push(p) });
  check(res.success === true, "descarga inicial correcta", JSON.stringify(res).slice(0, 200));
  check(progress.length > 3, "emite progreso por página", `${progress.length} eventos`);
  check(progress.some((p) => p.table === "products" && p.table_pct !== null), "el progreso informa tabla, filas y pct", JSON.stringify(progress.find((p) => p.table === "products")));

  st = replicaEngine.state(dbBox);
  check(st.sync_completed === true && st.mode === "online" && st.state === "synced", "tras el swap: sync_completed=1 y modo online", JSON.stringify(st));
  check(st.last_seq > 0 && st.last_seq === st.snapshot_seq, "last_applied_seq = snapshot_seq", JSON.stringify({ last: st.last_seq, snap: st.snapshot_seq }));

  const hostProducts = dbA.prepare("SELECT COUNT(*) c FROM products").get().c;
  const boxProducts = dbBox.prepare("SELECT COUNT(*) c FROM products").get().c;
  check(hostProducts === boxProducts, "la réplica tiene los mismos productos que el Host", `${boxProducts} vs ${hostProducts}`);
  check(
    !dbBox.prepare("SELECT id FROM products WHERE barcode='LOCAL'").get(),
    "el producto local fue sustituido por el snapshot (swap completo)",
  );
  const boxCoca = dbBox.prepare("SELECT * FROM products WHERE barcode='7501055300012'").get();
  check(boxCoca && boxCoca.price === 18.5 && boxCoca.stock === 40, "el producto llegó completo", JSON.stringify(boxCoca));
  check(boxCoca.cost_price === 0 || boxCoca.cost_price === null, "cost_price en la caja queda 0/NULL (decisión: costos no se replican)", String(boxCoca.cost_price));
  check(dbBox.prepare("SELECT COUNT(*) c FROM tier_prices").get().c === 1, "tier_prices replicado", "");
  check(dbBox.prepare("SELECT COUNT(*) c FROM customer_prices").get().c === 1, "customer_prices replicado", "");
  check(dbBox.prepare("SELECT COUNT(*) c FROM product_prices").get().c === 1, "product_prices replicado", "");
  check(dbBox.prepare("SELECT value FROM settings WHERE key='store_name'").get().value === "JRP TEST", "settings replicadas (store_name)", "");
  const hostCode = dbA.prepare("SELECT value FROM settings WHERE key='activation_code'").get().value;
  const boxCodeRow = dbBox.prepare("SELECT value FROM settings WHERE key='activation_code'").get();
  check(
    !boxCodeRow || boxCodeRow.value !== hostCode,
    "el activation_code del Host NO viaja a la caja",
    JSON.stringify({ host: hostCode, box: boxCodeRow && boxCodeRow.value }),
  );
  check(dbBox.prepare("SELECT COUNT(*) c FROM cashiers").get().c === localCashier, "los cajeros locales de la caja NO se tocan (sólo id/name/role/is_active)", "");
  check(
    dbBox.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'stg_replica_%'").get().c > 0,
    "las tablas staging quedan creadas para reanudar",
    "",
  );
  check(clientLink.canSell(dbBox) === true, "con sync_completed=1 la caja ya puede vender", "");

  // ── reanudación tras caída del Host ──────────────────────────────────────
  const dbBox2 = fixture.createFileDb(path.join(TMP, "box-resume.db"));
  clientLink.saveSettings(dbBox2, {
    device_role: "client",
    host_url: URL,
    host_device_id: activation.getSetting(dbA, "host_device_id"),
    box_device_id: boxId,
    sync_completed: "0",
  });
  clientLink.savePairedToken(dbBox2, "tok-3d");
  await apiServer.stopServer();
  const down = await replicaEngine.downloadSnapshot(dbBox2, { pageSize: 2 });
  check(down.success === false, "con el Host caído la descarga falla (y no inventa nada)", JSON.stringify(down).slice(0, 140));
  const stDown = replicaEngine.state(dbBox2);
  check(stDown.sync_completed === false && stDown.state === "error", "sync_completed sigue en 0 tras el fallo", JSON.stringify(stDown));
  check(clientLink.canSell(dbBox2) === false, "la caja NO vende con la réplica a medias", "");

  // se levanta otra vez el Host: la descarga REANUDA desde el cursor
  await apiServer.startServer(dbA, PORT, { appVersion: "9.9.9-check" });
  const resumed = await replicaEngine.downloadSnapshot(dbBox2, { pageSize: 2 });
  check(resumed.success === true, "al volver el Host la descarga se reanuda y termina", JSON.stringify(resumed).slice(0, 160));
  check(
    dbBox2.prepare("SELECT COUNT(*) c FROM products").get().c === hostProducts,
    "la réplica reanudada tiene exactamente los productos del Host (sin duplicados)",
    String(dbBox2.prepare("SELECT COUNT(*) c FROM products").get().c),
  );

  // ── catch-up: cambios posteriores al snapshot ────────────────────────────
  const seqNow = replicaEngine.state(dbBox2).last_seq;
  dbA.prepare("INSERT INTO products (barcode, name, price, stock) VALUES ('POST','Posterior',33,9)").run();
  dbA.prepare("UPDATE products SET price = 19.5 WHERE barcode='7501055300012'").run();
  const newId = dbA.prepare("SELECT id FROM products WHERE barcode='POST'").get().id;
  dbA.prepare("DELETE FROM products WHERE barcode='7501055300029'").run();

  r = await get(`${URL}/api/replica/changes?since=${seqNow}&limit=50`, SESSION);
  check(r.data.success && r.data.changes.length >= 3, "el delta desde last_applied_seq trae los cambios nuevos", JSON.stringify(r.data.changes.map((c) => `${c.tbl}:${c.op}`)));
  const applied = replicaEngine.applyChanges(dbBox2, r.data.changes);
  check(applied.applied >= 3 && applied.last_seq > seqNow, "applyChanges aplica el lote y avanza last_applied_seq", JSON.stringify(applied).slice(0, 200));
  check(applied.tables.includes("products") && applied.ids.products.includes(String(newId)), "devuelve tablas/ids para emitir db-changed", JSON.stringify(applied.ids));
  check(
    dbBox2.prepare("SELECT price FROM products WHERE barcode='7501055300012'").get().price === 19.5,
    "el precio actualizado llegó a la réplica",
    "",
  );
  check(!!dbBox2.prepare("SELECT id FROM products WHERE barcode='POST'").get(), "el producto nuevo llegó a la réplica", "");
  check(!dbBox2.prepare("SELECT id FROM products WHERE barcode='7501055300029'").get(), "el borrado se aplicó en la réplica", "");
  check(replicaEngine.state(dbBox2).last_seq === applied.last_seq, "el estado refleja el nuevo last_applied_seq", "");

  // ── resync a las 24 h ────────────────────────────────────────────────────
  check(replicaEngine.isStale(dbBox2) === false, "con sync reciente NO hay que re-sincronizar", "");
  activation.setSetting(dbBox2, replicaEngine.KEYS.SYNCED_AT, String(Date.now() - 25 * 60 * 60 * 1000));
  check(replicaEngine.isStale(dbBox2) === true, "a las 25 h el resync completo es obligatorio", "");
  const reset = replicaEngine.resetSync(dbBox2);
  check(
    reset.sync_completed === false && reset.state === "idle" && reset.last_seq === 0,
    "resetSync deja la caja en idle y sin vender",
    JSON.stringify(reset),
  );
  check(clientLink.canSell(dbBox2) === false, "tras resetSync la caja NO vende hasta re-sincronizar", "");
  check(
    dbBox2.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'stg_replica_%'").get().c === 0,
    "resetSync limpia las tablas staging",
    "",
  );

  await apiServer.stopServer();
  console.log(`\n=== 3d: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("ERROR no controlado:", err);
  try {
    apiServer.stopServer();
  } catch (e) {}
  process.exit(1);
});
