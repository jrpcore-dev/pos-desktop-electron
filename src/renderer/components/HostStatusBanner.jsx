import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CloudOff, Database, KeyRound, Link2Off, MonitorSmartphone, RefreshCw, TimerReset, X } from "lucide-react";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm";
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
import { useToast } from "./ToastProvider";
import { useDbChanges } from "../lib/useDbChanges";
import { PENDING_ADMIN_MS, STALE_STRONG_MS, STALE_WARN_MS, visiblePending } from "../lib/replicaThresholds";

// Bloque 4/D · Estado visible de la caja: Host caído ≠ Host ocupado, datos
// viejos a los 30 min / 4 h y ventas pendientes. NADA de esto bloquea vender.

const fmtAge = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
};

const heroGradient =
  "bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))]";

const TILE = {
  warning: "bg-warning text-warning-foreground shadow-[0_8px_16px_-6px_hsl(var(--warning)_/_0.6)]",
  destructive: "bg-destructive text-destructive-foreground shadow-[0_8px_16px_-6px_hsl(var(--destructive)_/_0.6)]",
  brand: "bg-primary-foreground/15 text-primary-foreground",
};

// Todas las alertas de arriba de la app son esta tarjeta: mismo cuadro de ícono
// y mismo sitio para las acciones. El color sólo dice qué tan grave es.
const AlertCard = ({ tone = "warning", icon: Icon, spin = false, title, extra, children, actions }) => {
  const brand = tone === "brand";
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-center gap-4 rounded-2xl border px-4 py-3.5",
        brand
          ? cn(heroGradient, "border-transparent text-primary-foreground shadow-[0_18px_32px_-16px_hsl(222_47%_11%_/_0.6)]")
          : "bg-card text-foreground shadow-[0_1px_2px_hsl(222_47%_11%_/_0.05),0_14px_28px_-14px_hsl(222_47%_11%_/_0.22)]",
        !brand && (tone === "destructive" ? "border-destructive/35" : "border-border"),
      )}
    >
      <span className={cn("flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl", TILE[tone])}>
        <Icon size={24} className={spin ? "animate-spin" : undefined} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-snug">{title}</p>
        {extra}
        <p className={cn("mt-0.5 text-sm leading-snug", brand ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {children}
        </p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
};

export default function HostStatusBanner() {
  const notify = useToast();
  const navigate = useNavigate();
  const [relinkOpen, setRelinkOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  // Sincronización en curso que avisa main por `replica-sync` (resync entero
  // o puesta al día al conectar). null = nada en curso.
  const [sync, setSync] = useState(null);

  // Fase 5 · en el Host este aviso nunca se muestra: se deja de sondear en
  // cuanto se sabe el rol. Un fallo de lectura conserva el último estado en
  // vez de esconder el aviso (esconderlo parecía "todo bien").
  const timerRef = useRef(null);
  const refresh = useCallback(async () => {
    try {
      const s = await window.api.invoke("get-server-status");
      setStatus(s);
    } catch (e) {
      // Se reintenta en el siguiente ciclo con el estado anterior en pantalla.
    }
  }, []);

  // Una caja que pide emparejarse llega al momento; el sondeo la respalda.
  useDbChanges(refresh, ["paired_devices"]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 10000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [refresh]);

  // Avisos de sincronización: un banner mientras corre y un toast al terminar,
  // para que el cajero sepa que los datos se están trayendo del Host y cuándo
  // quedaron al día. La puesta al día silenciosa (0 cambios, flujo normal)
  // no avisa: sólo hace ruido.
  useEffect(() => {
    if (!window.api || typeof window.api.on !== "function") return undefined;
    const off = window.api.on("replica-sync", (p) => {
      if (!p || !p.phase) return;
      if (p.phase === "start" || p.phase === "progress") {
        // La puesta al día suele durar milisegundos: sólo el resync pinta banner.
        if (p.kind === "resync") setSync({ done: Number(p.done) || 0 });
        return;
      }
      setSync(null);
      if (p.phase === "error") {
        notify("No se pudieron sincronizar los datos con el Host; se reintentará solo", "error");
        refresh();
        return;
      }
      if (p.kind === "resync") {
        notify("Datos sincronizados con el Host", "success");
      } else if (p.applied > 0) {
        notify(
          `${p.wasDown ? "Conexión con el Host restablecida · " : ""}${p.applied} cambio(s) sincronizado(s)`,
          "success",
        );
      } else if (p.wasDown) {
        notify("Conexión con el Host restablecida · datos al día", "success");
      } else if (p.firstConnect) {
        notify("Conectado al Host · datos al día", "success");
      }
      refresh();
    });
    return typeof off === "function" ? off : undefined;
  }, [notify, refresh]);

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
      const res = await window.api.invoke("pending-sales-cancel", id);
      if (res && res.success === false) notify("Esa venta ya no se puede cancelar", "error");
      await loadRows();
      await refresh();
    } catch (e) {
      notify("No se pudo cancelar la venta", "error");
    } finally {
      setBusyAction(false);
    }
  };

  const syncNow = async () => {
    setBusyAction(true);
    try {
      const res = await window.api.invoke("pending-sales-sync-now");
      if (res?.stop === "SESSION_EXPIRED") {
        notify("La sesión con el Host venció: vuelve a iniciar sesión para subir las ventas", "error");
      } else if (res && res.success === false) {
        notify(res.error || "El Host no respondió; se reintentará solo", "error");
      } else if (res?.conflicts) {
        notify(`${res.conflicts} venta(s) quedaron en revisión`, "error");
      } else if (res?.synced) {
        notify(`${res.synced} venta(s) sincronizada(s)`, "success");
      }
      await loadRows();
      await refresh();
    } catch (e) {
      notify("No se pudo sincronizar", "error");
    } finally {
      setBusyAction(false);
    }
  };

  // Host · cajas esperando aprobación: se queda visible en cualquier pantalla
  // hasta que el administrador decida.
  const pendingDevices = status?.pendingDevices || [];
  if (status && status.role !== "client") {
    if (!pendingDevices.length) {
      const failure = status.pairFailure;
      if (!failure) return null;
      return (
        <AlertCard
          icon={MonitorSmartphone}
          title={
            failure.type === "invalid_code"
              ? `${failure.deviceName} intentó vincularse con un código incorrecto`
              : `${failure.deviceName} no se pudo registrar`
          }
          actions={
            <Button size="sm" onClick={() => navigate("/configuration", { state: { tab: "mobile" } })}>
              Ver código
            </Button>
          }
        >
          {failure.type === "invalid_code"
            ? "No se creó ninguna solicitud. Compártele el código completo de 16 caracteres."
            : `No se creó ninguna solicitud. ${failure.reason ? `Motivo: ${failure.reason}` : "El detalle quedó en el log del Host."}`}
        </AlertCard>
      );
    }
    const first = pendingDevices[0];
    return (
      <AlertCard
        icon={MonitorSmartphone}
        title={
          pendingDevices.length === 1
            ? `${first.deviceName}${first.deviceCode ? ` (${first.deviceCode})` : ""} espera tu aprobación`
            : `${pendingDevices.length} cajas esperan tu aprobación`
        }
        actions={
          <Button size="sm" onClick={() => navigate("/configuration", { state: { tab: "mobile" } })}>
            Revisar
          </Button>
        }
      >
        No podrá vender ni descargar datos hasta que la apruebes.
      </AlertCard>
    );
  }

  if (!status) return null;

  const authIssue = status.host?.authIssue || null;
  if (authIssue) {
    const pendingApproval = authIssue === "pending";
    return (
      <>
        <AlertCard
          icon={Link2Off}
          title={pendingApproval ? "Esta caja espera aprobación en el Host" : "El Host ya no reconoce esta caja"}
          actions={
            !pendingApproval && (
              <Button size="sm" onClick={() => setRelinkOpen(true)}>
                Volver a vincular
              </Button>
            )
          }
        >
          {pendingApproval
            ? "Hasta que el Host la apruebe no podrá registrar ventas ni sincronizar."
            : "No podrá registrar ventas ni sincronizar hasta volver a vincularla con el código de activación."}
        </AlertCard>
        <ConfirmDialog
          open={relinkOpen}
          onOpenChange={setRelinkOpen}
          title="Volver a vincular esta caja"
          description="Se pedirá el código de activación y luego la aprobación en el Host; hasta entonces esta caja no podrá vender. Las ventas pendientes se conservan y suben después."
          confirmLabel="Vincular de nuevo"
          cancelLabel="Ahora no"
          variant="default"
          iconColor="warning"
          onConfirm={async () => {
            await window.api.invoke("replica-reset");
            window.location.reload();
          }}
        />
      </>
    );
  }

  const host = status.host || {};
  const pending = visiblePending(status);
  // Paso 2 · entradas/salidas de stock hechas aquí que aún no llegan al Host.
  const pendingOps = status.pendingOps || { count: 0 };
  const opsConflicts = Number(pendingOps.conflicts) || 0;
  const stale = status.replica?.stale_ms;
  const hostDown = host.reachable === false;
  const busy = host.busy === true;
  const pendingOld = pending.oldestAgeMs != null && pending.oldestAgeMs > PENDING_ADMIN_MS;
  const staleWarn = stale != null && stale > STALE_WARN_MS;
  const staleStrong = stale != null && stale > STALE_STRONG_MS;
  const protocolWarning = String(status.protocolWarning || "").trim();
  // Fase 5 · ventas que esperan PIN: la cola no sube sola hasta un login.
  const needsAuth = Number(pending.needsAuth) || 0;
  // También por sondeo: si el aviso de inicio llegó antes de montar la pantalla.
  const syncing = !hostDown && (!!sync || status.replica?.state === "downloading");

  if (!hostDown && !busy && !pending.count && !pendingOps.count && !staleWarn && !protocolWarning && !syncing)
    return null;

  if (syncing && !busy && !pending.count && !pendingOps.count && !protocolWarning) {
    return (
      <AlertCard tone="brand" icon={RefreshCw} spin title="Sincronizando datos con el Host…">
        Catálogo, precios y clientes{sync?.done ? ` (${sync.done.toLocaleString("es-MX")} registros)` : ""}. Puedes seguir vendiendo.
      </AlertCard>
    );
  }

  const tone = hostDown || staleStrong || pendingOld ? "destructive" : "warning";

  const Icon = hostDown
    ? CloudOff
    : needsAuth
      ? KeyRound
      : staleStrong || staleWarn
        ? Database
        : busy
          ? TimerReset
          : AlertTriangle;

  const protocolLine = `Versión distinta del Host: ${protocolWarning}`;
  const title = hostDown
    ? "Host desconectado · puedes seguir vendiendo"
    : busy
      ? "Host ocupado (importando datos) · no es una caída"
      : needsAuth > 0
        ? `${needsAuth} venta(s) esperan que inicies sesión de nuevo para subir`
        : pending.count > 0
          ? `${pending.count} venta(s) pendiente(s) de subir${pending.oldestAgeMs != null ? ` · la más antigua hace ${fmtAge(pending.oldestAgeMs)}` : ""}`
          : pendingOps.count > 0
            ? opsConflicts > 0
              ? `${opsConflicts} movimiento(s) de inventario rechazado(s) por el Host · revisa Movimientos`
              : `${pendingOps.count} movimiento(s) de inventario por subir al Host`
            : staleWarn
              ? `Datos de esta caja actualizados hace ${fmtAge(stale)}`
              : protocolLine;
  const detail = hostDown
    ? "Las ventas se guardan en esta caja y suben solas al reconectar. Abrir/cerrar caja y gastos requieren Host."
    : needsAuth
      ? "La sesión con el Host venció. Cierra sesión y vuelve a entrar con tu PIN; las ventas suben solas."
      : pendingOld
        ? "Llevan más de 1 hora sin subir: avisa al administrador. No cierres la caja."
        : busy
          ? "Puedes vender con normalidad; la sincronización se reanuda al terminar."
          : staleStrong
            ? "El catálogo y los precios pueden estar muy desactualizados. Se sigue vendiendo; no se bloquea."
            : staleWarn
              ? "Catálogo y precios pueden estar desactualizados. Se sigue vendiendo; no se bloquea."
              : "Están a salvo en esta caja; no cierres la caja hasta que la cola esté vacía.";

  return (
    <>
      <AlertCard
        tone={tone}
        icon={Icon}
        title={title}
        extra={
          protocolWarning && title !== protocolLine ? (
            <p className="text-sm font-semibold">{protocolLine}</p>
          ) : null
        }
        actions={
          pending.count > 0 ? (
            <>
              <Button size="sm" variant="outline" onClick={openPending}>
                Ver ventas
              </Button>
              {!hostDown && (
                <Button size="sm" onClick={syncNow} disabled={busyAction}>
                  <RefreshCw size={14} className={busyAction ? "animate-spin" : ""} />
                  Sincronizar
                </Button>
              )}
            </>
          ) : null
        }
      >
        {detail}
      </AlertCard>

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
            <Button
              onClick={syncNow}
              disabled={busyAction || hostDown}
              title={hostDown ? "El Host no responde" : undefined}
            >
              <RefreshCw size={14} className={busyAction ? "animate-spin" : ""} />
              Sincronizar ahora
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
