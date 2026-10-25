import { CreditCard, DollarSign, Landmark, RotateCcw, Zap } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";

// Mismos tres métodos que la terminal de venta: la recarga se cobra como una
// venta más y el importe entra al corte por el método elegido.
const METHODS = [
  { key: "cash", label: "Efectivo", Icon: DollarSign },
  { key: "card", label: "Tarjeta", Icon: CreditCard },
  { key: "transfer", label: "Transferencia", Icon: Landmark },
];

const PaymentMethods = ({ value, onChange, disabled }) => (
  <div
    className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/60 p-1"
    role="group"
    aria-label="Método de pago"
  >
    {METHODS.map(({ key, label, Icon }) => {
      const active = value === key;
      return (
        <button
          key={key}
          type="button"
          title={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={() => onChange?.(key)}
          className={cn(
            "flex h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1 text-xs font-semibold transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            active
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <Icon size={14} aria-hidden />
          <span className="truncate">{key === "transfer" ? "Transf." : label}</span>
        </button>
      );
    })}
  </div>
);

// "Recibe" es sólo una ayuda para dar el cambio: no viaja al Host ni a la venta.
const parseReceived = (raw) => {
  const n = Number(String(raw || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

const ServiceSummary = ({
  quote,
  canCharge,
  onReset,
  disabled,
  blockedHint,
  paymentMethod = "cash",
  onPaymentMethodChange,
  received = "",
  onReceivedChange,
  chargeRef,
}) => {
  const total = quote?.totalCents || 0;
  const noFee = !quote?.feeCents;
  const receivedCents = parseReceived(received);
  const change = receivedCents - total;
  const short = receivedCents > 0 && change < 0;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Mini ticket */}
      <div className="rounded-xl border border-dashed border-primary/35 bg-primary/[0.04] px-3.5 py-2.5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Total a cobrar
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {quote
                ? `Importe ${money(quote.amountCents)} · ${noFee ? "comisión incluida" : `comisión ${money(quote.feeCents)}`}`
                : "Elige un monto o paquete"}
            </p>
          </div>
          <p
            className={cn(
              "shrink-0 text-[28px] font-extrabold leading-none tabular-nums",
              quote ? "text-foreground" : "text-muted-foreground/50",
            )}
          >
            {money(total)}
          </p>
        </div>
      </div>

      <PaymentMethods
        value={paymentMethod}
        onChange={onPaymentMethodChange}
        disabled={disabled}
      />

      {paymentMethod === "cash" && (
        <div className="flex items-center gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Recibe</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
              Recibe $
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={received}
              onChange={(e) => onReceivedChange?.(e.target.value.replace(/[^\d.]/g, ""))}
              disabled={disabled}
              placeholder="0.00"
              className={cn(
                "h-10 w-full rounded-lg border bg-field pl-[4.6rem] pr-3 text-sm font-semibold tabular-nums shadow-sm",
                "focus-visible:outline-none focus-visible:ring-4",
                short
                  ? "border-destructive focus-visible:ring-destructive/15"
                  : "border-input focus-visible:border-primary focus-visible:ring-primary/15",
              )}
            />
          </label>
          <div className="flex h-10 min-w-[7.5rem] flex-col items-end justify-center rounded-lg bg-muted/60 px-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {short ? "Faltan" : "Cambio"}
            </span>
            <span
              className={cn(
                "text-sm font-extrabold leading-none tabular-nums",
                short ? "text-destructive" : receivedCents ? "text-success" : "text-muted-foreground",
              )}
            >
              {receivedCents ? money(Math.abs(change)) : "—"}
            </span>
          </div>
        </div>
      )}

      <Button
        ref={chargeRef}
        type="submit"
        disabled={!canCharge || disabled}
        className="h-12 w-full gap-2 rounded-xl bg-success text-base font-bold text-success-foreground shadow-md shadow-success/20 hover:bg-success/90"
      >
        <Zap size={17} aria-hidden />
        {quote ? `Cobrar ${money(total)}` : "Cobrar"}
        <kbd className="ml-1 rounded border border-white/25 px-1 font-sans text-[11px] font-semibold opacity-80">
          Enter
        </kbd>
      </Button>

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-xs",
            canCharge ? "font-medium text-success" : "text-muted-foreground",
          )}
        >
          {canCharge ? "Listo para cobrar" : blockedHint}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={disabled}
          className="h-8 shrink-0 gap-1 px-2 text-xs"
        >
          <RotateCcw size={12} aria-hidden />
          Limpiar
        </Button>
      </div>
    </div>
  );
};

export default ServiceSummary;
