import React, { useEffect, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Clock,
  HandCoins,
  Inbox,
  Keyboard,
  LogOut,
  Moon,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Scale,
  ScanLine,
  Settings,
  Sun,
  UserPlus,
  Wallet,
  ArrowDownToLine,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Kbd } from "./ui/kbd";
import { Badge } from "./ui/badge";
import { InitialsAvatar } from "./ui/initials-avatar";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/utils/format";
import { useFeatures } from "../lib/useFeatures";
import { useToast } from "./ToastProvider";

/* ────────────────────────────────────────────────────────────
   Paleta de comandos (Ctrl/⌘ + K).
   - Sin texto: Recientes, pantallas y acciones.
   - Con texto: además busca DATOS — productos (precio y stock, con
     Agregar / Editar / + Stock), clientes (saldo, estado de cuenta y abono)
     y ventas por folio. Enter ejecuta la acción principal de la fila; los
     botones de la derecha, las secundarias.
──────────────────────────────────────────────────────────── */

const RECENTS_KEY = "paletteRecents";
const RECENTS_MAX = 6;

const readRecents = () => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const pushRecent = (entry) => {
  try {
    const list = readRecents().filter((r) => r.key !== entry.key);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([entry, ...list].slice(0, RECENTS_MAX)));
  } catch {}
};

const ROW =
  "mx-1.5 gap-0 px-2 py-2 data-[selected=true]:bg-primary/10 data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-primary/30";
const HEADING = "[&_[cmdk-group-heading]]:px-3.5";

