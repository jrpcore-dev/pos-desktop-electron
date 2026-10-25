export const calcFinalPrice = (price, discount) =>
  price * (1 - (discount || 0) / 100);

// Precio especial del cliente (excepción o nivel) para el producto, o null.
export const customerPriceOf = (product, pricing) => {
  if (!product || typeof product.id !== "number" || !pricing) return null;
  const ex = pricing.exceptions && pricing.exceptions[product.id];
  if (ex != null) return ex;
  const tp = pricing.tierPrices && pricing.tierPrices[product.id];
  if (tp != null) return tp;
  return null;
};

export const resolveUnitPrice = (product, pricing) =>
  customerPriceOf(product, pricing) ?? product?.price;

// El precio especial se captura sobre `product.price`: por pieza (o kilo), y
// por paquete en caja·paquete·pieza. Sólo aplica a esa unidad; una caja nunca
// se cobra al precio especial de una pieza.
export const customerPriceForLine = (product, pricing, { isBox, isPack } = {}) => {
  const special = customerPriceOf(product, pricing);
  if (special == null || isBox) return null;
  const priceIsPack = product.sale_unit === "boxpack";
  return !!isPack === priceIsPack ? special : null;
};

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Vigencia global de la promoción. Fechas vacías = vigente siempre.
export const promoActiveNow = (item) => {
  const t = todayISO();
  const start = item.promo_start_date || "";
  const end = item.promo_end_date || "";
  if (start && t < start) return false;
  if (end && t > end) return false;
  return true;
};

export const canManualDiscount = (item) => {
  if (item.allow_manual_discount !== 1) return false;
  if (!promoActiveNow(item)) return true;
  // Con precio de cliente sólo pueden correr mayoreo/combos (ver promoInfo).
  if (item.customerPriced) return (item.prices || []).length === 0;
  if (item.discount_percent > 0) return false;
  if (item.promo_fixed_price > 0) return false;
  if ((item.prices || []).length > 0) return false;
  return true;
};

export const lineKeyOf = (item) =>
  `${item.id}:${item.isWeightItem ? "w" : item.isBoxItem ? "b" : item.isPackItem ? "p" : "s"}`;

export const packPriceOf = (p) =>
  p.sale_unit === "boxpack" ? p.price : p.pack_price;
export const piecePriceOf = (p) =>
  p.sale_unit === "boxpack" ? p.pack_price : p.price;

export const promoInfo = (item, qty) => {
  const active = promoActiveNow(item);
  // Con precio pactado con el cliente no aplican el precio fijo ni el % de la
  // promoción; el mayoreo y los combos sí compiten y se cobra lo más bajo.
  const customer = !!item.customerPriced;
  const autoOn =
    !customer &&
    active &&
    (item.discount_percent > 0 || item.promo_fixed_price > 0);

  if (!customer && active && item.promo_fixed_price > 0) {
    const unit = item.promo_fixed_price;
    return { total: unit * qty, unit, applied: { type: "fijo", qty: 0, price: unit } };
  }

  const baseUnit =
    !customer && active && item.discount_percent > 0
      ? calcFinalPrice(item.price, item.discount_percent)
      : item.price;
  const baseTotal = baseUnit * qty;
  const prices = active && !autoOn ? item.prices : [];
  if (
    item.isBoxItem ||
    item.isPackItem ||
    item.isWeightItem ||
    !prices ||
    prices.length === 0
  ) {
    return { total: baseTotal, unit: baseUnit, applied: null };
  }
  let best = { total: baseTotal, unit: baseUnit, applied: null };
  for (const e of prices) {
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