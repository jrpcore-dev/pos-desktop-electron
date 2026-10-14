import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";

/* Los nombres del catálogo llegan pegados:
   "SIN LIMITE $10 - 50MB SMS LLAM 1d".
   Separarlos permite pintar el plan como título y su detalle como meta,
   en vez de truncar todo en una sola línea que nadie alcanza a leer. */
const splitPlan = (name = "") => {
  const [head, ...rest] = String(name).split(" - ");
  return { head: head.trim(), detail: rest.join(" · ").trim() };
};

/* Pastilla de monto (recargas): el número es lo único que importa,
   así que ocupa toda la pastilla y se lee de un vistazo. */
const AmountPill = ({ product, active, onSelect, disabled }) => (
  <button
    type="button"
    aria-pressed={active}
    disabled={disabled}
    onClick={onSelect}
    className={cn(
      "relative flex h-14 cursor-pointer flex-col items-center justify-center rounded-lg border px-2 transition-all duration-150",
      "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      "disabled:cursor-not-allowed disabled:opacity-50",
      active
        ? "border-primary bg-primary text-primary-foreground shadow-sm"
        : "border-border bg-card text-foreground hover:border-foreground/35 hover:bg-accent/50",
    )}
  >
    <span className="text-[15px] font-extrabold tabular-nums leading-none">
      {money(product.amountCents)}
    </span>
    {active && (
      <Check
        size={13}
        className="absolute right-1.5 top-1.5"
        aria-hidden
      />
    )}
  </button>
);

/* Fila de plan (paquetes / servicios): dos líneas —nombre y detalle—
   con el precio a la derecha. La fila crece con el texto en vez de
   cortarlo. */
const PlanRow = ({ product, active, onSelect, disabled }) => {
  const { head, detail } = splitPlan(product.name);
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-150",
        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary bg-primary/[0.07] ring-1 ring-primary"
          : "border-border bg-card hover:border-foreground/35 hover:bg-accent/50",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-foreground">
          {head}
        </span>
        {detail && (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-[15px] font-extrabold tabular-nums",
          active ? "text-primary" : "text-foreground",
        )}
      >
        {money(product.amountCents)}
      </span>
      {active && (
        <Check size={16} className="shrink-0 text-primary" aria-hidden />
      )}
    </button>
  );
};

// El selector es dinámico según el tipo del operador: recarga simple en
// pastillas de monto; paquetes o servicios como filas con nombre y precio.
const ServiceProductPicker = ({ operator, selectedSku, onSelect, disabled }) => {
  if (!operator) return null;
  const isPaquete = operator.variant === "paquete";
  const title =
    operator.kind === "bill" ? "Importe" : isPaquete ? "Paquete" : "Monto";

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {operator.products.length} opciones
        </span>
      </div>

      {isPaquete ? (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5">
          {operator.products.map((p) => (
            <PlanRow
              key={p.sku}
              product={p}
              active={p.sku === selectedSku}
              onSelect={() => onSelect(p.sku)}
              disabled={disabled}
            />
          ))}
        </div>
      ) : (
        <div className="grid max-h-64 grid-cols-3 content-start gap-2 overflow-y-auto pr-0.5 xl:grid-cols-4">
          {operator.products.map((p) => (
            <AmountPill
              key={p.sku}
              product={p}
              active={p.sku === selectedSku}
              onSelect={() => onSelect(p.sku)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ServiceProductPicker;
