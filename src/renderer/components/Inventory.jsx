import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Search,
  Download,
  PlusCircle,
  Eye,
  Pencil,
  Plus,
  Minus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Store,
  Warehouse,
  Package,
  TriangleAlert,
  Percent,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ArrowRight,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  History,
  MoreHorizontal,
  Scale,
  Boxes,
  Layers,
  Loader2,
} from "lucide-react";
import AddProductModal from "./AddProductModal";
import { CardSkeleton } from "./Skeletons";
import CancelButton from "./CancelButton";
import {
  Button as SButton,
  Input as SInput,
  Badge,
  Label,
  Table as STable,
  TableBody as STableBody,
  TableCell as STableCell,
  TableHead as STableHead,
  TableHeader as STableHeader,
  TableRow as STableRow,
  Tooltip as STooltip,
  TooltipContent as STooltipContent,
  TooltipProvider as STooltipProvider,
  TooltipTrigger as STooltipTrigger,
  Avatar as SAvatar,
  AvatarImage as SAvatarImage,
  AvatarFallback as SAvatarFallback,
  Alert as SAlert,
  AlertTitle as SAlertTitle,
  AlertDescription as SAlertDescription,
  EmptyState,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Checkbox,
  DropdownMenu as SDropdownMenu,
  DropdownMenuTrigger as SDropdownMenuTrigger,
  DropdownMenuContent as SDropdownMenuContent,
  DropdownMenuItem as SDropdownMenuItem,
  DropdownMenuSeparator as SDropdownMenuSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Kbd,
  KbdGroup,
  Skeleton,
} from "./ui";
import PaginationBar from "./PaginationBar";
import { cn } from "@/lib/utils";
import { useToast } from "./ToastProvider";
import { useCashier } from "../contexts/CashierContext";
import { mxToday, formatMXTime } from "../utils/dateUtils";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";

const ROW_HEIGHT = 52;
const BUFFER_ROWS = 3;
const PAGE_SIZE = 25;
const MAX_ROWS_PER_PAGE = 100;

const getStockStatus = (stock, minStock) => {
  const min = minStock || 5;
  if (stock === 0) return { label: "Agotado", color: "error" };
  if (stock <= min) return { label: "Stock Bajo", color: "warning" };
  return { label: "En Stock", color: "success" };
};

const calcDiscountedPrice = (price, discount) =>
  price * (1 - (discount || 0) / 100);

const calcMarginPct = (p) => {
  if (!p) return null;
  const isBoxProd = isContainerUnit(p.sale_unit) && p.box_qty > 0;
  const showBox = isBoxProd && p.stock >= p.box_qty;
  const saleBase = isBoxProd ? (showBox ? p.box_price : p.price) : p.price;
  const costBase = isBoxProd
    ? showBox
      ? p.cost_price
      : p.cost_price / p.box_qty
    : p.cost_price;
  if (!costBase) return null;
  return ((saleBase - costBase) / costBase) * 100;
};

const fmtKg = (kg) => (Math.round(kg * 1000) / 1000).toFixed(3);

const stockUnit = (p) => {
  if (p.sale_unit === "weight") return "kg";
  if (isContainerUnit(p.sale_unit)) return unitLabels(p.sale_unit).plural;
  return "pz";
};

const stockDisplay = (p) => {
  if (isContainerUnit(p.sale_unit) && p.box_qty > 0 && p.stock >= p.box_qty)
    return `${Math.floor(p.stock / p.box_qty)} ${unitLabels(p.sale_unit).plural} (${p.stock} pz)`;
  if (p.pack_qty > 0 && p.stock >= p.pack_qty)
    return `${Math.floor(p.stock / p.pack_qty)} paquetes (${p.stock} pz)`;
  if (p.sale_unit === "weight") return `${fmtKg(p.stock)} kg`;
  return `${p.stock} pz`;
};

const fmtStock = (p, qty) => {
  if (isContainerUnit(p.sale_unit) && p.box_qty > 0 && qty >= p.box_qty)
    return `${Math.floor(qty / p.box_qty)} ${unitLabels(p.sale_unit).plural} (${qty} pz)`;
  if (p.pack_qty > 0 && qty >= p.pack_qty)
    return `${Math.floor(qty / p.pack_qty)} paquetes (${qty} pz)`;
  if (p.sale_unit === "weight") return `${fmtKg(qty)} kg`;
  return `${qty} pz`;
};

const fmtStockNumber = (p, qty) => {
  if (isContainerUnit(p.sale_unit) && p.box_qty > 0 && qty >= p.box_qty)
    return Math.floor(qty / p.box_qty);
  if (p.pack_qty > 0 && qty >= p.pack_qty)
    return Math.floor(qty / p.pack_qty);
  if (p.sale_unit === "weight") return fmtKg(qty);
  return qty;
};

const stockUnitCompact = (p) => {
  if (isContainerUnit(p.sale_unit) && p.box_qty > 0 && p.stock >= p.box_qty)
    return unitLabels(p.sale_unit).plural;
  if (p.pack_qty > 0 && p.stock >= p.pack_qty) return "paquetes";
  if (p.sale_unit === "weight") return "kg";
  return "pz";
};

const fmtDateShort = (isoDate) => {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
};

const boxPriceDisplay = (p) =>
  isContainerUnit(p.sale_unit) && p.box_qty > 0 && p.stock >= p.box_qty
    ? p.box_price
    : p.price;

