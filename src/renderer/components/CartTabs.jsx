import React from "react";
import { Plus, X, ShoppingCart } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";

const cartLine = (it) => it.price * (it.quantity || 1);

/**
 * Barra de pestañas de tickets (48px, sin robar espacio vertical crítico).
 * - Pestaña activa con acento primario, sombra y texto contundente.
 * - Badge de contador + subtotal visible en TODAS las tabs.
 * - Botón "x" para cancelar venta (hover suave en rojo).
 * - Botón "Nueva venta" destacado a la derecha.
 * - Scrollbar horizontal mínimo/oculto.
 */
export const CartTabs = React.memo(
  ({ carts, activeIndex, onNewSale, onSwitch, onCancel }) => {
    if (!carts || carts.length === 0) return null;

    return (
      <TooltipProvider delayDuration={300}>
        <div className="flex h-16 shrink-0 items-center gap-1.5 border-b border-border bg-muted/20 px-3">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {carts.map((cart, index) => {
              const count = cart.items.length;
              const subtotal = cart.items.reduce(
                (s, it) => s + cartLine(it),
                0,
              );
              const active = index === activeIndex;
              const ticketLabel = `Ticket #${cart.folio ?? index + 1}`;

              return (
                <div
                  key={cart.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={active}
                  title={`${ticketLabel} · $${subtotal.toFixed(2)}`}
                  onClick={() => onSwitch(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSwitch(index);
                    }
                  }}
                  className={cn(
                    "group flex h-10 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-all duration-150",
                    active
                      ? "border-primary/50 bg-background font-semibold text-foreground shadow-md ring-1 ring-inset ring-primary/20"
                      : "border-transparent bg-transparent font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                <ShoppingCart
                  size={14}
                  aria-hidden
                  className={cn(
                    "shrink-0 transition-colors duration-150",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="truncate">{ticketLabel}</span>
                {count > 0 && (
                  <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {count}
                  </span>
                )}
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-semibold tabular-nums",
                    active ? "text-success" : "text-muted-foreground",
                  )}
                >
                  ${subtotal.toFixed(2)}
                </span>
                  {carts.length > 1 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Cancelar ${ticketLabel}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancel(index);
                          }}
                          className={cn(
                            "ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full p-0.5 text-muted-foreground transition-all duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",                            !active &&
                              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-visible:opacity-100",
                          )}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Cancelar venta</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>

          <span className="hidden shrink-0 text-[10px] font-medium text-muted-foreground md:inline">
            Alt+F = nueva · Alt+←/→ = alternar
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNewSale}
                className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 text-sm font-semibold text-primary shadow-sm transition-all duration-150 hover:border-primary/70 hover:bg-primary/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size={16} aria-hidden />
                Nueva
              </button>
            </TooltipTrigger>
            <TooltipContent>Nueva venta rápida · Alt+F</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  },
);

export default CartTabs;
