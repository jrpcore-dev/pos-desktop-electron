import { Check, Search } from "lucide-react";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { CAT_TABS, filterOperators } from "./serviceCatalog.mock";
import { OperatorIcon } from "./OperatorIcon";

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
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar operador"
            aria-label="Buscar operador"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {list.length} operadores
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Categorías"
        className="flex shrink-0 items-center gap-0.5 border-b border-border"
      >
        {CAT_TABS.map((tab) => {
          const active = tab.key === category;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onCategoryChange(tab.key)}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-xs font-semibold transition-colors",
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

      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {list.length === 0 ? (
          <p className="col-span-full self-center py-8 text-center text-xs text-muted-foreground">
            Sin resultados para “{query}”
          </p>
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
                  "relative flex min-h-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:border-foreground/25 hover:bg-accent/40",
                )}
              >
                <OperatorIcon
                  id={op.logo}
                  name={op.name}
                  size="lg"
                  className="max-h-9 max-w-20 shrink-0"
                />
                <span
                  className={cn(
                    "w-full truncate text-[13px] leading-tight",
                    active
                      ? "font-bold text-foreground"
                      : "font-semibold text-foreground/80",
                  )}
                >
                  {op.name}
                </span>
                {active && (
                  <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary">
                    <Check size={10} className="text-primary-foreground" aria-hidden />
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