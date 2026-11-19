/**
 * Única fuente de verdad para la presentación de números en el POS.
 *
 * Reglas de formato de dinero (aplicadas en TODA la app):
 *  - Separador de miles y 2 decimales fijos, locale es-MX.
 *  - Símbolo "$" y signo negativo ANTES del símbolo: "-$1,234.50".
 *  - null / undefined / NaN / Infinity se muestran como "$0.00".
 *
 * IMPORTANTE: esto es SOLO presentación. Nunca usar estas funciones para
 * calcular, guardar en BD ni comparar importes; para eso se usa el número crudo.
 */

const MX = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** "1,234.50" — seguro con entradas no numéricas. */
export const fmtNumber = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString("es-MX", MX);
};

/**
 * Cantidades vendidas / en existencia: "5" para piezas y "5.450" para granel.
 * Nunca más de 3 decimales (evita "5.450000000000001" por sumas en coma flotante).
 */
export const fmtQty = (n, saleUnit) => {
  const v = Number(n);
  const r = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
  return Number.isInteger(r) && saleUnit !== "weight"
    ? r.toLocaleString("es-MX")
    : r.toLocaleString("es-MX", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

/** Stock a granel almacenado en kg, con la presentación ".600g" bajo un kilo. */
export const fmtStockQty = (n, saleUnit) => {
  if (n == null) return "—";
  const amount = fmtQty(n, saleUnit);
  if (saleUnit !== "weight") return `${amount} pz`;
  if (/^-?0\.(?!000$)/.test(amount)) return `${amount.replace(/^(-?)0/, "$1")}g`;
  return `${amount}kg`;
};

/** "1,234" (enteros, sin decimales). */
export const fmtInt = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString("es-MX");
};

/** "$1,234.50" | "-$1,234.50" — importes con signo incluido cuando aplica. */
export const fmtMoney = (n) => {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return `${safe < 0 ? "-" : ""}$${fmtNumber(Math.abs(safe))}`;
};

/** "$1,234.50" sin importar el signo: para plantillas que ya emiten su propio +/-. */
export const fmtMoneyAbs = (n) => `$${fmtNumber(Math.abs(Number(n) || 0))}`;

/** "+$1,234.50" | "-$1,234.50" — listados de movimientos (retiros, gastos, devoluciones). */
export const fmtMoneySigned = (n) => {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  if (safe === 0) return `$${fmtNumber(0)}`;
  return `${safe > 0 ? "+" : "-"}$${fmtNumber(Math.abs(safe))}`;
};
