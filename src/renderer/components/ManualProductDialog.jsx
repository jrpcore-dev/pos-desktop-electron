import React, { useEffect, useRef, useState } from "react";
import { QrCode, PlusCircle } from "lucide-react";
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

const ManualProductDialog = ({
  open,
  onClose,
  name,
  price,
  onNameChange,
  onPriceChange,
  onConfirm,
}) => {
  const nameRef = useRef(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setConfirming(false);
  }, [open]);

  useEffect(() => {
    if (open && nameRef.current) {
      const t = setTimeout(() => nameRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const trimmedName = (name || "").trim();
  const priceNum = parseFloat(price) || 0;
  const nameError =
    (name || "") !== "" && !trimmedName
      ? "Escribe el nombre del producto."
      : "";
  const priceError =
    (price || "") !== "" && priceNum <= 0
      ? "El precio debe ser mayor a 0."
      : "";
  const valid = !!trimmedName && priceNum > 0;

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && valid) {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      setConfirming(true);
      setTimeout(() => setConfirming(false), 400);
      onConfirm();
    }
  };

  const handlePriceChange = (e) => {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) onPriceChange(v);
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
          <DialogTitle className="flex items-center gap-2">
            <QrCode size={20} className="text-primary" />
            Producto Sin Código
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="manual-product-name">Nombre del producto</Label>
            <Input
              id="manual-product-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Ej. Pan dulce"
              aria-invalid={!!nameError}
              aria-describedby={
                nameError ? "manual-product-name-error" : undefined
              }
              className="h-12 rounded-xl text-base"
            />
            {nameError && (
              <p
                id="manual-product-name-error"
                role="alert"
                className="text-xs font-medium text-destructive"
              >
                {nameError}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-product-price">Precio</Label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                $
              </span>
              <Input
                id="manual-product-price"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={price}
                onChange={handlePriceChange}
                aria-invalid={!!priceError}
                aria-describedby={
                  priceError ? "manual-product-price-error" : undefined
                }
                className="h-12 rounded-xl pl-9 text-right text-xl font-bold tabular-nums"
              />
            </div>
            {priceError ? (
              <p
                id="manual-product-price-error"
                role="alert"
                className="text-xs font-medium text-destructive"
              >
                {priceError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Precio de venta por pieza.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
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
            variant="outline"
            className="h-11 flex-1 border-success bg-success/5 text-success hover:bg-success/10 hover:text-success"
            disabled={!valid || confirming}
            onClick={onConfirm}
          >
            <PlusCircle size={16} />
            Agregar al Carrito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualProductDialog;