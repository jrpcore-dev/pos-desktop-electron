import React from "react";
import { RefreshCw } from "lucide-react";

/* Indicador DISCRETO de datos nuevos (regla 5 · historial y reportes).
   No auto-mueve tablas ni recalcula rangos caros con cada venta: el usuario
   decide cuándo refrescar con un clic. Se usa junto a `useDbChanges`. */
const FreshDataChip = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <RefreshCw size={14} aria-hidden />
    Hay datos nuevos
  </button>
);

export default FreshDataChip;
