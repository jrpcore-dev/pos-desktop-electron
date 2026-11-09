import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleAlert, RefreshCw, X } from "lucide-react";

import { cn } from "@/lib/utils";
import BoxApprovalScene from "./BoxApprovalScene";
import BoxLinkWizard from "./BoxLinkWizard";
import { TicketPrinter } from "./TicketPrinter";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import vendiaIcon from "../assets/icon-vendia.svg";

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

   Al terminar se queda unos segundos para que caigan los sellos del ticket y
   después le avisa a App con `onFinished`, que sigue con la bienvenida.
   ──────────────────────────────────────────────────────────── */

const APPROVAL_POLL_MS = 2500;
// Fase 5 · revocada: no tiene caso preguntar cada 2.5 s; se sigue mirando
// despacio por si el admin la reactiva desde el Host.
const REVOKED_POLL_MS = 15000;

const heroGradient =
  "bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))]";

// Lo que se queda en pantalla el ticket terminado, con los dos sellos.
const DOWNLOAD_DONE_MS = 2400;

const SETUP_STEPS = ["Buscar el Host", "Código de activación", "Aprobación en el Host", "Descargar datos"];

const ASIDE_COPY = [
  { title: "Conecta esta caja a tu negocio", text: "Catálogo, precios y ventas se mantienen iguales en todas tus cajas." },
  { title: "Identifica esta caja", text: "El código confirma que esta caja pertenece a tu negocio." },
  { title: "Falta un último permiso", text: "Por seguridad, el administrador aprueba cada caja nueva." },
  { title: "Casi lista para vender", text: "Después de esta descarga, la caja se actualiza sola." },
];

// Nombres para el cajero de lo que llega en `replica-progress`, en el orden de
// la descarga (replica-engine SWAP_ORDER, y settings al final).
const DOWNLOAD_GROUPS = [
  { label: "Categorías", tables: ["categories", "customer_tiers"] },
  { label: "Productos y precios", tables: ["products", "product_prices"] },
  {
    label: "Clientes y promociones",
    tables: ["customers", "tier_prices", "customer_prices", "cashiers", "group_promos", "bundles", "bundle_items"],
  },
  {
    label: "Ventas y movimientos",
    tables: [
      "suppliers",
      "paired_devices",
      "cash_register",
      "sales",
      "sale_items",
      "cash_register_expenses",
      "stock_movements",
      "customer_credit_movements",
      "settings",
    ],
  },
];

const DOWNLOAD_TABLES = DOWNLOAD_GROUPS.flatMap((g) => g.tables);

// El Host sólo informa el total de la tabla en curso, así que el avance general
// cuenta tablas terminadas más la fracción de la actual.
const overallPercent = (progress) => {
  const index = DOWNLOAD_TABLES.indexOf(progress?.table);
  if (index < 0) return 0;
  return ((index + (progress.table_pct ?? 0) / 100) / DOWNLOAD_TABLES.length) * 100;
};

const TABLE_LABELS = {
  categories: "Categorías",
  customer_tiers: "Niveles de cliente",
  products: "Productos",
  product_prices: "Precios",
  customers: "Clientes",
  tier_prices: "Precios por nivel",
  customer_prices: "Precios de clientes",
  cashiers: "Cajeros",
  group_promos: "Promociones",
  bundles: "Paquetes",
  bundle_items: "Paquetes",
  suppliers: "Proveedores",
  paired_devices: "Cajas",
  cash_register: "Cortes",
  sales: "Ventas",
  sale_items: "Ventas",
  cash_register_expenses: "Retiros",
  stock_movements: "Movimientos",
  customer_credit_movements: "Fiado",
  settings: "Ajustes",
};

