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
          <TabsList className="h-9 w-fit">
            <TabsTrigger value="cobrar" className="h-8 gap-1.5 px-3 text-sm">
              <Zap size={14} aria-hidden />
              Cobrar
            </TabsTrigger>
            <TabsTrigger value="historial" className="h-8 gap-1.5 px-3 text-sm">
              <History size={14} aria-hidden />
              Historial
            </TabsTrigger>
          </TabsList>

          <div
            role="status"
            aria-live="polite"
            className="ml-auto flex h-9 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-xs"
          >
            <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
              {provider.state === "live" ? (
                <Wifi size={13} className="text-success" aria-hidden />
              ) : provider.state === "loading" ? (
                <Loader2 size={13} className="animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <WifiOff size={13} className="text-warning" aria-hidden />
              )}
              Taecel
            </span>
            <span aria-hidden className="h-4 w-px bg-border" />
            {provider.state === "live" ? (
              <>
                <Balance label="Tiempo aire" cents={provider.airtimeCents} />
                <Balance label="Servicios" cents={provider.servicesCents} />
              </>
            ) : (
              <span className="truncate text-muted-foreground">
                {provider.state === "loading"
                  ? "Consultando saldo…"
                  : provider.notConfigured
                    ? "Sin configurar · captura la Key y el NIP en «Proveedor»"
                    : `Sin conexión${provider.error ? ` · ${provider.error}` : ""}`}
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
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={refreshCatalog}
            disabled={refreshing || checking}
            className="size-9"
            title="Actualizar catálogo de Taecel (1 vez por hora)"
            aria-label="Actualizar catálogo"
          >
            {refreshing ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={15} aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setConfigOpen(true)}
            className="size-9"
            title="Proveedor (Key y NIP de Taecel)"
            aria-label="Proveedor"
          >
            <Settings2 size={15} aria-hidden />
          </Button>
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
const Balance = ({ label, cents = 0 }) => (
  <span className="inline-flex shrink-0 items-baseline gap-1">
    <span className="text-muted-foreground">{label}</span>
    <b
      className={cn(
        "font-bold tabular-nums",
        cents < LOW_BALANCE_CENTS ? "text-warning" : "text-foreground",
      )}
    >
      {money(cents || 0)}
    </b>
  </span>
);

export default ServicesScreen;