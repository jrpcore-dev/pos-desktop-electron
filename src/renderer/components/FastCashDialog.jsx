import React, { useEffect, useMemo, useRef, useState } from "react";
import { DollarSign, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const DENOMS = [50, 100, 200, 500, 1000, 2000];

const buildChips = (total) => {
  const exacto = total;
  const above = DENOMS.filter((d) => d >= total).slice(0, 3);
  const chips = [exacto, ...above];
  const padded = [...chips];
  while (padded.length < 4) {
    padded.push(padded[padded.length - 1] * 2);
  }
  return padded.slice(0, 4);
};

const FastCashDialog = ({
  open,
  onClose,
  total,
  cashAmount,
  onCashAmountChange,
  change,
  waitingDrawer,
  onConfirm,
  onDrawerDone,
}) => {
  const inputRef = useRef(null);
  const chips = useMemo(() => buildChips(total || 0), [total]);
  const isPositive = change >= 0;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setConfirming(false);
  }, [open]);

  useEffect(() => {
    if (open && !waitingDrawer) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, waitingDrawer]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      setConfirming(true);
      setTimeout(() => setConfirming(false), 400);
      if (waitingDrawer) {
        onDrawerDone();
      } else if (cashAmount && isPositive) {
        onConfirm();
      }
    }
  };

  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw === "" || /^\d*\.?\d{0,2}$/.test(raw)) {
      onCashAmountChange(raw);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <DollarSign size={22} className="text-success" />
            Pago en Efectivo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <p className="text-center text-base font-semibold text-muted-foreground">
            Total a pagar
          </p>
          <p className="text-center text-4xl font-extrabold leading-tight text-success tabular-nums">
            ${total?.toFixed(2) ?? "0.00"}
          </p>

          {!waitingDrawer && (
            <div className="grid grid-cols-2 gap-2">
              {chips.map((v, i) => (
                <Button
                  key={i}
                  type="button"
                  variant="outline"
                  onClick={() => onCashAmountChange(String(v))}
                  className={cn(
                    "h-11 text-[15px] font-bold tabular-nums transition-all",
                    parseFloat(cashAmount) === v &&
                      "border-success bg-success/10 text-success ring-1 ring-success"
                  )}
                >
                  {i === 0 ? "Monto Exacto" : `$${v.toLocaleString("es-MX")}`}
                </Button>
              ))}
            </div>
          )}

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
              $
            </span>
            <Input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={cashAmount}
              onChange={handleChange}
              disabled={waitingDrawer}
              className="h-14 rounded-lg pl-9 text-right text-2xl font-bold tabular-nums"
            />
          </div>

          {cashAmount !== "" && cashAmount !== undefined && (
            <div
              className={cn(
                "flex items-center justify-between rounded-lg px-4 py-3 text-sm font-semibold transition-colors",
                isPositive
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive"
              )}
            >
              <span>{isPositive ? "Cambio:" : "Falta:"}</span>
              <span className="text-2xl font-extrabold leading-none tabular-nums">
                ${(isPositive ? change : Math.abs(change)).toFixed(2)}
              </span>
            </div>
          )}

          {waitingDrawer && (
            <p className="text-center text-sm text-muted-foreground">
              Abre el cajón y entrega el cambio
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11"
            onClick={() => onClose()}
          >
            Cancelar
          </Button>
          {waitingDrawer ? (
            <Button
              type="button"
              className="flex-1 h-11 bg-success text-white hover:bg-success/90"
              disabled={confirming}
              onClick={onDrawerDone}
            >
              <CheckCircle2 size={16} />
              Listo
            </Button>
          ) : (
            <Button
              type="button"
              className="flex-1 h-11 bg-success text-white hover:bg-success/90"
              disabled={!cashAmount || !isPositive || confirming}
              onClick={onConfirm}
            >
              <CheckCircle2 size={16} />
              Confirmar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FastCashDialog;
