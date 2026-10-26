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
  // Ya lleva una promo avanzada (paquete o categoría/marca).
  if (item.bundleUnits > 0) return false;
  if (item.groupPromo && !item.customerPriced) return false;
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

// Renglón → unidad de las promos por cantidad (`product_prices.unit`). En
// "Paquete y pieza" el contenedor (paquete) es la línea `isBoxItem`.
export const lineUnitOf = (item) =>
  item.isWeightItem
    ? "weight"
    : item.isBoxItem
      ? "box"
      : item.isPackItem
        ? "pack"
        : "piece";

// Total de `qty` unidades con una promo por cantidad, o null si no alcanza.
//   mayoreo   → desde `qty`, cada unidad a `price`
//   combo     → cada `qty` unidades por `price`; el resto a precio normal
//   llevapaga → cada `qty` unidades se pagan `price` (2×1, 3×2)
//   piezan    → cada `qty`-ésima unidad con `price`% menos
const tierTotal = (e, qty, baseUnit) => {
  if (!(qty >= e.qty) || !(e.qty > 0)) return null;
  const sets = Math.floor(qty / e.qty + 1e-9);
  const rest = qty - sets * e.qty;
  switch (e.type) {
    case "mayoreo":
      return qty * e.price;
    case "llevapaga":
      return (sets * e.price + rest) * baseUnit;
    case "piezan":
      return qty * baseUnit - sets * baseUnit * (e.price / 100);
    default:
      return sets * e.price + rest * baseUnit;
  }
};

export const promoInfo = (item, qty) => {
  const active = promoActiveNow(item);
  // Con precio pactado con el cliente no aplican el precio fijo ni el % de la
  // promoción (propia o de categoría/marca); el mayoreo y las promos por
  // cantidad sí compiten y se cobra lo más bajo.
  const customer = !!item.customerPriced;
  const autoOn =
    !customer &&
    active &&
    (item.discount_percent > 0 || item.promo_fixed_price > 0);

  let best;
  if (!customer && active && item.promo_fixed_price > 0) {
    const unit = item.promo_fixed_price;
    best = { total: unit * qty, unit, applied: { type: "fijo", qty: 0, price: unit } };
  } else {
    const baseUnit =
      !customer && active && item.discount_percent > 0
        ? calcFinalPrice(item.price, item.discount_percent)
        : item.price;
    best = { total: baseUnit * qty, unit: baseUnit, applied: null };
    const unit = lineUnitOf(item);
    const prices =
      active && !autoOn
        ? (item.prices || []).filter((e) => (e.unit || "piece") === unit)
        : [];
    for (const e of prices) {
      const t = tierTotal(e, qty, baseUnit);
      if (t != null && t < best.total - 1e-9) {
        best = { total: t, unit: t / qty, applied: e };
      }
    }
  }

  // Promo de categoría/marca (avanzadas): compite con la propia, nunca se
  // acumula. `groupPromo` lo pone applyPromotions sólo si está vigente.
  const g = item.groupPromo;
  if (!customer && g && g.percent > 0) {
    const unit = calcFinalPrice(item.price, g.percent);
    if (unit * qty < best.total - 1e-9) {
      best = {
        total: unit * qty,
        unit,
        applied: { type: "grupo", qty: 0, price: unit, percent: g.percent, label: g.label },
      };
    }
  }
  return best;
};

// Unidades del renglón que NO entraron en un paquete.
const looseQty = (item, qty) => qty - Math.min(item.bundleUnits || 0, qty);

// Promo que se ve en el renglón (sobre lo que quedó fuera de paquetes).
export const linePromo = (item) => {
  const rest = looseQty(item, item.quantity || 0);
  return rest > 0 ? promoInfo(item, rest).applied : null;
};

export const lineTotal = (item, qty) => {
  const bundled = Math.min(item.bundleUnits || 0, qty);
  const rest = qty - bundled;
  const own = rest > 0 ? promoInfo(item, rest).total : 0;
  const share = bundled > 0 ? (item.bundleAmount || 0) * (bundled / item.bundleUnits) : 0;
  return own + share - (item.discount || 0);
};

// Etiqueta corta de una promo aplicada (carrito y ticket).
export const promoLabel = (applied) => {
  if (!applied) return null;
  switch (applied.type) {
    case "mayoreo":
      return `Mayoreo ${applied.qty}+`;
    case "fijo":
      return `Precio fijo ${fmtPlain(applied.price)}`;
    case "llevapaga":
      return `${applied.qty}×${applied.price}`;
    case "piezan":
      return `${applied.qty}ª al -${applied.price}%`;
    case "grupo":
      return `-${applied.percent}% ${applied.label || ""}`.trim();
    default:
      return `${applied.qty} por ${fmtPlain(applied.price)}`;
  }
};

