import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  DatabaseBackup,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Package,
  ReceiptText,
  RefreshCw,
  Scale,
  ScanLine,
  ScrollText,
  Settings,
  Tags,
  TriangleAlert,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Outlet,
  Link as RouterLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useCashier } from "../contexts/CashierContext";
import { useThemeMode } from "../contexts/ThemeContext";
import { formatMXTime } from "../utils/dateUtils";
import { fmtMoney } from "../utils/format";
import CancelButton from "./CancelButton";
import UpdateButton from "./UpdateButton";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import RouteShellSkeleton from "./RouteShellSkeleton";
import SystemStatus from "./SystemStatus";

const TaskDialog = React.lazy(() => import("./TaskDialog"));

const ROUTE_PRELOADERS = {
  "/": () => import("./SalesTerminal"),
  "/end-of-day": () => import("./EndOfDay"),
  "/register-history": () => import("./RegisterHistory"),
  "/transacciones": () => import("./Transacciones"),
  "/inventory": () => import("./Inventory"),
  "/categories": () => import("./Categories"),
  "/suppliers": () => import("./Suppliers"),
  "/stock-movements": () => import("./StockMovements"),
  "/reports": () => import("./Reports"),
  "/cashiers": () => import("./Cashiers"),
  "/backup": () => import("./BackupRestore"),
  "/catalog-reference": () => import("./Catalog"),
  "/servicios": () => import("./servicios/ServicesScreen"),
  "/customers": () => import("./Customers"),
};

const drawerWidth = 288;
const miniDrawerWidth = 72;

const PAGE_META = {
  "/": { title: "Terminal de Venta", crumb: "Punto de venta" },
  "/end-of-day": { title: "Corte de Caja", crumb: "Punto de venta" },
  "/register-history": { title: "Turnos y Cortes", crumb: "Punto de venta" },
  "/transacciones": { title: "Transacciones", crumb: "Punto de venta" },
  "/servicios": { title: "Servicios", crumb: "Transacciones" },
  "/customers": { title: "Clientes", crumb: "Transacciones" },
  "/inventory": { title: "Productos", crumb: "Inventario" },
  "/stock-movements": { title: "Movimientos", crumb: "Inventario" },
  "/categories": { title: "Categorías", crumb: "Inventario" },
  "/suppliers": { title: "Proveedores", crumb: "Inventario" },
  "/catalog-reference": { title: "Catálogo de referencia", crumb: "Inventario" },
  "/reports": { title: "Reportes", crumb: "Administración" },
  "/cashiers": { title: "Cajeros", crumb: "Administración" },
  "/backup": { title: "Respaldo", crumb: "Administración" },
  "/configuration": { title: "Configuración", crumb: "Administración" },
};

/* ────────────────────────────────────────────────────────────
   Primitivas de UI (reemplazan a MUI). Usan las variables del
   theme (bg-background, text-foreground, bg-primary, etc.) que
   ya tienes definidas para el sidebar, así heredan dark mode
   automáticamente en vez de tener colores fijos.
──────────────────────────────────────────────────────────── */

function Modal({
  open,
  onClose,
  children,
  className,
  onKeyDown,
  disableBackdropClose,
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={disableBackdropClose ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative max-h-[90vh] w-full max-w-xs overflow-y-auto rounded-xl border border-border bg-background shadow-xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ children, className }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-5 pt-5 pb-3", className)}>
      {children}
    </div>
  );
}
function ModalBody({ children, className }) {
  return <div className={cn("px-5 py-1 text-sm", className)}>{children}</div>;
}
function ModalFooter({ children, className }) {
  return (
    <div className={cn("flex gap-2 px-5 pb-5 pt-4", className)}>{children}</div>
  );
}

function Btn({
  variant = "solid",
  size = "md",
  className,
  children,
  disabled,
  ...props
}) {
  const variants = {
    solid: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border text-foreground hover:bg-muted",
    ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
    destructive: "text-destructive hover:bg-destructive/10",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
  };
  const sizes = { sm: "h-8 px-2.5 text-xs", md: "h-10 px-4 text-sm" };
  return (
    <button
      disabled={disabled}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function Alert({ tone = "warning", children }) {
  const tones = {
    warning:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    error: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs leading-relaxed",
        tones[tone],
      )}
    >
      {children}
    </div>
  );
}

function StatusDot({ ok, pulse, tone }) {
  const resolved = tone || (ok ? "ok" : "err");
  const color =
    resolved === "ok"
      ? "bg-emerald-500"
      : resolved === "warn"
        ? "bg-amber-500"
        : resolved === "neutral"
          ? "bg-muted-foreground/40"
          : "bg-destructive";
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {pulse && resolved === "err" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
      )}
      <span
        className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", color)}
      />
    </span>
  );
}

