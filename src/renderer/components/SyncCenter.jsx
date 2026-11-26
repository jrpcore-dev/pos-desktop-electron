import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, KeyRound, MonitorSmartphone, RefreshCw, RotateCw, ShoppingCart, TriangleAlert, WifiOff, X } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { cn } from "@/lib/utils";
import { formatMXTime } from "../utils/dateUtils";
import { fmtMoney } from "../utils/format";
import { useToast } from "./ToastProvider";
import { STALE_STRONG_MS, visiblePending } from "../lib/replicaThresholds";
import * as notices from "../lib/syncNotices";

// Sincronización de la caja, sin ruido (decisión del dueño):
//   · Con el Host conectado y al día no se enseña nada (ya está el punto verde).
//   · "Subiendo" (ícono girando) sólo cuando el Host estuvo caído y vuelve,
//     mientras sube lo acumulado.
//   · Avisos flotantes abajo a la derecha; cerrarlos los guarda en la campana.

const INFO_MS = 6000;

const fmtAge = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "";
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

const heroGradient = "bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))]";

// Ficha del ícono: relieve con el color del estado (sólo con significado).
const TILE = {
  warning: "bg-gradient-to-br from-warning/20 to-warning/45 text-amber-800 ring-1 ring-inset ring-warning/25 shadow-[0_6px_14px_-6px_hsl(var(--warning)_/_0.6)] dark:text-warning",
  success: "bg-gradient-to-br from-success/15 to-success/35 text-success ring-1 ring-inset ring-success/25 shadow-[0_6px_14px_-6px_hsl(var(--success)_/_0.5)]",
  destructive: "bg-gradient-to-br from-destructive/15 to-destructive/35 text-destructive ring-1 ring-inset ring-destructive/25 shadow-[0_6px_14px_-6px_hsl(var(--destructive)_/_0.5)]",
  brand: cn(heroGradient, "text-primary-foreground shadow-[0_8px_16px_-6px_hsl(var(--primary)_/_0.55)]"),
};
const EYEBROW = {
  warning: "text-amber-700 dark:text-warning",
  success: "text-success",
  destructive: "text-destructive",
  brand: "text-primary dark:text-chart-2",
};
export const noticeCardStyles = {
  surface: "overflow-hidden rounded-[18px] border border-border bg-card text-foreground shadow-[0_1px_2px_hsl(222_47%_11%_/_0.06),0_10px_24px_-6px_hsl(222_47%_11%_/_0.16),0_28px_56px_-12px_hsl(222_47%_11%_/_0.14)]",
  icon: "flex size-[42px] shrink-0 items-center justify-center rounded-[13px]",
  brandTile: TILE.brand,
  eyebrow: "text-[10px] font-bold uppercase tracking-[0.1em]",
  brandEyebrow: EYEBROW.brand,
  title: "mt-0.5 text-[15px] font-bold leading-snug tracking-[-0.01em]",
};
const ICONS = {
  host: WifiOff,
  upload: RefreshCw,
  ok: Check,
  pin: KeyRound,
  review: TriangleAlert,
  stale: TriangleAlert,
  protocol: TriangleAlert,
  // Actualización de la app (UpdateButton).
  update: RotateCw,
  "update-sale": ShoppingCart,
  "update-host": MonitorSmartphone,
};

