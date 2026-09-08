import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  X,
  Banknote,
  ShoppingCart,
  Receipt,
  TrendingUp,
  BarChart3,
  Clock,
  CreditCard,
  CircleOff,
  TriangleAlert,
  CheckCircle2,
  Landmark,
  Eye,
  CircleDollarSign,
  Clock3,
  Download,
  Search,
  TrendingDown,
  User,
  UserCheck,
  Timer,
} from "lucide-react";
import { CardSkeleton } from "./Skeletons";
import CancelButton from "./CancelButton";
import { formatMXTime, formatMXDate, getMXDateString } from "../utils/dateUtils";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import { useCashier } from "../contexts/CashierContext";
import { Badge as ShBadge } from "./ui/badge";
import { Button as ShButton } from "./ui/button";
import {
  Pagination,
  PaginationInfo,
  PaginationControls,
  PaginationLabel,
  PaginationButton,
} from "./ui/pagination";
import {
  Select as ShSelect,
  SelectContent as ShSelectContent,
  SelectItem as ShSelectItem,
  SelectTrigger as ShSelectTrigger,
  SelectValue as ShSelectValue,
} from "./ui/select";
import {
  Table as ShTable,
  TableBody as ShTableBody,
  TableCell as ShTableCell,
  TableHeader as ShTableHeader,
  TableHead as ShTableHead,
  TableRow as ShTableRow,
} from "./ui/table";
import { Card as SCard, CardContent as SCardContent } from "./ui/card";
import { Separator } from "./ui/separator";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { DateRangePicker } from "./ui/date-range-picker";
import { ConfirmDialog } from "./ui/confirm";
import { cn } from "@/lib/utils";
applyPlugin(jsPDF);

