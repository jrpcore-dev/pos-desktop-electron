/**
 * Capa de datos de Servicios (Taecel).
 *
 * El catálogo vive en el Host (`taecel:get-catalog`, cacheado 24 h) y llega
 * ya normalizado a la forma que consume la rejilla: operadores con `key`,
 * `name`, `logoKey`, `kind`, `input` y `products[{sku, name, amountCents}]`.
 * Aquí sólo quedan funciones puras sobre esa lista.
 */

import { normalizeText, parsePackage, vigenciaFrom } from "./packageInfo";

export const KIND_LABEL = {
  airtime: "Tiempo aire",
  package: "Paquete",
  giftcard: "Tarjeta",
  bill: "Pago de servicio",
};

// Categorías de Taecel: tiempo aire (1), paquetes (2), pago de servicios (3) y
// tarjetas de regalo (4). El Host ya no filtra; estas pestañas se muestran
// sólo si el catálogo trae algo de esa categoría.
export const CAT_TABS = [
  { key: "all", name: "Todas" },
  { key: "telefonia", name: "Recargas" },
  { key: "paquetes", name: "Paquetes" },
  { key: "servicios", name: "Servicios" },
  { key: "tarjetas", name: "Tarjetas" },
];

// `logo` del Host es la URL remota; la UI usa los SVG locales por `logoKey`
// (sin red para pintar la rejilla) y cae al bloque de color si no hay.
export const toUiOperators = (catalog) =>
  (catalog?.operators || []).map((op) => ({
    ...op,
    remoteLogo: op.logo || null,
    logo: op.logoKey || null,
  }));

export const getOperator = (operators, key) =>
  (operators || []).find((o) => o.key === key) || null;

export const filterOperators = (operators, category, query) => {
  const q = String(query || "").trim().toLowerCase();
  return (operators || []).filter((o) => {
    if (category !== "all" && o.category !== category) return false;
    if (!q) return true;
    return (
      o.name.toLowerCase().includes(q) ||
      String(o.key).toLowerCase().includes(q.replace(/\s+/g, ""))
    );
  });
};

export const quote = (operator, amountCents) => {
  if (!operator || !Number.isFinite(amountCents) || amountCents <= 0) return null;
  const feeCents = operator.feeCents || 0;
  return { amountCents, feeCents, totalCents: amountCents + feeCents };
};

// Servicios como CFE se cobran por monto libre: el cajero captura el importe
// del recibo porque el catálogo no trae monto fijo (Monto: 0.00 en Taecel).
export const isFreeAmount = (op) => !!(op && (op.freeAmount || op.type === 1));

export const validateInput = (operator, value) => {
  const spec = operator?.input;
  if (!spec || spec.kind === "none") return { ok: true };
  const v = String(value || "").trim();
  if (!v) return { ok: false, error: `${spec.label} es obligatorio` };
  if (spec.numeric && !/^\d+$/.test(v))
    return { ok: false, error: "Solo números, sin espacios ni guiones" };
  if (v.length < spec.min || v.length > spec.max)
    return {
      ok: false,
      error:
        spec.min === spec.max
          ? `Debe tener ${spec.min} ${spec.numeric ? "dígitos" : "caracteres"}`
          : `Debe tener entre ${spec.min} y ${spec.max} ${spec.numeric ? "dígitos" : "caracteres"}`,
    };
  return { ok: true };
};

// Las filas del historial traen el nombre del operador, no su `logoKey`:
// se deriva igual que en el Host para reutilizar los SVG locales.
const LOGO_ALIASES = {
  "at&t": "att",
  "virgin mobile": "virgin",
  "flash mobile": "flash",
  pillofon: "pillo",
  "pillo fon": "pillo",
};
export const logoKeyFromName = (name) => {
  const n = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return LOGO_ALIASES[n] || n.replace(/[^a-z0-9]/g, "");
};

// Fila del ledger (`toUiRow` del Host) → forma de la UI.
// El ledger guarda en `carrier_logo` la URL del CDN de Taecel; se conserva
// como `operatorRemoteLogo` (primera opción de pintado) y además se deriva la
// llave local para reutilizar el SVG de respaldo si el CDN falla.
export const toUiTransaction = (row) =>
  row
    ? {
        ...row,
        operatorRemoteLogo: row.operatorLogo || null,
        operatorLogo: logoKeyFromName(row.operatorName),
        providerRef: row.transId || row.providerFolio || null,
        message: row.providerMessage || row.error || null,
        quote: row.quote || {
          amountCents: row.amountCents || 0,
          feeCents: 0,
          totalCents: row.amountCents || 0,
        },
      }
    : null;

