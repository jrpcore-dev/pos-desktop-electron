import React, { useState } from "react";
import {
  CalendarClock,
  Check,
  PackageMinus,
  Percent,
  ShoppingBasket,
  Snail,
  TrendingUp,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useToast } from "./ToastProvider";

// Un aviso de la bandeja "Avisos del negocio". Según `type` muestra sus
// acciones (ver src/main/smart-alerts.js):
//   expiry     → Reducir (merma) · Rebajar · Ya no hay
//   slow_stock → Rebajar por producto
//   reorder    → sólo recomendación (Entendido)
//   otros      → "Ver detalle" navega a su ruta (pulso semanal)

const DISCOUNTS = [10, 20, 30, 50];

const META = {
  expiry: { icon: CalendarClock, cls: "bg-warning/15 text-amber-600 dark:text-warning" },
  slow_stock: { icon: Snail, cls: "bg-info/12 text-info" },
  reorder: { icon: ShoppingBasket, cls: "bg-primary/10 text-primary" },
  weekly_pulse: { icon: TrendingUp, cls: "bg-success/12 text-success" },
};

const parsePayload = (raw) => {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

// Fila de porcentajes para "Rebajar".
const DiscountPicker = ({ onPick, busy }) => (
  <div className="flex items-center gap-1">
    {DISCOUNTS.map((pct) => (
      <button
        key={pct}
        type="button"
        disabled={busy}
        onClick={() => onPick(pct)}
        className="h-7 cursor-pointer rounded-md border border-warning/40 bg-warning/10 px-2 text-xs font-semibold text-amber-700 tabular-nums transition-colors hover:bg-warning/20 disabled:opacity-50 dark:text-warning"
      >
        {pct}%
      </button>
    ))}
  </div>
);

const InsightItem = ({ insight, isAdmin, cashierId, onResolved, onNavigate }) => {
  const notify = useToast();
  const payload = parsePayload(insight.payload);
  const meta = META[insight.type] || META.weekly_pulse;
  const Icon = meta.icon;
  const [busy, setBusy] = useState(false);
  // "reduce" | "discount" | `discount:<productId>` — panel abierto.
  const [panel, setPanel] = useState(null);
  const [qty, setQty] = useState(() =>
    payload.saleUnit === "weight" ? String(payload.qty ?? "") : String(Math.round(payload.qty || 0)),
  );

  const act = async (args, { resolves = true, success } = {}) => {
    setBusy(true);
    try {
      const res = await window.api.invoke("insight-action", {
        insightId: insight.id,
        role: isAdmin ? "admin" : "cashier",
        cashierId,
        ...args,
      });
      if (!res?.success) {
        notify(res?.error || "No se pudo aplicar la acción", "error");
        return;
      }
      if (success) notify(success(res), "success");
      setPanel(null);
      if (resolves) onResolved(insight.id);
    } finally {
      setBusy(false);
    }
  };

  const discountMsg = (res) =>
    `${res.productName}: rebaja del ${res.percent}% aplicada${
      insight.type === "expiry" ? " hasta su caducidad" : ""
    }.`;

  const adminOnly = !isAdmin ? "Solo el propietario" : undefined;

  return (
    <li className="rounded-lg border border-border bg-card p-3 text-left">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", meta.cls)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-foreground">{insight.title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{insight.body}</p>
        </div>
        <button
          type="button"
          aria-label="Descartar aviso"
          title="Descartar"
          disabled={busy}
          onClick={() => act({ action: "dismiss" })}
          className="-mr-1 -mt-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* ─── Caducidad ─── */}
      {insight.type === "expiry" && (
        <div className="mt-2.5 space-y-2 pl-9">
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={panel === "reduce" ? "default" : "outline"}
              className="h-7 gap-1 px-2.5"
              disabled={busy || !isAdmin}
              title={adminOnly || "Sacar del inventario como merma"}
              onClick={() => setPanel(panel === "reduce" ? null : "reduce")}
            >
              <PackageMinus /> Reducir
            </Button>
            <Button
              size="sm"
              variant={panel === "discount" ? "default" : "outline"}
              className="h-7 gap-1 px-2.5"
              disabled={busy || !isAdmin}
              title={adminOnly || "Poner en rebaja hasta su caducidad"}
              onClick={() => setPanel(panel === "discount" ? null : "discount")}
            >
              <Percent /> Rebajar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2.5 text-muted-foreground"
              disabled={busy}
              title="Ese lote ya se vendió o ya no está"
              onClick={() =>
                act({ action: "cleared" }, { success: () => "Listo, ya no se avisará de ese lote." })
              }
            >
              <Check /> Ya no hay
            </Button>
          </div>

          {panel === "reduce" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                step={payload.saleUnit === "weight" ? 0.001 : 1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-8 w-20 text-sm"
                aria-label="Cantidad a reducir"
              />
              <span className="text-xs text-muted-foreground">
                {payload.saleUnit === "weight" ? "kg" : "pzas"}
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto h-8"
                disabled={busy || !(Number(qty) > 0)}
                onClick={() =>
                  act(
                    { action: "reduce", qty: Number(qty) },
                    { success: (r) => `Merma registrada: ${r.reduced} de ${r.productName}.` },
                  )
                }
              >
                Confirmar merma
              </Button>
            </div>
          )}

          {panel === "discount" && (
            <DiscountPicker
              busy={busy}
              onPick={(pct) => act({ action: "discount", percent: pct }, { success: discountMsg })}
            />
          )}
        </div>
      )}

      {/* ─── Stock sin movimiento ─── */}
      {insight.type === "slow_stock" && (
        <ul className="mt-2.5 space-y-1.5 pl-9">
          {(payload.items || []).map((item) => {
            const key = `discount:${item.productId}`;
            return (
              <li key={item.productId} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-foreground">
                    {item.name}{" "}
                    <span className="text-muted-foreground tabular-nums">· {item.stockLabel}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy || !isAdmin}
                    title={adminOnly || "Poner en rebaja"}
                    onClick={() => setPanel(panel === key ? null : key)}
                    className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Rebajar
                  </button>
                </div>
                {panel === key && (
                  <div className="mt-1">
                    <DiscountPicker
                      busy={busy}
                      onPick={(pct) =>
                        act(
                          { action: "discount", productId: item.productId, percent: pct },
                          { resolves: false, success: discountMsg },
                        )
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
          {payload.more > 0 && (
            <li className="text-xs text-muted-foreground">y {payload.more} más</li>
          )}
        </ul>
      )}

      {/* ─── Pedido sugerido (sólo recomendación) ─── */}
      {insight.type === "reorder" && (
        <ul className="mt-2.5 space-y-1 pl-9">
          {(payload.items || []).map((item) => (
            <li key={item.productId} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-foreground">
                {item.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {item.daysLeft <= 0 ? "ya casi no hay" : `te alcanza ~${item.daysLeft} d`}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-foreground tabular-nums">
                {item.suggestion}
              </span>
            </li>
          ))}
          {payload.more > 0 && (
            <li className="text-xs text-muted-foreground">y {payload.more} más</li>
          )}
        </ul>
      )}

      {/* ─── Pulso semanal y otros: navegar ─── */}
      {!["expiry", "slow_stock", "reorder"].includes(insight.type) && (
        <button
          type="button"
          className="mt-1.5 cursor-pointer pl-9 text-xs font-medium text-primary hover:underline"
          onClick={() => onNavigate(insight)}
        >
          Ver detalle →
        </button>
      )}
    </li>
  );
};

export default InsightItem;
