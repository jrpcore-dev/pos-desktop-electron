import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgePercent,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { useDbChanges } from "../lib/useDbChanges";
import { useToast } from "./ToastProvider";
import PageHeader from "./PageHeader";
import AddProductModal from "./AddProductModal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { Kbd } from "./ui/kbd";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { DateRangePicker } from "./ui/date-range-picker";
import { cn } from "@/lib/utils";
import { fmtMoney } from "../utils/format";
import { promoLabel } from "../utils/cartMath";

/* ────────────────────────────────────────────────────────────
   Promociones (Configuración → Funciones → Promociones
   avanzadas). Tres vistas:
   · De productos: tablero de las promos configuradas en cada
     producto; se editan en su modal.
   · Por categoría o marca: un % a todo un grupo.
   · Paquetes: productos distintos por un precio.
──────────────────────────────────────────────────────────── */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const STATUS = {
  active: { label: "Activa", variant: "soft-success" },
  scheduled: { label: "Programada", variant: "soft-warning" },
  expired: { label: "Vencida", variant: "soft-neutral" },
  paused: { label: "Pausada", variant: "soft-neutral" },
};

const statusOf = ({ start_date, end_date, is_active = 1 }) => {
  if (Number(is_active) !== 1) return "paused";
  const t = todayISO();
  if (start_date && t < start_date) return "scheduled";
  if (end_date && t > end_date) return "expired";
  return "active";
};

const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : iso;
};

const validityText = (p) =>
  p.start_date && p.end_date
    ? `del ${fmtDate(p.start_date)} al ${fmtDate(p.end_date)}`
    : p.end_date
      ? `hasta el ${fmtDate(p.end_date)}`
      : p.start_date
        ? `desde el ${fmtDate(p.start_date)}`
        : "sin fecha de fin";

const UNIT_SUFFIX = { box: " por caja", pack: " por paquete", weight: " por kg" };

const productPromoLabels = (p) => {
  const out = [];
  if (p.promo_fixed_price > 0) out.push(`Precio fijo ${fmtMoney(p.promo_fixed_price)}`);
  else if (p.discount_percent > 0) out.push(`-${p.discount_percent}%`);
  for (const t of p.prices || []) {
    const unit = p.sale_unit === "package" && t.unit === "box" ? " por paquete" : UNIT_SUFFIX[t.unit] || "";
    out.push(`${promoLabel(t)}${unit}`);
  }
  return out;
};

const StatusBadge = ({ status }) => (
  <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
);

// Fila de una promo en las listas (producto, grupo o paquete).
const PromoRow = ({ icon: Icon, tone, title, subtitle, chips, status, actions }) => (
  <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-14px_rgba(15,23,42,0.35)] sm:flex-row sm:items-center">
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        tone,
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {status && <StatusBadge status={status} />}
      </div>
      {subtitle && (
        <p className="mt-0.5 text-[0.8rem] text-muted-foreground">{subtitle}</p>
      )}
      {chips?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-md bg-primary/10 px-2 py-0.5 text-[0.72rem] font-semibold text-primary"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
  </div>
);

const IconAction = ({ label, onClick, danger, children }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={cn(
      "text-muted-foreground",
      danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:text-foreground",
    )}
  >
    {children}
  </Button>
);

// Enter guarda el diálogo, salvo que venga de algo que usa Enter por su
// cuenta: botones, selectores, el calendario (portal) o el buscador.
const enterSaves = (e) =>
  e.key === "Enter" &&
  !e.shiftKey &&
  !e.defaultPrevented &&
  e.target.tagName !== "BUTTON" &&
  !e.target.closest?.('[role="combobox"],[data-radix-popper-content-wrapper]');

const KeyHints = () => (
  <span className="mr-auto hidden items-center gap-3 text-[0.75rem] text-muted-foreground sm:flex">
    <span className="flex items-center gap-1">
      <Kbd>Enter</Kbd> Guardar
    </span>
    <span className="flex items-center gap-1">
      <Kbd>Esc</Kbd> Cancelar
    </span>
  </span>
);

