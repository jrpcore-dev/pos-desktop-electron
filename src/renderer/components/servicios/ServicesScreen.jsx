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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useToast } from "@/components/ToastProvider";
import { mockExecute, MOCK_TRANSACTIONS } from "./serviceCatalog.mock";
import { money } from "./serviceMoney";
import PageHeader from "../PageHeader";
import ServiceCheckout from "./ServiceCheckout";
import ServiceHistory from "./ServiceHistory";
import ServiceProviderDialog from "./ServiceProviderDialog";

// Pantalla de Servicios: cobro e historial en la misma ruta.
// Este archivo es el único dueño del estado compartido entre las dos pestañas.
const ServicesScreen = () => {
  const notify = useToast();
  const [tab, setTab] = useState("cobrar");
  const [transactions, setTransactions] = useState(MOCK_TRANSACTIONS);
  const [busyFolio, setBusyFolio] = useState(null);
  const [provider, setProvider] = useState({ state: "loading" });
  const [checking, setChecking] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const checkProvider = useCallback(async () => {
    setChecking(true);
    try {
      const api = window.api;
      if (!api?.invoke) {
        if (mounted.current) setProvider({ state: "local", error: "sin puente IPC" });
        return;
      }
      const res = await api.invoke("vendesaldo:get-balance");
      if (!mounted.current) return;
      if (res?.ok) {
        setProvider({
          state: "live",
          recargas: res.recargas,
          servicios: res.servicios,
        });
      } else {
        setProvider({
          state: "local",
          error: res?.error || "sin conexión con el proveedor",
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
    const t = setInterval(checkProvider, 6 * 60 * 1000);
    return () => clearInterval(t);
  }, [checkProvider]);

  const upsert = useCallback((tx) => {
    if (!tx) return;
    setTransactions((rows) => {
      const i = rows.findIndex((r) => r.folio === tx.folio);
      if (i === -1) {
        return [
          { ...tx, id: Date.now(), createdAt: new Date().toISOString() },
          ...rows,
        ];
      }
      const next = [...rows];
      next[i] = { ...next[i], ...tx };
      return next;
    });
  }, []);

  const handleRetry = useCallback(
    async (tx) => {
      setBusyFolio(tx.folio);
      const res = await mockExecute({ folio: tx.folio });
      upsert({
        ...tx,
        status: res.status,
        providerRef: res.providerRef || tx.providerRef,
        message: res.message,
      });
      setBusyFolio(null);
      notify(
        res.status === "applied"
          ? `Folio ${tx.folio} confirmado`
          : `Folio ${tx.folio} sigue sin aplicarse`,
        res.status === "applied" ? "success" : "error",
      );
    },
    [upsert, notify],
  );

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        description="Cobra recargas, paquetes y pagos de servicios desde el punto de venta"
        meta={
          <span
            role="status"
            aria-live="polite"
            className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
              {provider.state === "live" ? (
                <Wifi size={13} className="text-success" aria-hidden />
              ) : provider.state === "loading" ? (
                <Loader2
                  size={13}
                  className="animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <WifiOff size={13} className="text-warning" aria-hidden />
              )}
              Vendesaldo
            </span>
            <span aria-hidden className="h-3 w-px bg-border" />
            <span className="tabular-nums">
              {provider.state === "loading" && "Consultando saldo…"}
              {provider.state === "live" && (
                <>
                  Saldo recargas{" "}
                  <b className="font-semibold text-foreground">
                    {money(parseFloat(provider.recargas || 0) * 100)}
                  </b>{" "}
                  · servicios{" "}
                  <b className="font-semibold text-foreground">
                    {money(parseFloat(provider.servicios || 0) * 100)}
                  </b>
                </>
              )}
              {provider.state === "local" &&
                `Catálogo local${provider.error ? ` · ${provider.error}` : ""}`}
            </span>
          </span>
        }
        actions={
          <>
            {provider.state === "local" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={checkProvider}
                disabled={checking}
                className="gap-1.5"
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
              size="sm"
              onClick={() => setConfigOpen(true)}
              className="gap-1.5"
            >
              <Settings2 size={14} aria-hidden />
              Proveedor
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
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

        <TabsContent value="cobrar" className="mt-3">
          <ServiceCheckout
            onTransaction={upsert}
            providerLive={provider.state === "live"}
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
        onSaved={checkProvider}
      />
    </div>
  );
};

export default ServicesScreen;