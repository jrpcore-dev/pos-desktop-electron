import React, { useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  PackageMinus,
  Percent,
  ShoppingBasket,
  Snail,
  Tag,
  TrendingUp,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Hint } from "./ui/hint";
import { useToast } from "./ToastProvider";

// Un aviso de la bandeja "Avisos del negocio" (fila dentro de una lista con
// divisores). Según `type` muestra sus acciones (ver src/main/smart-alerts.js):
//   expiry     → Reducir (merma) · Rebajar · Ya no hay
//   slow_stock → por producto: Rebajar / Promoción (abre el producto en
//                Inventario, en esa sección)
//   reorder    → sólo recomendación
//   otros      → "Ver detalle" navega a su ruta (pulso semanal)

const DISCOUNTS = [10, 20, 30, 50];

// Avisos que piden hacer algo; el resto son sugerencias.
export const ACTIONABLE_TYPES = ["expiry", "slow_stock"];

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

// "hace 5 min", "hace 2 h", "ayer", "hace 3 d" desde un DATETIME UTC de SQLite.
const timeAgo = (sqlDate) => {
  if (!sqlDate) return "";
  const ms = Date.now() - new Date(`${String(sqlDate).replace(" ", "T")}Z`).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} d`;
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

const InsightItem = ({ insight, isAdmin, cashierId, onResolved, onNavigate, onOpenProduct }) => {
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

  const ownerOnly = isAdmin ? null : "Solo el propietario";

  return (
    <li className="group px-4 py-3 text-left transition-colors hover:bg-muted/40">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", meta.cls)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{insight.title}</p>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {timeAgo(insight.created_at)}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{insight.body}</p>
        </div>
        <Hint label="Descartar">
          <button
            type="button"
            aria-label="Descartar aviso"
            disabled={busy}
            onClick={() => act({ action: "dismiss" })}
            className="-mr-1.5 -mt-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </Hint>
      </div>

      {/* ─── Caducidad ─── */}
      {insight.type === "expiry" && (
        <div className="mt-2.5 space-y-2 pl-11">
          <div className="flex flex-wrap gap-1.5">
            <Hint label={ownerOnly || "Sacar del inventario como merma"}>
              <Button
                size="sm"
                variant={panel === "reduce" ? "default" : "outline"}
                className="h-7 gap-1 px-2.5"
                disabled={busy || !isAdmin}
                onClick={() => setPanel(panel === "reduce" ? null : "reduce")}
              >
                <PackageMinus /> Reducir
              </Button>
            </Hint>
            <Hint label={ownerOnly || "Poner en rebaja hasta su caducidad"}>
              <Button
                size="sm"
                variant={panel === "discount" ? "default" : "outline"}
                className="h-7 gap-1 px-2.5"
                disabled={busy || !isAdmin}
                onClick={() => setPanel(panel === "discount" ? null : "discount")}
              >
                <Percent /> Rebajar
              </Button>
            </Hint>
            <Hint label="Ese lote ya se vendió o ya no está">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2.5 text-muted-foreground"
                disabled={busy}
                onClick={() =>
                  act({ action: "cleared" }, { success: () => "Listo, ya no se avisará de ese lote." })
                }
              >
                <Check /> Ya no hay
              </Button>
            </Hint>
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

      {/* ─── Stock sin movimiento: atajos al producto ─── */}
      {insight.type === "slow_stock" && (
        <div className="mt-2.5 pl-11">
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-muted/20">
            {(payload.items || []).map((item) => (
              <li key={item.productId} className="flex items-center gap-2 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{item.name}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {item.stockLabel}
                    {item.value > 0 && ` · $${item.value.toLocaleString("es-MX")} detenidos`}
                  </p>
                </div>
                <Hint label="Poner un descuento al producto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 px-2 text-xs [&_svg]:size-3.5"
                    onClick={() => onOpenProduct(item.productId, "discount")}
                  >
                    <Percent /> Rebajar
                  </Button>
                </Hint>
                <Hint label="Crear una promoción por cantidad (2×1, mayoreo…)">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 px-2 text-xs [&_svg]:size-3.5"
                    onClick={() => onOpenProduct(item.productId, "promo")}
                  >
                    <Tag /> Promoción
                  </Button>
                </Hint>
              </li>
            ))}
          </ul>
          {payload.more > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              y {payload.more} {payload.more === 1 ? "producto más" : "productos más"}
            </p>
          )}
        </div>
      )}

      {/* ─── Pedido sugerido (sólo recomendación) ─── */}
      {insight.type === "reorder" && (
        <ul className="mt-2 space-y-1 pl-11">
          {(payload.items || []).map((item) => (
            <li key={item.productId} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-foreground">
                {item.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {item.daysLeft <= 0 ? "ya casi no hay" : `~${item.daysLeft} d`}
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
          className="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 pl-11 text-xs font-semibold text-primary hover:underline"
          onClick={() => onNavigate(insight)}
        >
          Ver detalle <ChevronRight className="size-3.5" />
        </button>
      )}
    </li>
  );
};

export default InsightItem;
