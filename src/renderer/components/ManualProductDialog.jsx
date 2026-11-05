import React, { useEffect, useRef, useState } from "react";
import { QrCode, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/utils/format";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";

// Los últimos productos sin código, por caja.
const RECENTS_KEY = "manualProductRecents";
const MAX_RECENTS = 6;

const readRecents = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((r) => r?.name && Number(r.price) > 0)
      : [];
  } catch {
    return [];
  }
};

const writeRecent = (name, price) => {
  try {
    const key = name.toLowerCase();
    const next = [
      { name, price },
      ...readRecents().filter((r) => r.name.toLowerCase() !== key),
    ].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
};

const ManualProductDialog = ({
  open,
  onClose,
  name,
  price,
  onNameChange,
  onPriceChange,
  onConfirm,
  // Crear productos del catálogo es del propietario.
  canSaveToCatalog = false,
}) => {
  const nameRef = useRef(null);
  const priceRef = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [recents, setRecents] = useState([]);
  const [saveToCatalog, setSaveToCatalog] = useState(false);

  useEffect(() => {
    setConfirming(false);
    setSaveToCatalog(false);
    if (open) setRecents(readRecents());
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

  const confirm = () => {
    writeRecent(trimmedName, priceNum);
    onConfirm({ saveToCatalog: canSaveToCatalog && saveToCatalog });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && valid) {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      setConfirming(true);
      setTimeout(() => setConfirming(false), 400);
      confirm();
    }
  };

  // Llena nombre y precio; queda en el precio por si cambió, y Enter agrega.
  const pickRecent = (recent) => {
    onNameChange(recent.name);
    onPriceChange(Number(recent.price).toFixed(2));
    setTimeout(() => {
      priceRef.current?.focus();
      priceRef.current?.select();
    }, 0);
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
          {recents.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Recientes</p>
              <div className="flex flex-wrap gap-1.5">
                {recents.map((recent) => (
                  <Button
                    key={recent.name}
                    type="button"
                    variant="outline"
                    onClick={() => pickRecent(recent)}
                    className={cn(
                      "h-9 max-w-full gap-1.5 px-2.5 font-semibold",
                      trimmedName.toLowerCase() === recent.name.toLowerCase() &&
                        "border-chart-2 bg-primary/10 text-primary ring-2 ring-chart-2/40",
                    )}
                  >
                    <span className="truncate">{recent.name}</span>
                    <span className="shrink-0 text-xs font-medium tabular-nums opacity-70">
                      {fmtMoney(recent.price)}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}
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
                ref={priceRef}
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
          {canSaveToCatalog && (
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="manual-product-save"
                checked={saveToCatalog}
                onCheckedChange={(v) => setSaveToCatalog(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="manual-product-save" className="block cursor-pointer">
                Guardar en el catálogo
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Se crea con stock 0; complétalo después en Productos.
                </span>
              </Label>
            </div>
          )}
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
            onClick={confirm}
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