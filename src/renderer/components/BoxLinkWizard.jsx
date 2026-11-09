import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleAlert, Monitor, RefreshCw, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

/* ────────────────────────────────────────────────────────────
   BoxLinkWizard — asistente de vinculación de una caja con el Host.
   Entrega 3c: los pasos (descubrir → código → aprobación → listo)
   llaman a los canales box-* vía `api` (inyectable); NO está montado
   en ninguna ruta, así que la lógica vive en src/main/client-link.js
   y esta pieza es sólo presentación. BoxSetupScreen pone la tarjeta y
   el panel de marca; `onStepChange` mantiene ese panel al día.
   ──────────────────────────────────────────────────────────── */

// Mensajes de los códigos que devuelve client-link / api-server.
const ERRORS = {
  HOST_NOT_FOUND: "No encontramos ningún Host en la red. Revisa que el escritorio esté encendido o escribe la IP.",
  HOST_UNREACHABLE: "Perdimos contacto con el Host. Revisa la conexión.",
  PROTOCOL_MISMATCH: "Este Host no es compatible con la versión de la caja. Actualiza una de las dos partes.",
  PAIR_CODE_INVALID: "El código de activación no es válido. Revísalo en el Host: Configuración → Dispositivos.",
  PAIR_RATE_LIMITED: "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.",
  PAIR_PENDING: "El Host aún no aprobó esta caja.",
  PAIR_REVOKED: "El Host revocó esta caja. Pide un nuevo emparejamiento.",
  HOST_MISMATCH: "Hay otro Host en la red: la caja se niega a vincularse con dos.",
  NOT_PAIRED: "Esta caja no está activada para este negocio.",
  TOKEN_UNAVAILABLE: "No se pudo guardar la credencial de la caja (falta cifrado con safeStorage). Reintenta.",
  NO_HOST_LINKED: "La caja todavía no tiene Host configurado.",
  INVALID_PAIR_INPUT: "Falta el Host o el código de activación.",
  PAIR_HOST_ERROR: "El Host no pudo registrar esta caja. Revisa el aviso en el Host y vuelve a intentar.",
  PAIR_CODE_UNAVAILABLE: "El Host no tiene código de activación. Genera uno en Configuración → Dispositivos.",
};

// `PAIR_REJECTED` no va en la tabla: es el comodín de cualquier fallo sin código
// y un texto fijo escondía el motivo real, que aquí llega en `error`.
const message = (res) => {
  // Con `url` el fallo ya dice a qué dirección se intentó llegar y por qué.
  const base = (res?.url && res?.error) || ERRORS[res?.code] || res?.error || "Error desconocido";
  return res?.code === "PAIR_CODE_INVALID" && Number.isFinite(res?.attempts_left)
    ? `${base} Te quedan ${res.attempts_left} intentos.`
    : base;
};

// Sólo para el contador: el formato lo valida `box-pair` (checkCodeFormat).
const CODE_LENGTH = 16;
const codeChars = (value) => String(value || "").replace(/[^A-Za-z0-9]/g, "").length;

// Máscara del código: se escribe seguido y el guion aparece cada 4 caracteres,
// igual que lo muestra el Host (activation.js · XXXX-XXXX-XXXX-XXXX).
const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
const formatCode = (chars) => (chars.match(/.{1,4}/g) || []).join("-");
// Posición del cursor en el texto con guiones tras `n` caracteres reales.
const caretAfter = (formatted, n) => {
  if (!n) return 0;
  let k = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] !== "-" && ++k === n) return i + 1;
  }
  return formatted.length;
};

