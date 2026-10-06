import { useCallback, useState } from "react";
import { History, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useToast } from "@/components/ToastProvider";
import { mockExecute, MOCK_TRANSACTIONS } from "./serviceCatalog.mock";
import ServiceCheckout from "./ServiceCheckout";
import ServiceHistory from "./ServiceHistory";

// Pantalla de Servicios: cobro e historial en la misma ruta.
// Este archivo es el único dueño del estado compartido entre las dos pestañas.
// Cuando llegue Seycel, deja de tocar este estado y consulta la base.
const ServicesScreen = () => {
  const notify = useToast();
  const [tab, setTab] = useState("cobrar");
  const [transactions, setTransactions] = useState(MOCK_TRANSACTIONS);
  const [busyFolio, setBusyFolio] = useState(null);

  /** Una transacción nueva entra arriba; si ya existía (reintento o
   *  reconciliación) se actualiza en su lugar y no se duplica. */
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8 w-fit">
          <TabsTrigger value="cobrar" className="h-7 gap-1.5 px-2.5 text-xs">
            <Zap size={13} aria-hidden />
            Cobrar
          </TabsTrigger>
          <TabsTrigger value="historial" className="h-7 gap-1.5 px-2.5 text-xs">
            <History size={13} aria-hidden />
            Historial
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cobrar" className="mt-3">
          <ServiceCheckout onTransaction={upsert} />
        </TabsContent>

        <TabsContent value="historial" className="mt-3">
          <ServiceHistory
            transactions={transactions}
            onRetry={handleRetry}
            busyFolio={busyFolio}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ServicesScreen;