/* ──────────────────────────────────────────────────────────── */

const Layout = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [storeName, setStoreName] = useState("MI TIENDA");
  const [storeLogo, setStoreLogo] = useState("");
  const [clock, setClock] = useState(new Date());
  const location = useLocation();
  const navigate = useNavigate();
  const { isDark, toggleMode } = useThemeMode();
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const { cashier, logout } = useCashier();
  const [register, setRegister] = useState(null);
  const [handover, setHandover] = useState(null);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const noticeShownRef = useRef(false);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleDialogOpen, setScaleDialogOpen] = useState(false);
  const [scalePorts, setScalePorts] = useState([]);
  const [scalePort, setScalePort] = useState(
    () => localStorage.getItem("scalePort") || "",
  );
  const [scaleBaud, setScaleBaud] = useState(
    () => localStorage.getItem("scaleBaud") || "115200",
  );
  const [scaleLoading, setScaleLoading] = useState(false);
  const [scaleError, setScaleError] = useState("");
  const [scaleReading, setScaleReading] = useState("");
  const [scaleLastWeight, setScaleLastWeight] = useState(null);
  const [scaleNote, setScaleNote] = useState("");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [insights, setInsights] = useState([]);
  const [insightsUnread, setInsightsUnread] = useState(0);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [todayTasksCount, setTodayTasksCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [reminderDialog, setReminderDialog] = useState({
    open: false,
    task: null,
  });

  const isVisibleRef = useRef(true);
  useEffect(() => {
    const handle = () => {
      isVisibleRef.current = !document.hidden;
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);

  const checkRegisterStatus = useCallback(async () => {
    try {
      const result = await window.api.invoke("get-cash-register-status", {
        cashierId: cashier?.id,
        role: cashier?.role,
      });
      const reg = result.success ? result.register : null;
      setRegister(reg || null);
      if (
        reg &&
        reg.status === "open" &&
        cashier?.role !== "admin" &&
        !noticeShownRef.current &&
        String(reg.opened_by) !== String(cashier?.id) &&
        String(reg.cashier_id) !== String(cashier?.id)
      ) {
        noticeShownRef.current = true;
        setHandover({
          registerId: reg.id,
          opener_name: reg.opener_name,
          opened_at: reg.opened_at,
          currentCash: reg.currentCash,
        });
      }
    } catch (e) {
      setRegister(null);
    }
  }, [cashier?.id, cashier?.role]);

  const handleHandoverConfirm = useCallback(async () => {
    if (!handover) return;
    setHandoverLoading(true);
    try {
      const declared = handover.currentCash || 0;
      const closeResult = await window.api.invoke("close-cash-register", {
        declaredClose: declared,
        expenses: 0,
        name: handover.opener_name || "Cambio de turno",
        cashierId: cashier?.id,
        role: cashier?.role,
        registerId: handover.registerId,
        force: true,
      });
      if (!closeResult.success) {
        setHandoverLoading(false);
        return;
      }
      await window.api.invoke("open-cash-register", {
        openingBalance: declared,
        cashierId: cashier?.id,
        role: cashier?.role,
      });
      setHandover(null);
      checkRegisterStatus();
    } catch (e) {
      /* noop */
    }
    setHandoverLoading(false);
  }, [handover, cashier?.id, cashier?.role, checkRegisterStatus]);

  useEffect(() => {
    checkRegisterStatus();
    const interval = setInterval(() => {
      if (isVisibleRef.current) checkRegisterStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, [checkRegisterStatus]);

  useEffect(() => {
    const checkScale = async () => {
      if (!isVisibleRef.current) return false;
      try {
        const status = await window.api.invoke("is-scale-connected");
        setScaleConnected(status.connected);
        return status.connected;
      } catch {
        setScaleConnected(false);
        return false;
      }
    };
    let cancelled = false;
    const connectingRef = { current: false };
    const autoConnect = async () => {
      if (!scalePort) return;
      if (connectingRef.current) return;
      const alreadyConnected = await checkScale();
      if (cancelled) return;
      if (alreadyConnected) return;
      connectingRef.current = true;
      try {
        const result = await window.api.invoke(
          "connect-scale",
          scalePort,
          parseInt(scaleBaud),
        );
        if (!cancelled) {
          setScaleConnected(result.success);
          if (result.success) {
            setScaleReading(result.raw || "");
            setScaleLastWeight(result.weight ?? null);
            setScaleNote(result.error || "");
          }
        }
      } catch {
        if (!cancelled) setScaleConnected(false);
      } finally {
        connectingRef.current = false;
      }
    };
    autoConnect();
    const interval = setInterval(() => {
      if (cancelled) return;
      autoConnect();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scalePort, scaleBaud]);

  useEffect(() => {
    const unsub = window.api.on("scale-error", (msg) => {
      setScaleError(String(msg));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const loadStoreSettings = async () => {
      try {
        const name = await window.api.invoke("get-setting", "store_name");
        const logo = await window.api.invoke("get-setting", "store_logo");
        if (name) setStoreName(name.toUpperCase());
        if (logo) setStoreLogo(logo);
      } catch (error) {
        console.error("Error loading store settings:", error);
      }
    };
    loadStoreSettings();

    const checkServer = async () => {
      try {
        const status = await window.api.invoke("get-server-status");
        setServerRunning(status.running);
      } catch (e) {
        setServerRunning(false);
      }
    };
    checkServer();
    const serverTimer = setInterval(checkServer, 5000);

    const handleSetupCompleted = (event) => {
      const { storeName: newStoreName } = event.detail;
      if (newStoreName) setStoreName(newStoreName.toUpperCase());
    };
    window.addEventListener("setupCompleted", handleSetupCompleted);

    const handleSettingsUpdated = (event) => {
      const { storeName: newStoreName, storeLogo: newStoreLogo } = event.detail;
      if (newStoreName) setStoreName(newStoreName.toUpperCase());
      if (typeof newStoreLogo === "string") setStoreLogo(newStoreLogo);
    };
    window.addEventListener("storeSettingsUpdated", handleSettingsUpdated);

    return () => {
      clearInterval(serverTimer);
      window.removeEventListener("setupCompleted", handleSetupCompleted);
      window.removeEventListener("storeSettingsUpdated", handleSettingsUpdated);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isVisibleRef.current) setClock(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadTodayTasks = async () => {
      if (!isVisibleRef.current) return;
      const result = await window.api.invoke("get-today-tasks");
      if (result.success) setTodayTasksCount(result.tasks.length);
    };
    loadTodayTasks();
    const interval = setInterval(loadTodayTasks, 30000);
    const unsubReminder = window.api.on("task-reminder", (task) => {
      setReminderDialog({ open: true, task });
    });
    return () => {
      clearInterval(interval);
      if (unsubReminder) unsubReminder();
    };
  }, []);

  useEffect(() => {
    const loadInsights = async () => {
      if (!isVisibleRef.current) return;
      try {
        const res = await window.api.invoke("get-insights");
        if (res?.success) {
          setInsights(res.rows || []);
          setInsightsUnread(res.unread || 0);
        }
      } catch {}
    };
    loadInsights();
    const interval = setInterval(loadInsights, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadLowStock = async () => {
      if (!isVisibleRef.current) return;
      try {
        const res = await window.api.invoke("get-low-stock-count");
        setLowStockCount(res.count || 0);
      } catch {}
    };
    loadLowStock();
    const interval = setInterval(loadLowStock, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (location.pathname === "/inventory") {
      window.api.invoke("get-low-stock-count").then((res) => {
        if (res && res.success) setLowStockCount(res.count || 0);
      });
    }
  }, [location.pathname]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ctrl-n"));
      }
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        const path = location.pathname;
        if (path === "/suppliers") {
          window.dispatchEvent(new CustomEvent("ctrl-p"));
        } else {
          navigate("/suppliers");
        }
      }
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
      }
      if (e.key === "F1") {
        e.preventDefault();
        setShortcutsDialogOpen(true);
      }
      if (e.key === "F5") {
        e.preventDefault();
        navigate("/");
      }
      if (e.key === "F12") {
        e.preventDefault();
        logout();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [location.pathname, navigate, logout]);

  const isAdmin = cashier?.role === "admin";

  const navSections = [
    {
      title: "Punto de Venta",
      items: [
        { text: "Terminal de Venta", icon: <MonitorSmartphone />, path: "/" },
        { text: "Caja", icon: <Banknote />, path: "/end-of-day" },
        ...(isAdmin
          ? [
              {
                text: "Turnos y Cortes",
                icon: <ClipboardCheck />,
                path: "/register-history",
              },
            ]
          : []),
      ],
    },
    {
      title: "Transacciones",
      items: [
        {
          text: "Transacciones",
          icon: <ReceiptText />,
          path: "/transacciones",
        },
        { text: "Servicios", icon: <Zap />, path: "/servicios" },
        { text: "Clientes", icon: <Users />, path: "/customers" },
      ],
    },
    {
      title: "Inventario",
      items: [
        { text: "Productos", icon: <Package />, path: "/inventory" },
        { text: "Categorías", icon: <Tags />, path: "/categories" },
        { text: "Proveedores", icon: <Truck />, path: "/suppliers" },
        {
          text: "Movimientos",
          icon: <ArrowLeftRight />,
          path: "/stock-movements",
        },
      ],
    },
    ...(isAdmin
      ? [
          {
            title: "Reportes",
            items: [
              { text: "Reportes", icon: <BarChart3 />, path: "/reports" },
            ],
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            title: "Sistema",
            items: [
              { text: "Cajeros", icon: <Users />, path: "/cashiers" },
              { text: "Respaldo", icon: <DatabaseBackup />, path: "/backup" },
              {
                text: "Catálogo de referencia",
                icon: <ScrollText />,
                path: "/catalog-reference",
              },
            ],
          },
        ]
      : []),
  ];

  const handleOpenScaleDialog = async () => {
    setScaleDialogOpen(true);
    setScaleError("");
    setScaleLoading(true);
    try {
      const ports = await window.api.invoke("list-serial-ports");
      setScalePorts(ports);
    } catch {
      setScalePorts([]);
      setScaleError("Error al buscar puertos");
    }
    setScaleLoading(false);
  };

  const handleRefreshPorts = async () => {
    setScaleLoading(true);
    setScaleError("");
    try {
      const ports = await window.api.invoke("list-serial-ports");
      setScalePorts(ports);
    } catch {
      setScalePorts([]);
      setScaleError("Error al buscar puertos");
    }
    setScaleLoading(false);
  };

  const handleConnectScale = async (portPath, closeOnSuccess = true) => {
    setScaleLoading(true);
    setScaleError("");
    localStorage.setItem("scalePort", portPath);
    localStorage.setItem("scaleBaud", scaleBaud);
    try {
      const result = await window.api.invoke(
        "connect-scale",
        portPath,
        parseInt(scaleBaud),
      );
      setScaleReading(result.raw || "");
      setScaleLastWeight(result.weight ?? null);
      if (result.success) {
        setScaleConnected(true);
        setScalePort(portPath);
        setScaleNote(result.error || "");
        if (closeOnSuccess && !result.error) setScaleDialogOpen(false);
      } else {
        setScaleConnected(false);
        setScaleNote("");
        setScaleError(`No se pudo conectar: ${result.error}`);
      }
    } catch (e) {
      setScaleError("Error de conexion");
      setScaleConnected(false);
    }
    setScaleLoading(false);
  };

  const handleProbeScale = async () => {
    if (!scalePort) return;
    setScaleLoading(true);
    setScaleError("");
    try {
      const result = await window.api.invoke(
        "connect-scale",
        scalePort,
        parseInt(scaleBaud),
      );
      setScaleReading(result.raw || "");
      setScaleLastWeight(result.weight ?? null);
      if (result.success) {
        setScaleConnected(true);
        setScaleNote(result.error || "");
        if (result.error) setScaleError("");
      } else {
        setScaleError(`No se pudo conectar: ${result.error}`);
      }
    } catch (e) {
      setScaleError("Error de conexion");
    }
    setScaleLoading(false);
  };

  const handleDisconnectScale = async () => {
    try {
      await window.api.invoke("disconnect-scale");
      setScaleConnected(false);
      setScalePort("");
      setScaleReading("");
      setScaleLastWeight(null);
      setScaleNote("");
      setScaleError("");
      localStorage.removeItem("scalePort");
    } catch {}
  };

  const refreshTodayTasks = async () => {
    const today = await window.api.invoke("get-today-tasks");
    if (today.success) setTodayTasksCount(today.tasks.length);
  };

  const sidebarUserColors = [
    "hsl(var(--category-1))",
    "hsl(var(--category-2))",
    "hsl(var(--category-3))",
    "hsl(var(--category-4))",
    "hsl(var(--category-5))",
    "hsl(var(--category-6))",
  ];

  const renderSidebar = (expanded) => (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden select-none">
<div className="flex-1 overflow-y-auto px-1.5 py-2">
          {navSections.map((section) => (
            <div key={section.title} className="mb-1">
              {expanded && (
                <span className="block px-3 pt-3 pb-1 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground/60">
                  {section.title}
                </span>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  const inventoryAlert = item.path === "/inventory" && lowStockCount > 0;
                  return (
                    <ShadcnTooltip key={item.text}>
                      <TooltipTrigger asChild>
                        <RouterLink
                          to={item.path}
                          onMouseEnter={() => ROUTE_PRELOADERS[item.path]?.()}
                          onFocus={() => ROUTE_PRELOADERS[item.path]?.()}
                          className={cn(
                            "group relative flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all duration-200 outline-none hover:shadow-sm",
                            "active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                            isActive
                              ? "bg-gradient-to-r from-primary/10 to-primary/5 font-semibold text-foreground"
                              : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10",
                            !isActive && item.path === "/" && "bg-primary/[0.08] font-semibold",
                            !expanded && "w-full justify-center px-0",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-200",
                              isActive ? "bg-primary opacity-100" : "opacity-0",
                            )}
                          />
<span
                            className={cn(
                              "inline-flex shrink-0 items-center justify-center [&>svg]:h-[22px] [&>svg]:w-[22px]",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground group-hover:text-foreground",
                              (item.path === "/inventory" ||
                                (item.path === "/end-of-day" &&
                                  register?.status === "open")) &&
                                "relative",
                            )}
                          >
                            {item.icon}
                            {inventoryAlert && (
                              <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-bold text-white">
                                {lowStockCount > 99 ? "99+" : lowStockCount}
                              </span>
                            )}
                            {item.path === "/end-of-day" &&
                              register?.status === "open" && (
                                <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-success ring-2 ring-secondary" />
                              )}
                          </span>
                          {expanded && (
                            <span className="truncate">{item.text}</span>
                          )}
                          {expanded &&
                            item.path === "/end-of-day" &&
                            register?.status === "open" && (
                              <span
                                className="ml-auto text-[11px] font-semibold whitespace-nowrap text-success tabular-nums"
                                title="Efectivo en caja"
                              >
                                {fmtMoney(register.currentCash)}
                              </span>
                            )}
                        </RouterLink>
                      </TooltipTrigger>
                      {inventoryAlert ? (
                        <TooltipContent
                          side={expanded ? "bottom" : "right"}
                          sideOffset={expanded ? 4 : 8}
                        >
                          {lowStockCount > 99
                            ? "Más de 99 productos"
                            : `${lowStockCount} producto(s)`}{" "}
                          con stock bajo
                        </TooltipContent>
                      ) : (
                        !expanded && (
                          <TooltipContent side="right" sideOffset={8}>
                            {item.path === "/end-of-day" &&
                            register?.status === "open"
                              ? `${item.text} · ${fmtMoney(register.currentCash)}`
                              : item.text}
                          </TooltipContent>
                        )
                      )}
                    </ShadcnTooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mx-4 h-px bg-border/50" />

        <div className="px-1.5 py-2">
          <ShadcnTooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate("/configuration")}
                className={cn(
                  "group flex h-11 cursor-pointer items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 outline-none hover:shadow-sm",
                  "hover:bg-black/5 dark:hover:bg-white/10 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  "text-left",
                  location.pathname === "/configuration"
                    ? "bg-gradient-to-r from-primary/10 to-primary/5 font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  expanded ? "w-full px-3" : "w-full justify-center px-0",
                )}
              >
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center justify-center [&>svg]:h-[22px] [&>svg]:w-[22px]",
                    location.pathname === "/configuration"
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <Settings size={22} />
                </span>
                {expanded && <span>Configuración</span>}
              </button>
            </TooltipTrigger>
            {!expanded && (
              <TooltipContent side="right" sideOffset={8}>
                Configuración
              </TooltipContent>
            )}
          </ShadcnTooltip>
        </div>

        <div className="mx-4 h-px bg-border/50" />

        {cashier && (
          <div className="px-1.5 pb-2">
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl transition-colors duration-200",
                expanded ? "px-2 py-1.5" : "flex-col justify-center px-1 py-1",
              )}
            >
              <ShadcnTooltip>
                <TooltipTrigger asChild>
                  <div
                    className="flex h-9 w-9 shrink-0 cursor-default items-center justify-center rounded-full text-sm font-bold text-white shadow-md ring-2 ring-background"
                    style={{
                      backgroundColor:
                        sidebarUserColors[
                          (cashier.id ?? 0) % sidebarUserColors.length
                        ],
                    }}
                  >
                    {(cashier.name || "?").charAt(0).toUpperCase()}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  <span className="font-medium">{cashier.name}</span>
                  <span className="text-muted-foreground ml-1">
                    {cashier.role === "admin" ? "Propietario" : "Cajero"}
                  </span>
                </TooltipContent>
              </ShadcnTooltip>

              {expanded && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground leading-tight">
                    {cashier.name}
                  </div>
                  <div className="text-[0.65rem] text-muted-foreground leading-tight">
                    {cashier.role === "admin" ? "Propietario" : "Cajero"}
                  </div>
                </div>
              )}

              <ShadcnTooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={logout}
                    className={cn(
                      "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-all duration-200 outline-none",
                      "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                      "active:scale-95 focus-visible:ring-2 focus-visible:ring-ring",
                      !expanded && "mt-1 flex h-9 w-9",
                    )}
                  >
                    <LogOut size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Cerrar sesión
                </TooltipContent>
              </ShadcnTooltip>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );

  const clockLabel = clock.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });

  return (
    <TooltipProvider>
      <div className="min-h-screen animate-in fade-in-0 bg-background duration-700 ease-out">
        {/* ─── SIDEBAR (fijo, altura completa, se encima al navbar) ─── */}
        <aside
          style={{ width: drawerOpen ? drawerWidth : miniDrawerWidth }}
          className="fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-border bg-secondary shadow-sm shadow-slate-900/5 transition-[width] duration-300 ease-in-out"
        >
          {/* Logo / encabezado del sidebar: al pulsarlo colapsa/expande */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            title={storeName}
            className="flex h-12 w-full shrink-0 cursor-pointer items-center justify-center outline-none transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            {storeLogo ? (
              <img
                src={storeLogo}
                alt="Logo"
                className="h-8 w-8 shrink-0 rounded-md object-contain"
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
                {storeName.charAt(0) || "P"}
              </span>
            )}
          </button>
          {renderSidebar(drawerOpen)}
        </aside>

        <header
          className="sticky top-0 z-30 relative flex h-12 shrink-0 items-center gap-3 bg-background"
          style={{
            WebkitAppRegion: "drag",
            paddingLeft: (drawerOpen ? drawerWidth : miniDrawerWidth) + 16,
            paddingRight:
              "max(0.75rem, calc(100vw - env(titlebar-area-x) - env(titlebar-area-width)))",
          }}
        >
          <span
            aria-hidden
            className="absolute bottom-0 left-0 h-px bg-border"
            style={{
              right:
                "max(0.75rem, calc(100vw - env(titlebar-area-x) - env(titlebar-area-width)))",
            }}
          />
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden shrink-0 text-sm font-semibold tracking-[0.06em] text-foreground uppercase sm:inline">
              {storeName}
            </span>
            <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="hidden shrink-0 text-[13px] font-medium text-muted-foreground sm:inline">
                {PAGE_META[location.pathname]?.crumb || "Inicio"}
              </span>
              <ChevronRight
                size={12}
                className="hidden shrink-0 text-muted-foreground/40 sm:block"
              />
              <span className="min-w-0 truncate text-lg font-semibold tracking-tight text-foreground">
                {PAGE_META[location.pathname]?.title || "Vendia"}
              </span>
            </div>
          </div>

          <div
            className="ml-auto flex items-center gap-1.5"
            style={{ WebkitAppRegion: "no-drag" }}
          >
            <div className="relative">
              <button
                onClick={() => setInsightsOpen((v) => !v)}
                className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                title="Avisos del negocio"
              >
                <Bell size={16} />
                {insightsUnread > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {insightsUnread}
                  </span>
                )}
              </button>
              {insightsOpen && (
                <div className="absolute right-0 top-11 z-50 w-[340px] rounded-lg border border-border bg-background p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Pulso del negocio</span>
                  </div>
                  {insights.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">Sin avisos por ahora.</p>
                  ) : (
                    <ul className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
                      {insights.map((ins) => (
                        <li
                          key={ins.id}
                          className={cn(
                            "rounded-md border border-border p-2.5 text-left transition-colors hover:bg-muted/50",
                            ins.status === "unread" && "border-l-2 border-l-primary",
                          )}
                        >
                          <button
                            className="w-full text-left"
                            onClick={async () => {
                              await window.api.invoke("mark-insight", { id: ins.id, status: "actioned" });
                              setInsights((prev) => prev.filter((x) => x.id !== ins.id));
                              setInsightsUnread((n) => Math.max(0, n - 1));
                              setInsightsOpen(false);
                              navigate(ins.route || "/reports");
                            }}
                          >
                            <p className="text-[13px] font-semibold text-foreground">{ins.title}</p>
                            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{ins.body}</p>
                            <p className="mt-1 text-[11px] font-medium text-primary">Ver detalle →</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="mt-2 w-full border-t border-border pt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={async () => {
                      const r = await window.api.invoke("run-weekly-pulse");
                      if (r?.success) {
                        const res = await window.api.invoke("get-insights");
                        if (res?.success) { setInsights(res.rows); setInsightsUnread(res.unread); }
                      }
                    }}
                  >
                    Generar pulso semanal ahora
                  </button>
                </div>
              )}
            </div>
            <SystemStatus
              register={register}
              clock={clockLabel}
              serverRunning={serverRunning}
              scaleConnected={scaleConnected}
              tasksCount={todayTasksCount}
              isDark={isDark}
              onToggleTheme={toggleMode}
              onOpenScale={handleOpenScaleDialog}
              onOpenTasks={() => setTaskDialogOpen(true)}
            />
            <UpdateButton />
          </div>
        </header>

        {/* ─── MAIN: se desplaza según el ancho del sidebar ─── */}
        <main
          className="flex-1 p-4 transition-[margin-left] duration-300 ease-in-out md:p-6"
          style={{ marginLeft: drawerOpen ? drawerWidth : miniDrawerWidth }}
        >
          <Suspense fallback={<RouteShellSkeleton />}>
            <div key={location.pathname} className="animate-enter">
              <Outlet />
            </div>
          </Suspense>
        </main>

        {/* ─── ATAJOS DE TECLADO ─── */}
        <Dialog
          open={shortcutsDialogOpen}
          onOpenChange={(o) => setShortcutsDialogOpen(o)}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5 text-lg">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <ScanLine size={20} className="text-primary" />
                </span>
                Atajos de teclado
              </DialogTitle>
              <DialogDescription className="text-left">
                Gestiona más rápido con el teclado. Pulsa la tecla en cualquier
                pantalla.
              </DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[62vh] gap-1.5 overflow-y-auto py-1 pr-1">
              {[
                { keys: ["F1"], desc: "Mostrar esta ayuda" },
                { keys: ["F5"], desc: "Ir a la terminal de venta" },
                { keys: ["F2"], desc: "Agregar producto sin código" },
                { keys: ["F6"], desc: "Descuento manual del producto" },
                { keys: ["F3"], desc: "Disminuir cantidad (terminal)" },
                { keys: ["F4"], desc: "Aumentar cantidad (terminal)" },
                { keys: ["F8"], desc: "Finalizar venta (terminal)" },
                { keys: ["F10"], desc: "Retirar efectivo (terminal)" },
                { keys: ["F11"], desc: "Cerrar caja (sin venta en curso)" },
                { keys: ["F12"], desc: "Cerrar sesión" },
                { keys: ["Ctrl", "Q"], desc: "Enfocar búsqueda (terminal)" },
                { keys: ["Ctrl", "B"], desc: "Colapsar menú lateral" },
                { keys: ["Ctrl", "N"], desc: "Nuevo producto en inventario" },
                { keys: ["Ctrl", "P"], desc: "Ir a proveedores / Nuevo proveedor" },
                { keys: ["↑", "↓"], desc: "Navegar resultados de búsqueda" },
                { keys: ["Enter"], desc: "Confirmar en diálogos" },
                { keys: ["Esc"], desc: "Cerrar sugerencias / diálogos" },
              ].map(({ keys, desc }) => (
                <div
                  key={keys.join("+")}
                  className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 px-3 py-2 transition-colors hover:bg-muted/80"
                >
                  <span className="flex-1 truncate text-sm font-medium text-foreground">
                    {desc}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {keys.map((k, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && (
                          <span className="text-xs text-muted-foreground">+</span>
                        )}
                        <Kbd>{k}</Kbd>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShortcutsDialogOpen(false)}
                className="w-full sm:w-auto"
              >
                Cerrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* ─── CAJA ANTERIOR ABIERTA (CAMBIO DE TURNO) ─── */}
        <Modal
          open={!!handover}
          onClose={() => {}}
          disableBackdropClose
          onKeyDown={(e) => {
            if (e.key === "Enter" && !handoverLoading) {
              e.preventDefault();
              handleHandoverConfirm();
            }
          }}
        >
          <ModalHeader className="flex-col items-center pt-6 text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/15">
              <TriangleAlert size={28} className="text-amber-600" />
            </div>
            <h2 className="text-base font-bold text-foreground">
              Caja anterior abierta
            </h2>
          </ModalHeader>
          <ModalBody className="text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              La caja sigue abierta por{" "}
              <strong className="text-foreground">
                {handover?.opener_name || "otro cajero"}
              </strong>
              {handover?.opened_at
                ? ` a las ${formatMXTime(handover.opened_at)}`
                : ""}
              . Para trabajar con tu propia caja, ciérrala y abre una nueva.
            </p>
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Efectivo a declarar
              </span>
              <span className="block text-2xl font-extrabold text-emerald-600">
                ${(handover?.currentCash || 0).toFixed(2)}
              </span>
              <span className="mt-1 block text-[0.68rem] text-muted-foreground">
                Se declarará como cierre y quedará como apertura de tu nueva
                caja.
              </span>
            </div>
          </ModalBody>
          <ModalFooter className="flex-col">
            <Btn
              variant="success"
              className="w-full"
              disabled={handoverLoading}
              onClick={handleHandoverConfirm}
            >
              {handoverLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              Cerrar y abrir nueva caja
            </Btn>
            <Btn
              variant="ghost"
              className="w-full"
              disabled={handoverLoading}
              onClick={() => {
                setHandover(null);
                logout();
              }}
            >
              Ahora no (cerrar sesión)
            </Btn>
          </ModalFooter>
        </Modal>

        {/* ─── BÁSCULA ─── */}
        <Modal open={scaleDialogOpen} onClose={() => setScaleDialogOpen(false)}>
          <ModalHeader>
            <Scale
              size={20}
              className={
                scaleConnected ? "text-emerald-600" : "text-muted-foreground"
              }
            />
            <h2 className="text-base font-bold text-foreground">Báscula</h2>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3 py-1">
              <div className="flex items-center gap-2">
                <StatusDot ok={scaleConnected} />
                <span
                  className={cn(
                    "text-sm font-semibold",
                    scaleConnected ? "text-emerald-600" : "text-destructive",
                  )}
                >
                  {scaleConnected ? "Conectada" : "Desconectada"}
                </span>
              </div>

              {scaleConnected ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Puerto:{" "}
                    <strong className="text-foreground">{scalePort}</strong>
                  </p>
                  {scaleReading && (
                    <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                      <p>
                        Última lectura:{" "}
                        <strong className="text-foreground">
                          {scaleReading}
                        </strong>
                      </p>
                      {scaleLastWeight != null && (
                        <p className="mt-0.5">
                          Peso:{" "}
                          <strong className="text-foreground">
                            {scaleLastWeight}
                          </strong>
                        </p>
                      )}
                    </div>
                  )}
                  {scaleNote && <Alert tone="warning">{scaleNote}</Alert>}
                  {scaleError && <Alert tone="error">{scaleError}</Alert>}
                  <Btn
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    disabled={scaleLoading}
                    onClick={handleProbeScale}
                  >
                    {scaleLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Probar lectura
                  </Btn>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Selecciona el puerto COM:
                    </span>
                    <Btn
                      variant="ghost"
                      size="sm"
                      disabled={scaleLoading}
                      onClick={handleRefreshPorts}
                    >
                      Refrescar
                    </Btn>
                  </div>
                  {scaleError && <Alert tone="error">{scaleError}</Alert>}
                  {scaleLoading && (
                    <p className="text-sm text-muted-foreground">
                      Buscando puertos...
                    </p>
                  )}
                  {!scaleLoading && scalePorts.length === 0 && (
                    <p className="text-sm italic text-muted-foreground">
                      No se detectaron puertos. Verifica la conexión USB.
                    </p>
                  )}
                  {!scaleLoading && scalePorts.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {scalePorts.map((p) => (
                        <button
                          key={p.path}
                          disabled={scaleLoading}
                          onClick={() => handleConnectScale(p.path)}
                          className={cn(
                            "cursor-pointer rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors",
                            scalePort === p.path
                              ? "bg-primary text-primary-foreground"
                              : "border border-border text-foreground hover:bg-muted",
                          )}
                        >
                          {p.path}
                          {p.manufacturer ? ` - ${p.manufacturer}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      Baud rate
                    </span>
                    <select
                      value={scaleBaud}
                      onChange={(e) => setScaleBaud(e.target.value)}
                      className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="9600">9600</option>
                      <option value="19200">19200</option>
                      <option value="38400">38400</option>
                      <option value="57600">57600</option>
                      <option value="115200">115200</option>
                    </select>
                  </label>
                </>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            {scaleConnected && (
              <Btn
                variant="destructive"
                className="mr-auto"
                onClick={handleDisconnectScale}
              >
                Desconectar
              </Btn>
            )}
            <CancelButton onClick={() => setScaleDialogOpen(false)}>
              Cerrar
            </CancelButton>
          </ModalFooter>
        </Modal>

        {/* ─── TAREAS (lazy) ─── */}
        <Suspense fallback={null}>
          <TaskDialog
            open={taskDialogOpen}
            onClose={() => setTaskDialogOpen(false)}
            onTasksChange={refreshTodayTasks}
          />
        </Suspense>

        {/* ─── RECORDATORIO DE TAREA ─── */}
        <Modal
          open={reminderDialog.open}
          onClose={() => setReminderDialog({ open: false, task: null })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setReminderDialog({ open: false, task: null });
            }
          }}
        >
          <ModalHeader className="flex-col items-center text-center">
            <CalendarDays size={40} className="mb-1 text-amber-500" />
            <h2 className="text-base font-bold text-foreground">
              Recordatorio
            </h2>
          </ModalHeader>
          <ModalBody className="text-center">
            <p className="mb-1 text-[1.05rem] font-semibold text-foreground">
              {reminderDialog.task?.title}
            </p>
            {reminderDialog.task?.task_time && (
              <p className="text-sm text-muted-foreground">
                Hora: {reminderDialog.task.task_time}
              </p>
            )}
          </ModalBody>
          <ModalFooter className="justify-center pb-6">
            <Btn onClick={() => setReminderDialog({ open: false, task: null })}>
              OK
            </Btn>
          </ModalFooter>
        </Modal>
      </div>
    </TooltipProvider>
  );
};

export default Layout;
