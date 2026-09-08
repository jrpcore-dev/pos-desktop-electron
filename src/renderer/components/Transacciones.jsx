import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
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
  Printer,
  ReceiptText,
  Search,
  SearchX,
  XCircle,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import {
  formatMXDate,
  formatMXTime,
  formatMXDateTime,
  mxToday,
} from "../utils/dateUtils";
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
import {
  Pagination, PaginationInfo, PaginationControls, PaginationLabel, PaginationButton,
} from "./ui/pagination";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "./ui/tabs";
import { DateRangePicker } from "./ui/date-range-picker";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { Separator } from "./ui/separator";
import { CardSkeleton } from "./Skeletons";
import { cn } from "@/lib/utils";

applyPlugin(jsPDF);

const PAGE_SIZE = 20;

const methodMeta = {
  cash: { label: "Efectivo", icon: Banknote, cls: "text-emerald-600 dark:text-emerald-400" },
  card: { label: "Tarjeta", icon: CreditCard, cls: "text-indigo-500 dark:text-indigo-400" },
  transfer: { label: "Transferencia", icon: Landmark, cls: "text-amber-600 dark:text-amber-400" },
};

const methodNames = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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

const expenseType = (e) => (e.reason?.startsWith("Compra") ? "Compra" : "Retiro");

