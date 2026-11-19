import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDbChanges } from "../lib/useDbChanges";
import { useRowsEntering } from "../lib/useRowsEntering";
import FreshDataChip from "./FreshDataChip";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Banknote,
  CircleDollarSign,
  CreditCard,
  Eye,
  FileDown,
  FileSpreadsheet,
  Landmark,
  HandCoins,
  Printer,
  ReceiptText,
  Search,
  SearchX,
  XCircle,
  Undo2,
  Package,
} from "lucide-react";
import { loadPdfToolchain } from "@/utils/pdfToolchain";
import { printDocument } from "../utils/printPdf";
import {
  formatMXDate,
  formatMXTime,
  formatMXDateTime,
  mxToday,
} from "../utils/dateUtils";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Hint } from "./ui/hint";
import { fmtMoney, fmtMoneyAbs } from "../utils/format";
import { buildReceiptHTML } from "../utils/receiptTemplate";
import { prepareTicketLogo } from "../utils/logo";
import { Badge } from "./ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "./ui/table";
import { Skeleton } from "./ui/skeleton";
import { StatCard } from "./ui/stat-card";
import {
  Pagination, PaginationInfo, PaginationControls, PaginationLabel, PaginationButton,
} from "./ui/pagination";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "./ui/tabs";
import { DateRangePicker } from "./ui/date-range-picker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { Separator } from "./ui/separator";
import { CardSkeleton } from "./Skeletons";
import { cn } from "@/lib/utils";


import PageHeader from "./PageHeader";

const PAGE_SIZE = 20;

const methodMeta = {
  cash: { label: "Efectivo", icon: Banknote, cls: "text-emerald-600 dark:text-emerald-400" },
  card: { label: "Tarjeta", icon: CreditCard, cls: "text-indigo-500 dark:text-indigo-400" },
  transfer: { label: "Transferencia", icon: Landmark, cls: "text-amber-600 dark:text-amber-400" },
  credit: { label: "Fiado", icon: HandCoins, cls: "text-destructive dark:text-red-400" },
};

const methodNames = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  credit: "Fiado",
};


const sortRows = (rows, key, dir) => {
  if (!key || !rows) return rows;
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    let cmp;
    if (typeof va === "number" && typeof vb === "number") {
      cmp = va - vb;
    } else {
      cmp = String(va ?? "").localeCompare(String(vb ?? ""), "es");
    }
    return dir === "asc" ? cmp : -cmp;
  });
};

// Por el tipo guardado, no por el texto del motivo.
const expenseType = (e) =>
  e.product_id ? "Compra" : e.category === "supplier" ? "Pago de mercancía" : "Salida";

const statusBadge = (s) => {
  if (s.pending) {
    return (
      <Badge variant="outline" className="whitespace-nowrap border-warning/60 bg-warning/10 text-foreground">
        {s.pending === "conflict" ? "En revisión" : "Por subir"}
      </Badge>
    );
  }
  if (s.status === "cancelado") {
    return (
      <Badge variant="outline" className="whitespace-nowrap border-destructive/50 text-destructive">
        Cancelado
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="whitespace-nowrap border-emerald-500/60 text-emerald-600 dark:border-emerald-400/50 dark:text-emerald-400"
    >
      Completado
    </Badge>
  );
};

const methodChip = (pm) => {
  const meta = methodMeta[pm] || { label: pm || "—", icon: Banknote, cls: "text-muted-foreground" };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
      <Icon size={16} className={meta.cls} />
      {meta.label}
    </span>
  );
};

// Detalle de venta: forma de pago en grande, con su color por significado
// (efectivo entra a la caja, tarjeta/transferencia al banco, fiado a cuenta).
const PAY_BADGE = {
  cash: "bg-success/12 text-success",
  card: "bg-brand/10 text-brand dark:bg-chart-2/15 dark:text-chart-2",
  transfer: "bg-brand/10 text-brand dark:bg-chart-2/15 dark:text-chart-2",
  credit: "bg-warning/15 text-amber-700 dark:text-warning",
};
const PayBadge = ({ sale }) => {
  const meta = methodMeta[sale.payment_method] || { label: sale.payment_method || "—", icon: Banknote };
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-3 text-[13px] font-bold",
        PAY_BADGE[sale.payment_method] || "bg-muted text-muted-foreground",
      )}
    >
      <Icon size={16} />
      {meta.label}
      {sale.payment_method === "credit" && sale.customer_name ? ` · ${sale.customer_name}` : ""}
    </span>
  );
};
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
// Cómo quedó la venta (lo que se ve bajo el título).
const saleState = (sale, items) => {
  if (sale.pending) return { label: sale.pending === "conflict" ? "En revisión" : "Por subir", cls: "bg-warning/15 text-amber-700 dark:text-warning" };
  if (sale.status === "cancelado") return { label: "Cancelada", cls: "bg-destructive/10 text-destructive" };
  const returned = items.filter((it) => it.status === "cancelado" || Number(it.returned_qty || 0) > 0).length;
  if (returned > 0) {
    return {
      label: "Completada con devolución",
      detail: `${returned} ${returned === 1 ? "producto devuelto" : "productos devueltos"}`,
      cls: "bg-warning/15 text-amber-700 dark:text-warning",
    };
  }
  return { label: "Completada", cls: "bg-success/12 text-success" };
};
const qtyText = (q, isW) => (isW ? `${round3(q)} kg` : `${round3(q)}`);

