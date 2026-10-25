import { Check, Clock, Receipt, Wifi } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";
import { isFreeAmount } from "./taecelCatalog";
import { parsePackage } from "./packageInfo";
import { planData, planTitle, servicePlansAreAmounts } from "./cardInfo";
import { AmountPill, Chip, PackageCard } from "./ServiceProductPicker";

// Montos rápidos para un recibo de monto libre: el cajero casi siempre
// cobra cifras redondas o teclea el importe exacto.
const QUICK = [100, 200, 300, 500];

/* Importe libre (CFE, agua…): campo grande con el signo de pesos fijo. */
const FreeAmount = ({ value, onChange, disabled }) => {
  const cents = Math.round((parseFloat(value) || 0) * 100);
  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <span className="sr-only">Importe del recibo</span>
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          data-option
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          disabled={disabled}
          placeholder="0.00"
          className={cn(
            "h-14 w-full rounded-xl border bg-field pl-8 pr-24 text-2xl font-extrabold tabular-nums shadow-sm",
            "placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-4",
            "border-input focus-visible:border-primary focus-visible:ring-primary/15",
          )}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <Receipt size={12} aria-hidden />
          del recibo
        </span>
      </label>
      <div className="flex flex-wrap gap-1">
        {QUICK.map((n) => {
          const active = cents === n * 100;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => onChange(String(n))}
              className={cn(
                "h-7 cursor-pointer rounded-full border px-3 text-[11px] font-semibold tabular-nums transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {money(n * 100)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* Plan de servicio sin texto de paquete reconocible (Netwey: "Internet Móvil
   Semanal 10 GB"): título limpio + datos y vigencia en chips. */
const PlanCard = ({ product, operator, active, onSelect, disabled }) => {
  const data = planData(product);
  const vig = parsePackage(product)?.vigencia;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      data-option
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150",
        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary bg-primary/[0.07] shadow-sm ring-1 ring-primary"
          : "border-border bg-card hover:border-primary/50 hover:shadow-sm",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-snug text-foreground">
          {planTitle(product, operator)}
        </span>
        {(data || vig) && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {data && <Chip Icon={Wifi} label={data} active={active} />}
            {vig && <Chip Icon={Clock} label={vig.label} active={active} />}
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-lg font-extrabold tabular-nums",
          active ? "text-primary" : "text-foreground",
        )}
      >
        {money(product.amountCents)}
      </span>
      {active && (
        <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary shadow-sm">
          <Check size={12} strokeWidth={3} className="text-primary-foreground" aria-hidden />
        </span>
      )}
    </button>
  );
};

// Pago de servicios: monto libre → campo de importe; importes fijos sin
// diferencia entre sí (IAVE, Televía) → pastillas; planes (Netwey) → lista.
const ServiceBillPicker = ({
  operator,
  selectedSku,
  onSelect,
  disabled,
  listRef,
  freeAmount,
  onFreeAmountChange,
}) => {
  if (!operator) return null;
  const products = operator.products || [];

  if (isFreeAmount(operator)) {
    return (
      <div ref={listRef}>
        <FreeAmount value={freeAmount} onChange={onFreeAmountChange} disabled={disabled} />
      </div>
    );
  }

  if (servicePlansAreAmounts(operator)) {
    return (
      <div ref={listRef} className="grid grid-cols-3 content-start gap-2 xl:grid-cols-4">
        {products.map((p) => (
          <AmountPill
            key={p.sku}
            product={p}
            active={p.sku === selectedSku}
            onSelect={() => onSelect(p.sku)}
            disabled={disabled}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex flex-col gap-2">
      {products.map((p) =>
        parsePackage(p)?.data ? (
          <PackageCard
            key={p.sku}
            product={p}
            active={p.sku === selectedSku}
            onSelect={() => onSelect(p.sku)}
            disabled={disabled}
          />
        ) : (
          <PlanCard
            key={p.sku}
            product={p}
            operator={operator}
            active={p.sku === selectedSku}
            onSelect={() => onSelect(p.sku)}
            disabled={disabled}
          />
        ),
      )}
    </div>
  );
};

export default ServiceBillPicker;
