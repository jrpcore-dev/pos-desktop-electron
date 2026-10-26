import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Loader2, Store } from "lucide-react";
import { useCashier } from "../contexts/CashierContext";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { InitialsAvatar } from "./ui/initials-avatar";
import { cn } from "@/lib/utils";
import vendiaIcon from "../assets/icon-vendia.svg";

// Hora y fecha del panel de marca (zona de la tienda).
const fmtTime = (d) =>
  d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
const fmtDate = (d) => {
  const t = d.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Mexico_City",
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Círculos del PIN: 4 fijos; aparece el 5.º/6.º sólo al escribir ese dígito.
const PIN_MIN_SLOTS = 4;
const PIN_MAX = 6;

const LoginScreen = ({ onLogin, isFirstTime, onConvertToBox }) => {
  const [cashiers, setCashiers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [storeName, setStoreName] = useState("MI TIENDA");
  const [storeLogo, setStoreLogo] = useState("");
  const { setCashier } = useCashier();
  const pinRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [pinFocused, setPinFocused] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const load = async (initial) => {
      // En caja la lista viene del Host: se refresca sola cada 10 s para
      // mostrar cajeros nuevos sin recargar la pantalla.
      if (initial) setUsersLoading(true);
      try {
        const [list, name, logo] = await Promise.all([
          window.api.invoke("get-cashiers"),
          window.api.invoke("get-setting", "store_name"),
          window.api.invoke("get-setting", "store_logo"),
        ]);
        if (Array.isArray(list)) setCashiers(list);
        if (name) setStoreName(name.toUpperCase());
        if (logo) setStoreLogo(logo);
      } catch {}
      if (initial) setUsersLoading(false);
    };
    load(true);
    const timer = window.setInterval(() => load(false), 10000);
    // Al instante: si el Host agrega un cajero, el aviso db-changed llega por
    // el flujo en vivo y la lista se refresca sin esperar al barrido.
    const off = window.api?.on?.("db-changed", (payload) => {
      const tables = Array.isArray(payload?.tables)
        ? payload.tables.map((t) => String(t).toLowerCase())
        : [];
      if (!tables.length || tables.includes("cashiers")) load(false);
    });
    return () => {
      window.clearInterval(timer);
      if (typeof off === "function") off();
    };
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
    setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX));
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
        setPin("");
        setShakeKey((k) => k + 1);
      }
    } catch { setError("Error al verificar PIN"); }
    setLoading(false);
  };

  // 3g/F · única puerta para instalar esta PC como caja adicional: escribe el
  // rol con box-save-settings (el asistente de vinculación toma el relevo).
  const handleConvertToBox = async () => {
    if (converting) return;
    setConverting(true);
    try {
      const res = await window.api.invoke("box-save-settings", { device_role: "client" });
      if (res?.device_role === "client" && onConvertToBox) onConvertToBox();
      else setError("No se pudo activar el modo caja");
    } catch {
      setError("No se pudo activar el modo caja");
    }
    setConverting(false);
  };

  const selectedCashier = cashiers.find((c) => c.id === selectedId);
  const slots = Math.max(PIN_MIN_SLOTS, Math.min(PIN_MAX, pin.length));

  return (
    <div className="fade-in flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg md:min-h-[600px] md:grid-cols-[5fr_7fr]">
        {/* ══ Panel de marca: degradado con tonos de la paleta ══ */}
        <aside className="relative flex flex-col gap-10 overflow-hidden bg-gradient-to-br from-[hsl(var(--chart-5))] to-[hsl(var(--chart-1))] p-8 text-white dark:to-[hsl(var(--chart-4))] sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              backgroundImage: "radial-gradient(hsl(0 0% 100% / 0.12) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="relative flex flex-1 flex-col items-center justify-center text-center">
            <div className="flex size-32 items-center justify-center rounded-3xl bg-white/10 p-4 shadow-lg ring-1 ring-white/20 backdrop-blur">
              {storeLogo ? (
                <img src={storeLogo} alt="" className="size-full rounded-2xl object-contain" />
              ) : (
                <Store size={56} strokeWidth={1.5} />
              )}
            </div>
            <h1 className="mt-6 text-3xl font-bold leading-tight tracking-tight">{storeName}</h1>
          </div>

          <div className="relative text-center">
            <p className="text-4xl font-medium leading-none tracking-tight text-white/90 tabular-nums">{fmtTime(now)}</p>
            <p className="mt-2 text-sm text-white/70">{fmtDate(now)}</p>
          </div>
        </aside>

        {/* ══ Acceso ══ */}
        <section className="flex flex-col p-8 sm:p-12">
          {selectedId === null ? (
            <div key="users" className="fade-in flex flex-1 flex-col">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">Bienvenido</h2>
              <p className="mt-1.5 text-base text-muted-foreground">Selecciona tu usuario para continuar</p>

              <div className="-mx-2 mt-8 max-h-[400px] flex-1 space-y-1.5 overflow-y-auto px-2">
                {usersLoading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                        <Skeleton className="size-11 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    ))
                  : cashiers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleUserClick(c.id)}
                        className="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-transparent px-3 py-3 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <InitialsAvatar
                          id={c.id}
                          name={c.name}
                          letters={1}
                          solid={c.role === "admin"}
                          className="size-12 text-lg"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-lg font-semibold text-foreground">{c.name}</span>
                          <Badge
                            variant={c.role === "admin" ? "soft-primary" : "soft-neutral"}
                            className="mt-0.5 px-1.5 py-0"
                          >
                            {c.role === "admin" ? "Propietario" : "Cajero"}
                          </Badge>
                        </span>
                        <ChevronRight className="size-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </button>
                    ))}
                {!usersLoading && cashiers.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No hay usuarios registrados.</p>
                )}
              </div>
            </div>
          ) : (
            <div key="pin" className="fade-in flex flex-1 flex-col">
              <button
                type="button"
                onClick={() => { setSelectedId(null); setPin(""); setError(""); }}
                className="-ml-2 inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                Cambiar usuario
              </button>

              <div className="flex flex-1 flex-col items-center justify-center py-6">
                <InitialsAvatar
                  id={selectedCashier?.id}
                  name={selectedCashier?.name || ""}
                  letters={1}
                  solid={selectedCashier?.role === "admin"}
                  className="size-24 text-4xl"
                />
                <p className="mt-4 text-2xl font-semibold text-foreground">{selectedCashier?.name}</p>
                <p className="text-sm text-muted-foreground">Ingresa tu PIN</p>

                {/* El PIN se escribe en un input oculto; los círculos sólo lo muestran. */}
                <div
                  key={shakeKey}
                  onClick={() => pinRef.current?.focus()}
                  className={cn(
                    "mt-6 flex cursor-text items-center gap-3 rounded-xl px-4 py-3 transition-shadow",
                    pinFocused && "ring-2 ring-ring/20",
                    shakeKey > 0 && "shake",
                  )}
                >
                  {Array.from({ length: slots }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "size-5 rounded-full transition-all duration-150",
                        i < pin.length
                          ? error
                            ? "scale-110 bg-destructive"
                            : "scale-110 bg-primary"
                          : "border-2 border-border bg-transparent",
                      )}
                    />
                  ))}
                </div>
                <input
                  ref={pinRef}
                  value={pin}
                  onChange={handlePinChange}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  onFocus={() => setPinFocused(true)}
                  onBlur={() => setPinFocused(false)}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_MAX}
                  aria-label="PIN de acceso"
                  className="sr-only"
                />

                <p role="alert" className="mt-3 min-h-5 text-sm font-medium text-destructive dark:text-red-400">
                  {error}
                </p>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={loading || pin.length < 3}
                className="h-14 w-full rounded-xl text-lg font-semibold"
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
        </section>
      </div>

      {/* Marca del sistema, fuera de la tarjeta. */}
      <div className="mt-6 flex flex-col items-center gap-0.5">
        <span className="inline-flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <img src={vendiaIcon} alt="" className="size-7" />
          Vendia
        </span>
        <span className="text-xs text-muted-foreground">Powered by JRP Core v2.0</span>
      </div>

      {isFirstTime && (
        <button
          type="button"
          onClick={handleConvertToBox}
          disabled={converting}
          className="mt-5 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {converting ? "Activando caja..." : "¿Esta PC será una caja adicional? Actívala aquí"}
        </button>
      )}
    </div>
  );
};

export default LoginScreen;
