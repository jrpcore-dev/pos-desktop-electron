import React, { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";

// Botón de actualización del navbar. Se monta (devuelve un elemento) SOLO
// cuando hay una actualización disponible; si no, retorna null y no ocupa
// espacio en el DOM ni cambia el header.
const UpdateButton = () => {
  const [state, setState] = useState(null);
  const lastVersion = useRef(null);

  useEffect(() => {
    let mounted = true;

    const handle = (payload) => {
      if (!mounted || !payload || !payload.status) return;
      if (payload.status === "available" && payload.version) {
        lastVersion.current = payload.version;
      }
      if (payload.status === "downloaded" && payload.version) {
        lastVersion.current = payload.version;
      }
      if (payload.status === "error") {
        if (lastVersion.current) {
          toast("No se pudo descargar la actualización", {
            description: payload.message || "Inténtalo más tarde",
          });
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
  }, []);

  if (!state || !state.status) return null;

  const onClickDownload = () => {
    window.api?.invoke("update:download").catch(() => {});
  };

  const onClickInstall = () => {
    window.api?.invoke("update:install").catch(() => {});
  };

  const btnClass =
    "flex h-full w-10 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 last:rounded-r-lg";

  if (state.status === "downloading") {
    return (
      <span className="flex h-full fade-in-up">
        <ShadcnTooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              className="flex h-full w-10 shrink-0 cursor-default items-center justify-center text-muted-foreground last:rounded-r-lg"
            >
              <RefreshCw size={17} className="animate-spin" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Descargando… {`${state.percent != null ? state.percent : 0}%`}
          </TooltipContent>
        </ShadcnTooltip>
      </span>
    );
  }

  if (state.status === "downloaded") {
    return (
      <span className="flex h-full fade-in-up">
        <ShadcnTooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClickInstall}
              className={btnClass}
            >
              <RotateCw size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Reiniciar para actualizar
          </TooltipContent>
        </ShadcnTooltip>
      </span>
    );
  }

  return (
    <span className="flex h-full fade-in-up">
      <ShadcnTooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onClickDownload} className={btnClass}>
            <Download size={17} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Actualización v{state.version || "disponible"}
        </TooltipContent>
      </ShadcnTooltip>
    </span>
  );
};

export default UpdateButton;