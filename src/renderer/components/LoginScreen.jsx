import React, { useState, useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2, User, Loader2 } from "lucide-react";
import { useCashier } from "../contexts/CashierContext";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

const colors = [
  "hsl(var(--category-1))",
  "hsl(var(--category-2))",
  "hsl(var(--category-3))",
  "hsl(var(--category-4))",
  "hsl(var(--category-5))",
  "hsl(var(--category-6))",
];

const LoginScreen = ({ onLogin }) => {
  const [cashiers, setCashiers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [storeName, setStoreName] = useState("MI TIENDA");
  const [storeLogo, setStoreLogo] = useState("");
  const { setCashier } = useCashier();
  const pinRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setUsersLoading(true);
      try {
        const [list, name, logo] = await Promise.all([
          window.api.invoke("get-cashiers"),
          window.api.invoke("get-setting", "store_name"),
          window.api.invoke("get-setting", "store_logo"),
        ]);
        setCashiers(list);
        if (name) setStoreName(name.toUpperCase());
        if (logo) setStoreLogo(logo);
      } catch {}
      setUsersLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    if (selectedId) pinRef.current?.focus();
  }, [selectedId]);

  const handleUserClick = (id) => {
    setSelectedId(id);
    setPin("");
    setError("");
  };

  const handlePinChange = (e) => {
    setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
    setError("");
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!selectedId) { setError("Selecciona un usuario"); return; }
    if (pin.length < 3) { setError("Ingresa el PIN completo"); return; }
    setLoading(true);
    try {
      const result = await window.api.invoke("verify-cashier-pin", selectedId, pin);
      if (result.success) {
        setCashier(result.cashier);
        if (onLogin) onLogin(result.cashier);
      } else {
        setError(result.error || "PIN incorrecto");
      }
    } catch { setError("Error al verificar PIN"); }
    setLoading(false);
  };

  const selectedCashier = cashiers.find((c) => c.id === selectedId);
  const selectedColor = selectedId !== null ? colors[selectedId % colors.length] : null;

  return (
    <div className="fade-in login-shell relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4 sm:p-8">
      {/* ══ Fondo de marca full-bleed (gradiente derivado de primary + trama) ══ */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(135deg, hsl(222 47% 14%), hsl(218 55% 32%))",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(hsl(0 0% 100% / 0.10) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* ══ Marca ══ */}
      <div className="login-brand relative z-10 mb-5 flex flex-col items-center text-center">
        <div className="login-logo mb-3 flex h-16 w-16 items-center justify-center rounded-xl bg-white/10 p-2 ring-1 ring-white/20 backdrop-blur">
          {storeLogo ? (
            <img src={storeLogo} alt={`Logo de ${storeName}`} className="h-full w-full rounded-lg object-contain" />
          ) : (
            <User size={30} className="text-white" />
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white text-display">
          {storeName}
        </h1>
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.3em] text-white/60">
          VENDIA
        </p>
      </div>

      {/* ══ Card de acceso ══ */}
      {/* La card se ensancha sola con 4+ cajeros para que todos quepan
          en una fila (sin envolver a 2 filas y sin scroll). */}
      <div className={cn(
        "login-card relative z-10 w-full rounded-xl border border-border bg-card px-7 py-10 shadow-md transition-[max-width] duration-300 sm:px-9 sm:py-12",
        cashiers.length >= 4 ? "max-w-3xl" : "max-w-2xl"
      )}>
        <h2 className="mb-6 text-center text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Selecciona tu usuario
        </h2>

        {/* Grid de cajeros (estilo profile picker) */}
        {usersLoading ? (
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-32 sm:w-40">
                <Skeleton className="mx-auto h-[72px] w-[72px] rounded-full" />
                <Skeleton className="mx-auto mt-3 h-4 w-20" />
                <Skeleton className="mx-auto mt-1.5 h-3 w-12" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            {cashiers.map((c, idx) => {
              const isSelected = selectedId === c.id;
              const initial = c.name.charAt(0).toUpperCase();
              const bgColor = colors[idx % colors.length];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleUserClick(c.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-32 flex-col items-center gap-2 rounded-lg border px-4 py-4 text-center transition-colors duration-150 sm:w-40",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card cursor-pointer",
                    isSelected
                      ? "shadow-sm"
                      : "border-border bg-muted hover:border-foreground/20 hover:bg-foreground/[0.04]"
                  )}
                  style={
                    isSelected
                      ? {
                          borderColor: bgColor,
                          backgroundColor: `color-mix(in srgb, ${bgColor} 12%, transparent)`,
                        }
                      : undefined
                  }
                >
                  <span className="relative">
                    <span
                      className={cn(
                        "flex h-[72px] w-[72px] items-center justify-center rounded-full text-xl font-bold",
                        isSelected ? "" : "border border-border bg-card text-muted-foreground"
                      )}
                      style={isSelected ? { background: bgColor, color: "white" } : undefined}
                    >
                      {initial}
                    </span>
                    {isSelected && (
                      <span className="absolute -right-1 -top-1 rounded-full bg-card p-0.5 shadow-sm ring-1 ring-border">
                        <CheckCircle2 size={16} style={{ color: bgColor }} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-base font-semibold text-foreground">
                    {c.name}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {c.role === "admin" ? "Propietario" : "Cajero"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ══ Zona PIN — altura reservada, sin salto de layout ══ */}
        <div className="login-zone relative mt-10 min-h-[304px]">
          {selectedId === null ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 px-6 text-center text-sm text-muted-foreground"
            >
              Selecciona tu usuario para ingresar tu PIN
            </div>
          ) : (
            <div className="login-pin fade-in rounded-lg border border-border bg-muted p-7">
              <div className="mb-5 flex items-center gap-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold"
                  style={{ background: selectedColor, color: "white" }}
                >
                  {selectedCashier?.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-foreground">
                    {selectedCashier?.name}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    Ingresa tu PIN de acceso
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedId(null); setPin(""); setError(""); }}
                  className="shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  Cambiar
                </button>
              </div>

              <Input
                ref={pinRef}
                value={pin}
                onChange={handlePinChange}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                type="password"
                placeholder="••••"
                maxLength={6}
                aria-label="PIN de acceso"
                className="h-16 rounded-lg pl-[0.6em] text-center text-3xl font-bold tracking-[0.6em] shadow-none"
              />

              <div className="mt-3 flex min-h-[24px] items-center justify-center">
                {error && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <Button
                onClick={handleSubmit}
                disabled={loading || pin.length < 3}
                className="mt-4 h-14 w-full rounded-lg text-base font-bold"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    Entrar
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      <p className="login-footer relative z-10 mt-6 text-center text-[11px] font-medium uppercase tracking-wider text-white/50">
        Powered by JRP Core v2.0
      </p>
    </div>
  );
};

export default LoginScreen;