// ── Aviso flotante ──────────────────────────────────────────────────────────
export function NoticeCard({ n, onAction, onDismiss, hideIcon = false, children }) {
  const Icon = ICONS[n.key] || TriangleAlert;
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    setLeaving(true);
    window.setTimeout(() => onDismiss ? onDismiss() : notices.dismiss(n.key), 160);
  };
  useEffect(() => {
    if (!n.autoMs) return undefined;
    const t = window.setTimeout(close, n.autoMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id, n.autoMs]);
  return (
    <div
      role={n.tone === "destructive" || n.tone === "warning" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto w-[380px] max-w-[calc(100vw-32px)]",
        noticeCardStyles.surface,
        "transition-all duration-200 animate-in fade-in-0 slide-in-from-bottom-3",
        leaving && "translate-y-2 opacity-0",
      )}
    >
      <div className={cn("flex gap-3 p-4", n.progress == null && !n.body && !children && "items-center")}>
        {!hideIcon && (
          <span className={cn(noticeCardStyles.icon, TILE[n.tone])}>
            <Icon size={20} strokeWidth={2.3} className={n.spin ? "animate-spin" : undefined} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {n.eyebrow && (
            <p className={cn(noticeCardStyles.eyebrow, EYEBROW[n.tone])}>{n.eyebrow}</p>
          )}
          <p className={noticeCardStyles.title}>{n.title}</p>
          {n.body && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{n.body}</p>}
          {children}
          {n.progress != null && (
            <>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-primary/10 dark:bg-chart-2/20">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-chart-2 transition-[width] duration-500"
                  style={{ width: `${Math.max(6, Math.min(100, n.progress))}%` }}
                />
              </div>
              {n.progressLabel && (
                <p className="mt-1.5 text-xs font-semibold text-muted-foreground tabular-nums">{n.progressLabel}</p>
              )}
            </>
          )}
          {n.action && (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={() => (n.onAction ? n.onAction() : onAction(n))}>
                {n.action}
              </Button>
              {n.secondary && (
                <Button size="sm" variant="outline" onClick={() => n.onSecondary && n.onSecondary()}>
                  {n.secondary}
                </Button>
              )}
              {n.dismissLabel && (
                <button
                  type="button"
                  onClick={close}
                  className="cursor-pointer text-[13px] font-semibold text-primary hover:underline dark:text-chart-2"
                >
                  {n.dismissLabel}
                </button>
              )}
            </div>
          )}
        </div>
        {!n.spin && (
          <button
            type="button"
            onClick={close}
            aria-label={onDismiss ? "Cerrar novedades" : "Cerrar aviso (queda en la campana)"}
            className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        )}
      </div>
      {n.footer && (
        <div
          className={cn(
            "border-t px-4 py-2.5 text-xs font-semibold",
            n.tone === "warning"
              ? "border-warning/20 bg-warning/10 text-amber-800 dark:text-warning"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {n.footer}
        </div>
      )}
      {n.autoMs ? (
        <div className="h-[3px] bg-muted">
          <div
            className={cn("h-full origin-left", n.tone === "success" ? "bg-success" : "bg-primary")}
            style={{ animation: `sync-notice-timer ${n.autoMs}ms linear forwards` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Indicador de la barra ───────────────────────────────────────────────────
const PILL_DOT = {
  warning: "bg-warning/20 [&>span]:bg-amber-600 dark:[&>span]:bg-warning",
  destructive: "bg-destructive/15 [&>span]:bg-destructive",
  brand: "bg-primary/10 text-primary dark:bg-chart-2/20 dark:text-chart-2",
};

export default function SyncCenter({ children }) {
  const notify = useToast();
  const floating = useSyncExternalStore(notices.subscribe, notices.getFloating);
  const [status, setStatus] = useState(null);
  const [resync, setResync] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [busy, setBusy] = useState(false);
  // Subiendo lo acumulado tras volver el Host (sólo entonces gira el indicador).
  const [catchingUp, setCatchingUp] = useState(false);
  // Lo que pasó antes (para avisar sólo de los cambios).
  const prev = useRef({ known: false, down: false, downAt: 0, catchUp: null, needsAuth: 0, conflicts: 0, stale: false, protocol: "" });

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.invoke("get-server-status");
      setStatus(s);
    } catch (e) {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Resync completo (raro): el indicador gira mientras dura. La puesta al día
  // normal no se anuncia.
  useEffect(() => {
    if (!window.api || typeof window.api.on !== "function") return undefined;
    const off = window.api.on("replica-sync", (p) => {
      if (!p || !p.phase) return;
      if ((p.phase === "start" || p.phase === "progress") && p.kind === "resync") setResync(true);
      if (p.phase === "done" || p.phase === "error") {
        setResync(false);
        refresh();
      }
    });
    return typeof off === "function" ? off : undefined;
  }, [refresh]);

  const isClient = status && status.role === "client" && !status.host?.authIssue;
  const pending = isClient ? visiblePending(status) : { count: 0 };
  const ops = (isClient && status.pendingOps) || { count: 0 };
  const total = (Number(pending.count) || 0) + (Number(ops.count) || 0);
  const hostDown = isClient && status.host?.reachable === false;
  const hostBusy = isClient && status.host?.busy === true;
  const needsAuth = (Number(pending.needsAuth) || 0) + (Number(ops.needsAuth) || 0);
  const conflicts = (Number(pending.conflicts) || 0) + (Number(ops.conflicts) || 0);
  // Lo que está en revisión no sube solo: no cuenta para "subiendo".
  const toUpload = Math.max(0, total - conflicts);
  const staleMs = isClient ? status.replica?.stale_ms : null;
  const stale = !hostDown && staleMs != null && staleMs > STALE_STRONG_MS;
  const protocol = isClient ? String(status.protocolWarning || "").trim() : "";

  // Avisos: sólo cuando algo cambia.
  useEffect(() => {
    if (!isClient) return;
    const p = prev.current;
    const now = Date.now();
    // Primera lectura: si ya estaba sin Host, se avisa; lo demás se toma como base.
    if (hostDown && !p.down) {
      p.down = true;
      p.downAt = now;
      p.catchUp = null;
      notices.resolve("upload");
      notices.show({
        key: "host",
        tone: "warning",
        eyebrow: "Sin conexión",
        title: "Sigues vendiendo normal",
        body: "Todo se guarda en esta caja y sube solo cuando vuelva el Host.",
        footer: "Abrir y cerrar caja esperan al Host",
      });
    } else if (!hostDown && p.down) {
      p.down = false;
      notices.resolve("host");
      const away = now - p.downAt;
      if (toUpload > 0) {
        p.catchUp = { start: toUpload, away };
      } else if (p.known) {
        notices.show({
          key: "ok",
          tone: "success",
          title: "Conexión recuperada",
          body: `Todo al día · ${fmtAge(away)} sin Host`,
          autoMs: INFO_MS,
          silent: true,
        });
      }
    }
    // Subiendo lo acumulado (sólo tras volver el Host).
    if (p.catchUp && !hostDown) {
      if (toUpload > 0) {
        const done = Math.max(0, p.catchUp.start - toUpload);
        notices.show({
          key: "upload",
          tone: "brand",
          eyebrow: "Conexión recuperada",
          title: "Subiendo lo de esta caja",
          progress: (done / Math.max(1, p.catchUp.start)) * 100,
          progressLabel: `${done} de ${p.catchUp.start}`,
          spin: true,
          silent: true,
        });
      } else {
        const { start, away } = p.catchUp;
        p.catchUp = null;
        notices.resolve("upload");
        notices.show({
          key: "ok",
          tone: "success",
          title: "Todo al día",
          body: `Se subieron ${start} cambio(s) · ${fmtAge(away)} sin Host`,
          autoMs: INFO_MS,
          silent: true,
        });
      }
    }
    if (needsAuth > 0 && p.needsAuth === 0) {
      notices.show({
        key: "pin",
        tone: "warning",
        eyebrow: "Sesión",
        title: "Ingresa tu PIN para subir",
        body: `${needsAuth} venta(s) o cambio(s) esperan tu PIN. Puedes seguir vendiendo mientras.`,
        action: "Ingresar PIN",
        dismissLabel: "Más tarde",
      });
    } else if (needsAuth === 0 && p.needsAuth > 0) notices.resolve("pin");
    if (conflicts > p.conflicts) {
      notices.show({
        key: "review",
        tone: "destructive",
        eyebrow: "En revisión",
        title: conflicts === 1 ? "El Host rechazó 1 cambio" : `El Host rechazó ${conflicts} cambios`,
        body: "Lo demás sigue subiendo. Revisa el motivo para decidir qué hacer.",
        action: "Revisar",
        dismissLabel: "Ver después",
      });
    } else if (conflicts === 0 && p.conflicts > 0) notices.resolve("review");
    if (stale && !p.stale) {
      notices.show({
        key: "stale",
        tone: "warning",
        eyebrow: "Datos de esta caja",
        title: `Actualizados hace ${fmtAge(staleMs)}`,
        body: "Catálogo y precios pueden estar desactualizados. Se sigue vendiendo.",
      });
    } else if (!stale && p.stale) notices.resolve("stale");
    if (protocol && protocol !== p.protocol) {
      notices.show({ key: "protocol", tone: "warning", eyebrow: "Versión", title: "Versión distinta del Host", body: protocol });
    }
    p.needsAuth = needsAuth;
    p.conflicts = conflicts;
    p.stale = stale;
    p.protocol = protocol;
    p.known = true;
    setCatchingUp(!!p.catchUp);
  }, [isClient, hostDown, toUpload, needsAuth, conflicts, stale, staleMs, protocol]);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const [sales, opsList] = await Promise.all([
        window.api.invoke("pending-sales-list"),
        window.api.invoke("pending-ops-list"),
      ]);
      const saleRows = (Array.isArray(sales) ? sales : [])
        .filter((r) => !["synced", "cancelled"].includes(r.status))
        .map((r) => ({
          key: `s-${r.id}`,
          kind: "Venta",
          label: `${r.folio} · ${fmtMoney(Number(r.payload?.total) || 0)}`,
          at: r.localCreatedAt,
          status: r.status,
          error: r.lastError,
          cancel: () => window.api.invoke("pending-sales-cancel", r.id),
        }));
      const opRows = (Array.isArray(opsList) ? opsList : []).map((o) => ({
        key: `o-${o.id}`,
        kind: KIND_OF(o.channel),
        label: o.label || o.channel,
        at: o.createdAt,
        status: o.status,
        error: o.lastError,
        cancel: () => window.api.invoke("pending-ops-cancel", o.id),
      }));
      setRows([...opRows, ...saleRows].sort((a, b) => String(a.at).localeCompare(String(b.at))));
    } catch (e) {
      setRows([]);
    }
    setLoadingRows(false);
  }, []);

  const openDetail = useCallback(() => {
    setDetailOpen(true);
    loadRows();
  }, [loadRows]);

  const syncNow = async () => {
    setBusy(true);
    try {
      const a = await window.api.invoke("pending-ops-sync-now");
      const b = await window.api.invoke("pending-sales-sync-now");
      if (a?.stop === "SESSION_EXPIRED" || b?.stop === "SESSION_EXPIRED") {
        window.dispatchEvent(new Event("vendia:reauth"));
      } else if ((a && a.success === false && a.stop) || (b && b.success === false)) {
        notify("El Host no respondió; se reintentará solo", "error");
      }
      await loadRows();
      await refresh();
    } catch (e) {
      notify("No se pudo sincronizar", "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelRow = async (row) => {
    setBusy(true);
    try {
      const res = await row.cancel();
      if (res && res.success === false) notify("Eso ya no se puede quitar", "error");
      await loadRows();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onAction = (n) => {
    if (n.key === "pin") {
      notices.dismiss("pin");
      window.dispatchEvent(new Event("vendia:reauth"));
    } else if (n.key === "review") {
      notices.dismiss("review");
      openDetail();
    }
  };

  // La campana abre el detalle desde un aviso guardado.
  useEffect(() => {
    const open = () => openDetail();
    window.addEventListener("vendia:sync-detail", open);
    return () => window.removeEventListener("vendia:sync-detail", open);
  }, [openDetail]);

  // Los avisos flotantes también sirven en el Host (p. ej. la actualización);
  // el indicador y el detalle son sólo de la caja.
  const floatingLayer = createPortal(
    <div className="pointer-events-none fixed bottom-6 right-6 z-[1250] flex flex-col-reverse items-end gap-3">
      {floating.map((n) => (
        <NoticeCard key={n.id} n={n} onAction={onAction} />
      ))}
      {children}
    </div>,
    document.body,
  );
  if (!isClient) return floatingLayer;

  // Estado del indicador (nada si todo va bien).
  const uploading = catchingUp && toUpload > 0;
  const pill = hostDown
    ? { tone: "warning", label: "Sin Host", extra: total ? `${total} en la caja` : null }
    : resync
      ? { tone: "brand", label: "Actualizando datos", spin: true }
      : uploading
        ? { tone: "brand", label: `Subiendo ${toUpload}`, spin: true }
        : needsAuth > 0
          ? { tone: "warning", label: "Pide PIN" }
          : conflicts > 0
            ? { tone: "destructive", label: `Revisar ${conflicts}` }
            : hostBusy
              ? { tone: "warning", label: "Host ocupado" }
              : null;

  return (
    <>
      {pill && (
        <button
          type="button"
          onClick={openDetail}
          aria-label={`Sincronización: ${pill.label}${pill.extra ? `, ${pill.extra}` : ""}`}
          className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-card pl-2.5 pr-3.5 text-[13px] font-semibold text-foreground shadow-[0_1px_2px_hsl(222_47%_11%_/_0.06),0_4px_10px_-2px_hsl(222_47%_11%_/_0.08)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring animate-in fade-in-0 zoom-in-95"
        >
          <span className={cn("flex size-[22px] items-center justify-center rounded-full", PILL_DOT[pill.tone])}>
            {pill.spin ? <RefreshCw size={12} strokeWidth={3} className="animate-spin" /> : <span className="size-2 rounded-full" />}
          </span>
          {pill.label}
          {pill.extra && <span className="hidden font-medium text-muted-foreground lg:inline">· {pill.extra}</span>}
        </button>
      )}

      {floatingLayer}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-xl overflow-hidden p-0">
          <div className={cn(heroGradient, "px-6 pb-5 pt-6 text-primary-foreground")}>
            <DialogHeader className="space-y-1 text-left">
              <DialogDescription className="text-xs font-semibold text-primary-foreground/75">
                Sincronización de esta caja
              </DialogDescription>
              <DialogTitle className="text-3xl font-bold tracking-tight text-primary-foreground">
                {total === 0 ? "Todo al día" : `${total} por subir`}
              </DialogTitle>
              <p className="text-xs text-primary-foreground/80">
                {hostDown
                  ? "Sin conexión con el Host · todo se guarda aquí"
                  : "Conectado al Host · se sube en orden y sin duplicados"}
              </p>
            </DialogHeader>
          </div>
          <div className="max-h-[50vh] overflow-y-auto px-2 py-2">
            {loadingRows ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No hay nada pendiente.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {rows.map((r) => {
                  const st = STATE_OF(r.status);
                  return (
                    <li key={r.key} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground/80">
                        {r.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{r.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.at ? formatMXTime(r.at) : ""}
                          {r.status === "conflict" && r.error ? ` · ${r.error}` : ""}
                        </p>
                      </div>
                      <span className={cn("shrink-0 text-xs font-semibold", st.cls)}>{st.label}</span>
                      {["pending", "needs_auth", "conflict"].includes(r.status) && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelRow(r)} title="Quitar antes de que suba">
                          <X size={14} />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={syncNow} disabled={busy || hostDown || total === 0} title={hostDown ? "El Host no responde" : undefined}>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              Sincronizar ahora
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Campana · sección "Sincronización de esta caja" ─────────────────────────
// Los avisos cerrados (o que se fueron solos y valía la pena guardar).
export const useSyncSaved = () => useSyncExternalStore(notices.subscribe, notices.getSaved);
export const markSyncRead = () => notices.markAllRead();

const BELL_DOT = { warning: "bg-warning", destructive: "bg-destructive", success: "bg-success", brand: "bg-primary" };

export function SyncBellSection({ onOpenDetail }) {
  const saved = useSyncSaved();
  if (!saved.length) return null;
  return (
    <section className="border-b border-border">
      <div className="flex items-center px-4 pb-1 pt-3">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sincronización de esta caja
        </p>
        <button
          type="button"
          onClick={() => notices.clearSaved()}
          className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Limpiar
        </button>
      </div>
      <ul className="divide-y divide-border/60">
        {saved.slice(0, 6).map((n) => (
          <li key={`${n.key}-${n.savedAt}`}>
            <button
              type="button"
              onClick={onOpenDetail}
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                !n.resolved && (n.tone === "warning" || n.tone === "destructive") && "bg-warning/[0.06]",
              )}
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  n.resolved ? "bg-muted-foreground/30" : BELL_DOT[n.tone] || "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {n.eyebrow ? `${n.eyebrow} · ` : ""}
                  {n.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {n.resolved ? "Resuelto" : n.body}
                  {n.times > 1 ? ` · ${n.times} veces` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {formatMXTime(new Date(n.savedAt).toISOString())}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND_OF = (channel) => {
  const c = String(channel || "");
  if (c.includes("customer-price") || c.includes("tier-price")) return "Precio";
  if (c.includes("customer")) return "Cliente";
  if (c.includes("product")) return "Producto";
  if (c.includes("category")) return "Categoría";
  if (c.includes("supplier")) return "Proveedor";
  if (c.includes("stock")) return "Stock";
  if (c.includes("cash-expense")) return "Retiro";
  if (c.includes("cash-income")) return "Entrada";
  return "Cambio";
};

const STATE_OF = (s) =>
  s === "syncing"
    ? { label: "Subiendo", cls: "text-primary dark:text-chart-2" }
    : s === "needs_auth"
      ? { label: "Pide PIN", cls: "text-amber-700 dark:text-warning" }
      : s === "conflict"
        ? { label: "Revisar", cls: "text-destructive" }
        : { label: "En espera", cls: "text-muted-foreground" };
