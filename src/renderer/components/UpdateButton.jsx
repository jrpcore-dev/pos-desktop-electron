import React, { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Download, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "./ToastProvider";
import { Hint } from "./ui/hint";
import * as notices from "../lib/syncNotices";
import { hasSaleInProgress } from "../lib/saleInProgress";

// Actualización de la app en la barra superior. Sólo aparece si hay una versión
// nueva. Píldora clara con texto (se lee sin pasar el mouse); al pasarlo se
// pone oscura. Decidir reiniciar o dejarlo para el corte se hace en el aviso
// flotante de abajo a la derecha, no en un menú.
//
//   Versión X            → hay versión nueva; al tocarla se descarga
//   Descargando 45 %     → se sigue vendiendo mientras baja
//   Reiniciar para actualizar → lista; abre el aviso con las dos opciones
//   Se actualiza al cerrar caja → programada para después del corte
//
// Nunca reinicia con productos en un ticket: espera a que se cobre o se vacíe.
// En una caja, si la versión nueva quedaría por delante del Host, lo avisa.

const PILL =
  "group flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring animate-in fade-in-0 zoom-in-95";
// Clara: borde y fondo azulados; al pasar el mouse, oscura (identidad).
const PILL_LIGHT = cn(
  PILL,
  "border-primary/20 bg-primary/[0.05] text-foreground shadow-[0_1px_2px_hsl(222_47%_11%_/_0.06),0_4px_10px_-2px_hsl(var(--primary)_/_0.12)]",
  "hover:border-transparent hover:bg-gradient-to-br hover:from-[hsl(var(--hero-gradient-from))] hover:to-[hsl(var(--hero-gradient-to))] hover:text-primary-foreground",
  "dark:border-chart-2/30 dark:bg-chart-2/10",
);
const ICON_TILE =
  "flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))] text-primary-foreground shadow-[0_3px_8px_-2px_hsl(var(--primary)_/_0.45)] transition-colors group-hover:bg-none group-hover:bg-primary-foreground/15";

const UpdateButton = () => {
  const notify = useToast();
  const [state, setState] = useState(null);
  const lastVersion = useRef(null);
  // "Reiniciar ahora" con una venta abierta: se reinicia al vaciarse el ticket.
  const [waitingSale, setWaitingSale] = useState(false);

  useEffect(() => {
    let mounted = true;
    const handle = (payload) => {
      if (!mounted || !payload || !payload.status) return;
      if ((payload.status === "available" || payload.status === "downloaded") && payload.version) {
        lastVersion.current = payload.version;
      }
      if (payload.status === "error") {
        if (lastVersion.current) {
          notify(`No se pudo descargar la actualización${payload.message ? ` · ${payload.message}` : ""}`, "error");
          setState({ status: "available", version: lastVersion.current });
        } else {
          setState(null);
        }
        return;
      }
      setState(payload.status === "idle" ? null : payload);
    };
    const unsub = window.api?.on("update:status", handle);
    window.api
      ?.invoke("update:get-state")
      .then((s) => {
        if (mounted && s && s.status && s.status !== "idle") handle(s);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unsub?.();
    };
  }, [notify]);

  const install = useCallback(() => {
    notices.resolve("update");
    if (hasSaleInProgress()) {
      setWaitingSale(true);
      notices.show({
        key: "update-sale",
        tone: "warning",
        eyebrow: "Venta en curso",
        title: "Se reinicia al terminar la venta",
        body: "Hay productos en el ticket. Cobra o vacíalo y la caja se actualiza sola.",
        footer: "Nunca se reinicia a media venta",
        silent: true,
      });
      return;
    }
    window.api?.invoke("update:install").catch(() => {});
  }, []);

  // Con el ticket vacío, el reinicio que esperaba sigue solo.
  useEffect(() => {
    if (!waitingSale) return undefined;
    const go = () => {
      setWaitingSale(false);
      notices.resolve("update-sale");
      window.api?.invoke("update:install").catch(() => {});
    };
    window.addEventListener("vendia:tickets-empty", go);
    return () => window.removeEventListener("vendia:tickets-empty", go);
  }, [waitingSale]);

  const schedule = useCallback(async () => {
    notices.resolve("update");
    const res = await window.api?.invoke("update:schedule-on-close", true).catch(() => null);
    if (res?.success) notify("Se actualizará al cerrar caja", "success");
  }, [notify]);

  // El aviso con las dos opciones: sale una vez al quedar lista, y al tocar
  // la píldora. Al cerrarlo queda en la campana.
  const showReady = useCallback(
    (version) => {
      notices.show({
        key: "update",
        tone: "brand",
        eyebrow: "Actualización",
        title: `La versión ${version || "nueva"} está lista`,
        body: "Reinicia cuando quieras o déjala para el corte.",
        action: "Reiniciar ahora",
        onAction: install,
        secondary: "Al cerrar caja",
        onSecondary: schedule,
      });
    },
    [install, schedule],
  );
  const announced = useRef(null);
  useEffect(() => {
    if (state?.status === "downloaded" && !state.scheduled && announced.current !== state.version) {
      announced.current = state.version;
      showReady(state.version);
    }
    if (state?.status === "available" && state.hostBehind && announced.current !== `host-${state.version}`) {
      announced.current = `host-${state.version}`;
      notices.show({
        key: "update-host",
        tone: "warning",
        eyebrow: "Sólo en cajas",
        title: "Primero actualiza el Host",
        body: `Esta caja tendría la ${state.version} y el Host sigue en la ${state.hostBehind}. Actualiza el Host y después esta caja.`,
      });
    }
  }, [state, showReady]);

  if (!state || !state.status) return null;

  if (state.status === "downloading") {
    const pct = state.percent != null ? state.percent : 0;
    return (
      <div
        role="status"
        aria-label={`Descargando actualización, ${pct} %`}
        className="flex h-10 w-[190px] shrink-0 flex-col justify-center gap-1.5 rounded-full border border-border bg-card px-3.5 shadow-[0_1px_2px_hsl(222_47%_11%_/_0.06),0_4px_10px_-2px_hsl(222_47%_11%_/_0.08)] animate-in fade-in-0"
      >
        <span className="flex justify-between text-xs font-bold">
          <span>Descargando</span>
          <span className="tabular-nums text-primary dark:text-chart-2">{pct} %</span>
        </span>
        <span className="h-1 overflow-hidden rounded-full bg-primary/10 dark:bg-chart-2/20">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-primary to-chart-2 transition-[width] duration-500"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </span>
      </div>
    );
  }

  if (state.status === "downloaded") {
    const scheduled = !!state.scheduled;
    return (
      <Hint label={scheduled ? "Toca para reiniciar ahora o quitar la programación" : undefined} side="bottom">
        <button type="button" onClick={() => showReady(state.version)} className={cn(PILL_LIGHT, "relative")}>
          <span className={ICON_TILE}>
            {scheduled ? <Clock size={14} strokeWidth={2.4} /> : <RotateCw size={14} strokeWidth={2.4} />}
          </span>
          {waitingSale ? "Se reinicia al terminar la venta" : scheduled ? "Se actualiza al cerrar caja" : "Reiniciar para actualizar"}
          {!scheduled && (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card dark:bg-chart-2" />
          )}
        </button>
      </Hint>
    );
  }

  // Disponible.
  const blocked = !!state.hostBehind;
  return (
    <Hint
      label={blocked ? `El Host sigue en la ${state.hostBehind}: actualízalo primero` : "Descargar sin cortar la venta"}
      side="bottom"
    >
      <button
        type="button"
        disabled={blocked}
        onClick={() => window.api?.invoke("update:download").catch(() => {})}
        className={cn(PILL_LIGHT, blocked && "cursor-not-allowed opacity-70 hover:bg-none hover:text-foreground")}
      >
        <span className={ICON_TILE}>
          <Download size={14} strokeWidth={2.4} />
        </span>
        Versión {state.version || "nueva"}
      </button>
    </Hint>
  );
};

export default UpdateButton;
