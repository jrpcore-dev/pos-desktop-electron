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
