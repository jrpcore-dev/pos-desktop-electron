import React, { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import BoxLinkWizard from "./BoxLinkWizard";
import { Spinner } from "./ui/spinner";

/* ────────────────────────────────────────────────────────────
   BoxSetupScreen — pantalla de arranque de la CAJA (B7).

   Una caja que todavía no está sincronizada NO tiene catálogo propio: todo lo
   que enseñe sería inventado o viejo. Por eso esta pantalla ocupa el sitio
   entero (nada de rutas, nada de login) hasta que `canSell` pasa a true:

      · sin host_url        → el asistente de vinculación (BoxLinkWizard).
      · vinculada sin sync  → PRIMERO espera la aprobación del Host (sondeo
                              cada 2.5 s de `box-link-status`; al aprobar,
                              la descarga arranca SOLA) y DESPUÉS descarga
                              el snapshot con progreso REAL (evento
                              `replica-progress`, no un indicador dibujado
                              a mano).

   La espera vive AQUÍ y no en el asistente porque App sondea
   `box-get-settings` cada 1.2 s: en cuanto `host_url` aparece, el asistente
   se desmonta. Si la caja llega ya aprobada (reinicio), el primer sondeo
   dispara la descarga igual.

   Al terminar le avisa a App, que vuelve a leer `box-get-settings` y abre la
   app de una pieza.
   ──────────────────────────────────────────────────────────── */

const bar = "h-2 w-full overflow-hidden rounded-full bg-muted";
const barFill = "h-full rounded-full bg-brand transition-[width] duration-200";
const btn =
  "rounded-md border border-border bg-field px-3 py-2 text-sm outline-none disabled:opacity-50";
const note =
  "rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground";

const APPROVAL_POLL_MS = 2500;
// Fase 5 · revocada: no tiene caso preguntar cada 2.5 s; se sigue mirando
// despacio por si el admin la reactiva desde el Host.
const REVOKED_POLL_MS = 15000;

const BoxSetupScreen = ({ settings, onRefresh, className }) => {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Estado del vínculo con el Host (null = aún sin preguntar la primera vez).
  const [link, setLink] = useState(null);
  // Fase 5 · caja revocada: se ofrece volver a vincular con el código.
  const [relink, setRelink] = useState(false);
  const startedRef = useRef(false);

  // Si una respuesta vieja llega tarde, la caja no vuelve al asistente.
  const pairedRef = useRef(!!settings?.host_url);
  if (settings?.host_url) pairedRef.current = true;
  const paired = pairedRef.current;
  const canSell = !!settings?.canSell;

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
        // Aún no me aprueban: vuelvo a la espera y el sondeo reanuda solo.
        if (res?.code === "NOT_APPROVED") {
          startedRef.current = false;
          setLink((prev) => ({ ...(prev || {}), approved: false }));
          return;
        }
        const detail = res?.scopeRequired ? ` (falta: ${res.scopeRequired})` : "";
        setError(
          (res?.error || res?.code || "No se pudo descargar la información") +
            detail,
        );
        return;
      }
      await onRefresh?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  // Sondeo de aprobación: mientras la caja está vinculada pero sin datos,
  // pregunta al Host cada 2.5 s. En cuanto aprueba, el efecto de abajo
  // dispara la descarga — sin clic y sin recargar.
  useEffect(() => {
    if (!paired || canSell) return undefined;
    let alive = true;
    let lastAt = 0;
    let revoked = false;
    const check = async () => {
      if (revoked && Date.now() - lastAt < REVOKED_POLL_MS) return;
      lastAt = Date.now();
      try {
        const res = await window.api.invoke("box-link-status");
        if (!alive) return;
        if (res?.success) {
          revoked = !!res.revoked;
          // Re-vinculada: vuelve a "esperando aprobación" y se quita el
          // asistente.
          if (!revoked) setRelink(false);
          setLink({
            approved: !!res.approved,
            revoked: !!res.revoked,
            deviceCode: res.device_code || null,
          });
        } else {
          setLink((prev) =>
            prev?.approved
              ? prev // una consulta que falla no borra una aprobación ya vista
              : {
                  approved: false,
                  revoked: false,
                  deviceCode: prev?.deviceCode || null,
                  error: res?.error || res?.code || "Sin conexión con el Host",
                },
          );
        }
      } catch (err) {
        if (!alive) return;
        setLink((prev) =>
          prev?.approved
            ? prev
            : {
                approved: false,
                revoked: false,
                deviceCode: prev?.deviceCode || null,
                error: err?.message || "Sin conexión con el Host",
              },
        );
      }
    };
    check();
    const timer = window.setInterval(check, APPROVAL_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [paired, canSell]);

  // Aprobada → la descarga arranca sola, una sola vez. Si el Host la pierde
  // a mitad (NOT_APPROVED), `startedRef` se rearma y el sondeo vuelve a
  // dispararla cuando vuelva a haber luz verde.
  useEffect(() => {
    if (!paired || canSell || startedRef.current) return;
    if (!link?.approved) return;
    startedRef.current = true;
    sync();
  }, [paired, canSell, link, sync]);

  const pct = progress?.table_pct;
  // Sin avance conocido la barra no puede decir 100 % mientras prepara.
  const filling = pct != null ? `${pct}%` : "0%";
  const waiting = paired && !canSell && !link?.approved;

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
            {paired
              ? waiting
                ? "Esperando aprobación en el Host"
                : "Descargando la información"
              : "Vincular con el Host"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {paired
              ? waiting
                ? "Aprueba esta caja en Configuración → Dispositivos; la descarga empieza sola."
                : "La caja no vende hasta terminar la primera sincronización."
              : "Busca el escritorio del negocio y pídele el código de activación."}
          </p>
        </header>

        {!paired || relink ? (
          <div className="flex flex-col gap-2">
            <BoxLinkWizard className="rounded-lg border border-border p-4" />
            {relink && (
              <button className={btn} onClick={() => setRelink(false)}>
                Volver
              </button>
            )}
          </div>
        ) : (
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            {waiting && link?.revoked && (
              <button className={btn} onClick={() => setRelink(true)}>
                Volver a vincular con el código de activación
              </button>
            )}
            {waiting && (
              <p className={note}>
                {link?.revoked
                  ? "El Host revocó esta caja. Vuelve a vincularla con el código de activación; después el administrador la aprueba en Configuración → Dispositivos."
                  : link?.error
                    ? `No se pudo consultar el Host: ${link.error}`
                    : link?.deviceCode
                      ? `Caja ${link.deviceCode} esperando aprobación en el Host…`
                      : "Esperando aprobación en el Host…"}
              </p>
            )}

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
              disabled={busy || (waiting && !error)}
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
