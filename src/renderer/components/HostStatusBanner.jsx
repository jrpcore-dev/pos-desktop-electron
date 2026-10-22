import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff, Database, RefreshCw, TimerReset, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "@/lib/utils";
import { formatMXTime } from "../utils/dateUtils";
import { fmtMoney } from "../utils/format";

// Bloque 4/D · Estado visible de la caja: Host caído ≠ Host ocupado, datos
// viejos a los 30 min / 4 h y ventas pendientes. NADA de esto bloquea vender.
const STALE_WARN_MS = 30 * 60 * 1000;
const STALE_STRONG_MS = 4 * 60 * 60 * 1000;
const PENDING_ADMIN_MS = 60 * 60 * 1000;

const fmtAge = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
};

export default function HostStatusBanner() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.invoke("get-server-status");
      setStatus(s);
    } catch (e) {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.api.invoke("pending-sales-list");
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setRows([]);
    }
    setLoading(false);
  }, []);

  const openPending = async () => {
    setOpen(true);
    await loadRows();
  };

  const cancel = async (id) => {
    setBusyAction(true);
    try {
      await window.api.invoke("pending-sales-cancel", id);
      await loadRows();
      await refresh();
    } finally {
      setBusyAction(false);
    }
  };

  const syncNow = async () => {
    setBusyAction(true);
    try {
      await window.api.invoke("pending-sales-sync-now");
      await loadRows();
      await refresh();
    } finally {
      setBusyAction(false);
    }
  };

  if (!status || status.role !== "client") return null;

  const host = status.host || {};
  const pending = status.pending || { count: 0 };
  const stale = status.replica?.stale_ms;
  const hostDown = host.reachable === false;
  const busy = host.busy === true;
  const pendingOld = pending.oldestAgeMs != null && pending.oldestAgeMs > PENDING_ADMIN_MS;
  const staleWarn = stale != null && stale > STALE_WARN_MS;
  const staleStrong = stale != null && stale > STALE_STRONG_MS;
  const protocolWarning = String(status.protocolWarning || "").trim();

  if (!hostDown && !busy && !pending.count && !staleWarn && !protocolWarning)
    return null;

  const tone = hostDown
    ? "border-destructive/40 bg-destructive/[0.07] text-destructive"
    : staleStrong || pendingOld
      ? "border-destructive/40 bg-destructive/[0.06] text-destructive"
      : "border-warning/40 bg-warning/[0.08] text-warning";

  const Icon = hostDown ? CloudOff : staleStrong || staleWarn ? Database : busy ? TimerReset : AlertTriangle;

  return (
    <>
      <div className={cn("mb-4 flex items-start gap-3 rounded-lg border px-4 py-3", tone)}>
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {hostDown && (
            <p className="text-sm font-semibold">
              Host desconectado · puedes seguir vendiendo
            </p>
          )}
          {busy && !hostDown && (
            <p className="text-sm font-semibold">
              Host ocupado (importando datos) · no es una caída
            </p>
          )}
          {!hostDown && !busy && pending.count > 0 && (
            <p className="text-sm font-semibold">
              {pending.count} venta(s) pendiente(s) de subir
              {pending.oldestAgeMs != null ? ` · la más antigua hace ${fmtAge(pending.oldestAgeMs)}` : ""}
            </p>
          )}
          {!hostDown && !busy && !pending.count && staleWarn && (
            <p className="text-sm font-semibold">
              Datos de esta caja actualizados hace {fmtAge(stale)}
            </p>
          )}
          {protocolWarning && !hostDown && (
            <p className="text-sm font-semibold">
              Versión distinta del Host: {protocolWarning}
            </p>
          )}
          <p className="mt-0.5 text-xs opacity-90">
            {hostDown
              ? "Las ventas se guardan en esta caja y suben solas al reconectar. Abrir/cerrar caja y gastos requieren Host."
              : pendingOld
                ? "Llevan más de 1 hora sin subir: avisa al administrador. No cierres la caja."
                : busy
                  ? "Puedes vender con normalidad; la sincronización se reanuda al terminar."
                  : staleStrong
                    ? "El catálogo y los precios pueden estar muy desactualizados. Se sigue vendiendo; no se bloquea."
                    : staleWarn
                      ? "Catálogo y precios pueden estar desactualizados. Se sigue vendiendo; no se bloquea."
                      : "Están a salvo en esta caja; no cierres la caja hasta que la cola esté vacía."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pending.count > 0 && (
            <Button size="sm" variant="outline" onClick={openPending}>
              Ver ventas
            </Button>
          )}
          {pending.count > 0 && !hostDown && (
            <Button size="sm" variant="secondary" onClick={syncNow} disabled={busyAction}>
              <RefreshCw size={14} className={busyAction ? "animate-spin" : ""} />
              Sincronizar
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ventas pendientes de sincronizar</DialogTitle>
            <DialogDescription>
              Están guardadas en esta caja. Se suben en orden y sin duplicados;
              puedes cancelar una venta mientras siga en cola.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay ventas pendientes.
            </p>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Folio</th>
                    <th className="py-2 pr-3">Hora local</th>
                    <th className="py-2 pr-3">Cajero</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const cancelable = ["pending", "needs_auth", "conflict"].includes(r.status);
                    return (
                      <tr key={r.id} className="border-t border-border">
                        <td className="py-2 pr-3 font-semibold tabular-nums">{r.folio}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {r.localCreatedAt ? formatMXTime(r.localCreatedAt) : "—"}
                        </td>
                        <td className="py-2 pr-3">{r.cashierName || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {fmtMoney(Number(r.payload?.total) || 0)}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {r.status === "pending" && "En espera"}
                          {r.status === "syncing" && "Subiendo"}
                          {r.status === "needs_auth" && "Requiere PIN"}
                          {r.status === "conflict" && "Revisión"}
                          {r.status === "synced" && "Sincronizada"}
                          {r.status === "cancelled" && "Cancelada"}
                        </td>
                        <td className="py-2 text-right">
                          {cancelable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyAction}
                              onClick={() => cancel(r.id)}
                              title="Cancelar esta venta antes de que suba"
                            >
                              <X size={14} />
                              Cancelar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={syncNow} disabled={busyAction}>
              <RefreshCw size={14} className={busyAction ? "animate-spin" : ""} />
              Sincronizar ahora
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
