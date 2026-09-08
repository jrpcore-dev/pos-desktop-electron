import React, { useEffect, useMemo, useRef, useState } from "react";
import { Scale } from "lucide-react";
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

const WeightDialog = ({
  open,
  onClose,
  product,
  weightAmount,
  onWeightChange,
  onConfirm,
  isDark = false,
}) => {
  const inputRef = useRef(null);
  const kg = parseFloat(weightAmount) || 0;
  const [confirming, setConfirming] = useState(false);

  const effectivePrice = useMemo(() => {
    if (!product) return 0;
    const disc = product.discount_percent || 0;
    return product.price * (1 - disc / 100);
  }, [product]);

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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && kg > 0) {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      setConfirming(true);
      setTimeout(() => setConfirming(false), 400);
      onConfirm();
    }
  };

  const handleChange = (e) => {
    const v = e.target.value.replace(",", ".");
    if (/^\d*\.?\d{0,3}$/.test(v)) onWeightChange(v);
  };

  const total = kg > 0 ? effectivePrice * kg : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-sm"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale size={20} className="text-primary" />
            Peso del Producto
          </DialogTitle>
        </DialogHeader>

        {product && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">
                {product.name}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
                  ${product.price.toFixed(2)} / kg
                </span>
                {product.discount_percent > 0 && (
                  <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                    -{product.discount_percent}%
                  </span>
                )}
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                kg
              </span>
              <Input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                placeholder="0.000"
                value={weightAmount}
                onChange={handleChange}
                className="h-16 rounded-xl bg-field pl-12 pr-4 text-center text-3xl font-bold tabular-nums"
              />
            </div>

            {kg > 0 && (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-center",
                  isDark
                    ? "border-success/20 bg-success/10"
                    : "border-success/15 bg-success/5"
                )}
              >
                <p className="text-xs font-medium text-muted-foreground">
                  Total
                </p>
                <p className="text-3xl font-extrabold text-success tabular-nums">
                  ${total.toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  ${effectivePrice.toFixed(2)} × {kg.toFixed(3)} kg
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
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
            variant="outline"
            className="flex-1 border-success bg-success/5 text-success hover:bg-success/10 hover:text-success"
            disabled={!weightAmount || kg <= 0 || confirming}
            onClick={onConfirm}
          >
            <Scale size={16} />
            Agregar al Carrito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WeightDialog;
