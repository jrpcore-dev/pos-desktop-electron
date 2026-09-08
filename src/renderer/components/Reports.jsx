import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Banknote,
  ShoppingCart,
  Receipt,
  Percent,
  Wallet,
  ArrowDownToLine,
  Clock,
  Crown,
  TrendingUp,
  TrendingDown,
  Printer,
  Download,
  FileSpreadsheet,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Ban,
  X,
} from "lucide-react";
import {
  mxToday,
  formatMXDate,
  toUTC,
  getMXDateString,
} from "../utils/dateUtils";
import {
  AreaChart,
  Area,
  BarChart,
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
} from "recharts";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const methodLabels = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

const C = {
  primary: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  destructive: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
  muted: "hsl(var(--muted-foreground))",
};

const CHART_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
];

const UI_PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(var(--info))",
];

const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtCompact = (n) => {
  const v = Math.round(Number(n || 0));
  if (v >= 1000)
    return `$${
      v < 100000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(v / 1000)
    }k`;
  return `$${v}`;
};

const fmtUnits = (n) => {
  const v = Math.round(Number(n || 0));
  if (v >= 1000)
    return `${v < 100000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(v / 1000)}k`;
  return `${v}`;
};

const pctOf = (cur, prev) =>
  prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;

const toDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const parseDateStr = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const getWeekRange = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  const sunday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6
  );
  return { start: toDateStr(monday), end: toDateStr(sunday) };
};

const toEndExclusive = (endStr) => {
  const [y, m, d] = endStr.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + 1));
};

const prevRangeOf = (startDate, endDate) => {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const spanDays =
    Math.round((new Date(ey, em - 1, ed) - new Date(sy, sm - 1, sd)) / 86400000) +
    1;
  const prevEnd = new Date(sy, sm - 1, sd - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (spanDays - 1));
  return { start: toDateStr(prevStart), end: toDateStr(prevEnd) };
};

const peakHourOf = (sales) => {
  let best = null;
  const hours = {};
  for (const s of sales || []) {
    if (s.status === "cancelado") continue;
    const h = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Mexico_City",
        hour: "numeric",
        hour12: false,
      }).format(new Date(toUTC(s.created_at)))
    );
    hours[h] = (hours[h] || 0) + 1;
  }
  for (const [h, c] of Object.entries(hours))
    if (!best || c > best.count) best = { hour: Number(h), count: c };
  return best;
};

const categorizeExpenses = (expenses) => {
  const out = { compra: 0, retiro: 0, compraCount: 0, retiroCount: 0 };
  for (const e of expenses || []) {
    if (e.status === "cancelado") continue;
    const amt = Number(e.amount) || 0;
    if (e.reason.startsWith("Compra")) {
      out.compra += amt;
      out.compraCount += 1;
    } else {
      out.retiro += amt;
      out.retiroCount += 1;
    }
  }
  return out;
};

// ─── BADGE SEMÁNTICO DE VARIACIÓN ───────────────────────────
const Delta = ({ value, invert, suffix = "periodo anterior" }) => {
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1 gap-y-0 text-[0.7rem] font-bold leading-snug tabular-nums transition-colors",
        good ? "text-success" : "text-destructive"
      )}
    >
      {up ? (
        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0">{Math.abs(Math.round(value))}% vs. {suffix}</span>
    </span>
  );
};

// ─── TARJETA DE MÉTRICA CLAVE ───────────────────────────────
const MetricCard = ({ icon, label, value, sub, delta, invert, accent, loading }) => {
  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-3 p-4">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-28" />
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="group overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
            accent?.bg
          )}
        >
          <span className={accent?.text}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-lg font-bold leading-tight text-foreground tabular-nums">
            {value}
          </p>
          {typeof delta === "number" && (
            <Delta value={delta} invert={invert} />
          )}
          {sub && !delta && (
            <p className="truncate text-[0.7rem] text-muted-foreground">{sub}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// ─── TOOLTIP PERSONALIZADO PARA RECHARTS ────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-bold text-foreground">{label}</p>
      {payload.map((p) => (
        <p
          key={p.dataKey || p.name}
          className="flex items-center gap-2 pb-0.5 tabular-nums last:pb-0"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: p.color || p.payload?.fill || p.fill }}
          />
          <span className="min-w-14 text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-bold text-foreground">
            {fmtMoney(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
};

const UnitTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-bold text-foreground">{label}</p>
      {payload.map((p) => (
        <p
          key={p.dataKey || p.name}
          className="flex items-center gap-2 pb-0.5 tabular-nums last:pb-0"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: p.color || p.payload?.fill || p.fill }}
          />
          <span className="min-w-14 text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-bold text-foreground">
            {Number(p.value || 0).toLocaleString("es-MX")} uds
          </span>
        </p>
      ))}
    </div>
  );
};

