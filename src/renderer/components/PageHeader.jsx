import React from "react";

import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
   PageHeader — encabezado compartido de las pantallas.
   NO lleva título: el navbar ya muestra «Sección / Título», así
   que aquí sólo viven la descripción y las acciones de la pantalla,
   con el mismo espaciado, alineación y hairline en todo el sistema.
──────────────────────────────────────────────────────────── */
const PageHeader = ({ description, meta, actions, className }) => {
  if (!description && !meta && !actions) return null;

  return (
    <div
      className={cn(
        "mb-5 flex flex-col gap-3 border-b border-border pb-4",
        "sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {(description || meta) && (
        <div className="min-w-0">
          {description && (
            <p className="text-sm leading-snug text-muted-foreground">
              {description}
            </p>
          )}
          {meta && (
            <div className="mt-1 text-sm leading-snug text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
      )}

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