const statusBadge = (s) => {
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

const SaleRow = memo(function SaleRow({ sale, onOpenDetail }) {
  const isCanceled = sale.status === "cancelado";
  return (
    <TableRow key={sale.id}>
      <TableCell className="px-4 py-3">
        <span className="font-mono text-sm font-semibold text-foreground">#{sale.id}</span>
      </TableCell>
      <TableCell className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">{formatMXDate(sale.created_at)}</p>
        <p className="text-xs text-muted-foreground">{formatMXTime(sale.created_at)}</p>
      </TableCell>
      <TableCell className="px-4 py-3">
        <span className="text-sm text-foreground">{sale.cashier_name || "—"}</span>
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
          <Button
            variant="outline"
            size="icon"
            title="Ver detalle"
            onClick={() => onOpenDetail(sale.id)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});

const printSaleTicket = async (saleDetail, saleItems, setPrinting, setError) => {
  if (!saleDetail) return;
  setPrinting(true);
  try {
    const store = (await window.api.invoke("get-setting", "store_name")) || "MI TIENDA";
    const now = new Date(saleDetail.created_at);
    const items = saleItems || [];
    const lines = [];
    lines.push(`<div style="text-align:center;font-weight:bold;font-size:15px">${store}</div>`);
    lines.push(`<div style="text-align:center;font-size:10px">${now.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Mexico_City" })}<br>${now.toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}</div>`);
    lines.push(`<div class="sep"></div>`);
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cajero:</span><span>${saleDetail.cashier_name || "Usuario"}</span></div>`);
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Ticket #:</span><span>${saleDetail.id}</span></div>`);
    lines.push(`<div class="sep"></div>`);
    lines.push(`<div style="text-align:center;font-weight:bold;font-size:12px">DETALLE DE COMPRA</div>`);
    lines.push(`<div class="sep"></div>`);
    items.forEach((it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price_at_sale || 0);
      const name = (it.name || it.product_name || "Producto").length > 24
        ? (it.name || it.product_name || "Producto").substring(0, 22) + ".."
        : it.name || it.product_name || "Producto";
      lines.push(`<div style="font-weight:bold;font-size:12px">${name}</div>`);
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px"><span>${qty} x $${price.toFixed(2)}</span><span>$${(qty * price).toFixed(2)}</span></div>`);
      lines.push(`<div style="border-bottom:1px dotted #ccc;margin:3px 0"></div>`);
    });
    lines.push(`<div class="sep"></div>`);
    lines.push(`<div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px"><span>TOTAL:</span><span>$${Number(saleDetail.total || 0).toFixed(2)}</span></div>`);
    lines.push(`<div class="sep"></div>`);
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Metodo:</span><span><strong>${methodNames[saleDetail.payment_method] || saleDetail.payment_method}</strong></span></div>`);
    if ((saleDetail.discount_total ?? 0) > 0) {
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Descuento:</span><span>-$${Number(saleDetail.discount_total).toFixed(2)}</span></div>`);
    }
    lines.push(`<div class="sep"></div>`);
    lines.push(`<div style="text-align:center;font-weight:bold;font-size:13px">¡GRACIAS POR SU COMPRA!</div>`);
    lines.push(`<div style="height:20px"></div>`);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:58mm auto;margin:0}
      *{box-sizing:border-box}
      body{font-family:'Courier New',monospace;font-size:11px;margin:0 auto;padding:2px 2px;width:48mm;max-width:48mm;background:white;color:black;overflow-wrap:break-word}
      .sep{border-top:1px dashed #333;margin:5px 0}
    </style></head><body>${lines.join("")}</body></html>`;
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

const exportPDF = async (sales, expenses, total, totalExpenses, count, canceledSales, dateRange, rangeLabel) => {
  const store = (await window.api.invoke("get-setting", "store_name")) || "MI TIENDA";
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text(store.toUpperCase(), margin, 22);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.setTextColor(100);
  doc.text(`Reporte de Transacciones — ${rangeLabel}`, margin, 29);
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.8);
  doc.line(margin, 33, pageW - margin, 33);

  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  doc.setTextColor(30);
  doc.text("RESUMEN", margin, 44);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  let yy = 52;
  const colR = pageW / 4;
  const cols = [
    { x: margin + colR / 2, label: "Total Ventas", value: `$${total.toFixed(2)}` },
    { x: margin + colR * 1.5, label: "Egresos", value: `$${totalExpenses.toFixed(2)}` },
    { x: margin + colR * 2.5, label: "Ventas", value: String(count) },
    { x: margin + colR * 3.5, label: "Canceladas", value: String(canceledSales.length) },
  ];
  doc.setFont(undefined, "bold");
  cols.forEach((c) => doc.text(c.label, c.x, yy, { align: "center" }));
  yy += 6;
  doc.setFontSize(16);
  doc.setTextColor(37, 99, 235);
  cols.forEach((c) => doc.text(c.value, c.x, yy, { align: "center" }));

  yy += 10;
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(margin, yy, pageW - margin, yy);
  yy += 6;

  const buildTable = (title, head, body, startY, foot) => {
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.setTextColor(30);
    doc.text(title, margin, startY);
    let table = null;
    if (body.length > 0) {
      table = doc.autoTable({
        head,
        body,
        startY: startY + 4,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        footStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
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
      `$${s.total.toFixed(2)}`,
    ]);
  let nextY = buildTable(
    "VENTAS DEL PERÍODO",
    [["Venta", "Fecha", "Método", "Total"]],
    saleData,
    yy,
    saleData.length > 0
      ? [[{ content: `TOTAL: $${total.toFixed(2)}`, colSpan: 4, styles: { halign: "center" } }]]
      : undefined,
  );

  const expData = expenses
    .filter((e) => e.status !== "cancelado")
    .map((e) => [
      formatMXDateTime(e.created_at),
      e.reason || "",
      expenseType(e),
      `-$${Number(e.amount || 0).toFixed(2)}`,
    ]);
  nextY = buildTable(
    "EGRESOS DEL PERÍODO",
    [["Fecha", "Descripción", "Tipo", "Monto"]],
    expData,
    nextY,
    expData.length > 0
      ? [[{ content: `TOTAL EGRESOS: $${totalExpenses.toFixed(2)}`, colSpan: 4, styles: { halign: "center" } }]]
      : undefined,
  );

  doc.setFontSize(8);
  doc.setFont(undefined, "normal");
  doc.setTextColor(150);
  doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, margin, doc.internal.pageSize.getHeight() - 12);
  doc.setFont(undefined, "bold");
  doc.text("JRP POS", pageW - margin, doc.internal.pageSize.getHeight() - 12, { align: "right" });

  doc.save(`transacciones-${dateRange.from}-a-${dateRange.to}.pdf`);
};

const printReport = async (sales, expenses, byMethod, total, totalExpenses, count, canceledSales, rangeLabel) => {
  const store = (await window.api.invoke("get-setting", "store_name")) || "MI TIENDA";
  const win = window.open("", "_blank");
  const byMethodHtml = byMethod
    .map(
      (m) =>
        `<tr><td>${methodNames[m.payment_method] || m.payment_method}</td><td>${m.count}</td><td align="right">$${Number(m.total).toFixed(2)}</td></tr>`,
    )
    .join("");
  const salesHtml = sales
    .filter((s) => s.status !== "cancelado")
    .map(
      (s) =>
        `<tr><td>#${s.id}</td><td>${formatMXDateTime(s.created_at)}</td><td>${methodNames[s.payment_method] || s.payment_method}</td><td align="right">$${s.total.toFixed(2)}</td></tr>`,
    )
    .join("");
  const expensesHtml = expenses
    .filter((e) => e.status !== "cancelado")
    .map(
      (e) =>
        `<tr><td>${formatMXDateTime(e.created_at)}</td><td>${e.reason || ""}</td><td>${expenseType(e)}</td><td align="right">-$${Number(e.amount || 0).toFixed(2)}</td></tr>`,
    )
    .join("");
  win.document.write(`<!DOCTYPE html><html><head><title>Reporte de Transacciones</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;margin:30px 40px;color:#1e293b;font-size:13px}
      h1{font-size:22px;color:#1e3a5f;margin-bottom:2px;letter-spacing:0.5px}
      .subtitle{font-size:13px;color:#64748b;margin-top:0;margin-bottom:20px}
      hr{border:none;border-top:2px solid #2563eb;margin:15px 0}
      table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}
      th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left;font-weight:600}
      td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
      tr:nth-child(even){background:#f8fafc}
      .total-row td{background:#1e3a5f;color:#fff;font-weight:700;padding:8px 10px}
      .resumen-table td{padding:6px 10px;border:none;font-size:12px}
      .resumen-table tr:last-child td{border-top:2px solid #1e3a5f;font-weight:700;font-size:14px}
      .section-title{font-size:14px;font-weight:700;color:#1e3a5f;margin:18px 0 6px 0}
      .footer{text-align:center;margin-top:35px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}
      @media print{body{margin:0.5in} .no-print{display:none}}
    </style></head><body>
    <h1>${store.toUpperCase()}</h1>
    <p class="subtitle">Reporte de Transacciones — ${rangeLabel}</p>
    <hr>
    <div class="section-title">Resumen</div>
    <table class="resumen-table">
      <tr><td>Total Ventas</td><td align="right"><b>$${total.toFixed(2)}</b></td></tr>
      <tr><td>Egresos</td><td align="right"><b>$${totalExpenses.toFixed(2)}</b></td></tr>
      <tr><td>Ventas</td><td align="right"><b>${count}</b></td></tr>
      <tr><td>Canceladas</td><td align="right"><b>${canceledSales.length}</b></td></tr>
      <tr><td>Ticket Promedio</td><td align="right"><b>$${(count > 0 ? total / count : 0).toFixed(2)}</b></td></tr>
    </table>
    ${byMethodHtml ? `<div class="section-title">Desglose por método de pago</div>
    <table><tr><th>Método</th><th>Ventas</th><th>Total</th></tr>${byMethodHtml}</table>` : ""}
    <div class="section-title">Ventas del Período</div>
    <table><tr><th>#</th><th>Fecha</th><th>Método</th><th>Total</th></tr>
    ${salesHtml}
    <tr class="total-row"><td colspan="3">TOTAL VENTAS</td><td align="right">$${total.toFixed(2)}</td></tr>
    </table>
    <div class="section-title">Egresos del Período</div>
    <table><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Monto</th></tr>
    ${expensesHtml}
    <tr class="total-row"><td colspan="3">TOTAL EGRESOS</td><td align="right">-$${totalExpenses.toFixed(2)}</td></tr>
    </table>
    <div class="footer">Generado el ${new Date().toLocaleString("es-MX")} — JRP POS</div>
  </body></html>`);
  win.document.close();
  win.print();
};

