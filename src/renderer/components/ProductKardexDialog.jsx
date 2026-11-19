import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp, AlertTriangle, ArrowRight, Check, Package, ShoppingCart,
  TrendingDown, TrendingUp, Undo2,
} from "lucide-react";
import { useDbChanges } from "../lib/useDbChanges";
import { formatMXDate, formatMXTime, mxToday, mxWeekRange } from "../utils/dateUtils";
import { fmtStockQty } from "@/utils/format";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { Dialog, DialogContent, DialogBrandHeader } from "./ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "./ui/table";
import { DateRangePicker } from "./ui/date-range-picker";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import ProductPicker from "./ProductPicker";

/* ────────────────────────────────────────────────────────────
   Cuadre de stock por producto (kardex).

   Responde «¿con cuánto empecé, qué entró, qué salió y qué vendí
   en este rango, y con cuánto terminé?». El saldo inicial lo
   calcula el backend hacia atrás desde `products.stock`, así el
   saldo final siempre cuadra con el stock actual.

   Las ventas no viven en `stock_movements`: se suman desde
   `sale_items.stock_deducted` y sólo aparecen aquí, nunca en la
   tabla de Movimientos.
──────────────────────────────────────────────────────────── */

const PAYMENT_LABEL = {
  cash: "Efectivo",
  efectivo: "Efectivo",
  card: "Tarjeta",
  tarjeta: "Tarjeta",
  transfer: "Transferencia",
  transferencia: "Transferencia",
  credit: "Fiado",
  fiado: "Fiado",
  mixed: "Mixto",
  mixto: "Mixto",
};

const unitOf = (product) => (product?.sale_unit === "weight" ? "kg" : "pz");

const todayRange = () => {
  const today = mxToday();
  return { from: today, to: today };
};

const weekRange = () => {
  const { start, end } = mxWeekRange();
  const today = mxToday();
  // La semana corre hasta el domingo, pero el cuadre no mira al futuro.
  return { from: start, to: end > today ? today : end };
};

const monthRange = () => {
  const today = mxToday();
  return { from: `${today.slice(0, 8)}01`, to: today };
};

const ALL_RANGE = { from: "", to: "" };
const PRESET_RANGES = {
  all: () => ALL_RANGE,
  month: monthRange,
  week: weekRange,
  today: todayRange,
};

