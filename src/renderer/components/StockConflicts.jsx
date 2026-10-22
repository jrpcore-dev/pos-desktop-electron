import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { useToast } from "./ToastProvider";
import { formatMXDateTime } from "../utils/dateUtils";

// Bloque 4/E · revisión de ventas que dejaron stock negativo. El admin ve el
// detalle, ajusta el inventario real y marca la venta como revisada. El
// ajuste es idempotente por venta en el Host (no se aplica dos veces).
export default function StockConflicts() {
  const notify = useToast();
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState([]);
  const [stockById, setStockById] = useState({});
  const [draft, setDraft] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.api.invoke("get-stock-conflicts");
      const rows = res?.success ? res.conflicts || [] : [];
      setConflicts(rows);
      const ids = new Set();
      rows.forEach((r) =>
        (r.conflict_detail || []).forEach((d) => ids.add(Number(d.product_id))),
      );
      if (ids.size) {
        const products = await window.api.invoke("get-products-by-ids", [
          ...ids,
        ]);
        const map = {};
        (Array.isArray(products) ? products : []).forEach((p) => {
          map[p.id] = p;
        });
        setStockById(map);
        const nextDraft = {};
        rows.forEach((r) => {
          (r.conflict_detail || []).forEach((d) => {
            const pid = Number(d.product_id);
            if (nextDraft[pid] == null) {
              const current = Number(map[pid]?.stock ?? d.stock_after ?? 0);
              nextDraft[pid] = String(Math.max(0, current));
            }
          });
        });
        setDraft(nextDraft);
      } else {
        setStockById({});
        setDraft({});
      }
    } catch (e) {
      setConflicts([]);
      notify("No se pudieron cargar los conflictos de stock", "error");
    }
    setLoading(false);
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (sale, markOnly = false) => {
    setSavingId(sale.id);
    try {
      const adjustments = markOnly
        ? []
        : (sale.conflict_detail || [])
            .map((d) => Number(d.product_id))
            .filter((pid, idx, arr) => arr.indexOf(pid) === idx)
            .map((pid) => ({
              product_id: pid,
              new_stock: Number(draft[pid]),
            }))
            .filter((a) => Number.isFinite(a.new_stock) && a.new_stock >= 0);
      const res = await window.api.invoke("resolve-stock-conflict", {
        saleId: sale.id,
        adjustments,
        note: markOnly
          ? "Marcada como revisada sin ajuste"
          : "Ajuste desde revisión de conflictos",
      });
      if (res?.success) {
        notify(
          markOnly
            ? "Venta marcada como revisada"
            : "Inventario ajustado y venta revisada",
          "success",
        );
        await load();
      } else {
        notify(res?.error || "No se pudo resolver", "error");
      }
    } catch (e) {
      notify("No se pudo resolver el conflicto", "error");
    } finally {
      setSavingId(null);
    }
  };

  const total = useMemo(() => conflicts.length, [conflicts]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Conflictos de stock
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ventas que dejaron inventario negativo. La venta nunca se rechazó;
            aquí ajustas el stock real y marcas la revisión.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Actualizar
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="text-base font-semibold text-foreground">
              Sin conflictos pendientes
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ninguna venta reciente dejó stock negativo sin revisar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {conflicts.map((sale) => (
            <Card key={sale.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Venta {sale.folio || `#${sale.id}`}
                  <span className="text-xs font-normal text-muted-foreground">
                    {sale.device_code || sale.device_id || "Host"}
                    {sale.device_name ? ` · ${sale.device_name}` : ""}
                    {sale.cashier_name ? ` · ${sale.cashier_name}` : ""}
                    {sale.created_at
                      ? ` · ${formatMXDateTime(sale.created_at)}`
                      : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pr-3">Producto</th>
                        <th className="py-1.5 pr-3 text-right">Antes</th>
                        <th className="py-1.5 pr-3 text-right">Vendido</th>
                        <th className="py-1.5 pr-3 text-right">Quedó</th>
                        <th className="py-1.5 pr-3 text-right">Stock actual</th>
                        <th className="py-1.5 text-right">Nuevo stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sale.conflict_detail || []).map((d, idx) => {
                        const pid = Number(d.product_id);
                        const current = stockById[pid]?.stock;
                        return (
                          <tr key={`${sale.id}-${pid}-${idx}`} className="border-t border-border">
                            <td className="py-1.5 pr-3 font-medium">
                              {stockById[pid]?.name || d.name}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {d.available_before}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {d.sold}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-destructive">
                              {d.stock_after}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {current ?? "—"}
                            </td>
                            <td className="py-1.5 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                className="ml-auto h-8 w-24 text-right"
                                value={draft[pid] ?? ""}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    [pid]: e.target.value,
                                  }))
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingId === sale.id}
                    onClick={() => resolve(sale, true)}
                  >
                    Marcar revisada sin ajustar
                  </Button>
                  <Button
                    size="sm"
                    disabled={savingId === sale.id}
                    onClick={() => resolve(sale, false)}
                  >
                    Ajustar y marcar revisada
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