const hostIp = (url) => String(url || "").replace(/^https?:\/\//, "");

const heroGradient =
  "bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))]";

const BoxLinkWizard = ({ api, className, onStepChange, onPaired }) => {
  const invoke = api?.invoke || window.api?.invoke;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hosts, setHosts] = useState([]);
  const [searched, setSearched] = useState(false);
  const [manualIp, setManualIp] = useState("");
  const [hostUrl, setHostUrl] = useState("");
  const [code, setCode] = useState("");
  // Sin nombre el Host la registraría como "Dispositivo móvil".
  const [deviceName, setDeviceName] = useState("Caja 2");
  const [status, setStatus] = useState(null);
  const codeRef = useRef(null);
  // Tras formatear, el cursor vuelve a donde iba (React lo mandaría al final).
  const caretRef = useRef(null);
  const codeFull = codeChars(code) === CODE_LENGTH;

  useLayoutEffect(() => {
    const el = codeRef.current;
    if (el && caretRef.current != null && document.activeElement === el) {
      el.setSelectionRange(caretRef.current, caretRef.current);
    }
    caretRef.current = null;
  }, [code]);

  const applyCode = (raw, caretRaw) => {
    const before = cleanCode(raw.slice(0, caretRaw)).length;
    const chars = cleanCode(raw);
    const formatted = formatCode(chars);
    let pos = caretAfter(formatted, before);
    // Al final del texto el cursor queda después del guion recién puesto.
    if (formatted[pos] === "-" && before === chars.length) pos++;
    caretRef.current = pos;
    setCode(formatted);
  };

  const onCodeKeyDown = (e) => {
    const el = e.currentTarget;
    const s = el.selectionStart;
    const v = el.value;
    if (s === el.selectionEnd && e.key === "Backspace" && s > 0 && v[s - 1] === "-") {
      // Borrar sobre un guion borra el carácter de antes.
      e.preventDefault();
      applyCode(v.slice(0, s - 2) + v.slice(s), s - 2);
    } else if (s === el.selectionEnd && e.key === "Delete" && v[s] === "-") {
      e.preventDefault();
      applyCode(v.slice(0, s + 1) + v.slice(s + 2), s + 1);
    } else if (e.key === "Enter" && codeFull && deviceName.trim() && !busy) {
      pair();
    }
  };

  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);

  const run = useCallback(
    async (fn) => {
      setBusy(true);
      setError("");
      try {
        return await fn();
      } catch (err) {
        setError(err?.message || String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const discover = () =>
    run(async () => {
      const res = await invoke("box-discover-hosts", {
        manualIps: manualIp ? [manualIp] : [],
        manualPort: 3456,
      });
      setSearched(true);
      if (!res?.success) return setError(message(res));
      setHosts(res.hosts);
      if (res.hosts.length === 1) setHostUrl(res.hosts[0].url);
    });

  // Lo normal es que el Host esté en la red: se busca sin pedir un clic.
  const discoveredRef = useRef(false);
  useEffect(() => {
    if (discoveredRef.current) return;
    discoveredRef.current = true;
    discover();
  }, []);

  // La espera de aprobación con su animación vive en BoxSetupScreen: con
  // `onPaired` le pasa la estafeta en cuanto el Host acepta el código, sin
  // esperar al sondeo de `box-get-settings`.
  const pair = () =>
    run(async () => {
      const res = await invoke("box-pair", { hostUrl, code, deviceName });
      if (!res?.success) return setError(message(res));
      setStatus(res);
      if (onPaired) return onPaired({ code, deviceName: deviceName.trim(), deviceCode: res.device_code || null });
      setStep(2);
    });

  const poll = () =>
    run(async () => {
      const res = await invoke("box-wait-approval", { timeoutMs: 120000, intervalMs: 2000 });
      if (!res?.success) return setError(message(res));
      setStatus(res);
      setStep(3);
    });

  // El Host aprueba y la caja pasa sola: sin clic ni recarga.
  useEffect(() => {
    if (step !== 2) return;
    const t = window.setTimeout(() => poll(), 1200);
    return () => window.clearTimeout(t);
  }, [step]);

  const heading =
    step === 0
      ? {
          title: "Buscar el Host en la red",
          text: "El Host es la PC principal del negocio. Debe estar encendida y conectada a la misma red.",
        }
      : step === 1
        ? { title: "Datos de esta caja", text: `Vas a conectarla con el Host en ${hostIp(hostUrl)}.` }
        : step === 2
          ? {
              title: "Esperando aprobación",
              text: `Caja ${status?.device_code || ""} pendiente en el Host: Configuración → Dispositivos.`,
            }
          : { title: "Caja vinculada", text: "Falta completar la primera sincronización." };

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <header className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-bold text-foreground">{heading.title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{heading.text}</p>
      </header>

      {error && (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.08] p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground">
            <CircleAlert size={18} />
          </span>
          <p className="min-w-0 self-center text-sm font-semibold leading-snug text-foreground">{error}</p>
        </div>
      )}

      {step === 0 && (
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-semibold text-muted-foreground">
              {busy
                ? "Buscando en la red…"
                : hosts.length === 1
                  ? "1 Host encontrado"
                  : hosts.length > 1
                    ? `${hosts.length} Hosts encontrados`
                    : searched
                      ? "No encontramos ningún Host"
                      : ""}
            </p>
            {busy && !hosts.length && (
              <div className="flex items-center gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                <Spinner size={18} />
                Esto toma unos segundos.
              </div>
            )}
            {hosts.map((h) => (
              <button
                key={h.url}
                type="button"
                onClick={() => setHostUrl(h.url)}
                className={cn(
                  "flex w-full items-center gap-3.5 rounded-xl border bg-card px-4 py-3.5 text-left shadow-md outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                  hostUrl === h.url ? "border-chart-2 ring-2 ring-chart-2/40" : "border-border",
                )}
              >
                <span className={cn(heroGradient, "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary-foreground")}>
                  <Monitor size={22} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-bold text-foreground">Host del negocio</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {hostIp(h.url)}
                    {h.app_version ? ` · versión ${h.app_version}` : ""}
                  </span>
                </span>
                {h.compatible === false ? (
                  <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">
                    Hay que actualizar
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-xs font-bold text-success">
                    En línea
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="box-host-ip">¿No aparece? Escribe su IP</Label>
            <div className="flex gap-2">
              <Input
                id="box-host-ip"
                className="h-11"
                value={manualIp}
                placeholder="192.168.1.20"
                onChange={(e) => setManualIp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) discover();
                }}
              />
              <Button type="button" variant="outline" className="h-11 shrink-0" disabled={busy} onClick={discover}>
                {busy ? <Spinner size={16} /> : hosts.length ? <RefreshCw size={16} /> : <Search size={16} />}
                {busy ? "Buscando…" : hosts.length ? "Buscar de nuevo" : "Buscar"}
              </Button>
            </div>
          </div>

          <Button type="button" size="lg" disabled={busy || !hostUrl} onClick={() => setStep(1)}>
            Continuar
          </Button>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="box-device-name">Nombre de la caja</Label>
            <Input
              id="box-device-name"
              className="h-11"
              value={deviceName}
              placeholder="Caja 2"
              onChange={(e) => setDeviceName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="box-pair-code">Código de activación</Label>
            <Input
              id="box-pair-code"
              ref={codeRef}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
              className="h-14 text-center font-mono text-xl font-bold tracking-[0.14em]"
              value={code}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              onChange={(e) => applyCode(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyDown={onCodeKeyDown}
            />
            <p className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground">
              <span>Escríbelo seguido, los guiones se ponen solos</span>
              <span className={cn(codeFull && "font-bold text-success")}>
                {codeChars(code)} de {CODE_LENGTH}
              </span>
            </p>
          </div>
          <div className="flex gap-2.5">
            <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => setStep(0)}>
              Atrás
            </Button>
            <Button
              type="button"
              size="lg"
              className={cn("flex-1", codeFull && "bw-ready")}
              disabled={busy || !codeFull || !deviceName.trim()}
              onClick={pair}
            >
              {busy ? "Enviando código…" : "Emparejar"}
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
            <Spinner size={18} />
            La descarga empieza sola al aprobarla.
          </div>
          <Button type="button" variant="outline" disabled={busy} onClick={poll}>
            {busy ? "Esperando…" : "Comprobar aprobación"}
          </Button>
        </section>
      )}

      {step === 3 && (
        <div className="flex items-center gap-3 rounded-xl bg-success/[0.08] p-4 text-sm font-semibold text-foreground">
          <Check size={18} strokeWidth={3} className="shrink-0 text-success" />
          Vinculada con el Host.
        </div>
      )}
    </div>
  );
};

export default BoxLinkWizard;
