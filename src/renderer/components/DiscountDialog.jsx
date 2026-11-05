import React, { useEffect, useRef, useState } from "react";
import { Percent, CheckCircle2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/utils/format";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const QUICK_PERCENTS = [5, 10, 15];

// Montos redondos según lo que cuesta la línea: $5 pesa en un producto de $40
// y no significa nada en uno de $2,000.
const quickAmounts = (subtotal) => {
  const steps =
    subtotal < 50
      ? [1, 2, 5]
      : subtotal < 200
        ? [5, 10, 20]
        : subtotal < 1000
          ? [10, 20, 50]
          : [50, 100, 200];
  return steps.filter((amount) => amount <= subtotal);
};

const DiscountDialog = ({
  open,
  onClose,
  item,
  value,
  onValueChange,
  onApply,
  onClear,
  isDark = false,
}) => {
  const inputRef = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState("money");
  const [percent, setPercent] = useState("");
  const byPercent = mode === "percent";

  useEffect(() => {
    setConfirming(false);
    setMode("money");
    setPercent("");
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const amount = parseFloat(value) || 0;
  const subtotal = item ? item.price * item.quantity : 0;
  const discount = Math.max(0, Math.min(amount, subtotal));
  const final = subtotal - discount;
  const valid = !!item && !!value && amount > 0 && amount <= subtotal;
  const hasValue = value !== "" && value !== undefined;
  const errorMessage = !hasValue
    ? ""
    : amount > subtotal
      ? `El descuento no puede superar el subtotal (${fmtMoney(subtotal)}).`
      : amount <= 0
        ? "Ingresa un monto mayor a 0."
        : "";

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.target.tagName !== "BUTTON" && valid) {
        if (confirming) return;
        setConfirming(true);
        setTimeout(() => setConfirming(false), 400);
        onApply();
      }
    }
  };

  const focusInput = () => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  // El descuento siempre se guarda en pesos: el % solo ayuda a calcularlo.
  const applyPercent = (text) => {
    setPercent(text);
    const pct = parseFloat(text) || 0;
    onValueChange(pct > 0 ? (Math.round(subtotal * pct) / 100).toFixed(2) : "");
  };

  const handleChange = (e) => {
    const v = e.target.value;
    if (v !== "" && !/^\d*\.?\d{0,2}$/.test(v)) return;
    if (byPercent) applyPercent(v);
    else onValueChange(v);
  };

  const changeMode = (next) => {
    setMode(next);
    setPercent("");
    onValueChange("");
    focusInput();
  };

  const pickQuick = (quick) => {
    if (byPercent) applyPercent(String(quick));
    else onValueChange(quick.toFixed(2));
    focusInput();
  };

  const quickOptions = byPercent ? QUICK_PERCENTS : quickAmounts(subtotal);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent size={20} className="text-primary" />
            Descuento del producto
          </DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{item.name}</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {fmtMoney(item.price)} / pieza
                </span>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  x{item.quantity}
                </span>
              </div>
            </div>

            <Tabs value={mode} onValueChange={changeMode}>
              <TabsList className="grid h-10 w-full grid-cols-2">
                <TabsTrigger value="money" className="h-8 font-semibold">
                  En pesos
                </TabsTrigger>
                <TabsTrigger value="percent" className="h-8 font-semibold">
                  En porcentaje
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-1.5">
              <Label htmlFor="discount-amount">
                {byPercent ? "Porcentaje de descuento" : "Monto del descuento"}
              </Label>
              <div className="relative">
                <span
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground",
                    byPercent ? "right-3.5" : "left-3.5",
                  )}
                >
                  {byPercent ? "%" : "$"}
                </span>
                <Input
                  id="discount-amount"
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  placeholder={byPercent ? "0" : "0.00"}
                  value={byPercent ? percent : value}
                  onChange={handleChange}
                  aria-invalid={!!errorMessage}
                  aria-describedby={
                    errorMessage ? "discount-amount-error" : undefined
                  }
                  className={cn(
                    "h-12 rounded-lg text-right text-2xl font-bold tabular-nums",
                    byPercent ? "pl-4 pr-10" : "pl-9",
                  )}
                />
              </div>
              {errorMessage ? (
                <p
                  id="discount-amount-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {errorMessage}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Se aplica sobre {fmtMoney(subtotal)} de este producto.
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {quickOptions.map((quick) => (
                <Button
                  key={quick}
                  type="button"
                  variant="outline"
                  onClick={() => pickQuick(quick)}
                  className={cn(
                    "h-11 font-semibold tabular-nums",
                    parseFloat(byPercent ? percent : value) === quick &&
                      "border-chart-2 bg-primary/10 text-primary ring-2 ring-chart-2/40",
                  )}
                >
                  {byPercent ? `${quick}%` : `$${quick}`}
                </Button>
              ))}
            </div>

            <div
              className={cn(
                "rounded-lg border px-4 py-3",
                isDark
                  ? "border-success/20 bg-success/10"
                  : "border-success/15 bg-success/5"
              )}
            >
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{fmtMoney(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex items-center justify-between text-sm text-destructive">
                  <span>Descuento</span>
                  <span className="tabular-nums">-{fmtMoney(discount)}</span>
                </div>
              )}
              <div className="mt-1 border-t border-border/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Precio final
                  </span>
                  <span className="text-2xl font-extrabold text-foreground tabular-nums">
                    {fmtMoney(final)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {item?.discount > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-11 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onClear}
            >
              <Undo2 size={16} />
              Quitar descuento
            </Button>
          )}
          <div className="flex flex-1 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11 flex-1 bg-success text-white hover:bg-success/90"
              disabled={!valid || confirming}
              onClick={onApply}
            >
              <CheckCircle2 size={16} />
              Aplicar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DiscountDialog;