const SaleRow = memo(function SaleRow({ sale, onOpenDetail }) {
  const isCanceled = sale.status === "cancelado";
  return (
    <TableRow key={sale.id}>
      <TableCell className="px-4 py-3">
        <span className="text-sm font-semibold text-foreground">
          {sale.folio || `#${sale.id}`}
        </span>
        {sale.matching_items?.length > 0 && (
          <ul className="mt-1.5 w-40 space-y-1.5 text-xs text-muted-foreground sm:w-52">
            {sale.matching_items.map((item) => (
              <li key={item.id}>
                <span className="block break-words font-semibold text-foreground">{item.name || "Producto"}</span>
                <span className="tabular-nums">
                  {qtyText(item.quantity, item.sale_unit === "weight")} · {fmtMoney(item.quantity * item.price)}
                </span>
                {(isCanceled || item.status === "cancelado") ? (
                  <span className="block text-destructive">Partida cancelada</span>
                ) : item.returned_qty > 0 && (
                  <span className="block">Devuelto {qtyText(item.returned_qty, item.sale_unit === "weight")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">{formatMXDate(sale.created_at)}</p>
        <p className="text-xs text-muted-foreground">{formatMXTime(sale.created_at)}</p>
      </TableCell>
      <TableCell className="px-4 py-3">
        <span className="text-sm text-foreground">{sale.cashier_name || "—"}</span>
      </TableCell>
      <TableCell className="px-4 py-3">
        <span className="text-sm text-foreground">
          {sale.device_name || sale.device_code || "—"}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3">{methodChip(sale.payment_method)}</TableCell>
      <TableCell className="px-4 py-3">{statusBadge(sale)}</TableCell>
      <TableCell className="px-4 py-3 text-right">
        <span
          className={cn(
            "text-sm font-bold tabular-nums",
            isCanceled ? "line-through text-muted-foreground" : "text-foreground",
          )}
        >
          {fmtMoney(sale.total)}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex justify-center">
          <Hint label="Ver detalle">
            <Button
              variant="outline"
              size="icon"
              aria-label="Ver detalle de la venta"
              onClick={() => onOpenDetail(sale.id, sale.matching_items)}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </Hint>
        </div>
      </TableCell>
    </TableRow>
  );
});

const ExpenseRow = memo(function ExpenseRow({ expense }) {
  const isCanceled = expense.status === "cancelado";
  return (
    <TableRow>
      <TableCell className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">{formatMXDate(expense.created_at)}</p>
        <p className="text-xs text-muted-foreground">{formatMXTime(expense.created_at)}</p>
      </TableCell>
      <TableCell className="px-4 py-3">
        <span className={cn("text-sm text-foreground", isCanceled && "line-through text-muted-foreground")}>
          {expense.reason || "—"}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3">
        <Badge
          variant="outline"
          className={cn(
            "whitespace-nowrap",
            isCanceled
              ? "border-destructive/50 text-destructive"
              : "border-red-500/50 text-red-600 dark:border-red-400/50 dark:text-red-400",
          )}
        >
          {expenseType(expense)}
        </Badge>
      </TableCell>
      <TableCell className="px-4 py-3">{statusBadge(expense)}</TableCell>
      <TableCell className="px-4 py-3 text-right">
        <span className={cn("text-sm font-bold tabular-nums", isCanceled ? "line-through text-muted-foreground" : "text-red-600 dark:text-red-400")}>
          -{fmtMoney(expense.amount)}
        </span>
      </TableCell>
    </TableRow>
  );
});

// Reimpresión con la MISMA plantilla del ticket de venta (logo, notas, ancho
// del rollo). Recibido/cambio no se guardan en la venta, así que se omiten.
const printSaleTicket = async (saleDetail, saleItems, setPrinting, setError) => {
  if (!saleDetail) return;
  setPrinting(true);
  try {
    const get = (key) => window.api.invoke("get-setting", key);
    const [storeName, storeLogo, headerNote, footerNote, paperWidthMm] =
      await Promise.all([
        get("store_name"),
        get("store_logo"),
        get("print_header_note"),
        get("print_footer_note"),
        get("paper_width_mm"),
      ]);
    const items = (saleItems || []).map((it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price_at_sale || 0);
      const fullName = it.name || it.product_name || "Producto";
      return {
        name: fullName.length > 24 ? fullName.substring(0, 22) + ".." : fullName,
        qtyDisplay: qty,
        unit: "",
        unitPrice: price,
        baseUnitPrice: it.base_price_at_sale,
        lineTotal: qty * price,
        promoLabel: it.discount_label_at_sale,
        discountLabel: !it.discount_label_at_sale && Number(it.discount_percent) > 0
          ? `-${it.discount_percent}%` : null,
      };
    });
    const discountTotal = Number(saleDetail.discount_total ?? 0);
    const total = Number(saleDetail.total || 0);
    const hasOriginalPrices = saleItems.length > 0 && saleItems.every(
      (it) => it.base_price_at_sale != null && !it.returned_qty && it.status !== "cancelado",
    );
    const subtotal = discountTotal > 0 && hasOriginalPrices
      ? items.reduce((sum, it) => sum + it.baseUnitPrice * it.qtyDisplay, 0)
      : total + discountTotal;
    const html = buildReceiptHTML({
      store: {
        name: (storeName || "MI TIENDA").toUpperCase(),
        logo: await prepareTicketLogo(storeLogo),
      },
      headerNote: headerNote || "",
      footerNote: footerNote || "",
      ticketNum: saleDetail.folio || saleDetail.id,
      date: new Date(saleDetail.created_at),
      cashierName: saleDetail.cashier_name || "Usuario",
      items,
      subtotal,
      showDiscounts: discountTotal > 0,
      discountTotal,
      cashRounding: saleDetail.payment_method === "cash" ? total + discountTotal - subtotal : 0,
      total,
      methodLabel: (
        methodNames[saleDetail.payment_method] || saleDetail.payment_method || ""
      ).toUpperCase(),
      paperWidthMm: paperWidthMm ?? 58,
    });
    const res = await window.api.invoke("print-receipt", html);
    if (res && !res.success) setError(res.error || "No se pudo imprimir el ticket");
  } catch (e) {
    setError(e.message);
  } finally {
    setPrinting(false);
  }
};

const exportCSV = (sales, expenses, dateRange) => {
  if (!sales.length && !expenses.length) return;
  const header = ["Tipo", "ID", "Fecha", "Concepto", "Método", "Estado", "Monto"].join(",");
  const rows = [
    ...sales.map((s) =>
      [
        "Venta",
        s.id,
        `"${formatMXDateTime(s.created_at)}"`,
        `"${s.cashier_name || ""}"`,
        methodNames[s.payment_method] || s.payment_method || "",
        s.status || "completado",
        Number(s.total || 0).toFixed(2),
      ].join(","),
    ),
    ...expenses.map((e) =>
      [
        "Egreso",
        e.id,
        `"${formatMXDateTime(e.created_at)}"`,
        `"${e.reason || ""}"`,
        "",
        e.status || "activo",
        `-${Number(e.amount || 0).toFixed(2)}`,
      ].join(","),
    ),
  ];
  const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transacciones-${dateRange.from}-a-${dateRange.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const buildTransactionsPDF = async (sales, expenses, total, totalExpenses, count, canceledSales, rangeLabel) => {
  const store = (await window.api.invoke("get-setting", "store_name")) || "MI TIENDA";
  const { jsPDF, interFontInline } = await loadPdfToolchain();
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;

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

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...C.ink);
  doc.text(store.toUpperCase(), pageW / 2, 22, { align: "center" });
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.setTextColor(...C.muted);
  doc.text(`Reporte de Transacciones — ${rangeLabel}`, pageW / 2, 29, {
    align: "center",
  });
  doc.setDrawColor(...C.brand);
  doc.setLineWidth(0.8);
  doc.line(margin, 33, pageW - margin, 33);

  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...C.ink);
  doc.text("RESUMEN", margin, 44);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  let yy = 52;
  const colR = pageW / 4;
  const cols = [
    { x: margin + colR / 2, label: "Total Ventas", value: fmtMoney(total) },
    { x: margin + colR * 1.5, label: "Egresos", value: fmtMoney(totalExpenses) },
    { x: margin + colR * 2.5, label: "Ventas", value: String(count) },
    { x: margin + colR * 3.5, label: "Canceladas", value: String(canceledSales.length) },
  ];
  doc.setFont(undefined, "bold");
  doc.setTextColor(...C.muted);
  cols.forEach((c) => doc.text(c.label, c.x, yy, { align: "center" }));
  yy += 6;
  doc.setFontSize(16);
  doc.setTextColor(...C.ink);
  cols.forEach((c) => doc.text(c.value, c.x, yy, { align: "center" }));

  yy += 10;
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.3);
  doc.line(margin, yy, pageW - margin, yy);
  yy += 6;

  const buildTable = (title, head, body, startY, foot, columnStyles) => {
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);
    doc.text(title, margin, startY);
    let table = null;
    if (body.length > 0) {
      table = doc.autoTable({
        head,
        body,
        startY: startY + 4,
        margin: { left: margin, right: margin },
        styles: { font: fontName, fontSize: 9, cellPadding: 3, textColor: C.body, lineColor: C.grid, lineWidth: 0.4 },
        headStyles: { fillColor: C.head, textColor: C.ink, fontStyle: "bold" },
        footStyles: { fillColor: C.head, textColor: C.ink, fontStyle: "bold" },
        columnStyles,
        foot,
      });
    }
    return table ? doc.lastAutoTable.finalY + 10 : startY + 10;
  };

  const saleData = sales
    .filter((s) => s.status !== "cancelado")
    .map((s) => [
      `#${s.id}`,
      formatMXDateTime(s.created_at),
      methodNames[s.payment_method] || s.payment_method || "",
      fmtMoney(s.total),
    ]);
  let nextY = buildTable(
    "VENTAS DEL PERÍODO",
    [["Venta", "Fecha", "Método", "Total"]],
    saleData,
    yy,
    saleData.length > 0
      ? [[{ content: `TOTAL: ${fmtMoney(total)}`, colSpan: 4, styles: { halign: "center" } }]]
      : undefined,
    { 3: { halign: "right" } },
  );

  const expData = expenses
    .filter((e) => e.status !== "cancelado")
    .map((e) => [
      formatMXDateTime(e.created_at),
      e.reason || "",
      expenseType(e),
      `-${fmtMoneyAbs(e.amount)}`,
    ]);
  nextY = buildTable(
    "EGRESOS DEL PERÍODO",
    [["Fecha", "Descripción", "Tipo", "Monto"]],
    expData,
    nextY,
    expData.length > 0
      ? [[{ content: `TOTAL EGRESOS: ${fmtMoney(totalExpenses)}`, colSpan: 4, styles: { halign: "center" } }]]
      : undefined,
    { 3: { halign: "right" } },
  );

  const totalPages = doc.getNumberOfPages();
  const bottomY = doc.internal.pageSize.getHeight() - 12;
  for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
    doc.setPage(pageIdx);
    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...C.muted);
    doc.text(
      `Generado el ${new Date().toLocaleString("es-MX")}`,
      margin,
      bottomY,
    );
    doc.text(`Página ${pageIdx} de ${totalPages}`, pageW / 2, bottomY, {
      align: "center",
    });
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);
    doc.text("Vendia", pageW - margin, bottomY, { align: "right" });
  }

  return doc;
};

const exportPDF = async (sales, expenses, total, totalExpenses, count, canceledSales, dateRange, rangeLabel) => {
  const doc = await buildTransactionsPDF(
    sales,
    expenses,
    total,
    totalExpenses,
    count,
    canceledSales,
    rangeLabel,
  );
  doc.save(`transacciones-${dateRange.from}-a-${dateRange.to}.pdf`);
};

const printReport = async (sales, expenses, total, totalExpenses, count, canceledSales, rangeLabel) => {
  const doc = await buildTransactionsPDF(
    sales,
    expenses,
    total,
    totalExpenses,
    count,
    canceledSales,
    rangeLabel,
  );
  await printDocument(doc);
};

const Transacciones = () => {
  const initialLoadRef = useRef(true);
  const [sales, setSales] = useState([]);
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState(0);
  const [byMethod, setByMethod] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [loading, setLoading] = useState(true);
  const rowsClass = useRowsEntering(loading);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchedSales, setSearchedSales] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [method, setMethod] = useState("");
  const [activeTab, setActiveTab] = useState("ventas");
  const [dateRange, setDateRange] = useState(() => {
    const today = mxToday();
    return { from: today, to: today };
  });
  const [page, setPage] = useState(0);
  const [expPage, setExpPage] = useState(0);
  const [saleSortKey, setSaleSortKey] = useState(null);
  const [saleSortDir, setSaleSortDir] = useState("asc");
  const [expSortKey, setExpSortKey] = useState(null);
  const [expSortDir, setExpSortDir] = useState("desc");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [matchedItemIds, setMatchedItemIds] = useState([]);
  const [printing, setPrinting] = useState(false);
  // Regla 5 · venta/gasto nuevo (aquí o en otra caja) NO mueve la tabla
  // debajo del usuario: aparece el chip y él decide cuándo refrescar.
  const [freshData, setFreshData] = useState(false);
  useDbChanges(
    () => setFreshData(true),
    ["sales", "cash_register_expenses"],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const salesSearch = activeTab === "ventas" ? debouncedSearch : "";
  const filterSales = activeTab === "ventas" && Boolean(salesSearch || method);
  useEffect(() => {
    let active = true;
    setSearchError("");
    if (!filterSales) {
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    setPage(0);
    window.api.invoke("get-sales-by-range", {
      startDate: dateRange?.from || undefined,
      endDate: dateRange?.to || undefined,
      search: salesSearch,
      method,
      listOnly: true,
    }).then((result) => {
      if (!result?.success) throw new Error(result?.error || "No se pudieron buscar las ventas.");
      if (active) setSearchedSales(result.sales || []);
    }).catch((error) => {
      if (active) {
        setSearchedSales([]);
        setSearchError(error.message);
      }
    }).finally(() => {
      if (active) setSearchLoading(false);
    });
    return () => { active = false; };
  }, [dateRange?.from, dateRange?.to, filterSales, method, salesSearch, searchRevision]);

  const load = useCallback(async () => {
    const skipFlash = initialLoadRef.current;
    if (!skipFlash) setLoading(true);
    setError(null);
    try {
      const params = {};
      if (dateRange?.from) params.startDate = dateRange.from;
      if (dateRange?.to) params.endDate = dateRange.to;
      const [saleRes, expenseRes] = await Promise.all([
        window.api.invoke("get-sales-by-range", params),
        window.api.invoke("get-expenses-by-range", params),
      ]);
      if (saleRes.success) {
        setSales(saleRes.sales || []);
        setTotal(saleRes.total || 0);
        setCount(saleRes.count || 0);
        setByMethod(saleRes.byMethod || []);
      } else {
        setError(saleRes.error || "No se pudieron cargar las ventas.");
        setSales([]);
        setTotal(0);
        setCount(0);
        setByMethod([]);
      }
      if (expenseRes.success) {
        setExpenses(expenseRes.expenses || []);
        setTotalExpenses(expenseRes.totalExpenses || 0);
      } else {
        setExpenses([]);
        setTotalExpenses(0);
      }
    } catch (e) {
      setError(e.message);
      setSales([]);
      setExpenses([]);
    } finally {
      initialLoadRef.current = false;
      setLoading(false);
      setPage(0);
      setExpPage(0);
    }
  }, [dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshNow = useCallback(() => {
    setFreshData(false);
    setSearchRevision((value) => value + 1);
    load();
  }, [load]);

  const applyRange = (range) => {
    if (range?.from || range?.to) {
      setDateRange(range);
    } else {
      setDateRange({ from: "", to: "" });
    }
    setPage(0);
    setExpPage(0);
  };

  const handleSaleSort = (k) => {
    if (saleSortKey === k) {
      setSaleSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSaleSortKey(k);
      setSaleSortDir("asc");
    }
  };

  const handleExpSort = (k) => {
    if (expSortKey === k) {
      setExpSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setExpSortKey(k);
      setExpSortDir("asc");
    }
  };

  const sortedSales = useMemo(
    () => sortRows(filterSales ? searchedSales : sales, saleSortKey, saleSortDir),
    [filterSales, sales, searchedSales, saleSortKey, saleSortDir],
  );

  const sortedExpenses = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = expenses.filter((e) => {
      if (!term) return true;
      return `${e.reason || ""} ${e.register_name || ""}`.toLowerCase().includes(term);
    });
    return sortRows(filtered, expSortKey, expSortDir);
  }, [expenses, search, expSortKey, expSortDir]);

  const canceledSales = useMemo(
    () => sales.filter((s) => s.status === "cancelado"),
    [sales],
  );

  const pagination = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(sortedSales.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const pageStart = currentPage * PAGE_SIZE;
    return {
      totalPages,
      currentPage,
      pageStart,
      pagedRows: sortedSales.slice(pageStart, pageStart + PAGE_SIZE),
    };
  }, [sortedSales, page]);

  const expPagination = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(sortedExpenses.length / PAGE_SIZE));
    const currentPage = Math.min(expPage, totalPages - 1);
    const pageStart = currentPage * PAGE_SIZE;
    return {
      totalPages,
      currentPage,
      pageStart,
      pagedRows: sortedExpenses.slice(pageStart, pageStart + PAGE_SIZE),
    };
  }, [sortedExpenses, expPage]);

  const {
    totalPages,
    currentPage,
    pageStart,
    pagedRows,
  } = pagination;

  const {
    totalPages: expTotalPages,
    currentPage: curExpPage,
    pageStart: expPageStart,
    pagedRows: pagedExpenses,
  } = expPagination;

  // Desde la paleta (Ctrl+K): { saleId } abre el detalle de esa venta.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const id = location.state?.saleId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    openDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const openDetail = useCallback(async (saleId, matches = []) => {
    setMatchedItemIds(matches.map((item) => item.id));
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await window.api.invoke("get-sale-details", saleId);
      setDetail(result.success ? result : null);
    } catch (e) {
      setDetail({ success: false, error: e.message });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const SortHead = ({ label, k, align = "left", active, dir, onSort }) => (
    <TableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap px-4 font-semibold text-foreground/75 hover:text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
      onClick={() => onSort(k)}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </span>
    </TableHead>
  );

  const saleDetail = detail?.sale ?? null;
  const saleItems = detail?.items ?? [];

  const rangeLabel = [dateRange.from, dateRange.to].filter(Boolean).join(" a ") || "sin rango";

  return (
    <div className="p-1">
      <PageHeader
        description="Historial de ventas y egresos"
        actions={
          <>
            {freshData && <FreshDataChip onClick={refreshNow} />}
            {!loading && (sales.length > 0 || expenses.length > 0) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FileDown className="h-4 w-4" />
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportCSV(sales, expenses, dateRange)}>
                  <FileSpreadsheet className="h-4 w-4" /> CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportPDF(sales, expenses, total, totalExpenses, count, canceledSales, dateRange, rangeLabel)}>
                  <FileDown className="h-4 w-4" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => printReport(sales, expenses, total, totalExpenses, count, canceledSales, rangeLabel)}>
                  <Printer className="h-4 w-4" /> Imprimir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          </>
        }
      />

      {!loading && error && (
        <div className="mb-4 flex w-full items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <CardSkeleton count={4} />
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            prominent
            hero
            gradient
            size="sm"
            icon={<CircleDollarSign />}
            label="Total ventas"
            value={fmtMoney(total)}
          />
          <StatCard
            prominent
            size="sm"
            icon={<Ban />}
            tone="destructive"
            label="Egresos"
            value={fmtMoney(totalExpenses)}
          />
          <StatCard
            prominent
            size="sm"
            icon={<ReceiptText />}
            tone="success"
            label="Ventas"
            value={String(count)}
          />
          <StatCard
            prominent
            size="sm"
            icon={<XCircle />}
            tone="warning"
            label="Canceladas"
            value={String(canceledSales.length)}
          />
        </div>
      )}

      {!loading && (byMethod || []).length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(byMethod || []).map((m) => {
            const meta = methodMeta[m.payment_method] || { label: m.payment_method || "—", icon: Banknote, cls: "text-muted-foreground" };
            const Icon = meta.icon;
            return (
              <button
                key={m.payment_method || "otros"}
                type="button"
                onClick={() => setMethod(method === m.payment_method ? "" : m.payment_method)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Icon size={14} className={meta.cls} />
                <span className="font-semibold text-foreground">{meta.label}</span>
                <span>{m.count} ventas</span>
                <span className="font-semibold text-foreground">{fmtMoney(m.total)}</span>
              </button>
            );
          })}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="gastos">Gastos</TabsTrigger>
        </TabsList>

      <div className="mb-5 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="tr-search">
              {activeTab === "gastos" ? "Buscar egreso" : "Buscar venta"}
            </Label>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="tr-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeTab === "gastos" ? "Descripción o caja" : "Producto, código, folio o cajero"}
                className="pl-10 rounded-lg"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-method">Método de pago</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="tr-method">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos</SelectItem>
                <SelectItem value="cash">Efectivo</SelectItem>
                <SelectItem value="card">Tarjeta</SelectItem>
                <SelectItem value="transfer">Transferencia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Rango de fechas</Label>
            <DateRangePicker
              value={dateRange}
              onApply={applyRange}
              placeholder="Rango de fechas"
              className="sm:w-full w-full"
            />
          </div>
        </div>
      </div>

        <TabsContent value="ventas" className="space-y-4">
          {searchError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {searchError}
            </p>
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHead label="Venta" k="id" active={saleSortKey === "id"} dir={saleSortDir} onSort={handleSaleSort} />
                  <SortHead label="Fecha" k="created_at" active={saleSortKey === "created_at"} dir={saleSortDir} onSort={handleSaleSort} />
                  <SortHead label="Cajero" k="cashier_name" active={saleSortKey === "cashier_name"} dir={saleSortDir} onSort={handleSaleSort} />
                  <TableHead>Caja</TableHead>
                  <SortHead label="Método" k="payment_method" active={saleSortKey === "payment_method"} dir={saleSortDir} onSort={handleSaleSort} />
                  <TableHead>Estado</TableHead>
                  <SortHead label="Total del ticket" k="total" align="right" active={saleSortKey === "total"} dir={saleSortDir} onSort={handleSaleSort} />
                  <TableHead className="text-center">Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody key={loading || searchLoading ? "cargando" : "lista"} className={rowsClass}>
                {loading || searchLoading ? (
                  Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-3 w-14" />
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="px-4 py-3 text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                      <TableCell className="px-4 py-3 text-center"><Skeleton className="mx-auto h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : sortedSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 px-4 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        {search || method ? (
                          <>
                            <SearchX size={32} className="opacity-40" />
                            <p className="text-sm">Sin resultados con los filtros aplicados</p>
                          </>
                        ) : (
                          <>
                            <ReceiptText size={32} className="opacity-40" />
                            <p className="text-sm">No hay ventas en el rango seleccionado</p>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((s) => (
                    <SaleRow key={s.id} sale={s} onOpenDetail={openDetail} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!loading && sortedSales.length > 0 && totalPages > 1 && (
            <Pagination className="mt-4">
              <PaginationInfo>
                Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sortedSales.length)} de{" "}
                {sortedSales.length}
              </PaginationInfo>
              <PaginationControls>
                <PaginationLabel>
                  Página {currentPage + 1} de {totalPages}
                </PaginationLabel>
                <PaginationButton
                  icon="prev"
                  label="Anterior"
                  disabled={currentPage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                />
                <PaginationButton
                  icon="next"
                  label="Siguiente"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                />
              </PaginationControls>
            </Pagination>
          )}
        </TabsContent>

        <TabsContent value="gastos" className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHead label="Fecha" k="created_at" active={expSortKey === "created_at"} dir={expSortDir} onSort={handleExpSort} />
                  <SortHead label="Descripción" k="reason" active={expSortKey === "reason"} dir={expSortDir} onSort={handleExpSort} />
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <SortHead label="Monto" k="amount" align="right" active={expSortKey === "amount"} dir={expSortDir} onSort={handleExpSort} />
                </TableRow>
              </TableHeader>
              <TableBody key={loading ? "cargando" : "lista"} className={rowsClass}>
                {loading ? (
                  Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-4 py-3">
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell className="px-4 py-3 text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : sortedExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-28 px-4 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        {search ? (
                          <>
                            <SearchX size={32} className="opacity-40" />
                            <p className="text-sm">Sin resultados con los filtros aplicados</p>
                          </>
                        ) : (
                          <>
                            <Ban size={32} className="opacity-40" />
                            <p className="text-sm">No hay egresos en el rango seleccionado</p>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedExpenses.map((e) => (
                    <ExpenseRow key={e.id} expense={e} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!loading && sortedExpenses.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Total egresos:{" "}
                <span className="font-bold text-red-600 dark:text-red-400">-{fmtMoney(totalExpenses)}</span>
              </p>
              {expTotalPages > 1 && (
                <Pagination>
                  <PaginationInfo>
                    Mostrando {expPageStart + 1}–{Math.min(expPageStart + PAGE_SIZE, sortedExpenses.length)} de{" "}
                    {sortedExpenses.length}
                  </PaginationInfo>
                  <PaginationControls>
                    <PaginationLabel>
                      Página {curExpPage + 1} de {expTotalPages}
                    </PaginationLabel>
                    <PaginationButton
                      icon="prev"
                      label="Anterior"
                      disabled={curExpPage === 0}
                      onClick={() => setExpPage((p) => Math.max(0, p - 1))}
                    />
                    <PaginationButton
                      icon="next"
                      label="Siguiente"
                      disabled={curExpPage >= expTotalPages - 1}
                      onClick={() => setExpPage((p) => Math.min(expTotalPages - 1, p + 1))}
                    />
                  </PaginationControls>
                </Pagination>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          {/* Encabezado de marca: título y estado a la izquierda, total y
              forma de pago a la derecha. */}
          <DialogHeader className="flex flex-row items-start justify-between gap-4 px-6 pb-4 pt-5 pr-14 text-left">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold">
                Venta {saleDetail ? (saleDetail.pending ? saleDetail.folio : `#${saleDetail.id}`) : "…"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {saleDetail
                  ? `${formatMXDate(saleDetail.created_at)} · ${formatMXTime(saleDetail.created_at)}${saleDetail.folio && !saleDetail.pending ? ` · folio ${saleDetail.folio}` : ""}`
                  : "Detalle de la transacción"}
              </DialogDescription>
              {saleDetail && !detailLoading && (() => {
                const st = saleState(saleDetail, saleItems);
                return (
                  <span className={cn("mt-2.5 inline-flex items-center gap-2 rounded-full py-1 pl-2.5 pr-3 text-[12.5px] font-bold", st.cls)}>
                    <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                    {st.label}
                    {st.detail && <span className="font-medium opacity-85">· {st.detail}</span>}
                  </span>
                );
              })()}
            </div>
            {saleDetail && !detailLoading && (
              <div className="shrink-0 text-right">
                <p className="text-[11.5px] text-muted-foreground">Total cobrado</p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    saleDetail.status === "cancelado" && "text-muted-foreground line-through",
                  )}
                >
                  {fmtMoney(saleDetail.total)}
                </p>
                <div className="mt-1.5">
                  <PayBadge sale={saleDetail} />
                </div>
              </div>
            )}
          </DialogHeader>
          <div className="h-px shrink-0 bg-border/70" aria-hidden="true" />

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {detailLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-56" />
              <div className="my-3" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !saleDetail ? (
            <p className="text-sm text-destructive">No se pudo cargar el detalle de la venta.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Cajero", saleDetail.cashier_name || "—"],
                  ["Caja", saleDetail.device_name || saleDetail.device_code || "—"],
                  ...(saleDetail.client_created_at && saleDetail.synced_at ? [
                    ["Cobro en caja", `${formatMXDate(saleDetail.client_created_at)} ${formatMXTime(saleDetail.client_created_at)}`],
                    ["Recibida en principal", `${formatMXDate(saleDetail.synced_at)} ${formatMXTime(saleDetail.synced_at)}`],
                  ] : []),
                  ["Cliente", saleDetail.customer_name || "Público general"],
                  [
                    "Productos",
                    `${saleItems.length} ${saleItems.length === 1 ? "producto" : "productos"}`,
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0 rounded-[10px] bg-muted/60 px-3 py-2">
                    <p className="text-[11px] font-semibold text-muted-foreground">{k}</p>
                    <p className="truncate text-[13px] font-semibold text-foreground">{v}</p>
                  </div>
                ))}
              </div>

              {saleDetail.status === "cancelado" && saleDetail.cancelled_by && (
                <p className="mt-3 rounded-[10px] bg-destructive/8 px-3 py-2 text-[12.5px] text-destructive">
                  Cancelada por <b>{saleDetail.cancelled_by}</b>
                  {saleDetail.cancelled_at
                    ? ` · ${formatMXDate(saleDetail.cancelled_at)} ${formatMXTime(saleDetail.cancelled_at)}`
                    : ""}
                </p>
              )}

              <div className="mt-3">
                {saleItems.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Sin artículos registrados</p>
                ) : (
                  saleItems.map((it, idx) => {
                    const isW = it.sale_unit === "weight";
                    const sold = round3(it.quantity);
                    const returned = round3(it.returned_qty);
                    const cancelled = it.status === "cancelado";
                    const active = cancelled ? 0 : round3(Math.max(0, sold - returned));
                    const disc = it.base_price_at_sale == null ? Number(it.discount_percent || 0) : 0;
                    const price = Number(it.price_at_sale || 0);
                    const savings = (Number(it.base_price_at_sale) - price) * active;
                    const full = price * sold * (1 - disc / 100);
                    const real = price * active * (1 - disc / 100);
                    const backQty = cancelled ? sold : returned;
                    const back = price * backQty * (1 - disc / 100);
                    return (
                      <div
                        key={it.id}
                        className={cn(
                          "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 py-2.5",
                          idx > 0 && "border-t",
                          matchedItemIds.includes(it.id) && "rounded-md bg-primary/10 px-2",
                        )}
                      >
                        <span className="flex size-10 items-center justify-center overflow-hidden rounded-[9px] bg-muted text-muted-foreground">
                          {it.image_path ? (
                            <img src={it.image_path} alt="" className="size-full bg-white object-contain" />
                          ) : (
                            <Package size={17} />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "truncate text-sm font-semibold text-foreground",
                              cancelled && "text-muted-foreground line-through",
                            )}
                          >
                            {it.name || it.product_name || "—"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground tabular-nums">
                            {qtyText(cancelled ? sold : active || sold, isW)} × {fmtMoney(price)}
                            {isW ? " el kg" : ""}
                            {disc > 0 ? ` · −${disc} %` : ""}
                            {it.barcode ? ` · ${it.barcode}` : ""}
                          </p>
                          {savings >= 0.005 && (
                            <p className="mt-0.5 text-xs text-success">
                              Antes {fmtMoney(it.base_price_at_sale)} por unidad · Ahorro {fmtMoney(savings)}
                              {it.discount_label_at_sale ? ` · ${it.discount_label_at_sale}` : ""}
                            </p>
                          )}
                          {backQty > 0 && (
                            <div className="mt-1.5 inline-flex items-start gap-2 rounded-[9px] bg-warning/12 px-2.5 py-1.5 text-xs">
                              <Undo2 size={14} className="mt-px shrink-0 text-amber-700 dark:text-warning" />
                              <div>
                                <b className="text-amber-700 dark:text-warning">
                                  {cancelled ? "Se devolvió todo" : `Devuelto ${qtyText(backQty, isW)}`} · −{fmtMoney(back)}
                                </b>
                                {(it.return_reason || it.cancelled_at || it.cancelled_by) && (
                                  <span className="block text-muted-foreground">
                                    {[
                                      it.return_reason,
                                      it.cancelled_at ? formatMXTime(it.cancelled_at) : null,
                                      it.cancelled_by,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-foreground">{fmtMoney(real)}</p>
                          {Math.abs(full - real) > 0.004 && (
                            <p className="text-[11.5px] text-muted-foreground line-through tabular-nums">
                              {fmtMoney(full)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {(() => {
                const lines = saleItems.reduce((acc, it) => {
                  const active =
                    it.status === "cancelado"
                      ? 0
                      : Math.max(0, round3(it.quantity) - round3(it.returned_qty));
                  return (
                    acc +
                    Number(it.price_at_sale || 0) * active *
                      (it.base_price_at_sale == null ? 1 - Number(it.discount_percent || 0) / 100 : 1)
                  );
                }, 0);
                const saleDiscount = Number(saleDetail.discount_total || 0);
                return (
                  <div className="mt-2 rounded-xl bg-muted/60 px-3.5 py-2.5 text-sm">
                    <div className="flex justify-between py-0.5">
                      <span className="text-muted-foreground">{saleDiscount > 0 ? "Productos con descuento aplicado" : "Productos"}</span>
                      <b className="tabular-nums">{fmtMoney(lines)}</b>
                    </div>
                    {saleDiscount > 0 && (
                      <div className="flex justify-between py-0.5">
                        <span className="text-muted-foreground">Ahorro registrado</span>
                        <b className="tabular-nums text-success">{fmtMoney(saleDiscount)}</b>
                      </div>
                    )}
                    <div className="mt-1.5 flex justify-between border-t pt-2 text-[15px] font-bold">
                      <span>Total cobrado</span>
                      <span className="tabular-nums">{fmtMoney(saleDetail.total)}</span>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t bg-muted/50 px-6 py-3">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Cerrar
            </Button>
            {!detailLoading && saleDetail && (
              <Button onClick={() => printSaleTicket(saleDetail, saleItems, setPrinting, setError)} disabled={printing}>
                <Printer className="h-4 w-4" />
                {printing ? "Imprimiendo..." : "Imprimir ticket"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Transacciones;



