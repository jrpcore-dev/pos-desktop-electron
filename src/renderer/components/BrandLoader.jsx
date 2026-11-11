import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Pantalla de carga con el rayo de Vendia (decisión del dueño, 2026-11-11):
//   1) las tres piezas llegan de tres lados y encajan (una sola vez);
//   2) si la carga sigue, el rayo armado se "carga": su color lo llena de
//      abajo hacia arriba y lo recorre un brillo, en bucle.
// Sin ficha ni nombre: sólo el rayo, tal cual (nunca estirado ni recortado).
// Tema claro: hoja azul marino (vendia-icon-claro); oscuro: hoja blanca.
// No aparece si la carga dura menos de `delay` ms (evita el parpadeo).
// Con "reducir movimiento" de Windows, el rayo sólo respira suavemente.
// Los estilos y keyframes viven en index.css (`.vl-*`).

const BLADE = "178.8,262.0 339.4,48.0 200.0,380.0";
const UPPER = "32.0,102.0 94.0,40.0 116.1,163.0 154.1,125.0 164.3,181.4 130.7,215.0 94.6,251.1";
const LOWER = "130.7,215.0 164.3,181.4 164.3,181.4 200.0,380.0";
const BLUE_BODY = "32.0,102.0 94.0,40.0 116.1,163.0 154.1,125.0 200.0,380.0 130.7,215.0 94.6,251.1";

export function BrandBolt({ size = 112, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 400 420"
      role="img"
      aria-label="Cargando"
      className={cn("vl-bolt overflow-visible", className)}
    >
      <defs>
        <linearGradient id="vl-up" gradientUnits="userSpaceOnUse" x1="30" y1="40" x2="160" y2="260">
          <stop offset="0" style={{ stopColor: "var(--vl-up-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--vl-up-b)" }} />
        </linearGradient>
        <linearGradient id="vl-lo" gradientUnits="userSpaceOnUse" x1="150" y1="190" x2="205" y2="380">
          <stop offset="0" style={{ stopColor: "var(--vl-up-b)" }} />
          <stop offset="1" style={{ stopColor: "var(--vl-lo-b)" }} />
        </linearGradient>
        <linearGradient id="vl-blade" gradientUnits="userSpaceOnUse" x1="339" y1="48" x2="200" y2="380">
          <stop offset="0" style={{ stopColor: "var(--vl-blade-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--vl-blade-b)" }} />
        </linearGradient>
        <linearGradient id="vl-shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset=".5" stopColor="#ffffff" stopOpacity=".5" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="vl-clip">
          <polygon points={BLADE} />
          <polygon points={BLUE_BODY} />
        </clipPath>
      </defs>
      <g transform="translate(14 0)">
        {/* 1 · Las piezas que llegan y encajan; luego quedan como silueta tenue. */}
        <g className="vl-pieces">
          <polygon className="vl-blade" points={BLADE} fill="url(#vl-blade)" stroke="url(#vl-blade)" strokeWidth="2.5" strokeLinejoin="round" />
          <polygon className="vl-lo" points={LOWER} fill="url(#vl-lo)" stroke="url(#vl-lo)" strokeWidth="2.5" strokeLinejoin="round" />
          <polygon className="vl-up" points={UPPER} fill="url(#vl-up)" stroke="url(#vl-up)" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
        {/* 2 · El color que lo va llenando de abajo hacia arriba, y el brillo. */}
        <g clipPath="url(#vl-clip)">
          <g className="vl-fill">
            <polygon points={BLADE} fill="url(#vl-blade)" />
            <polygon points={LOWER} fill="url(#vl-lo)" />
            <polygon points={UPPER} fill="url(#vl-up)" />
          </g>
          <rect className="vl-shine" x="0" y="-60" width="70" height="540" fill="url(#vl-shine)" />
        </g>
      </g>
    </svg>
  );
}

export default function BrandLoader({ delay = 500, className }) {
  const [visible, setVisible] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return undefined;
    const t = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("fixed inset-0 z-[9999] flex h-full w-full items-center justify-center bg-background", className)}
    >
      {visible && (
        <div className="vl-wrap">
          <BrandBolt />
        </div>
      )}
      <span className="sr-only">Cargando</span>
    </div>
  );
}
