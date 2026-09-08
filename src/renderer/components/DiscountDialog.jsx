import React, { useEffect, useRef, useState } from "react";
import { Percent, CheckCircle2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";

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

  useEffect(() => {
    setConfirming(false);
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

  const handleChange = (e) => {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) onValueChange(v);
  };

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
                  ${item.price.toFixed(2)} / pieza
                </span>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  x{item.quantity}
                </span>
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                $
              </span>
              <Input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={value}
                onChange={handleChange}
                className="h-14 rounded-lg pl-9 text-right text-2xl font-bold tabular-nums"
              />
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
                <span className="tabular-nums">${subtotal.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex items-center justify-between text-sm text-destructive">
                  <span>Descuento</span>
                  <span className="tabular-nums">-${discount.toFixed(2)}</span>
                </div>
              )}
              <div className="mt-1 border-t border-border/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Precio final
                  </span>
                  <span className="text-2xl font-extrabold text-success tabular-nums">
                    ${final.toFixed(2)}
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
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
              className="flex-1"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="flex-1 bg-success text-white hover:bg-success/90"
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