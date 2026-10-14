import { cn } from "@/lib/utils";
import { OPERATOR_LOGOS } from "./operatorLogos";

/**
 * Logo de operador, data-driven:
 * - Si hay SVG en operatorLogos -> se muestra la imagen oficial.
 * - Si no, se renderiza un bloque de marca con el color calculado del key y
 *   el primer nombre del operador. Así el grid nunca se ve vacío y cambiar de
 *   imagen oficial es solo dejar un archivo.
 */
const SWATCH_COLORS = [
  "#1D4ED8", "#0E7490", "#16A34A", "#D97706", "#DC2626", "#7C3AED",
  "#DB2777", "#0D9488", "#4F46E5", "#EA580C", "#9333EA", "#B91C1C",
  "#15803D", "#B45309", "#2563EB", "#BE185D",
];

const brandColor = (key) => {
  const s = String(key || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SWATCH_COLORS[h % SWATCH_COLORS.length];
};

const SIZES = {
  sm: "h-7",
  md: "h-9",
  lg: "h-12",
  xl: "h-14",
};

const shortLabel = (name) => (name || "?").split(/\s+/)[0];

export function OperatorIcon({ id, name, size = "md", className }) {
  const src = OPERATOR_LOGOS[id];
  return (
    <span className={cn("flex shrink-0 items-center justify-center", SIZES[size], className)}>
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-auto max-h-full w-auto max-w-full object-contain"
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center overflow-hidden rounded-md px-1.5 font-extrabold text-white",
          )}
          style={{ backgroundColor: brandColor(id || name) }}
          title={name}
        >
          <span className="min-w-0 truncate text-sm leading-none">{shortLabel(name)}</span>
        </span>
      )}
    </span>
  );
}