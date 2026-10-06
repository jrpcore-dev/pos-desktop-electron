import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useDeferredValue,
  memo,
} from "react";
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
  ChevronDown,
  Copy,
  Printer,
  ArrowUpDown,
  MoreVertical,
} from "lucide-react";
import { CardSkeleton } from "./Skeletons";
import CancelButton from "./CancelButton";
import { formatMXTime, formatMXDate, getMXDateString } from "../utils/dateUtils";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import interFontInline from "../assets/fonts/inter.ttf?inline";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { EmptyState } from "./ui/empty-state";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./ui/tooltip";
import { Spinner } from "./ui/spinner";
import { cn } from "@/lib/utils";
applyPlugin(jsPDF);

const fmtMX = (n) =>
  Number(n || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const MOV_PER_PAGE = 25;
const PROD_PER_PAGE = 25;

const MOV_SORT_OPTIONS = [
  { value: "recent", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "amount_desc", label: "Mayor monto" },
  { value: "amount_asc", label: "Menor monto" },
];

const MOV_METHOD_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
];

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
  const [requirePinForVoid, setRequirePinForVoid] = useState(false);
  const isAdmin = cashier?.role === "admin";

  // ── Panel de "Ver": pestañas, feed de movimientos y productos ──
  const [tab, setTab] = useState("resumen");
  const [refreshKey, setRefreshKey] = useState(0);
  const [movements, setMovements] = useState([]);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movPage, setMovPage] = useState(0);
  const [movSearch, setMovSearch] = useState("");
  const [movKind, setMovKind] = useState("all");
  const [movMethod, setMovMethod] = useState("all");
  const [movStatus, setMovStatus] = useState("all");
  const [movSort, setMovSort] = useState("recent");
  const [products, setProducts] = useState([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(false);
  const [prodPage, setProdPage] = useState(0);
  const [prodSearch, setProdSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState(null);
  const [saleItemsCache, setSaleItemsCache] = useState({});
  const deferredMovSearch = useDeferredValue(movSearch);
  const deferredProdSearch = useDeferredValue(prodSearch);
  const registerId = detail?.register?.id;

  useEffect(() => {
    let active = true;
    const loadPosSettings = async () => {
      try {
        const pinForVoid = await window.api.invoke(
          "get-setting",
          "pin_for_void"
        );
        if (active) setRequirePinForVoid(pinForVoid === "true");
      } catch (e) {}
    };
    loadPosSettings();
    return () => {
      active = false;
    };
  }, []);

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

  const handleViewRegisterDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setDetail(null);
    setDetailOpen(true);
    setTab("resumen");
    setMovPage(0);
    setMovSearch("");
    setMovKind("all");
    setMovMethod("all");
    setMovStatus("all");
    setMovSort("recent");
    setProdPage(0);
    setProdSearch("");
    setExpandedKey(null);
    const result = await window.api.invoke("get-register-sales-detail", id);
    if (result.success) {
      setDetail(result);
    }
    setDetailLoading(false);
  }, []);

  const reloadSummary = useCallback(async (id) => {
    if (!id) return;
    const result = await window.api.invoke("get-register-sales-detail", id);
    if (result.success) setDetail(result);
  }, []);

  const refreshPanel = useCallback(
    (id) => {
      reloadSummary(id);
      setRefreshKey((k) => k + 1);
    },
    [reloadSummary],
  );

  // Feed de movimientos (paginado / filtrable)
  useEffect(() => {
    if (!detailOpen || !registerId || tab !== "transacciones") return;
    let active = true;
    setMovementsLoading(true);
    window.api
      .invoke("get-register-movements", {
        registerId,
        search: deferredMovSearch,
        kind: movKind,
        method: movMethod,
        status: movStatus,
        sort: movSort,
        page: movPage + 1,
        pageSize: MOV_PER_PAGE,
      })
      .then((res) => {
        if (!active) return;
        if (res?.success) {
          setMovements(res.rows || []);
          setMovementsTotal(res.total || 0);
        }
        setMovementsLoading(false);
      })
      .catch(() => active && setMovementsLoading(false));
    return () => {
      active = false;
    };
  }, [
    detailOpen,
    registerId,
    tab,
    deferredMovSearch,
    movKind,
    movMethod,
    movStatus,
    movSort,
    movPage,
    refreshKey,
  ]);

  // Productos vendidos (paginado / filtrable)
  useEffect(() => {
    if (!detailOpen || !registerId || tab !== "productos") return;
    let active = true;
    setProductsLoading(true);
    window.api
      .invoke("get-register-products", {
        registerId,
        search: deferredProdSearch,
        page: prodPage + 1,
        pageSize: PROD_PER_PAGE,
      })
      .then((res) => {
        if (!active) return;
        if (res?.success) {
          setProducts(res.rows || []);
          setProductsTotal(res.total || 0);
        }
        setProductsLoading(false);
      })
      .catch(() => active && setProductsLoading(false));
    return () => {
      active = false;
    };
  }, [detailOpen, registerId, tab, deferredProdSearch, prodPage, refreshKey]);

  const handleToggleExpand = useCallback(
    async (mov) => {
      const key = `${mov.kind}-${mov.ref_id}`;
      setExpandedKey((prev) => (prev === key ? null : key));
      if (mov.kind !== "income") return;
      if (saleItemsCache[mov.ref_id]) return;
      const res = await window.api.invoke("get-sale-details", mov.ref_id);
      if (res?.success) {
        setSaleItemsCache((prev) => ({
          ...prev,
          [mov.ref_id]: res.items || [],
        }));
      }
    },
    [saleItemsCache],
  );

  const [cancelSaleData, setCancelSaleData] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelPin, setCancelPin] = useState("");
  const [cancelPinError, setCancelPinError] = useState("");

  const handleCancelSale = async () => {
    if (!cancelSaleData) return;
    if (requirePinForVoid) {
      if (!cashier?.id) {
        setCancelPinError("Sesión no válida");
        return;
      }
      if (!cancelPin) {
        setCancelPinError("Ingresa tu NIP para continuar");
        return;
      }
    }
    setCancelLoading(true);
    try {
      if (requirePinForVoid) {
        const auth = await window.api.invoke(
          "verify-cashier-pin",
          cashier.id,
          cancelPin
        );
        if (!auth?.success) {
          setCancelPinError(auth?.error || "NIP incorrecto");
          return;
        }
      }
      const result = await window.api.invoke("cancel-sale", {
        saleId: cancelSaleData.saleId,
        cashierName: cashier?.name,
        role: cashier?.role,
        cashierId: cashier?.id,
      });
      const saleId = cancelSaleData.saleId;
      setCancelSaleData(null);
      setCancelPin("");
      if (result.success) {
        refreshPanel(cancelSaleData.registerId);
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
        refreshPanel(registerId);
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
    const pageW = doc.internal.pageSize.getWidth();

    const [movRes, prodRes] = await Promise.all([
      window.api.invoke("get-register-movements", {
        registerId: r.id,
        pageSize: 200,
      }),
      window.api.invoke("get-register-products", {
        registerId: r.id,
        pageSize: 200,
      }),
    ]);
    const movs = movRes?.rows || [];
    const prods = prodRes?.rows || [];

    let fontName = "helvetica";
    if (typeof interFontInline === "string" && interFontInline.includes(",")) {
      try {
        const b64 = interFontInline.split(",")[1];
        doc.addFileToVFS("Inter.ttf", b64);
        doc.addFont("Inter.ttf", "Inter", "normal");
        doc.addFont("Inter.ttf", "Inter", "bold");
        doc.setFont("Inter", "normal");
        fontName = "Inter";
      } catch (e) {
        fontName = "helvetica";
      }
    }

    const C = {
      ink: [15, 23, 42],
      body: [51, 65, 85],
      muted: [100, 116, 139],
      line: [226, 232, 240],
      grid: [148, 163, 184],
      head: [241, 245, 249],
      brand: [30, 64, 175],
      white: [255, 255, 255],
    };

    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);
    doc.text(store.toUpperCase(), pageW / 2, 18, { align: "center" });
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...C.muted);
    doc.text(`Turnos y Cortes — ${registerName(r)}`, pageW / 2, 24, {
      align: "center",
    });
    doc.text(
      `Responsable: ${r.opener_name || "—"}   Cerrado por: ${r.closer_name || "—"}`,
      pageW / 2,
      30,
      { align: "center" },
    );
    doc.text(
      `Abierta: ${formatMXDate(r.opened_at)} ${formatMXTime(r.opened_at)}   Cerrada: ${r.closed_at ? `${formatMXDate(r.closed_at)} ${formatMXTime(r.closed_at)}` : "—"}`,
      pageW / 2,
      36,
      { align: "center" },
    );

    doc.setDrawColor(...C.brand);
    doc.setLineWidth(0.8);
    doc.line(14, 41, pageW - 14, 41);

    const tblBase = {
      font: fontName,
      fontSize: 9,
      cellPadding: 3,
      textColor: C.body,
      lineColor: C.grid,
      lineWidth: 0.4,
    };
    const tblHead = {
      fillColor: C.head,
      textColor: C.ink,
      fontStyle: "bold",
    };

    doc.autoTable({
      startY: 45,
      head: [["Resumen Financiero", "Monto"]],
      body: [
        ["Apertura", `$${fmtMX(r.opening_balance)}`],
        ["Efectivo", `$${fmtMX(r.cash_sales)}`],
        ["Tarjeta", `$${fmtMX(r.card_sales)}`],
        ["Transferencia", `$${fmtMX(r.transfer_sales)}`],
        ["Gastos", `-$${fmtMX(detail.totalExpenses)}`],
        ["Neto", `$${fmtMX(detail.totalSales - (detail.totalExpenses || 0))}`],
      ],
      styles: tblBase,
      headStyles: tblHead,
      columnStyles: { 1: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });

    let cursorY = doc.lastAutoTable.finalY;
    if (postCloseDeltas.length > 0) {
      doc.setFontSize(8);
      doc.setFont(undefined, "normal");
      doc.setTextColor(...C.muted);
      const adjText = postCloseDeltas
        .map(
          (m) =>
            `${m.label} ${m.delta > 0 ? "+" : "-"}$${fmtMX(Math.abs(m.delta))}`,
        )
        .join("   ");
      doc.text(
        `Ajustes post-corte: ${adjText} (difiere del estado actual: ventas, cancelaciones o devoluciones posteriores al cierre)`,
        14,
        cursorY + 4,
      );
      cursorY += 6;
    }

    const txn = movs
      .map((m) => ({
        time: m.created_at,
        id: `#${m.kind === "income" ? "V" : "G"}-${m.ref_id}`,
        type:
          m.state === "cancelled"
            ? "Cancelado"
            : m.kind === "income"
              ? "Venta"
              : "Gasto",
        method:
          m.kind === "income"
            ? methodNames[m.method] || m.method
            : m.reason || "—",
        amount: m.state === "cancelled" ? 0 : m.amount,
      }))
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    doc.autoTable({
      startY: cursorY + 8,
      head: [["Hora", "ID", "Tipo", "Método", "Monto"]],
      body: txn.map((t) => [
        formatMXTime(t.time),
        t.id,
        t.type,
        t.method,
        `${t.amount >= 0 ? "+" : "-"}$${fmtMX(Math.abs(t.amount))}`,
      ]),
      styles: tblBase,
      headStyles: tblHead,
      columnStyles: { 4: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Producto", "Cantidad", "Precio", "Subtotal"]],
      body: prods.map((p) => [
        p.product_name || "Producto",
        String(p.quantity),
        `$${fmtMX(p.quantity ? p.gross / p.quantity : 0)}`,
        `$${fmtMX(p.subtotal)}`,
      ]),
      styles: tblBase,
      headStyles: tblHead,
      columnStyles: { 1: { halign: "center" }, 3: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Verificación", "Valor"]],
      body: [
        ["Cierre Esperado", `$${fmtMX(r.expected_close)}`],
        ["Declarado", `$${fmtMX(r.declared_close)}`],
        ["Diferencia", `$${fmtMX(r.difference)}`],
      ],
      styles: tblBase,
      headStyles: tblHead,
      columnStyles: { 1: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });

    const totalPages = doc.getNumberOfPages();
    for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
      doc.setPage(pageIdx);
      const fy = doc.internal.pageSize.getHeight() - 10;
      doc.setFontSize(8);
      doc.setFont(undefined, "normal");
      doc.setTextColor(...C.muted);
      doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, 14, fy);
      doc.text(`Página ${pageIdx} de ${totalPages}`, pageW / 2, fy, {
        align: "center",
      });
      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);
      doc.text("Vendia", pageW - 14, fy, { align: "right" });
    }

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

  const difference = Number(detail?.register?.difference || 0);
  const hasDifference = Math.abs(difference) >= 0.005;
  const diffTone = hasDifference
    ? "text-red-600 dark:text-red-400 bg-red-500/10"
    : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  const diffText = hasDifference
    ? "text-red-600 dark:text-red-400"
    : "text-emerald-600 dark:text-emerald-400";
  const postCloseDeltas = (() => {
    const live = detail?.live;
    const reg = detail?.register;
    if (!live || !reg) return [];
    return [
      { label: "Efectivo", stored: reg.cash_sales, live: live.cashSales },
      { label: "Tarjeta", stored: reg.card_sales, live: live.cardSales },
      {
        label: "Transferencia",
        stored: reg.transfer_sales,
        live: live.transferSales,
      },
    ]
      .map((m) => ({
        ...m,
        delta:
          Math.round((Number(m.live || 0) - Number(m.stored || 0)) * 100) / 100,
      }))
      .filter((m) => Math.abs(m.delta) >= 0.005);
  })();
  const hasMovFilters =
    movSearch.trim() !== "" ||
    movKind !== "all" ||
    movMethod !== "all" ||
    movStatus !== "all" ||
    movSort !== "recent";
  const statusBadge = hasDifference ? (
    <ShBadge
      variant="outline"
      className="shrink-0 whitespace-nowrap border-red-500/60 text-red-600 dark:border-red-400/50 dark:text-red-400"
    >
      <TriangleAlert size={12} className="mr-1" /> Diferencia
    </ShBadge>
  ) : (
    <ShBadge
      variant="outline"
      className="shrink-0 whitespace-nowrap border-emerald-500/60 text-emerald-600 dark:border-emerald-400/50 dark:text-emerald-400"
    >
      <CheckCircle2 size={12} className="mr-1" /> Completo
    </ShBadge>
  );

  return (
    <div className="p-1">
      <div className="mb-3">
        <p className="text-sm text-muted-foreground">
          Consulta, filtra y reimprime cortes por fecha, caja o cajero
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
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex min-w-0 max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
          >
            <div className="shrink-0 border-b bg-muted/30 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-lg font-bold text-foreground">
                      {detail
                        ? `Turno de ${registerName(detail.register)}`
                        : "Cargando detalle..."}
                    </h3>
                    {detail && statusBadge}
                  </div>
                </div>
                <TooltipProvider delayDuration={200}>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ShButton
                          variant="outline"
                          size="icon"
                          onClick={exportDetailPDF}
                          disabled={!detail}
                          aria-label="Exportar PDF"
                        >
                          <Download size={16} />
                        </ShButton>
                      </TooltipTrigger>
                      <TooltipContent>Exportar PDF</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ShButton
                          variant="outline"
                          size="icon"
                          className="hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-600"
                          onClick={() => setDetailOpen(false)}
                          aria-label="Cerrar"
                        >
                          <X size={17} />
                        </ShButton>
                      </TooltipTrigger>
                      <TooltipContent>Cerrar</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
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

              {detail && (
                <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                  {[
                    {
                      label: "Ventas",
                      value: `$${fmtMX(detail.totalSales)}`,
                      tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
                    },
                    {
                      label: "Neto",
                      value: `$${fmtMX(detail.totalSales - (detail.totalExpenses || 0))}`,
                      tone: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
                    },
                    {
                      label: "Diferencia",
                      value: `$${fmtMX(detail.register.difference)}`,
                      tone: diffTone,
                    },
                  ].map((k) => (
                    <div
                      key={k.label}
                      className="rounded-lg border border-border/70 bg-card px-2.5 py-2"
                    >
                      <span
                        className={cn(
                          "inline-flex rounded-md px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider",
                          k.tone,
                        )}
                      >
                        {k.label}
                      </span>
                      <p className="mt-1 truncate text-base font-extrabold tabular-nums text-foreground">
                        {k.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex justify-center">
                <TabsList className="h-10">
                  <TabsTrigger value="resumen" className="px-4">
                    Resumen
                  </TabsTrigger>
                  <TabsTrigger value="transacciones" className="px-4">
                    Transacciones
                  </TabsTrigger>
                  <TabsTrigger value="productos" className="px-4">
                    Productos
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>
              {detailLoading ? (
                <div className="p-4">
                  <CardSkeleton count={4} />
                </div>
              ) : detail ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="resumen" className="m-0 space-y-6 px-5 py-5">
              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    label: "Ventas",
                    value: `$${fmtMX(detail.totalSales)}`,
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
                        value: fmtMX(detail.register.opening_balance),
                        neg: false,
                      },
                      {
                        label: "Efectivo",
                        value: fmtMX(detail.register.cash_sales),
                        neg: false,
                      },
                      {
                        label: "Tarjeta",
                        value: fmtMX(detail.register.card_sales),
                        neg: false,
                      },
                      {
                        label: "Transferencia",
                        value: fmtMX(detail.register.transfer_sales),
                        neg: false,
                      },
                      {
                        label: "Gastos",
                        value: fmtMX(detail.totalExpenses),
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
                    {postCloseDeltas.length > 0 && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                              <span>
                                Ajustes post-corte:{" "}
                                {postCloseDeltas
                                  .map(
                                    (m) =>
                                      `${m.label} ${m.delta > 0 ? "+" : "−"}$${fmtMX(Math.abs(m.delta))}`,
                                  )
                                  .join(" · ")}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            Difiere del estado actual: incluye ventas,
                            cancelaciones o devoluciones posteriores al cierre.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <Separator />
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-extrabold text-foreground">Neto</span>
                      <span className="text-xl font-extrabold tabular-nums text-foreground">
                        ${fmtMX(detail.totalSales - (detail.totalExpenses || 0))}
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
                        value: fmtMX(detail.register.expected_close),
                        tone: "text-foreground",
                      },
                      {
                        label: "Declarado",
                        value: fmtMX(detail.register.declared_close),
                        tone: "text-foreground",
                      },
                      {
                        label: "Diferencia",
                        value: fmtMX(detail.register.difference),
                        tone: diffText,
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between"
                      >
                        <span className="text-sm text-muted-foreground">{row.label}</span>
                        <span className={`text-sm font-bold tabular-nums ${row.tone}`}>
                          ${row.value}
                        </span>
                      </div>
                    ))}
                  </SCardContent>
                </SCard>
              </div>
            </TabsContent>

            <TabsContent value="transacciones" className="m-0 flex flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2.5">
                <div className="relative min-w-[180px] flex-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={movSearch}
                    onChange={(e) => {
                      setMovSearch(e.target.value);
                      setMovPage(0);
                    }}
                    placeholder="Buscar producto, folio o monto..."
                    className="h-9 pl-8"
                    aria-label="Buscar movimiento"
                  />
                </div>
                <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
                  {[
                    { value: "all", label: "Todos" },
                    { value: "income", label: "Ingresos" },
                    { value: "expense", label: "Egresos" },
                  ].map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => {
                        setMovKind(k.value);
                        setMovPage(0);
                      }}
                      className={cn(
                        "cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                        movKind === k.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent/60",
                      )}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <ShSelect
                  value={movMethod}
                  onValueChange={(v) => {
                    setMovMethod(v);
                    setMovPage(0);
                  }}
                >
                  <ShSelectTrigger className="h-9 w-[150px]">
                    <ShSelectValue />
                  </ShSelectTrigger>
                  <ShSelectContent>
                    {MOV_METHOD_OPTIONS.map((m) => (
                      <ShSelectItem key={m.value} value={m.value}>
                        {m.value === "all" ? "Todo método" : m.label}
                      </ShSelectItem>
                    ))}
                  </ShSelectContent>
                </ShSelect>
                <ShSelect
                  value={movStatus}
                  onValueChange={(v) => {
                    setMovStatus(v);
                    setMovPage(0);
                  }}
                >
                  <ShSelectTrigger className="h-9 w-[140px]">
                    <ShSelectValue />
                  </ShSelectTrigger>
                  <ShSelectContent>
                    <ShSelectItem value="all">Todo estado</ShSelectItem>
                    <ShSelectItem value="active">Activos</ShSelectItem>
                    <ShSelectItem value="cancelled">Cancelados</ShSelectItem>
                  </ShSelectContent>
                </ShSelect>
                <ShSelect
                  value={movSort}
                  onValueChange={(v) => {
                    setMovSort(v);
                    setMovPage(0);
                  }}
                >
                  <ShSelectTrigger className="h-9 w-[160px]">
                    <ShSelectValue />
                  </ShSelectTrigger>
                  <ShSelectContent>
                    {MOV_SORT_OPTIONS.map((s) => (
                      <ShSelectItem key={s.value} value={s.value}>
                        {s.label}
                      </ShSelectItem>
                    ))}
                  </ShSelectContent>
                </ShSelect>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {movementsLoading ? (
                  <div className="p-4">
                    <CardSkeleton count={5} />
                  </div>
                ) : movements.length === 0 ? (
                  <EmptyState
                    icon={<Receipt size={22} />}
                    title="Sin movimientos"
                    description="No se encontraron ingresos ni egresos con los filtros aplicados."
                    action={
                      hasMovFilters ? (
                        <ShButton
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setMovSearch("");
                            setMovKind("all");
                            setMovMethod("all");
                            setMovStatus("all");
                            setMovSort("recent");
                            setMovPage(0);
                          }}
                        >
                          Limpiar filtros
                        </ShButton>
                      ) : null
                    }
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {movements.map((mov) => {
                      const isIncome = mov.kind === "income";
                      const cancelled = mov.state === "cancelled";
                      const key = `${mov.kind}-${mov.ref_id}`;
                      const expanded = expandedKey === key;
                      const canExpand = isIncome;
                      const items = saleItemsCache[mov.ref_id];
                      return (
                        <div key={key}>
                          <div
                            className={cn(
                              "flex items-center gap-3 px-4 py-2.5 transition-colors",
                              canExpand && "cursor-pointer hover:bg-accent/40",
                            )}
                            onClick={
                              canExpand ? () => handleToggleExpand(mov) : undefined
                            }
                          >
                            <span
                              className={cn(
                                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                                isIncome
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-red-500/10 text-red-600 dark:text-red-400",
                              )}
                            >
                              {isIncome ? (
                                <TrendingUp size={15} />
                              ) : (
                                <TrendingDown size={15} />
                              )}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                                  {isIncome
                                    ? mov.products || "Venta"
                                    : mov.reason || "Gasto"}
                                </span>
                                {cancelled && (
                                  <ShBadge
                                    variant="outline"
                                    className="whitespace-nowrap border-red-500/60 text-red-600 dark:border-red-400/50 dark:text-red-400"
                                  >
                                    Cancelado
                                  </ShBadge>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="tabular-nums">
                                  {formatMXTime(mov.created_at)}
                                </span>
                                <span className="font-semibold text-primary">
                                  {isIncome ? `#V-${mov.ref_id}` : `#G-${mov.ref_id}`}
                                </span>
                                {isIncome && (
                                  <span className="flex items-center gap-1">
                                    {methodIcons[mov.method]}
                                    {methodNames[mov.method] || mov.method}
                                  </span>
                                )}
                              </div>
                            </div>

                            <span
                              className={cn(
                                "shrink-0 text-right text-sm font-bold tabular-nums",
                                cancelled
                                  ? "text-muted-foreground line-through"
                                  : isIncome
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400",
                              )}
                            >
                              {isIncome ? "+" : "−"}${fmtMX(Math.abs(mov.amount))}
                            </span>

                            {(isAdmin || mov.can_cancel) && !cancelled && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <ShButton
                                    variant="ghost"
                                    size="icon-sm"
                                    className="shrink-0"
                                    aria-label="Acciones"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreVertical size={15} />
                                  </ShButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      navigator.clipboard?.writeText(
                                        `${isIncome ? "V" : "G"}-${mov.ref_id}`,
                                      )
                                    }
                                  >
                                    <Copy size={14} className="mr-2" /> Copiar folio
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => {
                                      setCancelPin("");
                                      setCancelPinError("");
                                      if (isIncome) {
                                        setCancelSaleData({
                                          saleId: mov.ref_id,
                                          registerId: detail.register.id,
                                        });
                                      } else {
                                        setCancelExpenseData({
                                          expenseId: mov.ref_id,
                                          amount: Math.abs(mov.amount),
                                          desc: mov.reason,
                                          registerId: detail.register.id,
                                        });
                                      }
                                    }}
                                  >
                                    <X size={14} className="mr-2" /> Cancelar
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}

                            {canExpand && (
                              <ChevronDown
                                size={15}
                                className={cn(
                                  "shrink-0 text-muted-foreground transition-transform",
                                  expanded && "rotate-180",
                                )}
                              />
                            )}
                          </div>

                          {expanded && canExpand && (
                            <div className="border-t border-border/70 bg-muted/30 px-4 py-3">
                              {!items ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Spinner size={14} /> Cargando productos...
                                </div>
                              ) : items.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Sin productos registrados.
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  {items.map((it) => (
                                    <div
                                      key={it.id}
                                      className="flex items-center justify-between gap-3 text-xs"
                                    >
                                      <span className="min-w-0 truncate text-foreground">
                                        {it.name || it.product_name || "Producto"}
                                        {Number(it.returned_qty || 0) > 0 && (
                                          <span className="ml-1 text-muted-foreground">
                                            (dev. {it.returned_qty})
                                          </span>
                                        )}
                                      </span>
                                      <span className="shrink-0 tabular-nums text-muted-foreground">
                                        {it.quantity} × ${fmtMX(it.price_at_sale)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {movementsTotal > MOV_PER_PAGE && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
                  <PaginationInfo>
                    {`Mostrando ${
                      movPage * MOV_PER_PAGE + 1
                    }–${Math.min(
                      (movPage + 1) * MOV_PER_PAGE,
                      movementsTotal,
                    )} de ${movementsTotal} movimientos`}
                  </PaginationInfo>
                  <PaginationControls>
                    <PaginationButton
                      icon="prev"
                      label="Anterior"
                      disabled={movPage === 0 || movementsLoading}
                      onClick={() => setMovPage((p) => Math.max(0, p - 1))}
                    />
                    <PaginationButton
                      icon="next"
                      label="Siguiente"
                      disabled={
                        (movPage + 1) * MOV_PER_PAGE >= movementsTotal ||
                        movementsLoading
                      }
                      onClick={() => setMovPage((p) => p + 1)}
                    />
                  </PaginationControls>
                </div>
              )}
            </TabsContent>

            <TabsContent value="productos" className="m-0 flex flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2.5">
                <div className="relative min-w-[180px] flex-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={prodSearch}
                    onChange={(e) => {
                      setProdSearch(e.target.value);
                      setProdPage(0);
                    }}
                    placeholder="Buscar producto o código..."
                    className="h-9 pl-8"
                    aria-label="Buscar producto"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {productsLoading ? (
                  <div className="p-4">
                    <CardSkeleton count={5} />
                  </div>
                ) : products.length === 0 ? (
                  <EmptyState
                    icon={<ShoppingCart size={22} />}
                    title="Sin productos"
                    description="No hay productos vendidos que coincidan."
                    action={
                      prodSearch.trim() ? (
                        <ShButton
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setProdSearch("");
                            setProdPage(0);
                          }}
                        >
                          Limpiar búsqueda
                        </ShButton>
                      ) : null
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <ShTable>
                      <ShTableHeader className="sticky top-0 z-10">
                        <ShTableRow className="bg-muted/40 hover:bg-transparent">
                          {["Producto", "Cantidad", "Precio prom.", "Subtotal"].map(
                            (h, i) => (
                              <ShTableHead
                                key={h}
                                className={cn(
                                  "whitespace-nowrap px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground",
                                  i > 0 && "text-right",
                                )}
                              >
                                {h}
                              </ShTableHead>
                            ),
                          )}
                        </ShTableRow>
                      </ShTableHeader>
                      <ShTableBody>
                        {products.map((p) => (
                          <ShTableRow key={p.product_id}>
                            <ShTableCell className="px-4 py-2.5 text-sm text-foreground">
                              <span className="block truncate">{p.product_name}</span>
                              {p.barcode ? (
                                <span className="text-[0.65rem] text-muted-foreground">
                                  {p.barcode}
                                </span>
                              ) : null}
                            </ShTableCell>
                            <ShTableCell className="px-4 py-2.5 text-right text-sm tabular-nums text-foreground">
                              {p.quantity}
                            </ShTableCell>
                            <ShTableCell className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
                              ${fmtMX(p.quantity ? p.gross / p.quantity : 0)}
                            </ShTableCell>
                            <ShTableCell className="px-4 py-2.5 text-right text-sm font-bold tabular-nums text-foreground">
                              ${fmtMX(p.subtotal)}
                            </ShTableCell>
                          </ShTableRow>
                        ))}
                      </ShTableBody>
                    </ShTable>
                  </div>
                )}
              </div>

              {productsTotal > PROD_PER_PAGE && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
                  <PaginationInfo>
                    {`Mostrando ${
                      prodPage * PROD_PER_PAGE + 1
                    }–${Math.min(
                      (prodPage + 1) * PROD_PER_PAGE,
                      productsTotal,
                    )} de ${productsTotal} productos`}
                  </PaginationInfo>
                  <PaginationControls>
                    <PaginationButton
                      icon="prev"
                      label="Anterior"
                      disabled={prodPage === 0 || productsLoading}
                      onClick={() => setProdPage((p) => Math.max(0, p - 1))}
                    />
                    <PaginationButton
                      icon="next"
                      label="Siguiente"
                      disabled={
                        (prodPage + 1) * PROD_PER_PAGE >= productsTotal ||
                        productsLoading
                      }
                      onClick={() => setProdPage((p) => p + 1)}
                    />
                  </PaginationControls>
                </div>
              )}
            </TabsContent>
          </div>
        ) : null}
          </Tabs>
        )}
        </div>
      )}


      {/* CANCEL SALE */}
      <ConfirmDialog
        open={!!cancelSaleData}
        onOpenChange={(v) => {
          if (!v && !cancelLoading) {
            setCancelSaleData(null);
            setCancelPin("");
            setCancelPinError("");
          }
        }}
        title={`Cancelar venta #${cancelSaleData?.saleId}`}
        description={
          <>Se revertirá el stock de los productos y esta venta dejará de contar en la caja. Esta acción no se puede deshacer.</>
        }
        cancelLabel="No"
        confirmLabel="Sí, cancelar"
        loading={cancelLoading}
        onCancel={() => {
          if (cancelLoading) return;
          setCancelSaleData(null);
          setCancelPin("");
          setCancelPinError("");
        }}
        onConfirm={handleCancelSale}
      >
        {requirePinForVoid && (
          <>
            <label className="text-sm font-medium text-foreground">
              NIP de {cashier?.name || "usuario"}
            </label>
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={12}
              value={cancelPin}
              placeholder="Ingresa tu NIP"
              onChange={(e) => {
                setCancelPin(e.target.value);
                setCancelPinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCancelSale();
              }}
              aria-invalid={!!cancelPinError}
            />
            {cancelPinError && (
              <p className="text-xs text-destructive">{cancelPinError}</p>
            )}
          </>
        )}
      </ConfirmDialog>

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




