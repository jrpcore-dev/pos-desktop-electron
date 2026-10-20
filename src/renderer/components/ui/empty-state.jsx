import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Estado vacío reutilizable para tablas y listas.
 *
 * `icon`    → componente de lucide-react.
 * `title`   → qué pasó, en una línea.
 * `description` → por qué o qué hacer al respecto.
 * `action`  → botón opcional (crear el primer registro o limpiar filtros).
 */
const EmptyState = ({ icon: Icon, title, description, action, className }) => (
  <div
    role="status"
    className={cn(
      "flex flex-col items-center justify-center px-6 py-10 text-center",
      className,
    )}
  >
    {Icon && (
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon size={26} strokeWidth={1.75} aria-hidden="true" />
      </span>
    )}
    <p className="text-sm font-semibold text-foreground">{title}</p>
    {description && (
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export { EmptyState };
