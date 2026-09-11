import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  Search, TrendingUp, TrendingDown, ArrowLeftRight, ArrowDownUp, CalendarDays,
  Store, Undo2, Search as SearchIcon, History, List,
} from "lucide-react";
import { useCashier } from "../contexts/CashierContext";
import { formatMXDate, formatMXTime, mxToday, mxWeekRange } from "../utils/dateUtils";
import { cn } from "@/lib/utils";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "./ui/table";
import { Skeleton } from "./ui/skeleton";
import { CardSkeleton } from "./Skeletons";
import { usePagination } from "../lib/usePagination";
import PaginationBar from "./PaginationBar";
import { DateRangePicker } from "./ui/date-range-picker";

const PAGE_SIZE = 25;

const TypeBadge = memo(function TypeBadge({ type }) {
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
  return (
    <Badge variant="secondary" className="gap-1 whitespace-nowrap border-amber-500/40 text-amber-600 dark:text-amber-400">
      <ArrowDownUp className="h-3 w-3" /> Ajuste
    </Badge>
  );
});

const StockMovements = () => {
  const { cashier } = useCashier();
  const isAdmin = cashier?.role === "admin";
  const [movements, setMovements] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [type, setType] = useState("");
  const [dateRange, setDateRange] = useState(() => {
    const today = mxToday();
    return { from: today, to: today };
  });

  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem("stockView") === "timeline"
        ? "timeline"
        : "table";
    } catch {
      return "table";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("stockView", viewMode);
    } catch {}
  }, [viewMode]);

  const {
    pagedRows,
    page: currentPage,
    totalPages,
    pageStart,
    setPage,
    reset: resetPage,
  } = usePagination(movements, { pageSize: PAGE_SIZE });

  const fetchProducts = useCallback(async () => {
    const result = await window.api.invoke("get-products");
    setProducts(result.products || result);
  }, []);

  const load = useCallback(
    async (searchOverride) => {
      setLoading(true);
      const params = {};
      const term = searchOverride !== undefined ? searchOverride : debouncedSearch;
      if (term) params.search = term.trim();
      if (type) params.type = type;
      if (dateRange?.from) params.startDate = dateRange.from;
      if (dateRange?.to) params.endDate = dateRange.to;
      if (cashier?.id) params.cashierId = cashier.id;
      if (cashier?.role) params.role = cashier.role;
      const result = await window.api.invoke("get-stock-movements", params);
      setMovements(result);
      resetPage();
      setLoading(false);
    },
    [debouncedSearch, type, dateRange, cashier?.id, cashier?.role],
  );

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const handleDateApply = (range) => {
    setDateRange(range || { from: "", to: "" });
    resetPage();
  };

  const setQuickToday = () => {
    const today = mxToday();
    setDateRange({ from: today, to: today });
    resetPage();
  };

  const setQuickWeek = () => {
    const { start, end } = mxWeekRange();
    setDateRange({ from: start, to: end });
    resetPage();
  };

  useEffect(() => {
    load();
  }, [type, dateRange]);

  const unitMap = useMemo(() => {
    const map = {};
    (products || []).forEach((p) => {
      map[p.id] = p.sale_unit === "weight" ? "kg" : "pz";
    });
    return map;
  }, [products]);
  const getUnit = (productId) => unitMap[productId] || "pz";

  const totalIn = movements.filter((m) => m.type === "in").reduce((s, m) => s + m.quantity, 0);
  const totalOut = movements.filter((m) => m.type === "out").reduce((s, m) => s + m.quantity, 0);
  const totalDev = movements.filter((m) => m.type === "devolution").reduce((s, m) => s + m.quantity, 0);
  const totalComprado = movements
    .filter((m) => m.type === "in")
    .reduce((s, m) => s + (m.cost || 0), 0);

  const groupedByDay = useMemo(() => {
    const groups = new Map();
    pagedRows.forEach((m) => {
      const key = formatMXDate(m.created_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    return Array.from(groups.entries()).map(([day, items]) => ({
      day,
      items,
    }));
  }, [pagedRows]);

  const movementMeta = (m) => {
    const isIn = m.type === "in";
    const isOut = m.type === "out";
    const isDev = m.type === "devolution";
    return {
      qtyColor: isIn
        ? "text-emerald-600 dark:text-emerald-400"
        : isOut
          ? "text-red-600 dark:text-red-400"
          : isDev
            ? "text-violet-600 dark:text-violet-400"
            : "text-amber-600 dark:text-amber-400",
      qtySign: isIn ? "+" : isOut ? "-" : isDev ? "+" : "±",
      dotColor: isIn
        ? "bg-emerald-500"
        : isOut
          ? "bg-red-500"
          : isDev
            ? "bg-violet-500"
            : "bg-amber-500",
    };
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Movimientos
          </h1>
          <p className="text-sm text-muted-foreground">
            Historial de movimientos de stock
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setViewMode((m) => (m === "timeline" ? "table" : "timeline"))
          }
          aria-label={
            viewMode === "timeline"
              ? "Ver como tabla"
              : "Ver como línea de tiempo"
          }
        >
          {viewMode === "timeline" ? (
            <List className="mr-1.5 h-4 w-4" />
          ) : (
            <History className="mr-1.5 h-4 w-4" />
          )}
          {viewMode === "timeline" ? "Tabla" : "Línea de tiempo"}
        </Button>
      </div>

      {loading ? (
        <CardSkeleton count={4} />
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-md">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                Unidades Entradas
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {totalIn}
            </p>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-red-500/40 hover:shadow-md">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
                <TrendingDown className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                Unidades Salidas
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {totalOut}
            </p>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/40 hover:shadow-md">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <Undo2 className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                Devoluciones
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {totalDev}
            </p>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/40 hover:shadow-md">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <Store className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                Total Comprado
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              ${totalComprado.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="mv-search">Buscar producto</Label>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="mv-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load(e.target.value);
                }}
                placeholder="Nombre o código"
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-type">Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="mv-type">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos</SelectItem>
                <SelectItem value="in">Entrada</SelectItem>
                <SelectItem value="out">Salida</SelectItem>
                <SelectItem value="devolution">Devolución</SelectItem>
                <SelectItem value="adjust">Ajuste</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>Rango de fechas</Label>
            <DateRangePicker
              value={dateRange}
              onApply={handleDateApply}
              placeholder="Rango de fechas"
              className="sm:w-full lg:w-full"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => load()}>
            <SearchIcon className="h-4 w-4" />
            Filtrar
          </Button>
          <Button variant="outline" onClick={setQuickToday}>
            <CalendarDays className="h-4 w-4" />
            Hoy
          </Button>
          <Button variant="outline" onClick={setQuickWeek}>
            Semana
          </Button>
        </div>
      </div>

      {viewMode === "timeline" ? (
        <div className="space-y-5">
          {loading ? (
            <CardSkeleton count={3} />
          ) : movements.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card py-12 text-muted-foreground">
              <ArrowLeftRight size={32} className="opacity-40" />
              <p className="text-sm">No hay movimientos registrados</p>
            </div>
          ) : (
            groupedByDay.map(({ day, items }) => (
              <div key={day}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarDays className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-bold text-foreground">{day}</h3>
                  <span className="text-xs text-muted-foreground">
                    {items.length}{" "}
                    {items.length === 1 ? "movimiento" : "movimientos"}
                  </span>
                </div>
                <ol className="relative ml-3 space-y-3 border-l-2 border-border pl-5">
                  {items.map((m) => {
                    const meta = movementMeta(m);
                    return (
                      <li key={m.id} className="relative">
                        <span
                          className={cn(
                            "absolute -left-[27px] top-5 h-3 w-3 rounded-full ring-4 ring-background",
                            meta.dotColor,
                          )}
                        />
                        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/30">
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <TypeBadge type={m.type} />
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {m.product_name}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                                <span>{formatMXTime(m.created_at)}</span>
                                {m.cashier_name && (
                                  <span className="truncate">
                                    · {m.cashier_name}
                                  </span>
                                )}
                                {m.reference && (
                                  <span className="truncate">
                                    · {m.reference}
                                  </span>
                                )}
                                {m.notes && m.notes !== m.reference && (
                                  <span className="truncate">
                                    · {m.notes}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center divide-x divide-border">
                              <div className="flex flex-col items-end px-4">
                                <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Piezas
                                </span>
                                <span
                                  className={cn(
                                    "text-base font-extrabold leading-tight tabular-nums",
                                    meta.qtyColor,
                                  )}
                                >
                                  {meta.qtySign}
                                  {m.quantity}{" "}
                                  <span className="text-xs font-bold">
                                    {getUnit(m.product_id)}
                                  </span>
                                </span>
                              </div>
                              <div className="flex flex-col items-end pl-4">
                                <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Costo
                                </span>
                                <span className="text-base font-extrabold leading-tight tabular-nums text-foreground">
                                  {m.type === "in" || m.type === "devolution"
                                    ? `$${(m.cost || 0).toFixed(2)}`
                                    : m.cost
                                      ? `$${m.cost.toFixed(2)}`
                                      : "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              <TableHead className="px-4 font-semibold text-foreground/75">
                Fecha
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Producto
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Código
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Tipo
              </TableHead>
              <TableHead className="px-4 text-right font-semibold text-foreground/75">
                Cantidad
              </TableHead>
              <TableHead className="px-4 text-right font-semibold text-foreground/75">
                Costo
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Notas
              </TableHead>
              {isAdmin && (
                <TableHead className="px-4 font-semibold text-foreground/75">
                  Registró
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-4 py-3">
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-14" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Skeleton className="h-4 w-40 max-w-full" />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Skeleton className="h-3 w-16" />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-4 w-12" />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-4 w-12" />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 8 : 7}
                  className="h-28 px-4 text-center"
                >
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <ArrowLeftRight size={32} className="opacity-40" />
                    <p className="text-sm">No hay movimientos registrados</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((m) => {
                const isIn = m.type === "in";
                const isOut = m.type === "out";
                const isDev = m.type === "devolution";
                const qtyColor = isIn
                  ? "text-emerald-600 dark:text-emerald-400"
                  : isOut
                    ? "text-red-600 dark:text-red-400"
                    : isDev
                      ? "text-violet-600 dark:text-violet-400"
                      : "text-amber-600 dark:text-amber-400";
                const qtySign = isIn ? "+" : isOut ? "-" : isDev ? "+" : "±";
                return (
                  <TableRow key={m.id}>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">
                        {formatMXDate(m.created_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatMXTime(m.created_at)}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="text-sm font-semibold text-foreground">
                        {m.product_name}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="text-xs font-mono text-muted-foreground">
                        {m.barcode}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <TypeBadge type={m.type} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <span className={`text-sm font-bold tabular-nums ${qtyColor}`}>
                        {qtySign}
                        {m.quantity} {getUnit(m.product_id)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                      {isIn || isDev
                        ? `$${(m.cost || 0).toFixed(2)}`
                        : m.cost
                          ? `$${m.cost.toFixed(2)}`
                          : "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="block max-w-[14rem] truncate text-sm text-muted-foreground">
                        {m.reference
                          ? `${m.reference}${m.notes && m.notes !== m.reference ? ` · ${m.notes}` : ""}`
                          : (m.notes || "—")}
                      </span>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                        {m.cashier_name || "—"}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      )}

      {!loading && movements.length > 0 && totalPages > 1 && (
        <PaginationBar
          pageStart={pageStart}
          pageSize={PAGE_SIZE}
          totalItems={movements.length}
          page={currentPage}
          totalPages={totalPages}
          setPage={setPage}
        />
      )}
    </div>
  );
};

export default StockMovements;
