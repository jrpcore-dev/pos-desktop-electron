import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import ServiceResult from "./ServiceResult";
import { toUiTransaction } from "./taecelCatalog";

export default function MixedSaleResult({ sale, onDone }) {
  const [rows, setRows] = useState(sale.recharges);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");

  useEffect(() => {
    let active = true;
    let timer;
    const refresh = async (current) => {
      const next = await Promise.all(current.map(async (row) => {
        if (row.status !== "pending") return row;
        try {
          const result = await window.api.invoke("taecel:transaction-status", {
            transactionId: row.transactionId,
          });
          return result?.transaction || row;
        } catch {
          return row;
        }
      }));
      if (!active) return;
      setRows(next);
      if (next.some((row) => row.status === "pending")) {
        timer = setTimeout(() => refresh(next), 2000);
      }
    };
    if (sale.recharges.some((row) => row.status === "pending")) refresh(sale.recharges);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sale]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogTitle>Venta cobrada</DialogTitle>
        <DialogDescription>Folio {sale.folio}</DialogDescription>
        <div className="max-h-[55vh] divide-y divide-border overflow-y-auto">
          {rows.map((row) => (
            <ServiceResult key={row.transactionId} tx={toUiTransaction(row)} mixed />
          ))}
        </div>
        <Button className="w-full" onClick={onDone}>Nueva venta</Button>
        <Button variant="outline" disabled={printing} onClick={async () => {
          setPrinting(true);
          setPrintError("");
          try {
            await sale.print(rows);
          } catch (error) {
            setPrintError(error.message);
          } finally {
            setPrinting(false);
          }
        }}>
          {printing ? "Imprimiendo…" : "Imprimir ticket"}
        </Button>
        {printError && <p role="alert" className="text-sm text-destructive">{printError}</p>}
      </DialogContent>
    </Dialog>
  );
}
