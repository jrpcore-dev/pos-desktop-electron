import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Printer, ShoppingBasket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtMoney } from "@/utils/format";
import { useDbChanges } from "../lib/useDbChanges";
import { loadPdfToolchain } from "@/utils/pdfToolchain";
import { printDocument } from "../utils/printPdf";

// Reportes que ayudan a decidir (ver main/reports-core.js):
//   · MovementView        → la vista "Movimiento" de la tarjeta de productos
//   · PurchaseSuggestions → lista de compra sugerida, compacta

const fmtUnits = (n, saleUnit) => {
  const v = Number(n) || 0;
  if (saleUnit === "weight") return `${Math.round(v * 10) / 10} kg`;
  return `${Math.round(v)}`;
};
const coverText = (days) => {
  if (days == null) return "sin ventas recientes";
  if (days < 1) return "se acaba hoy";
  const d = Math.floor(days);
  return `alcanza para ${d} ${d === 1 ? "día" : "días"}`;
};
const coverTone = (days) =>
  days == null ? "text-muted-foreground" : days < 1 ? "text-destructive" : days < 3 ? "text-amber-700 dark:text-warning" : "text-muted-foreground";

// ── Movimiento: cómo se vendió un producto día por día ───────────────────────
export function MovementView({ startDate, endDate, deviceId, periodLabel = "periodo anterior" }) {
  const [productId, setProductId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Cambia en cada carga: vuelve a correr la animación de las barras.
  const [runKey, setRunKey] = useState(0);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const res = await window.api.invoke("get-product-movement", {
        startDate,
        endDate,
        productId,
        deviceId,
      });
      setData(res && res.success ? res : null);
      setRunKey((k) => k + 1);
    } catch (e) {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, productId, deviceId]);

  useEffect(() => {
    load();
  }, [load]);
  // Al cambiar de periodo se vuelve a empezar por el más vendido.
  useEffect(() => {
    setProductId(null);
  }, [startDate, endDate, deviceId]);

  const sel = data?.selected || null;
  const max = useMemo(
    () => Math.max(1, ...((sel?.days || []).flatMap((d) => [d.units, d.prev]))),
    [sel],
  );
  const delta =
    sel && sel.prevTotal > 0 ? ((sel.total - sel.prevTotal) / sel.prevTotal) * 100 : sel && sel.total > 0 ? 100 : 0;
  const many = (sel?.days?.length || 0) > 14;

  if (loading && !data) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-9 w-56" />
        <div className="flex h-[200px] items-end gap-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${35 + ((i * 29) % 60)}%` }} />
          ))}
        </div>
      </div>
    );
  }
  if (!sel) {
    return (
      <EmptyState
        icon={<ShoppingBasket className="h-6 w-6" />}
        title="Sin ventas en este periodo"
        description="Cuando se venda algo, aquí verás cómo se movió cada producto día por día."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Select value={String(sel.id)} onValueChange={(v) => setProductId(Number(v))}>
            <SelectTrigger className="h-9 w-full max-w-[280px] font-semibold" aria-label="Producto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(data.products || []).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name} · {fmtUnits(p.units, p.saleUnit)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground">{fmtUnits(sel.total, sel.saleUnit)}</span>{" "}
            {sel.saleUnit === "weight" ? "vendidos" : "piezas"} ·{" "}
            <span className={cn("font-bold", delta >= 0 ? "text-success" : "text-destructive")}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))} %
            </span>{" "}
            vs {periodLabel}
            {sel.best && (
              <>
                {" "}· mejor día: {sel.best.label} ({fmtUnits(sel.best.units, sel.saleUnit)})
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Quedan {fmtUnits(sel.stock, sel.saleUnit)}</p>
          <p className={cn("text-xs font-bold", coverTone(sel.coverDays))}>{coverText(sel.coverDays)}</p>
        </div>
      </div>

      <div
        key={runKey}
        role="img"
        aria-label={`Ventas por día de ${sel.name}: este periodo contra el anterior`}
        className={cn("grid h-[190px] items-end", many ? "gap-1" : "gap-3")}
        style={{ gridTemplateColumns: `repeat(${sel.days.length}, minmax(0, 1fr))` }}
      >
        {sel.days.map((d, i) => (
          <div key={d.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
            {!many && (
              <span className="rp-fade text-xs font-bold tabular-nums" style={{ animationDelay: `${i * 50 + 250}ms` }}>
                {d.future ? "" : fmtUnits(d.units, sel.saleUnit)}
              </span>
            )}
            <div className={cn("flex w-full items-end", many ? "h-[150px] gap-px" : "h-[140px] gap-1")}>
              <div
                className="rp-bar flex-1 rounded-t-md bg-muted-foreground/20"
                style={{ height: `${(d.prev / max) * 100}%`, animationDelay: `${i * 50}ms` }}
                title={`Anterior: ${fmtUnits(d.prev, sel.saleUnit)}`}
              />
              <div
                className={cn(
                  "rp-bar flex-1 rounded-t-md bg-gradient-to-t from-chart-1 to-chart-2",
                  d.future && "opacity-0",
                )}
                style={{ height: `${(d.units / max) * 100}%`, animationDelay: `${i * 50}ms` }}
                title={`Este periodo: ${fmtUnits(d.units, sel.saleUnit)}`}
              />
            </div>
            <span className="truncate text-[11px] font-semibold text-muted-foreground">{d.label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-gradient-to-t from-chart-1 to-chart-2" />
          Este periodo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-muted-foreground/20" />
          {periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}
        </span>
      </div>

      {/* Los demás más vendidos: su periodo en miniatura; al tocar uno se ve arriba. */}
      {(data.rows || []).length > 1 && (
        <div className="border-t border-border/70 pt-2">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_64px_76px_minmax(0,1.3fr)] gap-3 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span>Producto</span>
            <span>{many ? "Por día" : "Lun → Dom"}</span>
            <span className="text-right">Total</span>
            <span className="text-right">vs ant.</span>
            <span className="text-right">Stock</span>
          </div>
          {data.rows.map((r, ri) => {
            const rowMax = Math.max(1, ...r.days);
            const d = r.prevTotal > 0 ? ((r.total - r.prevTotal) / r.prevTotal) * 100 : r.total > 0 ? 100 : 0;
            const active = r.id === sel.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setProductId(r.id)}
                aria-pressed={active}
                className={cn(
                  "rp-fade grid w-full cursor-pointer grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_64px_76px_minmax(0,1.3fr)] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50",
                  active && "bg-muted/60",
                )}
                style={{ animationDelay: `${ri * 40}ms` }}
              >
                <span className="truncate text-[13px] font-semibold text-foreground">{r.name}</span>
                <span className="flex h-6 items-end gap-[3px]" aria-hidden="true">
                  {r.days.map((u, i) => (
                    <span
                      key={i}
                      className={cn("rp-bar flex-1 rounded-[2px]", u > 0 ? "bg-chart-2/70" : "bg-border")}
                      style={{ height: `${Math.max(8, (u / rowMax) * 100)}%`, animationDelay: `${ri * 40 + i * 20}ms` }}
                    />
                  ))}
                </span>
                <span className="text-right text-[13px] font-bold tabular-nums">{fmtUnits(r.total, r.saleUnit)}</span>
                <span className={cn("text-right text-xs font-bold tabular-nums", d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground")}>
                  {d > 0 ? "▲" : d < 0 ? "▼" : "="} {Math.abs(Math.round(d))} %
                </span>
                <span className="truncate text-right text-xs text-muted-foreground">
                  {fmtUnits(r.stock, r.saleUnit)}
                  <span className={cn("font-bold", coverTone(r.coverDays))}> · {r.coverDays == null ? "—" : r.coverDays < 1 ? "hoy" : `${Math.floor(r.coverDays)} d`}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Lista de compra sugerida ─────────────────────────────────────────────────
const VISIBLE = 5;

const textForSupplier = (storeName, supplier, items) =>
  [
    `Pedido${storeName ? ` de ${storeName}` : ""}${supplier ? ` para ${supplier}` : ""}:`,
    ...items.map((i) => `• ${i.name}: ${i.order}`),
  ].join("\n");

export function PurchaseSuggestions({ className }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [runKey, setRunKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await window.api.invoke("get-purchase-suggestions", {});
      setData(res && res.success ? res : null);
      setRunKey((k) => k + 1);
    } catch (e) {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Una venta o una entrada de mercancía cambian lo que hay que pedir.
  useDbChanges(load, ["products", "sales", "suppliers"]);

  const items = data?.items || [];
  const bySupplier = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const k = it.supplierId || 0;
      if (!map.has(k)) map.set(k, { name: it.supplierName, phone: it.supplierPhone, delivery: it.delivery, items: [] });
      map.get(k).items.push(it);
    }
    return [...map.values()];
  }, [items]);

  const print = async () => {
    const { jsPDF } = await loadPdfToolchain();
    const doc = new jsPDF();
    const store = (await window.api.invoke("get-setting", "store_name")) || "";
    doc.setFontSize(15);
    doc.text(`Lista de compra sugerida${store ? ` · ${store}` : ""}`, 14, 18);
    doc.setFontSize(9);
    doc.text(new Date().toLocaleDateString("es-MX", { dateStyle: "long" }), 14, 24);
    let y = 30;
    for (const g of bySupplier) {
      doc.autoTable({
        startY: y,
        head: [[`${g.name}${g.delivery ? ` · entrega ${g.delivery}` : ""}`, "Quedan", "Pedir"]],
        body: g.items.map((i) => [i.name, String(Math.round(i.stock * 10) / 10), i.order]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [15, 23, 42] },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 8;
    }
    await printDocument(doc);
  };

  const whatsapp = async (g) => {
    const store = (await window.api.invoke("get-setting", "store_name")) || "";
    await window.api.invoke("open-whatsapp", { phone: g.phone, text: textForSupplier(store, g.name, g.items) });
  };

  const row = (it, i) => (
    <div
      key={it.productId}
      className="rp-fade grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 py-2.5 last:border-b-0"
      style={{ animationDelay: `${i * 40}ms` }}
    >
      <span className="truncate text-[13px] font-semibold text-foreground">{it.name}</span>
      <span className="truncate text-xs text-muted-foreground">
        {it.supplierName}
        {it.delivery ? ` · entrega ${it.delivery}` : ""}
      </span>
      <span className={cn("truncate text-xs font-semibold", coverTone(it.daysLeft))}>{coverText(it.daysLeft)}</span>
      <span className="text-right text-[13px] font-bold tabular-nums text-foreground">pedir {it.order}</span>
    </div>
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-[0_1px_2px_hsl(222_47%_11%_/_0.05),0_10px_24px_-8px_hsl(222_47%_11%_/_0.10)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-foreground">Lista de compra sugerida</p>
          <p className="text-xs text-muted-foreground">Lo que se acaba antes de la próxima entrega de su proveedor</p>
        </div>
        {items.length > VISIBLE && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer text-xs font-bold text-primary hover:underline dark:text-chart-2"
          >
            Ver lista completa ({items.length})
          </button>
        )}
        {items.length > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={print}>
              <Printer size={14} /> Imprimir
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <MessageCircle size={14} /> Enviar por WhatsApp
            </Button>
          </>
        )}
      </div>
      <div key={runKey} className="px-5 py-1.5">
        {loading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todo alcanza hasta la siguiente entrega de cada proveedor. Nada que pedir por ahora.
          </p>
        ) : (
          items.slice(0, VISIBLE).map(row)
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lista de compra sugerida</DialogTitle>
            <DialogDescription>
              Por proveedor. Costo aproximado {fmtMoney(data?.cost || 0)} a precio de costo.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {bySupplier.map((g) => (
              <div key={g.name} className="overflow-hidden rounded-xl border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.delivery ? `Entrega: ${g.delivery}` : "Sin días de entrega (se toma semanal)"}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => whatsapp(g)}>
                    <MessageCircle size={14} /> WhatsApp
                  </Button>
                </div>
                <div className="px-4">
                  {g.items.map((it) => (
                    <div key={it.productId} className="flex items-center gap-3 border-b border-border/50 py-2 last:border-b-0">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{it.name}</span>
                      <span className={cn("text-xs font-semibold", coverTone(it.daysLeft))}>{coverText(it.daysLeft)}</span>
                      <span className="w-24 text-right text-[13px] font-bold tabular-nums">{it.order}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={print}>
              <Printer size={14} /> Imprimir
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
