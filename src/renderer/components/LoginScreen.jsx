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
    <div
      className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8"
      style={{ background: "hsl(var(--background))" }}
    >
      <div className="fade-in grid w-full max-w-6xl overflow-hidden rounded-3xl border shadow-xl md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
      >
        {/* Panel lateral de marca */}
        <div
          className="relative hidden flex-col items-center justify-center overflow-hidden p-10 text-center md:flex"
          style={{
            background: "linear-gradient(135deg, hsl(222,47%,24%), hsl(218,55%,40%))",
          }}
        >
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-20 blur-3xl"
            style={{ background: "hsl(218,55%,60%)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-20 -left-16 h-72 w-72 rounded-full opacity-20 blur-3xl"
            style={{ background: "hsl(199,89%,48%)" }}
          />

          <div className="relative mb-6 flex h-24 w-24 items-center justify-center rounded-2xl bg-white/10 shadow-lg ring-1 ring-white/20 backdrop-blur">
            {storeLogo ? (
              <img src={storeLogo} alt="Logo" className="h-full w-full rounded-2xl object-contain p-2" />
            ) : (
              <User size={48} className="text-white" />
            )}
          </div>

          <h1 className="relative text-3xl font-extrabold tracking-tight text-white text-display">
            {storeName}
          </h1>
          <p className="relative mt-1 text-sm font-medium uppercase tracking-[3px] text-white/70">
            VENDIA
          </p>

          <div className="relative mt-10 space-y-3 text-left text-sm text-white/80">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={18} className="shrink-0 text-white" />
              <span>Acceso rápido y seguro</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={18} className="shrink-0 text-white" />
              <span>Selecciona tu usuario e ingresa tu PIN</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={18} className="shrink-0 text-white" />
              <span>Control por cajero en tiempo real</span>
            </div>
          </div>
        </div>

        {/* Panel de acceso */}
        <div className="flex max-h-[calc(100vh-4rem)] flex-col justify-center overflow-y-auto p-7 sm:p-12">
          {/* Header móvil (cuando no hay panel lateral) */}
          <div className="mb-6 flex flex-col items-center text-center md:hidden">
            {storeLogo ? (
              <img src={storeLogo} alt="Logo" className="mb-3 h-16 w-16 rounded-2xl border object-contain p-1"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }} />
            ) : (
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: "hsl(var(--primary))" }}>
                <User size={32} style={{ color: "hsl(var(--primary-foreground))" }} />
              </div>
            )}
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: "hsl(var(--foreground))" }}>
              {storeName}
            </h1>
            <p className="text-xs font-medium uppercase tracking-[3px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              VENDIA
            </p>
          </div>

          {/* Seleccionar cajero */}
          <h2 className="mb-4 w-full text-center text-sm font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
            Seleccionar Cajero
          </h2>

          {usersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 rounded-xl border p-4"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
                  <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-[60%]" />
                    <Skeleton className="h-3 w-[40%]" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {cashiers.map((c, idx) => {
                const isSelected = selectedId === c.id;
                const initial = c.name.charAt(0).toUpperCase();
                const bgColor = colors[idx % colors.length];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleUserClick(c.id)}
                    className={cn(
                      "flex w-full min-h-[64px] items-center gap-4 rounded-xl border-2 px-4 py-3 text-left transition-all duration-150",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 cursor-pointer",
                      isSelected ? "shadow-sm" : "hover:border-black/20 hover:bg-black/[0.03] dark:hover:border-white/20 dark:hover:bg-white/[0.04]"
                    )}
                    style={
                      isSelected
                        ? { borderColor: bgColor, backgroundColor: `${bgColor}12` }
                        : { borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }
                    }
                  >
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold"
                      style={{
                        background: isSelected ? bgColor : "hsl(var(--muted))",
                        color: isSelected ? "white" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {initial}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        {c.name}
                      </span>
                      <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {c.role === "admin" ? "Propietario" : "Cajero"}
                      </span>
                    </span>
                    {isSelected && <CheckCircle2 size={20} style={{ color: bgColor }} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* PIN */}
          {selectedId !== null && (
            <div className="fade-in-up mt-6 rounded-xl border p-6" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
              <div className="relative mb-5 flex flex-col items-center gap-2 text-center">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                  style={{ background: selectedColor, color: "white" }}>
                  {selectedCashier?.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    {selectedCashier?.name}
                  </p>
                  <p className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Ingresa tu PIN de acceso
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedId(null); setPin(""); setError(""); }}
                  className="absolute right-0 top-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-black/5"
                  style={{ color: "hsl(var(--muted-foreground))" }}
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
                className="h-16 rounded-lg text-center text-3xl font-bold tracking-[0.6em] shadow-inner"
              />

              {error && (
                <p className="mt-3 text-center text-sm font-medium" style={{ color: "hsl(var(--destructive))" }}>
                  {error}
                </p>
              )}

              <Button
                onClick={handleSubmit}
                disabled={loading || pin.length < 3}
                className="mt-4 h-14 w-full rounded-lg text-base font-bold"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
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

      <p className="mt-8 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.6 }}>
        POWERED BY JRP CORE V2.0
      </p>
    </div>
  );
};

export default LoginScreen;