const fmtPlain = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

// ─── PROMOCIONES AVANZADAS ──────────────────────────────────────────────────
// engine = { enabled, groupPromos, bundles } (get-promotions). Devuelve el
// carrito con `groupPromo` y el reparto de paquetes (`bundleUnits`,
// `bundleAmount`, `bundleLabel`) en cada renglón; sin engine o apagado, lo
// limpia. Es un derivado: el carrito guardado nunca lleva estos campos.
const isLive = (p, today) =>
  Number(p.is_active) === 1 &&
  (!p.start_date || today >= p.start_date) &&
  (!p.end_date || today <= p.end_date);

const norm = (s) => String(s || "").trim().toLowerCase();

const bestGroupPromo = (item, groups) => {
  let best = null;
  for (const g of groups) {
    const hit =
      g.scope === "brand"
        ? norm(g.brand) !== "" && norm(item.brand) === norm(g.brand)
        : g.category_id != null && Number(item.category_id) === Number(g.category_id);
    if (hit && (!best || g.percent > best.percent)) {
      best = {
        percent: g.percent,
        label: g.name || (g.scope === "brand" ? g.brand : g.category_name) || "",
      };
    }
  }
  return best;
};

// Arma paquetes mientras haya uno completo que le ahorre al cliente. En cada
// vuelta elige el que más ahorra; dentro de un lugar con alternativas toma
// primero las unidades más caras (más ahorro). El precio del paquete se
// reparte entre los renglones en proporción a su precio normal, así cada
// renglón conserva un precio unitario y el total que valida el Host cuadra.
const allocateBundles = (lines, bundles) => {
  const idx = [];
  lines.forEach((it, i) => {
    if (it.isManual || typeof it.id !== "number" || lineUnitOf(it) !== "piece") return;
    const qty = Math.floor(it.quantity || 0);
    if (qty <= 0) return;
    idx.push({ i, id: it.id, left: qty, unit: promoInfo(it, qty).total / qty });
  });
  if (!idx.length || !bundles.length) return lines;

  const tryBundle = (b) => {
    const take = [];
    let normal = 0;
    for (const slot of b.slots || []) {
      const ids = new Set((slot.products || []).map((p) => p.id));
      let need = slot.qty || 1;
      const pool = idx
        .filter((x) => ids.has(x.id) && x.left > 0)
        .sort((a, c) => c.unit - a.unit);
      for (const x of pool) {
        if (need <= 0) break;
        const used = take.filter((t) => t.x === x).reduce((n, t) => n + t.n, 0);
        const n = Math.min(need, x.left - used);
        if (n <= 0) continue;
        take.push({ x, n });
        normal += n * x.unit;
        need -= n;
      }
      if (need > 0) return null;
    }
    const saving = normal - b.price;
    return saving > 0.005 ? { take, normal, saving } : null;
  };

  const out = lines.map((it) => ({ ...it }));
  const labels = {};
  for (let guard = 0; guard < 500; guard++) {
    let pick = null;
    for (const b of bundles) {
      const r = tryBundle(b);
      if (r && (!pick || r.saving > pick.r.saving)) pick = { b, r };
    }
    if (!pick) break;
    const { b, r } = pick;
    for (const { x, n } of r.take) {
      x.left -= n;
      const line = out[x.i];
      line.bundleUnits = (line.bundleUnits || 0) + n;
      line.bundleAmount = (line.bundleAmount || 0) + b.price * ((n * x.unit) / r.normal);
      (labels[x.i] = labels[x.i] || new Set()).add(b.name);
    }
  }
  for (const [i, set] of Object.entries(labels)) out[i].bundleLabel = [...set].join(", ");
  return out;
};

export const applyPromotions = (cart, engine) => {
  const clean = cart.map((it) =>
    it.groupPromo || it.bundleUnits
      ? { ...it, groupPromo: null, bundleUnits: 0, bundleAmount: 0, bundleLabel: "" }
      : it,
  );
  if (!engine || !engine.enabled) return clean;
  const today = todayISO();
  const groups = (engine.groupPromos || []).filter((g) => isLive(g, today));
  const bundles = (engine.bundles || []).filter(
    (b) => isLive(b, today) && (b.slots || []).length > 0,
  );
  const withGroups = groups.length
    ? clean.map((it) => {
        if (it.isManual || typeof it.id !== "number") return it;
        const g = bestGroupPromo(it, groups);
        return g ? { ...it, groupPromo: g } : it;
      })
    : clean;
  return allocateBundles(withGroups, bundles);
};

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