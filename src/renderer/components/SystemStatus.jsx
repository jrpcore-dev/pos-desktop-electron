import React from "react";
import {
  CalendarDays,
  ChevronDown,
  Landmark,
  Moon,
  Scale,
  Server,
  Sun,
  Wifi,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { formatMXTime } from "../utils/dateUtils";
import { fmtMoney } from "../utils/format";
import { cn } from "@/lib/utils";

function Dot({ tone }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "bg-warning",
        tone === "err" && "bg-destructive",
        tone === "neutral" && "bg-muted-foreground/40",
      )}
    />
  );
}

function Field({ label, value, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-[5px]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[13px] tabular-nums",
          strong ? "font-bold text-foreground" : "font-medium text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="mx-3 h-px bg-border" />;
}

function StateTile({ icon: Icon, label, status, tone, onClick, title, dot = true }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        "flex min-w-0 flex-col rounded-md px-2.5 py-2 text-left",
        onClick &&
          "cursor-pointer transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={15} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] text-foreground">{label}</span>
      </span>
      <span
        className={cn(
          "mt-1 flex items-center gap-1.5 pl-6 text-[11px] font-semibold whitespace-nowrap",
          tone === "ok" && "text-success",
          tone === "warn" && "text-warning",
          tone === "err" && "text-destructive",
          tone === "neutral" && "text-muted-foreground",
        )}
      >
        {status}
        {dot && <Dot tone={tone} />}
      </span>
    </Tag>
  );
}

const SystemStatus = ({
  register,
  clock,
  serverRunning,
  scaleConnected,
  tasksCount,
  isDark,
  onToggleTheme,
  onOpenScale,
  onOpenTasks,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const isOpen = register?.status === "open";
  const closedAt = register?.closed_at ? formatMXTime(register.closed_at) : null;

  const now = new Date();
  const dateLabel = `${now
    .toLocaleDateString("es-MX", {
      weekday: "short",
      timeZone: "America/Mexico_City",
    })
    .replace(/\.$/, "")} ${now.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "America/Mexico_City",
  })}`;

const goToCaja = () => {
  setOpen(false);
  navigate("/end-of-day");
};
const openRegister = () => {
  setOpen(false);
  localStorage.setItem("eodPendingAction", "open-register");
  navigate("/end-of-day");
};
  const openScale = () => {
    setOpen(false);
    onOpenScale();
  };
  const openTasks = () => {
    setOpen(false);
    onOpenTasks();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            isOpen
              ? `Caja abierta, abierta a las ${formatMXTime(register.opened_at)}`
              : "Caja cerrada"
          }
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-left outline-none",
            "border-border bg-card transition-colors duration-150",
            "hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
            isOpen
              ? "text-foreground"
              : "border-dashed text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              isOpen ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          <span className="text-[13px] font-medium whitespace-nowrap">
            {isOpen ? "Caja abierta" : "Caja cerrada"}
          </span>

          <span className="h-4 w-px bg-border" />
          <span
            className="flex shrink-0 items-center gap-1.5"
            title={`Servidor: ${serverRunning ? "activo" : "caído"} · Báscula: ${scaleConnected ? "conectada" : "desconectada"}`}
          >
            <span
              title={serverRunning ? "Servidor activo" : "Servidor caído"}
              className="inline-flex items-center"
            >
              <Wifi
                size={14}
                className={serverRunning ? "text-success" : "text-destructive"}
              />
            </span>
            <span
              title={scaleConnected ? "Báscula conectada" : "Báscula desconectada"}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                scaleConnected ? "bg-success" : "bg-muted-foreground/40",
              )}
            />
          </span>

          <span className="h-4 w-px bg-border" />
          <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {dateLabel}
          </span>
          <span className="h-4 w-px bg-border" />
          <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">
            {clock}
          </span>
          <ChevronDown
            size={14}
            className="shrink-0 text-muted-foreground/50 transition-transform duration-150"
            style={open ? { transform: "rotate(180deg)" } : undefined}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={6} className="w-80 p-0">
        {isOpen ? (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <Landmark size={13} />
                Caja actual
              </span>
              <span className="text-[11px] text-muted-foreground">
                #{register.id}
              </span>
            </div>
            <Divider />
            <div className="py-1.5">
              {register.opener_name && (
                <Field label="Abierta por" value={register.opener_name} />
              )}
              <Field
                label="Apertura"
                value={fmtMoney(register.opening_balance)}
              />
              <Field label="Desde" value={formatMXTime(register.opened_at)} />
              <Field
                label="Efectivo en caja"
                value={fmtMoney(register.currentCash)}
                strong
              />
              <Field label="Gastos" value={fmtMoney(register.expenses)} />
            </div>
            <Divider />
            <div className="p-2">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={goToCaja}
              >
                Ir a Corte de caja
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="px-3 py-2.5">
              <p className="text-[13px] font-semibold text-foreground">
                No hay ninguna caja abierta
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {closedAt
                  ? `Se cerró a las ${closedAt}. Las ventas en efectivo no quedan registradas en ningún corte.`
                  : "Las ventas en efectivo no quedan registradas en ningún corte hasta que abras una."}
              </p>
            </div>
            <Divider />
            <div className="p-2">
              <Button size="sm" className="w-full" onClick={openRegister}>
                Abrir caja
              </Button>
            </div>
          </>
        )}

        <Divider />

        <div className="p-1.5">
          {!serverRunning && (
            <div className="mb-1.5 rounded-md border border-destructive/30 bg-destructive/[0.06] px-2.5 py-2">
              <p className="text-[13px] font-semibold text-destructive">
                Servidor móvil detenido
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-destructive/80">
                La app móvil no está conectada. La venta local sigue funcionando.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <StateTile
              icon={Server}
              label="Servidor"
              status={serverRunning ? "Activo" : "Caído"}
              tone={serverRunning ? "ok" : "err"}
            />
            <StateTile
              icon={Scale}
              label="Báscula"
              status={scaleConnected ? "Conectada" : "Desconectada"}
              tone={scaleConnected ? "ok" : "neutral"}
              onClick={openScale}
              title={scaleConnected ? "Báscula conectada" : "Conectar báscula"}
            />
            <StateTile
              icon={CalendarDays}
              label="Tareas"
              status={tasksCount > 0 ? String(tasksCount) : "—"}
              tone={tasksCount > 0 ? "warn" : "neutral"}
              onClick={openTasks}
              title="Tareas del día"
            />
            <StateTile
              icon={isDark ? Sun : Moon}
              label="Tema"
              status={isDark ? "Oscuro" : "Claro"}
              tone="neutral"
              dot={false}
              onClick={onToggleTheme}
              title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SystemStatus;