// ─── Familias de marca ──────────────────────────────────────────────
// Taecel publica cada paquete como un carrier aparte ("Telcel Internet
// Amigo", "Paquete Amigo Sin Limite", "Paquetes BAIT"…). En la rejilla se
// agrupan bajo su compañía para que el cajero elija "Telcel" y ahí escoja
// entre recargas y paquetes.
const BRAND_RULES = [
  { brand: "telcel", re: /telcel|amigo/ },
  { brand: "bait", re: /\bbait\b/ },
  { brand: "wimo", re: /wimo/ },
  { brand: "netwey", re: /netwey/, name: "Netwey" },
  { brand: "newww", re: /newww/, name: "Newww" },
  { brand: "xbox", re: /\bxbox\b/ },
  { brand: "amazon", re: /\bamazon\b/, name: "Amazon" },
  { brand: "uber", re: /\buber\b/ },
];

const ruleOf = (op) => {
  const n = normalizeText(op.name);
  return BRAND_RULES.find((r) => r.re.test(n)) || null;
};

const brandOf = (op) => ruleOf(op)?.brand || `op:${op.key}`;

const titleCase = (s) =>
  s.replace(/\b([a-záéíóúñ])([a-záéíóúñ]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());

const ACCENTS = {
  limite: "Límite",
  movil: "Móvil",
  telefonia: "Telefonía",
  gamepass: "Game Pass",
  eats: "Uber Eats",
};

// Miembro que se llama igual que su marca ("Xbox" dentro de Xbox).
const FALLBACK_LABEL = { paquetes: "Paquetes", servicios: "Servicio", tarjetas: "Tarjeta" };

// "Telcel Internet Amigo" → "Internet Amigo"; "Paquetes BAIT" → "Paquetes".
const memberLabel = (op, family) => {
  if (op.category === "telefonia") return "Recargas";
  const words = normalizeText(family.name).split(" ");
  let rest = op.name
    .split(/\s+/)
    .filter((w) => !words.includes(normalizeText(w)))
    .join(" ")
    .replace(/^paquete\s+/i, "")
    .trim();
  if (!rest) return FALLBACK_LABEL[op.category] || "Paquetes";
  rest = titleCase(rest).replace(/\b(\w+)\b/g, (w) => ACCENTS[normalizeText(w)] || w);
  return rest.replace(/\bY\b/, "y");
};

// Cada familia es una marca. En la práctica Taecel no publica un carrier con
// productos de dos categorías distintas, así que una familia cae en una sola
// categoría y el filtro por pestaña es directo.
const countIn = (members, cat) => members.filter((m) => m.category === cat).length;

export const buildFamilies = (operators) => {
  const map = new Map();
  for (const op of operators || []) {
    const brand = brandOf(op);
    if (!map.has(brand)) map.set(brand, { key: brand, members: [] });
    map.get(brand).members.push(op);
  }
  const families = [];
  for (const fam of map.values()) {
    const primary =
      fam.members.find((m) => m.category === "telefonia") || fam.members[0];
    const recargas = countIn(fam.members, "telefonia");
    const paquetes = countIn(fam.members, "paquetes");
    const servicios = countIn(fam.members, "servicios");
    const tarjetas = countIn(fam.members, "tarjetas");
    const family = {
      key: fam.key,
      // Nombre de marca cuando todos los miembros llevan apellido
      // ("Netwey Internet", "Netwey Telefonia" → "Netwey").
      name: ruleOf(primary)?.name || primary.name,
      logo: primary.logo,
      remoteLogo: primary.remoteLogo || null,
      primary,
      // Categoría de la familia: la que tenga contenido; ante empate manda
      // telefonia, luego paquetes, servicios y tarjetas.
      category:
        (recargas && "telefonia") ||
        (paquetes && "paquetes") ||
        (servicios && "servicios") ||
        (tarjetas && "tarjetas") ||
        primary.category,
      hasRecargas: recargas > 0,
      packageCount: paquetes,
      servicioCount: servicios,
      tarjetaCount: tarjetas,
    };
    // Recargas primero, luego paquetes en el orden del catálogo.
    family.members = [...fam.members]
      .sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0))
      .map((op) => ({ ...op, memberLabel: memberLabel(op, family) }));
    family.searchText = normalizeText(
      `${family.name} ${fam.members.map((m) => m.name).join(" ")} ${family.key}`,
    );
    families.push(family);
  }
  return families;
};

export const familyOfOperator = (families, operatorKey) =>
  (families || []).find((f) => f.members.some((m) => m.key === operatorKey)) || null;

// Miembro con el que abre una familia según la categoría activa. Si la familia
// no tiene de esa categoría cae al primero (la pestaña ya la filtró antes).
const FAMILY_COUNT = {
  telefonia: (f) => (f.hasRecargas ? 1 : 0),
  paquetes: (f) => f.packageCount,
  servicios: (f) => f.servicioCount,
  tarjetas: (f) => f.tarjetaCount,
};

