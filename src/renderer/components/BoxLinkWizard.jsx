import React, { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
   BoxLinkWizard — asistente de vinculación de una caja con el Host.
   Entrega 3c: los pasos (descubrir → código → aprobación → listo)
   llaman a los canales box-* vía `api` (inyectable); NO está montado
   en ninguna ruta, así que la lógica vive en src/main/client-link.js
   y esta pieza es sólo presentación.
   ──────────────────────────────────────────────────────────── */

const STEPS = ["Buscar Host", "Código", "Aprobación"];

// Mensajes de los códigos que devuelve client-link / api-server.
const ERRORS = {
  HOST_NOT_FOUND: "No encontramos ningún Host en la red. Revisa que el escritorio esté encendido o escribe la IP.",
  HOST_UNREACHABLE: "Perdimos contacto con el Host. Revisa la conexión.",
  PROTOCOL_MISMATCH: "Este Host no es compatible con la versión de la caja. Actualiza una de las dos partes.",
  PAIR_CODE_INVALID: "El código de activación no coincide.",
  PAIR_RATE_LIMITED: "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.",
  PAIR_PENDING: "El Host aún no aprobó esta caja.",
  PAIR_REVOKED: "El Host revocó esta caja. Pide un nuevo emparejamiento.",
  HOST_MISMATCH: "Hay otro Host en la red: la caja se niega a vincularse con dos.",
  NOT_PAIRED: "Esta caja no está activada para este negocio.",
  TOKEN_UNAVAILABLE: "No se pudo guardar la credencial de la caja (falta cifrado con safeStorage). Reintenta.",
  NO_HOST_LINKED: "La caja todavía no tiene Host configurado.",
  INVALID_PAIR_INPUT: "Falta el Host o el código de activación.",
  PAIR_REJECTED: "El Host rechazó el emparejamiento.",
};

const message = (res) => ERRORS[res?.code] || res?.error || "Error desconocido";

const BoxLinkWizard = ({ api, className }) => {
  const invoke = api?.invoke || window.api?.invoke;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hosts, setHosts] = useState([]);
  const [manualIp, setManualIp] = useState("");
  const [hostUrl, setHostUrl] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState(null);

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
      if (!res?.success) return setError(message(res));
      setHosts(res.hosts);
      if (res.hosts.length === 1) setHostUrl(res.hosts[0].url);
    });

  const pair = () =>
    run(async () => {
      const res = await invoke("box-pair", { hostUrl, code, deviceName });
      if (!res?.success) return setError(message(res));
      setStatus(res);
      setStep(2);
    });

  const poll = () =>
    run(async () => {
      const res = await invoke("box-wait-approval", { timeoutMs: 30000, intervalMs: 1500 });
      if (!res?.success) return setError(message(res));
      setStatus(res);
      setStep(3);
    });

  const input =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <ol className="flex items-center gap-2 text-xs text-muted-foreground">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2",
              i === step && "font-semibold text-foreground",
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border">
              {i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {step === 0 && (
        <section className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            IP del Host (opcional)
            <input
              className={input}
              value={manualIp}
              placeholder="192.168.1.20"
              onChange={(e) => setManualIp(e.target.value)}
            />
          </label>
          <button className={cn(input, "w-fit")} disabled={busy} onClick={discover}>
            {busy ? "Buscando…" : "Buscar Host en la red"}
          </button>
          <ul className="flex flex-col gap-2">
            {hosts.map((h) => (
              <li key={h.url}>
                <button
                  className={cn(input, hostUrl === h.url && "ring-2 ring-ring")}
                  onClick={() => setHostUrl(h.url)}
                >
                  {h.url} · protocolo {h.protocol_version} · {h.app_version}
                </button>
              </li>
            ))}
          </ul>
          <button
            className={cn(input, "w-fit")}
            disabled={busy || !hostUrl}
            onClick={() => setStep(1)}
          >
            Continuar
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Nombre de la caja
            <input
              className={input}
              value={deviceName}
              placeholder="Caja 1"
              onChange={(e) => setDeviceName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Código de activación
            <input
              className={input}
              value={code}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <div className="flex gap-2">
            <button className={cn(input, "w-fit")} onClick={() => setStep(0)}>
              Atrás
            </button>
            <button className={cn(input, "w-fit")} disabled={busy || !code} onClick={pair}>
              {busy ? "Emparejando…" : "Emparejar"}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3 text-sm">
          <p>
            Caja <strong>{status?.device_code}</strong> pendiente de aprobación en el
            escritorio (Configuración → Dispositivos).
          </p>
          <button className={cn(input, "w-fit")} disabled={busy} onClick={poll}>
            {busy ? "Esperando…" : "Comprobar aprobación"}
          </button>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-3 text-sm">
          <p>Vinculada con el Host {status?.host_device_id}.</p>
          <p className="text-muted-foreground">
            La caja queda sin sincronizar hasta completar la primera sincronización.
          </p>
        </section>
      )}
    </div>
  );
};

export default BoxLinkWizard;
