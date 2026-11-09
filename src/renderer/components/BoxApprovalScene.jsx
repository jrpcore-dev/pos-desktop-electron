import React, { useEffect, useRef, useState } from "react";
import { Bell, Monitor, Store, Unplug } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/* ────────────────────────────────────────────────────────────
   BoxApprovalScene — la caja espera a que el Host la apruebe.

   phase:
     · "wait"     → ciclo tranquilo: los 4 bloques suben en ola, el Host
                    tiene un aviso que suena y un contador de tiempo.
     · "off"      → sin conexión con el Host: todo quieto y en rojo.
     · "approved" → cada bloque gira y muestra su parte del código en verde,
                    se juntan al centro y queda una sola palomita.
     · "rejected" → los bloques muestran el código en rojo y tiemblan; sale
                    el botón para volver a vincular.

   El código sólo se conoce si se emparejó en esta sesión (no se guarda en
   disco). Sin él, los bloques se quedan con sus puntos.
   ──────────────────────────────────────────────────────────── */

const REVEAL_MS = 1300; // tiempo para leer los 4 bloques antes de juntarlos
const MERGE_MS = 450;
const SHAKE_AT_MS = 700;
const RELINK_AT_MS = 1200;

const heroGradient =
  "bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))]";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const BoxApprovalScene = ({ phase, code, deviceName, deviceCode, revoked, errorText, onRelink }) => {
  const groups = code ? String(code).split("-") : [];
  const hasCode = groups.length === 4;
  const blocksRef = useRef(null);
  // approved: reveal → merge → done · rejected: reveal → shake → relink
  const [seq, setSeq] = useState("");
  const [offsets, setOffsets] = useState([]);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "wait") return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => {
    const fast = reducedMotion();
    const timers = [];
    const at = (ms, fn) => timers.push(window.setTimeout(fn, fast ? Math.min(ms, 30) : ms));
    setOffsets([]);
    if (phase === "approved") {
      setSeq("reveal");
      at(hasCode ? REVEAL_MS : 350, () => {
        const box = blocksRef.current?.getBoundingClientRect();
        const kids = [...(blocksRef.current?.children || [])];
        if (box) {
          const mid = box.left + box.width / 2;
          setOffsets(kids.map((k) => {
            const r = k.getBoundingClientRect();
            return mid - (r.left + r.width / 2);
          }));
        }
        setSeq("merge");
      });
      at((hasCode ? REVEAL_MS : 350) + MERGE_MS, () => setSeq("done"));
    } else if (phase === "rejected") {
      setSeq("reveal");
      at(SHAKE_AT_MS, () => setSeq("shake"));
      at(RELINK_AT_MS, () => setSeq("relink"));
    } else {
      setSeq("");
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [phase, hasCode]);

  const name = deviceName || "esta caja";
  const heading = {
    wait: ["Esperando aprobación", "El Host ya recibió el aviso. La descarga empieza sola al aprobarla."],
    off: ["No se pudo consultar el Host", "Revisa que el Host esté encendido y en la misma red. Seguimos intentando."],
    approved: ["Verificación exitosa", `El Host aprobó ${name}. Empezamos a descargar tu negocio.`],
    rejected: [
      revoked ? "El Host rechazó esta caja" : "El Host no reconoce esta caja",
      "Vuelve a vincularla con el código de activación; después el administrador la aprueba.",
    ],
  }[phase];

  const chip = {
    wait: `Pendiente · ${clock(now - startedAt)}`,
    off: "Sin conexión",
    approved: "Aprobada",
    rejected: revoked ? "Rechazada" : "Sin vínculo",
  }[phase];

  const marked = phase === "approved" ? "bw-ok" : phase === "rejected" ? "bw-bad" : "";

  return (
    <div className={cn("bw-scene flex flex-col items-center gap-6", `bw-${phase}`, seq === "done" && "bw-done")}>
      <header key={phase} className="bw-swap flex flex-col gap-1.5 text-center">
        <h2 className="text-2xl font-bold text-foreground">{heading[0]}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{heading[1]}</p>
      </header>

      <div className="relative flex min-h-[84px] w-full items-center justify-center">
        <div
          ref={blocksRef}
          className={cn("bw-blocks flex justify-center gap-3", seq === "merge" && "bw-merge", seq === "shake" && "bw-shake")}
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn("bw-blk", seq && marked)}
              style={{ "--i": i, "--dx": `${offsets[i] || 0}px` }}
            >
              {hasCode && marked ? (
                <span className="bw-t">{groups[i]}</span>
              ) : (
                [0, 1, 2, 3].map((j) => <span key={j} className="bw-d" style={{ "--j": j }} />)
              )}
            </span>
          ))}
        </div>
        {seq === "done" && (
          <div className="bw-seal" aria-hidden="true">
            <span className="bw-ring" />
            <span className="bw-ring" />
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="bw-spark" style={{ "--a": `${i * 36}deg` }} />
            ))}
            <svg viewBox="0 0 84 84">
              <circle className="bw-c" cx="42" cy="42" r="40" />
              <path className="bw-k" d="M26 43 l11 11 l21 -23" />
            </svg>
          </div>
        )}
      </div>

      <div className="grid w-full grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
        <div className="flex w-20 flex-col items-center gap-1.5 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-foreground shadow-md">
            <Monitor size={26} />
          </span>
          <span className="text-xs font-bold text-foreground">Esta caja</span>
          <span className="text-xs text-muted-foreground">{deviceCode ? `Serie ${deviceCode}` : "Sin serie aún"}</span>
        </div>
        <div className="bw-track">
          <i style={{ "--i": 0 }} />
          <i style={{ "--i": 1 }} />
        </div>
        <span className="bw-chip" role="status">
          <span className="bw-led" />
          {chip}
        </span>
        <div className="bw-track bw-back">
          <i style={{ "--i": 0 }} />
          <i style={{ "--i": 1 }} />
        </div>
        <div className="flex w-20 flex-col items-center gap-1.5 text-center">
          <span className={cn(heroGradient, "bw-host relative flex h-14 w-14 items-center justify-center rounded-2xl text-primary-foreground shadow-lg")}>
            <Store size={26} />
            {phase === "wait" && (
              <span className="bw-bell">
                <Bell size={12} strokeWidth={2.6} />
              </span>
            )}
          </span>
          <span className="text-xs font-bold text-foreground">Host</span>
          <span className="text-xs text-muted-foreground">PC principal</span>
        </div>
      </div>

      {phase === "off" && errorText && (
        <p className="w-full text-center font-mono text-xs text-muted-foreground">{errorText}</p>
      )}

      {phase === "wait" && (
        <div className="flex w-full flex-col gap-1 rounded-xl bg-muted px-4 py-3.5 text-sm leading-relaxed">
          <span className="font-bold text-foreground">En el Host:</span>
          <span className="text-muted-foreground">
            Toca <strong className="text-foreground">Revisar</strong> en el aviso, o entra a Configuración →
            Dispositivos y presiona <strong className="text-foreground">Aprobar</strong>.
          </span>
        </div>
      )}

      {phase === "rejected" && seq === "relink" && (
        <Button type="button" size="lg" className="bw-swap h-14 w-full text-base" onClick={onRelink}>
          <Unplug size={20} />
          Volver a vincular con el código
        </Button>
      )}
    </div>
  );
};

export default BoxApprovalScene;
