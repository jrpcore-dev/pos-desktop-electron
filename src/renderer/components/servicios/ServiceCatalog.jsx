import { Check, Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { CAT_TABS, filterOperators } from "./serviceCatalog.mock";
import { OperatorIcon } from "./OperatorIcon";

// Rejilla de operadores: cada tile sale del catálogo (logo + nombre). Si el
// operador no trae SVG, `OperatorIcon` pinta un bloque de marca con su color
// para que la rejilla se vea uniforme y nunca quede sin logos.
const ServiceCatalog = ({
  category,
  onCategoryChange,
  operatorKey,
  onOperatorChange,
  query,
  onQueryChange,
  disabled,
}) => {
  const list = filterOperators(category, query);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar operador"
            aria-label="Buscar operador"
            className="h-10 pl-8 text-sm"
          />
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {list.length} ops
        </span>
      </div>

      {/* Filtro de categorías: botones conmutables, no pestañas (las pestañas
          reales de la pantalla son las de Cobrar/Historial). */}
      <div
        role="group"
        aria-label="Categorías"
        className="flex shrink-0 items-center gap-1 border-b border-border"
      >
        {CAT_TABS.map((tab) => {
          const active = tab.key === category;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={active}
              onClick={() => onCategoryChange(tab.key)}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 content-start grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
        {list.length === 0 ? (
          <div className="col-span-full flex flex-col items-center gap-2 self-center py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Sin resultados para “{query}”
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onQueryChange("")}
              className="gap-1.5"
            >
              <X size={14} aria-hidden />
              Limpiar búsqueda
            </Button>
          </div>
        ) : (
          list.map((op) => {
            const active = op.key === operatorKey;
            return (
              <button
                key={op.key}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onOperatorChange(op.key)}
                className={cn(
                  "group relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-all duration-150",
                  "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/[0.07] ring-1 ring-primary"
                    : "border-border bg-card hover:border-foreground/30 hover:bg-accent/40",
                )}
              >
                <OperatorIcon
                  id={op.logo}
                  name={op.name}
                  size="lg"
                  className="h-10 transition-transform duration-150 group-hover:scale-105"
                />
                <span
                  className={cn(
                    "line-clamp-2 w-full text-xs leading-tight",
                    active
                      ? "font-bold text-foreground"
                      : "font-semibold text-foreground/85",
                  )}
                >
                  {op.name}
                </span>
                {active && (
                  <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary">
                    <Check
                      size={12}
                      className="text-primary-foreground"
                      aria-hidden
                    />
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ServiceCatalog;