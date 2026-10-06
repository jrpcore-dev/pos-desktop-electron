import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { money, pesosToCents } from "./serviceMoney";

const Pill = ({ amount, active, onSelect }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={() => onSelect(amount)}
    className={cn(
      "h-8 cursor-pointer rounded-md border px-2.5 text-[13px] font-bold tabular-nums transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-foreground hover:border-foreground/30 hover:bg-accent/40",
    )}
  >
    {money(amount)}
  </button>
);

const ServiceAmountPicker = ({ operator, amountCents, onAmountChange }) => {
  if (!operator) return null;
  const isFree = !operator.fixedAmounts;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isFree ? "Monto a cobrar" : "Monto"}
        </span>
        {isFree && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {money(operator.minAmountCents)} – {money(operator.maxAmountCents)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {operator.amounts.map((amount) => (
          <Pill
            key={amount}
            amount={amount}
            active={amount === amountCents}
            onSelect={onAmountChange}
          />
        ))}
      </div>

      {isFree && (
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
            $
          </span>
          <Input
            type="text"
            inputMode="decimal"
            aria-label="Monto a cobrar"
            placeholder="Otro monto"
            value={amountCents ? (amountCents / 100).toFixed(2) : ""}
            onChange={(e) => onAmountChange(pesosToCents(e.target.value))}
            className="h-9 pl-6 text-right text-sm font-bold tabular-nums"
          />
        </div>
      )}
    </div>
  );
};

export default ServiceAmountPicker;