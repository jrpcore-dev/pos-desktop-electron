"use strict";
/*
 * ENTREGA 3e · SSE /api/events, filtro de fila replicable, runBatched y modo lote.
 *
 *   A) Qué filas replican: sólo las vendibles (`is_active = 1`). El snapshot,
 *      /changes y los triggers comparten UN descriptor, así que no pueden
 *      desviarse; el alta (0 → 1) viaja como upsert y la baja (1 → 0) como
 *      `delete`. Cubre la regresión de los productos que están activos Y
 *      constan en el XLSX del catálogo.
 *   B) Túnel SSE: autenticación de caja, `hello` con id=seq, coalescencia
 *      (60 escrituras → 1 frame), reanudación por `Last-Event-ID`, resync
 *      bajo hueco, heartbeat como EVENTO y busy/ready.
 *   C) runBatched/yieldToLoop: trocea, cede el hilo entre lotes y valida
 *      argumentos.
 *   D) Modo lote: triggers apagados, UNA sola marca `bulk`, hueco adelantado,
 *      resync de la caja conectada y recuperación si el Host muere abierto.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts/check-3e-events.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));
const { runBatched, yieldToLoop, DEFAULT_BATCH_SIZE } = require(
  path.join(REPO, "src/main/batch-runner.js"),
);
const { hashPin } = require(path.join(REPO, "src/main/pins.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3e-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3540;
const URL = `http://127.0.0.1:${PORT}`;
// Sesión de caja: se asigna tras el emparejamiento y la leen los helpers SSE.
let SESSION = null;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, timeout = 4000, step = 20) => {
  const t0 = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - t0 >= timeout) return null;
    await sleep(step);
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

const parseFrame = (raw) => {
  const out = { id: null, event: null, data: null };
  for (const line of raw.split("\n")) {
    if (line.startsWith("id: ")) out.id = Number(line.slice(4));
    else if (line.startsWith("event: ")) out.event = line.slice(7);
    else if (line.startsWith("data: ")) {
      try {
        out.data = JSON.parse(line.slice(6));
      } catch (e) {}
    }
  }
  return out;
};

// Cliente SSE mínimo: abre el stream y va acumulando frames parseados.
const openSse = async (headers = {}) => {
  const res = await fetch(`${URL}/api/events`, { headers: { ...SESSION, ...headers } });
  const frames = [];
  const client = {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    frames,
    of: (name) => frames.filter((f) => f.event === name),
    close: () => {
      if (reader) reader.cancel().catch(() => {});
    },
  };
  let reader = null;
  if (res.status === 200) {
    reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (raw) frames.push(parseFrame(raw));
          }
        }
      } catch (e) {
        /* cancelado */
      }
    })();
  }
  return client;
};

const TRIGGER_COUNT_SQL =
  "SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_change_log%'";
const countTriggers = (db) => db.prepare(TRIGGER_COUNT_SQL).get().c;

