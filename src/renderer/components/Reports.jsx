import { loadPdfToolchain } from "@/utils/pdfToolchain";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDbChanges } from "../lib/useDbChanges";
import FreshDataChip from "./FreshDataChip";
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
import { fmtMoney } from "@/utils/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBrandHeader,
  SheetDescription,
} from "@/components/ui/sheet";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
import { printDocument } from "../utils/printPdf";

import PageHeader from "./PageHeader";
import { MovementView, PurchaseSuggestions } from "./ReportsExtras";

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
  credit: "Fiado",
};

const C = {
  primary: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  destructive: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
  muted: "hsl(var(--muted-foreground))",
};

const CHART_PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-1) / 0.6)",
  "hsl(var(--chart-2) / 0.6)",
];

const UI_PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-3))",
  "hsl(var(--info))",
];

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

// Con qué se compara: "la semana pasada", "ayer"… según el largo del periodo.
const prevPeriodLabel = (startDate, endDate) => {
  if (!startDate || !endDate) return { long: "el periodo anterior", short: "periodo anterior" };
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const span = Math.round((new Date(ey, em - 1, ed) - new Date(sy, sm - 1, sd)) / 86400000) + 1;
  const lastOfMonth = new Date(ey, em, 0).getDate();
  if (span === 1) return { long: "el día anterior", short: "día anterior" };
  if (span === 7) return { long: "la semana pasada", short: "semana pasada" };
  if (sd === 1 && sy === ey && sm === em && ed === lastOfMonth) return { long: "el mes pasado", short: "mes pasado" };
  return { long: "el periodo anterior", short: "periodo anterior" };
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
  return {
    best,
    histogram: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hours[h] || 0 })),
  };
};

const categorizeExpenses = (expenses) => {
  const out = { compra: 0, retiro: 0, compraCount: 0, retiroCount: 0 };
  for (const e of expenses || []) {
    if (e.status === "cancelado") continue;
    const amt = Number(e.amount) || 0;
    // Compras = pagos a proveedor (Salida de dinero) + compras desde
    // "Llegó mercancía" (llevan product_id). Lo demás son otros gastos.
    if (e.category === "supplier" || e.product_id) {
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

// ─── TOOLTIP PERSONALIZADO PARA RECHARTS ────────────────────
// Celda de día del calendario — definida a nivel de módulo para que React
// mantenga la identidad del componente y no remonte las celdas del mes en
// cada render de Reports. Los totales del día llegan por props.
const CalendarDayButton = ({ day, modifiers, children, dailySales, dailyExpenses, ...btnProps }) => {
  const ds = day.isoDate;
  const sTotal = dailySales[ds]?.total || 0;
  const eTotal = dailyExpenses[ds] || 0;
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
        isOutside && "text-muted-foreground opacity-60",
        btnProps.className
      )}
    >
      <span
        className={cn(
          "text-[12px] leading-none tabular-nums",
          isSelected
            ? "font-bold text-primary-foreground"
            : isToday
              ? "font-bold text-success"
              : "font-semibold text-foreground"
        )}
      >
        {children}
      </span>
      <span className="flex flex-col items-center gap-[2px] leading-none">
        {sTotal > 0 && (
          <span
            className={cn(
              "text-[11px] font-bold tabular-nums",
              isSelected ? "text-primary-foreground/90" : "text-success"
            )}
          >
            +{fmtCompact(sTotal)}
          </span>
        )}
        {eTotal > 0 && (
          <span
            className={cn(
              "text-[11px] font-bold tabular-nums",
              isSelected ? "text-primary-foreground/90" : "text-destructive"
            )}
          >
            -{fmtCompact(eTotal)}
          </span>
        )}
        {sTotal === 0 && eTotal === 0 && (
          <span
            className={cn(
              "text-[11px]",
              isSelected ? "text-primary-foreground/70" : "text-muted-foreground/70"
            )}
          >
            -
          </span>
        )}
      </span>
    </button>
  );
};

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

// Esquinas de las tarjetas de Reportes: sólo esta pantalla, --radius es global.
const CARD_RADIUS = "rounded-[1.25rem]";

