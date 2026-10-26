#!/usr/bin/env node
// Motor de promociones del carrito (src/renderer/utils/cartMath.js): promos
// por cantidad por unidad, lleva y paga, pieza N al %, categoría/marca,
// paquetes y su convivencia con el precio de cliente. Node puro.
//
// Uso: node scripts/check-promos.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// cartMath.js es ESM dentro de un paquete CommonJS: se carga como data: URL.
const src = fs.readFileSync(path.join(ROOT, "src/renderer/utils/cartMath.js"), "utf8");
const m = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);

let failed = 0;
const eq = (name, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` → ${got} (esperado ${want})`}`);
};
const is = (name, cond) => {
  if (!cond) failed += 1;
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
};

const item = (over = {}) => ({
  id: 1,
  price: 18,
  sale_unit: "piece",
  discount_percent: 0,
  promo_fixed_price: 0,
  prices: [],
  quantity: 1,
  ...over,
});
const total = (it) => m.lineTotal(it, it.quantity);

// ── promos por cantidad ──────────────────────────────────────────────────
const lp = item({ prices: [{ type: "llevapaga", qty: 3, price: 2, unit: "piece" }] });
eq("3×2 con 3 piezas", total({ ...lp, quantity: 3 }), 36);
eq("3×2 con 4 piezas (1 suelta)", total({ ...lp, quantity: 4 }), 54);
eq("3×2 con 2 piezas (no alcanza)", total({ ...lp, quantity: 2 }), 36);

const pn = item({ prices: [{ type: "piezan", qty: 2, price: 50, unit: "piece" }] });
eq("2ª al 50% con 2", total({ ...pn, quantity: 2 }), 27);
eq("2ª al 50% con 3", total({ ...pn, quantity: 3 }), 45);
eq("2ª al 50% con 4", total({ ...pn, quantity: 4 }), 54);

const legacy = item({ prices: [{ type: "combo", qty: 3, price: 50 }] });
eq("combo viejo sin unidad aplica a pieza", total({ ...legacy, quantity: 3 }), 50);

const boxTier = item({
  sale_unit: "box",
  prices: [{ type: "mayoreo", qty: 3, price: 190, unit: "box" }],
});
eq("mayoreo por caja en renglón de caja", total({ ...boxTier, price: 200, isBoxItem: true, quantity: 3 }), 570);
eq("mayoreo por caja NO aplica a piezas", total({ ...boxTier, quantity: 3 }), 54);

const kg = item({
  sale_unit: "weight",
  price: 48,
  isWeightItem: true,
  prices: [{ type: "mayoreo", qty: 2, price: 42, unit: "weight" }],
});
eq("mayoreo por kilo con 2.5 kg", total({ ...kg, quantity: 2.5 }), 105);
eq("mayoreo por kilo con 1.5 kg (no alcanza)", total({ ...kg, quantity: 1.5 }), 72);

const best = item({
  prices: [
    { type: "mayoreo", qty: 6, price: 15, unit: "piece" },
    { type: "llevapaga", qty: 3, price: 2, unit: "piece" },
  ],
});
eq("varias promos: se cobra la más barata (3×2 gana a mayoreo)", total({ ...best, quantity: 6 }), 72);

// ── categoría / marca ────────────────────────────────────────────────────
const engine = (over = {}) => ({ enabled: true, groupPromos: [], bundles: [], ...over });
const g15 = { id: 1, scope: "category", category_id: 7, percent: 15, is_active: 1, name: "Limpieza" };
const [fab] = m.applyPromotions([item({ price: 35, category_id: 7, quantity: 1 })], engine({ groupPromos: [g15] }));
eq("−15% de categoría", total(fab), 29.75);
is("etiqueta de categoría", m.promoLabel(m.linePromo(fab)) === "-15% Limpieza");

const [own] = m.applyPromotions(
  [item({ price: 35, category_id: 7, discount_percent: 20, has_discount: 1, quantity: 1 })],
  engine({ groupPromos: [g15] }),
);
eq("no se acumula: gana el 20% propio sobre el 15%", total(own), 28);

const [cli] = m.applyPromotions(
  [item({ price: 30, category_id: 7, customerPriced: true, quantity: 1 })],
  engine({ groupPromos: [g15] }),
);
eq("precio de cliente: la promo de categoría no aplica", total(cli), 30);

const brand = { id: 2, scope: "brand", brand: "Bimbo", percent: 10, is_active: 1, name: "" };
const [bim] = m.applyPromotions([item({ price: 40, brand: "bimbo ", quantity: 1 })], engine({ groupPromos: [brand] }));
eq("marca sin importar mayúsculas/espacios", total(bim), 36);

const venc = { ...g15, end_date: "2000-01-01" };
const [old] = m.applyPromotions([item({ price: 35, category_id: 7, quantity: 1 })], engine({ groupPromos: [venc] }));
eq("promo vencida no aplica", total(old), 35);

const [off] = m.applyPromotions([item({ price: 35, category_id: 7, quantity: 1 })], engine({ enabled: false, groupPromos: [g15] }));
eq("promociones avanzadas apagadas: no aplica", total(off), 35);

// ── paquetes ─────────────────────────────────────────────────────────────
const desayuno = {
  id: 1,
  name: "Desayuno",
  price: 50,
  is_active: 1,
  slots: [
    { slot: 0, qty: 1, products: [{ id: 10 }] },
    { slot: 1, qty: 1, products: [{ id: 20 }, { id: 21 }] },
  ],
};
const torta = (q) => item({ id: 10, price: 42, quantity: q });
const coca = (q) => item({ id: 20, price: 20, quantity: q });
const sprite = (q) => item({ id: 21, price: 18, quantity: q });
const sum = (cart) => cart.reduce((s, it) => s + total(it), 0);

const c1 = m.applyPromotions([torta(1), coca(1)], engine({ bundles: [desayuno] }));
eq("paquete completo: torta + refresco = $50", sum(c1), 50);
is("renglones marcados con el paquete", c1.every((it) => it.bundleLabel === "Desayuno"));
eq("reparto proporcional (torta 42/62 de 50)", total(c1[0]), (50 * 42) / 62);

eq("2 tortas + 1 refresco: 1 paquete + 1 torta suelta", sum(m.applyPromotions([torta(2), coca(1)], engine({ bundles: [desayuno] }))), 92);
eq("2 tortas + 2 refrescos: 2 paquetes", sum(m.applyPromotions([torta(2), coca(2)], engine({ bundles: [desayuno] }))), 100);
eq("alternativa del lugar (Sprite en vez de Coca)", sum(m.applyPromotions([torta(1), sprite(1)], engine({ bundles: [desayuno] }))), 50);
eq("prefiere la alternativa más cara (más ahorro)", sum(m.applyPromotions([torta(1), coca(1), sprite(1)], engine({ bundles: [desayuno] }))), 68);
eq("falta un producto: sin paquete", sum(m.applyPromotions([torta(1)], engine({ bundles: [desayuno] }))), 42);

const caro = { ...desayuno, price: 70 };
eq("paquete más caro que por separado: no se aplica", sum(m.applyPromotions([torta(1), coca(1)], engine({ bundles: [caro] }))), 62);

const cajaTorta = { ...torta(1), isBoxItem: true };
eq("renglones de caja no entran a paquetes", sum(m.applyPromotions([cajaTorta, coca(1)], engine({ bundles: [desayuno] }))), 62);

// El Host valida Σ finalPrice × qty contra el total: el reparto debe cuadrar.
const mixed = m.applyPromotions([torta(3), coca(2), sprite(1)], engine({ bundles: [desayuno], groupPromos: [g15] }));
const viaUnit = mixed.reduce((s, it) => s + m.lineUnitPrice(it, it.quantity) * it.quantity, 0);
eq("Σ precio unitario × cantidad = total del carrito", viaUnit, sum(mixed));

is("canManualDiscount bloqueado en renglón con paquete", !m.canManualDiscount({ ...c1[0], allow_manual_discount: 1 }));

console.log(failed ? `\n${failed} fallaron` : "\nOK");
process.exit(failed ? 1 : 0);
