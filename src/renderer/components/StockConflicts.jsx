import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { useToast } from "./ToastProvider";
import { formatMXDateTime } from "../utils/dateUtils";

// Bloque 4/E · revisión de ventas que dejaron stock negativo. El admin ve el
// detalle, ajusta el inventario real y marca la venta como revisada. El
// ajuste es idempotente por venta en el Host (no se aplica dos veces).
const draftKey = (saleId, productId) => `${saleId}:${productId}`;

export default function StockConflicts() {
  const notify = useToast();
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState([]);
  const [stockById, setStockById] = useState({});
  // Borrador por (venta, producto): el mismo producto en dos ventas no
  // comparte el campo.
  const [draft, setDraft] = useState({});
  const [savingId, setSavingId] = useState(null);
  // Fase 5 · un fallo (Host caído en una caja) NO es "sin conflictos".
  const [loadError, setLoadError] = useState(null);
  const offline = loadError?.code === "HOST_UNREACHABLE";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await window.api.invoke("get-stock-conflicts");
      if (!res?.success) {
        setConflicts([]);
        setLoadError({
          code: res?.code || "ERROR",
          message: res?.error || "No se pudieron cargar los conflictos de stock",
        });
        setLoading(false);
        return;
      }
      const rows = res.conflicts || [];
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
        // Arranca con el stock actual tal cual (aunque sea negativo): el
        // admin escribe el conteo real. Antes se proponía 0 y un clic dejaba
        // el inventario en 0 sin que nadie lo hubiera contado.
        const nextDraft = {};
        rows.forEach((r) => {
          (r.conflict_detail || []).forEach((d) => {
            const pid = Number(d.product_id);
            const key = draftKey(r.id, pid);
            if (nextDraft[key] == null) {
              nextDraft[key] = String(Number(map[pid]?.stock ?? d.stock_after ?? 0));
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
      setLoadError({ code: "ERROR", message: "No se pudieron cargar los conflictos de stock" });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (sale, markOnly = false) => {
    const pids = (sale.conflict_detail || [])
      .map((d) => Number(d.product_id))
      .filter((pid, idx, arr) => arr.indexOf(pid) === idx);
    let adjustments = [];
    if (!markOnly) {
      // Fase 5 · un campo vacío o inválido ya no se descarta en silencio
      // (la venta quedaba "revisada" sin ajustar nada).
      const bad = pids.filter((pid) => {
        const v = String(draft[draftKey(sale.id, pid)] ?? "").trim();
        return v === "" || !Number.isFinite(Number(v)) || Number(v) < 0;
      });
      if (bad.length) {
        notify("Captura el stock real (0 o más) de cada producto antes de ajustar", "error");
        return;
      }
      adjustments = pids.map((pid) => ({
        product_id: pid,
        new_stock: Number(draft[draftKey(sale.id, pid)]),
      }));
    }
    setSavingId(sale.id);
    try {
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
      } else if (res?.code === "HOST_UNREACHABLE") {
        notify("El Host no responde: los conflictos se resuelven con el Host conectado", "error");
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
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            {offline ? (
              <WifiOff className="h-10 w-10 text-warning" />
            ) : (
              <AlertTriangle className="h-10 w-10 text-destructive" />
            )}
            <p className="text-base font-semibold text-foreground">
              {offline ? "El Host no responde" : "No se pudieron cargar"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {offline
                ? "Los conflictos viven en el Host. Vuelve a intentarlo cuando la caja esté conectada."
                : loadError.message}
            </p>
            <Button variant="outline" size="sm" onClick={load} className="mt-2">
              <RefreshCw size={14} />
              Reintentar
            </Button>
          </CardContent>
        </Card>
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
                        const key = draftKey(sale.id, pid);
                        const byWeight = stockById[pid]?.sale_unit === "weight";
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
                                step={byWeight ? "0.001" : "1"}
                                aria-label={`Nuevo stock de ${stockById[pid]?.name || d.name}`}
                                className="ml-auto h-8 w-24 text-right"
                                value={draft[key] ?? ""}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    [key]: e.target.value,
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
