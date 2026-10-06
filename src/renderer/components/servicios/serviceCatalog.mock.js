/**
 * Catálogo FICTICIO para revisar la interfaz antes de que exista Seycel.
 *
 * Todos los montos van en CENTAVOS enteros y se convierten a pesos al pintar.
 *
 * Dos campos de categoría y tipo van separados a propósito:
 *   category -> en qué pestaña lo ve el cajero (Telefonía, Servicios, Streaming)
 *   kind     -> cómo se cobra (denominación fija, tarjeta o recibo variable)
 *
 * Cuando llegue el proveedor real, este archivo se reemplaza por la respuesta
 * de `catalog.sync()` con exactamente la misma forma.
 */

export const AIRTIME = "airtime";
export const GIFTCARD = "giftcard";
export const BILL = "bill";

export const KIND_LABEL = {
  [AIRTIME]: "Tiempo aire",
  [GIFTCARD]: "Tarjeta",
  [BILL]: "Pago de servicio",
};

/** Pestañas del catálogo. La primera es "todas" y no filtra por category. */
export const CAT_TABS = [
  { key: "all", name: "Todas" },
  { key: "telefonia", name: "Telefonía" },
  { key: "servicios", name: "Servicios" },
  { key: "streaming", name: "Streaming" },
];

const phone = {
  kind: "phone",
  label: "Número de teléfono",
  placeholder: "10 dígitos",
  hint: "A nombre del titular",
  numeric: true,
  min: 10,
  max: 10,
};

const contract = {
  kind: "contract",
  label: "Número de referencia",
  placeholder: "En tu recibo",
  hint: "Impreso en el recibo",
  numeric: true,
  min: 8,
  max: 12,
};

const none = { kind: "none", label: "", placeholder: "", hint: "", numeric: false };

/* Denominaciones de tiempo aire: $20 / $50 / $100 / $200 / $500 */
const AIRTIME_AMOUNTS = [2000, 5000, 10000, 20000, 50000];

export const MOCK_OPERATORS = [
  {
    key: "telcel",
    name: "Telcel",
    logo: "telcel",
    category: "telefonia",
    kind: AIRTIME,
    fixedAmounts: true,
    wholesaleDiscount: 0.075,
    feeCents: 0,
    amounts: AIRTIME_AMOUNTS,
    input: phone,
  },
  {
    key: "movistar",
    name: "Movistar",
    logo: "movistar",
    category: "telefonia",
    kind: AIRTIME,
    fixedAmounts: true,
    wholesaleDiscount: 0.07,
    feeCents: 0,
    amounts: AIRTIME_AMOUNTS,
    input: phone,
  },
  {
    key: "att",
    name: "AT&T",
    logo: "att",
    category: "telefonia",
    kind: AIRTIME,
    fixedAmounts: true,
    wholesaleDiscount: 0.078,
    feeCents: 0,
    amounts: AIRTIME_AMOUNTS,
    input: phone,
  },
  {
    key: "virgin",
    name: "Virgin",
    logo: "virgin",
    category: "telefonia",
    kind: AIRTIME,
    fixedAmounts: true,
    wholesaleDiscount: 0.085,
    feeCents: 0,
    amounts: AIRTIME_AMOUNTS,
    input: phone,
  },
  {
    key: "telmex",
    name: "Telmex",
    logo: "telmex",
    category: "telefonia",
    kind: BILL,
    fixedAmounts: false,
    wholesaleDiscount: 0.012,
    feeCents: 1500,
    amounts: [50000, 100000, 150000, 200000, 300000],
    minAmountCents: 15000,
    maxAmountCents: 300000,
    input: contract,
  },
  {
    key: "cfe",
    name: "CFE",
    logo: "cfe",
    category: "servicios",
    kind: BILL,
    fixedAmounts: false,
    wholesaleDiscount: 0.01,
    feeCents: 1200,
    amounts: [50000, 100000, 150000, 200000, 300000],
    minAmountCents: 10000,
    maxAmountCents: 500000,
    input: contract,
  },
  {
    key: "naturgy",
    name: "Naturgy",
    logo: "naturgy",
    category: "servicios",
    kind: BILL,
    fixedAmounts: false,
    wholesaleDiscount: 0.015,
    feeCents: 1800,
    amounts: [50000, 100000, 150000, 200000, 300000],
    minAmountCents: 15000,
    maxAmountCents: 400000,
    input: contract,
  },
  {
    key: "megacable",
    name: "Megacable",
    logo: "megacable",
    category: "servicios",
    kind: BILL,
    fixedAmounts: false,
    wholesaleDiscount: 0.015,
    feeCents: 1200,
    amounts: [50000, 100000, 150000, 200000, 300000],
    minAmountCents: 10000,
    maxAmountCents: 250000,
    input: contract,
  },
  {
    key: "amazon",
    name: "Amazon",
    logo: "amazon",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.025,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "google-play",
    name: "Google Play",
    logo: "google-play",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.03,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "netflix",
    name: "Netflix",
    logo: "netflix",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.04,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "apple",
    name: "Apple",
    logo: "apple",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.035,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "spotify",
    name: "Spotify",
    logo: "spotify",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.05,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "samsung",
    name: "Samsung",
    logo: "samsung",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.035,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "xbox",
    name: "Xbox",
    logo: "xbox",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.035,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
  {
    key: "playstation",
    name: "PlayStation",
    logo: "playstation",
    category: "streaming",
    kind: GIFTCARD,
    fixedAmounts: true,
    wholesaleDiscount: 0.035,
    feeCents: 0,
    amounts: [5000, 10000, 20000, 50000, 100000],
    input: none,
  },
];

export const getOperator = (key) =>
  MOCK_OPERATORS.find((o) => o.key === key) || null;

export const operatorsByKind = (kind) =>
  MOCK_OPERATORS.filter((o) => o.kind === kind);

/** Filtro del catálogo por pestaña y por texto libre. */
export const filterOperators = (category, query) => {
  const q = String(query || "").trim().toLowerCase();
  return MOCK_OPERATORS.filter((o) => {
    if (category !== "all" && o.category !== category) return false;
    if (!q) return true;
    return (
      o.name.toLowerCase().includes(q) || o.key.includes(q.replace(/\s+/g, ""))
    );
  });
};

// Lo único que ve el cajero: importe, comisión cobrada al cliente y total.
// El costo real y la ganancia no se calculan aquí a propósito: todavía no hay
// decisión de negocio sobre si el cajero debe verlos.
export const quote = (operator, amountCents) => {
  if (!operator || !Number.isFinite(amountCents) || amountCents <= 0) return null;

  const feeCents = operator.fixedAmounts ? 0 : operator.feeCents || 0;

  return {
    amountCents,
    feeCents,
    totalCents: amountCents + feeCents,
  };
};

export const validateInput = (operator, value) => {
  const spec = operator?.input;
  if (!spec || spec.kind === "none") return { ok: true };
  const v = String(value || "").trim();

  if (!v) return { ok: false, error: `${spec.label} es obligatorio` };
  if (spec.numeric && !/^\d+$/.test(v)) {
    return { ok: false, error: "Solo números, sin espacios ni guiones" };
  }
  if (v.length < spec.min || v.length > spec.max) {
    return {
      ok: false,
      error: `Debe tener entre ${spec.min} y ${spec.max} dígitos`,
    };
  }
  return { ok: true };
};

// Sin backend. El resultado sale del hash del folio, no del azar, para que
// los reintentos y la reconciliación se puedan probar de verdad.
const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const mockFolio = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const rand = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  return `MOCK-${stamp}-${rand}`;
};