const ACTIVITY = [
  { key: "in", label: "Entradas", icon: TrendingUp, sign: "+", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { key: "out", label: "Salidas", icon: TrendingDown, sign: "−", tone: "bg-red-500/10 text-red-700 dark:text-red-400" },
  { key: "sales", label: "Ventas", icon: ShoppingCart, sign: "−", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { key: "devolution", label: "Devoluciones", icon: Undo2, sign: "+", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-400" },
];

const ConceptBadge = ({ type, cancelled }) => {
  if (type === "in")
    return (
      <Badge variant="secondary" className="gap-1 whitespace-nowrap border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
        <TrendingUp className="h-3 w-3" /> Entrada
      </Badge>
    );
  if (type === "out")
    return (
      <Badge variant="secondary" className="gap-1 whitespace-nowrap border-red-500/40 text-red-600 dark:text-red-400">
        <TrendingDown className="h-3 w-3" /> Salida
      </Badge>
    );
  if (type === "devolution")
    return (
      <Badge variant="secondary" className="gap-1 whitespace-nowrap border-violet-500/40 text-violet-600 dark:text-violet-400">
        <Undo2 className="h-3 w-3" /> Devolución
      </Badge>
    );
  if (type === "sale")
    return (
      <Badge variant="secondary" className="gap-1 whitespace-nowrap border-sky-500/40 text-sky-600 dark:text-sky-400">
        <ShoppingCart className="h-3 w-3" /> Venta
        {cancelled && (
          <span className="font-semibold text-muted-foreground">· Cancelada</span>
        )}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1 whitespace-nowrap border-amber-500/40 text-amber-600 dark:text-amber-400">
      <ArrowDownUp className="h-3 w-3" /> Ajuste
    </Badge>
  );
};

const ProductKardexDialog = ({ open, onOpenChange, periodsRef }) => {
  const [product, setProduct] = useState(null);
  const [picking, setPicking] = useState(true);
  const [range, setRange] = useState(weekRange);
  const [preset, setPreset] = useState("week");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!product?.id) return;
    setLoading(true);
    setError("");
    try {
      const res = await window.api.invoke("get-product-kardex", {
        productId: product.id,
        startDate: range?.from || undefined,
        endDate: range?.to || undefined,
      });
      if (res?.success) setData(res);
      else {
        setData(null);
        setError(res?.error || "No se pudo cargar el cuadre");
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "No se pudo cargar el cuadre");
    } finally {
      setLoading(false);
    }
  }, [product?.id, range?.from, range?.to]);

  useEffect(() => {
    if (open && !picking && product?.id) load();
  }, [open, picking, load, product?.id]);

  // In vivo: una venta o un movimiento nuevo se refleja sin cerrar el cuadre.
  useDbChanges(
    () => {
      if (open && !picking && product?.id) load();
    },
    ["stock_movements", "sale_items", "sales", "products"],
  );

  const unit = unitOf(product);
  const fmtQty = (quantity) => fmtStockQty(quantity, product?.sale_unit);

  const applyPreset = (key) => {
    periodsRef.current.set(product.id, { preset: key });
    setPreset(key);
    setRange(PRESET_RANGES[key]());
  };

  const handleRange = (value) => {
    const nextRange = value || ALL_RANGE;
    periodsRef.current.set(product.id, { preset: null, range: nextRange });
    setPreset(null);
    setRange(nextRange);
  };

  const pickProduct = (p) => {
    const saved = periodsRef.current.get(p.id) ?? { preset: "week" };
    setPreset(saved.preset);
    setRange(saved.preset ? PRESET_RANGES[saved.preset]() : saved.range);
    setProduct(p);
    setPicking(false);
    setData(null);
  };

  const changeProduct = () => {
    setPicking(true);
    setData(null);
    setError("");
  };

  // ¿El rango llega hasta hoy? Sólo entonces el saldo final debe coincidir con
  // el stock actual; si el rango termina antes, el saldo es histórico.
  const reachesToday = !range?.to || range.to >= mxToday();
  const matchesCurrent =
    data && Math.abs((Number(data.closing) || 0) - (Number(data.current) || 0)) < 0.0001;
  const unconfirmedHistory = data?.opening < 0;
  const unconfirmedClosing = unconfirmedHistory && !(reachesToday && matchesCurrent);

  const totals = data?.totals || { in: 0, out: 0, sales: 0, devolution: 0 };

  const rangeLabel = useMemo(() => {
    if (!range?.from && !range?.to) return "Todo el historial";
    if (range?.from && range?.to)
      return `${formatMXDate(range.from)} – ${formatMXDate(range.to)}`;
    if (range?.from) return `Desde ${formatMXDate(range.from)}`;
    return `Hasta ${formatMXDate(range.to)}`;
  }, [range?.from, range?.to]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <DialogContent brand className="max-w-4xl grid-rows-[auto_minmax(0,1fr)] max-h-[calc(100dvh-1.5rem)]">
        <DialogBrandHeader
          icon={<ArrowDownUp size={20} />}
          title="Cuadre de stock"
          description="Consulta las existencias de un producto a lo largo del tiempo."
        />

        <div className="overflow-y-auto px-4 pb-5 pt-4 sm:px-6">
          {picking || !product ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Busca el producto del que quieres ver el cuadre.
              </p>
              <ProductPicker
                onPick={pickProduct}
                onClose={() => {
                  if (product) setPicking(false);
                  else onOpenChange(false);
                }}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Package aria-hidden="true" size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-foreground">{product.name}</p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {product.barcode ? `Cód. ${product.barcode} · ` : ""}
                      {unit === "kg" ? "Granel" : "Pieza"}
                    </p>
                  </div>
                </div>
                <div className="col-span-2 row-start-2 flex items-baseline justify-between gap-2 border-t border-border pt-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:block sm:border-0 sm:pt-0 sm:text-right">
                  <p className="text-xs font-medium text-muted-foreground">Stock actual</p>
                  <p className="whitespace-nowrap text-lg font-bold tabular-nums">{fmtQty(data?.current ?? product.stock)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="col-start-2 row-start-1 shrink-0 sm:col-start-3"
                  onClick={changeProduct}
                >
                  Cambiar
                </Button>
              </div>

              {/* Rango */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <DateRangePicker
                  value={range}
                  onApply={handleRange}
                  placeholder={rangeLabel}
                  className="h-9"
                />
                <Tabs value={preset ?? ""} onValueChange={applyPreset}>
                  <TabsList aria-label="Periodo del Kardex">
                    <TabsTrigger value="all" className="font-semibold">Todo</TabsTrigger>
                    <TabsTrigger value="month" className="font-semibold">Mes</TabsTrigger>
                    <TabsTrigger value="week" className="font-semibold">Semana</TabsTrigger>
                    <TabsTrigger value="today" className="font-semibold">Hoy</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {error && (
                <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                  {error}
                </p>
              )}

              {loading && !data ? (
                <div className="mt-4 space-y-2">
                  <Skeleton className="h-24 w-full" />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ACTIVITY.map(({ key }) => (
                      <Skeleton key={key} className="h-[4.5rem] w-full" />
                    ))}
                  </div>
                  <Skeleton className="h-56 w-full" />
                </div>
              ) : data ? (
                <>
                  {/* Resumen */}
                  <section aria-label="Resumen del periodo" className="mt-4 space-y-2">
                    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                      <div className="relative p-3 pr-6 sm:p-4 sm:pr-8">
                        <dt className="text-xs font-semibold text-muted-foreground">Existencia inicial</dt>
                        <dd className={cn(
                          "mt-1 break-words text-xl font-bold tracking-tight tabular-nums sm:text-2xl",
                          unconfirmedHistory && "text-amber-700 dark:text-amber-400",
                        )}>
                          {unconfirmedHistory ? "Sin confirmar" : fmtQty(data.opening)}
                        </dd>
                        <ArrowRight aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground sm:right-4" />
                      </div>
                      <div className="border-l border-primary/15 bg-primary/5 p-3 sm:p-4">
                        <dt className="text-xs font-semibold text-primary">Existencia al cierre</dt>
                        <dd className="mt-1 break-words text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
                          {unconfirmedClosing ? "Sin confirmar" : fmtQty(data.closing)}
                        </dd>
                      </div>
                    </dl>
                    {unconfirmedHistory && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                        <p>El historial registrado no permite confirmar la existencia inicial ni los saldos de cada movimiento.</p>
                      </div>
                    )}
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {ACTIVITY.map(({ key, label, icon: Icon, sign, tone }) => (
                        <div key={key} className="rounded-xl border border-border bg-card px-3 py-2.5">
                          <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", tone)}>
                              <Icon aria-hidden="true" size={14} />
                            </span>
                            {label}
                          </dt>
                          <dd className="mt-1 break-words text-base font-bold tracking-tight tabular-nums">
                            {totals[key] ? sign : ""}{fmtQty(totals[key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label="Historial de movimientos">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-3 sm:px-4">
                      <h3 className="text-sm font-bold">Historial de movimientos</h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {data.truncated ? "Últimos " : ""}{data.rows.length} {data.rows.length === 1 ? "registro" : "registros"}
                      </span>
                    </div>
                    <Table className="min-w-[25rem]" containerClassName="max-h-[46vh]">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-28">Fecha</TableHead>
                          <TableHead>Concepto</TableHead>
                          <TableHead className="w-24 text-right">Cambio</TableHead>
                          <TableHead className="w-28 text-right">Existencia</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No hubo movimientos ni ventas en este rango.
                            </TableCell>
                          </TableRow>
                        ) : (
                          data.rows.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell className="px-4 py-2.5">
                                <p className="text-sm font-medium text-foreground">
                                  {formatMXDate(row.at)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatMXTime(row.at)}
                                </p>
                              </TableCell>
                              <TableCell className="px-4 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <ConceptBadge type={row.type} cancelled={row.cancelled} />
                                  {row.reference && <span className="break-all text-sm font-semibold text-foreground">{row.reference}</span>}
                                </div>
                                <p className="text-xs text-muted-foreground empty:hidden [&:not(:empty)]:mt-1">
                                  {[
                                    row.type === "sale"
                                      ? PAYMENT_LABEL[row.notes] || row.notes
                                      : row.notes,
                                    row.cashier_name,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              </TableCell>
                              <TableCell className={cn(
                                "whitespace-nowrap px-4 py-2.5 text-right text-sm font-bold tabular-nums",
                                row.delta < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
                              )}>
                                {row.delta ? `${row.delta < 0 ? "−" : "+"}${fmtQty(row.quantity)}` : fmtQty(0)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap bg-muted/25 px-4 py-2.5 text-right text-sm">
                                {unconfirmedHistory ? (
                                  <span className="text-xs font-medium text-muted-foreground">Sin confirmar</span>
                                ) : (
                                  <span className="font-bold tabular-nums">{fmtQty(row.balance)}</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </section>

                  {reachesToday && (
                    matchesCurrent ? (
                      !unconfirmedHistory && <div className="mt-3 flex items-center gap-2 px-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <Check className="h-4 w-4 shrink-0" />
                        El cierre coincide con el stock actual.
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {unconfirmedClosing
                          ? "La existencia al cierre tampoco puede confirmarse con el stock actual."
                          : `El saldo final (${fmtQty(data.closing)}) no coincide con el stock actual (${fmtQty(data.current)}).`}
                      </div>
                    )
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductKardexDialog;