(async () => {
  const dbA = fixture.createFileDb(path.join(TMP, "host.db"));

  try {
    // ─── A · qué filas replican ─────────────────────────────────────────────
    console.log("=== 3e A · filtro de fila replicable (is_active) ===");
    dbA.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('store_name','3E TEST')",
    ).run();
    const pin = hashPin("1234");
    dbA.prepare(
      "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (1,'Ana','admin','',1,?,?)",
    ).run(pin.hash, pin.salt);

    const addProduct = dbA.prepare(
      "INSERT INTO products (barcode, name, price, stock, is_active, is_catalog) VALUES (?,?,?,?,?,?)",
    );
    addProduct.run("A-1", "Vendible", 10, 5, 1, 0);
    addProduct.run("A-2", "Vendible y en catálogo", 20, 5, 1, 1); // regresión
    addProduct.run("I-1", "Referencia XLSX", 30, 5, 0, 1);
    addProduct.run("I-2", "Inactivo propio", 40, 5, 0, 0);
    const idOf = (bc) => String(dbA.prepare("SELECT id FROM products WHERE barcode=?").get(bc).id);
    const logAll = () => dbA.prepare("SELECT seq, tbl, row_id, op FROM change_log").all();

    const started = await apiServer.startServer(dbA, PORT, { appVersion: "9.9.9-check" });
    check(started.success, "servidor del Host arranca", JSON.stringify(started));

    const boxId = "box-3e-001";
    const boxToken = "tok-3e";
    dbA.prepare(
      "INSERT OR REPLACE INTO paired_devices (device_id, device_name, paired_token_hash, cashier_id, activated_at, device_code, device_type, approved, revoked) VALUES (?,?,?,1,strftime('%s','now')*1000,'A','desktop_box',1,0)",
    ).run(boxId, "Caja 3e", activation.hashToken(boxToken));
    SESSION = { "x-device-id": boxId, "x-device-token": boxToken };

    let r = await get(`${URL}/api/replica/snapshot?table=products&limit=100`, SESSION);
    const barcodes = (r.data.rows || []).map((x) => x.barcode).sort();
    check(
      r.status === 200 && JSON.stringify(barcodes) === JSON.stringify(["A-1", "A-2"]),
      "el snapshot sólo trae los productos VENDIBLES",
      JSON.stringify(barcodes),
    );
    check(
      (r.data.rows || []).every((x) => x.is_active === 1),
      "ninguna fila del snapshot tiene is_active != 1",
      JSON.stringify((r.data.rows || []).map((x) => x.is_active)),
    );
    check(
      r.data.total === 2 && r.data.total < dbA.prepare("SELECT COUNT(*) c FROM products").get().c,
      `el total informado es el de lo replicable (${r.data.total}), no el de la tabla`,
      String(r.data.total),
    );
    check(
      r.data.columns.includes("is_active"),
      "is_active viaja como columna (la caja necesita saberlo)",
      r.data.columns.join(","),
    );

    // triggers sobre filas fuera del conjunto
    let n = logAll().length;
    dbA.prepare("UPDATE products SET price = 99 WHERE barcode = 'I-1'").run();
    dbA.prepare("UPDATE products SET price = 99 WHERE barcode = 'I-2'").run();
    check(logAll().length === n, "tocar una fila inactiva NO genera eventos", `${logAll().length - n}`);

    n = logAll().length;
    dbA.prepare("UPDATE products SET price = 21 WHERE barcode = 'A-2'").run();
    const evA2 = logAll().slice(n);
    check(
      evA2.length === 1 && evA2[0].op === "upsert",
      "REGRESIÓN: un producto activo Y de catálogo SÍ viaja",
      JSON.stringify(evA2),
    );

    n = logAll().length;
    dbA.prepare("UPDATE products SET is_active = 1 WHERE barcode = 'I-2'").run();
    const evUp = logAll().slice(n);
    dbA.prepare("UPDATE products SET is_active = 0 WHERE barcode = 'I-2'").run();
    const evDown = logAll().slice(n + 1);
    check(
      evUp.length === 1 && evUp[0].op === "upsert",
      "activar un producto (0 → 1) viaja como upsert",
      JSON.stringify(evUp),
    );
    check(
      evDown.length === 1 && evDown[0].op === "delete" && evDown[0].row_id === idOf("I-2"),
      "desactivarlo (1 → 0) viaja como delete con su row_id",
      JSON.stringify(evDown),
    );

    n = logAll().length;
    dbA.prepare("UPDATE products SET is_catalog = 1, cat_name = 'X', ref_unit = 'pza' WHERE barcode = 'A-1'").run();
    const evLink = logAll().slice(n);
    check(
      evLink.length === 1 && evLink.every((e) => e.op !== "delete"),
      "vincular al catálogo NO emite delete (seguiría vendible)",
      JSON.stringify(evLink),
    );

    n = logAll().length;
    const idA1 = idOf("A-1");
    dbA.prepare("DELETE FROM products WHERE barcode = 'I-1'").run();
    check(logAll().length === n, "borrar una fila inactiva NO genera eventos", `${logAll().length - n}`);
    dbA.prepare("DELETE FROM products WHERE barcode = 'A-1'").run();
    const evDel = logAll().slice(n);
    check(
      evDel.length === 1 && evDel[0].op === "delete" && evDel[0].row_id === idA1,
      "borrar un producto vendible sí viaja",
      JSON.stringify(evDel),
    );

    r = await get(`${URL}/api/replica/changes?since=0&limit=1000`, SESSION);
    const upsertRows = (r.data.changes || [])
      .filter((c) => c.op === "upsert" && c.tbl === "products")
      .map((c) => c.row);
    check(
      upsertRows.length > 0 && upsertRows.every((row) => row && row.is_active === 1),
      "en /changes, todo upsert de products trae una fila vendible",
      JSON.stringify(upsertRows.map((x) => x && x.is_active)),
    );
    check(
      r.data.changes.some((c) => c.op === "delete" && c.row_id === idOf("I-2")),
      "/changes entrega el delete de la desactivación",
      JSON.stringify((r.data.changes || []).slice(-2)),
    );

    // ─── B · túnel SSE ──────────────────────────────────────────────────────
    console.log("\n=== 3e B · GET /api/events (SSE) ===");
    r = await get(`${URL}/api/events`, {});
    check(r.status === 403, "/api/events sin emparejar → 403", String(r.status));

    let c1 = await openSse();
    check(c1.status === 200, "con sesión de caja → 200", String(c1.status));
    check(
      c1.contentType.includes("text/event-stream"),
      "Content-Type = text/event-stream",
      c1.contentType,
    );
    const hello = await waitFor(() => c1.of("hello")[0] || null);
    check(!!hello, "el primer frame es `hello`", JSON.stringify(c1.frames.slice(0, 2)));
    check(
      Number.isFinite(hello && hello.id) && Number.isFinite(hello && hello.data.seq),
      "hello lleva id=seq numérico (el id ES el seq)",
      JSON.stringify(hello),
    );

    const mark0 = hello ? hello.id : 0;
    addProduct.run("SSE-1", "Cambio en vivo", 7, 1, 1, 0);
    const ch1 = await waitFor(() => c1.of("changes")[0] || null);
    check(!!ch1 && ch1.id > mark0, "un cambio llega como `changes` con id > hello.id", JSON.stringify(ch1));
    check(
      Array.isArray(ch1 && ch1.data.tables) && ch1.data.tables.includes("products"),
      "el frame informa qué tablas cambiaron",
      JSON.stringify(ch1 && ch1.data),
    );

    // coalescencia: 60 escrituras dentro de la misma ventana → 1 solo frame
    const before = c1.of("changes").length;
    for (let i = 0; i < 60; i++) addProduct.run(`COAL-${i}`, `Coalesced ${i}`, 1, 1, 1, 0);
    const coalesced = await waitFor(() => {
      const list = c1.of("changes");
      return list.length > before ? list.slice(before) : null;
    });
    check(
      coalesced && coalesced.length === 1,
      "60 escrituras seguidas → UN solo frame `changes`",
      coalesced ? `frames: ${coalesced.length}` : "timeout",
    );
    check(
      coalesced && coalesced[0].data.count >= 60,
      "el frame coalescido cubre las 60 filas (count >= 60)",
      String(coalesced && coalesced[0].data.count),
    );

    // reanudación por Last-Event-ID
    const lastId = c1.of("changes").slice(-1)[0].id;
    c1.close();
    await sleep(100);
    const c2 = await openSse({ "last-event-id": String(lastId) });
    const hello2 = await waitFor(() => c2.of("hello")[0] || null);
    check(
      hello2 && hello2.id === lastId,
      "al reconectar, hello devuelve el Last-Event-ID recibido",
      JSON.stringify(hello2),
    );
    addProduct.run("RES-1", "Tras reconexión", 9, 1, 1, 0);
    const ch2 = await waitFor(() => c2.of("changes")[0] || null);
    check(
      ch2 && ch2.id > lastId,
      "tras reanudar llega SÓLO lo nuevo (id > Last-Event-ID)",
      JSON.stringify(ch2),
    );
    check(c2.of("changes").length === 1, "no reenvía lo que la caja ya tenía", String(c2.of("changes").length));
    c2.close();

    // hueco: Last-Event-ID bajo `change_log_first_seq` → resync
    dbA.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('change_log_first_seq', ?)",
    ).run(String(lastId + 100000));
    const c3 = await openSse({ "last-event-id": "1" });
    const resyncFrame = await waitFor(() => c3.of("resync")[0] || null, 3000);
    check(
      resyncFrame && resyncFrame.data.reason === "LOG_COMPACTED",
      "pedido bajo el hueco → resync LOG_COMPACTED",
      JSON.stringify(resyncFrame),
    );
    c3.close();
    dbA.prepare("DELETE FROM settings WHERE key='change_log_first_seq'").run();

    // heartbeat + busy/ready en el mismo cliente (ahorra 5 s)
    const c4 = await openSse();
    await waitFor(() => c4.of("hello")[0] || null);
    apiServer.hostBusy("import-products-data");
    const busyFrame = await waitFor(() => c4.of("busy")[0] || null, 3000);
    check(
      busyFrame && busyFrame.data.reason === "import-products-data",
      "hostBusy emite el frame `busy` con su motivo",
      JSON.stringify(busyFrame),
    );
    apiServer.hostReady("import-products-data");
    const readyFrame = await waitFor(() => c4.of("ready")[0] || null, 3000);
    check(
      readyFrame && Number.isFinite(readyFrame.data.seq),
      "hostReady emite `ready` con el seq desde el que reanudar",
      JSON.stringify(readyFrame),
    );
    const hbStart = Date.now();
    const beat = await waitFor(() => c4.of("heartbeat")[0] || null, 7000);
    check(!!beat, "heartbeat en < 7 s", beat ? `${Date.now() - hbStart} ms` : "sin latido");
    check(
      beat && beat.event === "heartbeat" && Number.isFinite(beat.data.seq) && Number.isFinite(beat.id),
      "el latido es un EVENTO con seq (no un comentario mudo)",
      JSON.stringify(beat),
    );
    c4.close();

    // ─── C · runBatched / yieldToLoop ───────────────────────────────────────
    console.log("\n=== 3e C · batch-runner ===");
    let resolved = false;
    const yp = yieldToLoop().then(() => {
      resolved = true;
    });
    check(!resolved, "yieldToLoop NO resuelve síncrono");
    await yp;
    check(resolved, "yieldToLoop resuelve al ceder el hilo");

    const order = [];
    const items = Array.from({ length: 25 }, (_, i) => i);
    setImmediate(() => order.push("tick"));
    const seen = [];
    const resB = await runBatched(
      items,
      (batch, meta) => {
        order.push(`b${meta.index}`);
        seen.push(...batch);
      },
      { batchSize: 10 },
    );
    check(order[0] === "b0", "el primer lote arranca síncrono", order.join(","));
    check(order[1] === "tick", "cede el hilo ANTES del segundo lote", order.join(","));
    check(order.length === 4, "4 lotes = 3 cesiones de hilo (10+10+5)", order.join(","));
    check(
      JSON.stringify(seen) === JSON.stringify(items),
      "recorre los 25 elementos en orden, sin pérdidas ni duplicados",
      String(seen.length),
    );
    check(
      resB.batches === 3 && resB.processed === 25 && Number.isFinite(resB.ms),
      "devuelve el resumen {batches, processed, ms}",
      JSON.stringify(resB),
    );

    const empty = await runBatched([], () => check(false, "no debe llamar al worker"));
    check(empty.batches === 0 && empty.processed === 0, "lista vacía → 0 lotes", JSON.stringify(empty));

    let threw = null;
    try {
      await runBatched("no-array", () => {});
    } catch (e) {
      threw = e;
    }
    check(threw instanceof TypeError, "items que no son array → TypeError", String(threw));

    let threw2 = null;
    try {
      await runBatched([], null);
    } catch (e) {
      threw2 = e;
    }
    check(threw2 instanceof TypeError, "worker que no es función → TypeError", String(threw2));

    const bad = await runBatched(Array.from({ length: 5 }, (_, i) => i), () => {}, { batchSize: 0 });
    check(
      bad.batches === 1 && DEFAULT_BATCH_SIZE === 500,
      `batchSize inválido cae al default (${DEFAULT_BATCH_SIZE}) en un solo lote`,
      JSON.stringify(bad),
    );

    // ─── D · modo lote ──────────────────────────────────────────────────────
    console.log("\n=== 3e D · modo lote (marcador único 'bulk') ===");
    n = logAll().length;
    addProduct.run("B-1", "Antes del lote", 1, 1, 1, 0);
    check(logAll().length === n + 1, "con triggers activos: 1 insert = 1 evento", `${logAll().length - n}`);

    const c5 = await openSse();
    await waitFor(() => c5.of("hello")[0] || null);
    const cursorBefore = c5.frames[0].id;

    check(dbSchema.beginBulk(dbA) === true, "beginBulk arranca el lote");
    check(dbSchema.beginBulk(dbA) === false, "beginBulk dos veces → sólo el primero hace efecto");
    check(countTriggers(dbA) === 0, "los triggers quedan apagados durante el lote", String(countTriggers(dbA)));

    n = logAll().length;
    for (let i = 0; i < 50; i++) addProduct.run(`BULK-${i}`, `Lote ${i}`, 1, 1, 1, 0);
    check(logAll().length === n, "durante el lote NO se escribe NI UN evento", `${logAll().length - n}`);

    apiServer.hostBusy("import-catalog-data");
    const busy5 = await waitFor(() => c5.of("busy")[0] || null, 3000);
    check(!!busy5, "la caja conectada ve el `busy` del import", JSON.stringify(busy5));

    const ended = dbSchema.endBulk(dbA);
    check(
      ended && Number.isFinite(ended.seq),
      "endBulk devuelve el seq de la marca",
      JSON.stringify(ended),
    );
    const bulkRows = logAll().filter((x) => x.op === "bulk");
    check(
      bulkRows.length === 1 && bulkRows[0].seq === ended.seq && bulkRows[0].tbl === "__bulk__",
      "queda EXACTAMENTE una marca `bulk` en el log",
      JSON.stringify(bulkRows),
    );
    const firstSeq = dbA.prepare("SELECT value FROM settings WHERE key='change_log_first_seq'").get().value;
    check(
      Number(firstSeq) === ended.seq,
      "change_log_first_seq se fija en la propia marca (hueco abierto)",
      `${firstSeq} vs ${ended.seq}`,
    );
    const flagRow = dbA.prepare("SELECT value FROM settings WHERE key='replica_bulk_active'").get();
    check(!flagRow, "la bandera se BORRA al cerrar (no queda guardada en '0')", JSON.stringify(flagRow));

    apiServer.hostReady("import-catalog-data");
    const ready5 = await waitFor(() => c5.of("ready")[0] || null, 3000);
    check(
      ready5 && ready5.data.seq >= ended.seq,
      "el `ready` entrega el seq final de la marca",
      JSON.stringify(ready5),
    );

    // la caja que estaba conectada y persigue un delta mudo → resync
    const autoResync = await waitFor(() => c5.of("resync")[0] || null, 3000);
    check(
      autoResync && autoResync.data.reason === "LOG_COMPACTED",
      "la caja conectada acaba en resync sin tener que descubrir el hueco",
      JSON.stringify(autoResync),
    );
    check(
      cursorBefore < ended.seq,
      "de hecho su cursor estaba detrás de la marca",
      `${cursorBefore} < ${ended.seq}`,
    );
    c5.close();

    r = await get(`${URL}/api/replica/changes?since=${ended.seq - 1}&limit=10`, SESSION);
    check(
      r.data && r.data.resync === true && r.data.code === "LOG_COMPACTED",
      "/changes por debajo de la marca → resync LOG_COMPACTED",
      JSON.stringify(r.data),
    );
    r = await get(`${URL}/api/replica/changes?since=${ended.seq}&limit=10`, SESSION);
    check(
      r.data && r.data.resync !== true,
      "/changes desde la marca en adelante se sirve con normalidad",
      JSON.stringify(r.data).slice(0, 160),
    );

    check(countTriggers(dbA) === 36, "endBulk restaura los 36 triggers", String(countTriggers(dbA)));
    n = logAll().length;
    addProduct.run("B-2", "Tras el lote", 1, 1, 1, 0);
    check(logAll().length === n + 1, "tras el lote los triggers vuelven a registrar", `${logAll().length - n}`);
    check(dbSchema.endBulk(dbA) === null, "endBulk sin lote abierto → null (no-op)");

    // recuperación: el Host muere con el lote abierto
    const dbC = fixture.createFileDb(path.join(TMP, "crash.db"));
    check(dbSchema.beginBulk(dbC) === true, "lote abierto en la BD de la prueba");
    const lost = dbC.prepare("SELECT COUNT(*) c FROM change_log").get().c;
    dbC.prepare(
      "INSERT INTO products (barcode, name, price, stock, is_active, is_catalog) VALUES ('CRASH','X',1,1,1,0)",
    ).run();
    check(
      dbC.prepare("SELECT COUNT(*) c FROM change_log").get().c === lost,
      "corte simulado: esa fila NO quedó registrada",
    );
    dbSchema.ensureChangeLog(dbC); // lo que hace main.js al arrancar
    check(
      !dbC.prepare("SELECT value FROM settings WHERE key='replica_bulk_active'").get(),
      "el arranque cierra el lote pendiente y borra la bandera",
    );
    check(
      dbC.prepare("SELECT COUNT(*) c FROM change_log WHERE op='bulk'").get().c === 1,
      "el arranque deja una marca `bulk`",
    );
    const recFirst = Number(
      dbC.prepare("SELECT value FROM settings WHERE key='change_log_first_seq'").get().value,
    );
    check(
      recFirst > lost,
      "…y adelanta el hueco MÁS ALLÁ de lo perdido (nada queda mudo)",
      `${recFirst} > ${lost}`,
    );
    check(countTriggers(dbC) === 36, "…y restaura los 36 triggers", String(countTriggers(dbC)));
    dbC.close();
  } catch (err) {
    fail++;
    console.log("  FAIL excepción no controlada :: " + (err && err.stack));
  } finally {
    try {
      apiServer.stopServer();
    } catch (e) {}
    try {
      dbA.close();
    } catch (e) {}
  }

  console.log(`\n=== 3e: ${pass} PASS / ${fail} FAIL ===`);
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
