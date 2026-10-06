import { Ban, RotateCcw, Zap } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";

const Row = ({ label, value, muted }) => (
  <div className="flex items-center justify-between px-2.5 py-1.5">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span
      className={cn(
        "text-[13px] font-semibold tabular-nums",
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
        <Ban size={20} className="text-muted-foreground/40" aria-hidden />
        <p className="text-xs font-medium text-foreground">
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
        <div className="flex items-center justify-between bg-muted/40 px-2.5 py-2">
          <span className="text-xs font-bold text-foreground">Total a cobrar</span>
          <span className="text-lg font-extrabold tabular-nums text-foreground">
            {money(quote.totalCents)}
          </span>
        </div>
      </div>

      <Button
        type="submit"
        disabled={!canCharge || disabled}
        className="h-11 w-full gap-1.5 bg-success text-sm font-bold text-white hover:bg-success/90"
      >
        <Zap size={15} aria-hidden />
        Procesar y Cobrar
        <kbd className="ml-1 rounded border border-white/25 px-1 font-sans text-[10px] font-semibold opacity-80">
          Enter
        </kbd>
      </Button>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {canCharge ? "" : blockedHint}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={disabled}
          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
        >
          <RotateCcw size={11} aria-hidden />
          Limpiar
        </Button>
      </div>
    </div>
  );
};

export default ServiceSummary;