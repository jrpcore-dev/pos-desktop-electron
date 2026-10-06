import { useMemo, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { EmptyState } from "../ui/empty-state";
import { Spinner } from "../ui/spinner";
import { cn } from "@/lib/utils";
import { formatMXDate, formatMXTime } from "@/utils/dateUtils";
import { money, sumBy } from "./serviceMoney";
import { NEEDS_ATTENTION, maskInput } from "./serviceStatus";
import { ServicesEmptyArt } from "./serviceIcons";
import ServiceStatusBadge from "./ServiceStatusBadge";
import { OperatorIcon } from "./OperatorIcon";

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "attention", label: "Por atender" },
  { key: "applied", label: "Aplicadas" },
  { key: "failed", label: "Fallidas" },
  { key: "reversed", label: "Revertidas" },
];

// El filtro "Por atender" junta `failed` y `unknown` porque son los dos únicos
// estados en los que el cajero tiene que hacer algo.
const ServiceHistory = ({ transactions, onRetry, busyFolio }) => {
  const [filter, setFilter] = useState("attention");

  const filtered = useMemo(() => {
    const rows = transactions || [];
    if (filter === "all") return rows;
    if (filter === "attention") {
      return rows.filter((t) => NEEDS_ATTENTION.includes(t.status));
    }
    return rows.filter((t) => t.status === filter);
  }, [transactions, filter]);

  const totals = useMemo(() => {
    const rows = transactions || [];
    const settled = rows.filter((t) => t.status === "applied");
    return {
      cobrado: sumBy(settled, (t) => t.quote?.totalCents),
      movimientos: rows.length,
      pendientes: rows.filter((t) => NEEDS_ATTENTION.includes(t.status)).length,
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
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[6rem]">Fecha</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead className="w-[10rem]">Folio</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-[8rem]">Estado</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => {
                const retryable = NEEDS_ATTENTION.includes(t.status);
                return (
                  <TableRow key={t.folio}>
                    <TableCell className="text-[11px] text-muted-foreground">
                      <span className="block tabular-nums">
                        {formatMXDate(t.createdAt, {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                      <span className="block tabular-nums">
                        {formatMXTime(t.createdAt)}
                      </span>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <OperatorIcon
                          id={t.operatorKey}
                          name={t.operatorName}
                          size="sm"
                          className="max-h-5 max-w-8"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-foreground">
                            {t.operatorName}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {t.productName}
                            {t.inputValue ? ` · ${maskInput(t.inputValue)}` : ""}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-[11px] tabular-nums text-muted-foreground">
                      {t.folio}
                    </TableCell>

                    <TableCell className="text-right text-[13px] font-semibold tabular-nums text-foreground">
                      {money(t.quote?.totalCents)}
                    </TableCell>

                    <TableCell>
                      <ServiceStatusBadge status={t.status} />
                    </TableCell>

                    <TableCell className="text-right">
                      {retryable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyFolio === t.folio}
                          onClick={() => onRetry?.(t)}
                          title="Reintentar con el mismo folio"
                        >
                          {busyFolio === t.folio ? (
                            <Spinner size={13} />
                          ) : (
                            <RefreshCw size={13} />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          El reintento reutiliza el folio original para no cobrar dos veces.
        </p>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone }) => (
  <div className="rounded-lg border border-border bg-card px-3 py-2">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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