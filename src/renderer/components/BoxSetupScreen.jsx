import React, { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import BoxLinkWizard from "./BoxLinkWizard";
import { Spinner } from "./ui/spinner";

/* ────────────────────────────────────────────────────────────
   BoxSetupScreen — pantalla de arranque de la CAJA (B7).

   Una caja que todavía no está sincronizada NO tiene catálogo propio: todo lo
   que enseñe sería inventado o viejo. Por eso esta pantalla ocupa el sitio
   entero (nada de rutas, nada de login) hasta que `canSell` pasa a true:

     · sin host_url        → el asistente de vinculación (BoxLinkWizard),
                             que antes estaba escrito pero NO montado en
                             ningún sitio.
     · vinculada sin sync  → descarga del snapshot con progreso REAL
                             (evento `replica-progress`, no un indicador
                             dibujado a mano).

   Al terminar le avisa a App, que vuelve a leer `box-get-settings` y abre la
   app de una pieza.
   ──────────────────────────────────────────────────────────── */

const bar = "h-2 w-full overflow-hidden rounded-full bg-muted";
const barFill = "h-full rounded-full bg-brand transition-[width] duration-200";
const btn =
  "rounded-md border border-border bg-background px-3 py-2 text-sm outline-none disabled:opacity-50";

const BoxSetupScreen = ({ settings, onRefresh, className }) => {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const paired = !!settings?.host_url;

  // El avance de la descarga llega por IPC desde main (replica-progress).
  useEffect(() => {
    const off = window.api.on("replica-progress", (payload) =>
      setProgress(payload),
    );
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  const sync = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await window.api.invoke("replica-sync-now", {});
      if (!res?.success) {
        setError(res?.error || res?.code || "No se pudo descargar la información");
        return;
      }
      await onRefresh?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  // Arranca sola al entrar en la fase de descarga: una caja nueva no espera a
  // que alguien le dé un botón para tener datos.
  useEffect(() => {
    if (!paired || settings?.canSell || startedRef.current) return;
    startedRef.current = true;
    sync();
  }, [paired, settings?.canSell, sync]);

  const pct = progress?.table_pct;
  const filling = pct != null ? `${pct}%` : busy ? "100%" : "0%";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex items-center justify-center bg-background px-6",
        className,
      )}
    >
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Caja
          </p>
          <h1 className="text-xl font-semibold text-foreground">
            {paired ? "Descargando la información" : "Vincular con el Host"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {paired
              ? "La caja no vende hasta terminar la primera sincronización."
              : "Busca el escritorio del negocio y pídele el código de activación."}
          </p>
        </header>

        {!paired ? (
          <BoxLinkWizard className="rounded-lg border border-border p-4" />
        ) : (
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">
                {progress?.table
                  ? `Tabla: ${progress.table}`
                  : busy
                    ? "Preparando…"
                    : "En espera"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {progress?.done != null ? `${progress.done} filas` : "—"}
              </span>
            </div>

            <div className={bar} role="progressbar" aria-valuenow={pct ?? 0}>
              <div className={barFill} style={{ width: filling }} />
            </div>

            <button
              className={btn}
              disabled={busy}
              onClick={sync}
            >
              {busy
                ? "Descargando…"
                : error
                  ? "Reintentar descarga"
                  : "Descargar de nuevo"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
};

export default BoxSetupScreen;