const SetupAside = ({ step }) => {
  const copy = ASIDE_COPY[step];
  return (
    <aside
      className={cn(
        heroGradient,
        "hidden w-[380px] shrink-0 flex-col justify-between rounded-2xl p-10 text-primary-foreground shadow-[0_24px_60px_-15px_hsl(222_47%_11%_/_0.45)] md:flex",
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <img src={vendiaIcon} alt="" className="h-28 w-28 shrink-0 drop-shadow-xl" />
        <span className="text-3xl font-bold">Vendia</span>
      </div>

      <div className="flex flex-col gap-3.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/70">Caja adicional</p>
        <h1 className="text-4xl font-bold leading-tight">{copy.title}</h1>
        <p className="text-base leading-relaxed text-primary-foreground/80">{copy.text}</p>
      </div>

      <ol className="flex flex-col gap-1.5">
        {SETUP_STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
                active ? "bg-primary-foreground/15 font-semibold" : "text-primary-foreground/75",
              )}
            >
              <span
                className={cn(
                  "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  done && "bg-success text-success-foreground",
                  active && "bg-primary-foreground text-primary",
                  !done && !active && "bg-primary-foreground/15",
                )}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </aside>
  );
};

// Lo que dura en pantalla "Verificación exitosa" antes de pasar a la descarga:
// bloques en verde (1.3 s) + juntarse (0.45 s) + palomita.
const APPROVED_SCENE_MS = 3400;

const SetupAlert = ({ title, children }) => (
  <div role="alert" className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.08] p-3.5">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground">
      <CircleAlert size={18} />
    </span>
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-bold text-foreground">{title}</span>
      {children && <span className="text-xs leading-snug text-muted-foreground">{children}</span>}
    </span>
  </div>
);

