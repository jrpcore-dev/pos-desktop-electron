/**
 * Capa de datos de Servicios.
 *
 * El catálogo de operadores y productos viene de `vendesaldoCatalog.js`,
 * normalizado de la respuesta real de `obtenerProductos`. Este archivo solo
 * agrega la SIMULACIÓN de ejecución, que se cambia por el adaptador SOAP
 * cuando `realizarRecarga` tenga su esquema confirmado.
 */
export * from "./vendesaldoCatalog";

export const getLogo = (key) => {
  const op = getOperator(key);
  return op ? op.logo : null;
};

// Sin backend todavía. El resultado sale del hash del folio, no del azar, para
// que los reintentos y la reconciliación se puedan probar de verdad.
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

export const mockExecute = ({ folio, failRate = 0 }) =>
  new Promise((resolve) => {
    const latency = 800 + Math.random() * 1400;

    setTimeout(() => {
      if (hash(folio) % 100 < failRate) {
        return resolve({
          status: "failed",
          providerRef: null,
          message: "El proveedor rechazó la operación",
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
    operatorKey: "TELCEL",
    operatorLogo: "telcel",
    operatorName: "Telcel",
    productName: "RECARGA 100",
    inputValue: "5512874410",
    status: "applied",
    quote: { amountCents: 10000, feeCents: 0, totalCents: 10000 },
    createdAt: "2026-09-28T13:42:00",
  },
  {
    id: 2,
    folio: "MOCK-20260928-771900",
    providerRef: null,
    operatorKey: "TELCEL_SIN_LIMITE",
    operatorLogo: "telcel",
    operatorName: "Telcel Sin Límite",
    productName: "SIN LIMITE $100",
    inputValue: "5512874410",
    status: "failed",
    quote: { amountCents: 10000, feeCents: 0, totalCents: 10000 },
    createdAt: "2026-09-28T12:15:00",
    message: "El proveedor rechazó la operación",
  },
  {
    id: 3,
    folio: "MOCK-20260928-120044",
    providerRef: "SRV-77310",
    operatorKey: "CFE",
    operatorLogo: "cfe",
    operatorName: "CFE",
    productName: "CFE 220",
    inputValue: "8841209337",
    status: "unknown",
    quote: { amountCents: 22000, feeCents: 1200, totalCents: 23200 },
    createdAt: "2026-09-28T11:03:00",
  },
  {
    id: 4,
    folio: "MOCK-20260927-339021",
    providerRef: "SRV-55120",
    operatorKey: "MOVISTAR",
    operatorLogo: "movistar",
    operatorName: "Movistar",
    productName: "RECARGA 50",
    inputValue: "4420118877",
    status: "applied",
    quote: { amountCents: 5000, feeCents: 0, totalCents: 5000 },
    createdAt: "2026-09-27T18:22:00",
  },
  {
    id: 5,
    folio: "MOCK-20260927-880112",
    providerRef: "SRV-41002",
    operatorKey: "IUSACELL_ATT",
    operatorLogo: "att",
    operatorName: "AT&T",
    productName: "RECARGA 100",
    inputValue: "4420118877",
    status: "applied",
    quote: { amountCents: 10000, feeCents: 0, totalCents: 10000 },
    createdAt: "2026-09-27T16:07:00",
  },
  {
    id: 6,
    folio: "MOCK-20260927-441290",
    providerRef: "SRV-30991",
    operatorKey: "TELCEL_INTERNET_AMIGO",
    operatorLogo: "telcel",
    operatorName: "Telcel Internet Amigo",
    productName: "INTERNET AMIGO 50",
    inputValue: "5522990033",
    status: "reversed",
    quote: { amountCents: 5000, feeCents: 0, totalCents: 5000 },
    createdAt: "2026-09-27T14:30:00",
  },
];