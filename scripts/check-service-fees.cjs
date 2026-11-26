"use strict";
/*
 * Servicios · comisión de la tienda.
 *
 *   - la comisión se configura por tipo y por compañía (0 explícito = sin
 *     comisión para esa compañía) y el catálogo sale con `feeCents`;
 *   - si la caja mandó otra comisión que la vigente, no se pide nada a Taecel;
 *   - a Taecel sólo viaja el importe; la venta lleva el importe enlazado al
 *     ledger y la comisión como renglón aparte con costo 0;
 *   - el pendiente de caja suma importe + comisión.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-service-fees.cjs
 */
const path = require("path");
const { randomUUID } = require("crypto");
const fixture = require("./db-fixture");

const { createServiceTransactions } = require(path.join(fixture.REPO, "src/main/service-transactions.js"));

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

const CATALOG = {
  ok: true,
  operators: [
    {
      id: "CFE",
      key: "CFE",
      name: "CFE",
      categoryId: 3,
      freeAmount: true,
      input: { numeric: true, min: 30, max: 30 },
      products: [{ sku: "CFE", name: "CFE", categoryId: 3, amountCents: 0 }],
    },
    {
      id: "TEL",
      key: "TEL",
      name: "Telcel",
      categoryId: 1,
      input: { numeric: true, min: 10, max: 10 },
      products: [
        { sku: "TEL050", name: "Telcel $50", categoryId: 1, amountCents: 5000 },
        { sku: "TEL100", name: "Telcel $100", categoryId: 1, amountCents: 10000 },
      ],
    },
    {
      id: "TMX",
      key: "TMX",
      name: "Telmex",
      categoryId: 3,
      freeAmount: true,
      input: { numeric: true, min: 10, max: 10 },
      products: [{ sku: "TMX", name: "Telmex", categoryId: 3, amountCents: 0 }],
    },
  ],
};

const requests = [];
let nextTrans = 1;
const fakeTaecel = {
  getCatalog: async () => CATALOG,
  encryptReference: (s) => "enc:" + s,
  decryptReference: (s) => s?.slice(4),
  requestTxn: async (args) => {
    requests.push(args);
    if (args.reference === "9991230000") return { ok: false, kind: "failed" };
    return { ok: true, transId: "T" + nextTrans++, message: "ok" };
  },
  statusTxn: async (transId) => ({
    ok: true,
    status: "applied",
    rawStatus: "Exitosa",
    message: "Transacción Exitosa",
    transId,
    folio: "F" + transId,
  }),
  getSales: async () => ({ ok: true, sales: [] }),
  rememberBalanceFromStatus: () => {},
};

const db = fixture.createMemoryDb();
const BOX = "box-fees";
db.prepare("INSERT INTO cashiers (id, name, role, pin, is_active) VALUES (1, 'Ana', 'cashier', '', 1)").run();
db.prepare(
  "INSERT INTO cash_register (id, date, status, cashier_id, device_id) VALUES (1, date('now'), 'open', 1, ?)",
).run(BOX);
const svc = createServiceTransactions({ db, taecel: fakeTaecel, logger: (s, e) => console.log("  log", s, e && e.message) });
const ctx = { deviceId: BOX, cashierId: 1, cashierName: "Ana", role: "cashier" };

const waitApplied = async (id) => {
  for (let i = 0; i < 60; i++) {
    const row = db.prepare("SELECT * FROM service_transactions WHERE client_request_id = ?").get(id);
    if (row && row.status === "applied") return row;
    // Consulta explícita: no depende de que el ciclo automático ya corriera.
    await svc.checkTransaction({ clientRequestId: id, manual: true }).catch(() => {});
    await sleep(100);
  }
  return db.prepare("SELECT * FROM service_transactions WHERE client_request_id = ?").get(id);
};

