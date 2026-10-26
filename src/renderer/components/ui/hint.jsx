import * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

// Atajo para el Tooltip del sistema en vez del `title` nativo:
//   <Hint label="Descartar"><button …/></Hint>
// Sin `label` devuelve el hijo tal cual. Un botón deshabilitado no recibe
// eventos del puntero, así que se envuelve en un span enfocable para que el
// tooltip (p. ej. "Solo el propietario") siga apareciendo.
// Requiere un TooltipProvider arriba (Layout envuelve toda la app).
function Hint({ label, side = "top", align = "center", children }) {
  if (!label) return children;
  const disabled = !!children?.props?.disabled;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span tabIndex={0} className="inline-flex cursor-not-allowed">
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className="z-[1400]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export { Hint };
