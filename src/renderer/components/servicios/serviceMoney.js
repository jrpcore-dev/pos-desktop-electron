import { fmtMoney, fmtInt } from "@/utils/format";

/**
 * El renderer trabaja en pesos (float) porque es lo que ve el cajero, pero la
 * base guarda centavos enteros. Este es el único punto de conversión para que
 * no se disperse la aritmética por toda la pantalla.
 */
export const money = (cents) => fmtMoney((cents || 0) / 100);

/** Sólo para leer un campo que escribió una persona (monto de recibo). */
export const pesosToCents = (text) => {
  const clean = String(text || "").replace(/[^\d.]/g, "");
  const value = parseFloat(clean);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

export const sumBy = (rows, pick) =>
  (rows || []).reduce((acc, r) => acc + (pick(r) || 0), 0);

export const countBy = (rows) => (rows || []).length;

export { fmtMoney, fmtInt };