(async () => {
  console.log("=== Servicios · comisión de la tienda ===");

  const empty = svc.getFees();
  check(empty.ok && empty.fees.byCategory.servicios === 0, "sin configurar, la comisión es 0");

  svc.setFees({ fees: { byCategory: { servicios: 1500, recargas: -3 }, byCarrier: { TMX: 0 } } });
  const fees = svc.getFees().fees;
  check(fees.byCategory.servicios === 1500 && fees.byCategory.recargas === 0, "por tipo: negativos quedan en 0", JSON.stringify(fees));
  check(fees.byCarrier.TMX === 0, "un 0 explícito por compañía se guarda");

  const cat = svc.withFees(CATALOG);
  const fee = (id) => cat.operators.find((o) => o.id === id).feeCents;
  check(fee("CFE") === 1500 && fee("TEL") === 0 && fee("TMX") === 0, "el catálogo sale con la comisión de cada compañía", `${fee("CFE")}/${fee("TEL")}/${fee("TMX")}`);

  const ref = "0".repeat(29) + "1";
  const stale = await svc.createRecharge(
    { clientRequestId: "fee-stale", productCode: "CFE", reference: ref, amountCents: 45000, feeCents: 1000 },
    ctx,
  );
  check(stale.code === "FEE_CHANGED" && stale.feeCents === 1500, "comisión distinta a la vigente: se rechaza", stale.code);
  const staleRow = db.prepare("SELECT 1 FROM service_transactions WHERE client_request_id = 'fee-stale'").get();
  check(!staleRow && requests.length === 0, "y no se pide nada a Taecel ni queda en el ledger");

  const ok = await svc.createRecharge(
    { clientRequestId: "fee-cfe", productCode: "CFE", reference: ref, amountCents: 45000, feeCents: 1500 },
    ctx,
  );
  check(ok.ok && ok.quote && ok.quote.totalCents === 46500, "la respuesta trae importe + comisión", JSON.stringify(ok.quote));
  check(requests[0] && requests[0].amountCents === 45000, "a Taecel sólo viaja el importe", requests[0] && requests[0].amountCents);

  const row = await waitApplied("fee-cfe");
  check(row && row.status === "applied" && row.fee_cents === 1500, "el ledger guarda la comisión", row && `${row.status}/${row.fee_cents}`);
  const sale = row && row.sale_id ? db.prepare("SELECT total FROM sales WHERE id = ?").get(row.sale_id) : null;
  check(sale && Math.abs(sale.total - 465) < 0.001, "la venta cobra importe + comisión", sale && sale.total);
  const items = row
    ? db.prepare("SELECT product_name, price_at_sale, service_transaction_id, cost_at_sale FROM sale_items WHERE sale_id = ? ORDER BY id").all(row.sale_id)
    : [];
  check(items.length === 2, "dos renglones: importe y comisión", items.length);
  check(items[0] && items[0].price_at_sale === 450 && items[0].service_transaction_id === row.id, "el importe queda enlazado al ledger");
  check(
    items[1] && items[1].price_at_sale === 15 && items[1].service_transaction_id === null && items[1].cost_at_sale === 0,
    "la comisión va aparte, sin enlace y con costo 0",
    JSON.stringify(items[1]),
  );
  check(items[0] && /^Pago CFE/.test(items[0].product_name), "un pago de servicio no se llama «Recarga»", items[0] && items[0].product_name);

  const tel = await svc.createRecharge(
    { clientRequestId: "fee-tel", productCode: "TEL050", reference: "9991234567", feeCents: 0 },
    ctx,
  );
  const telRow = await waitApplied("fee-tel");
  const telItems = db.prepare("SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ?").get(telRow.sale_id).n;
  check(tel.ok && telRow.fee_cents === 0 && telItems === 1, "sin comisión: un solo renglón como antes");

  const feeRules = {
    byCategory: { recargas: 500, servicios: 1500 },
    byCarrier: { TEL: 700 },
  };
  svc.setFees({ fees: { ...feeRules, airtimeFeeWaiverCents: 10000 } });
  // Una caja anterior guarda las tarifas sin conocer el nuevo campo.
  svc.setFees({ fees: feeRules });
  const withWaiver = svc.withFees(CATALOG);
  const telOperator = withWaiver.operators.find((op) => op.id === "TEL");
  const cfeOperator = withWaiver.operators.find((op) => op.id === "CFE");
  check(telOperator.feeWaiverCents === 10000 && telOperator.feeCents === 700,
    "el catálogo conserva el límite y la tarifa de compañía");
  check(cfeOperator.feeWaiverCents === 0 && cfeOperator.feeCents === 1500,
    "los pagos de servicios conservan su comisión");

  const below = await svc.createRecharge(
    { clientRequestId: "waiver-below", productCode: "TEL050", reference: "9991234567", feeCents: 700 },
    ctx,
  );
  const belowRow = await waitApplied("waiver-below");
  check(below.ok && belowRow?.fee_cents === 700, "por debajo de $100 se cobra la comisión de compañía");

  const staleWaiver = await svc.createRecharge(
    { clientRequestId: "waiver-stale", productCode: "TEL100", reference: "9991234567", feeCents: 700 },
    ctx,
  );
  check(staleWaiver.code === "FEE_CHANGED" && staleWaiver.feeCents === 0,
    "se rechaza la comisión de una caja con catálogo desactualizado");
  const atLimit = await svc.createRecharge(
    { clientRequestId: "waiver-exact", productCode: "TEL100", reference: "9991234567", feeCents: 0 },
    ctx,
  );
  const atLimitRow = await waitApplied("waiver-exact");
  check(atLimit.ok && atLimitRow?.fee_cents === 0, "el límite de $100 se aplica de forma inclusiva");
  svc.setFees({ fees: { ...feeRules, airtimeFeeWaiverCents: 0 } });
  check(svc.getFees().fees.airtimeFeeWaiverCents === 0, "borrar el límite recupera el comportamiento anterior");

  // Pendiente de caja: importe + comisión.
  db.prepare(
    `INSERT INTO service_transactions (client_request_id, ref_cte, provider, status, category_id, product_code, amount_cents, fee_cents, register_id, requested_at, updated_at)
     VALUES ('fee-pend', 'RPEND', 'taecel', 'unknown', 3, 'CFE', 20000, 1500, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run();
  const pend = svc.pendingSummary(1);
  check(pend.totalCents === 21500, "el pendiente de caja suma la comisión", pend.totalCents);

  const mixed = {
    saleKey: randomUUID(),
    paymentMethod: "card",
    total: 87,
    cart: [
      { isManual: true, name: "Producto", quantity: 2, price: 15 },
      { price: 57, recharge: { productCode: "TEL050", reference: "9991234567", amountCents: 5000, feeCents: 700 } },
    ],
  };
  const beforeMixed = requests.length;
  const invalid = await svc.createMixedSale({ ...mixed, total: 80 }, ctx);
  check(!invalid.success && requests.length === beforeMixed, "una venta rechazada no envía la recarga");
  check(!db.prepare("SELECT 1 FROM service_transactions WHERE client_request_id = ?").get(mixed.saleKey + "-0"),
    "si la venta falla, la recarga tampoco queda en el ledger");
  const [first, duplicate] = await Promise.all([
    svc.createMixedSale(mixed, ctx), svc.createMixedSale(mixed, ctx),
  ]);
  const applied = await waitApplied(mixed.saleKey + "-0");
  check(first.success && duplicate.saleId === first.saleId && requests.length === beforeMixed + 1,
    "un doble envío del cobro registra y despacha una sola vez", JSON.stringify(first));
  check(applied?.sale_id === first.saleId && applied?.status === "applied",
    "confirmar la recarga conserva el folio de la venta mixta");
  const mixedItems = db.prepare(
    "SELECT price_at_sale, service_transaction_id FROM sale_items WHERE sale_id = ? ORDER BY id",
  ).all(first.saleId);
  check(mixedItems.length === 2 && mixedItems[1]?.service_transaction_id === applied?.id &&
    mixedItems[1]?.price_at_sale === 57, "producto y recarga quedan en una venta, con la comisión incluida");
  const rejected = await svc.createMixedSale({
    ...mixed, saleKey: randomUUID(),
    cart: [mixed.cart[0], {
      ...mixed.cart[1], recharge: { ...mixed.cart[1].recharge, reference: "9991230000" },
    }],
  }, ctx);
  const rejectedStatus = await svc.checkTransaction({ transactionId: rejected.recharges?.[0]?.id });
  check(rejected.success && rejectedStatus.transaction?.status === "failed" &&
    rejectedStatus.transaction?.refundDueCents === 5700,
    "el rechazo informa cuánto devolver y conserva el folio cobrado");

  svc.stopPoller();
  console.log(`\n=== Comisión: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