const SortHead = ({ label, k, align = "left", sortField, sortDir, onSort }) => {
  const active = sortField === k;
  const dir = sortDir;
  return (
    <STableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap px-4 font-semibold text-foreground/75 hover:text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
      onClick={() => onSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </span>
    </STableHead>
  );
};

const StatusBadge = React.memo(({ label, color }) => {
  const variant =
    color === "error"
      ? "destructive"
      : color === "warning"
      ? "warning"
      : "success";
  return (
    <Badge variant={variant} className="h-[20px] text-[0.65rem]">
      {label}
    </Badge>
  );
});
StatusBadge.displayName = "StatusBadge";

const ProductChip = React.memo(
  ({ icon: Icon, label, variant = "neutral", tooltip }) => {
    const style = {
      neutral:
        "border border-border bg-muted text-muted-foreground shadow-sm",
      rebaja: "bg-destructive/10 text-destructive dark:text-red-400 shadow-sm",
      mayoreo: "bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm",
    }[variant];
    const text = label.charAt(0).toUpperCase() + label.slice(1);
    const chip = (
      <span
        className={cn(
          "inline-flex h-[22px] shrink-0 items-center gap-1 rounded px-1.5 text-[0.68rem] font-bold",
          style,
        )}
      >
        {Icon && <Icon className="h-3 w-3" strokeWidth={2.5} />}
        {text}
      </span>
    );
    if (!tooltip) return chip;
    return (
      <STooltip>
        <STooltipTrigger asChild>
          <button type="button" className="shrink-0 rounded">
            {chip}
          </button>
        </STooltipTrigger>
        <STooltipContent>{tooltip}</STooltipContent>
      </STooltip>
    );
  },
);
ProductChip.displayName = "ProductChip";

const ProductRow = React.memo(
  ({
    product,
    dataFiltered,
    isAdmin,
    onView,
    onEdit,
    onAddStock,
    onReduceStock,
    onDelete,
  }) => {
    const stockStatus = getStockStatus(product.stock, product.min_stock);
    const finalPrice = calcDiscountedPrice(
      product.price,
      product.discount_percent,
    );
    const lowStock = product.stock <= (product.min_stock || 5);
    const doubleLow = product.stock <= (product.min_stock || 5) * 2;
    const progressPct = Math.min(
      (product.startOfDay || 0) > 0
        ? (product.stock / product.startOfDay) * 100
        : 100,
      100,
    );
    return (
      <STableRow
        data-filtered={dataFiltered ? "true" : "false"}
        className={
          dataFiltered
            ? "py-0.8 hover:bg-primary/5"
            : "[&_.s-cell]:py-1.5 hover:bg-primary/5"
        }
      >
        <STableCell className="px-4 [&_.s-cell]:px-2">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <SAvatar className="h-9 w-9 shrink-0 rounded-md">
              {product.image_path ? (
                <SAvatarImage
                  src={product.image_path}
                  alt={product.name}
                  className="object-cover"
                />
              ) : (
                <SAvatarFallback className="rounded-md bg-primary/10 text-primary">
                  <Package className="h-4 w-4" />
                </SAvatarFallback>
              )}
            </SAvatar>
            <div className="min-w-0 overflow-hidden">
              <div className="flex items-center gap-1">
                <span
                  className={`text-sm font-semibold leading-tight text-foreground ${
                    dataFiltered ? "truncate" : "line-clamp-1"
                  }`}
                >
                  {product.name}
                </span>
                {product.sale_unit === "weight" && (
                  <ProductChip
                    icon={Scale}
                    label="kg"
                    tooltip="Se vende por peso"
                  />
                )}
                {isContainerUnit(product.sale_unit) &&
                  product.sale_unit === "boxpack" && (
                    <ProductChip
                      icon={Boxes}
                      label="caja·paquete"
                      tooltip="Se vende en caja y en paquete"
                    />
                  )}
                {isContainerUnit(product.sale_unit) &&
                  product.sale_unit === "box" && (
                    <ProductChip
                      icon={Boxes}
                      label="caja"
                      tooltip={`Caja de ${product.box_qty || "—"} pzas`}
                    />
                  )}
                {isContainerUnit(product.sale_unit) &&
                  product.sale_unit === "package" && (
                    <ProductChip
                      icon={Package}
                      label="paquete"
                      tooltip={`Paquete de ${product.box_qty || "—"} pzas`}
                    />
                  )}
                {product.discount_percent > 0 && (
                  <ProductChip
                    variant="rebaja"
                    icon={Percent}
                    label={`-${product.discount_percent}%`}
                  />
                )}
                {product.prices?.length > 0 && (
                  <ProductChip
                    variant="mayoreo"
                    icon={Layers}
                    label="Mayoreo"
                    tooltip="Precio por volumen (mayoreo)"
                  />
                )}
              </div>
              <span className="block truncate text-xs text-muted-foreground">
                {product.brand || ""}
              </span>
            </div>
          </div>
        </STableCell>
        <STableCell className="px-4 text-right">
          {product.discount_percent > 0 ? (
            <div>
              <span className="block text-xs text-muted-foreground line-through">
                ${product.price.toFixed(2)}
              </span>
              <span className="block text-sm font-bold text-red-600 dark:text-red-400">
                ${finalPrice.toFixed(2)}
              </span>
            </div>
          ) : (
            <span className="text-sm font-semibold">
              ${boxPriceDisplay(product).toFixed(2)}
            </span>
          )}
        </STableCell>
        <STableCell className="min-w-[150px] px-4 text-center">
          <span className="text-sm text-foreground">
            {Number.isFinite(product.startOfDay)
              ? `${fmtStockNumber(product, product.stock)} / ${fmtStockNumber(product, product.startOfDay)}`
              : fmtStockNumber(product, product.stock)}{" "}
            <span className="font-normal text-muted-foreground">
              {stockUnitCompact(product)}
            </span>
          </span>
          {(product.todayIn > 0 || product.todaySold > 0) && (
            <div className="mt-0.5 flex justify-center gap-1.5">
              {product.todayIn > 0 && (
                <span className="text-[0.65rem] font-bold text-emerald-500">
                  +{product.todayIn} hoy
                </span>
              )}
              {product.todaySold > 0 && (
                <span className="text-[0.65rem] font-bold text-red-500">
                  -{product.todaySold} ventas
                </span>
              )}
            </div>
          )}
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                lowStock
                  ? "bg-red-500"
                  : doubleLow
                    ? "bg-amber-500"
                    : "bg-primary",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </STableCell>
        <STableCell className="px-4 text-center">
          <StatusBadge label={stockStatus.label} color={stockStatus.color} />
        </STableCell>
        <STableCell className="px-4 text-center">
          <div className="inline-flex items-center gap-0.5">
            <STooltip>
              <STooltipTrigger asChild>
                <SButton
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onView(product)}
                >
                  <Eye className="h-4 w-4" />
                </SButton>
              </STooltipTrigger>
              <STooltipContent>Ver Detalles</STooltipContent>
            </STooltip>
            <STooltip>
              <STooltipTrigger asChild>
                <SButton
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(product)}
                >
                  <Pencil className="h-4 w-4" />
                </SButton>
              </STooltipTrigger>
              <STooltipContent>Editar</STooltipContent>
            </STooltip>
            <STooltip>
              <STooltipTrigger asChild>
                <SButton
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onAddStock(product)}
                >
                  <Plus className="h-4 w-4" />
                </SButton>
              </STooltipTrigger>
              <STooltipContent>Agregar Stock</STooltipContent>
            </STooltip>
            <SDropdownMenu>
              <SDropdownMenuTrigger asChild>
                <SButton variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </SButton>
              </SDropdownMenuTrigger>
              <SDropdownMenuContent align="end">
                <SDropdownMenuItem
                  disabled={!isAdmin}
                  onClick={() => onReduceStock(product)}
                >
                  <Minus className="mr-2 h-4 w-4" />
                  Reducir Stock
                </SDropdownMenuItem>
                <SDropdownMenuSeparator />
                <SDropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(product)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </SDropdownMenuItem>
              </SDropdownMenuContent>
            </SDropdownMenu>
          </div>
        </STableCell>
      </STableRow>
    );
  },
);
ProductRow.displayName = "ProductRow";