const ExpenseRow = memo(function ExpenseRow({ expense }) {
  const isCanceled = expense.status === "cancelado";
  return (
    <TableRow key={expense.id}>
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

const Transacciones = () => {
  const initialLoadRef = useRef(true);
  const [sales, setSales] = useState([]);
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState(0);
  const [byMethod, setByMethod] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
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
  const [printing, setPrinting] = useState(false);

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

  const sortedSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = sales.filter((s) => {
      if (method && s.payment_method !== method) return false;
      if (!term) return true;
      const text = `${s.cashier_name || ""} #${s.id}`.toLowerCase();
      return text.includes(term);
    });
    return sortRows(filtered, saleSortKey, saleSortDir);
  }, [sales, search, method, saleSortKey, saleSortDir]);

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

  const openDetail = useCallback(async (saleId) => {
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
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Transacciones</h1>
          <p className="text-sm text-muted-foreground">Historial de ventas y egresos</p>
        </div>
        {!loading && (sales.length > 0 || expenses.length > 0) && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => printReport(sales, expenses, byMethod, total, totalExpenses, count, canceledSales, rangeLabel)}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={() => exportCSV(sales, expenses, dateRange)}>
              <FileSpreadsheet className="h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" onClick={() => exportPDF(sales, expenses, total, totalExpenses, count, canceledSales, dateRange, rangeLabel)}>
              <FileDown className="h-4 w-4" />
              PDF
            </Button>
          </div>
        )}
      </div>

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
          {[
            {
              label: "Total Ventas",
              value: fmtMoney(total),
              icon: CircleDollarSign,
              cls: "bg-primary/10 text-primary",
              hover: "hover:border-primary/40",
            },
            {
              label: "Egresos",
              value: fmtMoney(totalExpenses),
              icon: Ban,
              cls: "bg-red-500/10 text-red-600 dark:text-red-400",
              hover: "hover:border-red-500/40",
            },
            {
              label: "Ventas",
              value: String(count),
              icon: ReceiptText,
              cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              hover: "hover:border-emerald-500/40",
            },
            {
              label: "Canceladas",
              value: String(canceledSales.length),
              icon: XCircle,
              cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              hover: "hover:border-amber-500/40",
            },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                  s.hover,
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${s.cls}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                    {s.label}
                  </p>
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">{s.value}</p>
              </div>
            );
          })}
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
                placeholder={activeTab === "gastos" ? "Descripción o caja" : "Cajero o # de venta"}
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
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-transparent">
                  <SortHead label="Venta" k="id" active={saleSortKey === "id"} dir={saleSortDir} onSort={handleSaleSort} />
                  <SortHead label="Fecha" k="created_at" active={saleSortKey === "created_at"} dir={saleSortDir} onSort={handleSaleSort} />
                  <SortHead label="Cajero" k="cashier_name" active={saleSortKey === "cashier_name"} dir={saleSortDir} onSort={handleSaleSort} />
                  <SortHead label="Método" k="payment_method" active={saleSortKey === "payment_method"} dir={saleSortDir} onSort={handleSaleSort} />
                  <TableHead className="px-4 font-semibold text-foreground/75">Estado</TableHead>
                  <SortHead label="Monto" k="total" align="right" active={saleSortKey === "total"} dir={saleSortDir} onSort={handleSaleSort} />
                  <TableHead className="px-4 text-center font-semibold text-foreground/75">Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
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
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="px-4 py-3 text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                      <TableCell className="px-4 py-3 text-center"><Skeleton className="mx-auto h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : sortedSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 px-4 text-center">
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
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-transparent">
                  <SortHead label="Fecha" k="created_at" active={expSortKey === "created_at"} dir={expSortDir} onSort={handleExpSort} />
                  <SortHead label="Descripción" k="reason" active={expSortKey === "reason"} dir={expSortDir} onSort={handleExpSort} />
                  <TableHead className="px-4 font-semibold text-foreground/75">Tipo</TableHead>
                  <TableHead className="px-4 font-semibold text-foreground/75">Estado</TableHead>
                  <SortHead label="Monto" k="amount" align="right" active={expSortKey === "amount"} dir={expSortDir} onSort={handleExpSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Venta {saleDetail ? `#${saleDetail.id}` : "…"}</DialogTitle>
            <DialogDescription>Detalle de la transacción</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-56" />
              <div className="my-3" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
              <Skeleton className="h-9 w-32" />
            </div>
          ) : !saleDetail ? (
            <p className="text-sm text-destructive">No se pudo cargar el detalle de la venta.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Fecha</p>
                  <p className="font-medium text-foreground">{formatMXDate(saleDetail.created_at)} · {formatMXTime(saleDetail.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cajero</p>
                  <p className="font-medium text-foreground">{saleDetail.cashier_name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Método</p>
                  <p className="font-medium text-foreground">{methodChip(saleDetail.payment_method)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <p className="font-medium text-foreground">{statusBadge(saleDetail)}</p>
                </div>
                {(saleDetail.discount_total ?? 0) > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Descuento</p>
                    <p className="font-medium text-emerald-600 dark:text-emerald-400">
                      −{fmtMoney(saleDetail.discount_total)}
                    </p>
                  </div>
                )}
                {saleDetail.status === "cancelado" && saleDetail.cancelled_by && (
                  <div>
                    <p className="text-xs text-muted-foreground">Canceló</p>
                    <p className="font-medium text-foreground">
                      {saleDetail.cancelled_by}
                      {saleDetail.cancelled_at ? ` · ${formatMXDate(saleDetail.cancelled_at)} ${formatMXTime(saleDetail.cancelled_at)}` : ""}
                    </p>
                  </div>
                )}
              </div>

              <Separator className="my-4" />

              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-transparent">
                      <TableHead className="px-4 font-semibold text-foreground/75">Producto</TableHead>
                      <TableHead className="px-4 font-semibold text-foreground/75">Código</TableHead>
                      <TableHead className="px-4 text-right font-semibold text-foreground/75">Cant.</TableHead>
                      <TableHead className="px-4 text-right font-semibold text-foreground/75">Precio</TableHead>
                      <TableHead className="px-4 text-right font-semibold text-foreground/75">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {saleItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 px-4 text-center text-sm text-muted-foreground">
                          Sin artículos registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      saleItems.map((it) => {
                        const subTotal = (it.price_at_sale || 0) * (it.quantity || 0);
                        const canceledItem = it.status === "cancelado";
                        return (
                          <TableRow key={it.id}>
                            <TableCell className="px-4 py-2.5">
                              <span className={cn("text-sm text-foreground", canceledItem && "line-through text-muted-foreground")}>
                                {it.name || it.product_name || "—"}
                              </span>
                            </TableCell>
                            <TableCell className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                              {it.barcode || "—"}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 text-right text-sm tabular-nums text-foreground">
                              {it.quantity}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 text-right text-sm tabular-nums text-foreground">
                              {fmtMoney(it.price_at_sale)}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">
                              {fmtMoney(subTotal)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end pt-1">
                <div className="flex items-baseline justify-between gap-10 text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-base font-bold tabular-nums text-foreground">
                    {fmtMoney(saleDetail.total)}
                  </span>
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            {!detailLoading && saleDetail && (
              <Button variant="outline" onClick={() => printSaleTicket(saleDetail, saleItems, setPrinting, setError)} disabled={printing}>
                <Printer className="h-4 w-4" />
                {printing ? "Imprimiendo..." : "Imprimir ticket"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Transacciones;