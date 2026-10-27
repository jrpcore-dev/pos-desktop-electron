import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useDbChanges } from "../lib/useDbChanges";
import {
  Search,
  SearchX,
  Plus,
  Pencil,
  Trash2,
  Check,
  Library,
  Package,
  ImageIcon,
  LayoutGrid,
  List,
  MoreHorizontal,
} from "lucide-react";
import AddProductModal, { ProductImagePicker } from "./AddProductModal";
import FilterCombobox from "./FilterCombobox";
import PaginationBar from "./PaginationBar";
import { useToast } from "./ToastProvider";
import { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { ConfirmDialog } from "./ui/confirm";
import { Skeleton } from "./ui/skeleton";
import { EmptyState } from "./ui/empty-state";
import { cn } from "../lib/utils";
import { fmtMoney } from "../utils/format";

const PAGE_SIZES = [24, 48, 96];
const VIEW_KEY = "catalog-view";

const STATUS_OPTIONS = [
  { value: "available", label: "Disponibles" },
  { value: "registered", label: "En mi inventario" },
  { value: "all", label: "Todos" },
];

const SALE_UNIT_LABEL = {
  piece: "Pieza",
  weight: "A granel",
  box: "Caja",
  package: "Paquete",
  boxpack: "Caja",
};

const CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,.05),0_10px_24px_-14px_rgba(15,23,42,.22)]";

const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

const fmtInt = (n) => (Number(n) || 0).toLocaleString("es-MX");

/* ─── Métricas: la protagonista y dos tarjetas que también filtran ─── */

// `variant`: "select" (filtro de estado, uno a la vez: anillo) o "toggle"
// (filtro que se suma a cualquier estado: palomita y fondo, sin anillo, para
// que no parezcan dos selecciones iguales).
const MetricCard = ({ active, onClick, icon, label, value, variant = "select" }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "relative flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-xl border border-border bg-card px-5 py-4 text-left outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
      CARD_SHADOW,
      active && variant === "select" && "border-chart-2 ring-2 ring-chart-2/40",
      active && variant === "toggle" && "bg-primary/[0.04]",
    )}
  >
    {active && variant === "toggle" && (
      <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    )}
    <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      {label}
    </span>
    <span className="text-[28px] font-extrabold leading-none tracking-tight text-foreground">
      {fmtInt(value)}
    </span>
  </button>
);

const CatalogMetrics = memo(function CatalogMetrics({
  stats,
  status,
  withPhoto,
  onStatus,
  onTogglePhoto,
}) {
  const total = stats?.total || 0;
  const registered = stats?.registrados || 0;
  const pct = total ? Math.max(1.5, (registered / total) * 100) : 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <button
        type="button"
        onClick={() => onStatus("registered")}
        aria-pressed={status === "registered"}
        className={cn(
          "flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl bg-gradient-to-br from-primary via-chart-3 to-chart-1 px-6 py-5 text-left text-primary-foreground outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring sm:col-span-2",
          "shadow-[0_1px_2px_rgba(15,23,42,.2),0_12px_28px_-10px_rgba(15,23,42,.55)]",
          status === "registered" && "ring-2 ring-chart-2 ring-offset-2 ring-offset-background",
        )}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/70">
          En tu inventario
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-4xl font-extrabold leading-none tracking-tight">
            {fmtInt(registered)}
          </span>
          <span className="text-sm text-primary-foreground/70">
            de {fmtInt(total)} productos del catálogo
          </span>
        </span>
        <span className="block h-2 overflow-hidden rounded-full bg-primary-foreground/20">
          <span
            className="block h-full rounded-full bg-primary-foreground/85"
            style={{ width: `${pct}%` }}
          />
        </span>
      </button>
      <MetricCard
        active={status === "available"}
        onClick={() => onStatus("available")}
        icon={<Plus className="size-4" strokeWidth={2.4} />}
        label="Disponibles para agregar"
        value={stats?.pendientes}
      />
      <MetricCard
        variant="toggle"
        active={withPhoto}
        onClick={onTogglePhoto}
        icon={<ImageIcon className="size-4" />}
        label="Con foto"
        value={stats?.conFoto}
      />
    </div>
  );
});
CatalogMetrics.displayName = "CatalogMetrics";

/* ─── Filtros (mismos campos que Inventario) ─── */