// ═══ BLOQUE DE GRÁFICAS + DETALLE (memorizado) ═══
// React.memo: los renders de Reports (p. ej. al seleccionar un día del
// calendario) saltan este bloque completo si los datos no cambian,
// evitando re-renderizar las 7 gráficas de recharts.
const ChartsSection = React.memo(function ChartsSection({
  loading,
  chartLoading,
  chartMode,
  summary,
  trendData,
  hourly,
  topProducts,
  topLoading,
  onWeekClick,
  startDate,
  endDate,
  deviceFilter,
  prevLabel,
}) {
  // Tarjeta de productos: "Más vendidos" (como siempre) o "Movimiento" (día
  // por día contra el periodo anterior). Es otra vista, no reemplaza.
  const [prodView, setProdView] = React.useState("top");
  const pieData = [...(summary.byMethod || [])]
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
    .map((m, i) => ({
      name: methodLabels[m.payment_method] || m.payment_method,
      value: Number(m.total) || 0,
      count: m.count,
      fill: UI_PALETTE[i % UI_PALETTE.length],
    }));

  const prodRows = topProducts.slice(0, 10);
  const hasTrend = trendData.length > 0;


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

  return (
    <section className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Tendencia */}
      <Card wash className={cn(CARD_RADIUS, "min-w-0 lg:col-span-2")}>
        <CardHeader className="pb-0">
          <CardTitle className="text-[15px]">Tendencia de ventas</CardTitle>
          <CardDescription className="text-xs">
            {chartMode === "semanal" ? "Ventas por día de la semana" : "Ventas por semana del mes"}
          </CardDescription>
        </CardHeader>
        <CardContent key={String(chartLoading)} className="flex flex-1 flex-col pt-2 vt-reveal">
          {chartLoading ? (
            <div className="flex h-[260px] items-end gap-2 p-3">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton
                  key={i}
                  className="flex-1 rounded-t-md"
                  style={{ height: `${40 + ((i * 37) % 60)}%` }}
                />
              ))}
            </div>
          ) : hasTrend ? (
            <div
              role="img"
              aria-label={`Tendencia diaria del período. Ventas: ${fmtMoney(summary.salesTotal)}. Gastos: ${fmtMoney(summary.expensesTotal)}. Utilidad: ${fmtMoney(summary.profit)}.`}
              className="h-[260px] w-full"
            >
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
                  <Area type="monotone" dataKey="ventas" name="Ventas" stroke={C.primary} strokeWidth={2.5} fill="url(#gradVentas)" activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }} animationDuration={800} animationEasing="ease-out" />
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

      {/* Ventas por hora del día */}
      <Card wash className={cn(CARD_RADIUS, "min-w-0")}>
        <CardHeader className="pb-0">
          <CardTitle className="text-[15px]">Ventas por hora del día</CardTitle>
          <CardDescription className="text-xs">
            Concentración de ventas por hora (hora de México)
          </CardDescription>
        </CardHeader>
        <CardContent key={String(loading)} className="pt-2 vt-reveal">
          {loading || hourly.length === 0 ? (
            <div className="flex h-[220px] items-end gap-1.5 p-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="flex-1 rounded-t-md"
                  style={{ height: `${28 + ((i * 29) % 60)}%` }}
                />
              ))}
            </div>
          ) : (
            <div
              role="img"
              aria-label={`Ventas por hora del día. Hora pico: ${
                summary.peakHour != null
                  ? `${summary.peakHour}:00 con ${summary.peakHourCount} ventas`
                  : "sin datos"
              }.`}
              className="h-[220px] w-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="rpHourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    fontSize={11}
                    tick={{ fill: C.muted }}
                    tickLine={false}
                    axisLine={false}
                    interval={1}
                    tickFormatter={(h) => `${h}h`}
                  />
                  <YAxis
                    width={34}
                    fontSize={11}
                    tick={{ fill: C.muted }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <ReTooltip
                    content={<ChartTooltip />}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  />
                  <Bar dataKey="count" name="Ventas" radius={[6, 6, 0, 0]} maxBarSize={26} animationDuration={700} animationEasing="ease-out">
                    {hourly.map((d) => (
                      <Cell key={d.hour} fill={d.count > 0 ? "url(#rpHourGrad)" : "hsl(var(--border))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Distribución por método */}
      <Card wash className={cn(CARD_RADIUS, "min-w-0")}>
        <CardHeader className="pb-0">
          <CardTitle className="text-[15px]">Distribución por método de pago</CardTitle>
          <CardDescription className="text-xs">
            Desglose de ingresos del período
          </CardDescription>
        </CardHeader>
        <CardContent key={String(loading)} className="pt-2 vt-reveal">
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-3">
              <Skeleton className="h-[180px] w-[180px] rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : pieData.length > 0 ? (
            <>
              <div
                role="img"
                aria-label={`Ventas por método de pago. Total: ${fmtMoney(summary.salesTotal)}.`}
                className="relative h-[220px] w-full"
              >
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
                      animationDuration={700}
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
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                    className="flex items-center justify-between rounded-lg border border-border/50 px-2.5 py-1.5 text-xs"
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


      {/* Comparativa Ingresos vs Gastos vs Ganancia · crece a la altura de
          Productos cuando éste muestra Movimiento (van lado a lado). */}
      <Card wash className={cn(CARD_RADIUS, "flex min-w-0 flex-col")}>
        <CardHeader className="pb-0">
          <CardTitle className="text-[15px]">Ingresos vs gastos vs ganancia</CardTitle>
          <CardDescription className="text-xs">
            Lo cobrado, los gastos y lo que le ganaste a lo vendido · haz clic en una semana para profundizar
          </CardDescription>
        </CardHeader>
        <CardContent key={String(chartLoading)} className="pt-2 vt-reveal">
          {chartLoading ? (
            <div className="flex h-[220px] items-end gap-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${50 + ((i * 29) % 50)}%` }} />
              ))}
            </div>
          ) : hasTrend ? (
            <div
              role="img"
              aria-label="Ingresos, gastos y ganancia por día del período"
              className="relative min-h-[220px] w-full flex-1"
            >
              {/* Absoluto: la gráfica toma el alto que le da la tarjeta sin empujarla. */}
              <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="rpIncomeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tick={{ fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCompact(v)} width={46} />
                  <ReTooltip content={ChartTooltip} />
                  <Bar
                    dataKey="ventas"
                    name="Ingresos"
                    fill="url(#rpIncomeGrad)"
                    radius={[6, 6, 0, 0]}
                    animationDuration={700}
                    animationEasing="ease-out"
                    maxBarSize={36}
                    onClick={(d) => d?.weekStart && onWeekClick(d.weekStart)}
                    style={{ cursor: chartMode === "mensual" ? "pointer" : "default" }}
                  />
                  <Bar
                    dataKey="gastos"
                    name="Gastos"
                    fill={C.destructive}
                    fillOpacity={0.85}
                    radius={[6, 6, 0, 0]}
                    animationDuration={700}
                    animationEasing="ease-out"
                    maxBarSize={36}
                    onClick={(d) => d?.weekStart && onWeekClick(d.weekStart)}
                    style={{ cursor: chartMode === "mensual" ? "pointer" : "default" }}
                  />
                  <Line type="monotone" dataKey="ganancia" name="Ganancia" stroke={C.success} strokeWidth={2.5} dot={false} animationDuration={900} />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
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
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.primary }} /> Ingresos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.destructive }} /> Gastos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full" style={{ background: C.success }} /> Ganancia (sobre costo)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Productos: Más vendidos | Movimiento */}
      <Card wash className={cn(CARD_RADIUS, "min-w-0")}>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 pb-0">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-[15px]">Productos</CardTitle>
            </div>
            <CardDescription className="text-xs">
              {prodView === "top"
                ? "Unidades vendidas en el periodo"
                : `Cómo se vendió cada producto día por día, contra ${prevLabel.long}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={prodView} onValueChange={setProdView}>
              <TabsList className="h-8">
                <TabsTrigger value="top" className="px-2.5 text-xs font-semibold">Más vendidos</TabsTrigger>
                <TabsTrigger value="movement" className="px-2.5 text-xs font-semibold">Movimiento</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent key={String(topLoading) + prodView} className="pt-3 vt-reveal">
          {prodView === "movement" ? (
            <MovementView
              startDate={startDate}
              endDate={endDate}
              deviceId={deviceFilter}
              periodLabel={prevLabel.long}
            />
          ) : topLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : prodRows.length > 0 ? (
            <div
              role="img"
              aria-label="Top 10 de productos más vendidos en unidades del periodo"
              className="h-[220px] w-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={prodRows}
                  layout="vertical"
                  margin={{ top: 4, right: 28, bottom: 0, left: 8 }}
                >
                  <defs>
                    <linearGradient id="rpTopGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" />
                    </linearGradient>
                  </defs>
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
                  <ReTooltip content={UnitTooltip} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
                  <Bar dataKey="total_sold" name="Unidades" fill="url(#rpTopGrad)" radius={[0, 6, 6, 0]} maxBarSize={18} animationDuration={700} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title="Sin productos" description="No hay ventas en este periodo" />
          )}
        </CardContent>
      </Card>
      {/* Lista de compra sugerida (compacta) */}
      <PurchaseSuggestions className="min-w-0 lg:col-span-2" />
      {/* Unidades vendidas por categoría */}
      <Card wash className={cn(CARD_RADIUS, "min-w-0")}>
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-[15px]">Unidades vendidas por categoría</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Unidades vendidas en el periodo, por categoría
          </CardDescription>
        </CardHeader>
        <CardContent key={String(topLoading)} className="pt-2 vt-reveal">
          {topLoading ? (
            <div className="flex h-[220px] items-end gap-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${45 + ((i * 31) % 55)}%` }} />
              ))}
            </div>
          ) : catData.length > 0 ? (
            <div
              role="img"
              aria-label="Unidades vendidas por categoría en el periodo"
              className="h-[220px] w-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={catData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="rpCatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" />
                    </linearGradient>
                  </defs>
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
                  <ReTooltip content={UnitTooltip} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
                  <Bar dataKey="value" name="Unidades" fill="url(#rpCatGrad)" radius={[6, 6, 0, 0]} maxBarSize={40} animationDuration={700} animationEasing="ease-out" />
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
      <Card wash className={cn(CARD_RADIUS, "min-w-0 overflow-hidden")}>
        <CardHeader className="border-b bg-muted/20 pb-3">
          <CardTitle className="text-[15px]">Gastos por tipo</CardTitle>
        </CardHeader>
        <CardContent key={String(loading)} className="p-0 vt-reveal">
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
                  <TableHead>
                    Tipo
                  </TableHead>
                  <TableHead className="text-right">
                    Movimientos
                  </TableHead>
                  <TableHead className="text-right">
                    Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="px-4 py-2.5">
                    <Badge variant="outline" className="border-destructive/20 bg-destructive/5 text-[0.7rem] font-bold uppercase text-destructive">
                      Compras de mercancía
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
                      Otros gastos
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
  );
});

