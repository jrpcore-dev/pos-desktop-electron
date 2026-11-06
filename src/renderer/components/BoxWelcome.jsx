import React, { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import vendiaIcon from "../assets/icon-vendia.svg";

// Entrada escalonada: primero la confirmación y después lo que hay que leer.
const reveal =
  "animate-in fade-in-0 slide-in-from-bottom-3 fill-mode-both duration-500 ease-out motion-reduce:animate-none";

// Cierre de la configuración de una caja. Sale una sola vez, al terminar la
// primera descarga: los arranques normales van directo al login.
const BoxWelcome = ({ deviceCode, onContinue }) => {
  const [storeName, setStoreName] = useState("");

  useEffect(() => {
    let alive = true;
    window.api
      .invoke("get-setting", "store_name")
      .then((name) => {
        if (alive && typeof name === "string") setStoreName(name.trim());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex bg-muted p-4">
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(var(--hero-gradient-from))] to-[hsl(var(--hero-gradient-to))] p-8 text-center text-primary-foreground shadow-[0_1px_2px_hsl(222_47%_11%_/_0.06),0_12px_24px_-8px_hsl(222_47%_11%_/_0.2),0_32px_64px_-24px_hsl(222_47%_11%_/_0.35)]">
        <div className="absolute left-8 top-8 flex items-center gap-3">
          <img src={vendiaIcon} alt="" className="h-10 w-10 shrink-0" />
          <span className="text-xl font-bold">Vendia</span>
        </div>

        <div className="relative flex h-32 w-32 items-center justify-center" aria-hidden="true">
          <span className="box-welcome-ring absolute inset-0 rounded-full border-2 border-primary-foreground/30" />
          <span className="box-welcome-ring box-welcome-ring-late absolute inset-0 rounded-full border-2 border-primary-foreground/20" />
          <span className="box-welcome-badge flex h-24 w-24 items-center justify-center rounded-full bg-success text-success-foreground shadow-[0_12px_32px_-8px_hsl(222_47%_11%_/_0.55)]">
            {/* SVG propio: `pathLength` permite trazar la palomita con CSS. */}
            <svg viewBox="0 0 24 24" className="box-welcome-check h-[52px] w-[52px]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path pathLength="1" d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        </div>

        <p
          className={cn(reveal, "mt-8 text-xs font-semibold uppercase tracking-widest text-primary-foreground/70")}
          style={{ animationDelay: "450ms" }}
        >
          {deviceCode ? `Caja ${deviceCode} lista` : "Caja lista"}
        </p>
        <h1
          className={cn(reveal, "mt-3 text-5xl font-bold leading-tight tracking-tight")}
          style={{ animationDelay: "550ms" }}
        >
          ¡Te damos la bienvenida a Vendia!
        </h1>
        <p
          className={cn(reveal, "mt-3 max-w-md text-lg leading-relaxed text-primary-foreground/80")}
          style={{ animationDelay: "650ms" }}
        >
          {storeName
            ? `Todo listo: esta caja ya trabaja con ${storeName}.`
            : "Todo listo: esta caja ya trabaja con tu negocio."}
        </p>
        <div className={cn(reveal, "mt-8")} style={{ animationDelay: "800ms" }}>
          <Button
            type="button"
            size="lg"
            autoFocus
            onClick={onContinue}
            className="bg-primary-foreground text-primary shadow-lg hover:bg-primary-foreground/90"
          >
            Empezar a usar Vendia
            <ArrowRight size={18} />
          </Button>
        </div>
      </main>
    </div>
  );
};

export default BoxWelcome;
