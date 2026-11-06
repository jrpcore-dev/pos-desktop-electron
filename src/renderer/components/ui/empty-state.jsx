import * as React from "react";

import { cn } from "@/lib/utils";
import { VendiaBolt } from "../TicketPrinter";

const EmptyState = React.forwardRef(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center",
        className
      )}
      {...props}
    >
      {/* Ticket en blanco: renglones sin imprimir y el sello todavía por poner. */}
      <div className="vt-stage vt-empty" aria-hidden="true">
        <VendiaBolt className="vt-empty-bolt" />
        <div className="vt-empty-paper">
          {icon && <span className="vt-empty-icon">{icon}</span>}
          <i />
          <i />
          <i />
        </div>
        <span className="vt-empty-seal" />
      </div>
      {title && <p className="text-base font-bold text-foreground">{title}</p>}
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
