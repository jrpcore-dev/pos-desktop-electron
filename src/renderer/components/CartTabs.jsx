import React from "react";
import { Plus, X, ShoppingCart } from "lucide-react";

import { cn } from "@/lib/utils";
import { fmtMoney } from "@/utils/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";

const cartLine = (it) => it.price * (it.quantity || 1);

/**
 * Barra de tickets (h-16) sobre el panel del carrito.
 * - Rótulo "TICKETS" + separador vertical: la barra se lee como chrome de
 *   instrumento en vez de una tira plana.
 * - Pestaña activa despega (-translate-y-0.5) con sombra corta y ring.
 * - Badge de contador + subtotal en TODAS las pestañas (tabular-nums).
 * - "Nueva" a la derecha, elevación solo en hover.
 * - Scroll: la rueda del ratón se convierte a eje X y el borde derecho se
 *   funde mientras haya pestañas fuera de vista (la barra se oculta a propósito).
 * - Sin leyenda de atajos: el keydown de la terminal NO implementa Alt+F ni
 *   Alt+←/→, así que no se anuncian atajos que no existen (Alt+F además cae
 *   en la captura del código de barras).
 */
export const CartTabs = React.memo(
  ({ carts, activeIndex, onNewSale, onSwitch, onCancel }) => {
    const stripRef = React.useRef(null);
    const [canScrollRight, setCanScrollRight] = React.useState(false);

    // ¿Faltan pestañas por ver? Se recalcula al cambiar el conteo, al hacer
    // scroll y al redimensionar; gobierna el fundido del borde derecho.
    const syncScrollHint = React.useCallback(() => {
      const el = stripRef.current;
      if (!el) return;
      const more = el.scrollWidth - el.clientWidth - el.scrollLeft > 4;
      setCanScrollRight((prev) => (prev === more ? prev : more));
    }, []);

    const tabsCount = carts?.length ?? 0;

    React.useEffect(() => {
      syncScrollHint();
      window.addEventListener("resize", syncScrollHint);
      return () => window.removeEventListener("resize", syncScrollHint);
    }, [tabsCount, syncScrollHint]);

    // Rueda del ratón → eje X: Chrome no encadena el scroll vertical al
    // horizontal, así que sin esto la rueda "no hace nada" en la tira.
    // deltaMode 1 = líneas (ratones clásicos) → convertir a px.
    const handleWheel = (e) => {
      const el = stripRef.current;
      if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };

    if (!carts || carts.length === 0) return null;

    return (
      <TooltipProvider delayDuration={300}>
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
          {/* Rótulo tipo serigrafía de panel: da contexto sin ocupar el strip. */}
          <span
            aria-hidden="true"
            className="shrink-0 select-none text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Tickets
          </span>

          {/* py-1 = colchón vertical: sin él, `overflow-x-auto` recorta la
              pestaña activa cuando se despega (-translate-y-0.5). */}
          <div
            ref={stripRef}
            role="tablist"
            aria-label="Tickets de venta"
            onScroll={syncScrollHint}
            onWheel={handleWheel}
            className={cn(
              "no-scrollbar flex min-w-0 flex-1 select-none items-center gap-1.5 overflow-x-auto py-1",
              canScrollRight &&
                "[mask-image:linear-gradient(to_right,#000_calc(100%_-_32px),transparent)] [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_32px),transparent)]",
            )}
          >
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
                  title={`${ticketLabel} · ${fmtMoney(subtotal)}`}
                  onClick={() => onSwitch(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSwitch(index);
                    }
                  }}
                  className={cn(
                    "group flex h-11 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-all duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    active
                      ? "border-primary/50 bg-background font-semibold text-foreground shadow-[0_3px_6px_-2px_rgba(0,0,0,0.20)] ring-1 ring-inset ring-primary/20 -translate-y-0.5"
                      : "border-transparent bg-transparent font-medium text-muted-foreground hover:bg-background/70 hover:text-foreground",
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
                    <>
                      <span
                        aria-hidden="true"
                        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none text-primary-foreground"
                      >
                        {count}
                      </span>
                      <span className="sr-only">{count} productos</span>
                    </>
                  )}
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-semibold tabular-nums",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {fmtMoney(subtotal)}
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
                            "ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 motion-reduce:transition-none hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !active &&
                              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-visible:opacity-100",
                          )}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Cancelar venta</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>

          <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNewSale}
                className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 text-sm font-semibold text-primary shadow-sm transition-all duration-150 motion-reduce:transition-none hover:-translate-y-px hover:border-primary/70 hover:bg-primary/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size={16} aria-hidden />
                Nueva
              </button>
            </TooltipTrigger>
            <TooltipContent>Nueva venta rápida</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  },
);

export default CartTabs;