const Segmented = ({ value, options, onChange, label }) => (
  <div role="group" aria-label={label} className="flex h-10 gap-1 rounded-lg bg-muted p-1">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
        className={cn(
          "flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
          value === o.value
            ? "bg-card font-semibold text-foreground shadow-sm"
            : "font-medium text-muted-foreground hover:text-foreground",
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const CatalogFilters = memo(function CatalogFilters({
  searchRef,
  search,
  onSearchChange,
  onSearchEnter,
  status,
  onStatus,
  withPhoto,
  onTogglePhoto,
  categoryId,
  onCategory,
  categoryOptions,
  total,
  pageSize,
  onPageSize,
  view,
  onView,
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="catalog-search">Buscar o escanear</Label>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="catalog-search"
              ref={searchRef}
              type="search"
              value={search}
              onChange={onSearchChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSearchEnter();
                }
              }}
              placeholder="Nombre, marca o código (Enter registra)"
              className="pl-9"
            />
          </div>
        </div>
        <FilterCombobox
          label="Categoría"
          value={categoryId}
          options={categoryOptions}
          emptyValue="Todas las categorías"
          onChange={onCategory}
        />
        <div className="space-y-1.5">
          <Label>Estado</Label>
          <Segmented
            label="Estado"
            value={status}
            options={STATUS_OPTIONS}
            onChange={onStatus}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <button
          type="button"
          aria-pressed={withPhoto}
          onClick={onTogglePhoto}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
            withPhoto
              ? "border-chart-1 bg-chart-2/12 font-semibold text-chart-1"
              : "border-border bg-card font-medium text-foreground hover:bg-muted",
          )}
        >
          {withPhoto ? (
            <Check className="size-3.5" strokeWidth={2.6} />
          ) : (
            <ImageIcon className="size-3.5 text-muted-foreground" />
          )}
          Solo con foto
        </button>
        <span className="flex-1" />
        <span className="text-sm text-muted-foreground">
          {fmtInt(total)} {total === 1 ? "resultado" : "resultados"}
        </span>
        <Select value={String(pageSize)} onValueChange={onPageSize}>
          <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="Productos por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div role="group" aria-label="Vista" className="flex gap-1 rounded-lg bg-muted p-1">
          {[
            { v: "grid", Icon: LayoutGrid, label: "Ver en cuadrícula" },
            { v: "list", Icon: List, label: "Ver en lista" },
          ].map(({ v, Icon, label }) => (
            <button
              key={v}
              type="button"
              aria-label={label}
              aria-pressed={view === v}
              onClick={() => onView(v)}
              className={cn(
                "flex size-7 cursor-pointer items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                view === v
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
CatalogFilters.displayName = "CatalogFilters";

/* ─── Producto: piezas comunes de tarjeta y fila ─── */

const productImage = (p) => p.image_path || p.cat_image;

const ProductMenu = ({ product, onEdit, onDelete, className }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Más opciones"
        className={className}
      >
        <MoreHorizontal className="size-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => onEdit(product)}>
        <Pencil className="size-4" />
        Editar nombre y foto
      </DropdownMenuItem>
      {product.is_active !== 1 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onDelete(product)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" />
            Quitar del catálogo
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);

const ProductAction = ({ product, onRegister, onOpenInventory, size }) =>
  product.is_active !== 1 ? (
    <Button size={size} onClick={() => onRegister(product)}>
      <Plus className="size-4" strokeWidth={2.4} />
      Agregar al inventario
    </Button>
  ) : (
    <Button size={size} variant="outline" onClick={() => onOpenInventory(product)}>
      Ver en inventario
    </Button>
  );

const InInventoryBadge = ({ className }) => (
  <Badge variant="success" className={cn("gap-1 whitespace-nowrap", className)}>
    <Check className="size-3" strokeWidth={3} />
    En tu inventario
  </Badge>
);

const UnitBadge = ({ product }) =>
  SALE_UNIT_LABEL[product.sale_unit] ? (
    <Badge variant="unit" className="px-1.5">
      {SALE_UNIT_LABEL[product.sale_unit]}
    </Badge>
  ) : null;

const CatalogCard = memo(function CatalogCard({
  product,
  onRegister,
  onOpenInventory,
  onEdit,
  onDelete,
}) {
  const image = productImage(product);
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,.06),0_18px_32px_-16px_rgba(15,23,42,.3)]",
        CARD_SHADOW,
      )}
    >
      <div className="relative flex h-44 items-center justify-center border-b border-border bg-white">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            className="max-h-36 max-w-[80%] object-contain"
          />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Package className="size-7" strokeWidth={1.8} />
          </span>
        )}
        {product.is_active === 1 && (
          <InInventoryBadge className="absolute left-2.5 top-2.5 shadow-sm" />
        )}
        <ProductMenu
          product={product}
          onEdit={onEdit}
          onDelete={onDelete}
          className="absolute right-2 top-2 bg-card/90"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3.5 pt-3">
        <span className="line-clamp-2 min-h-[2.6em] text-[15px] font-semibold leading-snug text-foreground">
          {product.cat_name}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {product.barcode || "Sin código"}
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Costo ref.{" "}
            <b className="text-sm tabular-nums text-foreground">
              {fmtMoney(product.cost_price)}
            </b>
          </span>
          <UnitBadge product={product} />
        </div>
        <span className="flex-1" />
        <ProductAction
          product={product}
          onRegister={onRegister}
          onOpenInventory={onOpenInventory}
        />
      </div>
    </div>
  );
});
CatalogCard.displayName = "CatalogCard";

const CatalogListRow = memo(function CatalogListRow({
  product,
  onRegister,
  onOpenInventory,
  onEdit,
  onDelete,
}) {
  const image = productImage(product);
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell className="px-4">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-9 w-9 shrink-0 rounded-md">
            {image ? (
              <AvatarImage
                src={image}
                alt={product.cat_name}
                className="bg-white object-contain"
              />
            ) : (
              <AvatarFallback className="rounded-md bg-primary/10 text-primary">
                <Package className="h-4 w-4" />
              </AvatarFallback>
            )}
          </Avatar>
          <div className="min-w-0">
            <span className="line-clamp-1 text-sm font-semibold text-foreground">
              {product.cat_name}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <UnitBadge product={product} />
              {product.is_active === 1 && <InInventoryBadge />}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-4 text-sm tabular-nums text-muted-foreground">
        {product.barcode || "—"}
      </TableCell>
      <TableCell className="px-4 text-right text-sm tabular-nums text-foreground">
        {fmtMoney(product.cost_price)}
      </TableCell>
      <TableCell className="px-4">
        <div className="flex items-center justify-end gap-1">
          <ProductAction
            product={product}
            onRegister={onRegister}
            onOpenInventory={onOpenInventory}
            size="sm"
          />
          <ProductMenu product={product} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </TableCell>
    </TableRow>
  );
});
CatalogListRow.displayName = "CatalogListRow";

