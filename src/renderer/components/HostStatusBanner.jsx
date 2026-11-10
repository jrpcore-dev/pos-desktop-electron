import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2Off, MonitorSmartphone } from "lucide-react";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm";
import { cn } from "@/lib/utils";
import { useDbChanges } from "../lib/useDbChanges";

// Bloque 4/D · Estado visible de la caja: Host caído ≠ Host ocupado, datos
// viejos a los 30 min / 4 h y ventas pendientes. NADA de esto bloquea vender.

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
  const navigate = useNavigate();
  const [relinkOpen, setRelinkOpen] = useState(false);
  const [status, setStatus] = useState(null);
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

  // Lo de sincronización (sin Host, subiendo, PIN, revisión) vive en
  // SyncCenter: indicador en la barra y avisos flotantes que se pueden cerrar.
  return null;
}
