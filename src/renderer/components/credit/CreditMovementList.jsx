import React, { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Hint } from "../ui/hint";
import { Spinner } from "../ui/spinner";
import { InitialsAvatar } from "../ui/initials-avatar";
import { fmtMoney, fmtQty } from "../../utils/format";

// Movimientos de fiado (ver src/main/credit.js), compartidos por la cuenta de
// un cliente (CustomerCreditSheet) y el historial general de Clientes.

export const TYPE_LABEL = {
  initial: "Saldo inicial",
  charge: "Venta fiada",
  payment: "Abono",
  reversal: "Cancelación / devolución",
  adjustment: "Ajuste",
};

export const METHOD_LABEL = { cash: "EFECTIVO", card: "TARJETA", transfer: "TRANSFERENCIA" };

const TZ = "America/Mexico_City";
const asDate = (sqlDate) => new Date(`${String(sqlDate).replace(" ", "T")}Z`);
const dayKey = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });

const fmtTime = (sqlDate) =>
  asDate(sqlDate).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

// "Hoy", "Ayer" o "12 nov" (con año si no es el actual).
const dayLabel = (key) => {
  const now = new Date();
  if (key === dayKey(now)) return "Hoy";
  if (key === dayKey(new Date(now.getTime() - 86400000))) return "Ayer";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    ...(y !== now.getFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
};

// Agrupa (ya ordenados del más nuevo al más viejo) por día de México.
export const groupByDay = (movements) => {
  const groups = [];
  for (const m of movements || []) {
    const key = dayKey(asDate(m.created_at));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, label: dayLabel(key), items: [m] });
  }
  return groups;
};

// La nota sólo se muestra si dice algo más que el tipo o el folio.
const extraNote = (m) => {
  if (!m.note || m.note === TYPE_LABEL[m.type]) return "";
  if (m.type === "charge") {
    const paid = m.note.match(/pagó (\$[\d,.]+)/);
    return paid ? `pagó ${paid[1]} al momento` : "";
  }
  if (m.type === "reversal" || m.type === "payment") return m.note === "Liquidación" ? "Liquidación" : "";
  return m.note;
};

// Productos de una venta fiada, cargados al abrirlos.
const SaleItems = ({ saleId }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const toggle = async (e) => {
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    if (!next || items) return;
    const res = await window.api.invoke("get-sale-details", saleId);
    if (res?.success) setItems(res.items || []);
    else setError(res?.error || "No se pudieron cargar los productos");
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} aria-hidden />
        {open ? "Ocultar productos" : items ? `Ver productos (${items.length})` : "Ver productos"}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg bg-muted/50 px-3 py-2">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : !items ? (
            <Spinner size={14} />
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin productos</p>
          ) : (
            <ul className="space-y-1">
              {items.map((it) => {
                const price = Number(it.price_at_sale) || 0;
                const line = price * (Number(it.quantity) || 0) * (1 - (Number(it.discount_percent) || 0) / 100);
                return (
                  <li key={it.id} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtQty(it.quantity)}×</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{it.name || it.product_name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtMoney(line)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// Un movimiento. Con `showCustomer` lleva avatar y nombre del cliente y, si
// hay `onOpenCustomer`, toda la fila abre su cuenta.
export const CreditMovementItem = ({ m, showCustomer = false, onOpenCustomer }) => {
  const up = m.amount > 0;
  const note = extraNote(m);
  const clickable = showCustomer && !!onOpenCustomer;
  const open = () => clickable && onOpenCustomer({ id: m.customer_id, name: m.customer_name });

  return (
    <li
      onClick={clickable ? open : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }
          : undefined
      }
      tabIndex={clickable ? 0 : undefined}
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        clickable &&
          "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
      )}
    >
      {showCustomer ? (
        <InitialsAvatar id={m.customer_id} name={m.customer_name || "?"} className="mt-0.5" />
      ) : (
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            up ? "bg-destructive/10 text-destructive dark:text-red-400" : "bg-success/12 text-success",
          )}
          aria-hidden
        >
          {up ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {showCustomer && (
          <p className="truncate text-sm font-semibold text-foreground">
            {m.customer_name || "Cliente eliminado"}
          </p>
        )}
        <p className={cn("text-sm text-foreground", showCustomer ? "font-normal" : "font-medium")}>
          {TYPE_LABEL[m.type] || m.type}
          {m.method && (
            <span className="text-muted-foreground"> · {METHOD_LABEL[m.method]?.toLowerCase()}</span>
          )}
          {m.folio && <span className="text-muted-foreground tabular-nums"> · {m.folio}</span>}
        </p>
        {note && <p className="truncate text-xs text-muted-foreground">{note}</p>}
        <p className="text-xs tabular-nums text-muted-foreground">
          {fmtTime(m.created_at)}
          {m.cashier_name ? ` · ${m.cashier_name}` : ""}
        </p>
        {m.type === "charge" && m.sale_id && <SaleItems saleId={m.sale_id} />}
      </div>

      <div className="shrink-0 text-right">
        {/* $0: cancelación de una venta que ya estaba pagada (no mueve el saldo). */}
        <p
          className={cn(
            "text-[15px] font-bold tabular-nums",
            m.amount === 0
              ? "text-muted-foreground"
              : up
                ? "text-destructive dark:text-red-400"
                : "text-success",
          )}
        >
          {m.amount === 0 ? "" : up ? "+" : "−"}
          {fmtMoney(Math.abs(m.amount))}
        </p>
        {m.balance_after != null && (
          <Hint label="Saldo del cliente después de este movimiento" side="left">
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              queda {fmtMoney(Math.max(m.balance_after, 0))}
            </p>
          </Hint>
        )}
      </div>
    </li>
  );
};

// Lista agrupada por día con encabezados fijos al desplazar.
export const CreditMovementList = ({ movements, showCustomer = false, onOpenCustomer, className }) => (
  <div className={className}>
    {groupByDay(movements).map((g) => (
      <section key={g.key}>
        <h4 className="sticky top-0 z-[1] border-b border-border bg-muted/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
          {g.label}
        </h4>
        <ul className="divide-y divide-border">
          {g.items.map((m) => (
            <CreditMovementItem key={m.id} m={m} showCustomer={showCustomer} onOpenCustomer={onOpenCustomer} />
          ))}
        </ul>
      </section>
    ))}
  </div>
);