// ══ Calendario mensual de inspección (memorizado) ══
// react-day-picker re-renderiza sus 42 celdas y recalcula los modificadores
// en cada render de Reports; aislado en un memo, los renders del resumen
// diario (dayLoading / dayKpi) lo saltan por completo y la animación de
// entrada del panel corre sin competir con ese trabajo.
const InspectionCalendar = React.memo(function InspectionCalendar({
  selectedDay,
  onSelect,
  calendarDate,
  onMonthChange,
  CalendarDay,
}) {
  return (
    <Calendar
      mode="single"
      selected={selectedDay ? parseDateStr(selectedDay) : undefined}
      onSelect={onSelect}
      month={calendarDate}
      onMonthChange={onMonthChange}
      components={{ DayButton: CalendarDay }}
      className="w-full"
      classNames={{
        months: "flex w-full",
        month: "w-full space-y-2",
        month_caption: "hidden",
        nav: "hidden",
        month_grid: "w-full border-collapse",
        weekdays: "mb-1 flex w-full",
        weekday:
          "w-full pb-1 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
        week: "flex w-full",
        day: "relative flex-1 flex items-stretch [&:not(:last-child)]:pr-1 focus-within:relative focus-within:z-20",
        day_button: "flex-1",
      }}
    />
  );
});

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
  // Histograma de ventas por hora (0-23, hora MX) del período
  const [hourly, setHourly] = useState([]);
  // Regla 5 · los datos nuevos NO recalculan el informe solo: chip a decisión.
  const [freshData, setFreshData] = useState(false);
  // Bloque 5 · filtro por caja. "all" = consolidado; "__host__" = ventas del Host.
  const [deviceFilter, setDeviceFilter] = useState("all");
  const prevLabel = React.useMemo(() => prevPeriodLabel(startDate, endDate), [startDate, endDate]);
  const [devices, setDevices] = useState([]);
  const [hasHostSales, setHasHostSales] = useState(false);
  const [hostName, setHostName] = useState("Caja 1");

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke("list-sale-devices")
      .then((res) => {
        if (cancelled) return;
        setDevices(Array.isArray(res?.devices) ? res.devices : []);
        setHasHostSales(!!res?.hasHost);
        if (res?.hostName) setHostName(res.hostName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── FECHA INICIAL (semana de calendario, modo semanal) ───
  // Usa la misma getWeekRange del gráfico (lunes→domingo). Antes el rango
  // inicial era "últimos 7 días corridos" (hoy−6), que al abrir la semana
  // recién iniciada todavía incluía ventas de la semana pasada, mientras la
  // gráfica ya mostraba la semana nueva: los KPIs no coincidían en la
  // primera carga hasta la primera interacción (syncRangeWithChart).
  useEffect(() => {
    const now = new Date();
    const { start, end } = getWeekRange(now);
    setStartDate(start);
    setEndDate(end);
    setChartMode("semanal");
    setChartRefDate(now);
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
    const [salesRes, expRes, prevSalesRes, prevExpRes, gainRes, prevGainRes] = await Promise.all([
      window.api.invoke("get-sales-by-range", { startDate, endDate, deviceId: deviceFilter }),
      window.api.invoke("get-expenses-by-range", {
        startDate,
        endDate,
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-sales-by-range", {
        startDate: prev.start,
        endDate: prev.end,
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: prev.start,
        endDate: prev.end,
        deviceId: deviceFilter,
      }),
      // Ganancia real: lo cobrado por los productos − lo que costaron.
      window.api.invoke("get-profit-by-range", { startDate, endDate, deviceId: deviceFilter }).catch(() => null),
      window.api
        .invoke("get-profit-by-range", { startDate: prev.start, endDate: prev.end, deviceId: deviceFilter })
        .catch(() => null),
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
    const { best: peak, histogram: hourlyByHour } = peakHourOf(
      salesRes.success ? salesRes.sales : []
    );

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
      gain: gainRes && gainRes.success ? gainRes.profit : 0,
      gainMargin: gainRes && gainRes.success ? gainRes.margin : 0,
      gainRevenue: gainRes && gainRes.success ? gainRes.revenue : 0,
      gainMissing: gainRes && gainRes.success ? gainRes.missing : 0,
      prevGain: prevGainRes && prevGainRes.success ? prevGainRes.profit : 0,
    });
    setHourly(hourlyByHour);
    setLoading(false);
  }, [startDate, endDate, deviceFilter]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // ─── PRODUCTOS MÁS VENDIDOS (del periodo elegido) ─────────
  const fetchTopProducts = useCallback(async () => {
    if (!startDate || !endDate) return;
    setTopLoading(true);
    const res = await window.api.invoke("get-top-products", {
      deviceId: deviceFilter,
      startDate,
      endDate,
    });
    setTopProducts(Array.isArray(res) ? res : []);
    setTopLoading(false);
  }, [deviceFilter, startDate, endDate]);

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
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: monthStart,
        endDate: monthEnd,
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-sales-by-range", {
        startDate: prevStart,
        endDate: prevEnd,
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: prevStart,
        endDate: prevEnd,
        deviceId: deviceFilter,
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
  }, [deviceFilter]);

  useEffect(() => {
    if (calendarOpen) fetchCalendarMonth(calendarDate);
  }, [calendarOpen, calendarDate, fetchCalendarMonth]);

  // ─── KPI DEL DÍA SELECCIONADO ──────────────────────────────
  const fetchDayKpi = useCallback(async (day) => {
    setDayLoading(true);
    const [salesRes, expRes] = await Promise.all([
      window.api.invoke("get-sales-by-date", { date: day, deviceId: deviceFilter }),
      window.api.invoke("get-expenses-by-date", { date: day, deviceId: deviceFilter }),
    ]);
    setDayKpi({
      salesTotal: salesRes.success ? salesRes.total || 0 : 0,
      salesCount: salesRes.success ? salesRes.count || 0 : 0,
      expensesTotal: expRes.success ? expRes.totalExpenses || 0 : 0,
      expensesCount: expRes.success ? expRes.count || 0 : 0,
    });
    setDayLoading(false);
  }, [deviceFilter]);

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
    const [salesRes, expRes, gainRes] = await Promise.all([
      window.api.invoke("get-daily-sales-week", {
        startDate: start,
        endDate: toEndExclusive(end),
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-expenses-by-range", {
        startDate: start,
        endDate,
        deviceId: deviceFilter,
      }),
      window.api.invoke("get-profit-by-range", { startDate: start, endDate: end, deviceId: deviceFilter }).catch(() => null),
    ]);
    const gainMap = (gainRes && gainRes.success && gainRes.byDay) || {};

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
        return { label, ventas: v, gastos: g, utilidad: v - g, ganancia: gainMap[ds] || 0, isToday: ds === today };
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
          p: gainMap[ds] || 0,
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
          ganancia: wk.reduce((s, x) => s + x.p, 0),
        };
      });
      setTrendData(pts);
    }
    setChartLoading(false);
  }, [deviceFilter]);

  useEffect(() => {
    fetchTrend(chartRefDate, chartMode);
  }, [chartMode, chartRefDate, fetchTrend]);

  // Regla 5 · chip "Hay datos nuevos": refresca resumen, top y gráfica del
  // período elegido, solo a petición del usuario (nunca con cada venta).
  const refreshNow = useCallback(() => {
    setFreshData(false);
    fetchSummary();
    fetchTopProducts();
    fetchTrend(chartRefDate, chartMode);
  }, [fetchSummary, fetchTopProducts, fetchTrend, chartRefDate, chartMode]);

  useDbChanges(
    () => setFreshData(true),
    ["sales", "cash_register_expenses"],
  );

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

  // Referencia estable para ChartsSection (React.memo): el handler vive en un
  // ref para que navegar semanas no invalide el memo y re-renderice las 7
  // gráficas en cada cambio de estado (patrón useLatest).
  const handleWeekClickRef = useRef(handleWeekClick);
  handleWeekClickRef.current = handleWeekClick;
  const onWeekClick = useCallback(
    (weekStart) => handleWeekClickRef.current(weekStart),
    []
  );

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

  // Estable (useCallback): el memo de InspectionCalendar depende de esta
  // referencia para saltarse los renders del resumen diario.
  const handleDayClick = useCallback((day) => {
    const dateStr = day instanceof Date ? toDateStr(day) : String(day);
    setSelectedDay(dateStr);
  }, []);

  const handleCalendarSelect = useCallback(
    (d) => {
      if (d) handleDayClick(d);
    },
    [handleDayClick]
  );

  // ─── CELDA DEL CALENDARIO CON IMPORTES S/E ────────────────
  // Celda del calendario: wrapper con referencia estable (useCallback) que
  // inyecta los datos del mes al componente externo CalendarDayButton.
  const CalendarDay = useCallback(
    (props) => (
      <CalendarDayButton
        {...props}
        dailySales={calendarData.dailySales}
        dailyExpenses={calendarData.dailyExpenses}
      />
    ),
    [calendarData.dailySales, calendarData.dailyExpenses]
  );

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
    rows.push(`Compras de mercancía,${summary.compraCount},${summary.compra.toFixed(2)}`);
    rows.push(`Otros gastos,${summary.retiroCount},${summary.retiro.toFixed(2)}`);
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

  const buildReportPDF = async () => {
    const { jsPDF, interFontInline } = await loadPdfToolchain();
    const store = await window.api.invoke("get-setting", "store_name");
    const storeName = store || "MI TIENDA POS";
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

    doc.setFontSize(18);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);
    doc.text(storeName.toUpperCase(), pageW / 2, 22, { align: "center" });
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...C.muted);
    doc.text(
      `Reporte analítico — ${startDate} al ${endDate}`,
      pageW / 2,
      29,
      { align: "center" },
    );

    doc.setDrawColor(...C.brand);
    doc.setLineWidth(0.8);
    doc.line(margin, 33, pageW - margin, 33);

    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);
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
      doc.setTextColor(...C.muted);
      doc.text(c[0].toUpperCase(), x, y);
      doc.setFontSize(13);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);
      doc.text(c[1], x, y + 6);
    });
    yy += 40;

    if (summary.byMethod.length > 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);
      doc.text("Métodos de pago", margin, yy);
      yy += 4;
      doc.autoTable({
        startY: yy + 3,
        head: [["Método", "Ventas", "Total"]],
        body: summary.byMethod.map((m) => [
          methodLabels[m.payment_method] || m.payment_method,
          String(m.count),
          fmtMoney(m.total),
        ]),
        margin: { left: margin, right: margin },
        styles: tblBase,
        headStyles: tblHead,
        columnStyles: { 2: { halign: "right" } },
      });
      yy = doc.lastAutoTable.finalY + 8;
    }

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);
    doc.text("Gastos por tipo", margin, yy);
    yy += 4;
    doc.autoTable({
      startY: yy + 3,
      head: [["Tipo", "Cantidad", "Total"]],
      body: [
        ["Compras de mercancía", String(summary.compraCount), fmtMoney(summary.compra)],
        ["Otros gastos", String(summary.retiroCount), fmtMoney(summary.retiro)],
      ],
      margin: { left: margin, right: margin },
      styles: tblBase,
      headStyles: tblHead,
      columnStyles: { 2: { halign: "right" } },
      foot: [
        [
          { content: "TOTAL", colSpan: 2, styles: { fontStyle: "bold", halign: "right" } },
          fmtMoney(summary.expensesTotal),
        ],
      ],
      footStyles: { fillColor: C.head, textColor: C.ink, fontStyle: "bold" },
    });
    yy = doc.lastAutoTable.finalY + 8;

    if (topProducts.length > 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);
      doc.text("Productos más vendidos", margin, yy);
      yy += 4;
      doc.autoTable({
        startY: yy + 3,
        head: [["Producto", "Unidades"]],
        body: topProducts.slice(0, 10).map((p, i) => [`${i + 1}. ${p.name}`, String(p.total_sold)]),
        margin: { left: margin, right: margin },
        styles: tblBase,
        headStyles: tblHead,
      });
      yy = doc.lastAutoTable.finalY + 8;
    }

    const totalPages = doc.getNumberOfPages();
    for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
      doc.setPage(pageIdx);
      const fy = doc.internal.pageSize.getHeight() - 10;
      doc.setFontSize(8);
      doc.setFont(undefined, "normal");
      doc.setTextColor(...C.muted);
      doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, margin, fy);
      doc.text(`Página ${pageIdx} de ${totalPages}`, pageW / 2, fy, {
        align: "center",
      });
      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);
      doc.text("Vendia", pageW - margin, fy, { align: "right" });
    }

    return doc;
  };

  const exportPDF = async () => {
    const doc = await buildReportPDF();
    doc.save(`reporte-analitico-${startDate}-a-${endDate}.pdf`);
  };

  const printReport = async () => {
    const doc = await buildReportPDF();
    await printDocument(doc);
  };

  // Mejor producto (KPI "Más vendido" y resumen en lenguaje llano)
  const bestProduct = topProducts[0] || null;

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
      <div className="vt-pilot animate-enter p-1">
        <h1 className="sr-only">Reportes</h1>
        {/* ─── CABECERA ─────────────────────────────────────── */}
        <PageHeader
          description={
            <>
              Rendimiento del período{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {startDate} → {endDate}
              </span>
            </>
          }
          actions={
            <>
              {freshData && <FreshDataChip onClick={refreshNow} />}
              <label className="sr-only" htmlFor="report-device-filter">
                Filtrar por caja
              </label>
              <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                <SelectTrigger
                  id="report-device-filter"
                  className="h-9 w-auto min-w-40"
                  title="Vista consolidada o por caja"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las cajas</SelectItem>
                  {hasHostSales && (
                    <SelectItem value="__host__">{hostName}</SelectItem>
                  )}
                  {devices.map((d) => (
                    <SelectItem key={d.device_id} value={d.device_id}>
                      {(d.device_code || d.device_name || d.device_id) +
                        (d.device_name && d.device_code ? ` · ${d.device_name}` : "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Download className="h-4 w-4" />
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportCSV}>
                    <FileSpreadsheet className="h-4 w-4" /> CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPDF}>
                    <Download className="h-4 w-4" /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={printReport}>
                    <Printer className="h-4 w-4" /> Imprimir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        {/* ─── RESUMEN EN LENGUAJE CLARO ─────────────────────── */}
        <h2 className="sr-only">Resumen del período</h2>
        <section className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground">
            En este período vendiste{" "}
            <span className="font-semibold tabular-nums">{fmtMoney(summary.salesTotal)}</span> en{" "}
            <span className="font-semibold tabular-nums">{summary.salesCount}</span>             ventas{" "}
            ({(() => {
              const d = pctOf(summary.salesTotal, summary.prevSales);
              return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
            })()}{" "}
            vs período anterior)
            . Tu producto estrella fue{" "}
            <span className="font-semibold">{bestProduct ? bestProduct.name : "—"}</span>
            {bestProduct ? ` con ${bestProduct.total_sold} unidades` : ""}, y tu hora pico es{" "}
            <span className="font-semibold tabular-nums">
              {summary.peakHour != null ? `${summary.peakHour}:00` : "—"}
            </span>
            .
          </p>
        </section>

        {/* ─── KPIs ─────────────────────────────────────────── */}
        <h2 className="sr-only">Indicadores clave</h2>
        <section className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            className={CARD_RADIUS}
            hero
            gradient
            loading={loading}
            icon={<Banknote />}
            label="Ventas totales"
            value={fmtMoney(summary.salesTotal)}
            delta={pctOf(summary.salesTotal, summary.prevSales)}
            caption={`vs. ${prevLabel.short}: ${fmtMoney(summary.prevSales)}`}
          />
          <StatCard
            className={CARD_RADIUS}
            loading={loading}
            icon={<Wallet />}
            tone="success"
            label="Utilidad neta"
            value={fmtMoney(summary.profit)}
            delta={pctOf(
              summary.profit,
              summary.prevSales - summary.prevExpenses
            )}
            caption={`vs. ${prevLabel.short}: ${fmtMoney(summary.prevSales - summary.prevExpenses)}`}
          />
          <StatCard
            className={CARD_RADIUS}
            loading={loading}
            icon={<Receipt />}
            tone="info"
            label="Ticket promedio"
            value={fmtMoney(summary.avgTicket)}
            delta={pctOf(
              summary.avgTicket,
              summary.prevCount > 0 ? summary.prevSales / summary.prevCount : 0
            )}
            caption={`vs. ${prevLabel.short}: ${fmtMoney(summary.prevCount > 0 ? summary.prevSales / summary.prevCount : 0)}`}
          />
          <StatCard
            className={CARD_RADIUS}
            loading={loading}
            icon={<ShoppingCart />}
            tone="primary"
            label="Transacciones"
            value={String(summary.salesCount)}
            delta={pctOf(summary.salesCount, summary.prevCount)}
            caption={`vs. ${prevLabel.short}: ${summary.prevCount} ventas`}
          />
        </section>

        <section className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            className={CARD_RADIUS}
            size="sm"
            loading={loading}
            icon={<Percent />}
            tone="success"
            label="Ganancia"
            value={fmtMoney(summary.gain || 0)}
            delta={pctOf(summary.gain || 0, summary.prevGain || 0)}
            // En chico: el margen sobre lo vendido y el porcentaje de antes
            // (utilidad sobre ventas), que se conserva.
            caption={`margen ${(summary.gainMargin || 0).toFixed(1)} % · utilidad ${summary.profitMargin.toFixed(1)} %${
              summary.gainMissing > 0 ? ` · ${summary.gainMissing} sin costo` : ""
            }`}
          />
          <StatCard
            className={CARD_RADIUS}
            size="sm"
            loading={loading}
            icon={<ArrowDownToLine />}
            tone="destructive"
            label="Gastos"
            value={fmtMoney(summary.expensesTotal)}
            delta={pctOf(summary.expensesTotal, summary.prevExpenses)}
            invert
            caption={`${summary.expensesCount} movs · antes ${fmtMoney(summary.prevExpenses)}`}
          />
          <StatCard
            className={CARD_RADIUS}
            size="sm"
            loading={loading}
            icon={<Clock />}
            tone="warning"
            label="Hora pico"
            value={
              summary.peakHour != null
                ? `${summary.peakHour}:00 – ${(summary.peakHour + 1) % 24}:00`
                : "—"
            }
            caption={
              summary.peakHour != null
                ? `${summary.peakHourCount} ventas en esa hora`
                : "Sin datos"
            }
          />
          <StatCard
            className={CARD_RADIUS}
            size="sm"
            loading={topLoading}
            icon={<Crown />}
            tone="warning"
            label="Más vendido"
            value={bestProduct ? bestProduct.name : "—"}
            caption={
              bestProduct
                ? `${bestProduct.total_sold} unidades vendidas`
                : "Sin datos"
            }
          />
        </section>

        {/* ─── CONTROLES DE GRÁFICAS ────────────────────────── */}
        <section className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={chartMode}
            onValueChange={(v) => {
              setChartMode(v);
              syncRangeWithChart(chartRefDate, v);
            }}
          >
            <TabsList>
              <TabsTrigger value="semanal">Semanal</TabsTrigger>
              <TabsTrigger value="mensual">Mensual</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => navigateChart(-1)} aria-label="Periodo anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[150px] text-center text-xs font-semibold tabular-nums text-foreground">
              {formatChartTitle()}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => navigateChart(1)} aria-label="Periodo siguiente">
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
        <h2 className="sr-only">Análisis del período</h2>
        <ChartsSection
          loading={loading}
          chartLoading={chartLoading}
          chartMode={chartMode}
          summary={summary}
          trendData={trendData}
          hourly={hourly}
          topProducts={topProducts}
          topLoading={topLoading}
          onWeekClick={onWeekClick}
          startDate={startDate}
          endDate={endDate}
          deviceFilter={deviceFilter}
          prevLabel={prevLabel}
        />


        {/* ─── CALENDARIO (SHEET FLOTANTE) ───────────────────── */}
        <Sheet
          open={calendarOpen}
          onOpenChange={(v) => {
            setCalendarOpen(v);
            if (!v) setSelectedDay(null);
          }}
        >
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetBrandHeader
              icon={<CalendarDays />}
              title={<>Calendario de inspección</>}
              description={<>Selecciona un día para ver su resumen de ventas y gastos</>}
            />

            <div className="px-6 pb-6">
              {/* Navegación de mes */}
              <div className="sticky top-0 z-10 -mx-6 mt-4 flex items-center justify-between gap-2 border-b bg-background/95 px-6 py-3 backdrop-blur">
                <Button variant="outline" size="icon-sm" onClick={prevMonth} aria-label="Mes anterior">
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
                <Button variant="outline" size="icon-sm" onClick={nextMonth} aria-label="Mes siguiente">
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
                      <p className="text-[11px] font-bold uppercase tracking-wider text-success">
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
                      <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
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
                      <p className="text-[11px] font-bold uppercase tracking-wider opacity-90">
                        Utilidad
                      </p>
                      <p className="truncate text-sm font-bold tabular-nums">
                        {fmtMoney(calendarData.profit)}
                      </p>
                      <p className="truncate text-[11px] opacity-80 tabular-nums">
                        {calendarData.salesCount} ventas · {calendarData.expensesCount} gastos
                      </p>
                    </div>
                  </div>

                  {/* Leyenda */}
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-success text-[11px] font-bold text-white">
                        +
                      </span>
                      Ingresos
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-destructive text-[11px] font-bold text-white">
                        −
                      </span>
                      Gastos
                    </span>
                  </div>

                  {/* Calendario */}
                  <div className="mt-2">
                    <InspectionCalendar
                      selectedDay={selectedDay}
                      onSelect={handleCalendarSelect}
                      calendarDate={calendarDate}
                      onMonthChange={setCalendarDate}
                      CalendarDay={CalendarDay}
                    />
                  </div>

                  {/* Resumen del día */}
                  {selectedDay && (
                    <div className="animate-panel-in mt-4 rounded-xl border bg-card p-3.5">
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
                          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                            <p className="text-[11px] font-bold uppercase tracking-wider text-success">
                              Ingresos
                            </p>
                            <p className="text-sm font-bold tabular-nums text-foreground">
                              {fmtMoney(dayKpi.salesTotal)}
                            </p>
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                              {dayKpi.salesCount} ventas
                            </p>
                          </div>
                          <div className="rounded-lg bg-destructive/10 p-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                              Gastos
                            </p>
                            <p className="text-sm font-bold tabular-nums text-foreground">
                              {fmtMoney(dayKpi.expensesTotal)}
                            </p>
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                              {dayKpi.expensesCount} gastos
                            </p>
                          </div>
                          <div className="rounded-lg bg-primary/10 p-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
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