const LoadingGrid = () => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className={cn("overflow-hidden rounded-xl border border-border bg-card", CARD_SHADOW)}>
        <Skeleton className="h-44 rounded-none" />
        <div className="flex flex-col gap-2 p-3.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-2 h-9 w-full" />
        </div>
      </div>
    ))}
  </div>
);

/* ─── Editar nombre y foto ─── */

const EditCatalogDialog = ({ product, onClose, onSaved }) => {
  const notify = useToast();
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [imageTouched, setImageTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setName(product.cat_name || product.inv_name || "");
    setImage(productImage(product) || "");
    setImageTouched(false);
  }, [product]);

  const save = async () => {
    if (!product || !name.trim()) return;
    setSaving(true);
    const args = [product.id, name];
    if (imageTouched) args.push(image || "");
    const res = await window.api.invoke("update-catalog-name", ...args);
    setSaving(false);
    if (res.success) {
      notify("Producto del catálogo actualizado", "success");
      onSaved();
      onClose();
    } else {
      notify(res.error, "error");
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar producto del catálogo</DialogTitle>
          <DialogDescription>
            Cambia cómo se ve en el catálogo. La foto se ajusta y se guarda en
            WebP automáticamente; al registrarlo, pasa al inventario.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch">
          <ProductImagePicker
            value={image}
            onChange={(v) => {
              setImage(v);
              setImageTouched(true);
            }}
            onError={(msg) => notify(msg, "error")}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="catalog-edit-name">Nombre en catálogo</Label>
            <Input
              id="catalog-edit-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
            <span className="mt-1 text-xs text-muted-foreground">
              Código: {product?.barcode || "—"}
            </span>
            {product?.is_active === 1 && (
              <span className="text-xs text-muted-foreground">
                No cambia el nombre ni la foto que ya tiene en tu inventario.
              </span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!name.trim() || saving}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ─── Pantalla ─── */

const Catalog = () => {
  const notify = useToast();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [categoryOptions, setCategoryOptions] = useState([]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  // La búsqueda que realmente se consulta: espera a que se deje de escribir.
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("available");
  const [withPhoto, setWithPhoto] = useState(false);
  const [view, setView] = useState(readView);
  const [loading, setLoading] = useState(true);

  const [registerProduct, setRegisterProduct] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const [deleteProduct, setDeleteProduct] = useState(null);

  const searchRef = useRef(null);
  const topRef = useRef(null);
  // Solo la respuesta de la última consulta se pinta (una lenta no pisa a
  // una más nueva).
  const requestRef = useRef(0);

  const loadMeta = useCallback(async () => {
    const [cats, st] = await Promise.all([
      window.api.invoke("get-catalog-categories"),
      window.api.invoke("get-catalog-stats"),
    ]);
    if (cats?.success) {
      setCategoryOptions([
        {
          id: "uncategorized",
          name: `Sin clasificar (${fmtInt(cats.uncategorized)})`,
        },
        ...cats.categories.map((c) => ({
          id: c.id,
          name: `${c.name} (${fmtInt(c.cnt)})`,
        })),
      ]);
    }
    if (st?.success) setStats(st);
  }, []);

  const loadProducts = useCallback(
    async (silent = false) => {
      const req = ++requestRef.current;
      if (!silent) setLoading(true);
      let res = null;
      try {
        res = await window.api.invoke("get-catalog-products", {
          search: query,
          categoryId,
          status,
          withPhoto,
          page: page + 1,
          pageSize,
        });
      } catch {}
      if (req !== requestRef.current) return;
      setRows(res?.success ? res.rows : []);
      setTotal(res?.success ? res.total : 0);
      if (!silent) setLoading(false);
    },
    [query, categoryId, status, withPhoto, page, pageSize],
  );

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Cambiar búsqueda, filtros o tamaño vuelve a la primera página en el
  // mismo render que el cambio: una sola carga y la paginación no se pierde.
  useEffect(() => {
    if (search === query) return;
    const t = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search, query]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const reload = useCallback(async () => {
    await Promise.all([loadMeta(), loadProducts(true)]);
  }, [loadMeta, loadProducts]);

  // In vivo: catálogo al día con su página/filtros intactos; los modales
  // conservan su estado.
  useDbChanges(
    () => {
      loadMeta();
      loadProducts(true);
    },
    ["products", "product_prices", "categories"],
  );

  const handleSearchChange = useCallback((e) => setSearch(e.target.value), []);

  // Escanear y Enter: si el código o la búsqueda da un solo producto, se abre
  // su registro sin tocar el mouse.
  const handleSearchEnter = useCallback(async () => {
    const term = search.trim();
    setQuery(search);
    setPage(0);
    if (!term) return;
    const res = await window.api.invoke("get-catalog-products", {
      search: term,
      status: "all",
      page: 1,
      pageSize: 5,
    });
    if (!res?.success || res.total !== 1) return;
    const p = res.rows[0];
    if (p.is_active !== 1) setRegisterProduct(p);
    else notify(`${p.cat_name} ya está en tu inventario`, "info");
  }, [search, notify]);

  const handleStatus = useCallback((v) => {
    setStatus(v);
    setPage(0);
  }, []);
  const handleTogglePhoto = useCallback(() => {
    setWithPhoto((v) => !v);
    setPage(0);
  }, []);
  const handleCategory = useCallback((v) => {
    setCategoryId(v);
    setPage(0);
  }, []);
  const handleView = useCallback((v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }, []);
  // PaginationBar pasa un actualizador (p => p + 1).
  const handleSetPage = useCallback((update) => {
    setPage(update);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const handlePageSize = useCallback((v) => {
    setPageSize(parseInt(v, 10));
    setPage(0);
  }, []);

  const handleOpenRegister = useCallback((p) => setRegisterProduct(p), []);
  const handleCloseRegister = useCallback(() => {
    setRegisterProduct(null);
    // Listo para el siguiente escaneo.
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);
  const handleOpenInventory = useCallback(
    (p) => navigate("/inventory", { state: { editProductId: p.id } }),
    [navigate],
  );
  const handleOpenEdit = useCallback((p) => setEditProduct(p), []);
  const handleCloseEdit = useCallback(() => setEditProduct(null), []);
  const handleOpenDelete = useCallback((p) => setDeleteProduct(p), []);
  const handleCloseDelete = useCallback(
    (v) => !v && setDeleteProduct(null),
    [],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteProduct) return;
    const res = await window.api.invoke(
      "delete-catalog-product",
      deleteProduct.id,
    );
    if (res.success) notify("Producto quitado del catálogo", "success");
    else notify(res.error, "error");
    setDeleteProduct(null);
    await reload();
  }, [deleteProduct, reload, notify]);

  const clearFilters = () => {
    setSearch("");
    setQuery("");
    setCategoryId("");
    setStatus("all");
    setWithPhoto(false);
    setPage(0);
  };

  const filtered = !!(query || categoryId || withPhoto || status !== "all");
  const itemProps = {
    onRegister: handleOpenRegister,
    onOpenInventory: handleOpenInventory,
    onEdit: handleOpenEdit,
    onDelete: handleOpenDelete,
  };

  return (
    <div className="flex flex-col gap-5 p-1">
      <CatalogMetrics
        stats={stats}
        status={status}
        withPhoto={withPhoto}
        onStatus={handleStatus}
        onTogglePhoto={handleTogglePhoto}
      />

      <div ref={topRef} className="scroll-mt-4">
        <CatalogFilters
          searchRef={searchRef}
          search={search}
          onSearchChange={handleSearchChange}
          onSearchEnter={handleSearchEnter}
          status={status}
          onStatus={handleStatus}
          withPhoto={withPhoto}
          onTogglePhoto={handleTogglePhoto}
          categoryId={categoryId}
          onCategory={handleCategory}
          categoryOptions={categoryOptions}
          total={total}
          pageSize={pageSize}
          onPageSize={handlePageSize}
          view={view}
          onView={handleView}
        />
      </div>

      {view === "grid" ? (
        loading ? (
          <LoadingGrid />
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <CatalogEmpty filtered={filtered} onClear={clearFilters} />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {rows.map((p) => (
              <CatalogCard key={p.id} product={p} {...itemProps} />
            ))}
          </div>
        )
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Producto</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Costo ref.</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-4">
                      <div className="flex items-center gap-2.5">
                        <Skeleton className="h-9 w-9 rounded-md" />
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4">
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="px-4">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </TableCell>
                    <TableCell className="px-4">
                      <Skeleton className="ml-auto h-8 w-40" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="p-0">
                    <CatalogEmpty filtered={filtered} onClear={clearFilters} />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((p) => (
                  <CatalogListRow key={p.id} product={p} {...itemProps} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && total > pageSize && (
        <PaginationBar
          pageStart={page * pageSize}
          pageSize={pageSize}
          totalItems={total}
          page={page}
          totalPages={Math.ceil(total / pageSize)}
          setPage={handleSetPage}
        />
      )}

      <AddProductModal
        key={registerProduct ? `c-${registerProduct.id}` : "closed"}
        open={!!registerProduct}
        onClose={handleCloseRegister}
        onProductAdded={reload}
        catalogProduct={registerProduct}
      />

      <EditCatalogDialog
        product={editProduct}
        onClose={handleCloseEdit}
        onSaved={reload}
      />

      <ConfirmDialog
        open={!!deleteProduct}
        onOpenChange={handleCloseDelete}
        title="Quitar del catálogo"
        description={
          <>
            ¿Quitar <strong>{deleteProduct?.cat_name}</strong> del catálogo?
            Solo es posible si aún no está registrado en inventario.
          </>
        }
        confirmLabel="Quitar"
        variant="destructive"
        onCancel={() => setDeleteProduct(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
};

const CatalogEmpty = ({ filtered, onClear }) =>
  filtered ? (
    <EmptyState
      icon={<SearchX size={26} aria-hidden="true" />}
      title="Sin resultados en el catálogo"
      description="Ningún producto coincide con la búsqueda o los filtros actuales."
      action={
        <Button size="sm" variant="outline" onClick={onClear}>
          Limpiar filtros
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<Library size={26} aria-hidden="true" />}
      title="Aún no hay productos en el catálogo"
      description="El catálogo se carga al instalar el sistema o al importar un archivo de productos."
    />
  );

export default Catalog;
