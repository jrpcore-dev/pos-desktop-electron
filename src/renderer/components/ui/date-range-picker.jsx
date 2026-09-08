import * as React from "react";
import { CalendarDays, X } from "lucide-react";
import dayjs from "dayjs";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover";

const toDate = (ymd) => (ymd ? dayjs(ymd).toDate() : undefined);
const toYmd = (d) => (d ? dayjs(d).format("YYYY-MM-DD") : undefined);
const isSameDay = (a, b) => {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};
const startOfDay = (d) =>
  d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : undefined;
const fmt = (d) =>
  d
    ? d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
    : "";

const presets = [
  {
    key: "today",
    label: "Hoy",
    get: () => {
      const today = dayjs();
      return { from: today, to: today };
    },
  },
  {
    key: "yesterday",
    label: "Ayer",
    get: () => {
      const yesterday = dayjs().subtract(1, "day");
      return { from: yesterday, to: yesterday };
    },
  },
  {
    key: "last7",
    label: "Últimos 7 días",
    get: () => {
      const today = dayjs();
      return { from: today.subtract(6, "day"), to: today };
    },
  },
  {
    key: "thisMonth",
    label: "Este mes",
    get: () => {
      const m = dayjs().startOf("month");
      return { from: m, to: m.endOf("month") };
    },
  },
  {
    key: "lastMonth",
    label: "Mes anterior",
    get: () => {
      const m = dayjs().subtract(1, "month").startOf("month");
      return { from: m, to: m.endOf("month") };
    },
  },
];

const DateRangePicker = React.forwardRef(
  (
    {
      value,
      onApply,
      placeholder = "Seleccionar rango",
      align = "center",
      showClear = true,
      className,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [hasOpened, setHasOpened] = React.useState(false);
    const [range, setRange] = React.useState(null);

    const rangeRef = React.useRef(range);
    rangeRef.current = range;
    const onApplyRef = React.useRef(onApply);
    onApplyRef.current = onApply;

    React.useEffect(() => {
      if (open) {
        const from = startOfDay(toDate(value?.from));
        const to = startOfDay(toDate(value?.to));
        if (from && to && from.getTime() === to.getTime()) {
          setRange({ from, to: null });
        } else {
          setRange(from && to ? { from, to } : null);
        }
      }
    }, [open, value]);

    React.useEffect(() => {
      if (open && !hasOpened) setHasOpened(true);
    }, [open, hasOpened]);

    const commit = React.useCallback((from, to) => {
      const result =
        from || to ? { from: toYmd(from), to: toYmd(to) } : null;
      onApplyRef.current?.(result);
      setOpen(false);
    }, []);

    const handleDayClick = React.useCallback(
      (date) => {
        const day = startOfDay(date);
        const cur = rangeRef.current;
        const from = cur?.from;
        const to = cur?.to;

        if (from && to) {
          if (isSameDay(day, from) || isSameDay(day, to)) {
            const keep = isSameDay(day, from) ? to : from;
            setRange({ from: keep, to: null });
          } else if (
            day.getTime() > from.getTime() &&
            day.getTime() < to.getTime()
          ) {
            setRange({ from: day, to: null });
          } else if (day.getTime() < from.getTime()) {
            commit(day, to);
          } else {
            commit(from, day);
          }
        } else if (from) {
          if (isSameDay(day, from)) {
            setRange(null);
          } else if (day.getTime() < from.getTime()) {
            commit(day, from);
          } else {
            commit(from, day);
          }
        } else {
          setRange({ from: day, to: null });
        }
      },
      [commit],
    );

    const applyPreset = React.useCallback(
      (p) => {
        const { from, to } = p.get();
        const dFrom = from.toDate();
        const dTo = to.toDate();
        setRange({ from: dFrom, to: dTo });
        onApply?.({ from: toYmd(from), to: toYmd(to) });
        setOpen(false);
      },
      [],
    );

    const clear = React.useCallback(() => {
      setRange(null);
      onApply?.(null);
      setOpen(false);
    }, []);

    const hasValue = Boolean(value?.from || value?.to);
    const label =
      value?.from && value?.to
        ? `${fmt(toDate(value.from))} – ${fmt(toDate(value.to))}`
        : value?.from
          ? `Desde ${fmt(toDate(value.from))}`
          : value?.to
            ? `Hasta ${fmt(toDate(value.to))}`
            : placeholder;

    const rFrom = range?.from;
    const rTo = range?.to;
    const hint =
      rFrom && rTo
        ? `${fmt(rFrom)} – ${fmt(rTo)}`
        : rFrom
          ? `Inicio: ${fmt(rFrom)} — elige el día final`
          : "Elige el día inicial";

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            variant="outline"
            className={cn(
              "h-9 w-full justify-start gap-2 px-3 font-normal sm:w-[240px]",
              !hasValue && "text-muted-foreground",
              className,
            )}
          >
            <CalendarDays className="h-4 w-4" />
            <span className="flex-1 truncate text-left">{label}</span>
            {hasValue && showClear && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    clear();
                  }
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Limpiar fecha"
              >
                <X className="h-4 w-4" />
              </span>
            )}
          </Button>
        </PopoverTrigger>
        {hasOpened && (
          <PopoverContent
            forceMount
            align={align}
            className="w-auto min-w-max p-0"
            collisionPadding={12}
          >
            <div className="flex flex-col gap-0 sm:flex-row">
              <div className="flex flex-col gap-1 p-3 sm:w-40">
                <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Períodos
                </p>
                {presets.map((p) => (
                  <Button
                    key={p.key}
                    variant="ghost"
                    size="sm"
                    className="justify-start px-2 text-sm"
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col border-t p-3 sm:border-l sm:border-t-0">
                <div className="overflow-x-hidden">
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={range}
                    onSelect={() => {}}
                    onDayClick={handleDayClick}
                    defaultMonth={toDate(value?.from)}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <span className="text-xs font-medium text-foreground">
                    {hint}
                  </span>
                  {showClear && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={clear}
                    >
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </PopoverContent>
        )}
      </Popover>
    );
  },
);
DateRangePicker.displayName = "DateRangePicker";

export { DateRangePicker };