function RowIcon({ children, tone = "neutral" }) {
  return (
    <span
      className={cn(
        "mr-2.5 flex size-8 shrink-0 items-center justify-center rounded-md [&>svg]:size-4",
        tone === "primary" && "bg-primary/10 text-primary",
        tone === "neutral" && "border border-border/70 bg-muted/60 text-muted-foreground",
        tone === "danger" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

// Botones de una fila de datos. `active` = el marcado con ← → (Enter lo
// ejecuta); con el ratón se pulsan directo sin disparar la selección de cmdk.
function RowButtons({ acts, active }) {
  return (
    <span className="ml-2 flex shrink-0 items-center gap-1">
      {acts.map(({ icon: Icon, label, run }, i) => (
        <button
          key={label}
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            run();
          }}
          className={cn(
            "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
            i === active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </span>
  );
}

const fmtShortDate = (sqlDate) =>
  new Date(`${String(sqlDate).replace(" ", "T")}Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "America/Mexico_City",
  });

const CommandPalette = ({
  open,
  onOpenChange,
  sections = [],
  register,
  isDark,
  onToggleTheme,
  onOpenScale,
  onOpenTasks,
  onOpenShortcuts,
  onRefreshPulse,
  onLogout,
}) => {
  const navigate = useNavigate();
  const notify = useToast();
  const features = useFeatures();
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [balances, setBalances] = useState({});
  const [recents, setRecents] = useState([]);
  const [hasLastTicket, setHasLastTicket] = useState(false);
  // Fila elegida (valor de cmdk) y botón marcado dentro de ella con ← →.
  const [selected, setSelected] = useState("");
  const [actionIdx, setActionIdx] = useState(0);

  // Al abrir: limpia, carga recientes, saldos de fiado y si hay último ticket.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setProducts([]);
    setCustomers([]);
    setSales([]);
    setRecents(readRecents());
    try {
      setHasLastTicket(!!sessionStorage.getItem("lastReceiptHtml"));
    } catch {
      setHasLastTicket(false);
    }
    if (features.credit) {
      window.api
        .invoke("get-credit-balances")
        .then((r) => setBalances(r?.byCustomer || {}))
        .catch(() => {});
    }
  }, [open, features.credit]);

  // Búsqueda de datos con espera corta mientras se escribe.
  useEffect(() => {
    const q = search.trim();
    if (!open || q.length < 2) {
      setProducts([]);
      setCustomers([]);
      setSales([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const looksLikeFolio = /\d{3,}/.test(q);
      const [p, c, s] = await Promise.all([
        window.api.invoke("search-products", q).catch(() => []),
        features.customers ? window.api.invoke("search-customers", q).catch(() => []) : [],
        looksLikeFolio ? window.api.invoke("find-sales-by-folio", q).catch(() => []) : [],
      ]);
      if (cancelled) return;
      setProducts((Array.isArray(p) ? p : []).slice(0, 5));
      setCustomers((Array.isArray(c) ? c : []).slice(0, 4));
      setSales(Array.isArray(s) ? s : []);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, open, features.customers]);

  const close = () => onOpenChange(false);
  const go = (path, state, recent) => {
    if (recent) pushRecent(recent);
    close();
    navigate(path, state ? { state } : undefined);
  };
  const run = (fn, recent) => {
    if (recent) pushRecent(recent);
    close();
    fn?.();
  };
  // Producto/cliente/venta elegidos: el reciente re-busca por su nombre.
  const rememberQuery = (label) => pushRecent({ key: `q:${label}`, kind: "query", label });

  const registerOpen = register?.status === "open";

  const actions = [
        { id: "terminal", label: "Ir a Terminal de Venta", icon: <ScanLine />, hint: "F5", onSelect: () => go("/") },
        {
          id: "register",
          label: registerOpen ? "Ir a Corte de caja" : "Abrir caja",
          icon: <Banknote />,
          onSelect: () => go("/end-of-day"),
        },
        { id: "new-product", label: "Nuevo producto", icon: <PackagePlus />, onSelect: () => go("/inventory", { newProduct: true }) },
        features.customers && {
          id: "new-customer",
          label: "Nuevo cliente",
          icon: <UserPlus />,
          onSelect: () => go("/customers", { newCustomer: true }),
        },
        registerOpen && {
          id: "withdraw",
          label: "Registrar retiro de efectivo",
          icon: <ArrowDownToLine />,
          onSelect: () => {
            localStorage.setItem("eodPendingAction", "withdraw");
            go("/end-of-day");
          },
        },
        {
          id: "drawer",
          label: "Abrir cajón de dinero",
          icon: <Inbox />,
          onSelect: () =>
            run(() =>
              window.api
                .invoke("open-cash-drawer")
                .then((r) => r?.success === false && notify(r.error || "No se pudo abrir el cajón", "error"))
                .catch(() => notify("No se pudo abrir el cajón", "error")),
            ),
        },
        hasLastTicket && {
          id: "reprint",
          label: "Imprimir el último ticket",
          icon: <Printer />,
          onSelect: () =>
            run(async () => {
              try {
                const html = sessionStorage.getItem("lastReceiptHtml");
                const r = await window.api.invoke("print-receipt", html);
                if (r?.success) notify("Ticket enviado a la impresora", "success");
                else notify(r?.error || "No se pudo imprimir", "error");
              } catch {
                notify("No se pudo imprimir", "error");
              }
            }),
        },
        {
          id: "theme",
          label: isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
          icon: isDark ? <Sun /> : <Moon />,
          onSelect: () => run(onToggleTheme),
        },
        // Sin báscula habilitada en esta caja, la acción no aparece.
        onOpenScale && { id: "scale", label: "Conectar o probar báscula", icon: <Scale />, onSelect: () => run(onOpenScale) },
        { id: "tasks", label: "Tareas del día", icon: <CalendarDays />, onSelect: () => run(onOpenTasks) },
        { id: "pulse", label: "Actualizar avisos", icon: <RefreshCw />, onSelect: () => run(onRefreshPulse) },
        { id: "config", label: "Abrir Configuración", icon: <Settings />, onSelect: () => go("/configuration") },
        { id: "shortcuts", label: "Ver atajos de teclado", icon: <Keyboard />, hint: "F1", onSelect: () => run(onOpenShortcuts) },
        { id: "logout", label: "Cerrar sesión", icon: <LogOut />, hint: "F12", danger: true, onSelect: () => run(onLogout) },
  ].filter(Boolean);

  const actionById = Object.fromEntries(actions.map((a) => [a.id, a]));
  const screenByPath = {};
  sections.forEach((s) => s.items.forEach((i) => (screenByPath[i.path] = { ...i, section: s.title })));

  const showRecents = search.trim() === "" && recents.length > 0;

  // Acciones de cada fila de datos, en el orden de sus botones. La primera es
  // la de Enter; ← → recorren las demás.
  const addToCart = (p) => {
    rememberQuery(p.name);
    close();
    window.__paletteAddProduct = p;
    navigate("/");
    window.dispatchEvent(new Event("palette-add-product"));
  };
  const productActions = (p) => [
    { icon: Plus, label: "Agregar", run: () => addToCart(p) },
    {
      icon: Pencil,
      label: "Editar",
      run: () => {
        rememberQuery(p.name);
        go("/inventory", { editProductId: p.id });
      },
    },
    {
      icon: PackagePlus,
      label: "Stock",
      run: () => {
        rememberQuery(p.name);
        go("/inventory", { addStockProductId: p.id });
      },
    },
  ];
  const customerActions = (c, balance) => {
    const openAccount = (panel) => {
      rememberQuery(c.name);
      go("/customers", { openAccountId: c.id, accountPanel: panel });
    };
    const list = [{ icon: Wallet, label: "Cuenta", run: () => openAccount(null) }];
    if (balance > 0) list.push({ icon: HandCoins, label: "Abonar", run: () => openAccount("pay") });
    return list;
  };
  const rowActions = {};
  products.forEach((p) => (rowActions[`producto-${p.id}`] = productActions(p)));
  customers.forEach((c) => {
    const balance = features.credit ? balances[c.id]?.balance || 0 : 0;
    rowActions[`cliente-${c.id}`] = customerActions(c, balance);
  });

  const onKeyDown = (e) => {
    const acts = rowActions[selected];
    if (!acts || acts.length < 2) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActionIdx((i) => (i + step + acts.length) % acts.length);
    } else if (e.key === "Enter" && actionIdx > 0) {
      e.preventDefault();
      acts[actionIdx].run();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 border-border/80 p-0 shadow-2xl sm:rounded-xl">
        <DialogTitle className="sr-only">Buscar o ejecutar una acción</DialogTitle>

        <Command
          loop
          value={selected}
          onValueChange={(v) => {
            setSelected(v);
            setActionIdx(0);
          }}
          onKeyDown={onKeyDown}
        >
          <CommandInput
            value={search}
            onValueChange={(v) => {
              setSearch(v);
              if (v.trim().length < 2) {
                setProducts([]);
                setCustomers([]);
                setSales([]);
              }
            }}
            placeholder="Busca un producto, cliente, folio, pantalla o acción…"
            className="text-[15px]"
          />

          <CommandList className="max-h-[60vh] py-1.5">
            {/* Los resultados de datos (forceMount) no cuentan para cmdk. */}
            {products.length + customers.length + sales.length === 0 && (
              <CommandEmpty className="px-4 py-8 text-center text-sm text-muted-foreground">
                Sin resultados para esa búsqueda.
              </CommandEmpty>
            )}

            {/* ─── Recientes ─── */}
            <CommandGroup heading="Recientes" className={HEADING}>
                {showRecents && recents.map((r) => {
                  const screen = r.kind === "screen" && screenByPath[r.path];
                  const action = r.kind === "action" && actionById[r.id];
                  if (r.kind === "screen" && !screen) return null;
                  if (r.kind === "action" && !action) return null;
                  return (
                    <CommandItem
                      key={r.key}
                      value={`reciente ${r.label}`}
                      onSelect={() => {
                        if (screen) go(screen.path, null, r);
                        else if (action) action.onSelect();
                        else setSearch(r.label);
                      }}
                      className={ROW}
                    >
                      <RowIcon>{screen ? screen.icon : action ? action.icon : <Clock />}</RowIcon>
                      <span className="truncate text-[14px] font-medium">{r.label}</span>
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">
                        {screen ? screen.section : action ? "Acción" : "Búsqueda"}
                      </span>
                    </CommandItem>
                  );
                })}
            </CommandGroup>

            {/* ─── Productos ─── */}
            <CommandGroup forceMount heading="Productos" className={cn(HEADING, products.length === 0 && "hidden")}>
              {products.map((p) => {
                const stock = Number(p.stock) || 0;
                const value = `producto-${p.id}`;
                const acts = rowActions[value];
                return (
                  <CommandItem key={value} forceMount value={value} onSelect={acts[0].run} className={ROW}>
                    {p.image_path ? (
                      <img src={p.image_path} alt="" className="mr-2.5 size-8 shrink-0 rounded-md border border-border/60 object-cover" />
                    ) : (
                      <InitialsAvatar id={p.id} name={p.name} className="mr-2.5 size-8 rounded-md" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        <span className="font-semibold text-foreground">{fmtMoney(p.price)}</span>
                        {" · "}
                        <span className={cn(stock <= 0 && "font-medium text-destructive dark:text-red-400")}>
                          {stock > 0 ? `${p.sale_unit === "weight" ? Number(stock.toFixed(2)) : stock} en stock` : "Sin stock"}
                        </span>
                      </span>
                    </span>
                    <RowButtons acts={acts} active={selected === value ? actionIdx : -1} />
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {/* ─── Clientes ─── */}
            <CommandGroup forceMount heading="Clientes" className={cn(HEADING, customers.length === 0 && "hidden")}>
              {customers.map((c) => {
                const balance = features.credit ? balances[c.id]?.balance || 0 : 0;
                const value = `cliente-${c.id}`;
                const acts = rowActions[value];
                const showButtons = features.credit && (c.credit_enabled || balance > 0);
                return (
                  <CommandItem key={value} forceMount value={value} onSelect={acts[0].run} className={ROW}>
                    <InitialsAvatar id={c.id} name={c.name} className="mr-2.5 size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {balance > 0 ? (
                          <span className="font-medium text-destructive dark:text-red-400">Debe {fmtMoney(balance)}</span>
                        ) : (
                          c.phone || c.tier_name || "Cliente"
                        )}
                      </span>
                    </span>
                    {showButtons && <RowButtons acts={acts} active={selected === value ? actionIdx : -1} />}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {/* ─── Ventas por folio ─── */}
            <CommandGroup forceMount heading="Ventas" className={cn(HEADING, sales.length === 0 && "hidden")}>
              {sales.map((sale) => (
                <CommandItem
                  key={`venta-${sale.id}`}
                  forceMount
                  value={`venta-${sale.id}`}
                  onSelect={() => {
                    rememberQuery(sale.folio);
                    go("/transacciones", { saleId: sale.id });
                  }}
                  className={ROW}
                >
                  <RowIcon tone="primary">
                    <Receipt />
                  </RowIcon>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] font-medium">
                      {sale.folio}
                      {sale.status === "cancelado" && (
                        <Badge variant="soft-destructive" className="px-1.5 py-0">
                          Cancelada
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {fmtMoney(sale.total)} · {fmtShortDate(sale.created_at)}
                      {sale.customer_name ? ` · ${sale.customer_name}` : ""}
                    </span>
                  </span>
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">Ver venta</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {/* ─── Pantallas ─── */}
            {sections.map((section) => (
              <CommandGroup key={section.title} heading={section.title} className={HEADING}>
                {section.items.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`${item.text} ${section.title}`}
                    onSelect={() =>
                      go(item.path, null, { key: `s:${item.path}`, kind: "screen", path: item.path, label: item.text })
                    }
                    className={ROW}
                  >
                    <RowIcon>{item.icon}</RowIcon>
                    <span className="truncate text-[14px] font-medium">{item.text}</span>
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">{section.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {/* ─── Acciones ─── */}
            <CommandGroup heading="Acciones" className={HEADING}>
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  value={action.label}
                  onSelect={() => {
                    pushRecent({ key: `a:${action.id}`, kind: "action", id: action.id, label: action.label });
                    action.onSelect();
                  }}
                  className={ROW}
                >
                  <RowIcon tone={action.danger ? "danger" : "primary"}>{action.icon}</RowIcon>
                  <span className={cn("truncate text-[14px] font-medium", action.danger && "text-destructive")}>
                    {action.label}
                  </span>
                  {action.hint && (
                    <span className="ml-auto pl-3">
                      <Kbd className="h-5 px-1.5 text-[10px] shadow-none">{action.hint}</Kbd>
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">↑</Kbd>
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">↓</Kbd>
              navegar
              <Kbd className="ml-1 h-5 px-1.5 text-[10px] shadow-none">←</Kbd>
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">→</Kbd>
              opciones
              <Kbd className="ml-1 h-5 px-1.5 text-[10px] shadow-none">Enter</Kbd>
              abrir
              <Kbd className="ml-1 h-5 px-1.5 text-[10px] shadow-none">Esc</Kbd>
              cerrar
            </span>
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">Ctrl</Kbd>
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">K</Kbd>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