// Vigencia con el mismo selector de rango que el modal del producto.
const DateFields = ({ start, end, onChange }) => (
  <div className="space-y-1.5">
    <Label>Vigencia</Label>
    <DateRangePicker
      value={{ from: start || undefined, to: end || undefined }}
      onApply={(r) => onChange(r?.from || "", r?.to || "")}
      placeholder="Sin vigencia — siempre activa"
      showClear
      align="start"
      className="h-10 w-full"
    />
  </div>
);

// ── Promo por categoría o marca ────────────────────────────────────────────
const EMPTY_GROUP = {
  scope: "category",
  category_id: "",
  brand: "",
  percent: "",
  name: "",
  start_date: "",
  end_date: "",
  is_active: 1,
};

const GroupPromoDialog = ({ open, initial, categories, brands, onClose, onSaved }) => {
  const notify = useToast();
  const percentRef = useRef(null);
  const [f, setF] = useState(EMPTY_GROUP);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open)
      setF(
        initial
          ? {
              ...EMPTY_GROUP,
              ...initial,
              category_id: initial.category_id ? String(initial.category_id) : "",
              percent: String(initial.percent ?? ""),
            }
          : EMPTY_GROUP,
      );
  }, [open, initial]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const count =
    f.scope === "brand"
      ? brands.find((b) => b.brand === f.brand)?.products
      : categories.find((c) => String(c.id) === f.category_id)?.product_count;

  const save = async () => {
    setSaving(true);
    try {
      const res = await window.api.invoke("save-group-promo", f);
      if (!res?.success) return notify(res?.error || "No se pudo guardar", "error");
      notify("Promoción guardada", "success");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          percentRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (enterSaves(e) && !saving) {
            e.preventDefault();
            save();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{initial ? "Editar promoción" : "Nueva promoción por grupo"}</DialogTitle>
          <DialogDescription>
            Un descuento para todos los productos de una categoría o marca.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Aplica a</Label>
              <Select value={f.scope} onValueChange={set("scope")}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">Categoría</SelectItem>
                  <SelectItem value="brand">Marca</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{f.scope === "brand" ? "Marca" : "Categoría"}</Label>
              {f.scope === "brand" ? (
                <Select value={f.brand} onValueChange={set("brand")}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Elige una marca" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.brand} value={b.brand}>
                        {b.brand}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={f.category_id} onValueChange={set("category_id")}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Elige una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          {count != null && (
            <p className="-mt-2 text-[0.75rem] text-muted-foreground">
              Aplica a {count} producto{count === 1 ? "" : "s"}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="group-percent">Descuento (%)</Label>
              <Input
                id="group-percent"
                ref={percentRef}
                type="number"
                min={1}
                max={99}
                value={f.percent}
                onChange={(e) => set("percent")(e.target.value)}
                placeholder="15"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Nombre (opcional)</Label>
              <Input
                id="group-name"
                value={f.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder="Ej. Limpieza"
              />
            </div>
          </div>
          <DateFields
            start={f.start_date}
            end={f.end_date}
            onChange={(from, to) => setF((p) => ({ ...p, start_date: from, end_date: to }))}
          />
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <Label htmlFor="group-active">Activa</Label>
            <Switch
              id="group-active"
              checked={Number(f.is_active) === 1}
              onCheckedChange={(v) => set("is_active")(v ? 1 : 0)}
            />
          </div>
          <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-[0.8rem] text-sky-800 dark:text-info">
            Si un producto ya tiene su propia promo, se cobra la más barata. No se acumulan,
            y no aplica a clientes con precio especial.
          </p>
        </div>
        <DialogFooter>
          <KeyHints />
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Paquete ────────────────────────────────────────────────────────────────
const EMPTY_BUNDLE = { name: "", price: "", start_date: "", end_date: "", is_active: 1, slots: [] };

// Buscador para elegir los productos de un lugar del paquete.
// Teclado: ↑/↓ mueven la selección, Enter agrega la marcada y Esc limpia la
// búsqueda sin cerrar el diálogo.
const ProductPicker = ({ onPick, exclude }) => {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [hi, setHi] = useState(0);
  const listRef = useRef(null);
  useEffect(() => setHi(0), [rows]);
  useEffect(() => {
    listRef.current
      ?.querySelectorAll("[data-psel]")
      [hi]?.scrollIntoView({ block: "nearest" });
  }, [hi]);
  const pick = (p) => {
    onPick(p);
    setQ("");
    setRows([]);
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && q.trim()) {
      // Con algo escrito, Enter nunca guarda el paquete: agrega o no hace nada.
      e.preventDefault();
      e.stopPropagation();
      if (rows[hi]) pick(rows[hi]);
    } else if (e.key === "Escape" && q) {
      e.preventDefault();
      e.stopPropagation();
      setQ("");
      setRows([]);
    }
  };
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setRows([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const res = await window.api.invoke("search-products", query);
        setRows(
          (Array.isArray(res) ? res : [])
            .filter((p) => p.sale_unit !== "weight" && !exclude.has(p.id))
            .slice(0, 8),
        );
      } catch {
        setRows([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, exclude]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar producto por nombre o código"
          className="pl-9"
          aria-label="Buscar producto"
        />
      </div>
      {rows.length > 0 && (
        <div
          ref={listRef}
          className="max-h-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {rows.map((p, i) => (
            <button
              key={p.id}
              type="button"
              data-psel={i}
              tabIndex={-1}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(p)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                i === hi ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-muted",
              )}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {fmtMoney(p.sale_unit === "boxpack" ? p.pack_price : p.price)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const piecePrice = (p) => (p.sale_unit === "boxpack" ? p.pack_price : p.price) || 0;

const BundleDialog = ({ open, initial, onClose, onSaved }) => {
  const notify = useToast();
  const [f, setF] = useState(EMPTY_BUNDLE);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(
      initial
        ? {
            ...initial,
            price: String(initial.price ?? ""),
            slots: (initial.slots || []).map((s) => ({
              qty: String(s.qty),
              products: s.products.filter((p) => p.is_active !== false),
            })),
          }
        : { ...EMPTY_BUNDLE, slots: [{ qty: "1", products: [] }, { qty: "1", products: [] }] },
    );
  }, [open, initial]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setSlot = (i, patch) =>
    setF((p) => ({ ...p, slots: p.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const used = useMemo(
    () => new Set(f.slots.flatMap((s) => s.products.map((p) => p.id))),
    [f.slots],
  );

  // Por separado: lo más barato y lo más caro según la alternativa que elijan.
  const filled = f.slots.filter((s) => s.products.length > 0);
  const range = filled.reduce(
    (acc, s) => {
      const q = parseInt(s.qty, 10) || 1;
      const prices = s.products.map(piecePrice);
      return [acc[0] + q * Math.min(...prices), acc[1] + q * Math.max(...prices)];
    },
    [0, 0],
  );
  const price = parseFloat(f.price) || 0;
  const savings = range[1] - price;

  const save = async () => {
    setSaving(true);
    try {
      const res = await window.api.invoke("save-bundle", {
        ...f,
        slots: f.slots.map((s) => ({ qty: s.qty, productIds: s.products.map((p) => p.id) })),
      });
      if (!res?.success) return notify(res?.error || "No se pudo guardar", "error");
      notify("Paquete guardado", "success");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="flex max-h-[92vh] max-w-xl flex-col"
        onKeyDown={(e) => {
          if (enterSaves(e) && !saving) {
            e.preventDefault();
            save();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{initial ? "Editar paquete" : "Nuevo paquete"}</DialogTitle>
          <DialogDescription>
            Se aplica solo en la caja cuando el carrito tiene todos los productos.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bundle-name">Nombre del paquete</Label>
              <Input
                id="bundle-name"
                value={f.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder="Ej. Desayuno"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bundle-price">Precio del paquete ($)</Label>
              <Input
                id="bundle-price"
                type="number"
                min={0}
                step={0.01}
                value={f.price}
                onChange={(e) => set("price")(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Incluye</Label>
            {f.slots.map((s, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.7rem] font-bold text-primary">
                    {i + 1}
                  </span>
                  <Label htmlFor={`slot-qty-${i}`} className="text-[0.8rem] text-muted-foreground">
                    Cantidad
                  </Label>
                  <Input
                    id={`slot-qty-${i}`}
                    type="number"
                    min={1}
                    value={s.qty}
                    onChange={(e) => setSlot(i, { qty: e.target.value })}
                    className="h-8 w-16"
                  />
                  <span className="flex-1 text-[0.75rem] text-muted-foreground">
                    {s.products.length > 1 ? "de cualquiera de estos" : ""}
                  </span>
                  <IconAction
                    label="Quitar este lugar"
                    danger
                    onClick={() => setF((p) => ({ ...p, slots: p.slots.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconAction>
                </div>
                {s.products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.products.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background py-1 pl-2.5 pr-1 text-[0.8rem] font-medium"
                      >
                        {p.name}
                        <span className="tabular-nums text-muted-foreground">
                          {fmtMoney(piecePrice(p))}
                        </span>
                        <button
                          type="button"
                          aria-label={`Quitar ${p.name}`}
                          onClick={() =>
                            setSlot(i, { products: s.products.filter((x) => x.id !== p.id) })
                          }
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <ProductPicker
                  exclude={used}
                  onPick={(p) => setSlot(i, { products: [...s.products, p] })}
                />
                {s.products.length === 1 && (
                  <p className="text-[0.72rem] text-muted-foreground">
                    Agrega otro producto aquí si da lo mismo cuál lleve (ej. cualquier sabor).
                  </p>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setF((p) => ({ ...p, slots: [...p.slots, { qty: "1", products: [] }] }))}
            >
              <Plus className="h-4 w-4" />
              Agregar producto
            </Button>
          </div>

          {filled.length > 0 && price > 0 && (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-[0.85rem]",
                savings > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              <span>
                Por separado:{" "}
                <span className="line-through">
                  {range[0] === range[1]
                    ? fmtMoney(range[1])
                    : `${fmtMoney(range[0])}–${fmtMoney(range[1])}`}
                </span>{" "}
                · Paquete: <strong>{fmtMoney(price)}</strong>
              </span>
              <strong>
                {savings > 0
                  ? `Ahorra ${range[0] === range[1] ? "" : "hasta "}${fmtMoney(savings)}`
                  : "No ahorra: así no se aplica en la caja"}
              </strong>
            </div>
          )}

          <DateFields
            start={f.start_date}
            end={f.end_date}
            onChange={(from, to) => setF((p) => ({ ...p, start_date: from, end_date: to }))}
          />
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <Label htmlFor="bundle-active">Activo</Label>
            <Switch
              id="bundle-active"
              checked={Number(f.is_active) === 1}
              onCheckedChange={(v) => set("is_active")(v ? 1 : 0)}
            />
          </div>
        </div>
        <DialogFooter>
          <KeyHints />
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar paquete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Pantalla ───────────────────────────────────────────────────────────────
const Promotions = () => {
  const navigate = useNavigate();
  const notify = useToast();
  const [data, setData] = useState(null);
  const [productPromos, setProductPromos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tab, setTab] = useState("products");
  const [groupDialog, setGroupDialog] = useState({ open: false, item: null });
  const [bundleDialog, setBundleDialog] = useState({ open: false, item: null });
  const [confirm, setConfirm] = useState(null);
  const [editProduct, setEditProduct] = useState(null);

  const load = useCallback(async () => {
    try {
      const [promos, prod, cats] = await Promise.all([
        window.api.invoke("get-promotions"),
        window.api.invoke("get-product-promos"),
        window.api.invoke("get-categories"),
      ]);
      if (promos?.success) setData(promos);
      if (prod?.success) setProductPromos(prod.products);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch {
      notify("No se pudieron cargar las promociones", "error");
    }
  }, [notify]);
  useEffect(() => {
    load();
  }, [load]);
  useDbChanges(load, ["group_promos", "bundles", "bundle_items", "products", "product_prices", "settings"]);

  const groups = data?.groupPromos || [];
  const bundles = data?.bundles || [];
  const liveCount = useMemo(
    () =>
      [...groups, ...bundles].filter((p) => statusOf(p) === "active").length +
      productPromos.filter((p) => statusOf({ ...p, is_active: 1 }) === "active").length,
    [groups, bundles, productPromos],
  );

  // El modal reescribe todo el producto al guardar: se abre con el registro
  // completo y sus promos por cantidad, nunca con el resumen de la lista.
  const openProduct = async (row) => {
    try {
      const [full] = await window.api.invoke("get-products-by-ids", [row.id]);
      if (!full) return notify("No se encontró el producto", "error");
      setEditProduct({ ...full, prices: row.prices || [] });
    } catch {
      notify("No se pudo abrir el producto", "error");
    }
  };

  const doDelete = async () => {
    const c = confirm;
    setConfirm(null);
    const res =
      c.kind === "group"
        ? await window.api.invoke("delete-group-promo", c.item.id)
        : await window.api.invoke("delete-bundle", c.item.id);
    if (res?.success) notify("Eliminada", "success");
    else notify(res?.error || "No se pudo eliminar", "error");
    load();
  };

  const toggleActive = async (kind, item, active) => {
    const res =
      kind === "group"
        ? await window.api.invoke("save-group-promo", { ...item, is_active: active ? 1 : 0 })
        : await window.api.invoke("set-bundle-active", item.id, active);
    if (!res?.success) notify(res?.error || "No se pudo actualizar", "error");
    load();
  };

  if (data && !data.enabled) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<BadgePercent size={26} aria-hidden="true" />}
          title="Promociones avanzadas está apagado"
          description="Actívalo en Configuración → Funciones para crear promos por categoría, marca y paquetes."
          action={
            <Button onClick={() => navigate("/configuration")}>
              <Settings className="h-4 w-4" />
              Ir a Configuración
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        description="Promos que abarcan varios productos, y el tablero de todas las que tienes corriendo."
        actions={
          tab === "groups" ? (
            <Button onClick={() => setGroupDialog({ open: true, item: null })}>
              <Plus className="h-4 w-4" />
              Nueva promo por grupo
            </Button>
          ) : tab === "bundles" ? (
            <Button onClick={() => setBundleDialog({ open: true, item: null })}>
              <Plus className="h-4 w-4" />
              Nuevo paquete
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-blue-900 p-4 text-white shadow-[0_16px_32px_-16px_rgba(30,58,138,0.7)] sm:col-span-1">
          <p className="text-[0.8rem] font-semibold text-white/80">Activas ahora</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums">{liveCount}</p>
          <p className="text-[0.75rem] text-white/75">se están cobrando hoy</p>
        </div>
        {[
          ["De productos", productPromos.length, "productos con promo"],
          ["Por categoría o marca", groups.length, "promos de grupo"],
          ["Paquetes", bundles.length, "paquetes creados"],
        ].map(([label, n, hint]) => (
          <div
            key={label}
            className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_20px_-14px_rgba(15,23,42,0.3)]"
          >
            <p className="text-[0.8rem] font-semibold text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums text-foreground">{n}</p>
            <p className="text-[0.75rem] text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="products">De productos</TabsTrigger>
          <TabsTrigger value="groups">Por categoría o marca</TabsTrigger>
          <TabsTrigger value="bundles">Paquetes</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4 space-y-2">
          {productPromos.length === 0 ? (
            <EmptyState
              icon={<Tag size={26} aria-hidden="true" />}
              title="Ningún producto tiene promoción"
              description="Las promos de un producto (%, precio fijo, mayoreo, combos, 2×1) se configuran al editarlo."
            />
          ) : (
            productPromos.map((p) => (
              <PromoRow
                key={p.id}
                icon={Tag}
                tone="bg-primary/10 text-primary"
                title={p.name}
                subtitle={[p.category_name, `Precio ${fmtMoney(p.price)}`, validityText(p)]
                  .filter(Boolean)
                  .join(" · ")}
                chips={productPromoLabels(p)}
                status={statusOf({ ...p, is_active: 1 })}
                actions={
                  <Button variant="outline" size="sm" onClick={() => openProduct(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="groups" className="mt-4 space-y-2">
          {groups.length === 0 ? (
            <EmptyState
              icon={<BadgePercent size={26} aria-hidden="true" />}
              title="Sin promos por categoría o marca"
              description="Ej. −15% en toda la limpieza o −10% en la marca Bimbo, con vigencia."
              action={
                <Button onClick={() => setGroupDialog({ open: true, item: null })}>
                  <Plus className="h-4 w-4" />
                  Nueva promo por grupo
                </Button>
              }
            />
          ) : (
            groups.map((g) => (
              <PromoRow
                key={g.id}
                icon={BadgePercent}
                tone="bg-red-500/10 text-red-600"
                title={`-${g.percent}% ${g.name || (g.scope === "brand" ? `marca ${g.brand}` : `en ${g.category_name || "categoría"}`)}`}
                subtitle={`${g.scope === "brand" ? `Marca ${g.brand}` : `Categoría ${g.category_name || "—"}`} · ${validityText(g)}`}
                status={statusOf(g)}
                actions={
                  <>
                    <Switch
                      checked={Number(g.is_active) === 1}
                      onCheckedChange={(v) => toggleActive("group", g, v)}
                      aria-label={Number(g.is_active) === 1 ? "Pausar" : "Activar"}
                      className="mr-1"
                    />
                    <IconAction label="Editar" onClick={() => setGroupDialog({ open: true, item: g })}>
                      <Pencil className="h-4 w-4" />
                    </IconAction>
                    <IconAction label="Eliminar" danger onClick={() => setConfirm({ kind: "group", item: g })}>
                      <Trash2 className="h-4 w-4" />
                    </IconAction>
                  </>
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="bundles" className="mt-4 space-y-2">
          {bundles.length === 0 ? (
            <EmptyState
              icon={<Package size={26} aria-hidden="true" />}
              title="Sin paquetes"
              description="Ej. Torta + refresco por $50. La caja lo arma sola cuando están todos los productos."
              action={
                <Button onClick={() => setBundleDialog({ open: true, item: null })}>
                  <Plus className="h-4 w-4" />
                  Nuevo paquete
                </Button>
              }
            />
          ) : (
            bundles.map((b) => (
              <PromoRow
                key={b.id}
                icon={Package}
                tone="bg-amber-500/15 text-amber-700"
                title={`${b.name} · ${fmtMoney(b.price)}`}
                subtitle={validityText(b)}
                chips={b.slots.map(
                  (s) => `${s.qty} × ${s.products.map((p) => p.name).join(" o ")}`,
                )}
                status={statusOf(b)}
                actions={
                  <>
                    <Switch
                      checked={Number(b.is_active) === 1}
                      onCheckedChange={(v) => toggleActive("bundle", b, v)}
                      aria-label={Number(b.is_active) === 1 ? "Pausar" : "Activar"}
                      className="mr-1"
                    />
                    <IconAction label="Editar" onClick={() => setBundleDialog({ open: true, item: b })}>
                      <Pencil className="h-4 w-4" />
                    </IconAction>
                    <IconAction label="Eliminar" danger onClick={() => setConfirm({ kind: "bundle", item: b })}>
                      <Trash2 className="h-4 w-4" />
                    </IconAction>
                  </>
                }
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      <GroupPromoDialog
        open={groupDialog.open}
        initial={groupDialog.item}
        categories={categories}
        brands={data?.brands || []}
        onClose={() => setGroupDialog({ open: false, item: null })}
        onSaved={() => {
          setGroupDialog({ open: false, item: null });
          load();
        }}
      />
      <BundleDialog
        open={bundleDialog.open}
        initial={bundleDialog.item}
        onClose={() => setBundleDialog({ open: false, item: null })}
        onSaved={() => {
          setBundleDialog({ open: false, item: null });
          load();
        }}
      />
      <AddProductModal
        open={!!editProduct}
        editProduct={editProduct}
        onClose={() => setEditProduct(null)}
        onProductAdded={() => {
          setEditProduct(null);
          load();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.kind === "group" ? "Eliminar promoción" : "Eliminar paquete"}
        description={
          <>
            ¿Eliminar <strong>{confirm?.item?.name || "esta promoción"}</strong>? Si sólo quieres
            detenerla, mejor apágala.
          </>
        }
        confirmLabel="Eliminar"
        variant="destructive"
        onCancel={() => setConfirm(null)}
        onConfirm={doDelete}
      />
    </div>
  );
};

export default Promotions;
