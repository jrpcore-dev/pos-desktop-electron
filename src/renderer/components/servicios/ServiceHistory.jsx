import { useMemo, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Spinner } from "../ui/spinner";
import { cn } from "@/lib/utils";
import { formatMXDate, formatMXTime, mxToday, toUTC } from "@/utils/dateUtils";
import { money, sumBy } from "./serviceMoney";
import { NEEDS_ATTENTION, maskInput } from "./serviceStatus";
import { ServicesEmptyArt } from "./serviceIcons";
import ServiceStatusBadge from "./ServiceStatusBadge";
import { OperatorIcon } from "./OperatorIcon";

// "hoy 14:32" para lo de hoy; "14/11 09:10" para lo anterior.
const whenLabel = (at) => {
  if (!at) return "";
  const day = new Date(toUTC(at)).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const prefix = day === mxToday() ? "hoy" : formatMXDate(at, { day: "2-digit", month: "2-digit" });
  return `${prefix} ${formatMXTime(at)}`;
};

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "attention", label: "Por atender" },
  { key: "applied", label: "Aplicadas" },
  { key: "failed", label: "Fallidas" },
  { key: "needs_review", label: "Por revisar" },
];

const needsAttention = (tx) =>
  NEEDS_ATTENTION.includes(tx.status) || (tx.saleId && tx.status === "pending");

const ServiceHistory = ({ transactions, onRetry, busyFolio }) => {
  const [filter, setFilter] = useState("attention");

  const filtered = useMemo(() => {
    const rows = transactions || [];
    if (filter === "all") return rows;
    if (filter === "attention") return rows.filter(needsAttention);
    return rows.filter((t) => t.status === filter);
  }, [transactions, filter]);

  const totals = useMemo(() => {
    const rows = transactions || [];
    const settled = rows.filter((t) => t.status === "applied");
    return {
      cobrado: sumBy(settled, (t) => t.quote?.totalCents),
      movimientos: rows.length,
      pendientes: rows.filter(needsAttention).length,
    };
  }, [transactions]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Cobrado" value={money(totals.cobrado)} />
        <Stat label="Movimientos" value={totals.movimientos} />
        <Stat
          label="Por atender"
          value={totals.pendientes}
          tone={totals.pendientes > 0 ? "warning" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Movimientos */}
      <div className="rounded-lg border border-border bg-card">
        {filtered.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<ServicesEmptyArt />}
            title={
              (transactions || []).length === 0
                ? "Todavía no hay movimientos"
                : "Nada en este filtro"
            }
            description={
              (transactions || []).length === 0
                ? "Las recargas y pagos que cobres aparecerán aquí con su estado."
                : "Prueba con otro filtro para ver el resto del historial."
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => {
              const retryable = t.status === "unknown" || t.status === "pending";
              return (
                <li key={t.transactionId || t.folio} className="flex items-center gap-3 px-4 py-3">
                  <OperatorIcon
                    id={t.operatorLogo || t.operatorKey}
                    remote={t.operatorRemoteLogo}
                    name={t.operatorName}
                    size="md"
                    className="w-14"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {t.operatorName}
                      {t.productName ? (
                        <span className="font-normal text-muted-foreground"> · {t.productName}</span>
                      ) : null}
                    </p>
                    {t.inputValue ? (
                      <p className="mt-0.5 truncate text-[13px] tabular-nums text-muted-foreground">
                        {maskInput(t.inputValue)}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-2.5">
                      <span className="text-[15px] font-bold tabular-nums text-foreground">
                        {money(t.quote?.totalCents)}
                      </span>
                      <ServiceStatusBadge status={t.status} />
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {whenLabel(t.createdAt)} · folio {t.folio}
                    </p>
                    {t.refundDueCents > 0 && (
                      <p className="mt-1 text-xs font-semibold text-destructive">
                        Por devolver {money(t.refundDueCents)}
                      </p>
                    )}
                    {t.providerRef && t.saleId && (
                      <p className="mt-1 text-xs text-muted-foreground">Referencia {t.providerRef}</p>
                    )}
                  </div>

                  <div className="flex w-9 shrink-0 justify-end">
                    {retryable && (
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-9"
                        disabled={busyFolio === t.folio}
                        onClick={() => onRetry?.(t)}
                        title="Consultar el estado con Taecel"
                        aria-label={`Consultar estado del folio ${t.folio}`}
                      >
                        {busyFolio === t.folio ? <Spinner size={14} /> : <RefreshCw size={14} />}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Consultar el estado pregunta a Taecel por la misma operación; nunca vuelve a cobrar.
        </p>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone }) => (
  <div className="rounded-lg border border-border bg-card px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
    <p
      className={cn(
        "mt-1 text-xl font-extrabold tabular-nums",
        tone === "success"
          ? "text-success"
          : tone === "warning"
            ? "text-warning"
            : "text-foreground",
      )}
    >
      {value}
    </p>
  </div>
);

export default ServiceHistory;
