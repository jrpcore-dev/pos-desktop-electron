import React, { useEffect, useState } from "react";
import { HandCoins, ShieldAlert, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import { fmtMoney } from "../utils/format";
import { PAY_METHODS } from "./CustomerCreditSheet";

// Cobro "Fiado" en la terminal: muestra lo que debe, esta venta y el nuevo
// saldo; permite dejar algo a cuenta (pago parcial al momento). Si rebasa el
// límite pide el PIN de un propietario. Los abonos sueltos NO van aquí: se
// hacen en Clientes.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const CreditSaleDialog = ({ open, onClose, customer, total, onConfirm, busy }) => {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (!open || !customer) return;
    setInfo(null);
    setError("");
    setPaid("");
    setMethod("cash");
    setPin("");
    window.api
      .invoke("get-customer-credit", { customerId: customer.id })
      .then((res) => {
        if (res?.success) setInfo(res);
        else setError(res?.error || "No se pudo consultar la cuenta");
      })
      .catch(() => setError("No se pudo consultar la cuenta"));
  }, [open, customer]);

  const paidNum = Math.min(parseFloat(paid) || 0, total);
  const charge = round2(total - paidNum);
  const previous = info?.balance || 0;
  const newBalance = round2(previous + charge);
  const limit = info?.limit || 0;
  const overLimit = limit > 0 && newBalance > limit;
  const paidCoversAll = paidNum >= total - 0.004;
  const canConfirm =
    !!info && !busy && charge > 0 && !paidCoversAll && (!overLimit || pin.length >= 4);

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm({
      creditPaid: paidNum > 0 ? round2(paidNum) : 0,
      creditPaidMethod: paidNum > 0 ? method : null,
      ownerPin: overLimit ? pin : undefined,
      preview: { previous, charge, newBalance },
    });
  };

  const Row = ({ label, value, strong, tone }) => (
    <div className="flex items-baseline justify-between">
      <span className={cn("text-sm", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-xl font-bold" : "text-base font-semibold",
          tone || "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins size={20} />
            Fiado a {customer?.name}
          </DialogTitle>
          <DialogDescription>
            La parte fiada se carga a su cuenta. Los abonos se registran en Clientes.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive dark:text-red-400">
            <WifiOff size={16} className="mt-0.5 shrink-0" />
            <span>{error}. El fiado requiere conexión con el Host: cobra con otro método.</span>
          </div>
        ) : !info ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-4">
              <Row label="Debe hoy" value={fmtMoney(previous)} />
              <Row label="Esta venta" value={fmtMoney(total)} />
              {paidNum > 0 && (
                <Row label="Paga ahora" value={`−${fmtMoney(paidNum)}`} tone="text-success" />
              )}
              <div className="my-1 border-t border-dashed border-border" />
              <Row
                label="Nuevo saldo"
                value={fmtMoney(newBalance)}
                strong
                tone={overLimit ? "text-destructive dark:text-red-400" : "text-foreground"}
              />
              <p className="text-right text-xs text-muted-foreground">
                {limit > 0 ? `Límite ${fmtMoney(limit)}` : "Sin límite"}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="credit-sale-paid">Deja a cuenta (opcional)</Label>
              <div className="flex gap-2">
                <Input
                  id="credit-sale-paid"
                  inputMode="decimal"
                  autoFocus
                  value={paid}
                  onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setPaid(e.target.value)}
                  placeholder="0.00"
                  className="h-11 flex-1 text-base tabular-nums"
                />
                {PAY_METHODS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    disabled={!(paidNum > 0)}
                    onClick={() => setMethod(key)}
                    className={cn(
                      "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      method === key && paidNum > 0
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon size={17} />
                  </button>
                ))}
              </div>
              {paidCoversAll && (
                <p className="text-xs text-destructive dark:text-red-400">
                  Eso cubre toda la venta: cóbrala con otro método.
                </p>
              )}
            </div>

            {overLimit && (
              <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-warning">
                  <ShieldAlert size={16} />
                  Rebasa el límite por {fmtMoney(newBalance - limit)}
                </p>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="PIN del propietario"
                  className="h-11 tabular-nums"
                  aria-label="PIN del propietario"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="h-12 flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="h-12 flex-[2] bg-success text-base font-bold text-success-foreground hover:bg-success/90"
            disabled={!canConfirm}
            onClick={confirm}
          >
            Fiar {fmtMoney(charge)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreditSaleDialog;
