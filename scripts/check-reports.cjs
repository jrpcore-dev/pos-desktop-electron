"use strict";
/*
 * Reportes que ayudan a decidir (src/main/reports-core.js).
 *
 *   A) Movimiento: unidades por día del periodo contra el periodo anterior,
 *      mejor día, cobertura de stock; las ventas canceladas no cuentan.
 *   B) La lista de los más vendidos trae su periodo en miniatura.
 *   C) Lista de compra: lo que no alcanza hasta la entrega que sigue a la
 *      próxima; urgente si se acaba antes de la próxima; cajas si las hay.
 *   D) Días de entrega: próxima y siguiente, y su etiqueta.
 *
 * Uso:
 *   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-reports.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const fixture = require("./db-fixture");
const rc = require(path.join(fixture.REPO, "src/main/reports-core.js"));

const TMP = path.join(os.tmpdir(), "opencode", `check-reports-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });

let pass = 0;
let fail = 0;
const check = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  }
};

const db = fixture.createFileDb(path.join(TMP, "host.db"));
// Hoy (México): miércoles 11 nov 2026. Semana: lun 9 → dom 15.
const TODAY = "2026-11-11";
db.prepare("INSERT INTO suppliers (id, name, delivery_days, phone) VALUES (1, 'Refrescos', 'lun,jue', '9991234567'), (2, 'Pan', 'lun,mar,mie,jue,vie,sab,dom', '')").run();
db.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active, supplier_id, cost_price, box_qty) VALUES (1, '1', 'Coca', 18, 2, 'piece', 1, 1, 12, 12)").run();
db.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active, supplier_id, cost_price) VALUES (2, '2', 'Pan', 40, 100, 'piece', 1, 2, 25)").run();
db.prepare("INSERT INTO products (id, barcode, name, price, stock, sale_unit, is_active, cost_price) VALUES (3, '3', 'Chicle', 2, 1, 'piece', 1, 1)").run();

let saleId = 0;
// Venta a mediodía de México (18:00 UTC) de `qty` piezas del producto.
const sell = (mxDate, productId, qty, status = null) => {
  saleId += 1;
  db.prepare("INSERT INTO sales (id, total, payment_method, created_at, status, folio) VALUES (?, ?, 'cash', ?, ?, ?)").run(
    saleId,
    qty * 10,
    `${mxDate} 18:00:00`,
    status,
    `T-${saleId}`,
  );
  db.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, stock_deducted) VALUES (?, ?, ?, 10, ?)").run(
    saleId,
    productId,
    qty,
    qty,
  );
};
// Semana anterior (lun 2 → dom 8) y esta (lun 9 → mié 11).
sell("2026-11-02", 1, 4);
sell("2026-11-03", 1, 6);
sell("2026-11-09", 1, 5);
sell("2026-11-10", 1, 9);
sell("2026-11-10", 1, 50, "cancelado"); // no cuenta
sell("2026-11-11", 1, 2);
sell("2026-11-10", 2, 1);
// Ritmo reciente del chicle: 28 en 28 días → 1 por día.
for (let i = 1; i <= 28; i++) sell(rc.addDays(TODAY, -i), 3, 1);

console.log("=== A · movimiento de un producto ===");
const m = rc.productMovement(db, { startDate: "2026-11-09", endDate: "2026-11-15", productId: 1, today: TODAY });
check(m.success === true && m.selected && m.selected.id === 1, "trae el producto elegido", m.selected && m.selected.name);
const days = m.selected.days;
check(days.length === 7 && days[0].label === "Lun" && days[6].label === "Dom", "siete días, de lunes a domingo", days.map((d) => d.label));
check(days[0].units === 5 && days[1].units === 9 && days[2].units === 2, "unidades por día (la cancelada no cuenta)", days.map((d) => d.units));
check(days[0].prev === 4 && days[1].prev === 6, "contra los mismos días de la semana anterior", days.map((d) => d.prev));
check(m.selected.total === 16 && m.selected.prevTotal === 10, "totales del periodo y del anterior", [m.selected.total, m.selected.prevTotal]);
check(m.selected.best && m.selected.best.label === "Mar" && m.selected.best.units === 9, "su mejor día", m.selected.best);
check(days[3].future === true && days[2].future === false, "los días que no han pasado se marcan");
check(m.selected.coverDays != null && m.selected.coverDays > 0, "para cuántos días le alcanza el stock", m.selected.coverDays);

console.log("=== B · la lista de los más vendidos ===");
const all = rc.productMovement(db, { startDate: "2026-11-09", endDate: "2026-11-15", today: TODAY });
check(all.selected && all.selected.id === 1, "sin elegir, empieza por el más vendido", all.selected && all.selected.name);
const coca = all.rows.find((r) => r.id === 1);
check(coca && coca.days.length === 7 && coca.days[1] === 9 && coca.prevTotal === 10, "cada fila trae su semana en miniatura y el anterior", coca);

console.log("=== C · lista de compra sugerida ===");
const s = rc.purchaseSuggestions(db, { today: TODAY });
const chicle = s.items.find((i) => i.productId === 3);
check(chicle && chicle.urgent === true, "el chicle se acaba antes de la próxima entrega: urgente", chicle);
check(chicle && chicle.supplierName === "Sin proveedor" && chicle.delivery === null, "sin proveedor: entrega semanal", chicle && chicle.delivery);
const pan = s.items.find((i) => i.productId === 2);
check(!pan, "el pan alcanza hasta la siguiente entrega: no se pide");
const cocaS = s.items.find((i) => i.productId === 1);
check(cocaS && /caja/.test(cocaS.order), "con caja, se sugiere en cajas", cocaS && cocaS.order);
check(s.items[0].daysLeft <= s.items[s.items.length - 1].daysLeft, "ordenada por lo que se acaba primero");

console.log("=== D · días de entrega ===");
const w = rc.deliveryWindow("lun,jue", TODAY);
check(w.next === 1 && w.following === 5 && w.label === "lun y jue", "miércoles → jueves (1) y lunes (5)", w);
check(rc.deliveryWindow("lun,mar,mie,jue,vie,sab,dom", TODAY).label === "diario", "todos los días = diario");

console.log(`\n=== reportes: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
