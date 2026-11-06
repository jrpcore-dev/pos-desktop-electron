"use strict";
/*
 * Ventas sin subir: la caja las ve en Caja y Transacciones aunque el Host esté
 * caído, marcadas como pendientes y sin duplicarse cuando llegan por la réplica.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-pending-sales-view.cjs
 */
const path = require("path");
const fixture = require("./db-fixture");

const REPO = fixture.REPO;
const activation = require(path.join(REPO, "src/main/activation.js"));
const offlineQueue = require(path.join(REPO, "src/main/offline-queue.js"));
const boxRpc = require(path.join(REPO, "src/main/box-rpc-client.js"));

let failed = 0;
const check = (ok, label, extra) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failed += 1;
};

const db = fixture.createMemoryDb();
activation.setSetting(db, "box_device_id", "box-1");
activation.setSetting(db, "box_device_code", "B");

const queue = (folio, overrides = {}) =>
  offlineQueue.enqueue(db, {
    folio,
    idempotencyKey: `key-${folio}`,
    registerId: 7,
    cashierId: 1,
    cashierName: "Ana",
    localCreatedAt: "2026-11-06T18:00:00.000Z",
    payload: {
      total: 100,
      paymentMethod: "cash",
      discountTotal: 5,
      cart: [{ id: 3, name: "Refresco", quantity: 2, price: 25, finalPrice: 50 }],
    },
    ...overrides,
  });

const first = queue("B-0001");
queue("B-0002", { registerId: 8 });

const hostList = { success: true, sales: [{ id: 1, folio: "H-0001", total: 40 }] };
const today = boxRpc.withPendingSales(db, "get-sales-for-today", hostList, { registerId: 7 });
check(today.sales.length === 2, "Caja: suma la venta del mismo turno y no la de otro", today.sales);
const row = today.sales[0];
check(row.pending === "pending" && row.folio === "B-0001", "la venta va marcada y con su folio", row);
check(row.total === 100 && row.payment_method === "cash", "conserva total y método: cuenta en el efectivo", row);
check(row.can_cancel === 0, "no se puede cancelar");
check(row.products[0].name === "Refresco" && row.products[0].qty === 2, "muestra sus productos", row.products);
check(row.items[0].price_at_sale === 50, "el precio es el final, con descuento", row.items);
check(row.created_at === "2026-11-06 18:00:00", "fecha con el formato de las ventas", row.created_at);

const range = boxRpc.withPendingSales(
  db,
  "get-sales-by-range",
  { success: true, sales: [], total: 40, count: 1, byMethod: [{ payment_method: "cash", count: 1, total: 40 }] },
  { startDate: "2026-11-06", endDate: "2026-11-06" },
);
check(range.sales.length === 2, "Transacciones: entran las del rango", range.sales);
check(range.total === 240 && range.count === 3, "los totales las incluyen", { total: range.total, count: range.count });
check(range.byMethod[0].count === 3 && range.byMethod[0].total === 240, "el desglose por método también", range.byMethod);

const outside = boxRpc.withPendingSales(
  db,
  "get-sales-by-range",
  { success: true, sales: [] },
  { startDate: "2026-11-01", endDate: "2026-11-02" },
);
check(outside.sales.length === 0, "fuera del rango no aparecen");
const otherBox = boxRpc.withPendingSales(db, "get-sales-by-range", { success: true, sales: [] }, { deviceId: "box-2" });
check(otherBox.sales.length === 0, "filtrando por otra caja no aparecen");
const failure = { success: false, error: "x" };
check(boxRpc.withPendingSales(db, "get-sales-for-today", failure, {}) === failure, "un error se devuelve tal cual");

const details = boxRpc.pendingSaleDetails(db, `pending-${first.id}`);
check(details.success && details.items.length === 1 && details.sale.folio === "B-0001", "el detalle abre sin Host", details);

// Subida: sigue visible hasta que llega por la réplica y entonces no se duplica.
offlineQueue.markSynced
  ? offlineQueue.markSynced(db, first.id)
  : db.prepare("UPDATE pending_sales SET status = 'synced' WHERE id = ?").run(first.id);
const synced = boxRpc.withPendingSales(db, "get-sales-for-today", hostList, { registerId: 7 });
check(synced.sales.length === 2, "ya subida pero sin replicar: no desaparece", synced.sales);
db.prepare("INSERT INTO sales (id, folio, total, payment_method) VALUES (50, 'B-0001', 100, 'cash')").run();
const arrived = boxRpc.withPendingSales(db, "get-sales-for-today", hostList, { registerId: 7 });
check(arrived.sales.length === 1, "al llegar por la réplica no se duplica", arrived.sales);

const c = queue("B-0003");
db.prepare("UPDATE pending_sales SET status = 'conflict', last_error = 'Folio' WHERE id = ?").run(c.id);
const conflict = boxRpc.withPendingSales(db, "get-sales-for-today", { success: true, sales: [] }, { registerId: 7 });
check(conflict.sales[0].pending === "conflict", "una venta en conflicto se ve en revisión", conflict.sales);
db.prepare("UPDATE pending_sales SET status = 'cancelled' WHERE id = ?").run(c.id);
const cancelled = boxRpc.withPendingSales(db, "get-sales-for-today", { success: true, sales: [] }, { registerId: 7 });
check(cancelled.sales.length === 0, "una venta quitada de la cola ya no aparece", cancelled.sales);

if (failed) {
  console.log(`\n${failed} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\nTodo OK");
process.exit(0);
