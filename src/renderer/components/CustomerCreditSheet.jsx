import React, { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  CreditCard,
  HandCoins,
  Landmark,
  Printer,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "./ToastProvider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetBrandHeader,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { CreditMovementList, METHOD_LABEL } from "./credit/CreditMovementList";
import { fmtMoney } from "../utils/format";
import { buildCreditPaymentHTML } from "../utils/receiptTemplate";

// Estado de cuenta de un cliente con fiado (ver src/main/credit.js).
// Los abonos de quien viene SOLO a pagar se hacen aquí, no en la terminal.

export const PAY_METHODS = [
  { key: "cash", label: "Efectivo", icon: Banknote },
  { key: "card", label: "Tarjeta", icon: CreditCard },
  { key: "transfer", label: "Transf.", icon: Landmark },
];

// Filtro rápido de la lista de movimientos.
const FILTERS = [
  { key: "all", label: "Todo", match: () => true },
  { key: "sales", label: "Ventas", match: (m) => m.type === "charge" || m.type === "reversal" },
  { key: "payments", label: "Abonos", match: (m) => m.type === "payment" },
];

// "hace 45 días" desde un DATETIME de SQLite (UTC).
export const debtAge = (sqlDate) => {
  if (!sqlDate) return "";
  const days = Math.floor((Date.now() - new Date(`${sqlDate.replace(" ", "T")}Z`).getTime()) / 86400000);
  if (days <= 0) return "desde hoy";
  if (days === 1) return "desde ayer";
  return `desde hace ${days} días`;
};

const money2 = (v) => /^\d*\.?\d{0,2}$/.test(v);

// `initialPanel`: "pay" abre directo el abono (p. ej. desde la paleta).
const CustomerCreditSheet = ({ customer, open, onClose, cashier, onChanged, initialPanel }) => {
  const notify = useToast();
  const isAdmin = cashier?.role === "admin";
  const [data, setData] = useState(null);
  const [panel, setPanel] = useState(null); // "pay" | "adjust"
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [printTicket, setPrintTicket] = useState(true);
  const [adjustSign, setAdjustSign] = useState(-1);
  const [adjustNote, setAdjustNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    if (!customer) return;
    const res = await window.api.invoke("get-customer-credit", { customerId: customer.id });
    if (res?.success) {
      setData(res);
      if (initialPanel === "pay" && res.balance > 0) setPanel((p) => p || "pay");
    }
    else notify(res?.error || "No se pudo cargar la cuenta", "error");
  }, [customer, notify, initialPanel]);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setPanel(null);
    setAmount("");
    setAdjustNote("");
    setFilter("all");
    load();
  }, [open, load]);

  const printPayment = async (res) => {
    try {
      const [storeName, paper] = await Promise.all([
        window.api.invoke("get-setting", "store_name"),
        window.api.invoke("get-setting", "paper_width_mm"),
      ]);
      const html = buildCreditPaymentHTML({
        store: { name: storeName },
        cashierName: cashier?.name || "",
        customerName: customer.name,
        previous: res.previous,
        amount: res.amount,
        methodLabel: METHOD_LABEL[res.method] || "",
        balance: res.balance,
        paperWidthMm: paper,
      });
      const out = await window.api.invoke("print-receipt", html);
      if (!out?.success) notify(out?.error || "No se pudo imprimir el comprobante", "error");
    } catch {
      notify("No se pudo imprimir el comprobante", "error");
    }
  };

  const submitPayment = async () => {
    const value = parseFloat(amount);
    if (!(value > 0)) return;
    setBusy(true);
    try {
      const res = await window.api.invoke("credit-payment", {
        customerId: customer.id,
        amount: value,
        method,
        cashierId: cashier?.id,
        cashierName: cashier?.name,
        role: cashier?.role,
        clientRequestId: crypto.randomUUID(),
      });
      if (!res?.success) {
        notify(res?.error || "No se pudo registrar el abono", "error");
        return;
      }
      notify(
        res.balance <= 0.004
          ? `Cuenta liquidada (${fmtMoney(res.amount)})`
          : `Abono de ${fmtMoney(res.amount)} · resta ${fmtMoney(res.balance)}`,
        "success",
      );
      if (!res.registerId && method === "cash") {
        notify("No hay caja abierta: este abono no entra a ningún corte.", "warning");
      }
      if (printTicket) printPayment(res);
      setPanel(null);
      setAmount("");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const submitAdjust = async () => {
    const value = parseFloat(amount);
    if (!(value > 0) || !adjustNote.trim()) return;
    setBusy(true);
    try {
      const res = await window.api.invoke("credit-adjust", {
        customerId: customer.id,
        amount: adjustSign * value,
        note: adjustNote.trim(),
        role: cashier?.role,
        cashierId: cashier?.id,
        cashierName: cashier?.name,
      });
      if (!res?.success) {
        notify(res?.error || "No se pudo ajustar", "error");
        return;
      }
      notify(`Saldo ajustado · ahora ${fmtMoney(res.balance)}`, "success");
      setPanel(null);
      setAmount("");
      setAdjustNote("");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const balance = data?.balance || 0;
  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const shown = data ? data.movements.filter(activeFilter.match) : [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetBrandHeader
          icon={<Wallet />}
          title={<>Cuenta de {customer?.name}</>}
          description={<>Fiado, abonos y movimientos</>}
        />

        <div className="flex-1 overflow-auto px-6 py-4">
          {/* ─── Saldo ─── */}
          {!data ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : (
            <div
              className={cn(
                "rounded-xl border p-4",
                balance > 0 ? "border-destructive/25 bg-destructive/[0.04]" : "border-border bg-muted/30",
              )}
            >
              <p className="text-sm font-medium text-muted-foreground">
                {balance > 0 ? "Debe" : "Saldo"}
              </p>
              <p
                className={cn(
                  "mt-1 text-3xl font-bold leading-none tracking-tight tabular-nums",
                  balance > 0 ? "text-destructive dark:text-red-400" : "text-foreground",
                )}
              >
                {fmtMoney(balance)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {balance > 0 ? debtAge(data.oldestDebtAt) : "Al corriente"}
                {" · "}
                {data.limit > 0 ? `Límite ${fmtMoney(data.limit)}` : "Sin límite"}
                {!data.enabled && " · Fiado desactivado"}
              </p>
              {data.hasMovements && (
                <div className="mt-3 flex gap-4 border-t border-border/70 pt-2.5 text-xs text-muted-foreground">
                  <span>
                    Fiado total{" "}
                    <b className="font-semibold tabular-nums text-foreground">{fmtMoney(data.totalCharged)}</b>
                  </span>
                  <span>
                    Abonado{" "}
                    <b className="font-semibold tabular-nums text-foreground">{fmtMoney(data.totalPaid)}</b>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ─── Acciones ─── */}
          {data && (
            <div className="mt-3 flex gap-2">
              <Button
                className="h-10 flex-1"
                variant={panel === "pay" ? "default" : "outline"}
                disabled={balance <= 0}
                onClick={() => {
                  setPanel(panel === "pay" ? null : "pay");
                  setAmount("");
                }}
              >
                <HandCoins /> Abonar
              </Button>
              {isAdmin && (
                <Button
                  className="h-10 flex-1"
                  variant={panel === "adjust" ? "default" : "outline"}
                  onClick={() => {
                    setPanel(panel === "adjust" ? null : "adjust");
                    setAmount("");
                  }}
                >
                  <SlidersHorizontal /> Ajustar
                </Button>
              )}
            </div>
          )}

          {panel === "pay" && (
            <div className="mt-3 space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="credit-pay-amount">Monto del abono</Label>
                  <button
                    type="button"
                    className="cursor-pointer text-xs font-semibold text-primary hover:underline"
                    onClick={() => setAmount(balance.toFixed(2))}
                  >
                    Liquidar todo ({fmtMoney(balance)})
                  </button>
                </div>
                <Input
                  id="credit-pay-amount"
                  inputMode="decimal"
                  autoFocus
                  value={amount}
                  onChange={(e) => money2(e.target.value) && setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-11 text-lg tabular-nums"
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {PAY_METHODS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMethod(key)}
                    className={cn(
                      "flex h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border text-xs font-semibold transition-colors",
                      method === key
                        ? "border-chart-2 bg-primary/10 text-primary ring-2 ring-chart-2/40"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
              {parseFloat(amount) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Resta:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {fmtMoney(Math.max(balance - parseFloat(amount), 0))}
                  </span>
                </p>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={printTicket} onCheckedChange={(v) => setPrintTicket(!!v)} />
                <Printer size={14} className="text-muted-foreground" />
                Imprimir comprobante
              </label>
              <Button
                className="h-11 w-full bg-success text-success-foreground hover:bg-success/90"
                disabled={busy || !(parseFloat(amount) > 0) || parseFloat(amount) > balance + 0.004}
                onClick={submitPayment}
              >
                Registrar abono
              </Button>
            </div>
          )}

          {panel === "adjust" && (
            <div className="mt-3 space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { sign: -1, label: "Disminuir deuda" },
                  { sign: 1, label: "Aumentar deuda" },
                ].map((o) => (
                  <button
                    key={o.sign}
                    type="button"
                    onClick={() => setAdjustSign(o.sign)}
                    className={cn(
                      "h-10 cursor-pointer rounded-lg border text-sm font-semibold transition-colors",
                      adjustSign === o.sign
                        ? "border-chart-2 bg-primary/10 text-primary ring-2 ring-chart-2/40"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => money2(e.target.value) && setAmount(e.target.value)}
                placeholder="Monto"
                className="h-11 tabular-nums"
                aria-label="Monto del ajuste"
              />
              <Input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="Motivo (obligatorio)"
                className="h-11"
                aria-label="Motivo del ajuste"
              />
              <Button
                className="h-11 w-full"
                disabled={busy || !(parseFloat(amount) > 0) || !adjustNote.trim()}
                onClick={submitAdjust}
              >
                Aplicar ajuste
              </Button>
            </div>
          )}

          {/* ─── Movimientos ─── */}
          <div className="mb-2 mt-6 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Movimientos</h3>
            {data?.hasMovements && (
              <Tabs value={filter} onValueChange={setFilter}>
                <TabsList className="h-8" aria-label="Filtrar movimientos">
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f.key} value={f.key} className="px-2.5 text-xs">
                      {f.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>
          {!data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              {data.hasMovements ? "Nada en este filtro" : "Sin movimientos todavía"}
            </p>
          ) : (
            <CreditMovementList
              movements={shown}
              className="overflow-clip rounded-xl border border-border bg-card"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CustomerCreditSheet;
