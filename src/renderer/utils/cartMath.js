export const calcFinalPrice = (price, discount) =>
  price * (1 - (discount || 0) / 100);

export const canManualDiscount = (item) =>
  !!item.has_discount &&
  item.discount_percent <= 0 &&
  !(item.prices && item.prices.length > 0);

export const lineKeyOf = (item) =>
  `${item.id}:${item.isWeightItem ? "w" : item.isBoxItem ? "b" : item.isPackItem ? "p" : "s"}`;

export const packPriceOf = (p) =>
  p.sale_unit === "boxpack" ? p.price : p.pack_price;
export const piecePriceOf = (p) =>
  p.sale_unit === "boxpack" ? p.pack_price : p.price;

export const promoInfo = (item, qty) => {
  const baseUnit = calcFinalPrice(item.price, item.discount_percent);
  const baseTotal = baseUnit * qty;
  if (
    item.isBoxItem ||
    item.isPackItem ||
    item.isWeightItem ||
    !item.prices ||
    item.prices.length === 0
  ) {
    return { total: baseTotal, unit: baseUnit, applied: null };
  }
  let best = { total: baseTotal, unit: baseUnit, applied: null };
  for (const e of item.prices) {
    let t;
    if (e.type === "mayoreo") {
      if (qty < e.qty) continue;
      t = qty * e.price;
    } else {
      if (qty < e.qty) continue;
      const combos = Math.floor(qty / e.qty);
      const rest = qty % e.qty;
      t = combos * e.price + rest * baseUnit;
    }
    if (t < best.total - 1e-9) best = { total: t, unit: t / qty, applied: e };
  }
  return best;
};

export const lineTotal = (item, qty) =>
  promoInfo(item, qty).total - (item.discount || 0);

export const lineUnitPrice = (item, qty) =>
  qty > 0 ? lineTotal(item, qty) / qty : 0;

export const committedStockFor = (product, items) =>
  items.reduce((sum, it) => {
    if (it.id !== product.id) return sum;
    if (it.isWeightItem) return sum + it.quantity;
    if (it.isBoxItem) return sum + it.quantity * (it.box_qty || 1);
    if (it.isPackItem) return sum + it.quantity * (it.pack_qty || 1);
    return sum + it.quantity;
  }, 0);