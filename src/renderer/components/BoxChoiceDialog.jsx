import React, { useEffect, useMemo, useRef, useState } from "react";
import { Store, Box, Package, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";

const BoxChoiceDialog = ({
  open,
  onClose,
  product,
  onConfirm,
  containerNoun = "Caja",
  piecesPer = "piezas por caja",
  boxPrice,
  packPrice,
  piecePrice,
  boxQty,
  packQty,
  saleUnit,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const cardRefs = useRef([]);

  const options = useMemo(() => {
    const list = [];
    if (boxQty > 0) {
      list.push({
        key: "box",
        Icon: Box,
        title: containerNoun,
        price: boxPrice,
        desc: `${boxQty} pz · ${piecesPer}`,
        badge: `${boxQty}pz`,
      });
    }
    if (saleUnit === "boxpack" && packQty > 0) {
      list.push({
        key: "pack",
        Icon: Package,
        title: "Paquete",
        price: packPrice,
        desc: `${packQty} piezas por paquete`,
        badge: `${packQty}pz`,
      });
    }
    list.push({
      key: "piece",
      Icon: CircleDashed,
      title: "Pieza",
      price: piecePrice,
      desc: "Precio unitario",
      badge: "1pz",
    });
    return list;
  }, [boxQty, packQty, saleUnit, containerNoun, boxPrice, packPrice, piecePrice, piecesPer]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setConfirming(false);
      const t = setTimeout(() => cardRefs.current[0]?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const selectOption = (idx) => {
    setActiveIndex(idx);
    cardRefs.current[idx]?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = (activeIndex - 1 + options.length) % options.length;
      selectOption(next);
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const next = (activeIndex + 1) % options.length;
      selectOption(next);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      const next = (activeIndex - 1 + options.length) % options.length;
      selectOption(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) return;
      const opt = options[activeIndex];
      if (opt) {
        setConfirming(true);
        setTimeout(() => setConfirming(false), 400);
        onConfirm(opt.key);
      }
    }
  };

  const priceLabel = (v) =>
    typeof v === "number" ? `$${v.toFixed(2)}` : "--";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store size={20} className="text-primary" />
            Seleccionar formato
          </DialogTitle>
        </DialogHeader>

        {product && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{product.name}</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                {boxQty > 0 && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
                    {containerNoun}: ${boxPrice?.toFixed(2)}
                  </span>
                )}
                {saleUnit === "boxpack" && packQty > 0 && (
                  <span className="rounded-full bg-secondary/20 px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground tabular-nums">
                    Paquete: ${packPrice?.toFixed(2)}
                  </span>
                )}
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  Pieza: ${piecePrice?.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              {options.map((opt, idx) => (
                <button
                  key={opt.key}
                  type="button"
                  ref={(el) => (cardRefs.current[idx] = el)}
                  onClick={() => onConfirm(opt.key)}
                  onFocus={() => setActiveIndex(idx)}
                  className={cn(
                    "group flex w-full cursor-pointer items-center justify-between rounded-xl border px-4 py-3.5 text-left transition-all duration-150 focus:outline-none",
                    activeIndex === idx
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border bg-background hover:border-primary/50 hover:bg-accent"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                        activeIndex === idx
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground group-hover:bg-accent"
                      )}
                    >
                      <opt.Icon size={18} />
                    </span>
                    <div>
                      <p className="font-bold text-foreground">{opt.title}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {opt.badge && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {opt.badge}
                      </span>
                    )}
                    <span className="text-lg font-extrabold text-foreground tabular-nums">
                      {priceLabel(opt.price)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BoxChoiceDialog;
