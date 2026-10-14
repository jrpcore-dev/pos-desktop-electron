import { Ban, RotateCcw, Zap } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";

const Row = ({ label, value, muted }) => (
  <div className="flex items-center justify-between px-2.5 py-2">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span
      className={cn(
        "text-sm font-semibold tabular-nums",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {value}
    </span>
  </div>
);

const ServiceSummary = ({ quote, canCharge, onReset, disabled, blockedHint }) => {
  if (!quote) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-3 py-6 text-center">
        <Ban size={24} className="text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          Elige operador y monto
        </p>
      </div>
    );
  }

  const noFee = !quote.feeCents;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-border">
        <Row label="Importe" value={money(quote.amountCents)} />
        <div className="h-px bg-border" />
        <Row
          label="Comisión"
          value={noFee ? "Incluida" : money(quote.feeCents)}
          muted={noFee}
        />
        <div className="h-px bg-border" />
        <div className="flex items-center justify-between bg-muted/40 px-2.5 py-2.5">
          <span className="text-sm font-bold text-foreground">Total a cobrar</span>
          <span className="text-xl font-extrabold tabular-nums text-foreground">
            {money(quote.totalCents)}
          </span>
        </div>
      </div>

      <Button
        type="submit"
        disabled={!canCharge || disabled}
        className="h-12 w-full gap-1.5 bg-success text-base font-bold text-success-foreground hover:bg-success/90"
      >
        <Zap size={17} aria-hidden />
        Procesar y Cobrar
        <kbd className="ml-1 rounded border border-white/25 px-1 font-sans text-[11px] font-semibold opacity-80">
          Enter
        </kbd>
      </Button>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {canCharge ? "" : blockedHint}
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