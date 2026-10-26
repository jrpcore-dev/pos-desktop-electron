"use strict";
/*
 * ENTREGA 3f · Réplica incremental: `updated_at` y tumba-sigilos.
 *
 *   A) `updated_at` en las 8 tablas de entidad (`settings` queda fuera: es
 *      clave/valor). Se refresca desde los triggers de change_log, no viaja a
 *      la caja (es metadato del Host) y —lo crítico— NO rompe la regla de que
 *      una escritura genera UN solo evento.
 *   B) Tumba-sigilo `replica_tombstones`: se escribe al salir del conjunto o
 *      al borrar, se borra al volver, y sobrevive a la compactación del log.
 *   C) `ensureChangeLog` reescribe los cuerpos de los triggers. Es lo que hace
 *      posible todo lo anterior: `CREATE TRIGGER IF NOT EXISTS` no actualiza un
 *      cuerpo ya creado, así que una BD existente se quedaría con los triggers
 *      de la entrega que los creó.
 *   D) `GET /api/replica/tombstones`: 403 sin emparejar y paginación por
 *      cursor compuesto, porque `ts` resuelve a SEGUNDOS.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts/check-3f-replica.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const dbSchema = require(path.join(REPO, "src/main/db-schema.js"));
const activation = require(path.join(REPO, "src/main/activation.js"));
const apiServer = require(path.join(REPO, "src/main/api-server.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-3f-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });
const PORT = 3550;
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

const TRIGGER_COUNT_SQL =
  "SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_change_log%'";
const countTriggers = (db) => db.prepare(TRIGGER_COUNT_SQL).get().c;
const logCount = (db) => db.prepare("SELECT COUNT(*) c FROM change_log").get().c;

// 3 por tabla replicada (insert/update/delete) + 1 de salida por tabla con
// filtro (products) + 1 `*_touch` por tabla de entidad. Se deriva del esquema:
// una tabla replicada nueva no obliga a tocar este número a mano.
const EXPECTED_TRIGGERS =
  dbSchema.REPLICATED_TABLES.length * 3 + 1 + dbSchema.UPDATED_AT_TABLES.length;
const tombstones = (db, tbl, rowId) =>
  db
    .prepare(
      `SELECT COUNT(*) c FROM ${dbSchema.TOMBSTONE_TABLE} WHERE tbl = ? AND row_id = ?`,
    )
    .get(tbl, rowId).c;

(async () => {
  const dbA = fixture.createFileDb(path.join(TMP, "host.db"));

  try {
    // ─── A · updated_at ─────────────────────────────────────────────────────
    console.log("=== 3f A · updated_at (columna + trigger + plan) ===");
    for (const tbl of dbSchema.UPDATED_AT_TABLES) {
      const has = dbA
        .prepare(`PRAGMA table_info(${tbl})`)
        .all()
        .some((c) => c.name === "updated_at");
      check(has, `columna updated_at en ${tbl}`);
    }
    check(
      dbSchema.UPDATED_AT_TABLES.length === dbSchema.REPLICATED_TABLES.length - 1 &&
        !dbA.prepare("PRAGMA table_info(settings)").all().some((c) => c.name === "updated_at"),
      "settings NO lleva updated_at (es clave/valor, no entidad)",
      JSON.stringify(dbSchema.UPDATED_AT_TABLES),
    );
    check(
      countTriggers(dbA) === EXPECTED_TRIGGERS,
      `${EXPECTED_TRIGGERS} triggers: 3 por tabla + salida + un *_touch por tabla de entidad`,
      String(countTriggers(dbA)),
    );
    // El `*_touch` va aparte y NO plegado en el de `_update` para poder llevar
    // `WHEN`: así, dentro del mismo segundo ni siquiera se ejecuta el UPDATE.
    // Sin esa guardia era, medido, lo único que hacía incumplir el coste por
    // venta de la 3d (< 2 ms).
    const touchSql = dbA
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_change_log_categories_touch'")
      .get();
    check(
      touchSql !== undefined && touchSql.sql.includes("WHEN NEW.updated_at IS NULL OR NEW.updated_at <>"),
      "el `*_touch` lleva la guardia en su WHEN (no ejecuta si no cambió)",
      touchSql && touchSql.sql.replace(/\s+/g, " ").slice(0, 110),
    );
    check(
      dbA
        .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_change_log_categories_update'")
        .get()
        .sql.includes("NEW.updated_at IS OLD.updated_at"),
      "el trigger de `_update` ignora el toque para no duplicar el evento",
    );

    // `recursive_triggers` es lo que hace seguro el UPDATE sobre la propia
    // tabla: si alguien lo activara, la condición de parada es lo único que
    // impide la recursión. Se deja registrado el valor real sobre el que corre.
    check(
      dbA.pragma("recursive_triggers", { simple: true }) === 0,
      "recursive_triggers = 0 (el arranque nunca lo activa)",
      String(dbA.pragma("recursive_triggers", { simple: true })),
    );

    dbA.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('store_name','3F TEST')",
    ).run();

    let n = logCount(dbA);
    dbA.prepare("INSERT INTO categories (id, name) VALUES (1, 'Lácteos')").run();
    check(logCount(dbA) - n === 1, "un INSERT genera UN solo evento", String(logCount(dbA) - n));
    const cat = dbA.prepare("SELECT updated_at FROM categories WHERE id = 1").get();
    check(cat.updated_at !== null && cat.updated_at > 0, "el INSERT rellena updated_at", String(cat.updated_at));
    const afterInsert = dbA
      .prepare(
        `SELECT ts FROM change_log WHERE tbl = 'categories' ORDER BY seq DESC LIMIT 1`,
      )
      .get().ts;
    check(cat.updated_at === afterInsert, "updated_at coincide con el ts de su evento", `${cat.updated_at} vs ${afterInsert}`);

    // La resolución heredada de `changeLogNow` (`strftime('%s')*1000`) es de un
    // segundo: dentro del mismo segundo el refresco es redundante y no escribe.
    n = logCount(dbA);
    dbA.prepare("UPDATE categories SET description = 'muy dentro del segundo' WHERE id = 1").run();
    check(logCount(dbA) - n === 1, "otro UPDATE genera UN solo evento", String(logCount(dbA) - n));
    const sameSecond = dbA.prepare("SELECT updated_at FROM categories WHERE id = 1").get();
    check(
      sameSecond.updated_at === cat.updated_at,
      "dentro del mismo segundo updated_at no cambia (resolución 1 s heredada de la 3d)",
      `${cat.updated_at} -> ${sameSecond.updated_at}`,
    );

    const wait = (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end);
    };
    wait(1100);
    dbA.prepare("UPDATE categories SET description = 'pasado un segundo' WHERE id = 1").run();
    const later = dbA.prepare("SELECT updated_at FROM categories WHERE id = 1").get();
    check(
      later.updated_at > sameSecond.updated_at,
      "pasado un segundo el refresco SÍ sube",
      `${sameSecond.updated_at} -> ${later.updated_at}`,
    );

    // 1 escritura = 1 evento, con la fila ya tocada: es la aserción que
    // protege el `WHEN NEW.updated_at IS OLD.updated_at`.
    n = logCount(dbA);
    dbA.prepare("UPDATE categories SET name = 'Lácteos y derivados' WHERE id = 1").run();
    check(logCount(dbA) - n === 1, "UPDATE sobre una fila ya tocada = 1 evento", String(logCount(dbA) - n));

    // No viaja: si viajara, la caja lo pisaría al aplicar el cambio.
    const plan = dbSchema.replicaPlan(dbA);
    check(
      !plan.products.includes("updated_at") &&
        !plan.cashiers.includes("updated_at") &&
        !plan.categories.includes("updated_at"),
      "replicaPlan NO incluye updated_at en ninguna tabla",
      JSON.stringify(plan.products),
    );
    check(
      !plan.products.includes("cost_price"),
      "cost_price sigue sin viajar (regla 3d intacta)",
      JSON.stringify(plan.products),
    );

    // El snapshot lo confirma de punta a punta.
    const started = await apiServer.startServer(dbA, PORT, { appVersion: "9.9.9-check" });
    check(started.success, "servidor del Host arranca", JSON.stringify(started));
    const boxId = "box-3f-001";
    const boxToken = "tok-3f";
    dbA.prepare(
      "INSERT OR REPLACE INTO paired_devices (device_id, device_name, paired_token_hash, cashier_id, activated_at, device_code, device_type, approved, revoked) VALUES (?,?,?,1,strftime('%s','now')*1000,'A','desktop_box',1,0)",
    ).run(boxId, "Caja 3f", activation.hashToken(boxToken));
    const SESSION = { "x-device-id": boxId, "x-device-token": boxToken };

    let r = await get(`${URL}/api/replica/snapshot?table=categories&limit=100`, SESSION);
    check(
      r.status === 200 && !r.data.columns.includes("updated_at"),
      "el snapshot de la caja NO trae la columna updated_at",
      JSON.stringify(r.data.columns),
    );

    // ─── B · tumba-sigilos ─────────────────────────────────────────────────
    console.log("\n=== 3f B · replica_tombstones ===");
    check(
      dbA
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(dbSchema.TOMBSTONE_TABLE) !== undefined,
      "la tabla replica_tombstones existe",
      dbSchema.TOMBSTONE_TABLE,
    );
    dbA.prepare(
      "INSERT INTO products (id, barcode, name, price, stock, is_active) VALUES (5,'T-5','Queso',20,3,1)",
    ).run();
    check(tombstones(dbA, "products", "5") === 0, "producto activo: sin tumba-sigilo", String(tombstones(dbA, "products", "5")));

    n = logCount(dbA);
    dbA.prepare("UPDATE products SET is_active = 0 WHERE id = 5").run();
    check(logCount(dbA) - n === 1, "desactivar = 1 evento", String(logCount(dbA) - n));
    const ev = dbA
      .prepare("SELECT op FROM change_log WHERE tbl='products' ORDER BY seq DESC LIMIT 1")
      .get().op;
    check(ev === "delete", "el evento de salida es `delete`", ev);
    check(tombstones(dbA, "products", "5") === 1, "salir del conjunto ESCRIBE la tumba-sigilo", String(tombstones(dbA, "products", "5")));

    n = logCount(dbA);
    dbA.prepare("UPDATE products SET is_active = 1 WHERE id = 5").run();
    check(logCount(dbA) - n === 1, "reactivar = 1 evento", String(logCount(dbA) - n));
    check(tombstones(dbA, "products", "5") === 0, "volver al conjunto BORRA la tumba-sigilo", String(tombstones(dbA, "products", "5")));

    dbA.prepare("DELETE FROM products WHERE id = 5").run();
    check(tombstones(dbA, "products", "5") === 1, "borrar la fila ESCRIBE la tumba-sigilo", String(tombstones(dbA, "products", "5")));
    const dead = dbA
      .prepare(`SELECT ts FROM ${dbSchema.TOMBSTONE_TABLE} WHERE tbl='products' AND row_id='5'`)
      .get();
    check(dead.ts > 0, "la tumba-sigilo lleva su ts", String(dead.ts));

    // Regresión 3d: el PIN de cajero no viaja, así que tampoco deja rastro.
    const pin = require(path.join(REPO, "src/main/pins.js")).hashPin("1234");
    dbA.prepare(
      "INSERT INTO cashiers (id, name, role, pin, is_active, pin_hash, pin_salt) VALUES (7,'Rosa','cashier','1234',1,?,?)",
    ).run(pin.hash, pin.salt);
    n = logCount(dbA);
    dbA.prepare("UPDATE cashiers SET pin = '9999' WHERE id = 7").run();
    check(
      logCount(dbA) - n === 0 && tombstones(dbA, "cashiers", "7") === 0,
      "cambiar el PIN de un cajero no genera evento ni tumba-sigilo",
      `${logCount(dbA) - n} eventos`,
    );

    // Fuera de la lista de settings replicables no pasa nada (regla 3d).
    n = logCount(dbA);
    dbA.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('clave_interna','x')").run();
    check(logCount(dbA) - n === 0, "setting fuera de la lista: 0 eventos", String(logCount(dbA) - n));

    // idempotencia de la recuperación completa.
    dbSchema.ensureChangeLog(dbA);
    dbSchema.ensureChangeLog(dbA);
    check(countTriggers(dbA) === EXPECTED_TRIGGERS, `ensureChangeLog idempotente: ${EXPECTED_TRIGGERS} triggers`, String(countTriggers(dbA)));
    check(
      dbA
        .prepare(`SELECT COUNT(*) c FROM ${dbSchema.TOMBSTONE_TABLE}`)
        .get().c === 1,
      "los datos de la tumba-sigilo no se pierden al re-ejecutar",
      String(dbA.prepare(`SELECT COUNT(*) c FROM ${dbSchema.TOMBSTONE_TABLE}`).get().c),
    );

    // ─── C · los cuerpos de los triggers se REESCRIBEN ─────────────────────
    console.log("\n=== 3f C · ensureChangeLog reescribe los cuerpos ===");
    // Este es el hallazgo que hace posible la entrega: `CREATE TRIGGER IF NOT
    // EXISTS` no pisa un cuerpo ya creado, así que sin el drop+recreate una BD
    // existente se quedaría con los triggers de una entrega anterior.
    dbA.exec(`DROP TRIGGER IF EXISTS trg_change_log_categories_update`);
    dbA.exec(
      `CREATE TRIGGER trg_change_log_categories_update AFTER UPDATE ON categories
       BEGIN
         INSERT INTO change_log (tbl, row_id, op, ts) VALUES ('categories', CAST(NEW.id AS TEXT), 'upsert', 1);
       END`,
    );
    const stale = dbA
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_change_log_categories_update'",
      )
      .get().sql;
    check(
      !stale.includes(dbSchema.TOMBSTONE_TABLE),
      "antes: el cuerpo viejo no toca la tumba-sigilo",
      stale.replace(/\s+/g, " ").slice(0, 90),
    );
    dbSchema.ensureChangeLog(dbA);
    const fresh = dbA
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_change_log_categories_update'",
      )
      .get().sql;
    check(
      fresh.includes(dbSchema.TOMBSTONE_TABLE) && fresh.includes("updated_at IS OLD.updated_at"),
      "después: ensureChangeLog reescribe el cuerpo con la 3f",
      fresh.replace(/\s+/g, " ").slice(0, 120),
    );
    n = logCount(dbA);
    dbA.prepare("UPDATE categories SET description = 'tras reescribir' WHERE id = 1").run();
    check(logCount(dbA) - n === 1, "y con el cuerpo reescrito sigue habiendo 1 evento", String(logCount(dbA) - n));

    // Aunque la columna falte (p. ej. alguien la borró), `ensureChangeLog` la
    // vuelve a poner. Hay que dropear TODOS los triggers que la usan antes del
    // ALTER —el de `_insert` la rellena y el `*_touch` la refresca—; si no,
    // SQLite se niega con "no such column".
    for (const op of ["insert", "update", "delete", "touch"]) {
      dbA.exec(`DROP TRIGGER IF EXISTS trg_change_log_categories_${op}`);
    }
    dbA.exec("ALTER TABLE categories DROP COLUMN updated_at");
    check(
      !dbA.prepare("PRAGMA table_info(categories)").all().some((c) => c.name === "updated_at"),
      "columna retirada a mano (estado de partida del caso)",
    );
    dbSchema.ensureChangeLog(dbA);
    check(
      dbA.prepare("PRAGMA table_info(categories)").all().some((c) => c.name === "updated_at"),
      "ensureChangeLog devuelve a poner updated_at",
    );
    check(
      dbA
        .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_change_log_categories_touch'")
        .get() !== undefined,
      "…y con él el `*_touch` que la refresca",
    );
    n = logCount(dbA);
    dbA.prepare("UPDATE categories SET description = 'columna restaurada' WHERE id = 1").run();
    check(logCount(dbA) - n === 1, "y la actualización vuelve a generar 1 evento", String(logCount(dbA) - n));
    const restored = dbA.prepare("SELECT updated_at FROM categories WHERE id = 1").get();
    check(
      restored.updated_at !== null && restored.updated_at > 0,
      "…y el trigger vuelto a crear refresca el valor",
      String(restored.updated_at),
    );

    // ─── D · GET /api/replica/tombstones ───────────────────────────────────
    console.log("\n=== 3f D · API /api/replica/tombstones ===");
    const anon = await get(`${URL}/api/replica/tombstones`);
    check(anon.status === 403, "sin emparejar → 403", String(anon.status));
    const bad = await get(`${URL}/api/replica/tombstones`, {
      "x-device-id": "box-x",
      "x-device-token": "malo",
    });
    check(bad.status === 403, "con credenciales malas → 403", String(bad.status));

    r = await get(`${URL}/api/replica/tombstones`, SESSION);
    check(r.status === 200 && r.data.success, "caja emparejada → 200", JSON.stringify(r.data));
    check(
      Array.isArray(r.data.tombstones) &&
        r.data.tombstones.some((t) => t.tbl === "products" && t.row_id === "5"),
      "devuelve la tumba-sigilo del producto borrado",
      JSON.stringify(r.data.tombstones),
    );
    check(
      r.data.tombstones.every((t) => typeof t.tbl === "string" && typeof t.row_id === "string" && typeof t.ts === "number"),
      "cada tumba-sigilo lleva tbl/row_id/ts",
      JSON.stringify(r.data.tombstones),
    );

    // Paginación con cursor compuesto. Se fijan tres tumba-sigilos en el MISMO
    // ts (que es lo normal: `ts` resuelve a segundos) y se pagina con limit=1:
    // con un cursor sólo de `ts` se perderían dos de las tres y nadie se
    // enteraría — exactamente el fallo silencioso que evita esta tabla.
    const FROZEN = 1700000000000;
    for (let i = 10; i < 13; i++) {
      dbA.prepare(
        "INSERT INTO products (id, barcode, name, price, stock, is_active) VALUES (?, ?, 'Borrable', 1, 1, 1)",
      ).run(i, `D-${i}`);
      dbA.prepare("DELETE FROM products WHERE id = ?").run(i);
    }
    dbA.exec(`UPDATE ${dbSchema.TOMBSTONE_TABLE} SET ts = ${FROZEN}`);
    const totalT = dbA.prepare(`SELECT COUNT(*) c FROM ${dbSchema.TOMBSTONE_TABLE}`).get().c;

    let cursor = null;
    const seen = [];
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ limit: "1" });
      if (cursor) {
        qs.set("since_ts", String(cursor.ts));
        qs.set("since_tbl", cursor.tbl);
        qs.set("since_row_id", cursor.row_id);
      }
      const pg = await get(`${URL}/api/replica/tombstones?${qs}`, SESSION);
      if (pg.status !== 200 || !pg.data.tombstones) break;
      for (const t of pg.data.tombstones) seen.push(`${t.tbl}:${t.row_id}`);
      cursor = pg.data.next;
      if (!pg.data.has_more && !cursor) break;
      if (cursor && !pg.data.tombstones.length) break;
    }
    const unique = [...new Set(seen)];
    check(
      unique.length === totalT,
      `paginando con limit=1 no se pierde NINGUNA tumba-sigilo (${totalT} en total, ${seen.length} vistas)`,
      JSON.stringify({ totalT, seen }),
    );
    check(
      unique.filter((s) => s.startsWith("products:")).length >= 4,
      "las cuatro tumba-sigilos de products están todas ahí",
      JSON.stringify(unique),
    );
    const noneAfter = await get(`${URL}/api/replica/tombstones?since_ts=${FROZEN + 1}`, SESSION);
    check(
      noneAfter.data.tombstones.length === 0,
      "un ts por encima del de todas no devuelve nada",
      JSON.stringify(noneAfter.data),
    );
    const beforeFrozen = await get(`${URL}/api/replica/tombstones?since_ts=${FROZEN - 1}`, SESSION);
    check(
      beforeFrozen.data.tombstones.length > 0 &&
        beforeFrozen.data.tombstones.every((t) => t.ts > FROZEN - 1),
      "since_ts sólo devuelve tumba-sigilos posteriores",
      JSON.stringify(beforeFrozen.data.tombstones),
    );
    const all = await get(`${URL}/api/replica/tombstones?limit=2000`, SESSION);
    check(
      all.data.tombstones.length === totalT,
      "con limit alto se devuelven todas en una sola página",
      `${all.data.tombstones.length} vs ${totalT}`,
    );

    // ─── E · bucle de réplica en vivo (SSE + delta + reconexión) ───────────
    console.log("\n=== 3f E · el bucle en vivo de la caja ===");
    const replicaEngine = require(path.join(REPO, "src/main/replica-engine.js"));
    const replicaLive = require(path.join(REPO, "src/main/replica-live.js"));
    const clientLink = require(path.join(REPO, "src/main/client-link.js"));

    // El harness no tiene safeStorage, pero el token tiene que guardar y leer
    // por la MISMA ruta que usa la app: `enc:v1:` + cipher.
    clientLink.setSecretCipher({
      encrypt: (s) => Buffer.from(String(s), "utf8").toString("base64"),
      decrypt: (s) => Buffer.from(String(s), "base64").toString("utf8"),
    });

    const boxDb = fixture.createFileDb(path.join(TMP, "box-live.db"));
    const boxId2 = "box-live-001";
    const boxToken2 = "tok-live";
    activation.setSetting(boxDb, clientLink.SETTINGS.HOST_URL, URL);
    activation.setSetting(boxDb, clientLink.SETTINGS.BOX_DEVICE_ID, boxId2);
    const saved = clientLink.savePairedToken(boxDb, boxToken2);
    check(saved.persisted !== false, "la caja guarda su token cifrado", JSON.stringify(saved));
    check(
      clientLink.readPairedToken(boxDb) === boxToken2,
      "…y lo vuelve a leer por la misma ruta",
      String(clientLink.readPairedToken(boxDb)),
    );
    dbA
      .prepare(
        "INSERT OR REPLACE INTO paired_devices (device_id, device_name, paired_token_hash, cashier_id, activated_at, device_code, device_type, approved, revoked) VALUES (?,?,?,1,strftime('%s','now')*1000,'B','desktop_box',1,0)",
      )
      .run(boxId2, "Caja viva", activation.hashToken(boxToken2));

    const waitFor = async (fn, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 40));
      }
      return fn();
    };

    const snap = await replicaEngine.downloadSnapshot(boxDb);
    check(snap.success, "descarga inicial de la caja OK", JSON.stringify(snap).slice(0, 180));
    check(replicaEngine.state(boxDb).sync_completed, "sync_completed = 1: ya puede vender");
    check(
      replicaLive.liveState(boxDb).running === false,
      "el bucle NO corre hasta que hay réplica aplicada",
      JSON.stringify(replicaLive.liveState(boxDb)),
    );

    // El aviso de `db-changed` es el mismo que emite main.js al renderer; aquí
    // se captura directamente para comprobar que el bucle entrega tablas/ids.
    const alerts = [];
    const stopLive = replicaLive.startLiveSync({
      db: boxDb,
      onChanged: (tables, ids) => alerts.push({ tables, ids }),
    });

    check(
      await waitFor(() => replicaLive.liveState(boxDb).state === "connected"),
      "el bucle se conecta al SSE del Host",
      JSON.stringify(replicaLive.liveState(boxDb)),
    );

    // Escritura en el Host: el producto tiene que aparecer en la caja sin que
    // nadie la sondee ni se toque ninguna pantalla.
    dbA
      .prepare("INSERT INTO products (barcode, name, price, stock, is_active) VALUES ('LIVE-1','Producto vivo', 99, 3, 1)")
      .run();
    const liveId = dbA.prepare("SELECT id FROM products WHERE barcode='LIVE-1'").get().id;
    check(
      await waitFor(() => boxDb.prepare("SELECT 1 AS x FROM products WHERE barcode='LIVE-1'").get() !== undefined),
      "el INSERT del Host aparece en la caja en < 8 s sin sondeo",
      String(boxDb.prepare("SELECT COUNT(*) c FROM products WHERE barcode='LIVE-1'").get().c),
    );
    check(alerts.length > 0, "el bucle entregó el aviso de `db-changed`", JSON.stringify(alerts.slice(0, 2)));
    check(
      alerts.some((e) => e.tables.includes("products")),
      "…y el aviso nombra la tabla products",
      JSON.stringify(alerts.map((e) => e.tables)),
    );
    check(
      alerts.some((e) => e.ids.products && e.ids.products.includes(String(liveId))),
      "…con el id concreto de la fila",
      JSON.stringify(alerts.map((e) => e.ids)),
    );

    // El borrado también viaja.
    dbA.prepare("DELETE FROM products WHERE id = ?").run(liveId);
    check(
      await waitFor(() => boxDb.prepare("SELECT 1 AS x FROM products WHERE barcode='LIVE-1'").get() === undefined),
      "el DELETE del Host también llega",
      String(boxDb.prepare("SELECT COUNT(*) c FROM products WHERE barcode='LIVE-1'").get().c),
    );

    // Reconexión: se mata el servidor, se escribe A CIEGAS y se vuelve a
    // arrancar. El cursor persiste, así que el hueco se recupera entero.
    await apiServer.stopServer();
    dbA
      .prepare("INSERT INTO products (barcode, name, price, stock, is_active) VALUES ('LIVE-2','Tras la caida', 1, 1, 1)")
      .run();
    await new Promise((r) => setTimeout(r, 250));
    const restarted = await apiServer.startServer(dbA, PORT, { appVersion: "9.9.9-check" });
    check(restarted.success, "el Host vuelve a arrancar tras caer", JSON.stringify(restarted));
    check(
      await waitFor(() => boxDb.prepare("SELECT 1 AS x FROM products WHERE barcode='LIVE-2'").get() !== undefined, 20000),
      "la caja se reconecta sola y recupera el cambio hecho sin Host",
      JSON.stringify(replicaLive.liveState(boxDb)),
    );
    check(
      Number(replicaLive.liveState(boxDb).reconnects) > 0,
      "el contador de reconexiones quedó registrado",
      JSON.stringify(replicaLive.liveState(boxDb)),
    );

    // Observación (sin aserción): esta caja de la prueba NUNCA adoptó el rol
    // "client" (no se le escribió `device_role`), así que conserva los mismos
    // triggers que el Host y cada fila aplicada también escribe en SU
    // change_log. En una caja de verdad A3 le retira los triggers y este
    // contador sale 0. No lo lee nadie, pero conviene ver cuánto pesa.
    const boxLog = boxDb.prepare("SELECT COUNT(*) c FROM change_log").get().c;
    const boxTomb = boxDb.prepare(`SELECT COUNT(*) c FROM ${dbSchema.TOMBSTONE_TABLE}`).get().c;
    console.log(`    · la caja acumula ${boxLog} eventos y ${boxTomb} tumba-sigilos propios`);

    check(replicaLive.liveState(boxDb).running === true, "el bucle está vivo mientras corre");
    stopLive();
    check(
      replicaLive.liveState(boxDb).state === "stopped" && replicaLive.liveState(boxDb).running === false,
      "stop() lo apaga y lo retira de la lista de activos",
      JSON.stringify(replicaLive.liveState(boxDb)),
    );
    boxDb.close();
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

  console.log(`\n=== 3f: ${pass} PASS / ${fail} FAIL ===`);
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
