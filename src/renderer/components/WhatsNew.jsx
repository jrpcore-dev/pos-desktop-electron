import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, History, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { author, productName } from "../../../package.json";
import vendiaIcon from "@/assets/icon-vendia.svg";
import { useToast } from "./ToastProvider";
import { cn } from "@/lib/utils";
import { NoticeCard, noticeCardStyles } from "./SyncCenter";
import {
  currentRelease,
  hasUnseenRelease,
  installedReleaseHistory,
  installedVersion,
  markReleaseSeen,
} from "../lib/releaseNotes";

function ReleaseChanges({ changes }) {
  return (
    <ul className="divide-y divide-border">
      {changes.map(({ title, description }) => (
        <li key={title} className="min-w-0 px-4 py-3.5">
          <p className="text-sm font-semibold leading-snug text-foreground">{title}</p>
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function WhatsNewCard() {
  const [visible, setVisible] = useState(hasUnseenRelease);
  const navigate = useNavigate();
  if (!visible) return null;

  const dismiss = () => {
    markReleaseSeen();
    setVisible(false);
  };

  return (
    <NoticeCard
      onDismiss={dismiss}
      n={{
        key: "update",
        tone: "brand",
        eyebrow: "Actualización",
        title: `Novedades de Vendia ${installedVersion}`,
        action: "Entendido",
        onAction: dismiss,
        secondary: "Ver detalles",
        onSecondary: () => {
          dismiss();
          navigate("/configuration", { state: { tab: "about" } });
        },
      }}
    >
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-snug text-muted-foreground">
        {currentRelease.changes.map(({ title }) => <li key={title}>{title}</li>)}
      </ul>
    </NoticeCard>
  );
}

export function AboutVendia({ isBoxDevice }) {
  const notify = useToast();
  const deviceType = isBoxDevice === null ? null : isBoxDevice ? "Caja conectada" : "Equipo principal";

  const copySupportInfo = async () => {
    const details = [
      `${productName} ${installedVersion}`,
      deviceType && `Tipo de equipo: ${deviceType}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(details);
      notify("Datos de la instalación copiados", "success");
    } catch {
      notify("No se pudieron copiar los datos", "error");
    }
  };

  return (
    <div className="space-y-6">
      <section aria-label="Información de la aplicación" className={noticeCardStyles.surface}>
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <img src={vendiaIcon} alt="" className="size-16 shrink-0 sm:size-20" />
          <div className="min-w-0 flex-1">
            <h3 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{productName}</h3>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Punto de venta e inventario</p>
          </div>
          <Badge variant="soft-primary">Versión {installedVersion}</Badge>
        </div>
        <dl className="grid gap-x-6 gap-y-4 border-t border-border p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Tipo de equipo</dt>
            <dd className="mt-1 font-medium">{deviceType || "Consultando…"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Desarrollado por</dt>
            <dd className="mt-1 font-medium">{author.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Correo de soporte</dt>
            <dd className="mt-1 break-words font-medium">{author.email}</dd>
          </div>
        </dl>
        <div className="px-4 pb-4">
          <Button variant="outline" size="sm" onClick={copySupportInfo}>
            <Copy size={14} aria-hidden />
            Copiar datos de la instalación
          </Button>
        </div>
      </section>

      {installedReleaseHistory.length > 0 && (
        <section aria-labelledby="vendia-release-history" className="space-y-3">
          <h3 id="vendia-release-history" className="flex items-center gap-2 text-sm font-semibold">
            <History size={16} aria-hidden className="text-muted-foreground" />
            Historial de versiones
          </h3>
          {installedReleaseHistory.map((release) => (
            <section key={release.version} className={noticeCardStyles.surface}>
              <div className="flex items-center gap-3 border-b border-border p-4">
                <span className={cn(noticeCardStyles.icon, noticeCardStyles.brandTile)}>
                  <RotateCw size={20} strokeWidth={2.3} aria-hidden />
                </span>
                <div>
                  <p className={cn(noticeCardStyles.eyebrow, noticeCardStyles.brandEyebrow)}>Actualización</p>
                  <h4 className={noticeCardStyles.title}>Vendia {release.version}</h4>
                </div>
              </div>
              <ReleaseChanges changes={release.changes} />
            </section>
          ))}
        </section>
      )}
    </div>
  );
}