const Reports = () => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    salesTotal: 0,
    salesCount: 0,
    avgTicket: 0,
    profit: 0,
    profitMargin: 0,
    expensesTotal: 0,
    expensesCount: 0,
    compra: 0,
    retiro: 0,
    compraCount: 0,
    retiroCount: 0,
    byMethod: [],
    peakHour: null,
    peakHourCount: 0,
    prevSales: 0,
    prevExpenses: 0,
    prevCount: 0,
  });

  // Calendario (Sheet flotante)
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(null);
  const [calendarData, setCalendarData] = useState({
    dailySales: {},
    dailyExpenses: {},
    salesTotal: 0,
    salesCount: 0,
    expensesTotal: 0,
    expensesCount: 0,
    profit: 0,
    prevSales: 0,
    prevExpenses: 0,
  });
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [dayKpi, setDayKpi] = useState({
    salesTotal: 0,
    salesCount: 0,
    expensesTotal: 0,
    expensesCount: 0,
  });
  const [dayLoading, setDayLoading] = useState(false);

  // Gráficas
  const [chartMode, setChartMode] = useState("semanal");
  const [chartRefDate, setChartRefDate] = useState(() => new Date());
  const [trendData, setTrendData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartBackMonth, setChartBackMonth] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [topLoading, setTopLoading] = useState(true);

  // ─── FECHA INICIAL (mes en curso) ─────────────────────────
  useEffect(() => {
    const today = mxToday();
    const [y, m] = today.split("-");
    setStartDate(`${y}-${m}-01`);
    setEndDate(today);
    setChartMode("mensual");
  }, []);

  useEffect(() => {
    if (!startDate) return;
    const [y, m] = startDate.split("-").map(Number);
    setCalendarDate(new Date(y, m - 1, 1));
  }, [startDate]);

  // ─── RESUMEN DEL PERÍODO (KPIs + donut + desgloses) ───────
  const fetchSummary = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    const prev = prevRangeOf(startDate, endDate);
    const [salesRes, expRes, prevSalesRes, prevExpRes] = await Promise.all([
      window.api.invoke("get-sales-by-range", { startDate, endDate }),
      window.api.invoke("get-expenses-by-range", { startDate, endDate }),
      window.api.invoke("get-sales-by-range", {
        startDate: prev.start,
        endDate: prev.end,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: prev.start,
        endDate: prev.end,
      }),
    ]);

    const salesTotal = salesRes.success ? salesRes.total || 0 : 0;
    const salesCount = salesRes.success ? salesRes.count || 0 : 0;
    const avgTicket = salesCount > 0 ? salesTotal / salesCount : 0;
    const expensesTotal = expRes.success ? expRes.totalExpenses || 0 : 0;
    const expenses = categorizeExpenses(
      expRes.success ? expRes.expenses : []
    );
    const prevSales = prevSalesRes.success ? prevSalesRes.total || 0 : 0;
    const prevExpenses = prevExpRes.success ? prevExpRes.totalExpenses || 0 : 0;
    const prevCount = prevSalesRes.success ? prevSalesRes.count || 0 : 0;
    const profit = salesTotal - expensesTotal;
    const peak = peakHourOf(salesRes.success ? salesRes.sales : []);

    setSummary({
      salesTotal,
      salesCount,
      avgTicket,
      profit,
      profitMargin: salesTotal > 0 ? (profit / salesTotal) * 100 : 0,
      expensesTotal,
      expensesCount: expRes.success ? expRes.count || 0 : 0,
      compra: expenses.compra,
      retiro: expenses.retiro,
      compraCount: expenses.compraCount,
      retiroCount: expenses.retiroCount,
      byMethod: (salesRes.success && salesRes.byMethod) || [],
      peakHour: peak ? peak.hour : null,
      peakHourCount: peak ? peak.count : 0,
      prevSales,
      prevExpenses,
      prevCount,
    });
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // ─── PRODUCTOS MÁS VENDIDOS (all-time) ────────────────────
  const fetchTopProducts = useCallback(async () => {
    setTopLoading(true);
    const res = await window.api.invoke("get-top-products");
    setTopProducts(Array.isArray(res) ? res : []);
    setTopLoading(false);
  }, []);

  useEffect(() => {
    fetchTopProducts();
  }, [fetchTopProducts]);

  // ─── CALENDARIO MENSUAL ────────────────────────────────────
  const fetchCalendarMonth = useCallback(async (refDate) => {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const mm = String(month + 1).padStart(2, "0");
    const dim = new Date(year, month + 1, 0).getDate();
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const prevMm = String(prevMonth + 1).padStart(2, "0");
    const prevDim = new Date(prevYear, prevMonth + 1, 0).getDate();
    const monthStart = `${year}-${mm}-01`;
    const monthEnd = `${year}-${mm}-${String(dim).padStart(2, "0")}`;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const nextMm = String(nextMonth + 1).padStart(2, "0");
    const monthEndPlus = `${nextYear}-${nextMm}-01`;
    const prevStart = `${prevYear}-${prevMm}-01`;
    const prevEnd = `${prevYear}-${prevMm}-${String(prevDim).padStart(2, "0")}`;

    setCalendarLoading(true);
    const [salesRes, expRes, prevSalesRes, prevExpRes] = await Promise.all([
      window.api.invoke("get-daily-sales-week", {
        startDate: monthStart,
        endDate: monthEndPlus,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: monthStart,
        endDate: monthEnd,
      }),
      window.api.invoke("get-sales-by-range", {
        startDate: prevStart,
        endDate: prevEnd,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: prevStart,
        endDate: prevEnd,
      }),
    ]);

    const dailySales = {};
    let salesTotal = 0;
    let salesCount = 0;
    if (salesRes.success) {
      (salesRes.rows || []).forEach((r) => {
        const t = Number(r.total) || 0;
        dailySales[r.date] = { total: t, count: Number(r.count) || 0 };
        salesTotal += t;
        salesCount += Number(r.count) || 0;
      });
    }
    const dailyExpenses = {};
    let expensesTotal = 0;
    let expensesCount = 0;
    if (expRes.success) {
      (expRes.expenses || []).forEach((e) => {
        if (e.status === "cancelado") return;
        const dk = getMXDateString(e.created_at);
        dailyExpenses[dk] = (dailyExpenses[dk] || 0) + (Number(e.amount) || 0);
        expensesTotal += Number(e.amount) || 0;
        expensesCount += 1;
      });
    }

    setCalendarData({
      dailySales,
      dailyExpenses,
      salesTotal,
      salesCount,
      expensesTotal,
      expensesCount,
      profit: salesTotal - expensesTotal,
      prevSales: prevSalesRes.success ? prevSalesRes.total || 0 : 0,
      prevExpenses: prevExpRes.success ? prevExpRes.totalExpenses || 0 : 0,
    });
    setCalendarLoading(false);
  }, []);

  useEffect(() => {
    if (calendarOpen) fetchCalendarMonth(calendarDate);
  }, [calendarOpen, calendarDate, fetchCalendarMonth]);

  // ─── KPI DEL DÍA SELECCIONADO ──────────────────────────────
  const fetchDayKpi = useCallback(async (day) => {
    setDayLoading(true);
    const [salesRes, expRes] = await Promise.all([
      window.api.invoke("get-sales-by-date", { date: day }),
      window.api.invoke("get-expenses-by-date", { date: day }),
    ]);
    setDayKpi({
      salesTotal: salesRes.success ? salesRes.total || 0 : 0,
      salesCount: salesRes.success ? salesRes.count || 0 : 0,
      expensesTotal: expRes.success ? expRes.totalExpenses || 0 : 0,
      expensesCount: expRes.success ? expRes.count || 0 : 0,
    });
    setDayLoading(false);
  }, []);

  useEffect(() => {
    if (selectedDay) fetchDayKpi(selectedDay);
  }, [selectedDay, fetchDayKpi]);

  // ─── TENDENCIA (Área + ComposedChart) ──────────────────────
  const fetchTrend = useCallback(async (refDate, mode) => {
    setChartLoading(true);
    let start, end;
    if (mode === "semanal") {
      const r = getWeekRange(refDate);
      start = r.start;
      end = r.end;
    } else {
      const y = refDate.getFullYear();
      const m = refDate.getMonth();
      const dim = new Date(y, m + 1, 0).getDate();
      start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      end = `${y}-${String(m + 1).padStart(2, "0")}-${String(dim).padStart(2, "0")}`;
    }
    const [salesRes, expRes] = await Promise.all([
      window.api.invoke("get-daily-sales-week", {
        startDate: start,
        endDate: toEndExclusive(end),
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: start,
        endDate,
      }),
    ]);

    const dayMap = {};
    if (salesRes.success)
      (salesRes.rows || []).forEach(
        (r) =>
          (dayMap[r.date] = { ventas: Number(r.total) || 0, count: Number(r.count) || 0 })
      );
    const expMap = {};
    if (expRes.success)
      (expRes.expenses || []).forEach((e) => {
        if (e.status === "cancelado") return;
        const dk = getMXDateString(e.created_at);
        expMap[dk] = (expMap[dk] || 0) + (Number(e.amount) || 0);
      });

    if (mode === "semanal") {
      const [sy, sm, sd] = start.split("-").map(Number);
      const monday = new Date(sy, sm - 1, sd);
      const today = mxToday();
      const pts = DAY_LABELS.map((label, i) => {
        const d = new Date(
          monday.getFullYear(),
          monday.getMonth(),
          monday.getDate() + i
        );
        const ds = toDateStr(d);
        const v = dayMap[ds]?.ventas || 0;
        const g = expMap[ds] || 0;
        return { label, ventas: v, gastos: g, utilidad: v - g, isToday: ds === today };
      });
      setTrendData(pts);
    } else {
      const [y, m] = start.split("-").map(Number);
      const dim = new Date(y, m, 0).getDate();
      const buckets = [];
      for (let d = 1; d <= dim; d++) {
        const ds = `${start.slice(0, 8)}${String(d).padStart(2, "0")}`;
        const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
        if (dow === 0 || buckets.length === 0) buckets.push([]);
        buckets[buckets.length - 1].push({
          ds,
          v: dayMap[ds]?.ventas || 0,
          g: expMap[ds] || 0,
        });
      }
      const pts = buckets.map((wk, i) => {
        const ventas = wk.reduce((s, x) => s + x.v, 0);
        const gastos = wk.reduce((s, x) => s + x.g, 0);
        return {
          label: `Sem ${i + 1}`,
          weekStart: wk[0].ds,
          ventas,
          gastos,
          utilidad: ventas - gastos,
        };
      });
      setTrendData(pts);
    }
    setChartLoading(false);
  }, []);

  useEffect(() => {
    fetchTrend(chartRefDate, chartMode);
  }, [chartMode, chartRefDate, fetchTrend]);

  const syncRangeWithChart = (d, mode) => {
    if (mode === "semanal") {
      const { start, end } = getWeekRange(d);
      setStartDate(start);
      setEndDate(end);
    } else {
      const y = d.getFullYear();
      const m = d.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      setStartDate(`${y}-${String(m + 1).padStart(2, "0")}-01`);
      setEndDate(`${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`);
    }
  };

  const navigateChart = (dir) => {
    const d = new Date(chartRefDate);
    if (chartMode === "semanal") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setChartRefDate(d);
    syncRangeWithChart(d, chartMode);
  };

  const formatChartTitle = () => {
    if (chartMode === "semanal") {
      const { start, end } = getWeekRange(chartRefDate);
      return `${formatMXDate(`${start}T12:00:00`, { day: "2-digit", month: "short" })} – ${formatMXDate(`${end}T12:00:00`, { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    return `${MONTH_NAMES[chartRefDate.getMonth()]} ${chartRefDate.getFullYear()}`;
  };

  const goCurrent = () => {
    if (chartMode === "semanal") {
      const today = new Date();
      setChartRefDate(today);
      syncRangeWithChart(today, "semanal");
    } else {
      const n = new Date();
      const ref = new Date(n.getFullYear(), n.getMonth(), 1);
      setChartRefDate(ref);
      syncRangeWithChart(ref, "mensual");
    }
    setChartBackMonth(null);
  };

  const handleWeekClick = (weekStart) => {
    if (chartMode !== "mensual" || !weekStart) return;
    setChartBackMonth({
      year: chartRefDate.getFullYear(),
      month: chartRefDate.getMonth(),
    });
    setChartMode("semanal");
    setChartRefDate(parseDateStr(weekStart));
    syncRangeWithChart(parseDateStr(weekStart), "semanal");
  };

  const backToMonth = () => {
    const ref =
      chartBackMonth
        ? new Date(chartBackMonth.year, chartBackMonth.month, 1)
        : new Date(chartRefDate.getFullYear(), chartRefDate.getMonth(), 1);
    setChartMode("mensual");
    setChartRefDate(ref);
    syncRangeWithChart(ref, "mensual");
    setChartBackMonth(null);
  };

  // ─── NAVEGACIÓN CALENDARIO ────────────────────────────────
  const prevMonth = () =>
    setCalendarDate(
      new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1)
    );
  const nextMonth = () =>
    setCalendarDate(
      new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1)
    );
  const goToday = () => {
    const n = new Date();
    setCalendarDate(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelectedDay(null);
  };

  const handleDayClick = (day) => {
    const dateStr = day instanceof Date ? toDateStr(day) : String(day);
    setSelectedDay(dateStr);
  };

  // ─── CELDA DEL CALENDARIO CON IMPORTES S/E ────────────────
  const CalendarDayButton = ({ day, modifiers, children, ...btnProps }) => {
    const ds = day.isoDate;
    const sTotal = calendarData.dailySales[ds]?.total || 0;
    const eTotal = calendarData.dailyExpenses[ds] || 0;
    const isSelected = !!modifiers.selected;
    const isToday = !!modifiers.today;
    const isOutside = !!day.outside;
    return (
      <button
        {...btnProps}
        className={cn(
          "relative flex h-16 w-full flex-col items-center justify-center gap-[3px] rounded-lg p-1 transition-colors duration-150",
          isSelected
            ? "bg-primary text-primary-foreground shadow-sm"
            : "hover:bg-accent/70",
          !isSelected && isToday && "font-bold ring-1 ring-inset ring-success",
          isOutside && "text-muted-foreground opacity-45",
          btnProps.className
        )}
      >
        <span
          className={cn(
            "text-[12px] leading-none tabular-nums",
            isSelected
              ? "font-bold text-primary-foreground"
              : isToday
                ? "font-extrabold text-success"
                : "font-semibold text-foreground"
          )}
        >
          {children}
        </span>
        <span className="flex flex-col items-center gap-[2px] leading-none">
          {sTotal > 0 && (
            <span
              className={cn(
                "text-[8.5px] font-bold tabular-nums",
                isSelected ? "text-primary-foreground/90" : "text-success"
              )}
            >
              +{fmtCompact(sTotal)}
            </span>
          )}
          {eTotal > 0 && (
            <span
              className={cn(
                "text-[8.5px] font-bold tabular-nums",
                isSelected ? "text-primary-foreground/90" : "text-destructive"
              )}
            >
              -{fmtCompact(eTotal)}
            </span>
          )}
          {sTotal === 0 && eTotal === 0 && (
            <span
              className={cn(
                "text-[8px]",
                isSelected ? "text-primary-foreground/40" : "text-muted-foreground/35"
              )}
            >
              —
            </span>
          )}
        </span>
      </button>
    );
  };

  const selectedDayDate = selectedDay ? parseDateStr(selectedDay) : undefined;
  const dayProfit = dayKpi.salesTotal - dayKpi.expensesTotal;

  // ─── EXPORTACIÓN ───────────────────────────────────────────
  const exportCSV = () => {
    if (!summary.salesTotal && !summary.expensesTotal) return;
    const rows = [];
    rows.push("REPORTE ANALITICO");
    rows.push(`Periodo,${startDate} a ${endDate}`);
    rows.push("");
    rows.push("RESUMEN");
    rows.push(`Ventas Totales,${summary.salesTotal.toFixed(2)}`);
    rows.push(`Transacciones,${summary.salesCount}`);
    rows.push(`Ticket Promedio,${summary.avgTicket.toFixed(2)}`);
    rows.push(`Gastos,${summary.expensesTotal.toFixed(2)}`);
    rows.push(`Utilidad Neta,${summary.profit.toFixed(2)}`);
    rows.push(`Margen,${summary.profitMargin.toFixed(1)}%`);
    rows.push(`Hora Pico,${summary.peakHour ?? "-"}:00 (${summary.peakHourCount} ventas)`);
    rows.push("");
    rows.push("METODOS DE PAGO");
    rows.push("Metodo,Ventas,Total");
    (summary.byMethod || []).forEach((m) =>
      rows.push(
        `${[methodLabels[m.payment_method] || m.payment_method, m.count, Number(m.total).toFixed(2)].join(",")}`
      )
    );
    rows.push("");
    rows.push("GASTOS POR TIPO");
    rows.push("Tipo,Cantidad,Total");
    rows.push(`Compras,${summary.compraCount},${summary.compra.toFixed(2)}`);
    rows.push(`Retiros,${summary.retiroCount},${summary.retiro.toFixed(2)}`);
    rows.push("");
    rows.push("PRODUCTOS MAS VENDIDOS");
    rows.push("Producto,Unidades");
    topProducts.slice(0, 10).forEach((p) => rows.push(`${p.name},${p.total_sold}`));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-analitico-${startDate}-a-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    const store = await window.api.invoke("get-setting", "store_name");
    const storeName = store || "MI TIENDA POS";
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 18;

    doc.setFontSize(18);
    doc.setFont(undefined, "bold");
    doc.text(storeName.toUpperCase(), margin, 22);
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.setTextColor(100);
    doc.text(`Reporte analítico — ${startDate} al ${endDate}`, margin, 29);

    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.8);
    doc.line(margin, 33, pageW - margin, 33);

    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.setTextColor(30);
    doc.text("RESUMEN", margin, 44);
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    let yy = 54;
    const cols = [
      ["Ventas", fmtMoney(summary.salesTotal)],
      ["Transacciones", String(summary.salesCount)],
      ["Ticket Prom.", fmtMoney(summary.avgTicket)],
      ["Gastos", fmtMoney(summary.expensesTotal)],
      ["Utilidad", fmtMoney(summary.profit)],
      ["Margen", `${summary.profitMargin.toFixed(1)}%`],
    ];
    const cw = (pageW - margin * 2) / 3;
    cols.forEach((c, i) => {
      const x = margin + (i % 3) * cw;
      const y = 54 + Math.floor(i / 3) * 16;
      doc.setFontSize(8);
      doc.setFont(undefined, "bold");
      doc.setTextColor(37, 99, 235);
      doc.text(c[0].toUpperCase(), x, y);
      doc.setFontSize(13);
      doc.setTextColor(30);
      doc.text(c[1], x, y + 6);
    });
    yy += 40;

    if (summary.byMethod.length > 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
      doc.setTextColor(30);
      doc.text("Métodos de pago", margin, yy);
      yy += 4;
      doc.autoTable({
        startY: yy + 3,
        head: [["Método", "Ventas", "Total"]],
        body: summary.byMethod.map((m) => [
          methodLabels[m.payment_method] || m.payment_method,
          String(m.count),
          `$${Number(m.total).toFixed(2)}`,
        ]),
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 250] },
      });
      yy = doc.lastAutoTable.finalY + 8;
    }

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("Gastos por tipo", margin, yy);
    yy += 4;
    doc.autoTable({
      startY: yy + 3,
      head: [["Tipo", "Cantidad", "Total"]],
      body: [
        ["Compras", String(summary.compraCount), `$${summary.compra.toFixed(2)}`],
        ["Retiros", String(summary.retiroCount), `$${summary.retiro.toFixed(2)}`],
      ],
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      foot: [
        [
          { content: "TOTAL", colSpan: 2, styles: { fontStyle: "bold", halign: "right" } },
          `$${summary.expensesTotal.toFixed(2)}`,
        ],
      ],
      footStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    });
    yy = doc.lastAutoTable.finalY + 8;

    if (topProducts.length > 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
      doc.text("Productos más vendidos", margin, yy);
      yy += 4;
      doc.autoTable({
        startY: yy + 3,
        head: [["Producto", "Unidades"]],
        body: topProducts.slice(0, 10).map((p, i) => [`${i + 1}. ${p.name}`, String(p.total_sold)]),
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 250] },
      });
      yy = doc.lastAutoTable.finalY + 8;
    }

    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.setTextColor(150);
    doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, margin, yy);
    doc.setFont(undefined, "bold");
    doc.text("JRP POS", pageW - margin, yy, { align: "right" });

    doc.save(`reporte-analitico-${startDate}-a-${endDate}.pdf`);
  };

  const printReport = async () => {
    const store = await window.api.invoke("get-setting", "store_name");
    const storeName = store || "MI TIENDA POS";
    const win = window.open("", "_blank");
    const methodRows = (summary.byMethod || [])
      .map(
        (m) =>
          `<tr><td>${methodLabels[m.payment_method] || m.payment_method}</td><td align="right">${m.count}</td><td align="right">$${Number(m.total).toFixed(2)}</td></tr>`
      )
      .join("");
    const productRows = topProducts
      .slice(0, 10)
      .map(
        (p, i) =>
          `<tr><td>${i + 1}. ${p.name}</td><td align="right">${p.total_sold}</td></tr>`
      )
      .join("");
    win.document.write(`<!DOCTYPE html><html lang="es"><head><title>Reporte analítico</title>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;margin:30px 40px;color:#1e293b;font-size:13px}
        h1{font-size:22px;color:#1e3a5f;margin-bottom:2px}
        .subtitle{color:#64748b;margin:0 0 20px}
        hr{border:none;border-top:2px solid #2563eb;margin:15px 0}
        table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}
        th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}
        td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
        tr:nth-child(even){background:#f8fafc}
        .kpis{display:flex;gap:8px;flex-wrap:wrap}
        .kpi{flex:1;min-width:120px;border:1px solid #e2e8f0;border-radius:8px;padding:10px}
        .kpi .t{font-size:10px;text-transform:uppercase;color:#64748b}
        .kpi .v{font-size:18px;font-weight:700;margin-top:2px}
        .section-title{font-size:14px;font-weight:700;color:#1e3a5f;margin:18px 0 6px}
        .footer{text-align:center;margin-top:35px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}
        @media print{body{margin:0.5in}}
      </style></head><body>
      <h1>${storeName.toUpperCase()}</h1>
      <p class="subtitle">Reporte analítico — ${startDate} al ${endDate}</p>
      <hr>
      <div class="kpis">
        <div class="kpi"><div class="t">Ventas</div><div class="v">$${summary.salesTotal.toFixed(2)}</div></div>
        <div class="kpi"><div class="t">Transacciones</div><div class="v">${summary.salesCount}</div></div>
        <div class="kpi"><div class="t">Ticket Prom.</div><div class="v">$${summary.avgTicket.toFixed(2)}</div></div>
        <div class="kpi"><div class="t">Gastos</div><div class="v">$${summary.expensesTotal.toFixed(2)}</div></div>
        <div class="kpi"><div class="t">Utilidad</div><div class="v">$${summary.profit.toFixed(2)}</div></div>
        <div class="kpi"><div class="t">Margen</div><div class="v">${summary.profitMargin.toFixed(1)}%</div></div>
      </div>
      ${methodRows ? `<div class="section-title">Métodos de pago</div>
      <table><tr><th>Método</th><th>Ventas</th><th>Total</th></tr>${methodRows}</table>` : ""}
      <div class="section-title">Gastos por tipo</div>
      <table>
        <tr><th>Tipo</th><th>Cantidad</th><th>Total</th></tr>
        <tr><td>Compras</td><td align="right">${summary.compraCount}</td><td align="right">$${summary.compra.toFixed(2)}</td></tr>
        <tr><td>Retiros</td><td align="right">${summary.retiroCount}</td><td align="right">$${summary.retiro.toFixed(2)}</td></tr>
        <tr><td colspan="2" align="right"><b>TOTAL</b></td><td align="right"><b>$${summary.expensesTotal.toFixed(2)}</b></td></tr>
      </table>
      ${productRows ? `<div class="section-title">Productos más vendidos</div>
      <table><tr><th>Producto</th><th>Unidades</th></tr>${productRows}</table>` : ""}
      <div class="footer">Generado el ${new Date().toLocaleString("es-MX")} — JRP POS</div>
    </body></html>`);
    win.document.close();
    win.print();
  };

  // ─── DATOS DERIVADOS PARA GRÁFICAS ─────────────────────────
  const pieData = (summary.byMethod || []).map((m, i) => ({
    name: methodLabels[m.payment_method] || m.payment_method,
    value: Number(m.total) || 0,
    count: m.count,
    fill: UI_PALETTE[i % UI_PALETTE.length],
  }));

  const bestProduct = topProducts[0] || null;
  const prodRows = topProducts.slice(0, 10);
  const hasTrend = trendData.length > 0;

  const totalUnits = topProducts.reduce((a, p) => a + (p.total_sold || 0), 0);

  const productDonut = (() => {
    if (totalUnits <= 0) return [];
    const rows = topProducts.slice(0, 6).map((p, i) => ({
      name: p.name,
      value: p.total_sold || 0,
      pct: ((p.total_sold || 0) / totalUnits) * 100,
      fill: CHART_PALETTE[i % CHART_PALETTE.length],
    }));
    const rest = topProducts
      .slice(6)
      .reduce((a, p) => a + (p.total_sold || 0), 0);
    if (rest > 0)
      rows.push({
        name: "Otros productos",
        value: rest,
        pct: (rest / totalUnits) * 100,
        fill: CHART_PALETTE[6 % CHART_PALETTE.length],
      });
    return rows;
  })();

  const catData = (() => {
    const map = {};
    for (const p of topProducts) {
      const key = p.category_name || "Sin categoría";
      map[key] = (map[key] || 0) + (p.total_sold || 0);
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name: name.length > 16 ? `${name.slice(0, 15)}…` : name,
        value,
        fill: CHART_PALETTE[i % CHART_PALETTE.length],
      }));
  })();

  const dateRangePickerValue =
    startDate && endDate ? { from: startDate, to: endDate } : null;

  const handleApplyRange = (r) => {
    let from;
    let to;
    if (r && r.from && r.to) {
      from = r.from;
      to = r.to;
    } else {
      const today = mxToday();
      const [y, m] = today.split("-");
      from = `${y}-${m}-01`;
      to = today;
    }
    setStartDate(from);
    setEndDate(to);
    const days = Math.round(
      (parseDateStr(to) - parseDateStr(from)) / 86400000
    );
    setChartMode(days <= 6 ? "semanal" : "mensual");
    setChartRefDate(parseDateStr(from));
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="animate-enter p-1">
        {/* ─── CABECERA ─────────────────────────────────────── */}
        <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Reportes y analítica
            </h1>
            <p className="text-sm text-muted-foreground">
              Dashboard de rendimiento del período{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {startDate} → {endDate}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={dateRangePickerValue}
              onApply={handleApplyRange}
              placeholder="Seleccionar período"
              className="h-9"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-foreground"
                  onClick={() => setCalendarOpen(true)}
                >
                  <CalendarDays className="h-4 w-4" />
                  Calendario
                </Button>
              </TooltipTrigger>
              <TooltipContent>Inspección diaria por calendario</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV}>
                  <FileSpreadsheet className="h-4 w-4" />
                  CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar CSV</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPDF}>
                  <Download className="h-4 w-4" />
                  PDF
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar PDF</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={printReport}>
                  <Printer className="h-4 w-4" />
                  Imprimir
                </Button>
              </TooltipTrigger>
              <TooltipContent>Imprimir reporte</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* ─── KPIs ─────────────────────────────────────────── */}
        <section className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            loading={loading}
            icon={<Banknote className="h-5 w-5" />}
            accent={{ bg: "bg-success/10", text: "text-success" }}
            label="Ventas totales"
            value={fmtMoney(summary.salesTotal)}
            delta={pctOf(summary.salesTotal, summary.prevSales)}
          />
          <MetricCard
            loading={loading}
            icon={<ShoppingCart className="h-5 w-5" />}
            accent={{ bg: "bg-primary/10", text: "text-primary" }}
            label="Transacciones"
            value={String(summary.salesCount)}
            delta={pctOf(summary.salesCount, summary.prevCount)}
          />
          <MetricCard
            loading={loading}
            icon={<Receipt className="h-5 w-5" />}
            accent={{ bg: "bg-warning/10", text: "text-warning" }}
            label="Ticket promedio"
            value={fmtMoney(summary.avgTicket)}
            delta={pctOf(
              summary.avgTicket,
              summary.prevCount > 0 ? summary.prevSales / summary.prevCount : 0
            )}
          />
          <MetricCard
            loading={loading}
            icon={<Wallet className="h-5 w-5" />}
            accent={{ bg: "bg-indigo-500/10", text: "text-indigo-500" }}
            label="Utilidad neta"
            value={fmtMoney(summary.profit)}
            delta={pctOf(
              summary.profit,
              summary.prevSales - summary.prevExpenses
            )}
          />
          <MetricCard
            loading={loading}
            icon={<Percent className="h-5 w-5" />}
            accent={{ bg: "bg-violet-500/10", text: "text-violet-500" }}
            label="Margen de ganancia"
            value={`${summary.profitMargin.toFixed(1)}%`}
            sub={`Utilidad sobre ${fmtMoney(summary.salesTotal)}`}
          />
          <MetricCard
            loading={loading}
            icon={<ArrowDownToLine className="h-5 w-5" />}
            accent={{ bg: "bg-destructive/10", text: "text-destructive" }}
            label="Gastos"
            value={fmtMoney(summary.expensesTotal)}
            delta={pctOf(summary.expensesTotal, summary.prevExpenses)}
            invert
            sub={`${summary.expensesCount} movimientos`}
          />
          <MetricCard
            loading={loading}
            icon={<Clock className="h-5 w-5" />}
            accent={{ bg: "bg-sky-500/10", text: "text-sky-500" }}
            label="Hora pico"
            value={
              summary.peakHour != null
                ? `${summary.peakHour}:00 – ${(summary.peakHour + 1) % 24}:00`
                : "—"
            }
            sub={
              summary.peakHour != null
                ? `${summary.peakHourCount} ventas en esa hora`
                : "Sin datos"
            }
          />
          <MetricCard
            loading={topLoading}
            icon={<Crown className="h-5 w-5" />}
            accent={{ bg: "bg-amber-500/10", text: "text-amber-500" }}
            label="Más vendido"
            value={bestProduct ? bestProduct.name : "—"}
            sub={
              bestProduct
                ? `${bestProduct.total_sold} unidades vendidas`
                : "Sin datos"
            }
          />

        </section>

        {/* ─── CONTROLES DE GRÁFICAS ────────────────────────── */}
        <section className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Tabs value={chartMode} onValueChange={(v) => setChartMode(v)}>
            <TabsList>
              <TabsTrigger value="semanal">Semanal</TabsTrigger>
              <TabsTrigger value="mensual">Mensual</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => navigateChart(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[150px] text-center text-xs font-semibold tabular-nums text-foreground">
              {formatChartTitle()}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => navigateChart(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="ml-1 text-xs" onClick={goCurrent}>
              {chartMode === "semanal" ? "Semana actual" : "Mes actual"}
            </Button>
            {chartBackMonth && chartMode === "semanal" && (
              <Button variant="link" size="sm" className="ml-1 text-xs" onClick={backToMonth}>
                Volver al mes
              </Button>
            )}
          </div>
        </section>

        {/* ─── GRÁFICAS ─────────────────────────────────────── */}
        <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Tendencia */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Tendencia de ventas</CardTitle>
              <CardDescription className="text-xs">
                {chartMode === "semanal" ? "Ventas por día de la semana" : "Ventas por semana del mes"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {chartLoading ? (
                <div className="flex h-[240px] items-end gap-2 p-3">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <Skeleton
                      key={i}
                      className="flex-1 rounded-t-md"
                      style={{ height: `${40 + ((i * 37) % 60)}%` }}
                    />
                  ))}
                </div>
              ) : hasTrend ? (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="gradVentas" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.primary} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={C.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} />
                      <YAxis fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCompact(v)} width={46} />
                      <ReTooltip content={ChartTooltip} />
                      <Area type="monotone" dataKey="ventas" name="Ventas" stroke={C.primary} strokeWidth={2.5} fill="url(#gradVentas)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<Receipt className="h-6 w-6" />}
                  title="Sin datos para mostrar"
                  description="No hay ventas registradas en este período"
                />
              )}
            </CardContent>
          </Card>

          {/* Distribución por método */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Distribución por método de pago</CardTitle>
              <CardDescription className="text-xs">
                Desglose de ingresos del período
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {loading ? (
                <div className="flex flex-col items-center gap-4 py-3">
                  <Skeleton className="h-[180px] w-[180px] rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : pieData.length > 0 ? (
                <>
                  <div className="relative h-[196px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={64}
                          outerRadius={86}
                          paddingAngle={2}
                          strokeWidth={2}
                          stroke="hsl(var(--card))"
                        >
                          {pieData.map((p, i) => (
                            <Cell key={i} fill={p.fill} />
                          ))}
                        </Pie>
                        <ReTooltip content={ChartTooltip} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Total
                      </p>
                      <p className="text-base font-bold tabular-nums text-foreground">
                        {fmtMoney(summary.salesTotal)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 grid gap-1.5">
                    {pieData.map((p) => (
                      <div
                        key={p.name}
                        className="flex items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="inline-flex items-center gap-2 font-semibold text-foreground">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.fill }} />
                          {p.name}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="tabular-nums text-muted-foreground">
                            {p.count} ventas
                          </span>
                          <span className="font-bold tabular-nums">{fmtMoney(p.value)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<CreditCard className="h-6 w-6" />}
                  title="Sin datos"
                  description="No hay ventas registradas en este período"
                />
              )}
            </CardContent>
          </Card>


          {/* Comparativa Ingresos vs Gastos vs Ganancia */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Ingresos vs gastos vs ganancia</CardTitle>
              <CardDescription className="text-xs">
                Comparativa apilada del período · haz clic en una semana para profundizar
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {chartLoading ? (
                <div className="flex h-[220px] items-end gap-2 p-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${50 + ((i * 29) % 50)}%` }} />
                  ))}
                </div>
              ) : hasTrend ? (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} />
                      <YAxis fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCompact(v)} width={46} />
                      <ReTooltip content={ChartTooltip} />
                      <Bar
                        dataKey="ventas"
                        name="Ingresos"
                        fill={C.primary}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                        onClick={(d) => d?.weekStart && handleWeekClick(d.weekStart)}
                        style={{ cursor: chartMode === "mensual" ? "pointer" : "default" }}
                      />
                      <Bar
                        dataKey="gastos"
                        name="Gastos"
                        fill={C.destructive}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                        onClick={(d) => d?.weekStart && handleWeekClick(d.weekStart)}
                        style={{ cursor: chartMode === "mensual" ? "pointer" : "default" }}
                      />
                      <Line type="monotone" dataKey="utilidad" name="Ganancia" stroke={C.warning} strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<Wallet className="h-6 w-6" />}
                  title="Sin datos para mostrar"
                  description="No hay ventas registradas en este período"
                />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 border-t pt-2 text-[0.7rem] font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: C.primary }} /> Ingresos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: C.destructive }} /> Gastos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded" style={{ background: C.warning }} /> Ganancia
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Top productos */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Productos más vendidos</CardTitle>
              <CardDescription className="text-xs">
                Ranking histórico de unidades vendidas
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {topLoading ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ) : prodRows.length > 0 ? (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={prodRows}
                      layout="vertical"
                      margin={{ top: 4, right: 28, bottom: 0, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtUnits(v)} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={128}
                        fontSize={11}
                        tick={{ fill: C.muted }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) =>
                          v.length > 22 ? `${v.slice(0, 21)}…` : v
                        }
                      />
                      <ReTooltip content={UnitTooltip} />
                      <Bar dataKey="total_sold" name="Unidades" radius={[0, 4, 4, 0]} maxBarSize={18}>
                        {prodRows.map((p, i) => (
                          <Cell key={p.id} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<ShoppingCart className="h-6 w-6" />}
                  title="Sin productos"
                  description="Aún no hay ventas registradas"
                />
              )}
            </CardContent>
          </Card>
          {/* Unidades vendidas por categoría */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Unidades vendidas por categoría</CardTitle>
              <CardDescription className="text-xs">
                Suma de unidades de los productos más vendidos
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {topLoading ? (
                <div className="flex h-[220px] items-end gap-2 p-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${45 + ((i * 31) % 55)}%` }} />
                  ))}
                </div>
              ) : catData.length > 0 ? (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={catData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="name"
                        fontSize={11}
                        tick={{ fill: C.muted }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={catData.length > 4 ? -16 : 0}
                        textAnchor={catData.length > 4 ? "end" : "middle"}
                        height={catData.length > 4 ? 52 : 28}
                      />
                      <YAxis fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} width={34} />
                      <ReTooltip content={UnitTooltip} />
                      <Bar dataKey="value" name="Unidades" radius={[4, 4, 0, 0]} maxBarSize={40}>
                        {catData.map((c, i) => (
                          <Cell key={i} fill={c.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<ShoppingCart className="h-6 w-6" />}
                  title="Sin categorías"
                  description="Aún no hay ventas registradas"
                />
              )}
            </CardContent>
          </Card>

          {/* Participación de productos vendidos */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Participación de productos vendidos</CardTitle>
              <CardDescription className="text-xs">
                Porcentaje de unidades de los más vendidos
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {topLoading ? (
                <div className="flex flex-col items-center gap-4 py-3">
                  <Skeleton className="h-[180px] w-[180px] rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : productDonut.length > 0 ? (
                <>
                  <div className="relative h-[196px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={productDonut}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={64}
                          outerRadius={86}
                          paddingAngle={2}
                          strokeWidth={2}
                          stroke="hsl(var(--card))"
                        >
                          {productDonut.map((p, i) => (
                            <Cell key={i} fill={p.fill} />
                          ))}
                        </Pie>
                        <ReTooltip content={UnitTooltip} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Unidades
                      </p>
                      <p className="text-base font-bold tabular-nums text-foreground">
                        {totalUnits.toLocaleString("es-MX")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 grid gap-1.5">
                    {productDonut.map((p) => (
                      <div
                        key={p.name}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-foreground">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.fill }} />
                          <span className="truncate">{p.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2.5">
                          <span className="tabular-nums text-muted-foreground">
                            {p.value.toLocaleString("es-MX")} uds
                          </span>
                          <span className="font-bold tabular-nums">
                            {p.pct.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<ShoppingCart className="h-6 w-6" />}
                  title="Sin productos"
                  description="Aún no hay ventas registradas"
                />
              )}
            </CardContent>
          </Card>
        </section>

        {/* ─── TABLAS DE DESGLOSE ────────────────────────────── */}
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-3">
              <CardTitle className="text-sm">Detalle por método de pago</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4 text-[0.62rem] font-extrabold uppercase tracking-[0.1em]">
                        Método
                      </TableHead>
                      <TableHead className="px-4 text-right text-[0.62rem] font-extrabold uppercase tracking-[0.1em]">
                        Ventas
                      </TableHead>
                      <TableHead className="px-4 text-right text-[0.62rem] font-extrabold uppercase tracking-[0.1em]">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pieData.length > 0 ? (
                      pieData.map((m) => (
                        <TableRow key={m.name} className="hover:bg-muted/30">
                          <TableCell className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.fill }} />
                              {m.name}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums text-foreground">
                            {m.count}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right font-bold tabular-nums text-foreground">
                            {fmtMoney(m.value)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">
                          Sin ventas en el período
                        </TableCell>
                      </TableRow>
                    )}
                    {pieData.length > 0 && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={2} className="px-4 py-3 text-right text-sm font-bold text-foreground">
                          TOTAL
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right text-sm font-bold text-success tabular-nums">
                          {fmtMoney(summary.salesTotal)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-3">
              <CardTitle className="text-sm">Gastos por tipo</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : summary.expensesCount > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4 text-[0.62rem] font-extrabold uppercase tracking-[0.1em]">
                        Tipo
                      </TableHead>
                      <TableHead className="px-4 text-right text-[0.62rem] font-extrabold uppercase tracking-[0.1em]">
                        Movimientos
                      </TableHead>
                      <TableHead className="px-4 text-right text-[0.62rem] font-extrabold uppercase tracking-[0.1em]">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="hover:bg-muted/30">
                      <TableCell className="px-4 py-2.5">
                        <Badge variant="outline" className="border-destructive/20 bg-destructive/5 text-[0.7rem] font-bold uppercase text-destructive">
                          Compras
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {summary.compraCount}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right font-bold tabular-nums text-destructive">
                        -{fmtMoney(summary.compra)}
                      </TableCell>
                    </TableRow>
                    <TableRow className="hover:bg-muted/30">
                      <TableCell className="px-4 py-2.5">
                        <Badge variant="outline" className="border-warning/25 bg-warning/10 text-[0.7rem] font-bold uppercase text-warning">
                          Retiros
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {summary.retiroCount}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right font-bold tabular-nums text-destructive">
                        -{fmtMoney(summary.retiro)}
                      </TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={2} className="px-4 py-3 text-right text-sm font-bold text-foreground">
                        TOTAL
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm font-bold text-destructive tabular-nums">
                        -{fmtMoney(summary.expensesTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Ban className="h-8 w-8 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">
                    No hay gastos en este período
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ─── CALENDARIO (SHEET FLOTANTE) ───────────────────── */}
        <Sheet
          open={calendarOpen}
          onOpenChange={(v) => {
            setCalendarOpen(v);
            if (!v) setSelectedDay(null);
          }}
        >
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Calendario de inspección
              </SheetTitle>
              <SheetDescription className="text-xs">
                Selecciona un día para ver su resumen de ventas y gastos
              </SheetDescription>
            </SheetHeader>

            <div className="px-6 pb-6">
              {/* Navegación de mes */}
              <div className="sticky top-0 z-10 -mx-6 mt-4 flex items-center justify-between gap-2 border-b bg-background/95 px-6 py-3 backdrop-blur">
                <Button variant="outline" size="icon-sm" onClick={prevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex flex-col items-center">
                  <p className="text-sm font-bold tabular-nums text-foreground">
                    {MONTH_NAMES[calendarDate.getMonth()]}{" "}
                    {calendarDate.getFullYear()}
                  </p>
                  <Button variant="link" size="sm" className="h-5 px-0 text-xs" onClick={goToday}>
                    Hoy
                  </Button>
                </div>
                <Button variant="outline" size="icon-sm" onClick={nextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {calendarLoading ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Mini KPIs del mes */}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border bg-card p-2.5">
                      <p className="text-[0.55rem] font-bold uppercase tracking-wider text-success">
                        Ventas
                      </p>
                      <p className="truncate text-sm font-bold tabular-nums text-foreground">
                        {fmtMoney(calendarData.salesTotal)}
                      </p>
                      <Delta
                        value={pctOf(calendarData.salesTotal, calendarData.prevSales)}
                      />
                    </div>
                    <div className="rounded-xl border bg-card p-2.5">
                      <p className="text-[0.55rem] font-bold uppercase tracking-wider text-destructive">
                        Gastos
                      </p>
                      <p className="truncate text-sm font-bold tabular-nums text-foreground">
                        {fmtMoney(calendarData.expensesTotal)}
                      </p>
                      <Delta
                        value={pctOf(calendarData.expensesTotal, calendarData.prevExpenses)}
                        invert
                      />
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border bg-primary p-2.5 text-primary-foreground">
                      <p className="text-[0.55rem] font-bold uppercase tracking-wider opacity-90">
                        Utilidad
                      </p>
                      <p className="truncate text-sm font-bold tabular-nums">
                        {fmtMoney(calendarData.profit)}
                      </p>
                      <p className="truncate text-[0.6rem] opacity-80 tabular-nums">
                        {calendarData.salesCount} ventas · {calendarData.expensesCount} gastos
                      </p>
                    </div>
                  </div>

                  {/* Leyenda */}
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-success text-[8px] font-bold text-white">
                        +
                      </span>
                      Ingresos
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-destructive text-[8px] font-bold text-white">
                        −
                      </span>
                      Gastos
                    </span>
                  </div>

                  {/* Calendario */}
                  <div className="mt-2">
                    <Calendar
                      mode="single"
                      selected={selectedDayDate}
                      onSelect={(d) => {
                        if (d) handleDayClick(d);
                      }}
                      month={calendarDate}
                      onMonthChange={(m) => setCalendarDate(m)}
                      components={{ DayButton: CalendarDayButton }}
                      className="w-full"
                      classNames={{
                        months: "flex w-full",
                        month: "w-full space-y-2",
                        month_caption: "hidden",
                        nav: "hidden",
                        month_grid: "w-full border-collapse",
                        weekdays: "mb-1 flex w-full",
                        weekday:
                          "w-full pb-1 text-center text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground",
                        week: "flex w-full",
                        day: "relative flex-1 flex items-stretch [&:not(:last-child)]:pr-1 focus-within:relative focus-within:z-20",
                        day_button: "flex-1",
                      }}
                    />
                  </div>

                  {/* Resumen del día */}
                  {selectedDay && (
                    <div className="animate-enter mt-4 rounded-xl border bg-card p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Resumen del día
                          </p>
                          <p className="text-sm font-bold capitalize text-foreground">
                            {formatMXDate(`${selectedDay}T12:00:00`, {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedDay(null)}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label="Cerrar resumen del día"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {dayLoading ? (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-14 w-full rounded-lg" />
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-success/10 p-2.5">
                            <p className="text-[0.55rem] font-bold uppercase tracking-wider text-success">
                              Ingresos
                            </p>
                            <p className="text-sm font-bold tabular-nums text-foreground">
                              {fmtMoney(dayKpi.salesTotal)}
                            </p>
                            <p className="text-[0.6rem] tabular-nums text-muted-foreground">
                              {dayKpi.salesCount} ventas
                            </p>
                          </div>
                          <div className="rounded-lg bg-destructive/10 p-2.5">
                            <p className="text-[0.55rem] font-bold uppercase tracking-wider text-destructive">
                              Gastos
                            </p>
                            <p className="text-sm font-bold tabular-nums text-foreground">
                              {fmtMoney(dayKpi.expensesTotal)}
                            </p>
                            <p className="text-[0.6rem] tabular-nums text-muted-foreground">
                              {dayKpi.expensesCount} gastos
                            </p>
                          </div>
                          <div className="rounded-lg bg-primary/10 p-2.5">
                            <p className="text-[0.55rem] font-bold uppercase tracking-wider text-primary">
                              Utilidad
                            </p>
                            <p className="text-sm font-bold tabular-nums text-foreground">
                              {fmtMoney(dayProfit)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
};

export default Reports;