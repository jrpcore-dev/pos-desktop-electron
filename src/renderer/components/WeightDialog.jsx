import React, { useEffect, useMemo, useRef, useState } from "react";
import { Scale } from "lucide-react";
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

// Hasta 999.999 kg.
const MAX_DIGITS = 6;

const QUICK_WEIGHTS = [
  { label: "¼ kg", value: "0.250" },
  { label: "½ kg", value: "0.500" },
  { label: "1 kg", value: "1.000" },
];

const WeightDialog = ({
  open,
  onClose,
  product,
  weightAmount,
  onWeightChange,
  onConfirm,
  isDark = false,
  // { stable, overload } mientras el peso viene de la báscula; null si es manual.
  scaleStatus = null,
  // Precio especial del cliente: manda sobre el de lista y su descuento.
  customerPrice = null,
}) => {
  const inputRef = useRef(null);
  const typedDecimal = useRef(false);
  const kg = parseFloat(weightAmount) || 0;
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState("weight");
  const [amount, setAmount] = useState("");
  const byAmount = mode === "amount";
  // Sólo se cobra un peso de báscula ya estabilizado.
  const scaleBlocked =
    !!scaleStatus && (scaleStatus.overload || !scaleStatus.stable);

  const effectivePrice = useMemo(() => {
    if (!product) return 0;
    if (customerPrice != null) return customerPrice;
    const disc = product.discount_percent || 0;
    return product.price * (1 - disc / 100);
  }, [product, customerPrice]);

  useEffect(() => {
    setConfirming(false);
    setMode("weight");
    setAmount("");
    typedDecimal.current = false;
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
      if (confirming || scaleBlocked) return;
      setConfirming(true);
      setTimeout(() => setConfirming(false), 400);
      onConfirm();
    }
  };

  // Los dígitos entran por la derecha, en gramos: 100 → 0.100, 1500 → 1.500.
  const handleChange = (e) => {
    const raw = e.target.value.replace(",", ".");
    if (raw === "") {
      typedDecimal.current = false;
      onWeightChange("");
      return;
    }
    if (typedDecimal.current || e.nativeEvent.inputType === "insertFromPaste") {
      if (/^\d*\.?\d{0,3}$/.test(raw)) {
        typedDecimal.current = true;
        onWeightChange(raw);
      }
      return;
    }
    const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length > MAX_DIGITS) return;
    if (!digits) {
      onWeightChange("");
      return;
    }
    const padded = digits.padStart(4, "0");
    onWeightChange(`${padded.slice(0, -3)}.${padded.slice(-3)}`);
  };

  // Quien escribe el punto lo hace a mano: lo anterior son kilos enteros y
  // 1.5 sigue siendo 1.500, no 0.015.
  const handleDecimalKey = (e) => {
    if ((e.key !== "." && e.key !== ",") || typedDecimal.current) return;
    e.preventDefault();
    const input = e.currentTarget;
    const allSelected =
      input.value.length > 0 &&
      input.selectionEnd - input.selectionStart === input.value.length;
    const kilos = allSelected
      ? 0
      : parseInt(input.value.replace(/\D/g, ""), 10) || 0;
    typedDecimal.current = true;
    onWeightChange(`${kilos}.`);
  };

  const focusInput = () => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const changeMode = (next) => {
    setMode(next);
    setAmount("");
    typedDecimal.current = false;
    onWeightChange("");
    focusInput();
  };

  const pickWeight = (value) => {
    typedDecimal.current = false;
    onWeightChange(value);
    focusInput();
  };

  // "Dame $50": el peso sale del importe y del precio con descuento.
  const handleAmountChange = (e) => {
    const value = e.target.value.replace(",", ".");
    if (!/^\d*\.?\d{0,2}$/.test(value)) return;
    setAmount(value);
    const money = parseFloat(value) || 0;
    onWeightChange(money > 0 ? (money / effectivePrice).toFixed(3) : "");
  };

  const total = kg > 0 ? effectivePrice * kg : 0;
  const hasValue = weightAmount !== "" && weightAmount !== undefined;
  const errorMessage =
    hasValue && kg <= 0 ? "El peso debe ser mayor a 0 kg." : "";

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
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold leading-tight">
            <Scale size={22} className="shrink-0 text-primary" />
            {product?.name ?? "Peso del producto"}
          </DialogTitle>
        </DialogHeader>

        {product && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
                {fmtMoney(customerPrice ?? product.price)} / kg
              </span>
              {customerPrice == null && product.discount_percent > 0 && (
                <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                  -{product.discount_percent}%
                </span>
              )}
            </div>

            {effectivePrice > 0 && (
              <Tabs value={mode} onValueChange={changeMode}>
                <TabsList className="grid h-10 w-full grid-cols-2">
                  <TabsTrigger value="weight" className="h-8 font-semibold">
                    Por peso
                  </TabsTrigger>
                  <TabsTrigger value="amount" className="h-8 font-semibold">
                    Por importe
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="weight-amount">
                {byAmount ? "Importe a vender" : "Peso en kilogramos (kg)"}
              </Label>
              <div className="relative">
                <span
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground",
                    byAmount ? "left-4" : "right-4",
                  )}
                >
                  {byAmount ? "$" : "kg"}
                </span>
                <Input
                  id="weight-amount"
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  placeholder={byAmount ? "0.00" : "0.000"}
                  value={byAmount ? amount : weightAmount}
                  onChange={byAmount ? handleAmountChange : handleChange}
                  onKeyDown={byAmount ? undefined : handleDecimalKey}
                  aria-invalid={!!errorMessage}
                  aria-describedby={
                    errorMessage ? "weight-amount-error" : undefined
                  }
                  className={cn(
                    "h-16 rounded-xl bg-field text-right text-3xl font-bold tabular-nums",
                    byAmount ? "pl-10 pr-4" : "pl-4 pr-14",
                  )}
                />
              </div>
              {scaleStatus?.overload ? (
                <p
                  role="alert"
                  className="text-center text-xs font-medium text-destructive"
                >
                  Sobrecarga en la báscula: retira peso.
                </p>
              ) : scaleStatus ? (
                <p
                  aria-live="polite"
                  className={cn(
                    "text-center text-xs font-medium",
                    scaleStatus.stable ? "text-success" : "text-warning"
                  )}
                >
                  {scaleStatus.stable
                    ? "Peso estable · desde la báscula"
                    : "Estabilizando peso…"}
                </p>
              ) : errorMessage ? (
                <p
                  id="weight-amount-error"
                  role="alert"
                  className="text-center text-xs font-medium text-destructive"
                >
                  {errorMessage}
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  {byAmount
                    ? "Escribe cuánto quiere llevar el cliente en dinero"
                    : "Escribe los gramos: 100 = 0.100 kg"}
                </p>
              )}
            </div>

            {!byAmount && (
              <div className="grid grid-cols-3 gap-2">
                {QUICK_WEIGHTS.map(({ label, value }) => (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    onClick={() => pickWeight(value)}
                    className={cn(
                      "h-11 font-semibold",
                      kg === parseFloat(value) &&
                        "border-chart-2 bg-primary/10 text-primary ring-2 ring-chart-2/40",
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}

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
              <p className="text-[2.75rem] font-extrabold leading-tight text-foreground tabular-nums">
                {fmtMoney(total)}
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {fmtMoney(effectivePrice)} × {kg.toFixed(3)} kg
              </p>
            </div>
          </div>
        )}

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
            disabled={!weightAmount || kg <= 0 || confirming || scaleBlocked}
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