const BoxSetupScreen = ({ settings, onRefresh, onFinished, className }) => {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Estado del vínculo con el Host (null = aún sin preguntar la primera vez).
  const [link, setLink] = useState(null);
  // Fase 5 · caja revocada: se ofrece volver a vincular con el código.
  const [relink, setRelink] = useState(false);
  // Paso del asistente, para que el panel de marca lo acompañe.
  const [wizardStep, setWizardStep] = useState(0);
  // Cerrar sin configurar: pide confirmarlo aquí mismo porque esta pantalla va
  // por encima de los diálogos (z-[9999]).
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const startedRef = useRef(false);
  const [storeName, setStoreName] = useState("");
  // Mayor avance visto: el porcentaje de la pantalla nunca retrocede.
  const peakRef = useRef(0);
  const ticketRef = useRef(null);

  // Lo que el asistente supo al emparejar (código, nombre). Sólo en memoria:
  // tras un reinicio no está y los bloques se quedan sin caracteres.
  const [pairInfo, setPairInfo] = useState(null);
  // "Verificación exitosa" en pantalla antes de la descarga.
  const [celebrating, setCelebrating] = useState(false);
  // Sólo se celebra si esta pantalla vio la caja pendiente: al reabrir una
  // caja ya aprobada se va directo a la descarga.
  const sawPendingRef = useRef(false);
  const celebratedRef = useRef(false);

  // Si una respuesta vieja llega tarde, la caja no vuelve al asistente.
  const pairedRef = useRef(!!settings?.host_url);
  if (settings?.host_url || pairInfo) pairedRef.current = true;
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
    setProgress(null);
    peakRef.current = 0;
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
                  // El Host ya no reconoce esta caja: esperar no lo arregla.
                  notPaired: res?.code === "NOT_PAIRED",
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

  useEffect(() => {
    if (!link) return;
    if (!link.approved) {
      sawPendingRef.current = true;
      return;
    }
    if (sawPendingRef.current && !celebratedRef.current) {
      celebratedRef.current = true;
      setCelebrating(true);
    }
  }, [link]);

  useEffect(() => {
    if (!celebrating) return undefined;
    const timer = window.setTimeout(() => setCelebrating(false), APPROVED_SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [celebrating]);

  // El asistente terminó: la espera empieza ya, sin aguardar al sondeo de App.
  const handlePaired = useCallback((info) => {
    setPairInfo(info);
    setRelink(false);
    celebratedRef.current = false;
    sawPendingRef.current = true;
    setLink({ approved: false, revoked: false, deviceCode: info?.deviceCode || null });
  }, []);

  // Con la descarga terminada se quedan los sellos un momento antes de seguir.
  useEffect(() => {
    if (!canSell) return undefined;
    const timer = window.setTimeout(() => onFinished?.(), DOWNLOAD_DONE_MS);
    return () => window.clearTimeout(timer);
  }, [canSell, onFinished]);

  // El nombre de la tienda llega con la descarga: antes puede no estar.
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => window.api.invoke("get-setting", "store_name"))
      .then((name) => {
        if (alive && typeof name === "string") setStoreName(name.trim());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canSell]);

  const cancelSetup = async () => {
    setCancelling(true);
    setCancelError("");
    try {
      const res = await window.api.invoke("box-cancel-setup");
      // Con éxito la app se reinicia: el spinner queda hasta que cierre.
      if (res?.success) return;
      setCancelError(res?.error || "No se pudo cerrar la configuración");
    } catch (err) {
      setCancelError(err?.message || String(err));
    }
    setCancelling(false);
    setConfirmCancel(false);
  };

  // Mientras se celebra la aprobación la descarga ya corre por detrás.
  const waiting = paired && !canSell && (!link?.approved || celebrating);
  const linking = !paired || relink;
  const blocked = waiting && (link?.revoked || link?.notPaired);
  const step = linking ? wizardStep : waiting ? 2 : 3;

  const downloading = !linking && !waiting;
  const groupInProgress = progress?.table
    ? DOWNLOAD_GROUPS.findIndex((g) => g.tables.includes(progress.table))
    : -1;
  const currentGroup = canSell ? DOWNLOAD_GROUPS.length : groupInProgress;
  peakRef.current = Math.max(peakRef.current, overallPercent(progress));
  const pct = canSell ? 100 : Math.min(99, Math.round(peakRef.current));

  // El papel sale hasta el renglón del grupo en curso; al terminar, completo.
  useLayoutEffect(() => {
    const ticket = ticketRef.current;
    if (!ticket) return;
    const rows = ticket.querySelectorAll("[data-group]");
    const row = rows[Math.max(0, currentGroup)];
    ticket.style.height = row
      ? `${row.offsetTop + row.offsetHeight + 8}px`
      : `${ticket.scrollHeight}px`;
  }, [currentGroup]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex gap-4 overflow-y-auto bg-muted p-4",
        className,
      )}
    >
      <SetupAside step={Math.min(step, SETUP_STEPS.length - 1)} />

      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3">
        <section
          className={cn(
            "flex w-full flex-col gap-5 rounded-2xl p-9 shadow-[0_1px_2px_hsl(222_47%_11%_/_0.06),0_12px_24px_-8px_hsl(222_47%_11%_/_0.1),0_32px_64px_-24px_hsl(222_47%_11%_/_0.22)]",
            downloading
              ? cn("vt-stage max-w-[880px] text-white", canSell && "vt-scene-done")
              : "max-w-[600px] border border-border bg-card",
          )}
        >
          {linking ? (
            <>
              <BoxLinkWizard onStepChange={setWizardStep} onPaired={handlePaired} />
              {relink && (
                <Button type="button" variant="ghost" onClick={() => setRelink(false)}>
                  Volver
                </Button>
              )}
            </>
          ) : waiting ? (
            <>
              <BoxApprovalScene
                phase={
                  link?.approved ? "approved" : blocked ? "rejected" : link?.error ? "off" : "wait"
                }
                code={pairInfo?.code}
                deviceName={pairInfo?.deviceName}
                deviceCode={link?.deviceCode || pairInfo?.deviceCode}
                revoked={!!link?.revoked}
                errorText={link?.error}
                onRelink={() => setRelink(true)}
              />
              {error && <SetupAlert title="No se pudo descargar">{error}</SetupAlert>}
            </>
          ) : (
            <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_268px]">
              <div className="flex min-w-0 flex-col gap-4">
                <header className="flex flex-col gap-1">
                  <h2 className="text-2xl font-bold">
                    {canSell ? "¡Descarga completa!" : "Descargando tu negocio"}
                  </h2>
                  <p className="text-sm leading-relaxed text-white/70">
                    {canSell
                      ? "Tu caja ya tiene toda la información."
                      : "Puede tardar unos minutos. No apagues esta caja."}
                  </p>
                </header>

                {error && (
                  <div className="rounded-xl bg-card">
                    <SetupAlert title="No se pudo descargar">{error}</SetupAlert>
                  </div>
                )}

                <div>
                  <p className="text-7xl font-bold leading-none tracking-tight tabular-nums">{pct}%</p>
                  <p className="mt-2 min-h-5 text-sm font-semibold text-white/85">
                    {canSell
                      ? "Abriendo tu caja"
                      : progress?.table
                        ? `Ahora: ${TABLE_LABELS[progress.table] || progress.table}`
                        : busy
                          ? "Preparando…"
                          : "En espera"}
                  </p>
                </div>

                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-white/20"
                  role="progressbar"
                  aria-label="Avance de la descarga"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <p className="vt-count">
                  {progress?.done != null ? `${progress.done.toLocaleString("es-MX")} registros` : "\u00a0"}
                </p>

                <div className={cn("vt-pipe", (canSell || !busy) && "vt-pipe-idle")}>
                  <span>Host</span>
                  <div className="vt-line">
                    <i style={{ "--vt-at": "0ms" }} />
                    <i style={{ "--vt-at": "500ms" }} />
                    <i style={{ "--vt-at": "1000ms" }} />
                  </div>
                  <span>Esta caja</span>
                </div>

                {!busy && !canSell && (
                  <Button
                    type="button"
                    onClick={sync}
                    className="self-start bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                  >
                    <RefreshCw size={16} />
                    {error ? "Reintentar descarga" : "Descargar de nuevo"}
                  </Button>
                )}
              </div>

              <div className="justify-self-center">
                <TicketPrinter ref={ticketRef} ticketClassName={cn("vt-live", canSell && "vt-live-done")}>
                  <h4>{storeName || "Tu negocio"}</h4>
                  <div className="vt-sub">
                    {settings?.box_device_code ? `Caja ${settings.box_device_code}` : "Esta caja"} · Descarga inicial
                  </div>
                  <hr />
                  {DOWNLOAD_GROUPS.map((g, i) => (
                    <div
                      key={g.label}
                      data-group
                      className={cn("vt-row", i <= currentGroup && "vt-on", i < currentGroup && "vt-ok")}
                    >
                      <span>{g.label}</span>
                      <em>✓</em>
                    </div>
                  ))}
                  <hr />
                  <div className="vt-row vt-total">
                    <span>REGISTROS</span>
                    <span>{(progress?.done ?? 0).toLocaleString("es-MX")}</span>
                  </div>
                </TicketPrinter>
              </div>
            </div>
          )}
        </section>

        {settings?.canCancelSetup && !busy && (
          <div className="flex flex-col items-center gap-1.5">
            {confirmCancel ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-sm text-muted-foreground">
                  ¿Dejar de configurar esta PC como caja?
                </span>
                <Button type="button" size="sm" disabled={cancelling} onClick={cancelSetup}>
                  {cancelling && <Spinner size={14} />}
                  {cancelling ? "Cerrando…" : "Sí, cerrar"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={cancelling}
                  onClick={() => setConfirmCancel(false)}
                >
                  Seguir aquí
                </Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmCancel(true)}>
                <X size={16} />
                Cerrar
              </Button>
            )}
            {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}
          </div>
        )}
      </main>
    </div>
  );
};

export default BoxSetupScreen;