const fmtMX = (n) =>
  Number(n || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const registerName = (cr) => {
  const n = cr.name;
  if (n && n !== "Cierre por cambio de turno" && !/^Cierre \d/.test(n)) {
    return n;
  }
  return cr.opener_name || `Cierre #${cr.id}`;
};

const RegisterRow = memo(function RegisterRow({
  cr,
  variant = "table",
  activeId,
  onView,
}) {
  const diff = Number(cr.difference || 0);
  const status = diff === 0
    ? { tone: "success", label: "Completo" }
    : { tone: "error", label: "Diferencia" };
  const badge =
    status.tone === "success" ? (
      <ShBadge
        variant="outline"
        className={cn(
          "whitespace-nowrap border-emerald-500/60 text-emerald-600 dark:border-emerald-400/50 dark:text-emerald-400",
          variant === "list" && "shrink-0",
        )}
      >
        <CheckCircle2 size={12} className={variant === "list" ? "mr-1" : ""} /> Completo
      </ShBadge>
    ) : (
      <ShBadge
        variant="outline"
        className={cn(
          "whitespace-nowrap border-red-500/60 text-red-600 dark:border-red-400/50 dark:text-red-400",
          variant === "list" && "shrink-0",
        )}
      >
        <TriangleAlert size={12} className={variant === "list" ? "mr-1" : ""} /> Diferencia
      </ShBadge>
    );

  if (variant === "list") {
    const active = activeId === cr.id;
    return (
      <div
        key={cr.id}
        role="button"
        tabIndex={0}
        onClick={() => onView(cr.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onView(cr.id);
          }
        }}
        className={`flex w-full cursor-pointer items-center gap-3 border-l-4 px-3 py-2.5 text-left transition-colors outline-none ${
          active
            ? "border-primary bg-primary/10"
            : "border-transparent hover:bg-accent/40"
        }`}
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-sm">
          {(cr.opener_name || "U").charAt(0)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-foreground">
            {registerName(cr)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {cr.opener_name || "—"}
          </span>
        </span>
        {badge}
        {active && (
          <CheckCircle2 size={16} className="shrink-0 text-primary" />
        )}
      </div>
    );
  }

  return (
    <ShTableRow key={cr.id} className="py-3">
      <ShTableCell className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-sm">
            {(cr.opener_name || "U").charAt(0)}
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">{registerName(cr)}</p>
            <p className="text-xs text-muted-foreground">{cr.opener_name || "—"}</p>
          </div>
        </div>
      </ShTableCell>
      <ShTableCell className="px-4 py-3">
        <div className="leading-tight">
          <p className="whitespace-nowrap text-sm font-medium text-foreground">
            {cr.closed_at
              ? formatMXDate(cr.closed_at, {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                })
              : "—"}
          </p>
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            {cr.closed_at ? formatMXTime(cr.closed_at) : ""}
          </p>
        </div>
      </ShTableCell>
      <ShTableCell className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
        ${fmtMX(cr.opening_balance)}
      </ShTableCell>
      <ShTableCell className="px-4 py-3">{badge}</ShTableCell>
      <ShTableCell className="px-4 py-3 text-center">
        <ShButton
          variant="outline"
          size="sm"
          onClick={() => onView(cr.id)}
        >
          <Eye size={15} className="mr-1.5" /> Ver
        </ShButton>
      </ShTableCell>
    </ShTableRow>
  );
});

const RegisterHistory = () => {
  const { cashier } = useCashier();
  const [loading, setLoading] = useState(true);
  const [closedRegisters, setClosedRegisters] = useState([]);
  const [cashiers, setCashiers] = useState([]);
  const [filterCashier, setFilterCashier] = useState("all");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(0);
  const isAdmin = cashier?.role === "admin";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await window.api.invoke("get-closed-registers", {
      cashierId: cashier?.id,
      role: cashier?.role,
    });
    if (result.success) {
      setClosedRegisters(result.registers || []);
    } else {
      setError(result.error || "No se pudieron cargar los cierres");
    }
    if (isAdmin) {
      const cashiersResult = await window.api.invoke("get-cashiers");
      if (Array.isArray(cashiersResult)) setCashiers(cashiersResult);
    }
    setLoading(false);
  }, [cashier?.id, cashier?.role, isAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredRegisters = useMemo(() => {
    const inDateRange = (cr) => {
      if (!dateRange?.from && !dateRange?.to) return true;
      const d = getMXDateString(cr.closed_at);
      if (dateRange.from && d < dateRange.from) return false;
      if (dateRange.to && d > dateRange.to) return false;
      return true;
    };
    let list = closedRegisters.filter(inDateRange);
    if (filterCashier !== "all") {
      list = list.filter(
        (cr) =>
          String(cr.opened_by) === String(filterCashier) ||
          String(cr.closed_by) === String(filterCashier),
      );
    }
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter((cr) => {
        const n = cr.name;
        const displayName =
          n && n !== "Cierre por cambio de turno" && !/^Cierre \d/.test(n)
            ? n
            : cr.opener_name || "";
        return (
          displayName.toLowerCase().includes(q) ||
          (cr.opener_name || "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [closedRegisters, filterCashier, dateRange, searchTerm]);

  const perPage = detailOpen ? 12 : 10;
  const maxPage = Math.max(
    0,
    Math.ceil(filteredRegisters.length / perPage) - 1,
  );
  const safePage = Math.min(page, maxPage);
  const pagedRegisters = filteredRegisters.slice(
    safePage * perPage,
    safePage * perPage + perPage,
  );

  const handleViewRegisterDetail = useCallback(async (registerId) => {
    setDetailLoading(true);
    setDetail(null);
    setDetailOpen(true);
    const result = await window.api.invoke(
      "get-register-sales-detail",
      registerId,
    );
    if (result.success) {
      setDetail(result);
    }
    setDetailLoading(false);
  }, []);

  const [cancelSaleData, setCancelSaleData] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const handleCancelSale = async () => {
    if (!cancelSaleData) return;
    setCancelLoading(true);
    try {
      const result = await window.api.invoke("cancel-sale", {
        saleId: cancelSaleData.saleId,
        cashierName: cashier?.name,
        role: cashier?.role,
        cashierId: cashier?.id,
      });
      const saleId = cancelSaleData.saleId;
      setCancelSaleData(null);
      if (result.success) {
        await handleViewRegisterDetail(cancelSaleData.registerId);
      } else {
        setError(result.error || "No se pudo cancelar la venta");
      }
    } finally {
      setCancelLoading(false);
    }
  };

  const [cancelExpenseData, setCancelExpenseData] = useState(null);
  const [cancelExpenseLoading, setCancelExpenseLoading] = useState(false);

  const handleCancelExpense = async () => {
    if (!cancelExpenseData) return;
    setCancelExpenseLoading(true);
    try {
      const result = await window.api.invoke("delete-cash-expense", {
        expenseId: cancelExpenseData.expenseId,
        cashierId: cashier?.id,
        role: cashier?.role,
      });
      const registerId = cancelExpenseData.registerId;
      setCancelExpenseData(null);
      if (result.success) {
        await handleViewRegisterDetail(registerId);
      } else {
        setError(result.error || "No se pudo cancelar el gasto");
      }
    } finally {
      setCancelExpenseLoading(false);
    }
  };

  const exportDetailPDF = async () => {
    if (!detail) return;
    const store =
      (await window.api.invoke("get-setting", "store_name")) || "MI TIENDA POS";
    const doc = new jsPDF();
    const r = detail.register;

    doc.setFontSize(16);
    doc.text(store, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(`Turnos y Cortes — ${registerName(r)}`, 14, 24);
    doc.text(
      `Responsable: ${r.opener_name || "—"}   Cerrado por: ${r.closer_name || "—"}`,
      14,
      30,
    );
    doc.text(
      `Abierta: ${formatMXDate(r.opened_at)} ${formatMXTime(r.opened_at)}   Cerrada: ${r.closed_at ? `${formatMXDate(r.closed_at)} ${formatMXTime(r.closed_at)}` : "—"}`,
      14,
      36,
    );
    doc.setTextColor(0);

    doc.autoTable({
      startY: 42,
      head: [["Resumen Financiero", "Monto"]],
      body: [
        ["Apertura", `$${fmtMX(r.opening_balance)}`],
        ["Efectivo", `$${fmtMX(r.cash_sales)}`],
        ["Tarjeta", `$${fmtMX(r.card_sales)}`],
        ["Transferencia", `$${fmtMX(r.transfer_sales)}`],
        ["Gastos", `-$${fmtMX(detail.totalExpenses)}`],
        ["Neto", `$${fmtMX(detail.totalSales - (detail.totalExpenses || 0))}`],
      ],
    });

    const txn = [
      ...detail.sales.map((s) => ({
        time: s.created_at,
        id: `#V-${s.id}`,
        type: s.status === "cancelado" ? "Cancelado" : "Venta",
        method: methodNames[s.payment_method] || s.payment_method,
        amount: s.status === "cancelado" ? 0 : s.total,
      })),
      ...detail.expenses.map((e) => ({
        time: e.created_at,
        id: `#G-${e.id}`,
        type: e.status === "cancelado" ? "Cancelado" : "Gasto",
        method: e.reason || "—",
        amount: e.status === "cancelado" ? 0 : -e.amount,
      })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time));

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Hora", "ID", "Tipo", "Método", "Monto"]],
      body: txn.map((t) => [
        formatMXTime(t.time),
        t.id,
        t.type,
        t.method,
        `${t.amount >= 0 ? "+" : "-"}$${fmtMX(Math.abs(t.amount))}`,
      ]),
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Producto", "Cantidad", "Precio", "Subtotal"]],
      body: detail.items.map((i) => [
        i.product_name || "Producto",
        String(i.quantity),
        `$${fmtMX(i.price_at_sale)}`,
        `$${fmtMX(i.quantity * i.price_at_sale)}`,
      ]),
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Verificación", "Valor"]],
      body: [
        ["Cierre Esperado", `$${fmtMX(r.expected_close)}`],
        ["Declarado", `$${fmtMX(r.declared_close)}`],
        ["Diferencia", `$${fmtMX(r.difference)}`],
      ],
    });

    const when = new Date(r.closed_at || r.opened_at);
    const suffix = Number.isNaN(when.getTime())
      ? "detalle"
      : when.toISOString().slice(0, 10);
    doc.save(`caja-${suffix}.pdf`);
  };

  const methodNames = {
    cash: "Efectivo",
    card: "Tarjeta",
    transfer: "Transferencia",
  };
  const methodIcons = {
    cash: <Banknote size={17} color="#059669" />,
    card: <CreditCard size={17} color="#4f46e5" />,
    transfer: <Landmark size={17} color="#d97706" />,
  };
  const formatDuration = (start, end) => {
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const diffMs = Math.max(0, e - s);
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  return (
    <div className="p-2 md:p-4">
      <div className="mb-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Turnos y Cortes
        </h1>
        <p className="text-sm text-muted-foreground">
          Historial de turnos de caja y cortes realizados
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <CardSkeleton count={4} />
      ) : (
        <div
          className="grid items-start gap-5"
          style={{
            gridTemplateColumns: detailOpen ? "minmax(0,1fr) minmax(0,2.2fr)" : "minmax(0,1fr)",
            transition: "grid-template-columns 280ms ease",
          }}
        >
          <div className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
          <div className="space-y-2 border-b border-border bg-muted/20 px-3 py-3 sm:px-4">
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(0);
                }}
                placeholder="Buscar por nombre..."
                className="h-10 w-full pl-9"
                aria-label="Buscar por nombre"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className={isAdmin ? "min-w-0" : "col-span-2 min-w-0"}>
                <DateRangePicker
                  value={dateRange}
                  onApply={(r) => {
                    setDateRange(r || { from: "", to: "" });
                    setPage(0);
                  }}
                  placeholder="Rango de fechas"
                  className="w-full sm:w-full"
                />
              </div>
              {isAdmin && (
                <div className="min-w-0">
                  <ShSelect
                    value={filterCashier}
                    onValueChange={(v) => {
                      setFilterCashier(v);
                      setPage(0);
                    }}
                  >
                    <ShSelectTrigger className="w-full">
                      <ShSelectValue placeholder="Cajero" />
                    </ShSelectTrigger>
                    <ShSelectContent>
                      <ShSelectItem value="all">Todos los cajeros</ShSelectItem>
                      {cashiers.map((c) => (
                        <ShSelectItem key={c.id} value={String(c.id)}>
                          {c.name} {c.role === "admin" ? "(Propietario)" : ""}
                        </ShSelectItem>
                      ))}
                    </ShSelectContent>
                  </ShSelect>
                </div>
              )}
            </div>
          </div>
          {filteredRegisters.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Landmark size={32} className="opacity-40" />
              <p>No hay turnos de caja registrados</p>
            </div>
          ) : (
            <>
              {!detailOpen ? (
                <div className="overflow-x-auto">
                  <ShTable>
                    <ShTableHeader>
                      <ShTableRow className="bg-muted/40 hover:bg-transparent">
                        <ShTableHead className="px-4 py-3 font-semibold text-foreground/75">Cajero / Turno</ShTableHead>
                        <ShTableHead className="px-4 py-3 font-semibold text-foreground/75">Fecha</ShTableHead>
                        <ShTableHead className="px-4 py-3 text-right font-semibold text-foreground/75">Apertura</ShTableHead>
                        <ShTableHead className="px-4 py-3 font-semibold text-foreground/75">Estado</ShTableHead>
                        <ShTableHead className="px-4 py-3 text-center font-semibold text-foreground/75">Acciones</ShTableHead>
                      </ShTableRow>
                    </ShTableHeader>
                    <ShTableBody>
                      {pagedRegisters.map((cr) => (
                        <RegisterRow
                          key={cr.id}
                          cr={cr}
                          variant="table"
                          onView={handleViewRegisterDetail}
                        />
                      ))}
                    </ShTableBody>
                  </ShTable>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border overflow-hidden">
                  {pagedRegisters.map((cr) => (
                    <RegisterRow
                      key={cr.id}
                      cr={cr}
                      variant="list"
                      activeId={detail?.register?.id}
                      onView={handleViewRegisterDetail}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {filteredRegisters.length > perPage && (
          <Pagination className="mt-4 px-1">
            <PaginationInfo>
              Mostrando {safePage * perPage + 1}–
              {Math.min(safePage * perPage + perPage, filteredRegisters.length)} de{" "}
              {filteredRegisters.length}
            </PaginationInfo>
            <PaginationControls>
              <PaginationLabel>
                Página {safePage + 1} de {maxPage + 1}
              </PaginationLabel>
              <PaginationButton
                icon="prev"
                label="Anterior"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              />
              <PaginationButton
                icon="next"
                label="Siguiente"
                disabled={safePage >= maxPage}
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              />
            </PaginationControls>
          </Pagination>
        )}
          </div>

        {detailOpen && (
          <div className="flex min-w-0 max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-md border border-border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <div className="border-b bg-muted/30 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold text-foreground">
                    {detail
                      ? `Turno de ${registerName(detail.register)}`
                      : "Cargando detalle..."}
                  </h3>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={exportDetailPDF}
                    title="Exportar PDF"
                    disabled={!detail}
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-muted-foreground/40 bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailOpen(false)}
                    title="Cerrar"
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-muted-foreground/40 bg-card text-muted-foreground transition-colors hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-600"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>

              {detail && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 lg:grid-cols-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
                      <User size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Responsable
                      </p>
                      <p className="truncate text-sm font-semibold text-foreground">
                        {detail.register.opener_name || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
                      <UserCheck size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Cerrado por
                      </p>
                      <p className="truncate text-sm font-semibold text-foreground">
                        {detail.register.closer_name || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
                      <Clock3 size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Horario
                      </p>
                      <p className="truncate text-sm tabular-nums text-muted-foreground">
                        {formatMXTime(detail.register.opened_at)}{" "}
                        <span className="text-muted-foreground/50">→</span>{" "}
                        {detail.register.closed_at
                          ? formatMXTime(detail.register.closed_at)
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
                      <Timer size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Duración
                      </p>
                      <p className="truncate text-sm font-semibold tabular-nums text-foreground">
                        {formatDuration(
                          detail.register.opened_at,
                          detail.register.closed_at,
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
              {detailLoading ? (
                <div className="p-4">
                  <CardSkeleton count={4} />
                </div>
              ) : detail ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-6 px-5 py-5">
              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    label: "Ventas",
                    value: `$${detail.totalSales.toFixed(2)}`,
                    icon: CircleDollarSign,
                    color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
                  },
                  {
                    label: "Artículos",
                    value: detail.totalItems,
                    icon: ShoppingCart,
                    color: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
                  },
                  {
                    label: "Operaciones",
                    value: detail.saleCount,
                    icon: Receipt,
                    color: "text-teal-600 dark:text-teal-400 bg-teal-500/10",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl border border-border/80 bg-card p-5 shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.color}`}>
                        <s.icon size={18} />
                      </span>
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        {s.label}
                      </p>
                    </div>
                    <p className="mt-2.5 truncate text-xl font-extrabold tabular-nums text-foreground">
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <SCard className="rounded-xl border-border/80 shadow-sm">
                <SCardContent className="space-y-3 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Resumen Financiero
                  </p>
                  {[
                    {
                      label: "Apertura",
                      value: `${(detail.register.opening_balance || 0).toFixed(2)}`,
                      neg: false,
                    },
                    {
                      label: "Efectivo",
                      value: `${(detail.register.cash_sales || 0).toFixed(2)}`,
                      neg: false,
                    },
                    {
                      label: "Tarjeta",
                      value: `${(detail.register.card_sales || 0).toFixed(2)}`,
                      neg: false,
                    },
                    {
                      label: "Transferencia",
                      value: `${(detail.register.transfer_sales || 0).toFixed(2)}`,
                      neg: false,
                    },
                    {
                      label: "Gastos",
                      value: `${(detail.totalExpenses || 0).toFixed(2)}`,
                      neg: true,
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between"
                    >
                      <span
                        className={`text-sm ${row.neg ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
                      >
                        {row.label}
                      </span>
                      <span
                        className={`text-sm font-bold tabular-nums ${row.neg ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                      >
                        {row.neg ? "-" : ""}${row.value}
                      </span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-extrabold text-foreground">Neto</span>
                    <span className="text-xl font-extrabold tabular-nums text-foreground">
                      ${(detail.totalSales - (detail.totalExpenses || 0)).toFixed(2)}
                    </span>
                  </div>
                </SCardContent>
              </SCard>

              <SCard className="rounded-xl border-border/80 shadow-sm">
                <SCardContent className="space-y-3 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Verificación de Cierre
                  </p>
                  {[
                    {
                      label: "Cierre Esperado",
                      value: `${(detail.register.expected_close || 0).toFixed(2)}`,
                    },
                    {
                      label: "Declarado",
                      value: `${(detail.register.declared_close || 0).toFixed(2)}`,
                    },
                    {
                      label: "Diferencia",
                      value: `${(detail.register.difference || 0).toFixed(2)}`,
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                      <span className="text-sm font-bold tabular-nums text-foreground">
                        ${row.value}
                      </span>
                    </div>
                  ))}
                </SCardContent>
              </SCard>
              </div>
            </div>

            <div className="space-y-6 border-t border-border bg-muted/20 px-5 py-5">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  Transacciones
                </h3>
                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {detail.saleCount}
                </span>
              </div>

              <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5">
                    <TrendingUp size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <h4 className="text-sm font-bold text-foreground">Ingresos</h4>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <ShTable>
                      <ShTableHeader>
                        <ShTableRow className="bg-muted/40 hover:bg-transparent">
                          {[
                            "Hora",
                            "ID",
                            "Método",
                            "Monto",
                            ...(isAdmin ? ["Acción"] : []),
                          ].map((h) => (
                            <ShTableHead
                              key={h}
                              className="whitespace-nowrap px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground"
                            >
                              {h}
                            </ShTableHead>
                          ))}
                        </ShTableRow>
                      </ShTableHeader>
                      <ShTableBody>
                        {[...detail.sales]
                          .slice()
                          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                          .map((s, idx) => (
                            <ShTableRow key={s.id} className={idx % 2 === 1 ? "bg-muted/40" : ""}>
                              <ShTableCell className="whitespace-nowrap px-4 py-2.5 text-sm tabular-nums text-foreground">
                                {formatMXTime(s.created_at)}
                              </ShTableCell>
                              <ShTableCell className="px-4 py-2.5 text-sm font-bold text-primary">
                                #V-{s.id}
                              </ShTableCell>
                              <ShTableCell className="px-4 py-2.5 text-sm text-foreground">
                                {s.status === "cancelado" ? (
                                  <ShBadge
                                    variant="outline"
                                    className="whitespace-nowrap border-red-500/60 text-red-600 dark:border-red-400/50 dark:text-red-400"
                                  >
                                    Cancelado
                                  </ShBadge>
                                ) : (
                                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                                    {methodIcons[s.payment_method]}
                                    {methodNames[s.payment_method] || s.payment_method}
                                  </span>
                                )}
                              </ShTableCell>
                              <ShTableCell className="whitespace-nowrap px-4 py-2.5 text-right">
                                <span
                                  className={`text-sm font-bold tabular-nums ${
                                    s.status === "cancelado"
                                      ? "text-muted-foreground line-through"
                                      : "text-foreground"
                                  }`}
                                >
                                  ${(s.status === "cancelado" ? 0 : s.total).toFixed(2)}
                                </span>
                              </ShTableCell>
                              {isAdmin && (
                                <ShTableCell className="px-4 py-2.5 text-center">
                                  {s.status !== "cancelado" && (
                                    <CancelButton
                                      size="sm"
                                      className="px-1.5 text-xs"
                                      onClick={() =>
                                        setCancelSaleData({
                                          saleId: s.id,
                                          registerId: detail.register.id,
                                        })
                                      }
                                    >
                                      Cancelar
                                    </CancelButton>
                                  )}
                                </ShTableCell>
                              )}
                            </ShTableRow>
                          ))}
                        {detail.sales.length === 0 && (
                          <ShTableRow>
                            <ShTableCell
                              colSpan={isAdmin ? 5 : 4}
                              className="px-4 py-6 text-center text-sm text-muted-foreground"
                            >
                              Sin ingresos
                            </ShTableCell>
                          </ShTableRow>
                        )}
                      </ShTableBody>
                    </ShTable>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5">
                    <TrendingDown size={16} className="text-red-600 dark:text-red-400" />
                    <h4 className="text-sm font-bold text-foreground">Egresos</h4>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <ShTable>
                      <ShTableHeader>
                        <ShTableRow className="bg-muted/40 hover:bg-transparent">
                          {[
                            "Hora",
                            "ID",
                            "Motivo",
                            "Monto",
                            ...(isAdmin ? ["Acción"] : []),
                          ].map((h) => (
                            <ShTableHead
                              key={h}
                              className="whitespace-nowrap px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground"
                            >
                              {h}
                            </ShTableHead>
                          ))}
                        </ShTableRow>
                      </ShTableHeader>
                      <ShTableBody>
                        {[...detail.expenses]
                          .slice()
                          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                          .map((e, idx) => (
                            <ShTableRow key={e.id} className={idx % 2 === 1 ? "bg-muted/40" : ""}>
                              <ShTableCell className="whitespace-nowrap px-4 py-2.5 text-sm tabular-nums text-foreground">
                                {formatMXTime(e.created_at)}
                              </ShTableCell>
                              <ShTableCell className="px-4 py-2.5 text-sm font-bold text-primary">
                                #G-{e.id}
                              </ShTableCell>
                              <ShTableCell className="max-w-[160px] px-4 py-2.5 text-sm text-foreground">
                                {e.status === "cancelado" ? (
                                  <ShBadge
                                    variant="outline"
                                    className="whitespace-nowrap border-red-500/60 text-red-600 dark:border-red-400/50 dark:text-red-400"
                                  >
                                    Cancelado
                                  </ShBadge>
                                ) : (
                                  <span className="block truncate">{e.reason}</span>
                                )}
                              </ShTableCell>
                              <ShTableCell className="whitespace-nowrap px-4 py-2.5 text-right">
                                <span
                                  className={`text-sm font-bold tabular-nums ${
                                    e.status === "cancelado"
                                      ? "text-muted-foreground line-through"
                                      : "text-red-600 dark:text-red-400"
                                  }`}
                                >
                                  -${(e.status === "cancelado" ? 0 : e.amount).toFixed(2)}
                                </span>
                              </ShTableCell>
                              {isAdmin && (
                                <ShTableCell className="px-4 py-2.5 text-center">
                                  {e.status !== "cancelado" && (
                                    <CancelButton
                                      size="sm"
                                      className="px-1.5 text-xs"
                                      onClick={() =>
                                        setCancelExpenseData({
                                          expenseId: e.id,
                                          amount: e.amount,
                                          desc: e.reason,
                                          registerId: detail.register.id,
                                        })
                                      }
                                    >
                                      Cancelar
                                    </CancelButton>
                                  )}
                                </ShTableCell>
                              )}
                            </ShTableRow>
                          ))}
                        {detail.expenses.length === 0 && (
                          <ShTableRow>
                            <ShTableCell
                              colSpan={isAdmin ? 5 : 4}
                              className="px-4 py-6 text-center text-sm text-muted-foreground"
                            >
                              Sin egresos
                            </ShTableCell>
                          </ShTableRow>
                        )}
                      </ShTableBody>
                    </ShTable>
                  </div>
                </div>
              </div>


              <div className="mt-5">
                <div className="flex items-center gap-2 pb-3">
                  <ShoppingCart size={16} className="text-muted-foreground" />
                  <h3 className="text-sm font-extrabold text-foreground">
                    Productos Vendidos
                  </h3>
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <ShTable>
                    <ShTableHeader>
                      <ShTableRow className="bg-muted/40 hover:bg-transparent">
                        {["Producto", "Cantidad", "Precio", "Subtotal"].map((h) => (
                          <ShTableHead
                            key={h}
                            className="whitespace-nowrap px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground"
                          >
                            {h}
                          </ShTableHead>
                        ))}
                      </ShTableRow>
                    </ShTableHeader>
                    <ShTableBody>
                      {detail.items.map((item, i) => (
                        <ShTableRow
                          key={i}
                          className={i % 2 === 1 ? "bg-muted/40" : ""}
                        >
                          <ShTableCell className="px-4 py-2.5 text-sm text-foreground">
                            {item.product_name || "Producto"}
                          </ShTableCell>
                          <ShTableCell className="px-4 py-2.5 text-sm tabular-nums text-foreground">
                            {item.quantity}
                          </ShTableCell>
                          <ShTableCell className="px-4 py-2.5 text-sm tabular-nums text-foreground">
                            ${item.price_at_sale.toFixed(2)}
                          </ShTableCell>
                          <ShTableCell className="px-4 py-2.5 text-sm font-bold tabular-nums text-foreground">
                            ${(item.quantity * item.price_at_sale).toFixed(2)}
                          </ShTableCell>
                        </ShTableRow>
                      ))}
                      {detail.items.length === 0 && (
                        <ShTableRow>
                          <ShTableCell
                            colSpan={4}
                            className="px-4 py-6 text-center text-sm text-muted-foreground"
                          >
                            No hay productos registrados
                          </ShTableCell>
                        </ShTableRow>
                      )}
                    </ShTableBody>
                  </ShTable>
                </div>
              </div>
            </div>
          </div>
        ) : null}
          </div>
        )}
        </div>
      )}


      {/* CANCEL SALE */}
      <ConfirmDialog
        open={!!cancelSaleData}
        onOpenChange={(v) => !v && !cancelLoading && setCancelSaleData(null)}
        title={`Cancelar venta #${cancelSaleData?.saleId}`}
        description={
          <>Se revertirá el stock de los productos y esta venta dejará de contar en la caja. Esta acción no se puede deshacer.</>
        }
        cancelLabel="No"
        confirmLabel="Sí, cancelar"
        loading={cancelLoading}
        onCancel={() => !cancelLoading && setCancelSaleData(null)}
        onConfirm={handleCancelSale}
      />

      {/* CANCEL EXPENSE */}
      <ConfirmDialog
        open={!!cancelExpenseData}
        onOpenChange={(v) => !v && !cancelExpenseLoading && setCancelExpenseData(null)}
        title="Cancelar gasto"
        description={
          <>
            {cancelExpenseData?.desc ? (
              <>
                <strong>Motivo:</strong> {cancelExpenseData.desc}
                <br />
              </>
            ) : null}
            Se cancelará el gasto de ${cancelExpenseData?.amount?.toFixed(2)}. Esta acción no se puede deshacer.
          </>
        }
        cancelLabel="No"
        confirmLabel="Sí, cancelar"
        loading={cancelExpenseLoading}
        onCancel={() => !cancelExpenseLoading && setCancelExpenseData(null)}
        onConfirm={handleCancelExpense}
      />
    </div>
  );
};

export default RegisterHistory;
