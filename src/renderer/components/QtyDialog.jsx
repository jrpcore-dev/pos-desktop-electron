import React, { useEffect, useRef, useState } from "react";
import { Kbd } from "./ui/kbd";
import { Percent } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";

const QtyDialog = ({ open, onClose, value, onChange, onConfirm }) => {
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      setConfirming(true);
      setTimeout(() => setConfirming(false), 400);
      onConfirm();
    }
  };

  const qty = parseInt(value, 10);
  const valid = qty >= 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-xs"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent size={20} className="text-primary" />
            Cantidad para próxima captura
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
            ×
          </span>
          <Input
            ref={inputRef}
            type="number"
            min="1"
            step="1"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
            className="h-14 rounded-xl bg-field pl-10 pr-3 text-center text-3xl font-bold tabular-nums"
          />
        </div>

        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Kbd className="h-5 px-1 text-[10px]">Enter</Kbd>
          <span>para confirmar</span>
          <span className="opacity-50">·</span>
          <Kbd className="h-5 px-1 text-[10px]">Esc</Kbd>
          <span>para cancelar</span>
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
            disabled={!valid || confirming}
            onClick={onConfirm}
            className="flex-1"
          >
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QtyDialog;
