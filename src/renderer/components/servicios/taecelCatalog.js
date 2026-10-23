/**
 * Capa de datos de Servicios (Taecel).
 *
 * El catálogo vive en el Host (`taecel:get-catalog`, cacheado 24 h) y llega
 * ya normalizado a la forma que consume la rejilla: operadores con `key`,
 * `name`, `logoKey`, `kind`, `input` y `products[{sku, name, amountCents}]`.
 * Aquí sólo quedan funciones puras sobre esa lista.
 */

export const KIND_LABEL = {
  airtime: "Tiempo aire",
  package: "Paquete",
  giftcard: "Tarjeta",
  bill: "Pago de servicio",
};

// Fase 1 de Taecel: sólo tiempo aire y paquetes (el Host filtra el resto).
export const CAT_TABS = [
  { key: "all", name: "Todas" },
  { key: "telefonia", name: "Recargas" },
  { key: "paquetes", name: "Paquetes" },
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
          ? `Debe tener ${spec.min} dígitos`
          : `Debe tener entre ${spec.min} y ${spec.max} dígitos`,
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
export const toUiTransaction = (row) =>
  row
    ? {
        ...row,
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