const FilterCombobox = ({ label, value, options, emptyValue, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => String(o.id) === String(value));
  const filtered = useMemo(
    () =>
      query.trim()
        ? options.filter((o) =>
            o.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
        : options,
    [options, query],
  );
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SButton
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {selected ? selected.name : emptyValue}
            {open ? (
              <ArrowUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            )}
          </SButton>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput
              placeholder={`Buscar ${label.toLowerCase()}...`}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>Sin resultados</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value=""
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  {emptyValue}
                </CommandItem>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.name}
                    onSelect={() => {
                      onChange(String(o.id));
                      setOpen(false);
                    }}
                  >
                    {o.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

const InventoryStatsCards = React.memo(function InventoryStatsCards({ stats }) {
  const items = [
    {
      label: "Total Productos",
      value: stats.totalCount,
      icon: Package,
      iconCls: "bg-primary/10 text-primary",
      hoverCls: "hover:border-primary/40",
    },
    {
      label: "Stock Bajo",
      value: stats.lowStockCount,
      icon: TriangleAlert,
      iconCls: "bg-red-500/10 text-red-600 dark:text-red-400",
      hoverCls: "hover:border-red-500/40",
    },
    {
      label: "En Rebaja",
      value: stats.discountedCount,
      icon: Percent,
      iconCls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      hoverCls: "hover:border-amber-500/40",
    },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((s) => (
        <div
          key={s.label}
          className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${s.hoverCls}`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${s.iconCls}`}
            >
              <s.icon className="h-4 w-4" />
            </span>
            <p className="text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
              {s.label}
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
});

const Inventory = () => {
  const notify = useToast();
  const { cashier } = useCashier();
  const isAdmin = cashier?.role === "admin";
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [stats, setStats] = useState({
    totalCount: 0,
    totalValue: 0,
    lowStockCount: 0,
    discountedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [scrollState, setScrollState] = useState({ top: 0, height: 600 });
  const tableScrollRef = useRef(null);
  const rafRef = useRef(0);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [viewDetailsOpen, setViewDetailsOpen] = useState(false);
  const [daySummary, setDaySummary] = useState(null);
  const [showAdds, setShowAdds] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingStock, setAddingStock] = useState(false);
  const [removingStock, setRemovingStock] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockQtyError, setStockQtyError] = useState("");
  const [stockCost, setStockCost] = useState("");
  const [stockRegisterExpense, setStockRegisterExpense] = useState(
    () => localStorage.getItem("stockRegisterExpense") === "true",
  );
  const [costConfirmOpen, setCostConfirmOpen] = useState(false);
  const [stockCostConfirm, setStockCostConfirm] = useState(null);
  const [stockUnitMode, setStockUnitMode] = useState("box");
  const [reduceModalOpen, setReduceModalOpen] = useState(false);
  const [reduceQty, setReduceQty] = useState("");
  const [reduceQtyError, setReduceQtyError] = useState("");
  const [reduceNote, setReduceNote] = useState("");
  const [reduceUnitMode, setReduceUnitMode] = useState("box");
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const isFiltered =
    Boolean(debouncedSearch) ||
    Boolean(selectedCategory) ||
    Boolean(selectedSupplier);
  const pageSize = isFiltered ? PAGE_SIZE : Math.min(rowsPerPage, MAX_ROWS_PER_PAGE);
  const scanBufferRef = useRef("");
  const scanTimeoutRef = useRef(null);
  const [initialBarcode, setInitialBarcode] = useState("");

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const [result, cats, sups] = await Promise.all([
      window.api.invoke("get-products", {
        search: debouncedSearch || undefined,
        category_id: selectedCategory || undefined,
        supplier_id: selectedSupplier || undefined,
        sortField,
        sortDir,
        page,
        rowsPerPage: pageSize,
      }),
      window.api.invoke("get-categories"),
      window.api.invoke("get-suppliers"),
    ]);
    setProducts(result.products);
    setTotal(result.total);
    setCategories(cats || []);
    setSuppliers(sups || []);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [
    debouncedSearch,
    selectedCategory,
    selectedSupplier,
    sortField,
    sortDir,
    page,
    rowsPerPage,
  ]);

  const fetchStats = useCallback(async () => {
    const result = await window.api.invoke("get-products", {
      category_id: selectedCategory || undefined,
      supplier_id: selectedSupplier || undefined,
      page: 0,
      rowsPerPage: 1,
    });
    setStats(
      result?.stats || {
        totalCount: 0,
        totalValue: 0,
        lowStockCount: 0,
        discountedCount: 0,
      },
    );
  }, [selectedCategory, selectedSupplier]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (viewDetailsOpen && selectedProduct) {
      setDaySummary(null);
      setShowAdds(false);
      window.api
        .invoke("get-product-day-summary", { productId: selectedProduct.id })
        .then(setDaySummary)
        .catch(() => setDaySummary(null));
    }
  }, [viewDetailsOpen, selectedProduct]);

  useEffect(() => {
    const handler = () => setIsModalOpen(true);
    window.addEventListener("ctrl-n", handler);
    return () => window.removeEventListener("ctrl-n", handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.activeElement?.tagName === "INPUT") return;

      if (e.key === "Enter") {
        const code = scanBufferRef.current;
        scanBufferRef.current = "";
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        if (code.length >= 3) {
          (async () => {
            const result = await window.api.invoke(
              "get-product-by-barcode",
              code,
            );
            if (result.success && result.product) {
              setSelectedProduct(result.product);
              setStockQuantity("");
              setStockCost("");
              setStockUnitMode("box");
              setStockModalOpen(true);
            } else {
              setInitialBarcode(code);
              setIsModalOpen(true);
            }
          })();
        }
        return;
      }

      if (e.key.length === 1) {
        scanBufferRef.current += e.key;
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = setTimeout(() => {
          scanBufferRef.current = "";
        }, 100);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setPage(0);
    setScrollState({ top: 0, height: 600 });
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }, [searchTerm, selectedCategory, selectedSupplier]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 150);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleScroll = useCallback(
    (e) => {
      const el = e.currentTarget;
      const top = el.scrollTop;
      const height = el.clientHeight;
      const scrollHeight = el.scrollHeight;

      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setScrollState({ top, height });

        if (isFiltered && !loading && page + 1 < Math.ceil(total / pageSize)) {
          if (top + height >= scrollHeight - 80) {
            setPage((p) => p + 1);
          }
        }
      });
    },
    [isFiltered, loading, page, total, pageSize],
  );

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
    if (isFiltered) {
      setPage(0);
      setScrollState({ top: 0, height: 600 });
      if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }
  };

  const handleProductAdded = () => {
    fetchProducts();
    notify("Producto guardado correctamente.", "success");
  };

  const handleViewDetails = useCallback((product) => {
    setSelectedProduct(product);
    setViewDetailsOpen(true);
  }, []);
  const handleEditProduct = useCallback((product) => {
    setSelectedProduct(product);
    setEditModalOpen(true);
  }, []);
  const handleDeleteProduct = useCallback((product) => {
    setSelectedProduct(product);
    setDeleteConfirmOpen(true);
  }, []);
  const handleAddStock = useCallback((product) => {
    setSelectedProduct(product);
    setStockQuantity("");
    setStockQtyError("");
    setStockCost("");
    setStockRegisterExpense(false);
    setStockUnitMode("box");
    setStockModalOpen(true);
  }, []);
  const handleReduceStock = useCallback((product) => {
    setSelectedProduct(product);
    setReduceQty("");
    setReduceQtyError("");
    setReduceNote("");
    setReduceUnitMode("box");
    setReduceModalOpen(true);
  }, []);

  const confirmDelete = async () => {
    if (selectedProduct) {
      setDeleting(true);
      try {
        const result = await window.api.invoke(
          "delete-product",
          selectedProduct.id,
        );
        if (!result?.success) {
          notify(result?.error || "No se pudo eliminar el producto", "error");
        } else {
          notify("Producto eliminado correctamente.", "success");
        }
        fetchProducts();
        setDeleteConfirmOpen(false);
        setSelectedProduct(null);
      } finally {
        setDeleting(false);
      }
    }
  };

  const doAddStock = async (updateCostPrice) => {
    if (!selectedProduct || stockQuantity <= 0) return;
    if (
      selectedProduct.sale_unit !== "weight" &&
      !/^\d+$/.test(String(stockQuantity).trim())
    ) {
      setStockQtyError("Cantidad no válida. Solo números enteros.");
      return;
    }
    setStockQtyError("");
    const actualQty =
      isContainerUnit(selectedProduct.sale_unit) && selectedProduct.box_qty > 0
        ? stockQuantity *
          (stockUnitMode === "pz" ? 1 : selectedProduct.box_qty)
        : stockQuantity;
    const costNum = parseFloat(stockCost) || 0;
    const totalCost =
      costNum > 0
        ? costNum
        : isContainerUnit(selectedProduct.sale_unit) &&
            selectedProduct.box_qty > 0
          ? ((selectedProduct.cost_price || 0) / selectedProduct.box_qty) *
            actualQty
          : (selectedProduct.cost_price || 0) * actualQty;
    setAddingStock(true);
    try {
      const result = await window.api.invoke("add-stock", {
        productId: selectedProduct.id,
        quantity: actualQty,
        cost: costNum,
        cashierId: cashier?.id,
        registerExpense: stockRegisterExpense,
        updateCostPrice,
      });
      if (result.success) {
        setStockModalOpen(false);
        setSelectedProduct(null);
        fetchProducts();
        if (!stockRegisterExpense) {
          notify("Stock agregado. No se registró gasto en caja.", "info");
        } else {
          notify("Stock agregado y gasto registrado.", "success");
        }
      } else {
        notify(result.error, "error");
      }
    } finally {
      setAddingStock(false);
    }
  };

  const confirmAddStock = async () => {
    if (!selectedProduct || stockQuantity <= 0) return;
    if (
      selectedProduct.sale_unit !== "weight" &&
      !/^\d+$/.test(String(stockQuantity).trim())
    ) {
      setStockQtyError("Cantidad no válida. Solo números enteros.");
      return;
    }
    setStockQtyError("");
    const isBox =
      isContainerUnit(selectedProduct.sale_unit) &&
      selectedProduct.box_qty > 0;
    const costNum = parseFloat(stockCost) || 0;
    if (costNum > 0) {
      const expected = (selectedProduct.cost_price || 0) * stockQuantity;
      const diff = costNum - expected;
      if (Math.abs(diff) >= 1) {
        setStockCostConfirm({
          oldCost: selectedProduct.cost_price || 0,
          newCost: Math.round((costNum / stockQuantity + Number.EPSILON) * 100) / 100,
          direction: diff > 0 ? "subio" : "bajo",
          isBox,
          saleUnit: selectedProduct.sale_unit,
        });
        setCostConfirmOpen(true);
        return;
      }
    }
    await doAddStock(null);
  };

  const handleCostConfirmYes = async () => {
    const confirm = stockCostConfirm;
    setCostConfirmOpen(false);
    setStockCostConfirm(null);
    await doAddStock(confirm?.newCost ?? null);
  };

  const handleCostConfirmNo = async () => {
    setCostConfirmOpen(false);
    setStockCostConfirm(null);
    await doAddStock(null);
  };

  const confirmRemoveStock = async () => {
    if (!selectedProduct || reduceQty <= 0) return;
    if (
      selectedProduct.sale_unit !== "weight" &&
      !/^\d+$/.test(String(reduceQty).trim())
    ) {
      setReduceQtyError("Cantidad no válida. Solo números enteros.");
      return;
    }
    setReduceQtyError("");
    const actualQty =
      isContainerUnit(selectedProduct.sale_unit) && selectedProduct.box_qty > 0
        ? (parseFloat(reduceQty) || 0) *
          (reduceUnitMode === "pz" ? 1 : selectedProduct.box_qty)
        : parseFloat(reduceQty) || 0;
    setRemovingStock(true);
    try {
      const result = await window.api.invoke("remove-stock", {
        productId: selectedProduct.id,
        quantity: actualQty,
        notes: reduceNote.trim() || "Salida de stock",
        role: cashier?.role,
        cashierId: cashier?.id,
      });
      if (result.success) {
        setReduceModalOpen(false);
        setSelectedProduct(null);
        fetchProducts();
      } else {
        notify(result.error, "error");
      }
    } finally {
      setRemovingStock(false);
    }
  };

  const reducePiezas =
    isContainerUnit(selectedProduct?.sale_unit) && selectedProduct?.box_qty > 0
      ? (parseFloat(reduceQty) || 0) *
        (reduceUnitMode === "pz" ? 1 : selectedProduct.box_qty)
      : parseFloat(reduceQty) || 0;

  const addPiezas =
    isContainerUnit(selectedProduct?.sale_unit) && selectedProduct?.box_qty > 0
      ? (parseFloat(stockQuantity) || 0) *
        (stockUnitMode === "pz" ? 1 : selectedProduct.box_qty)
      : parseFloat(stockQuantity) || 0;

  const exportInventoryCSV = async () => {
    const result = await window.api.invoke("get-all-products");
    const allProducts = result.products || [];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header =
      "ID,Nombre,Marca,Categoría,Proveedor,Precio,Rebaja %,Precio Final,Stock,Unidad,Stock Mínimo,Código de Barras\n";
    const rows = allProducts
      .map((p) => {
        const finalPrice = calcDiscountedPrice(p.price, p.discount_percent);
        return [
          p.id,
          esc(p.name),
          esc(p.brand),
          esc(p.category_name),
          esc(p.supplier_name),
          Number(p.price || 0).toFixed(2),
          Number(p.discount_percent || 0),
          finalPrice.toFixed(2),
          p.sale_unit === "weight" ? fmtKg(p.stock) : p.stock,
          stockUnit(p),
          p.min_stock || 5,
          esc(p.barcode),
        ].join(",");
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventario-completo-${mxToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startIndex = Math.max(
    0,
    Math.floor(scrollState.top / ROW_HEIGHT) - BUFFER_ROWS,
  );
  const visibleRows =
    Math.ceil(scrollState.height / ROW_HEIGHT) + BUFFER_ROWS * 2;
  const endIndex = Math.min(products.length, startIndex + visibleRows);

  return (
    <div className="p-1">
      <div className="mb-4 flex items-center justify-end gap-2">
        <SButton
          variant="outline"
          size="sm"
          onClick={exportInventoryCSV}
        >
          <Download className="mr-1.5 h-4 w-4" />
          Exportar
        </SButton>
        <SButton size="sm" onClick={() => setIsModalOpen(true)}>
          <PlusCircle className="mr-1.5 h-4 w-4" />
          Nuevo Producto
          <KbdGroup className="ml-1">
            <Kbd className="h-[18px] rounded-[6px] border border-slate-200/60 bg-slate-300/35 px-1.5 font-sans text-[12px] font-bold leading-none text-slate-50 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
              Ctrl
            </Kbd>
            <Kbd className="h-[18px] rounded-[6px] border border-slate-200/60 bg-slate-300/35 px-1.5 font-sans text-[12px] font-bold leading-none text-slate-50 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
              N
            </Kbd>
          </KbdGroup>
        </SButton>
      </div>

      {loading && !hasLoadedOnce ? (
        <CardSkeleton count={3} />
      ) : (
        <InventoryStatsCards stats={stats} />
      )}

      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-search">Buscar productos</Label>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <SInput
                id="inv-search"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setDebouncedSearch(searchTerm);
                }}
                placeholder="Nombre, marca o código"
                className="pl-9"
              />
            </div>
          </div>
          <FilterCombobox
            label="Categoría"
            value={selectedCategory}
            options={categories}
            emptyValue="Todas las categorías"
            onChange={setSelectedCategory}
          />
          <FilterCombobox
            label="Proveedor"
            value={selectedSupplier}
            options={suppliers}
            emptyValue="Todos los proveedores"
            onChange={setSelectedSupplier}
          />
        </div>
      </div>

      {!loading && stats.lowStockCount > 0 && (
        <SAlert variant="warning" className="mb-5">
          <TriangleAlert className="h-4 w-4" />
          <SAlertTitle>
            {stats.lowStockCount} producto(s) con stock bajo
          </SAlertTitle>
        </SAlert>
      )}

      <STooltipProvider delayDuration={200}>
        <div className="flex h-full w-full flex-col">
          <div
            ref={tableScrollRef}
            onScroll={handleScroll}
            className="min-h-0 w-full flex-1 overflow-y-auto rounded-xl border border-border bg-card"
          >
            <STable>
              <STableHeader>
                <STableRow className="bg-muted/40 hover:bg-transparent">
                  <SortHead label="Producto" k="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHead label="Precio" k="price" align="right" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHead label="Stock" k="stock" align="center" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <STableHead className="px-4 text-center font-semibold text-foreground/75">
                    Estado
                  </STableHead>
                  <STableHead className="px-4 text-center font-semibold text-foreground/75">
                    Acciones
                  </STableHead>
                </STableRow>
              </STableHeader>
              <STableBody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => (
                    <STableRow key={i}>
                      <STableCell className="px-4">
                        <div className="flex items-center gap-1.5">
                          <SAvatar className="h-9 w-9 shrink-0 rounded-md">
                            <Skeleton className="h-full w-full rounded-md" />
                          </SAvatar>
                          <div className="space-y-1 min-w-0">
                            <Skeleton className="h-4 w-48 max-w-full" />
                            <Skeleton className="h-3 w-32" />
                          </div>
                        </div>
                      </STableCell>
                      <STableCell className="px-4 text-right">
                        <Skeleton className="h-4 w-24" />
                      </STableCell>
                      <STableCell className="px-4 text-center">
                        <Skeleton className="h-2 w-16 mx-auto" />
                        <Skeleton className="h-2 w-10 mx-auto mt-1" />
                      </STableCell>
                      <STableCell className="px-4 text-center">
                        <Skeleton className="h-5 w-16 mx-auto" />
                      </STableCell>
                      <STableCell className="px-4 text-center">
                        <Skeleton className="h-8 w-8 mx-auto" />
                      </STableCell>
                    </STableRow>
                  ))
                ) : products.length === 0 ? (
                  <STableRow className="hover:bg-transparent">
                    <STableCell colSpan={5} className="h-full py-12 text-center">
                      <EmptyState
                        className="h-full"
                        icon={
                          <Store size={32} className="opacity-40" />
                        }
                        title="No hay productos registrados"
                        description='Agrega tu primer producto usando el botón "Nuevo Producto"'
                      />
                    </STableCell>
                  </STableRow>
                ) : (
                  <>
                    {startIndex > 0 && (
                      <STableRow className="h-[52px]">
                        <STableCell
                          colSpan={5}
                          className="border-b-0 py-0"
                          style={{ height: startIndex * ROW_HEIGHT }}
                        />
                      </STableRow>
                    )}
                    {products.slice(startIndex, endIndex).map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        dataFiltered={isFiltered}
                        isAdmin={isAdmin}
                        onView={handleViewDetails}
                        onEdit={handleEditProduct}
                        onAddStock={handleAddStock}
                        onReduceStock={handleReduceStock}
                        onDelete={handleDeleteProduct}
                      />
                    ))}
                    {endIndex < products.length && (
                      <STableRow style={{ height: (products.length - endIndex) * ROW_HEIGHT }}>
                        <STableCell colSpan={5} className="border-b-0 py-0" />
                      </STableRow>
                    )}
                  </>
                )}
              </STableBody>
            </STable>
          </div>
        </div>
      </STooltipProvider>

      {!loading && total > pageSize && (
        <PaginationBar
          pageStart={page * pageSize}
          pageSize={pageSize}
          totalItems={total}
          page={page}
          totalPages={Math.ceil(total / pageSize)}
          setPage={setPage}
        />
      )}

      <AddProductModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setInitialBarcode("");
        }}
        onProductAdded={() => {
          handleProductAdded();
          setInitialBarcode("");
        }}
        initialBarcode={initialBarcode}
      />
      <AddProductModal
        open={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedProduct(null);
        }}
        onProductAdded={handleProductAdded}
        editProduct={selectedProduct}
      />


      <Sheet
        open={viewDetailsOpen}
        onOpenChange={(o) => !o && setViewDetailsOpen(false)}
      >
        {selectedProduct && (
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 p-0 sm:max-w-[720px]"
          >
            {/* ── Franja de presentación (fija) ── */}
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 pb-5 pt-6 pr-5">
              <div className="flex items-center gap-5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-md">
                  {selectedProduct.image_path ? (
                    <img
                      src={selectedProduct.image_path}
                      alt={selectedProduct.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-primary/10">
                      <Package className="h-9 w-9 text-primary" />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center text-center">
                  <SheetTitle className="break-words text-2xl font-extrabold leading-tight">
                    {selectedProduct.name}
                  </SheetTitle>
                  <p className="mt-1 font-mono text-base font-semibold tracking-wider text-muted-foreground">
                    {selectedProduct.barcode || "Sin código"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    {[
                      { icon: Store, text: selectedProduct.brand || "Sin marca" },
                      {
                        icon: TriangleAlert,
                        text: selectedProduct.category_name || "Sin categoría",
                      },
                    ]
                      .filter(Boolean)
                      .map((chip, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-md bg-card/80 px-2 py-1 text-[0.72rem] font-semibold text-muted-foreground shadow-sm"
                        >
                          <chip.icon size={12} className="text-primary" />
                          {chip.text}
                        </span>
                      ))}
                  </div>
                </div>
                <StatusBadge
                  label={getStockStatus(
                    selectedProduct.stock,
                    selectedProduct.min_stock,
                  ).label}
                  color={getStockStatus(
                    selectedProduct.stock,
                    selectedProduct.min_stock,
                  ).color}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-6">
              {/* ── Stock en vivo (protagonista) ── */}
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
                <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    Stock en vivo
                  </span>
                </div>
                <div className="flex flex-col items-center px-5 pb-5 pt-6">
                  <span className="text-[3.2rem] font-extrabold leading-none tracking-tight text-primary">
                    {fmtStockNumber(selectedProduct, selectedProduct.stock)}
                  </span>
                  <span className="mt-1.5 text-sm font-semibold text-muted-foreground">
                    {stockUnitCompact(selectedProduct)}
                  </span>

                  {daySummary && daySummary.lastChange && (() => {
                    const badgeDelta = daySummary.lastChange.isToday
                      ? daySummary.lastChange.delta >= 0
                        ? daySummary.todayIn
                        : daySummary.todayOut
                      : daySummary.lastChange.delta;
                    const positive = badgeDelta >= 0;
                    const absDelta = Math.abs(badgeDelta);
                    const isBox =
                      isContainerUnit(selectedProduct.sale_unit) &&
                      selectedProduct.box_qty > 0;
                    const cajas = isBox
                      ? Math.floor(absDelta / selectedProduct.box_qty)
                      : 0;
                    const pzas = isBox
                      ? absDelta % selectedProduct.box_qty
                      : absDelta;
                    const showCajas = isBox && cajas > 0;
                    const showPzas =
                      (isBox && pzas > 0) || !isBox;
                    return (
                      <span
                        className={cn(
                          "mt-3 inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-[0.72rem] font-bold",
                          positive
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/15 text-red-600 dark:text-red-400",
                        )}
                      >
                        {positive ? (
                          <Plus size={12} strokeWidth={3} />
                        ) : (
                          <Minus size={12} strokeWidth={3} />
                        )}
                        {showCajas && (
                          <span>
                            {cajas}{" "}
                            {selectedProduct.sale_unit === "boxpack"
                              ? "cajas"
                              : unitLabels(selectedProduct.sale_unit).plural}
                          </span>
                        )}
                        {showCajas && showPzas && (
                          <span className="px-0.5 opacity-70">·</span>
                        )}
                        {showPzas && (
                          <span>
                            {pzas}{" "}
                            {selectedProduct.sale_unit === "weight"
                              ? "kg"
                              : "pz"}
                          </span>
                        )}
                        {daySummary.lastChange.isToday && (
                          <span className="ml-0.5 text-[0.62rem] opacity-90">
                            hoy
                          </span>
                        )}
                      </span>
                    );
                  })()}

                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 &&
                    selectedProduct.stock >= selectedProduct.box_qty && (
                      <span className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[0.82rem] font-bold text-primary">
                        {selectedProduct.stock} piezas
                      </span>
                    )}
                </div>

                {daySummary &&
                  daySummary.lastChange &&
                  daySummary.previo !== undefined && (
                    <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                      <div className="flex flex-col items-center px-2 py-3">
                        <span className="inline-flex items-center gap-1 text-[0.62rem] font-bold uppercase tracking-wide text-emerald-500">
                          <TrendingUp size={11} /> Entradas hoy
                        </span>
                        <span className="mt-1 text-sm font-extrabold">
                          {(daySummary.todayIn || 0)} pz
                        </span>
                      </div>
                      <div className="flex flex-col items-center px-2 py-3">
                        <span className="text-[0.62rem] font-bold uppercase tracking-wide text-muted-foreground">
                          Stock previo
                        </span>
                        <span className="mt-1 text-sm font-extrabold">
                          {fmtStock(selectedProduct, daySummary.previo)}
                        </span>
                      </div>
                      <div className="flex flex-col items-center px-2 py-3">
                        <span className="inline-flex items-center gap-1 text-[0.62rem] font-bold uppercase tracking-wide text-red-500">
                          <TrendingDown size={11} /> Ventas hoy
                        </span>
                        <span className="mt-1 text-sm font-extrabold">
                          {(daySummary.todayOut || 0)} pz
                        </span>
                      </div>
                    </div>
                  )}

                {daySummary &&
                  daySummary.lastChange &&
                  daySummary.showHistory &&
                  daySummary.adds.length > 0 && (
                    <div className="border-t border-border px-5 py-3">
                      <button
                        type="button"
                        onClick={() => setShowAdds((v) => !v)}
                        className="inline-flex cursor-pointer items-center gap-1 p-0 text-[0.72rem] font-medium text-muted-foreground hover:text-foreground"
                      >
                        <History size={13} />
                        {showAdds
                          ? "Ocultar cargas"
                          : `Ver cargas ${daySummary.isToday ? "de hoy" : `del ${fmtDateShort(daySummary.lastDay)}`}`}
                        {showAdds ? (
                          <ChevronUp size={13} />
                        ) : (
                          <ChevronDown size={13} />
                        )}
                      </button>
                      {showAdds && (
                        <div className="mt-1">
                          {daySummary.adds.map((a, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between py-0.5"
                            >
                              <div className="flex items-center gap-1.5">
                                <Clock size={11} className="text-slate-400" />
                                <span className="font-mono text-[0.68rem] text-muted-foreground">
                                  {formatMXTime(a.created_at)}
                                </span>
                                <span className="text-[0.72rem] font-bold text-emerald-500">
                                  +{fmtStock(selectedProduct, a.quantity)}
                                </span>
                              </div>
                              <span className="text-[0.68rem] text-muted-foreground">
                                → {fmtStock(selectedProduct, a.stockAfter)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>

              {/* ── Rebaja ── */}
              {selectedProduct.discount_percent > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <span className="text-2xl font-extrabold leading-none text-red-600 dark:text-red-400">
                    ${calcDiscountedPrice(
                      selectedProduct.price,
                      selectedProduct.discount_percent,
                    ).toFixed(2)}
                  </span>
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-xs font-bold text-red-600 dark:text-red-400">
                    <Percent size={12} />
                    REBAJA -{selectedProduct.discount_percent}%
                  </span>
                </div>
              )}

              {/* ── Precios ── */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-border bg-card p-4 text-center shadow-md">
                  <span className="inline-flex rounded-md bg-primary/10 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-primary">
                    Precio Venta
                  </span>
                  <div className="mt-3">
                    {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 &&
                    selectedProduct.stock >= selectedProduct.box_qty ? (
                      <>
                        <p className="text-3xl font-extrabold leading-none text-primary">
                          ${(selectedProduct.box_price || 0).toFixed(2)}
                        </p>
                        <p className="mt-1.5 text-[0.75rem] text-muted-foreground">
                          Pieza: $
                          {(
                            selectedProduct.sale_unit === "boxpack"
                              ? selectedProduct.pack_price || 0
                              : selectedProduct.price || 0
                          ).toFixed(2)}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-3xl font-extrabold leading-none text-primary">
                          $
                          {selectedProduct.discount_percent > 0
                            ? calcDiscountedPrice(
                                selectedProduct.price,
                                selectedProduct.discount_percent,
                              ).toFixed(2)
                            : selectedProduct.price.toFixed(2)}
                        </p>
                        {selectedProduct.discount_percent > 0 && (
                          <p className="mt-1.5 text-[0.8rem] text-muted-foreground line-through">
                            ${selectedProduct.price.toFixed(2)}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-center shadow-md">
                  <span className="inline-flex rounded-md bg-muted px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-muted-foreground">
                    Precio Costo
                  </span>
                  <p className="mt-3 text-3xl font-extrabold leading-none">
                    ${(selectedProduct.cost_price || 0).toFixed(2)}
                  </p>
                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 && (
                      <p className="mt-1.5 text-[0.78rem] text-muted-foreground">
                        Pieza: $
                        {(
                          (selectedProduct.cost_price || 0) /
                          selectedProduct.box_qty
                        ).toFixed(2)}
                      </p>
                    )}
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-center shadow-md">
                  <span className="inline-flex rounded-md bg-muted px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-muted-foreground">
                    Margen
                  </span>
                  <div className="mt-3 flex justify-center">
                    {(() => {
                      const m = calcMarginPct(selectedProduct);
                      const color =
                        m === null
                          ? "bg-slate-200 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400"
                          : m >= 0
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/15 text-red-600 dark:text-red-400";
                      return (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-lg font-extrabold",
                            color,
                          )}
                        >
                          {m !== null ? `${m.toFixed(0)}%` : "—"}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* ── Paquete / Mayoreo ── */}
              {(selectedProduct.sale_unit === "boxpack" &&
                selectedProduct.pack_qty > 0) ||
              selectedProduct.prices?.length > 0 ? (
                <div className="rounded-xl border border-border bg-accent/40 p-5 shadow-md">
                  {selectedProduct.sale_unit === "boxpack" &&
                    selectedProduct.pack_qty > 0 && (
                      <div
                        className={cn(
                          "flex flex-wrap items-center gap-2.5",
                          selectedProduct.prices?.length && "mb-3",
                        )}
                      >
                        <Package className="h-4 w-4 text-cyan-500" />
                        <span className="text-sm font-semibold text-muted-foreground">
                          Paquete
                        </span>
                        <span className="rounded-md bg-cyan-500/10 px-2 py-0.5 text-sm font-extrabold text-cyan-600 dark:text-cyan-400">
                          $
                          {(
                            selectedProduct.sale_unit === "boxpack"
                              ? selectedProduct.price || 0
                              : selectedProduct.pack_price || 0
                          ).toFixed(2)}
                        </span>
                        <span className="text-[0.8rem] text-muted-foreground">
                          ({selectedProduct.pack_qty} pzas/paquete)
                        </span>
                        {(() => {
                          const c = selectedProduct.cost_price || 0;
                          const bq = selectedProduct.box_qty || 0;
                          const pq = selectedProduct.pack_qty || 0;
                          const pp =
                            selectedProduct.sale_unit === "boxpack"
                              ? selectedProduct.price || 0
                              : selectedProduct.pack_price || 0;
                          if (c <= 0 || pq <= 0 || pp <= 0) return null;
                          const pieceCost = bq > 0 ? c / bq : c;
                          const packCost = pieceCost * pq;
                          const m = ((pp - packCost) / packCost) * 100;
                          return (
                            <span
                              className={cn(
                                "rounded-md bg-card px-2 py-0.5 text-[0.8rem] font-bold",
                                m >= 0
                                  ? "text-emerald-600"
                                  : "text-red-600",
                              )}
                            >
                              margen {m.toFixed(0)}%
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  {selectedProduct.prices?.length > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                        <Layers size={14} className="text-primary" />
                        Promociones por cantidad
                      </p>
                      <div className="space-y-1.5">
                        {selectedProduct.prices
                          .slice()
                          .sort((a, b) => a.qty - b.qty)
                          .map((t, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[0.82rem] transition-colors hover:bg-muted/50"
                            >
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                {t.type === "mayoreo" ? (
                                  <TrendingUp size={13} className="text-primary" />
                                ) : (
                                  <Percent size={13} className="text-purple-500" />
                                )}
                                {t.type === "mayoreo"
                                  ? `Mayoreo desde ${t.qty} pzas`
                                  : `Combo ${t.qty}`}
                              </span>
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 font-bold",
                                  t.type === "mayoreo"
                                    ? "bg-primary/10 text-primary"
                                    : "bg-purple-500/10 text-purple-600 dark:text-purple-400",
                                )}
                              >
                                ${t.price.toFixed(2)}
                                {t.type === "mayoreo" ? "/pza" : ""}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* ── Proveedor ── */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-md">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                    <Store className="h-5 w-5 text-primary" />
                  </span>
                  <p className="text-sm font-extrabold text-primary">
                    Información del Proveedor
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[0.62rem] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                      Nombre
                    </p>
                    <p className="text-[0.85rem] font-semibold">
                      {selectedProduct.supplier_name || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.62rem] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                      Teléfono
                    </p>
                    <p className="text-[0.85rem] font-semibold">
                      {selectedProduct.supplier_phone || "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(o) => !o && setDeleteConfirmOpen(false)}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target?.tagName !== "BUTTON")
              confirmDelete();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Trash2 className="h-5 w-5 text-destructive" />
              Confirmar Eliminación
            </DialogTitle>
            <DialogDescription className="text-base">
              ¿Eliminar "{selectedProduct?.name}"? El producto se ocultará del
              inventario y no podrá venderse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <CancelButton onClick={() => setDeleteConfirmOpen(false)}>
              Cancelar
            </CancelButton>
            <SButton
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {deleting ? "Eliminando..." : "Eliminar"}
            </SButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={stockModalOpen}
        onOpenChange={(o) => !o && setStockModalOpen(false)}
      >
        <DialogContent
          className="max-w-[448px] gap-0 p-0 sm:rounded-xl overflow-hidden"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target?.tagName !== "BUTTON")
              confirmAddStock();
          }}
        >
          <div className="min-w-0 p-6">
            <DialogHeader className="pb-4">
              <div className="flex min-w-0 items-center gap-3 pr-10">
                <span className="flex rounded-lg bg-emerald-600 p-2.5">
                  <Warehouse className="h-5 w-5 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-lg leading-tight">
                    Agregar Stock
                  </DialogTitle>
                  {selectedProduct && (
                    <DialogDescription
                      className="block min-w-0 truncate"
                      title={selectedProduct.name}
                    >
                      Entrada de inventario — {selectedProduct.name}
                    </DialogDescription>
                  )}
                </div>
                {selectedProduct && (
                  <StatusBadge
                    label={getStockStatus(
                      selectedProduct.stock,
                      selectedProduct.min_stock,
                    ).label}
                    color={getStockStatus(
                      selectedProduct.stock,
                      selectedProduct.min_stock,
                    ).color}
                  />
                )}
              </div>
            </DialogHeader>

            {selectedProduct && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 && (
                      <div className="flex justify-center">
                        <div className="flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => setStockUnitMode("box")}
                            className={cn(
                              "rounded-lg px-4 py-1 text-sm font-medium transition-colors",
                              stockUnitMode === "box"
                                ? "bg-background text-foreground shadow"
                                : "hover:text-foreground",
                            )}
                          >
                            Cajas
                          </button>
                          <button
                            type="button"
                            onClick={() => setStockUnitMode("pz")}
                            className={cn(
                              "rounded-lg px-4 py-1 text-sm font-medium transition-colors",
                              stockUnitMode === "pz"
                                ? "bg-background text-foreground shadow"
                                : "hover:text-foreground",
                            )}
                          >
                            Piezas
                          </button>
                        </div>
                      </div>
                    )}
                  <Label htmlFor="add-stock-qty">
                    {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0
                      ? stockUnitMode === "pz"
                        ? "Cantidad (piezas)"
                        : "Cantidad (cajas)"
                      : selectedProduct.sale_unit === "weight"
                        ? "Cantidad (kg)"
                        : "Cantidad (pzas)"}
                  </Label>
                  <Input
                    id="add-stock-qty"
                    type="number"
                    min={1}
                    step={selectedProduct.sale_unit === "weight" ? 0.1 : 1}
                    value={stockQuantity}
                    onChange={(e) => {
                      setStockQuantity(e.target.value);
                      setStockQtyError("");
                    }}
                    autoFocus
                  />
                  {stockQtyError && (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      {stockQtyError}
                    </p>
                  )}
                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 &&
                    parseInt(stockQuantity) > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {stockUnitMode === "pz"
                          ? `${parseInt(stockQuantity) || 0} piezas = ${
                              ((parseInt(stockQuantity) || 0) /
                                selectedProduct.box_qty) %
                                1 ===
                              0
                                ? (parseInt(stockQuantity) || 0) /
                                  selectedProduct.box_qty
                                : (
                                    (parseInt(stockQuantity) || 0) /
                                    selectedProduct.box_qty
                                  ).toFixed(2)
                            } cajas`
                          : `= ${(parseInt(stockQuantity) || 0) * selectedProduct.box_qty} piezas`}
                      </p>
                    )}
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Costo total de esta compra
                  </p>
                  <div className="relative mt-1.5">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="add-stock-cost"
                      type="number"
                      min={0}
                      step={0.01}
                      value={stockCost}
                      onChange={(e) => setStockCost(e.target.value)}
                      className="pl-7"
                      placeholder={(
                        (isContainerUnit(selectedProduct.sale_unit) &&
                        selectedProduct.box_qty > 0
                          ? (selectedProduct.cost_price || 0) * addPiezas
                          : (selectedProduct.cost_price || 0) * addPiezas) ||
                        0
                      ).toFixed(2)}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Opcional. Vacío = costo del producto × cantidad.
                  </p>
                </div>

                <div
                  className={cn(
                    "rounded-lg border p-3",
                    stockRegisterExpense
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-border bg-muted/40",
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <Checkbox
                      checked={stockRegisterExpense}
                      onCheckedChange={(v) => {
                        setStockRegisterExpense(!!v);
                        localStorage.setItem(
                          "stockRegisterExpense",
                          v ? "true" : "false",
                        );
                      }}
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-bold">
                        Descontar de la caja (egreso)
                      </span>
                      <span className="block text-xs leading-snug text-muted-foreground">
                        {stockRegisterExpense
                          ? "Se registra como compra de inventario y descuenta de la caja abierta."
                          : "No se registra gasto en caja; solo se suma el stock."}
                      </span>
                    </span>
                  </label>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Resultado
                  </p>
                  <div className="mt-2 flex items-stretch gap-2">
                    <div className="flex-1 rounded-md bg-muted/50 p-2 text-center">
                      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Actual
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold">
                        {selectedProduct.sale_unit === "weight"
                          ? `${fmtKg(selectedProduct.stock)} kg`
                          : `${selectedProduct.stock} pz`}
                      </p>
                    </div>
                    <div className="flex items-center text-emerald-600">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <div className="flex-1 rounded-md bg-emerald-500/10 p-2 text-center">
                      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        + Entrada
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        {selectedProduct.sale_unit === "weight"
                          ? `${fmtKg(parseFloat(stockQuantity) || 0)} kg`
                          : `${addPiezas} pz`}
                      </p>
                    </div>
                    <div className="flex items-center text-emerald-600">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <div className="flex-1 rounded-md border border-emerald-500/40 bg-emerald-600 p-2 text-center">
                      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-emerald-100">
                        Resultante
                      </p>
                      <p className="mt-0.5 truncate text-sm font-extrabold text-white">
                        {selectedProduct.sale_unit === "weight"
                          ? `${fmtKg(
                              selectedProduct.stock +
                                (parseFloat(stockQuantity) || 0),
                            )} kg`
                          : `${selectedProduct.stock + addPiezas} pz`}
                      </p>
                    </div>
                  </div>
                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 && (
                      <div className="mt-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                        Actual:{" "}
                        <strong className="text-foreground">
                          {Math.floor(
                            selectedProduct.stock / selectedProduct.box_qty,
                          )}{" "}
                          {unitLabels(selectedProduct.sale_unit).plural}
                        </strong>{" "}
                        → Resultante:{" "}
                        <strong className="text-emerald-600 dark:text-emerald-400">
                          {Math.floor(
                            (selectedProduct.stock + addPiezas) /
                              selectedProduct.box_qty,
                          )}{" "}
                          {unitLabels(selectedProduct.sale_unit).plural}
                        </strong>
                      </div>
                    )}
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                    <span className="text-xs text-muted-foreground">
                      Costo total de esta entrada
                    </span>
                    <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                      ${(() => {
                        const aQty = addPiezas;
                        const c = parseFloat(stockCost) || 0;
                        return (
                          c > 0
                            ? c
                            : isContainerUnit(selectedProduct.sale_unit) &&
                                selectedProduct.box_qty > 0
                              ? ((selectedProduct.cost_price || 0) /
                                  selectedProduct.box_qty) *
                                aQty
                              : (selectedProduct.cost_price || 0) * aQty
                        ).toFixed(2);
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="mt-5 gap-2 border-t border-border pt-4">
              <CancelButton onClick={() => setStockModalOpen(false)}>
                Cancelar
              </CancelButton>
              <SButton
                onClick={confirmAddStock}
                disabled={!stockQuantity || stockQuantity <= 0 || addingStock}
                className="px-4"
              >
                {addingStock && (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                )}
                {addingStock ? "Agregando..." : (
                  <>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Agregar Stock
                  </>
                )}
              </SButton>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={costConfirmOpen}
        onOpenChange={(o) => !o && setCostConfirmOpen(false)}
      >
        <DialogContent
          className="max-w-[448px] gap-0 p-0 sm:rounded-xl overflow-hidden"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target?.tagName !== "BUTTON")
              handleCostConfirmYes();
          }}
        >
          <div
            className={cn(
              "h-1.5 w-full",
              stockCostConfirm?.direction === "subio"
                ? "bg-gradient-to-r from-red-500 to-orange-500"
                : "bg-gradient-to-r from-emerald-500 to-emerald-400",
            )}
          />
          <div className="min-w-0 p-6">
            <DialogHeader className="pb-2">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex rounded-lg p-2.5",
                    stockCostConfirm?.direction === "subio"
                      ? "bg-red-500/10"
                      : "bg-emerald-500/10",
                  )}
                >
                  {stockCostConfirm?.direction === "subio" ? (
                    <TrendingUp className="h-6 w-6 text-red-600" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-emerald-600" />
                  )}
                </span>
                <div>
                  <DialogTitle className="text-lg leading-tight">
                    Actualizar precio de costo
                  </DialogTitle>
                  <DialogDescription className="block">
                    {stockCostConfirm?.isBox
                      ? unitLabels(stockCostConfirm.saleUnit)?.costPer ||
                        "Costo por caja"
                      : "Costo unitario"}{" "}
                    —{" "}
                    <strong
                      className={
                        stockCostConfirm?.direction === "subio"
                          ? "text-red-600"
                          : "text-emerald-600"
                      }
                    >
                      {stockCostConfirm?.direction === "subio"
                        ? "Subió"
                        : "Bajó"}
                    </strong>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {stockCostConfirm && (
              <div className="mt-3 space-y-3">
                <div
                  className={cn(
                    "rounded-xl border p-4",
                    stockCostConfirm.direction === "subio"
                      ? "border-red-500/40 bg-muted/40"
                      : "border-emerald-500/40 bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 text-center">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        Actual
                      </p>
                      <p className="text-lg font-extrabold text-muted-foreground line-through">
                        ${stockCostConfirm.oldCost.toFixed(2)}
                      </p>
                    </div>
                    <ArrowRight
                      className={stockCostConfirm.direction === "subio" ? "text-red-500" : "text-emerald-500"}
                    />
                    <div className="flex-1 text-center">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        Nuevo
                      </p>
                      <p
                        className={
                          stockCostConfirm.direction === "subio"
                            ? "text-xl font-extrabold text-red-600"
                            : "text-xl font-extrabold text-emerald-600"
                        }
                      >
                        ${stockCostConfirm.newCost.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  El precio de costo{" "}
                  <strong
                    className={
                      stockCostConfirm.direction === "subio"
                        ? "text-red-600"
                        : "text-emerald-600"
                    }
                  >
                    {stockCostConfirm.direction === "subio"
                      ? "subió"
                      : "bajó"}
                  </strong>
                  . ¿Quieres actualizarlo al registrar este stock?
                </p>
              </div>
            )}

            <DialogFooter className="mt-4 gap-2">
              <CancelButton onClick={handleCostConfirmNo}>
                No, solo stock
              </CancelButton>
              <SButton onClick={handleCostConfirmYes}>Sí, actualizar</SButton>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reduceModalOpen}
        onOpenChange={(o) => !o && setReduceModalOpen(false)}
      >
        <DialogContent
          className="max-w-[448px] gap-0 p-0 sm:rounded-xl overflow-hidden"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target?.tagName !== "BUTTON")
              confirmRemoveStock();
          }}
        >
          <div className="min-w-0 p-6">
            <DialogHeader className="pb-4">
              <div className="flex min-w-0 items-center gap-3 pr-10">
                <span className="flex rounded-lg bg-amber-500 p-2.5">
                  <Minus className="h-5 w-5 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-lg leading-tight">
                    Reducir Stock
                  </DialogTitle>
                  <DialogDescription
                    className="block min-w-0 truncate"
                    title={selectedProduct?.name}
                  >
                    Salida de inventario —{" "}
                    <strong>{selectedProduct?.name}</strong>
                  </DialogDescription>
                </div>
                {selectedProduct && (
                  <StatusBadge
                    label={getStockStatus(
                      selectedProduct.stock,
                      selectedProduct.min_stock,
                    ).label}
                    color={getStockStatus(
                      selectedProduct.stock,
                      selectedProduct.min_stock,
                    ).color}
                  />
                )}
              </div>
            </DialogHeader>

            {selectedProduct && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 && (
                      <div className="flex justify-center">
                        <div className="flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => setReduceUnitMode("box")}
                            className={cn(
                              "rounded-lg px-4 py-1 text-sm font-medium transition-colors",
                              reduceUnitMode === "box"
                                ? "bg-background text-foreground shadow"
                                : "hover:text-foreground",
                            )}
                          >
                            Cajas
                          </button>
                          <button
                            type="button"
                            onClick={() => setReduceUnitMode("pz")}
                            className={cn(
                              "rounded-lg px-4 py-1 text-sm font-medium transition-colors",
                              reduceUnitMode === "pz"
                                ? "bg-background text-foreground shadow"
                                : "hover:text-foreground",
                            )}
                          >
                            Piezas
                          </button>
                        </div>
                      </div>
                    )}
                  <Label htmlFor="reduce-qty">
                    {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0
                      ? reduceUnitMode === "pz"
                        ? "Cantidad (piezas)"
                        : "Cantidad (cajas)"
                      : "Cantidad a reducir"}
                  </Label>
                  <Input
                    id="reduce-qty"
                    type="number"
                    min={1}
                    max={
                      isContainerUnit(selectedProduct.sale_unit) &&
                      selectedProduct.box_qty > 0
                        ? reduceUnitMode === "pz"
                          ? selectedProduct.stock
                          : Math.floor(
                              selectedProduct.stock / selectedProduct.box_qty,
                            )
                        : selectedProduct.sale_unit === "weight"
                          ? undefined
                          : selectedProduct.stock
                    }
                    step={selectedProduct.sale_unit === "weight" ? 0.1 : 1}
                    value={reduceQty}
                    onChange={(e) => {
                      setReduceQty(e.target.value);
                      setReduceQtyError("");
                    }}
                    autoFocus
                    aria-invalid={
                      reduceQty && reducePiezas > selectedProduct.stock
                        ? true
                        : undefined
                    }
                  />
                  {reduceQtyError && (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      {reduceQtyError}
                    </p>
                  )}
                  {reduceQty && reducePiezas > selectedProduct.stock ? (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      Supera el stock disponible ({stockDisplay(selectedProduct)}).
                    </p>
                  ) : isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 &&
                    parseFloat(reduceQty) > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {reduceUnitMode === "pz" ? (
                        <>
                          {parseInt(reduceQty) || 0} piezas ={" "}
                          {((parseInt(reduceQty) || 0) /
                            selectedProduct.box_qty) %
                            1 ===
                          0
                            ? (parseInt(reduceQty) || 0) /
                              selectedProduct.box_qty
                            : (
                                (parseInt(reduceQty) || 0) /
                                selectedProduct.box_qty
                              ).toFixed(2)}{" "}
                          cajas
                        </>
                      ) : (
                        <>= {reducePiezas} piezas</>
                      )}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Resultado
                  </p>
                  <div className="mt-2 flex items-stretch gap-2">
                    <div className="flex-1 rounded-md bg-muted/50 p-2 text-center">
                      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        Actual
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold">
                        {selectedProduct.sale_unit === "weight"
                          ? `${fmtKg(selectedProduct.stock)} kg`
                          : `${selectedProduct.stock} pz`}
                      </p>
                    </div>
                    <div className="flex items-center text-amber-600">
                      <Minus className="h-4 w-4" />
                    </div>
                    <div className="flex-1 rounded-md bg-amber-500/10 p-2 text-center">
                      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        − Salida
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold text-amber-700 dark:text-amber-400">
                        {selectedProduct.sale_unit === "weight"
                          ? `${fmtKg(parseFloat(reduceQty) || 0)} kg`
                          : `${
                              isContainerUnit(selectedProduct.sale_unit) &&
                              selectedProduct.box_qty > 0
                                ? (parseInt(reduceQty) || 0) *
                                  selectedProduct.box_qty
                                : parseInt(reduceQty) || 0
                            } pz`}
                      </p>
                    </div>
                    <div className="flex items-center text-amber-600">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <div
                      className={cn(
                        "flex-1 rounded-lg p-2 text-center",
                        selectedProduct.stock - reducePiezas <= 0
                          ? "bg-red-600"
                          : selectedProduct.min_stock &&
                              selectedProduct.stock - reducePiezas <=
                                selectedProduct.min_stock
                            ? "bg-amber-600"
                            : "bg-foreground",
                      )}
                    >
                      <p
                        className={cn(
                          "text-[0.62rem] font-semibold uppercase tracking-wide",
                          selectedProduct.stock - reducePiezas <= 0
                            ? "text-red-100"
                            : "text-primary-foreground/80",
                        )}
                      >
                        Resultante
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 truncate text-sm font-extrabold",
                          selectedProduct.stock - reducePiezas <= 0
                            ? "text-white"
                            : "text-primary-foreground",
                        )}
                      >
                        {selectedProduct.sale_unit === "weight"
                          ? `${fmtKg(Math.max(0, selectedProduct.stock - reducePiezas))} kg`
                          : `${Math.max(0, selectedProduct.stock - reducePiezas)} pz`}
                      </p>
                    </div>
                  </div>
                  {isContainerUnit(selectedProduct.sale_unit) &&
                    selectedProduct.box_qty > 0 && (
                      <div className="mt-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                        Actual:{" "}
                        <strong className="text-foreground">
                          {Math.floor(
                            selectedProduct.stock / selectedProduct.box_qty,
                          )}{" "}
                          {unitLabels(selectedProduct.sale_unit).plural}
                        </strong>{" "}
                        → Resultante:{" "}
                        <strong className="text-amber-600 dark:text-amber-400">
                          {Math.floor(
                            Math.max(0, selectedProduct.stock - reducePiezas) /
                              selectedProduct.box_qty,
                          )}{" "}
                          {unitLabels(selectedProduct.sale_unit).plural}
                        </strong>
                      </div>
                    )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reduce-note">Motivo (opcional)</Label>
                  <Input
                    id="reduce-note"
                    value={reduceNote}
                    onChange={(e) => setReduceNote(e.target.value)}
                    placeholder="Ej: merma, inventario, devolución..."
                  />
                </div>
              </div>
            )}

            <DialogFooter className="mt-5 gap-2 border-t border-border pt-4">
              <CancelButton onClick={() => setReduceModalOpen(false)}>
                Cancelar
              </CancelButton>
              <SButton
                variant="outline"
                onClick={confirmRemoveStock}
                disabled={
                  !reduceQty ||
                  reduceQty <= 0 ||
                  reducePiezas > (selectedProduct?.stock || 0) ||
                  cashier?.role !== "admin" ||
                  removingStock
                }
                className="border-amber-500 bg-amber-500/10 text-amber-600 hover:bg-amber-500/35 hover:border-amber-500 hover:text-amber-900 dark:text-amber-400 dark:hover:bg-amber-500/25 dark:hover:text-amber-100"
              >
                {removingStock && (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                )}
                {removingStock ? "Reduciendo..." : (
                  <>
                    <Minus className="mr-1.5 h-4 w-4" />
                    Reducir Stock
                  </>
                )}
              </SButton>
            </DialogFooter>
            {cashier?.role !== "admin" && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Solo el propietario puede hacer salidas de stock.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Inventory;
