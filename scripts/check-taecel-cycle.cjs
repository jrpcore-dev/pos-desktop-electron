"use strict";
/*
 * Ciclo StatusTXN de Taecel con los tiempos exigidos en la certificación:
 *
 *   - StatusTXN inmediato tras recibir el transID;
 *   - timeout de 10 s como máximo por consulta y 3 s entre consultas;
 *   - "En proceso", timeout o respuesta mal formada → se vuelve a consultar;
 *   - corte a los 60 s desde RequestTXN y seguimiento con getSales;
 *   - fuera del ciclo (UI, poller) nadie vuelve a llamar StatusTXN.
 *
 * Usa un Taecel simulado y los tiempos reales, así que tarda ~65 s.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-taecel-cycle.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const { createServiceTransactions } = require(path.join(fixture.REPO, "src/main/service-transactions.js"));
const { createTaecel } = require(path.join(fixture.REPO, "src/main/taecel.js"));

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
const T0 = Date.now();
const secs = (ms) => (ms / 1000).toFixed(2) + " s";

// ── Taecel simulado: cada transID tiene un guion de respuestas ──────────────
const pending = { ok: true, status: "pending", rawStatus: "En proceso", message: "En proceso" };
const applied = (transId) => ({
  ok: true,
  status: "applied",
  rawStatus: "Exitosa",
  message: "Transacción Exitosa",
  transId,
  folio: "F" + transId,
});
const failed = (transId) => ({ ok: true, status: "failed", rawStatus: "Fracasada", message: "Teléfono no valido", transId });
const transport = { ok: false, kind: "unknown", code: "TAECEL_TRANSPORT", message: "timeout", ambiguous: true };
const badFormat = { ok: false, kind: "unknown", code: "TAECEL_BAD_RESPONSE", message: "sin JSON", ambiguous: true };

const scripts = {
  // [respuesta, ms que tarda] por consulta; la última se repite.
  "T-OK": [[applied("T-OK"), 300]],
  "T-FAIL": [[failed("T-FAIL"), 300]],
  "T-SLOW": [
    ["timeout", null],
    [applied("T-SLOW"), 300],
  ],
  "T-BAD": [
    [badFormat, 2000],
    [applied("T-BAD"), 300],
  ],
  "T-ETERNAL-FOUND": [[pending, 400]],
  "T-ETERNAL-MISSING": [[pending, 400]],
  "T-SLOW-ETERNAL": [["timeout", null]],
};
const salesRows = {
  1: [{ ...applied("T-ETERNAL-FOUND"), transId: "T-ETERNAL-FOUND", amountCents: 1000 }],
  2: [],
};

const calls = []; // { method, transId, at, end, timeoutMs, bolsa, force }
const fakeTaecel = {
  statusTxn: async (transId, { timeoutMs } = {}) => {
    const list = scripts[transId];
    const n = calls.filter((c) => c.method === "StatusTXN" && c.transId === transId).length;
    const [resp, ms] = list[Math.min(n, list.length - 1)];
    const call = { method: "StatusTXN", transId, at: Date.now(), timeoutMs };
    calls.push(call);
    if (resp === "timeout") {
      await sleep(timeoutMs);
      call.end = Date.now();
      return transport;
    }
    await sleep(Math.min(ms, timeoutMs));
    call.end = Date.now();
    return resp;
  },
  getSales: async ({ date, bolsa, force }) => {
    calls.push({ method: "getSales", at: Date.now(), end: Date.now(), bolsa, force, date });
    return { ok: true, sales: salesRows[bolsa] || [] };
  },
  rememberBalanceFromStatus: () => {},
};

const db = fixture.createMemoryDb();
const svc = createServiceTransactions({ db, taecel: fakeTaecel, logger: (scope, err) => console.log("  log", scope, err && err.message) });

const insertPending = (transId, categoryId = 1) => {
  const info = db
    .prepare(
      `INSERT INTO service_transactions
        (client_request_id, ref_cte, provider, provider_trans_id, status, category_id, product_code, amount_cents, requested_at, updated_at)
       VALUES (?, ?, 'taecel', ?, 'pending', ?, 'TEL010', 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run("cr-" + transId, "R" + transId.replace(/-/g, ""), transId, categoryId);
  return Number(info.lastInsertRowid);
};
const row = (id) => db.prepare("SELECT * FROM service_transactions WHERE id = ?").get(id);
const statusCalls = (transId) => calls.filter((c) => c.method === "StatusTXN" && c.transId === transId);

// AbortSignal.timeout no mantiene vivo el proceso mientras el fetch simulado
// espera; sin esto Node sale antes de terminar.
const keepAlive = setInterval(() => {}, 1000);

(async () => {
  console.log("=== Ciclo StatusTXN de Taecel ===");

  // ── taecel.js: timeout real de StatusTXN (fetch que nunca responde) ──────
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const hangingFetch = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")));
    });
  const realTaecel = createTaecel({ db, cipher, fetchImpl: hangingFetch, baseUrl: "http://simulado" });
  realTaecel.saveCredentials("k", "n");
  let t = Date.now();
  const r1 = await realTaecel.statusTxn("X", { timeoutMs: 1500 });
  const d1 = Date.now() - t;
  check(!r1.ok && r1.code === "TAECEL_TRANSPORT" && d1 >= 1400 && d1 < 2500, "StatusTXN respeta el timeout pedido", secs(d1));
  t = Date.now();
  const r2 = await realTaecel.statusTxn("X", { timeoutMs: 60000 });
  const d2 = Date.now() - t;
  check(!r2.ok && d2 >= 9500 && d2 < 11000, "StatusTXN nunca espera más de 10 s", secs(d2));

  // Respuesta real de Taecel para una TXN fracasada: success:false / error "1"
  // con data.Status "Fracasada " (con espacio). Es estatus final.
  const jsonFetch = (body) => async () => ({ status: 200, text: async () => JSON.stringify(body) });
  const failedTaecel = createTaecel({
    db,
    cipher,
    fetchImpl: jsonFetch({
      success: false,
      error: "1",
      message: "Teléfono no valido",
      data: { TransID: "261001672156", Status: "Fracasada ", Folio: "", Monto: "$50.00" },
      extra: null,
    }),
    baseUrl: "http://simulado",
  });
  const rf = await failedTaecel.statusTxn("261001672156");
  check(rf.ok && rf.status === "failed", "StatusTXN success:false con Status Fracasada es final", JSON.stringify(rf.status || rf.code));
  const errTaecel = createTaecel({
    db,
    cipher,
    fetchImpl: jsonFetch({ success: false, error: 8888, message: "Error", data: [] }),
    baseUrl: "http://simulado",
  });
  const re = await errTaecel.statusTxn("X");
  check(!re.ok, "StatusTXN success:false sin estatus en data sigue siendo error");

  // ── service-transactions: todos los escenarios en paralelo ───────────────
  const ids = {};
  for (const transId of Object.keys(scripts)) ids[transId] = insertPending(transId);
  const start = Date.now();
  // La UI pide el estado de forma automática varias veces: no debe duplicar.
  for (const transId of Object.keys(scripts)) {
    await svc.checkTransaction({ transactionId: ids[transId] });
    await svc.checkTransaction({ transactionId: ids[transId] });
  }
  // El poller tampoco debe duplicar.
  svc.startPoller({ intervalMs: 500 });

  // Listo cuando cada fila ya es final o quedó agendada para getSales (su
  // next_check_at está lejos; durante StatusTXN es de +5 s).
  const settled = (id) => {
    const r = row(id);
    if (r.status !== "pending") return true;
    const next = r.next_check_at ? new Date(r.next_check_at.replace(" ", "T") + "Z").getTime() : 0;
    return next - Date.now() > 10000;
  };
  while (Date.now() - start < 75000 && !Object.values(ids).every(settled)) await sleep(250);
  svc.stopPoller();

  for (const transId of Object.keys(scripts)) {
    const sc = statusCalls(transId);
    if (!sc.length) continue;
    check(sc[0].at - start < 1000, `${transId}: primera StatusTXN inmediata`, secs(sc[0].at - start));
    check(sc.every((c) => c.timeoutMs <= 10000), `${transId}: timeout ≤ 10 s en cada consulta`);
    check(sc.every((c) => c.timeoutMs >= 5000), `${transId}: timeout ≥ 5 s en cada consulta`);
    const gaps = sc.slice(1).map((c, i) => c.at - sc[i].end);
    check(
      gaps.every((g) => g >= 2900 && g < 3800),
      `${transId}: 3 s entre consultas`,
      gaps.map(secs).join(", "),
    );
    check(sc.every((c) => c.at - start < 60000), `${transId}: ninguna StatusTXN se envía pasados 60 s`);
    check(sc.every((c) => c.end - start <= 65100), `${transId}: ninguna respuesta se espera más allá de 65 s`);
    // Taecel rechazó cortar a los ~53 s: si sigue "En proceso", se consulta
    // hasta que la siguiente ya caería después de los 60 s.
    const last = sc[sc.length - 1];
    const finalRow = row(ids[transId]);
    if (finalRow.status !== "applied" && finalRow.status !== "failed" || transId.startsWith("T-ETERNAL")) {
      check(
        last.end + 3000 - start >= 60000,
        `${transId}: no deja de consultar antes de tiempo`,
        `última enviada a ${secs(last.at - start)}`,
      );
    }
    const overlap = sc.slice(1).some((c, i) => c.at < sc[i].end);
    check(!overlap, `${transId}: sin consultas simultáneas`);
  }

  check(row(ids["T-OK"]).status === "applied" && statusCalls("T-OK").length === 1, "T-OK: exitosa con 1 consulta");
  check(row(ids["T-FAIL"]).status === "failed" && statusCalls("T-FAIL").length === 1, "T-FAIL: fracasada con 1 consulta");
  check(
    row(ids["T-SLOW"]).status === "applied" && statusCalls("T-SLOW").length === 2,
    "T-SLOW: timeout de 10 s y reconsulta exitosa",
  );
  check(
    row(ids["T-BAD"]).status === "applied" && statusCalls("T-BAD").length === 2,
    "T-BAD: formato roto y reconsulta exitosa",
  );

  const found = row(ids["T-ETERNAL-FOUND"]);
  check(found.status === "applied", "T-ETERNAL-FOUND: getSales confirma la exitosa", found.status);
  const followSlot = (id) =>
    db.prepare("SELECT CAST(strftime('%s', next_check_at) - strftime('%s', requested_at) AS INTEGER) AS s FROM service_transactions WHERE id = ?").get(id).s;
  const missing = row(ids["T-ETERNAL-MISSING"]);
  check(
    missing.status === "pending" && followSlot(missing.id) === 90,
    "T-ETERNAL-MISSING: sigue en proceso con getSales agendado a los 90 s",
    `${missing.status}/${followSlot(missing.id)}`,
  );
  const slowEternal = row(ids["T-SLOW-ETERNAL"]);
  check(
    slowEternal.status === "pending" && followSlot(slowEternal.id) === 90,
    "T-SLOW-ETERNAL: sólo timeouts, también agendado para getSales",
    `${slowEternal.status}/${followSlot(slowEternal.id)}`,
  );
  const se = statusCalls("T-SLOW-ETERNAL");
  check(se.length === 5, "T-SLOW-ETERNAL: 5 consultas de 10 s (la última enviada a los 52 s)", String(se.length));

  const sales = calls.filter((c) => c.method === "getSales");
  check(sales.length > 0 && sales.every((c) => c.force === true), "getSales se pide sin cache");
  check(
    // El ciclo cierra cuando la siguiente consulta ya caería después de 60 s.
    sales.every((c) => c.at - start >= 57000),
    "getSales sólo después de la ventana de StatusTXN",
    sales.map((c) => secs(c.at - start)).join(", "),
  );

  // ── Después de la ventana: la UI automática no llama al proveedor ────────
  const missingId = ids["T-ETERNAL-MISSING"];
  const statusBefore = statusCalls("T-ETERNAL-MISSING").length;
  let before = calls.length;
  await svc.checkTransaction({ transactionId: missingId });
  await sleep(200);
  check(calls.length === before, "revisión automática de la UI no consulta a Taecel antes de su turno");
  await svc.checkTransaction({ transactionId: missingId, manual: true });
  let after = calls.slice(before);
  check(
    after.length > 0 && after.every((c) => c.method === "getSales"),
    "Reintentar manual usa getSales, no StatusTXN",
    after.map((c) => c.method).join(","),
  );

  // ── Agenda de getSales: el poller la recorre sin volver a StatusTXN ──────
  const tickOnce = async () => {
    svc.startPoller({ intervalMs: 600000 });
    await sleep(400);
    svc.stopPoller();
  };
  const ageTo = (id, sec) =>
    db
      .prepare(
        "UPDATE service_transactions SET requested_at = datetime('now', ?), next_check_at = datetime('now','-1 seconds') WHERE id = ?",
      )
      .run(`-${sec} seconds`, id);

  ageTo(missingId, 100);
  before = calls.length;
  await tickOnce();
  after = calls.slice(before);
  check(after.length > 0 && after.every((c) => c.method === "getSales"), "a los 90 s: getSales", after.map((c) => c.method).join(","));
  check(row(missingId).status === "pending" && followSlot(missingId) === 210, "sin final: siguiente getSales a los 3.5 min", String(followSlot(missingId)));

  ageTo(missingId, 520);
  await tickOnce();
  check(row(missingId).status === "pending" && followSlot(missingId) === 1110, "a los 8.5 min: siguiente getSales a los 18.5 min", String(followSlot(missingId)));

  ageTo(missingId, 1120);
  await tickOnce();
  const done = row(missingId);
  check(
    done.status === "unknown" && done.review_reason === "TIMEOUT_60S",
    "agotada la agenda sin final: queda para revisión",
    `${done.status}/${done.review_reason}`,
  );
  check(statusCalls("T-ETERNAL-MISSING").length === statusBefore, "en todo el seguimiento no hubo más StatusTXN");

  before = calls.length;
  await svc.checkTransaction({ transactionId: missingId });
  check(calls.length === before, "ya en revisión, la UI automática no consulta a Taecel");

  // Aparece exitosa en el listado durante el seguimiento → se aplica.
  const lateId = insertPending("T-LATE");
  scripts["T-LATE"] = [[pending, 100]];
  ageTo(lateId, 95);
  salesRows[1].push({ ...applied("T-LATE"), transId: "T-LATE", amountCents: 1000 });
  await tickOnce();
  check(statusCalls("T-LATE").length === 0, "T-LATE: pasada la ventana no usa StatusTXN");
  check(row(lateId).status === "applied", "T-LATE: getSales posterior la confirma exitosa", row(lateId).status);

  // ── Pendiente vieja (p. ej. tras reiniciar): directo a getSales ──────────
  const oldId = insertPending("T-ETERNAL-MISSING-OLD");
  scripts["T-ETERNAL-MISSING-OLD"] = [[pending, 100]];
  ageTo(oldId, 300);
  await svc.checkTransaction({ transactionId: oldId });
  await sleep(500);
  check(statusCalls("T-ETERNAL-MISSING-OLD").length === 0, "pendiente de hace 5 min no vuelve a StatusTXN");
  check(
    row(oldId).status === "pending" && followSlot(oldId) === 510,
    "pendiente de hace 5 min: getSales y siguiente a los 8.5 min",
    `${row(oldId).status}/${followSlot(oldId)}`,
  );

  clearInterval(keepAlive);
  console.log(`\n${pass} PASS, ${fail} FAIL (${secs(Date.now() - T0)})`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