export const familyInCategory = (family, category) => {
  if (category === "all") return true;
  const count = FAMILY_COUNT[category];
  return count ? count(family) > 0 : family.category === category;
};

export const defaultMember = (family, category) => {
  if (category === "all" || category === "telefonia") {
    return family.members.find((m) => m.category === "telefonia") || family.members[0];
  }
  return family.members.find((m) => m.category === category) || family.members[0];
};

// ─── Búsqueda ───────────────────────────────────────────────────────
// "telcel 100"  → Telcel con sus productos de $100
// "100"         → compañías que venden $100 (+ paquetes de $100)
// "internet 7 dias", "redes", "sin limite" → paquetes que lo incluyen
const STOP = new Set(["de", "y", "la", "el", "para", "con", "en", "los", "las", "del"]);

export const parseQuery = (query) => {
  let q = normalizeText(query);
  let vigencia = null;
  const vm = q.match(/(\d+)\s*(h|hr|hrs|horas?|d|dias?|meses|mes|anos?)\b/);
  if (vm) {
    const raw = vm[2];
    const unit = raw.startsWith("h")
      ? "hora"
      : raw === "d" || raw.startsWith("dia")
        ? "dia"
        : raw.startsWith("m")
          ? "mes"
          : "ano";
    vigencia = vigenciaFrom(Number(vm[1]), unit);
    q = q.replace(vm[0], " ");
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const amounts = tokens
    .filter((t) => /^\$?\d+(\.\d+)?$/.test(t))
    .map((t) => Math.round(Number(t.replace("$", "")) * 100));
  const words = tokens.filter((t) => !/^\$?\d+(\.\d+)?$/.test(t) && !STOP.has(t));
  return { words, amounts, vigencia, empty: !words.length && !amounts.length && !vigencia };
};

const MAX_HITS = 40;

export const searchCatalog = (families, query, category = "all") => {
  const inCat = (families || []).filter((f) => familyInCategory(f, category));
  const q = parseQuery(query);
  if (q.empty) return { families: inCat, hits: [], query: q };

  const hits = [];
  const shown = [];
  for (const fam of inCat) {
    const nameWords = q.words.filter((w) => fam.searchText.includes(w));
    const restWords = q.words.filter((w) => !fam.searchText.includes(w));
    const productOk = (op, p) => {
      // Monto libre (CFE) no se filtra por monto ni vigencia: el cajero captura
      // el importe del recibo. IAVE, Televía y las tarjetas sí llevan monto fijo.
      const isService = isFreeAmount(op);
      if (!isService && q.amounts.length && !q.amounts.includes(p.amountCents))
        return false;
      const info = parsePackage(p);
      if (!isService && q.vigencia && Math.abs((info.vigencia?.days ?? -1) - q.vigencia.days) > 0.001)
        return false;
      const text = `${normalizeText(op.name)} ${info.searchText}`;
      return restWords.every((w) => text.includes(w));
    };
    const members = fam.members.filter(
      (m) => category === "all" || m.category === category,
    );
    // Sólo nombres de compañía ("telcel"): la compañía y ya, sin listar productos.
    const nameOnly = !restWords.length && !q.amounts.length && !q.vigencia;
    if (nameOnly) {
      if (nameWords.length === q.words.length) {
        // "sin limite" abre directo "Amigo Sin Límite", no las recargas.
        const member = fam.members.find((m) =>
          q.words.every((w) => normalizeText(m.name).includes(w)),
        );
        shown.push(member && member !== fam.members[0] ? { ...fam, preferred: member.key } : fam);
      }
      continue;
    }
    // Un monto sin texto lista paquetes, no las ~40 recargas del mismo precio.
    const amountOnly = !q.words.length && !q.vigencia;
    const famHits = [];
    for (const op of members) {
      if (amountOnly && op.category === "telefonia") continue;
      for (const p of op.products || []) {
        if (productOk(op, p)) famHits.push({ family: fam, operator: op, product: p });
      }
    }
    // Un servicio de monto libre acepta cualquier importe: no cuenta como
    // "vende $100"; los de importe fijo sí.
    const sellsAmount =
      q.amounts.length &&
      members.some(
        (m) =>
          !isFreeAmount(m) &&
          (m.products || []).some((p) => q.amounts.includes(p.amountCents)),
      );
    if (famHits.length || (amountOnly && sellsAmount) || (nameWords.length && !restWords.length && sellsAmount)) {
      shown.push(fam);
    }
    hits.push(...famHits);
  }
  // Paquetes antes que recargas: son lo que se busca por contenido.
  const rank = (h) => (h.operator.category === "telefonia" ? 1 : 0);
  hits.sort((a, b) => rank(a) - rank(b) || a.product.amountCents - b.product.amountCents);
  return { families: shown, hits: hits.slice(0, MAX_HITS), totalHits: hits.length, query: q };
};
