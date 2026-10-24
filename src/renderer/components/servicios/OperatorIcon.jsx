import { useState } from "react";
import { cn } from "@/lib/utils";
import { OPERATOR_LOGOS } from "./operatorLogos";

/**
 * Logo de operador, en orden de preferencia:
 *   1. `remote` — la URL que Taecel manda por CDN (trae los 42 operadores).
 *   2. El SVG local `id` del repo — respaldo si el CDN falla o no hay red.
 *   3. Bloque de marca con el color calculado del key y el primer nombre.
 *
 * El CDN es la primera opción porque el catálogo real de Taecel cubre a todos
 * los carriers; los SVG locales son la red de seguridad para que la rejilla
 * nunca se quede sin logo aunque esté caído el CDN o no haya internet.
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

export function OperatorIcon({ id, remote, name, size = "md", className }) {
  const local = OPERATOR_LOGOS[id];
  // URLs que ya fallaron en este ciclo de vida del componente: se guardan en
  // un Set para que, si el operador cambia, una URL nueva vuelva a intentarse.
  const [failed, setFailed] = useState(() => new Set());

  const markFailed = (url) => {
    if (!url) return;
    setFailed((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

  const remoteOk = remote && !failed.has(remote);
  const localOk = local && !failed.has(local);
  const src = remoteOk ? remote : localOk ? local : null;

  return (
    <span className={cn("flex shrink-0 items-center justify-center", SIZES[size], className)}>
      {src ? (
        <img
          src={src}
          alt={name}
          onError={() => markFailed(src)}
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
