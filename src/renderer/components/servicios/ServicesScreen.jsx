import { useCallback, useEffect, useRef, useState } from "react";
import {
  History,
  Loader2,
  RefreshCw,
  Settings2,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { Button } from "../ui/button";
import { Hint } from "../ui/hint";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useToast } from "@/components/ToastProvider";
import { toUiOperators, toUiTransaction } from "./taecelCatalog";
import { money } from "./serviceMoney";
import { useCashier } from "@/contexts/CashierContext";
import ServiceCheckout from "./ServiceCheckout";
import ServiceHistory from "./ServiceHistory";
import ServiceProviderDialog from "./ServiceProviderDialog";

// Pantalla de Servicios: cobro e historial en la misma ruta.
// Este archivo es el único dueño del estado compartido entre las dos pestañas.
// Todo pasa por el Host (`taecel:*`): en una caja viajan por RPC.
const ServicesScreen = () => {
  // Quién cobra: el Host sólo acepta el id y resolve al nombre desde su BD,
  // así una caja no puede inventar el nombre de otro cajero.
  const { cashier } = useCashier();
  const notify = useToast();
  const [tab, setTab] = useState("cobrar");
  const [transactions, setTransactions] = useState([]);
  const pendingCount = transactions.filter((t) =>
    ["unknown", "pending", "needs_review"].includes(t.status),
  ).length;
  const [operators, setOperators] = useState([]);
  const [busyFolio, setBusyFolio] = useState(null);
  const [provider, setProvider] = useState({ state: "loading" });
  const [checking, setChecking] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await window.api.invoke("taecel:history", { limit: 100 });
      if (mounted.current && res?.ok) {
        setTransactions((res.transactions || []).map(toUiTransaction));
      }
    } catch (e) {
      // El historial se vuelve a pedir en la siguiente consulta.
    }
  }, []);

  const checkProvider = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const api = window.api;
      if (!api?.invoke) {
        if (mounted.current) setProvider({ state: "local", error: "sin puente IPC" });
        return;
      }
      const [res, catalog] = await Promise.all([
        api.invoke("taecel:get-balance", { force }),
        api.invoke("taecel:get-catalog", { force: false }),
      ]);
      if (!mounted.current) return;
      if (catalog?.ok) setOperators(toUiOperators(catalog));
      if (res?.ok && catalog?.ok) {
        setProvider({
          state: "live",
          airtimeCents: res.airtimeCents,
          servicesCents: res.servicesCents,
        });
      } else {
        const failed = !res?.ok ? res : catalog;
        setProvider({
          state: "local",
          notConfigured: failed?.code === "TAECEL_NOT_CONFIGURED",
          error: failed?.error || "sin conexión con Taecel",
        });
      }
    } catch (e) {
      if (mounted.current) {
        setProvider({ state: "local", error: e?.message || "sin conexión" });
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkProvider();
    loadHistory();
    const t = setInterval(checkProvider, 6 * 60 * 1000);
    return () => clearInterval(t);
  }, [checkProvider, loadHistory]);

  // Fuerza la baja del catálogo a Taecel (el Host aplica su cooldown de
  // 1 hora). Sirve cuando se activan servicios o tarjetas en el panel de
  // Taecel y no se quiere esperar a que venza la caché de 24 h.
  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await window.api.invoke("taecel:refresh-catalog");
      if (!mounted.current) return;
      if (!res?.ok) {
        notify(res?.error || "No se pudo actualizar el catálogo", "error");
        return;
      }
      if (res.cooldown) {
        notify("El catálogo ya se actualizó hace menos de 1 hora", "info");
        return;
      }
      setOperators(toUiOperators(res));
      notify(
        `Catálogo actualizado · ${(res.operators || []).length} compañías`,
        "success",
      );
    } catch (e) {
      if (mounted.current) {
        notify(e?.message || "No se pudo actualizar el catálogo", "error");
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [notify]);

  const upsert = useCallback((tx) => {
    if (!tx) return;
    setTransactions((rows) => {
      const i = rows.findIndex(
        (r) => r.clientRequestId && r.clientRequestId === tx.clientRequestId,
      );
      if (i === -1) {
        return [{ ...tx, createdAt: tx.createdAt || new Date().toISOString() }, ...rows];
      }
      const next = [...rows];
      next[i] = { ...next[i], ...tx };
      return next;
    });
  }, []);

  // "Reintentar" en el historial consulta a Taecel por la MISMA operación.
  const handleRetry = useCallback(
    async (tx) => {
      setBusyFolio(tx.folio);
      try {
        const res = await window.api.invoke("taecel:transaction-status", {
          transactionId: tx.transactionId,
          clientRequestId: tx.clientRequestId,
        });
        if (res?.ok && res.transaction) {
          const next = toUiTransaction(res.transaction);
          upsert(next);
          notify(
            next.status === "applied"
              ? `Folio ${next.folio} confirmado`
              : `Folio ${next.folio}: ${next.status === "failed" ? "rechazado" : "sigue sin confirmar"}`,
            next.status === "applied" ? "success" : "error",
          );
        } else {
          notify(res?.error || "No se pudo consultar el estado", "error");
        }
      } catch (e) {
        notify(e?.message || "No se pudo consultar el estado", "error");
      } finally {
        if (mounted.current) setBusyFolio(null);
      }
    },
    [upsert, notify],
  );

  return (
    <div className="flex flex-col">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          if (next === "historial") loadHistory();
        }}
      >
        {/* Una sola barra: pestañas, estado de Taecel con saldos y acciones.
            El navbar ya dice «Servicios», así que no hace falta descripción. */}
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="w-fit">
            <TabsTrigger value="cobrar" className="gap-1.5 px-3 text-sm">
              <Zap size={14} aria-hidden />
              Cobrar
            </TabsTrigger>
            <TabsTrigger value="historial" className="gap-1.5 px-3 text-sm">
              <History size={14} aria-hidden />
              Historial
              {pendingCount > 0 && (
                <span
                  className="rounded-full bg-warning/15 px-1.5 text-[10.5px] font-bold leading-4 text-amber-700 tabular-nums dark:text-warning"
                  aria-label={`${pendingCount} por confirmar`}
                >
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Saldos de Taecel como dos "bolsas": punto verde si alcanza,
              ámbar si queda poco. Sin conexión, el motivo en su lugar. */}
          <div role="status" aria-live="polite" className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            {provider.state === "live" ? (
              <>
                <Balance label="Tiempo aire" cents={provider.airtimeCents} />
                <Balance label="Servicios" cents={provider.servicesCents} />
              </>
            ) : (
              <span className="inline-flex h-9 min-w-0 items-center gap-2 rounded-[9px] bg-card px-3 text-xs ring-1 ring-border">
                {provider.state === "loading" ? (
                  <Loader2 size={13} className="animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <WifiOff size={13} className="text-warning" aria-hidden />
                )}
                <span className="truncate text-muted-foreground">
                  {provider.state === "loading"
                    ? "Consultando saldo de Taecel…"
                    : provider.notConfigured
                      ? "Taecel sin configurar · captura la Key y el NIP en «Proveedor»"
                      : `Taecel sin conexión${provider.error ? ` · ${provider.error}` : ""}`}
                </span>
              </span>
            )}
          </div>

          {provider.state === "local" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => checkProvider(true)}
              disabled={checking}
              className="h-9 gap-1.5"
            >
              {checking ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw size={14} aria-hidden />
              )}
              Reintentar
            </Button>
          )}
          <Hint label="Actualizar catálogo de Taecel (1 vez por hora)">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={refreshCatalog}
            disabled={refreshing || checking}
            className="size-9"
            aria-label="Actualizar catálogo"
          >
            {refreshing ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={15} aria-hidden />
            )}
          </Button>
          </Hint>
          <Hint label="Proveedor (Key y NIP de Taecel)">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setConfigOpen(true)}
            className="size-9"
            aria-label="Proveedor"
          >
            <Settings2 size={15} aria-hidden />
          </Button>
          </Hint>
        </div>

        <TabsContent value="cobrar" className="mt-3">
          <ServiceCheckout
            operators={operators}
            transactions={transactions}
            onTransaction={upsert}
            providerLive={provider.state === "live"}
            cashierId={cashier?.id ?? null}
            loading={provider.state === "loading" && operators.length === 0}
          />
        </TabsContent>

        <TabsContent value="historial" className="mt-3">
          <ServiceHistory
            transactions={transactions}
            onRetry={handleRetry}
            busyFolio={busyFolio}
          />
        </TabsContent>
      </Tabs>

      <ServiceProviderDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        onSaved={() => checkProvider(true)}
      />
    </div>
  );
};

// Saldo de una bolsa de Taecel; en ámbar cuando ya alcanza para poco.
const LOW_BALANCE_CENTS = 200 * 100;
const Balance = ({ label, cents = 0 }) => {
  const low = cents < LOW_BALANCE_CENTS;
  return (
    <Hint label={low ? "Saldo bajo en Taecel: recarga la bolsa pronto" : undefined}>
    <span
      tabIndex={low ? 0 : undefined}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-card pl-2.5 pr-3 text-xs ring-1 ring-border"
    >
      <span className={cn("size-2 rounded-full", low ? "bg-warning" : "bg-success")} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <b className={cn("text-[13px] font-bold tabular-nums", low ? "text-amber-700 dark:text-warning" : "text-foreground")}>
        {money(cents || 0)}
      </b>
    </span>
    </Hint>
  );
};

export default ServicesScreen;