let forceNext = null;
export const setNextMockStatus = (status) => {
  forceNext = status;
};

export const mockExecute = ({ folio, failRate = 0 }) =>
  new Promise((resolve) => {
    const latency = 800 + Math.random() * 1400;
    const forced = forceNext;
    forceNext = null;

    setTimeout(() => {
      if (forced) {
        return resolve({ status: forced, providerRef: `SRV-${hash(folio)}` });
      }
      if (hash(folio) % 100 < failRate) {
        return resolve({
          status: "failed",
          providerRef: null,
          message: "El operador rechazó la operación",
        });
      }
      resolve({
        status: "applied",
        providerRef: `SRV-${hash(folio)}`,
        message: "Operación aplicada",
      });
    }, latency);
  });

export const MOCK_TRANSACTIONS = [
  {
    id: 1,
    folio: "MOCK-20260928-481203",
    providerRef: "SRV-90211",
    operatorKey: "telcel",
    operatorName: "Telcel",
    productName: "$100",
    inputValue: "5512874410",
    status: "applied",
    quote: { amountCents: 10000, feeCents: 0, totalCents: 10000 },
    createdAt: "2026-09-28T13:42:00",
  },
  {
    id: 2,
    folio: "MOCK-20260928-771900",
    providerRef: null,
    operatorKey: "netflix",
    operatorName: "Netflix",
    productName: "$300",
    inputValue: "",
    status: "failed",
    quote: { amountCents: 30000, feeCents: 0, totalCents: 30000 },
    createdAt: "2026-09-28T12:15:00",
    message: "El operador rechazó la operación",
  },
  {
    id: 3,
    folio: "MOCK-20260928-120044",
    providerRef: "SRV-77310",
    operatorKey: "cfe",
    operatorName: "CFE",
    productName: "Pago de recibo",
    inputValue: "8841209337",
    status: "unknown",
    quote: { amountCents: 10000, feeCents: 1200, totalCents: 11200 },
    createdAt: "2026-09-28T11:03:00",
  },
  {
    id: 4,
    folio: "MOCK-20260927-339021",
    providerRef: "SRV-55120",
    operatorKey: "amazon",
    operatorName: "Amazon",
    productName: "$200",
    inputValue: "",
    status: "applied",
    quote: { amountCents: 20000, feeCents: 0, totalCents: 20000 },
    createdAt: "2026-09-27T18:22:00",
  },
  {
    id: 5,
    folio: "MOCK-20260927-880112",
    providerRef: "SRV-41002",
    operatorKey: "movistar",
    operatorName: "Movistar",
    productName: "$50",
    inputValue: "4420118877",
    status: "applied",
    quote: { amountCents: 5000, feeCents: 0, totalCents: 5000 },
    createdAt: "2026-09-27T16:07:00",
  },
  {
    id: 6,
    folio: "MOCK-20260927-441290",
    providerRef: "SRV-30991",
    operatorKey: "spotify",
    operatorName: "Spotify",
    productName: "$100",
    inputValue: "",
    status: "reversed",
    quote: { amountCents: 10000, feeCents: 0, totalCents: 10000 },
    createdAt: "2026-09-27T14:30:00",
  },
];