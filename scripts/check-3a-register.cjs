"use strict";
/*
 * ENTREGA 3a.i · caja por dispositivo.
 *
 *   A) golden del DDL: db-schema actual vs db-schema de HEAD (sin diff: 3a.i
 *      y 3b ya están en HEAD y la 3c no toca el esquema);
 *   B) migración sobre una COPIA de la BD real: solo gana esa columna y ese
 *      índice, integrity_check ok, sin NULL y idempotente (2 pasadas);
 *   C) núcleo: host único idéntico a hoy, dos dispositivos con caja abierta a
 *      la vez, dispositivo sin caja nunca usa la ajena, ventas fuera de caja;
 *   D) HTTP: POST /api/sales cae en la caja del dispositivo que vende y sin
 *      caja responde NO_OPEN_REGISTER.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3a-register.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const Database = fixture.Database;
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const activation = require(path.join(REPO, "src/main/activation.js"));
const salesCore = require(path.join(REPO, "src/main/sales-core.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3a-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3507;
const BASE = `http://127.0.0.1:${PORT}`;

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

const nomarize = (s) =>
  (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase();
const wire = (db) => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    db.function("nomar", nomarize);
  } catch (e) {}
};

const LEGACY_SALE_ITEMS = `
CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  price_at_sale REAL NOT NULL,
  discount_percent REAL DEFAULT 0,
  stock_deducted REAL DEFAULT 0
)`;

const startup = (db, mod) => {
  mod.createTables(db);
  activation.ensureSchema(db);
  mod.runMigrations(db);
};

const buildDdlWith = (mod) => {
  const file = path.join(TMP, `ddl-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(file);
  wire(db);
  db.exec(LEGACY_SALE_ITEMS);
  startup(db, mod);
  startup(db, mod);
  const rows = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all()
    .map((r) => r.sql);
  db.close();
  fs.rmSync(file, { force: true });
  return rows;
};

const schemaSnapshot = (db) => {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  const cols = {};
  for (const t of tables) {
    cols[t] = db
      .prepare(`PRAGMA table_info(${t})`)
      .all()
      .map((c) => `${c.name}|${c.type}|nn=${c.notnull}|dflt=${c.dflt_value}`);
  }
  const indexes = db
    .prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => `${r.tbl_name}.${r.name}`);
  return { cols, indexes };
};

const diffSets = (a, b) => ({
  added: b.filter((x) => !a.includes(x)),
  removed: a.filter((x) => !b.includes(x)),
});

const cashRegisterRow = (db, id) =>
  db.prepare("SELECT id, status, device_id FROM cash_register WHERE id = ?").get(id);

(async () => {
  // ─── A · golden del DDL vs HEAD ──────────────────────────────────────────
  console.log("=== 3a.i A · golden DDL (HEAD vs actual) ===");
  const headSql = execSync("git show HEAD:src/main/db-schema.js", {
    cwd: REPO,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  const OLD_DIR = path.join(TMP, "main-head");
  fs.mkdirSync(OLD_DIR, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, "src", "main"))) {
    if (f.endsWith(".js")) {
      fs.copyFileSync(path.join(REPO, "src", "main", f), path.join(OLD_DIR, f));
    }
  }
  fs.writeFileSync(path.join(OLD_DIR, "db-schema.js"), headSql);
  const oldMod = require(path.join(OLD_DIR, "db-schema.js"));

  const ddlOld = buildDdlWith(oldMod);
  const ddlNew = buildDdlWith(dbSchema);
  const d = diffSets(ddlOld, ddlNew);
  // DDL que esta línea de entregas cambia respecto a HEAD. La 3f.i ya está
  // commiteada, así que hoy no hay NINGÚN cambio de esquema sin commitear:
  // éste es el estado correcto, y si vuelve a salir un statement de aquí es
  // que alguien tocó el esquema y no lo declaró.
  //
  // Lo que la 3f.i dejó (ya dentro de HEAD, sólo para que conste):
  //   · las 8 tablas de entidad ganan `updated_at` —al hacer ALTER, SQLite
  //     reescribe su `CREATE TABLE`, así que contaron como alta Y baja—,
  //   · aparece la tumba-sigilo `replica_tombstones`,
  //   · los 28 triggers que ya había reescribieron su cuerpo (tumba-sigilo +
  //     cláusula `NEW.updated_at IS OLD.updated_at`),
  //   · y son NUEVOS los 8 `*_touch`, el trigger con guardia propio que
  //     refresca `updated_at` sólo cuando de verdad cambia.
  // Total: 45 altas / 36 bajas. La 3f.ii (bucle en vivo) no toca el esquema.
  // Cualquier statement no declarado (por arriba o por abajo) rompe la prueba.
  const DDL_AGREGADO = [];
  const DDL_BORRADO = [];
  console.log("  statements nuevos :", d.added.length);
  for (const s of d.added) console.log("    + " + s.replace(/\s+/g, " ").slice(0, 200));
  console.log("  statements borrados:", d.removed.length);
  for (const s of d.removed) console.log("    - " + s.replace(/\s+/g, " ").slice(0, 200));
  check(
    d.added.length === DDL_AGREGADO.length && d.removed.length === DDL_BORRADO.length,
    "diff del DDL = el declarado (sin altas ni bajas extra)",
    `agregados=${d.added.length} borrados=${d.removed.length}`,
  );
  check(
    DDL_AGREGADO.every((re) => d.added.some((s) => re.test(s))),
    "los statements agregados son exactamente los declarados (delta sin commitear)",
  );
  check(
    ddlNew.filter((s) => !d.added.includes(s)).length === ddlOld.length - d.removed.length,
    "el resto del DDL byte a byte idéntico",
    `nuevo=${ddlNew.length} viejo=${ddlOld.length}`,
  );

  // ─── B · migración sobre una copia de la BD real ─────────────────────────
  console.log("\n=== 3a.i B · migración sobre copia de la BD real ===");
  const REAL = path.join(process.env.APPDATA || "", "JRP POS", "db", "pos-system.db");
  check(fs.existsSync(REAL), "existe la BD real", REAL);
  if (fs.existsSync(REAL)) {
    const copy = path.join(TMP, "real-copy.db");
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(REAL + suffix)) fs.copyFileSync(REAL + suffix, copy + suffix);
    }
    const rdb = new Database(copy);
    wire(rdb);
    const before = schemaSnapshot(rdb);
    const rowsBefore = rdb.prepare("SELECT COUNT(*) c FROM cash_register").get().c;
    const salesBefore = rdb.prepare("SELECT COUNT(*) c FROM sales").get().c;

    startup(rdb, dbSchema);
    startup(rdb, dbSchema); // idempotencia
    const after = schemaSnapshot(rdb);
    const integrity = rdb.pragma("integrity_check", { simple: true });

    const colDiff = [];
    for (const t of Object.keys(after.cols)) {
      const dd = diffSets(before.cols[t] || [], after.cols[t]);
      for (const c of dd.added) colDiff.push(`+ ${t}.${c}`);
      for (const c of dd.removed) colDiff.push(`- ${t}.${c}`);
      if (!before.cols[t]) colDiff.push(`+ tabla nueva ${t}`);
    }
    for (const t of Object.keys(before.cols)) {
      if (!after.cols[t]) colDiff.push(`- tabla borrada ${t}`);
    }
    const idxDiff = diffSets(before.indexes, after.indexes);

    // Cambios de esquema declarados por esta línea de entregas (3a.i + 3b).
    // La BD real puede venir YA migrada (si la app ya corrió en esta máquina):
    // entonces la migración no cambia nada y el diff esperado es vacío, pero
    // el esquema resultante tiene que tener exactamente lo declarado.
    const colDe = (cols, name) => (cols || []).some((c) => c.split("|")[0] === name);
    const yaMigrada =
      colDe(before.cols.box_sessions, "token_hash") &&
      colDe(before.cols.cash_register, "device_id");
    // 3d · la tabla change_log puede no existir aún en la copia de la BD real.
    const yaTieneLog = Array.isArray(before.cols.change_log);
    // 3f · delta de esta entrega sobre la BD real: `updated_at` en las 8
    // tablas de entidad (`settings` se queda fuera: es clave/valor, no tiene
    // fila-entidad que marcar) y la tumba-sigilo `replica_tombstones`.
    const ESPERADO_3F = [
      ...dbSchema.UPDATED_AT_TABLES.map((t) => `+ ${t}.updated_at|INTEGER|nn=0|dflt=null`),
      "+ tabla nueva replica_tombstones",
      "+ replica_tombstones.tbl|TEXT|nn=1|dflt=null",
      "+ replica_tombstones.row_id|TEXT|nn=1|dflt=null",
      "+ replica_tombstones.ts|INTEGER|nn=1|dflt=null",
    ];
    const ESPERADO_3D = (yaTieneLog
      ? []
      : [
          "+ tabla nueva change_log",
          "+ change_log.seq|INTEGER|nn=0|dflt=null",
          "+ change_log.tbl|TEXT|nn=1|dflt=null",
          "+ change_log.row_id|TEXT|nn=0|dflt=null",
          "+ change_log.op|TEXT|nn=1|dflt=null",
          "+ change_log.ts|INTEGER|nn=1|dflt=null",
        ])
      .concat(ESPERADO_3F)
      .sort();
    const ESPERADO_B = [
      "+ cash_register.device_id|TEXT|nn=0|dflt=null",
      "+ tabla nueva box_sessions",
      "+ box_sessions.token_hash|TEXT|nn=0|dflt=null",
      "+ box_sessions.cashier_id|INTEGER|nn=1|dflt=null",
      "+ box_sessions.device_id|TEXT|nn=0|dflt=null",
      "+ box_sessions.device_type|TEXT|nn=0|dflt=null",
      "+ box_sessions.created_at|INTEGER|nn=1|dflt=null",
      "+ box_sessions.expires_at|INTEGER|nn=1|dflt=null",
      "+ box_sessions.last_used_at|INTEGER|nn=0|dflt=null",
      "+ box_sessions.revoked|INTEGER|nn=1|dflt=0",
      ...ESPERADO_3D,
    ].sort();
    const BOX_SESSIONS_COLS = [
      "token_hash", "cashier_id", "device_id", "device_type",
      "created_at", "expires_at", "last_used_at", "revoked",
    ];

    console.log(`  la BD real ya estaba migrada: ${yaMigrada}`);
    console.log("  diffs de esquema:");
    for (const c of colDiff) console.log("    " + c);
    for (const i of idxDiff.added) console.log("    + indice " + i);
    for (const i of idxDiff.removed) console.log("    - indice " + i);
    const visto = [...colDiff].sort();
    // La BD real puede venir ya migrada de 3a.i+3b, pero change_log es nuevo
    // en 3d: el diff esperado es el de 3b (si falta migrar) más el de 3d.
    const esperadoCol = yaMigrada ? ESPERADO_3D : ESPERADO_B;
    check(
      visto.length === esperadoCol.length && visto.every((v, i) => v === esperadoCol[i]),
      yaMigrada
        ? "la BD real ganó SOLO change_log (3d): nada más cambió"
        : "el esquema SOLO gana device_id + box_sessions + change_log",
      JSON.stringify(colDiff),
    );
    check(
      yaMigrada
        ? idxDiff.added.length === (yaTieneLog ? 0 : 1) &&
            (yaTieneLog || idxDiff.added[0] === "change_log.idx_change_log_tbl_row") &&
            idxDiff.removed.length === 0
        : idxDiff.added.length === 2 &&
            idxDiff.added.includes("cash_register.idx_cash_register_device") &&
            idxDiff.added.includes("change_log.idx_change_log_tbl_row") &&
            idxDiff.removed.length === 0,
      yaMigrada
        ? yaTieneLog
          ? "con la BD ya migrada tampoco aparecen índices nuevos"
          : "la BD ganó sólo el índice del change_log (3d)"
        : "el esquema SOLO gana idx_cash_register_device + idx_change_log_tbl_row",
      JSON.stringify(idxDiff),
    );
    check(
      colDe(after.cols.cash_register, "device_id") &&
        BOX_SESSIONS_COLS.every((c) => colDe(after.cols.box_sessions, c)) &&
        after.indexes.includes("cash_register.idx_cash_register_device"),
      "el esquema terminado tiene device_id + box_sessions + su índice",
      JSON.stringify({ box_sessions: after.cols.box_sessions }),
    );
    check(integrity === "ok", "integrity_check = ok", String(integrity));
    const nulls = rdb
      .prepare("SELECT COUNT(*) c FROM cash_register WHERE device_id IS NULL")
      .get().c;
    check(nulls === 0, "ninguna caja con device_id NULL", `nulls=${nulls}`);
    const rowsAfter = rdb.prepare("SELECT COUNT(*) c FROM cash_register").get().c;
    const salesAfter = rdb.prepare("SELECT COUNT(*) c FROM sales").get().c;
    check(rowsBefore === rowsAfter, "cajas intactas", `${rowsBefore} -> ${rowsAfter}`);
    check(salesBefore === salesAfter, "ventas intactas", `${salesBefore} -> ${salesAfter}`);
    const hostId = dbSchema.ensureHostDeviceId(rdb);
    const distintos = rdb
      .prepare("SELECT COUNT(DISTINCT device_id) c FROM cash_register")
      .get().c;
    check(distintos === 1, "todas las cajas con el MISMO device_id del Host", `distintos=${distintos}`);
    console.log(`  host_device_id = ${hostId}`);
    rdb.close();
  }

  // ─── C · núcleo: host único, dos dispositivos, sin caja ──────────────────
  console.log("\n=== 3a.i C · núcleo (findOpenRegister + createSaleTx) ===");
  {
    const db = fixture.createMemoryDb();
    const hostId = dbSchema.ensureHostDeviceId(db);
    check(/^host-[0-9a-f]{24}$/.test(hostId), "device_id del Host con prefijo host-", hostId);
    const again = dbSchema.ensureHostDeviceId(db);
    check(again === hostId, "device_id estable entre llamadas", `${hostId} vs ${again}`);
    check(
      !db.prepare("SELECT 1 FROM paired_devices WHERE device_id = ?").get(hostId),
      "el device_id del Host NO es un dispositivo emparejado",
    );

    const p = hashPin("1234");
    db.prepare(
      "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','cashier','',1,?,?)",
    ).run(p.hash, p.salt);
    db.prepare(
      "INSERT INTO products (id, name, price, stock, sale_unit) VALUES (1,'Leche',20,100,'piece')",
    ).run();

    // Host único: mismo resultado con y sin device_id.
    db.prepare(
      "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, ?)",
    ).run(hostId);
    const conDev = salesCore.findOpenRegister(db, 1, "cashier", hostId);
    const sinDev = salesCore.findOpenRegister(db, 1, "cashier");
    check(
      conDev && sinDev && conDev.id === sinDev.id,
      "host único: con device_id devuelve la MISMA caja que hoy",
      JSON.stringify({ conDev: conDev && conDev.id, sinDev: sinDev && sinDev.id }),
    );
    const adminConDev = salesCore.findOpenRegister(db, 1, "admin", hostId);
    check(adminConDev && adminConDev.id === 1, "host único (role admin) idéntico a hoy");

    // Dos dispositivos con caja abierta a la vez.
    db.prepare(
      "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (2, date('now'), 'open', 1, 'box-1')",
    ).run();
    const hostReg = salesCore.findOpenRegister(db, 1, "cashier", hostId);
    const boxReg = salesCore.findOpenRegister(db, 1, "cashier", "box-1");
    check(hostReg.id === 1 && boxReg.id === 2, "dos cajas abiertas: cada device_id ve la suya", `host=${hostReg.id} box=${boxReg.id}`);

    // Dispositivo sin caja: nunca usa la ajena.
    const other = salesCore.findOpenRegister(db, 1, "cashier", "box-2");
    const otherAdmin = salesCore.findOpenRegister(db, 1, "admin", "box-2");
    check(other === null, "box-2 sin caja → null (no usa la ajena)", JSON.stringify(other));
    check(otherAdmin === null, "box-2 sin caja (role admin) → null");

    // Cada venta cae en la caja de su dispositivo.
    const mk = (deviceId) => ({
      cart: [{ id: 1, quantity: 1, price: 20, finalPrice: 20 }],
      total: 20,
      paymentMethod: "cash",
      cashierName: "Ana",
      cashierId: 1,
      role: "cashier",
      deviceId,
      requireRegister: true,
    });
    const saleBox = db.transaction((a) => salesCore.createSaleTx(db, a))(mk("box-1"));
    const saleHost = db.transaction((a) => salesCore.createSaleTx(db, a))(mk(hostId));
    const regBox = db.prepare("SELECT register_id FROM sales WHERE id = ?").get(saleBox.saleId).register_id;
    const regHost = db.prepare("SELECT register_id FROM sales WHERE id = ?").get(saleHost.saleId).register_id;
    check(regBox === 2 && regHost === 1, "venta de box-1 en la caja 2 y venta del Host en la 1", `box=${regBox} host=${regHost}`);

    // Dispositivo sin caja → NO_OPEN_REGISTER.
    let err = null;
    try {
      db.transaction((a) => salesCore.createSaleTx(db, a))(mk("box-2"));
    } catch (e) {
      err = e;
    }
    check(err && err.code === "NO_OPEN_REGISTER", "sin caja propia → NO_OPEN_REGISTER", err && err.code);
    check(err && err.message === "Abra caja para vender", "mensaje «Abra caja para vender»", err && err.message);

    // Venta local del Host sin caja (fuera de caja): sigue permitida.
    db.prepare("UPDATE cash_register SET status = 'closed' WHERE id = 1").run();
    const beforeFree = db.prepare("SELECT COUNT(*) c FROM sales").get().c;
    const free = db.transaction((a) => salesCore.createSaleTx(db, a))({
      cart: [{ id: 1, quantity: 1, price: 20, finalPrice: 20 }],
      total: 20,
      paymentMethod: "cash",
      cashierName: "Ana",
      cashierId: 1,
      role: "cashier",
      deviceId: hostId,
    });
    const freeReg = db.prepare("SELECT register_id FROM sales WHERE id = ?").get(free.saleId).register_id;
    check(free.success && freeReg === null, "venta local del Host FUERA de caja sigue válida", `register_id=${freeReg}`);
    check(db.prepare("SELECT COUNT(*) c FROM sales").get().c === beforeFree + 1, "la venta fuera de caja se registra");

    // Llamada legada sin deviceId: comportamiento de siempre.
    const legacy = db.transaction((a) => salesCore.createSaleTx(db, a))({
      cart: [{ id: 1, quantity: 1, price: 20, finalPrice: 20 }],
      total: 20,
      paymentMethod: "cash",
      cashierName: "Ana",
      cashierId: 1,
      role: "cashier",
    });
    const legacyReg = db.prepare("SELECT register_id FROM sales WHERE id = ?").get(legacy.saleId).register_id;
    check(legacyReg === 2, "sin deviceId: última caja abierta de siempre (id=2)", `register_id=${legacyReg}`);
    db.close();
  }

  // ─── D · HTTP: POST /api/sales por dispositivo ───────────────────────────
  console.log("\n=== 3a.i D · HTTP (POST /api/sales) ===");
  const db = fixture.createFileDb(path.join(TMP, "http.db"));
  const hostId = dbSchema.ensureHostDeviceId(db);
  const p = hashPin("1234");
  db.prepare(
    "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','admin','',1,?,?)",
  ).run(p.hash, p.salt);
  db.prepare(
    "INSERT INTO products (id, barcode, name, price, stock, sale_unit) VALUES (1,'001','Leche',8,100,'piece')",
  ).run();
  // Cajas: box-a y box-b con caja abierta propia; box-sin sin caja.
  db.prepare(
    "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (11, date('now'), 'open', 1, 'box-a')",
  ).run();
  db.prepare(
    "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (12, date('now'), 'open', 1, 'box-b')",
  ).run();
  db.prepare(
    "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (13, date('now'), 'closed', 1, ?)",
  ).run(hostId);
  const tokens = {};
  for (const id of ["box-a", "box-b", "box-sin"]) {
    tokens[id] = `tok-${id}`;
    activation.registerPairing(db, {
      deviceId: id,
      deviceName: id,
      token: tokens[id],
      cashierId: 1,
      deviceType: "desktop_box",
      approved: 1,
    });
  }

  const started = await apiServer.startServer(db, PORT);
  check(started.success === true, "startServer arranca", started.error);
  const post = async (url, body, headers) => {
    const res = await fetch(`${BASE}${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return { status: res.status, data };
  };
  const auth = await post("/api/auth", { id: 1, pin: "1234" }, { "x-device-id": "box-a" });
  const AUTH = auth.data.token;
  const saleHeaders = (id, key) => ({
    authorization: AUTH,
    "x-device-id": id,
    "x-device-token": tokens[id],
    "idempotency-key": key,
  });
  const payload = (total = 8) => ({
    cart: [{ id: 1, quantity: 1, price: 8, finalPrice: 8 }],
    total,
    paymentMethod: "cash",
    discountTotal: 0,
  });

  let r = await post("/api/sales", payload(10), saleHeaders("box-a", "a1"));
  check(r.status === 200, "box-a vende → 200", JSON.stringify(r.data));
  const regA = db.prepare("SELECT register_id FROM sales WHERE id = ?").get(r.data.saleId).register_id;
  check(regA === 11, "venta de box-a en SU caja (11)", `register_id=${regA}`);

  r = await post("/api/sales", payload(11), saleHeaders("box-b", "b1"));
  check(r.status === 200, "box-b vende → 200", JSON.stringify(r.data));
  const regB = db.prepare("SELECT register_id FROM sales WHERE id = ?").get(r.data.saleId).register_id;
  check(regB === 12, "venta de box-b en SU caja (12)", `register_id=${regB}`);

  r = await post("/api/sales", payload(12), saleHeaders("box-sin", "s1"));
  check(
    r.status === 400 && r.data && r.data.code === "NO_OPEN_REGISTER",
    "box sin caja → 400 NO_OPEN_REGISTER",
    JSON.stringify(r),
  );
  check(
    r.data && r.data.error === "Abra caja para vender",
    "mensaje «Abra caja para vender» por HTTP",
    JSON.stringify(r.data),
  );
  const totalSales = db.prepare("SELECT COUNT(*) c FROM sales").get().c;
  check(totalSales === 2, "sin caja no se crea venta", `ventas=${totalSales}`);
  const regAAfter = db.prepare("SELECT status FROM cash_register WHERE id = 11").get().status;
  check(regAAfter === "open", "la caja de box-a sigue abierta tras el rechazo");

  await apiServer.stopServer();
  db.close();

  console.log(`\n[check-3a-register] ${fail === 0 ? "OK" : "FALLÓ"} · pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
});
