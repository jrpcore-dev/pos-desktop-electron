import React, { useEffect, useRef, useState } from "react";
import { Smartphone, CheckCircle2 } from "lucide-react";
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

const RechargeDialog = ({
  open,
  onClose,
  amount,
  onAmountChange,
  onConfirm,
  presets = [],
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

  const valid = parseFloat(amount) > 0;

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      if (valid) {
        setConfirming(true);
        setTimeout(() => setConfirming(false), 400);
        onConfirm();
      }
    }
  };

  const handleChange = (e) => {
    onAmountChange(e.target.value.replace(/[^\d.]/g, ""));
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
            <Smartphone size={20} className="text-primary" />
            Recargas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              Selecciona un monto
            </p>
            <div className="grid grid-cols-3 gap-2">
              {presets.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  onClick={() => onAmountChange(String(m))}
                  className={cn(
                    "h-11 text-[15px] font-bold tabular-nums transition-all",
                    amount === String(m) &&
                      "border-success bg-success/10 text-success ring-1 ring-success"
                  )}
                >
                  ${m}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              Monto personalizado
            </p>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                $
              </span>
              <Input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                placeholder="Ej: 15"
                value={amount}
                onChange={handleChange}
                className="h-14 rounded-xl pl-9 pr-3 text-right text-2xl font-bold tabular-nums"
              />
            </div>
          </div>
        </div>

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
            className="flex-1 bg-success text-white hover:bg-success/90"
            disabled={!valid || confirming}
            onClick={onConfirm}
          >
            <CheckCircle2 size={16} />
            Agregar al carrito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RechargeDialog;