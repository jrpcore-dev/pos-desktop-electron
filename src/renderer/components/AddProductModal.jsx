import React, { useState, useEffect, useMemo, useRef } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ScanBarcode,
  Boxes,
  DollarSign,
  Truck,
  Plus,
  CheckCircle2,
  Shapes,
  Percent,
  Hash,
  ChevronUp,
  ChevronDown,
  TrendingUp,
  Tag,
  Package,
  Trash2,
  Warehouse,
  BadgePercent,
  CalendarRange,
  TriangleAlert,
  ClipboardList,
  ImagePlus,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";
import { DateRangePicker } from "./ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { InputGroup, InputGroupInput, InputGroupAddon } from "./ui/input-group";
import { Alert } from "./ui/alert";
import {
  Tooltip as STooltip,
  TooltipContent as STooltipContent,
  TooltipProvider as STooltipProvider,
  TooltipTrigger as STooltipTrigger,
} from "./ui/tooltip";
import { cn } from "@/lib/utils";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";
import { fileToProductImage } from "../utils/productImage";
import { fmtMoney } from "../utils/format";
import { useCashier } from "../contexts/CashierContext";

const productSchema = z.object({
  barcode: z.string().optional(),
  name: z.string().min(1, "El nombre del producto es requerido"),
  brand: z.string().optional(),
  price: z
    .string()
    .min(1, "El precio es requerido")
    .refine((v) => parseFloat(v) > 0, "El precio debe ser mayor a 0"),
  stock: z.string().optional(),
  // Contenedores: stock = cajas/paquetes completos; estos, lo suelto.
  stock_pack: z.string().optional(),
  stock_loose: z.string().optional(),
  supplier_id: z.string().optional(),
  category_id: z.string().optional(),
  cost_price: z.string().optional(),
  min_stock: z.string().optional(),
  discount_percent: z.string().optional(),
  has_discount: z.boolean().optional(),
  allow_manual_discount: z.boolean().optional(),
  promo_fixed_price: z.string().optional(),
  promo_start_date: z.string().optional(),
  promo_end_date: z.string().optional(),
  sale_unit: z.string().optional(),
  box_qty: z.string().optional(),
  box_price: z.string().optional(),
  pack_qty: z.string().optional(),
  pack_price: z.string().optional(),
  packs_per_box: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.sale_unit !== "weight") {
    for (const key of ["stock", "stock_pack", "stock_loose"]) {
      if (
        data[key] !== "" &&
        data[key] != null &&
        !/^\d+$/.test(String(data[key]).trim())
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Solo números enteros",
        });
      }
    }
    if (
      data.min_stock !== "" &&
      data.min_stock != null &&
      !/^\d+$/.test(String(data.min_stock).trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min_stock"],
        message: "Solo números enteros",
      });
    }
  }
  if (data.sale_unit === "boxpack") {
    if (!(parseInt(data.packs_per_box, 10) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packs_per_box"],
        message: "Indica cuántos paquetes trae la caja",
      });
    }
    if (!(parseInt(data.pack_qty, 10) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pack_qty"],
        message: "Indica cuántas piezas trae cada paquete",
      });
    }
    if (!(parseFloat(data.pack_price) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pack_price"],
        message: "Indica el precio por pieza",
      });
    }
  }
});

const UNIT_OPTIONS = [
  { value: "piece", label: "Pieza" },
  { value: "weight", label: "Kilo" },
  { value: "box", label: "Caja y pieza" },
  { value: "package", label: "Paquete y pieza" },
  { value: "boxpack", label: "Caja, paquete y pieza" },
];

// Promos por cantidad (product_prices). `kg` = disponible en productos por kilo.
const TIER_TYPES = [
  {
    value: "mayoreo",
    label: "MAYOREO",
    cls: "bg-blue-500/15 text-blue-600",
    kg: true,
    help: "Precio especial por unidad desde esa cantidad.",
  },
  {
    value: "combo",
    label: "COMBO",
    cls: "bg-amber-500/15 text-amber-600",
    kg: true,
    help: "Precio fijo por esa cantidad; el sobrante se cobra a precio normal.",
  },
  {
    value: "llevapaga",
    label: "LLEVA Y PAGA",
    cls: "bg-chart-1/15 text-chart-1",
    help: "2×1, 3×2… sobre el precio actual: si cambias el precio, la promo se ajusta sola.",
  },
  {
    value: "piezan",
    label: "PIEZA N AL %",
    cls: "bg-primary/10 text-primary",
    help: "Cada N-ésima unidad con ese % de descuento (ej. la 2ª al 50%).",
  },
];

// A qué renglón puede aplicar una promo según cómo se vende el producto.
// Vacío = sólo hay una opción (pieza o kilo) y no se pregunta.
const tierUnitOptions = (saleUnit) => {
  if (saleUnit === "box") return [{ value: "piece", label: "Pieza" }, { value: "box", label: "Caja" }];
  if (saleUnit === "package") return [{ value: "piece", label: "Pieza" }, { value: "box", label: "Paquete" }];
  if (saleUnit === "boxpack")
    return [
      { value: "piece", label: "Pieza" },
      { value: "pack", label: "Paquete" },
      { value: "box", label: "Caja" },
    ];
  return [];
};

const tierUnitOf = (tier, saleUnit) => {
  if (saleUnit === "weight") return "weight";
  const opts = tierUnitOptions(saleUnit);
  return opts.some((o) => o.value === tier.unit) ? tier.unit : "piece";
};

const tierUnitNoun = (unit, saleUnit, n = 2) => {
  const one = n === 1;
  if (unit === "weight") return "kg";
  if (unit === "pack") return one ? "paquete" : "paquetes";
  if (unit === "box") {
    if (saleUnit === "package") return one ? "paquete" : "paquetes";
    return one ? "caja" : "cajas";
  }
  return one ? "pieza" : "piezas";
};

const toInt = (v) => parseInt(v, 10) || 0;
const toNum = (v) => parseFloat(v) || 0;

// Piezas totales del formulario: completos × contenido + lo suelto.
const formStockPieces = (m, saleUnit) => {
  if (saleUnit === "weight") return toNum(m.stock);
  if (!isContainerUnit(saleUnit)) return toInt(m.stock);
  const boxQty = effectiveBoxQty(m, saleUnit);
  const packs = saleUnit === "boxpack" ? toInt(m.stock_pack) * toInt(m.pack_qty) : 0;
  return toInt(m.stock) * boxQty + packs + toInt(m.stock_loose);
};

// Stock guardado (piezas) → campos del formulario sin perder lo suelto.
const splitStock = (product) => {
  const stock = Math.max(0, Number(product.stock) || 0);
  if (!isContainerUnit(product.sale_unit) || !(product.box_qty > 0)) {
    return { stock: String(stock), stock_pack: "", stock_loose: "" };
  }
  const boxes = Math.floor(stock / product.box_qty);
  let rest = stock - boxes * product.box_qty;
  let packs = 0;
  if (product.sale_unit === "boxpack" && product.pack_qty > 0) {
    packs = Math.floor(rest / product.pack_qty);
    rest -= packs * product.pack_qty;
  }
  return {
    stock: String(boxes),
    stock_pack: packs ? String(packs) : "",
    stock_loose: rest ? String(rest) : "",
  };
};

// 603 piezas → "5 cajas · 3 piezas" (con paquetes en boxpack).
const describePieces = (pieces, saleUnit, boxQty, packQty) => {
  if (!isContainerUnit(saleUnit) || !(boxQty > 0)) return `${pieces} piezas`;
  const labels = unitLabels(saleUnit);
  const units = [[boxQty, labels.singular, labels.plural]];
  if (saleUnit === "boxpack" && packQty > 0) units.push([packQty, "paquete", "paquetes"]);
  units.push([1, "pieza", "piezas"]);
  let rest = Math.round(pieces);
  const parts = [];
  for (const [size, one, many] of units) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.join(" · ") || "0 piezas";
};

const effectiveBoxQty = (m, saleUnit) => {
  if (saleUnit === "boxpack") {
    const packsPerBox = parseInt(m.packs_per_box, 10) || 0;
    const packQty = parseInt(m.pack_qty, 10) || 0;
    return packsPerBox * packQty;
  }
  return parseInt(m.box_qty, 10) || 0;
};

const calcMargin = (m, saleUnit) => {
  const cost = parseFloat(m.cost_price) || 0;
  if (cost <= 0) return null;
  if (isContainerUnit(saleUnit)) {
    const boxPrice = parseFloat(m.box_price) || 0;
    if (boxPrice > 0) return ((boxPrice - cost) / cost) * 100;
    const boxQty = effectiveBoxQty(m, saleUnit);
    const costPerPiece = boxQty > 0 ? cost / boxQty : 0;
    const price = parseFloat(m.price) || 0;
    if (costPerPiece > 0 && price > 0)
      return ((price - costPerPiece) / costPerPiece) * 100;
    return null;
  }
  const price = parseFloat(m.price) || 0;
  if (price > 0) return ((price - cost) / cost) * 100;
  return null;
};

const calcPackMargin = (m, saleUnit) => {
  const cost = parseFloat(m.cost_price) || 0;
  const packQty = parseInt(m.pack_qty, 10) || 0;
  const packPrice =
    saleUnit === "boxpack"
      ? parseFloat(m.price) || 0
      : parseFloat(m.pack_price) || 0;
  if (cost <= 0 || packQty <= 0 || packPrice <= 0) return null;
  let pieceCost;
  if (isContainerUnit(saleUnit)) {
    const boxQty = effectiveBoxQty(m, saleUnit);
    if (boxQty <= 0) return null;
    pieceCost = cost / boxQty;
  } else {
    pieceCost = cost;
  }
  const packCost = pieceCost * packQty;
  return ((packPrice - packCost) / packCost) * 100;
};

const FieldError = ({ message }) =>
  message ? (
    <p className="text-[0.8rem] font-medium text-destructive">{message}</p>
  ) : null;

const SectionTitle = ({ icon: Icon, title, className }) => (
  <div className={cn("flex items-center gap-2", className)}>
    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-primary">
      <Icon className="h-4 w-4" />
    </span>
    <span className="text-sm font-semibold uppercase tracking-wide text-foreground">
      {title}
    </span>
  </div>
);

const Stepper = ({ value, step = 1, onChange }) => {
  const bump = (dir) => {
    const next = Math.max(
      0,
      Math.round(((parseFloat(value) || 0) + dir * step) * 100) / 100,
    );
    onChange(String(next));
  };
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        tabIndex={-1}
        onClick={() => bump(1)}
        className="flex h-5 w-6 items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => bump(-1)}
        className="flex h-5 w-6 items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
};

const NumberField = ({
  label,
  icon: Icon = DollarSign,
  stepper,
  helper,
  error,
  placeholder,
  className,
  ...props
}) => (
  <div className={cn("space-y-1.5", className)}>
    {label && (
      <Label className="font-medium text-muted-foreground">{label}</Label>
    )}
    <div className="w-full">
      <InputGroup>
        <InputGroupAddon>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          type="number"
          placeholder={placeholder}
          {...props}
        />
        {stepper && (
          <InputGroupAddon align="inline-end" className="pr-0.5">
            <Stepper value={props.value} step={stepper} onChange={props.onChange} />
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
    {helper && (
      <p className="text-[0.8rem] text-muted-foreground">{helper}</p>
    )}
    <FieldError message={error} />
  </div>
);

const InventoryFields = ({
  control,
  saleUnit,
  wBoxQty,
  wPacksPerBox,
  wPackQty,
  stockLabel,
  stockStep,
  errors,
}) => {
  const [stockStr, packStr, looseStr, minStockStr] = useWatch({
    control,
    name: ["stock", "stock_pack", "stock_loose", "min_stock"],
  });
  const isContainer = isContainerUnit(saleUnit);
  const m = {
    stock: stockStr,
    stock_pack: packStr,
    stock_loose: looseStr,
    box_qty: wBoxQty,
    packs_per_box: wPacksPerBox,
    pack_qty: wPackQty,
  };
  const boxQty = effectiveBoxQty(m, saleUnit);
  const packQty = toInt(wPackQty);
  const pieces = formStockPieces(m, saleUnit);
  const autoMin = Math.max(1, Math.floor(pieces * 0.4));
  const minHelper =
    pieces > 0 && !(toInt(minStockStr) > 0)
      ? `Si lo dejas vacío: ${autoMin}${saleUnit === "weight" ? " kg" : " piezas"}`
      : "Te avisamos cuando quede esto o menos";

  const stockField = (name, label, step = 1) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <NumberField
          icon={Hash}
          label={label}
          value={field.value}
          onChange={field.onChange}
          stepper={step}
          min={0}
          step={step}
          placeholder="0"
          error={errors?.[name]?.message}
        />
      )}
    />
  );

  const minStockField = (
    <Controller
      name="min_stock"
      control={control}
      render={({ field }) => (
        <NumberField
          icon={Hash}
          label={
            saleUnit === "weight"
              ? "Stock mínimo (kg)"
              : isContainer
                ? "Stock mínimo (en piezas)"
                : "Stock mínimo"
          }
          value={field.value}
          onChange={field.onChange}
          min={0}
          placeholder="0"
          error={errors?.min_stock?.message}
          helper={minHelper}
        />
      )}
    />
  );

  return (
    <div className="space-y-4">
      {/* Stock y mínimo en una sola fila (2×2 en caja, paquete y pieza). */}
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          saleUnit === "box" || saleUnit === "package"
            ? "sm:grid-cols-3"
            : "sm:grid-cols-2",
        )}
      >
        {isContainer ? (
          <>
            {stockField(
              "stock",
              saleUnit === "package" ? "Paquetes completos" : "Cajas completas",
            )}
            {saleUnit === "boxpack" &&
              stockField("stock_pack", "Paquetes sueltos")}
            {stockField("stock_loose", "Piezas sueltas")}
          </>
        ) : (
          stockField("stock", stockLabel, stockStep)
        )}
        {minStockField}
      </div>

      {isContainer && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <span className="text-sm text-muted-foreground">Total en inventario</span>
          <span className="text-right">
            <span className="text-base font-bold tabular-nums text-foreground">
              {pieces} piezas
            </span>
            {boxQty > 0 && pieces > 0 && (
              <span className="block text-[0.8rem] text-muted-foreground">
                = {describePieces(pieces, saleUnit, boxQty, packQty)}
              </span>
            )}
            {!(boxQty > 0) && (
              <span className="block text-[0.8rem] text-amber-600">
                Indica primero cuántas piezas trae{" "}
                {saleUnit === "package" ? "el paquete" : "la caja"}.
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

// Foto del producto: recuadro con clic o arrastrar; con foto, "Cambiar" y
// "Quitar" al pasar el ratón. La imagen se reduce antes de guardarse.
export const ProductImagePicker = ({ value, onChange, disabled, onError }) => {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await fileToProductImage(file));
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 sm:items-stretch">
      <span className="text-sm font-medium text-muted-foreground">
        Foto <span className="font-normal">(opcional)</span>
      </span>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={value ? "Cambiar foto del producto" : "Agregar foto del producto"}
        onClick={() => !disabled && !value && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "group relative size-40 overflow-hidden rounded-xl border bg-muted/30 sm:h-auto sm:min-h-40 sm:flex-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          value ? "border-border" : "cursor-pointer border-dashed border-border hover:border-primary/50 hover:bg-primary/5",
          dragOver && "border-primary bg-primary/10",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        {value ? (
          <>
            <img src={value} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md bg-white/95 px-2.5 text-xs font-semibold text-foreground hover:bg-white"
              >
                <RefreshCw className="size-3.5" /> Cambiar
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md bg-white/95 px-2.5 text-xs font-semibold text-destructive hover:bg-white"
              >
                <X className="size-3.5" /> Quitar
              </button>
            </div>
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 px-3 text-center text-muted-foreground">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ImagePlus className="size-5" />
            </span>
            <span className="text-xs font-semibold text-foreground">
              {busy ? "Procesando…" : "Agregar foto"}
            </span>
            <span className="text-[11px] leading-tight">Clic o arrastra una imagen</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
};

const AddProductModal = ({
  open,
  onClose,
  onProductAdded,
  editProduct = null,
  initialBarcode = "",
  catalogProduct = null,
  // "discount" | "promo": abre "Descuento / Promoción" encendido y desplazado
  // a esa columna (desde el aviso de stock sin movimiento).
  focusSection = null,
}) => {
  const isCatalogMode = !!catalogProduct && !editProduct;
  const { cashier } = useCashier() || {};
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState({ type: null, name: "" });
  const [priceTiers, setPriceTiers] = useState([]);
  const [promoOpen, setPromoOpen] = useState(false);
  // Foto: sólo se envía si el usuario la cambió (si no, el backend conserva
  // la que había).
  const [productImage, setProductImage] = useState("");
  const [imageTouched, setImageTouched] = useState(false);
  // La foto del catálogo se precarga sola; una elegida por el usuario nunca
  // se reemplaza por la del catálogo.
  const catalogImageRef = useRef(false);
  const userImageRef = useRef(false);
  const discountColRef = useRef(null);
  const promoColRef = useRef(null);
  const [focusFlash, setFocusFlash] = useState(null);
  const [promoMode, setPromoMode] = useState("percent"); // "percent" | "fixed"

  useEffect(() => {
    if (!open) return;
    const catImage = !editProduct
      ? catalogProduct?.image_path || catalogProduct?.cat_image || ""
      : "";
    setProductImage(editProduct?.image_path || catImage);
    setImageTouched(!!catImage);
    catalogImageRef.current = !!catImage;
    userImageRef.current = false;
  }, [open, editProduct, catalogProduct]);

  const addPriceTier = () =>
    setPriceTiers((prev) => [
      ...prev,
      { type: "combo", qty: "", price: "", unit: "" },
    ]);
  const updatePriceTier = (index, field, value) =>
    setPriceTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    );
  const removePriceTier = (index) =>
    setPriceTiers((prev) => prev.filter((_, i) => i !== index));

  const {
    control,
    handleSubmit,
    formState: { errors, dirtyFields },
    reset,
    watch,
    trigger,
    setValue,
  } = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: {
      barcode: "",
      name: "",
      brand: "",
      price: "",
      stock: "",
      stock_pack: "",
      stock_loose: "",
      supplier_id: "",
      category_id: "",
      cost_price: "",
      min_stock: "",
      discount_percent: "",
      sale_unit: "piece",
      box_qty: "",
      box_price: "",
      pack_qty: "",
      pack_price: "",
      packs_per_box: "",
    },
  });

  const wSaleUnit = watch("sale_unit") || "piece";
  const wHasDiscount = watch("has_discount");
  const wAllowManual = watch("allow_manual_discount");
  // Enfoque desde un aviso: enciende la sección, la despliega, la trae a la
  // vista y resalta la columna un momento. No guarda nada por sí solo.
  useEffect(() => {
    if (!open || !focusSection || !editProduct) return undefined;
    const t1 = setTimeout(() => {
      setValue("has_discount", true);
      setPromoOpen(true);
    }, 150);
    const t2 = setTimeout(() => {
      const el = (focusSection === "promo" ? promoColRef : discountColRef).current;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFocusFlash(focusSection);
    }, 350);
    const t3 = setTimeout(() => setFocusFlash(null), 2600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [open, focusSection, editProduct, setValue]);

  const wPromoFixed = watch("promo_fixed_price");
  const [wPrice, wCostPrice, wBoxPrice, wPackPrice, wDiscount, wPacksPerBox, wPackQty, wBoxQty] =
    useWatch({
      control,
      name: [
        "price",
        "cost_price",
        "box_price",
        "pack_price",
        "discount_percent",
        "packs_per_box",
        "pack_qty",
        "box_qty",
      ],
    });
  const watchMargins = {
    price: wPrice,
    cost_price: wCostPrice,
    box_price: wBoxPrice,
    pack_price: wPackPrice,
    discount_percent: wDiscount,
    packs_per_box: wPacksPerBox,
    pack_qty: wPackQty,
    box_qty: wBoxQty,
  };
  const wBarcode = watch("barcode");

  useEffect(() => {
    const code = (wBarcode || "").trim();
    if (!code) {
      setBarcodeStatus({ type: null, name: "" });
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await window.api.invoke("check-barcode-exists", code);
        const displayName = res.cat_name || res.name;
        if (!res.exists) {
          setBarcodeStatus({ type: null, name: "" });
          if (!editProduct && !isCatalogMode) {
            setValue("name", "");
            setValue("brand", "");
            if (catalogImageRef.current) {
              setProductImage("");
              setImageTouched(false);
              catalogImageRef.current = false;
            }
          }
        } else if (editProduct && res.id === editProduct.id) {
          setBarcodeStatus({ type: null, name: "" });
        } else if (res.active) {
          setBarcodeStatus({ type: "active", name: displayName });
        } else {
          setBarcodeStatus({ type: "inactive", name: displayName });
          if (!editProduct && !isCatalogMode) {
            setValue("name", displayName || "");
            setValue("brand", res.brand || "");
            if (res.sale_unit) setValue("sale_unit", res.sale_unit);
            setValue("box_qty", String(res.box_qty || ""));
            if (res.category_id)
              setValue("category_id", String(res.category_id));
            if (res.cat_image && !userImageRef.current) {
              setProductImage(res.cat_image);
              setImageTouched(true);
              catalogImageRef.current = true;
            }
            requestAnimationFrame(() => {
              const priceInput = document.getElementById("add-product-price");
              if (priceInput) {
                priceInput.focus();
                priceInput.select();
              }
            });
          }
        }
      } catch {
        setBarcodeStatus({ type: null, name: "" });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [wBarcode, editProduct, isCatalogMode, setValue]);

  const margin = useMemo(
    () => calcMargin(watchMargins, wSaleUnit),
    [wCostPrice, wBoxPrice, wPrice, wBoxQty, wPacksPerBox, wPackQty, wSaleUnit],
  );
  const packMargin = useMemo(
    () => calcPackMargin(watchMargins, wSaleUnit),
    [wCostPrice, wPackPrice, wPrice, wBoxQty, wPacksPerBox, wPackQty, wSaleUnit],
  );
  const boxQtyDisplay = useMemo(
    () => effectiveBoxQty(watchMargins, wSaleUnit),
    [wBoxQty, wPacksPerBox, wPackQty, wSaleUnit],
  );

  // "$240 la caja" → "= $20.00 por pieza", para comparar de un vistazo.
  const perPieceHelper = (total, qty) => {
    const t = toNum(total);
    return t > 0 && qty > 0 ? `= ${fmtMoney(t / qty)} por pieza` : undefined;
  };

  // Precios incoherentes: comprar el contenedor no debe salir más caro que
  // comprar su contenido suelto, ni venderse por debajo del costo.
  const priceWarnings = useMemo(() => {
    const out = [];
    const su = wSaleUnit;
    const boxP = toNum(wBoxPrice);
    if (su === "box" || su === "package") {
      const pieceP = toNum(wPrice);
      const q = boxQtyDisplay;
      if (boxP > 0 && pieceP > 0 && q > 0 && boxP > pieceP * q) {
        const noun = su === "package" ? "El paquete" : "La caja";
        out.push(
          `${noun} (${fmtMoney(boxP)}) sale más cara que ${q} piezas sueltas (${fmtMoney(pieceP * q)}).`,
        );
      }
    }
    if (su === "boxpack") {
      const packP = toNum(wPrice);
      const pieceP = toNum(wPackPrice);
      const packs = toInt(wPacksPerBox);
      const pq = toInt(wPackQty);
      if (boxP > 0 && packP > 0 && packs > 0 && boxP > packP * packs) {
        out.push(
          `La caja (${fmtMoney(boxP)}) sale más cara que ${packs} paquetes sueltos (${fmtMoney(packP * packs)}).`,
        );
      }
      if (packP > 0 && pieceP > 0 && pq > 0 && packP > pieceP * pq) {
        out.push(
          `El paquete (${fmtMoney(packP)}) sale más caro que ${pq} piezas sueltas (${fmtMoney(pieceP * pq)}).`,
        );
      }
    }
    if (margin !== null && margin < 0) {
      out.push("El precio de venta está por debajo del costo.");
    }
    return out;
  }, [wSaleUnit, wBoxPrice, wPrice, wPackPrice, wPacksPerBox, wPackQty, boxQtyDisplay, margin]);

  const basePrice = useMemo(
    () => parseFloat(wPrice || "0") || 0,
    [wPrice],
  );
  const promoPercent = useMemo(
    () => parseFloat(watchMargins.discount_percent || "0") || 0,
    [watchMargins.discount_percent],
  );
  const hasTiers = priceTiers.length > 0;
  const wPromoStart = watch("promo_start_date");
  const wPromoEnd = watch("promo_end_date");
  const datesNowIso = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const promoNowActive =
    (!wPromoStart || datesNowIso >= wPromoStart) &&
    (!wPromoEnd || datesNowIso <= wPromoEnd);
  const dateIssue =
    wPromoStart && wPromoEnd && wPromoStart > wPromoEnd
      ? "La fecha de inicio no puede ser posterior a la de fin."
      : null;
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return d && m && y ? `${d}/${m}/${y}` : iso;
  };
  const promoFixed = parseFloat(wPromoFixed || "0") || 0;
  const isFixedMode = promoMode === "fixed";
  const autoConfigured = isFixedMode ? promoFixed > 0 : promoPercent > 0 || promoFixed > 0;
  const tiersConfigured = hasTiers;
  const autoActive = promoNowActive && autoConfigured;
  const tiersActive = promoNowActive && tiersConfigured;
  const manualBlocked = autoActive || tiersActive;
  const autoBlocked = tiersConfigured;
  const tiersBlocked = autoConfigured;
  const promoChips = [];
  if (promoPercent > 0 && !isFixedMode) promoChips.push(`-${promoPercent}%`);
  if (promoFixed > 0 && isFixedMode) promoChips.push(`Fijo ${fmtMoney(promoFixed)}`);
  priceTiers.forEach((t) => {
    const q = toNum(t.qty);
    const p = toNum(t.price);
    if (q <= 0 || p <= 0) return;
    const unit = tierUnitOf(t, wSaleUnit);
    const suffix = tierUnitOptions(wSaleUnit).length
      ? ` (${tierUnitNoun(unit, wSaleUnit, 1)})`
      : "";
    if (t.type === "combo") promoChips.push(`${q} por ${fmtMoney(p)}${suffix}`);
    else if (t.type === "llevapaga") promoChips.push(`${q}×${p}${suffix}`);
    else if (t.type === "piezan") promoChips.push(`${q}ª al -${p}%${suffix}`);
    else promoChips.push(`Mayoreo ${q}+${suffix}`);
  });
  if (wAllowManual && !manualBlocked) promoChips.push("Manual en caja");
  const tierIssues = [];
  const seenTiers = new Set();
  priceTiers.forEach((t) => {
    const q = toNum(t.qty);
    const p = toNum(t.price);
    if (q <= 0) return;
    const unit = tierUnitOf(t, wSaleUnit);
    const key = `${t.type}:${unit}:${q}`;
    if (seenTiers.has(key)) {
      tierIssues.push(
        t.type === "mayoreo"
          ? `El mayoreo desde ${q} se repite. Cambia el rango o elimina uno.`
          : `La promo de ${q} se repite. Cambia la cantidad o elimina una.`,
      );
    }
    seenTiers.add(key);
    if (t.type === "llevapaga" && p > 0 && !(Number.isInteger(p) && p < q)) {
      tierIssues.push(`En "lleva ${q} y paga ${p}" lo que paga debe ser menos de lo que lleva.`);
    }
    if (t.type === "piezan" && p > 0 && (q < 2 || p > 100)) {
      tierIssues.push("En \"pieza N al %\" la pieza va desde la 2ª y el descuento hasta 100%.");
    }
  });
  const effective =
    promoFixed > 0 ? promoFixed : basePrice * (1 - promoPercent / 100);
  const autoHelper =
    promoMode === "fixed"
      ? promoFixed > 0
        ? "Precio fijo de promoció: aplica a cualquier cantidad."
        : "Ingresa el precio fijo de promoción."
      : promoPercent > 0
        ? "Este % se aplicará automáticamente en cada venta."
        : hasTiers
          ? "Con 0% no hay descuento automático; solo cuentan las promos por cantidad."
          : wAllowManual
            ? "Con 0% el descuento manual en caja controla esta promoción."
            : "Con 0% no se aplica ningún descuento.";
  // Precio normal de la unidad a la que aplica la promo (pieza, caja…).
  const tierBasePrice = (unit) =>
    unit === "box"
      ? toNum(wBoxPrice)
      : unit === "piece" && wSaleUnit === "boxpack"
        ? toNum(wPackPrice)
        : toNum(wPrice);
  const tierPreview = (t) => {
    const q = toNum(t.qty);
    const p = toNum(t.price);
    if (q <= 0 || p <= 0) return null;
    const unit = tierUnitOf(t, wSaleUnit);
    const base = tierBasePrice(unit);
    const one = tierUnitNoun(unit, wSaleUnit, 1);
    if (t.type === "combo") {
      const per = p / q;
      return base > 0
        ? `≈ ${fmtMoney(per)}/${one} (ahorra ${fmtMoney(base * q - p)})`
        : `≈ ${fmtMoney(per)}/${one}`;
    }
    if (t.type === "llevapaga") {
      if (!(p < q) || !(base > 0)) return null;
      return `Lleva ${q} por ${fmtMoney(base * p)} (ahorra ${fmtMoney(base * (q - p))})`;
    }
    if (t.type === "piezan") {
      if (!(base > 0) || p > 100) return null;
      return `La ${q}ª sale a ${fmtMoney(base * (1 - p / 100))} (ahorra ${fmtMoney((base * p) / 100)})`;
    }
    return base > 0 ? `Ahorra ${fmtMoney(base - p)} por ${one}` : null;
  };

  const statusPill = (() => {
    if (!wHasDiscount) return null;
    const hasConfig =
      promoPercent > 0 || promoFixed > 0 || priceTiers.length > 0;
    if (!hasConfig) return null;
    if (promoNowActive)
      return {
        label: "Activa",
        cls: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
      };
    if (wPromoStart && datesNowIso < wPromoStart)
      return {
        label: "Programada",
        cls: "border-amber-500/20 bg-amber-500/10 text-amber-600",
      };
    return {
      label: "Expirada",
      cls: "border-border bg-muted text-muted-foreground",
    };
  })();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const applyFormState = () => {
      if (editProduct) {
        const boxQty = editProduct.box_qty || 0;
        reset({
          barcode: editProduct.barcode || "",
          name: editProduct.name || "",
          brand: editProduct.brand || "",
          price: editProduct.price?.toString() || "",
          ...splitStock(editProduct),
          supplier_id: editProduct.supplier_id?.toString() || "",
          category_id: editProduct.category_id?.toString() || "",
          cost_price: editProduct.cost_price?.toString() || "",
          min_stock: editProduct.min_stock?.toString() || "",
          discount_percent: editProduct.discount_percent?.toString() || "0",
          has_discount: !!editProduct.has_discount,
          allow_manual_discount: !!editProduct.allow_manual_discount,
          promo_fixed_price: editProduct.promo_fixed_price?.toString() || "0",
          promo_start_date: editProduct.promo_start_date || "",
          promo_end_date: editProduct.promo_end_date || "",
          sale_unit: editProduct.sale_unit || "piece",
          box_qty: boxQty.toString(),
          box_price: editProduct.box_price?.toString() || "",
          pack_qty: (editProduct.pack_qty || 0).toString(),
          pack_price: editProduct.pack_price?.toString() || "",
          packs_per_box:
            editProduct.sale_unit === "boxpack" && boxQty > 0
              ? Math.round(
                  boxQty / (parseInt(editProduct.pack_qty, 10) || 1),
                ).toString()
              : "0",
        });
        setPriceTiers(
          (editProduct.prices || []).map((p) => ({
            type: p.type,
            qty: String(p.qty),
            price: String(p.price),
            unit: p.unit || "piece",
          })),
        );
        setPromoOpen(!!editProduct.has_discount);
        setPromoMode(editProduct.promo_fixed_price > 0 ? "fixed" : "percent");
      } else if (catalogProduct) {
        reset({
          barcode: catalogProduct.barcode || "",
          name: catalogProduct.cat_name || catalogProduct.name || "",
          brand: catalogProduct.brand || "",
          price: "",
          stock: "",
          stock_pack: "",
          stock_loose: "",
          supplier_id: "",
          category_id: catalogProduct.category_id?.toString() || "",
          cost_price: "",
          min_stock: "",
          discount_percent: "0",
          has_discount: false,
          allow_manual_discount: false,
          promo_fixed_price: "0",
          promo_start_date: "",
          promo_end_date: "",
          sale_unit: catalogProduct.sale_unit || "piece",
          box_qty: (catalogProduct.box_qty || "").toString(),
          box_price: "",
          pack_qty: "0",
          pack_price: "",
          packs_per_box: "0",
        });
        setPriceTiers([]);
        setPromoOpen(false);
      } else {
        reset({
          barcode: initialBarcode || "",
          name: "",
          brand: "",
          price: "",
          stock: "",
          stock_pack: "",
          stock_loose: "",
          supplier_id: "",
          category_id: "",
          cost_price: "",
          min_stock: "",
          discount_percent: "",
          has_discount: false,
          allow_manual_discount: false,
          promo_fixed_price: "",
          promo_start_date: "",
          promo_end_date: "",
          sale_unit: "piece",
          box_qty: "",
          box_price: "",
          pack_qty: "",
          pack_price: "",
          packs_per_box: "",
        });
        setPriceTiers([]);
        setPromoMode("percent");
      }
      setSubmitError("");
      setIsSubmitting(false);
      setBarcodeStatus({ type: null, name: "" });
    };

    applyFormState();

    Promise.all([
      window.api.invoke("get-suppliers"),
      window.api.invoke("get-categories"),
    ]).then(([s, c]) => {
      if (cancelled) return;
      setSuppliers(s);
      setCategories(c);
      applyFormState();
    });

    return () => {
      cancelled = true;
    };
  }, [open, editProduct, catalogProduct, initialBarcode, reset]);

  const onSubmit = async (data) => {
    if (isSubmitting) return;
    let barcode = (data.barcode || "").trim();
    if (!editProduct && !isCatalogMode && !barcode) {
      try {
        barcode = await window.api.invoke("get-next-barcode");
      } catch {
        barcode = `2${Date.now()}`;
      }
    }
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const boxQty =
        data.sale_unit === "boxpack"
          ? (parseInt(data.packs_per_box, 10) || 0) *
            (parseInt(data.pack_qty, 10) || 0)
          : parseInt(data.box_qty, 10) || 0;
      const productData = {
        ...(imageTouched ? { image_path: productImage || "" } : {}),
        barcode: barcode,
        name: data.name.trim(),
        brand: data.brand.trim() || "Sin marca",
        price: parseFloat(data.price),
        stock: formStockPieces(data, data.sale_unit),
        supplier_id: data.supplier_id ? parseInt(data.supplier_id) : null,
        category_id: data.category_id ? parseInt(data.category_id) : null,
        cost_price: parseFloat(data.cost_price) || 0,
        min_stock: parseInt(data.min_stock) > 0 ? parseInt(data.min_stock) : 0,
        discount_percent: data.has_discount
          ? parseFloat(data.discount_percent) || 0
          : 0,
        has_discount: data.has_discount ? 1 : 0,
        allow_manual_discount:
          data.has_discount && data.allow_manual_discount ? 1 : 0,
        promo_fixed_price: data.has_discount
          ? parseFloat(data.promo_fixed_price) || 0
          : 0,
        promo_start_date: data.has_discount ? data.promo_start_date || "" : "",
        promo_end_date: data.has_discount ? data.promo_end_date || "" : "",
        sale_unit: data.sale_unit || "piece",
        box_qty: boxQty,
        box_price: parseFloat(data.box_price) || 0,
        pack_qty:
          data.sale_unit === "boxpack" ? parseInt(data.pack_qty) || 0 : 0,
        pack_price:
          data.sale_unit === "boxpack"
            ? parseFloat(data.pack_price) || 0
            : 0,
        prices: data.has_discount
          ? priceTiers
              .map((t) => {
                const unit = tierUnitOf(t, data.sale_unit);
                return {
                  type: TIER_TYPES.some((x) => x.value === t.type) ? t.type : "combo",
                  unit,
                  qty: unit === "weight" ? toNum(t.qty) : toInt(t.qty),
                  price: toNum(t.price),
                };
              })
              // Lleva y paga / pieza N no existen por kilo.
              .filter(
                (t) =>
                  t.qty > 0 &&
                  t.price > 0 &&
                  !(t.unit === "weight" && (t.type === "llevapaga" || t.type === "piezan")),
              )
          : [],
      };

      if (editProduct) {
        // Sin tocar stock ni unidad, no se envía: el backend conserva el actual
        // (evita pisar ventas recientes y perder piezas sueltas de cajas).
        const stockTouched =
          dirtyFields.stock ||
          dirtyFields.stock_pack ||
          dirtyFields.stock_loose ||
          dirtyFields.sale_unit ||
          dirtyFields.box_qty ||
          dirtyFields.pack_qty ||
          dirtyFields.packs_per_box;
        if (!stockTouched) delete productData.stock;
        productData.cashier_id = cashier?.id || null;
      }

      let result;
      if (isCatalogMode) {
        result = await window.api.invoke(
          "activate-catalog-product",
          catalogProduct.id,
          productData,
        );
      } else if (editProduct) {
        result = await window.api.invoke(
          "update-product",
          editProduct.id,
          productData,
        );
      } else {
        result = await window.api.invoke("add-product", productData);
      }

      if (result.success) {
        onProductAdded();
        handleClose();
      } else {
        setSubmitError(result.error || "Error desconocido");
      }
    } catch (error) {
      setSubmitError(error.message || "Error al guardar");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    reset();
    setSubmitError("");
    setIsSubmitting(false);
    onClose();
  };

  const su = wSaleUnit;
  const { unitInfo, isBox, stockStep, stockLabel, costLabel, priceLabel } = useMemo(() => {
    const info = unitLabels(su) || {};
    const isBoxUnit = isContainerUnit(su);
    const step = su === "weight" ? 0.1 : 1;
    const sLabel =
      su === "weight"
        ? "Stock en kg"
        : isBoxUnit
          ? info.stockContainer
          : "Stock";
    const cLabel =
      su === "weight" || !isBoxUnit
        ? "Precio costo"
        : info.costPer;
    const pLabel =
      su === "weight"
        ? "Precio por kilo"
        : isBoxUnit
          ? su === "boxpack"
            ? "Precio por paquete"
            : "Precio por pieza"
          : "Precio venta";
    return {
      unitInfo: info,
      isBox: isBoxUnit,
      stockStep: step,
      stockLabel: sLabel,
      costLabel: cLabel,
      priceLabel: pLabel,
    };
  }, [su]);

  const [wStock, wStockPack, wStockLoose] = useWatch({
    control,
    name: ["stock", "stock_pack", "stock_loose"],
  });
  const summaryPieces = formStockPieces(
    { ...watchMargins, stock: wStock, stock_pack: wStockPack, stock_loose: wStockLoose },
    su,
  );
  const saleSummary =
    su === "weight"
      ? "Por kilo"
      : su === "piece"
        ? "Por pieza"
        : su === "boxpack"
          ? boxQtyDisplay > 0
            ? `Caja de ${toInt(wPacksPerBox)} paquetes de ${toInt(wPackQty)} pz, paquete o pieza`
            : "Por caja, paquete o pieza"
          : boxQtyDisplay > 0
            ? `${unitInfo.containerNoun} de ${boxQtyDisplay} pz o pieza`
            : `Por ${unitInfo.singular} o pieza`;
  const stockSummary =
    su === "weight"
      ? `${toNum(wStock).toFixed(3)} kg`
      : isBox && boxQtyDisplay > 0
        ? `${summaryPieces} pz (${describePieces(summaryPieces, su, boxQtyDisplay, toInt(wPackQty))})`
        : `${summaryPieces} pz`;
  const money = (v) => (toNum(v) > 0 ? fmtMoney(toNum(v)) : "—");
  const priceSummary =
    su === "boxpack"
      ? [
          ["Precio caja", money(wBoxPrice)],
          ["Precio paquete", money(wPrice)],
          ["Precio pieza", money(wPackPrice)],
        ]
      : isBox
        ? [
            [`Precio ${unitInfo.singular}`, money(wBoxPrice)],
            ["Precio pieza", money(wPrice)],
          ]
        : [[su === "weight" ? "Precio por kilo" : "Precio", money(wPrice)]];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.target.closest("[data-radix-select-trigger]")) {
            e.preventDefault();
            handleSubmit(onSubmit)();
          }
        }}
      >
        <DialogHeader className="flex flex-row items-start gap-3 border-b bg-card px-6 py-4 text-left">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Plus className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle>
              {isCatalogMode
                ? "Registrar desde catálogo"
                : editProduct
                  ? "Editar Producto"
                  : "Agregar Nuevo Producto"}
            </DialogTitle>
            <DialogDescription>
              {isCatalogMode
                ? "La identidad viene del catálogo; completa precio y unidad."
                : editProduct
                  ? editProduct.name || "Modifica la información del producto"
                  : "Completa la información del producto"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {submitError && (
            <Alert variant="destructive" className="mb-4">
              {submitError}
            </Alert>
          )}

          <div className="space-y-6">
            <section className="space-y-4">
              <SectionTitle icon={ScanBarcode} title="Identidad" />
              <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch">
              <ProductImagePicker
                value={productImage}
                onChange={(v) => {
                  setProductImage(v);
                  setImageTouched(true);
                  catalogImageRef.current = false;
                  userImageRef.current = true;
                }}
                onError={(msg) => setSubmitError(msg)}
              />
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="barcode"
                  control={control}
                  render={({ field }) => (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="font-medium text-muted-foreground">
                        Código de barras
                      </Label>
                      <InputGroup>
                        <InputGroupAddon>
                          <ScanBarcode className="h-4 w-4 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          {...field}
                          disabled={isCatalogMode}
                          placeholder="780123456789"
                          aria-invalid={barcodeStatus.type === "active" || !!errors.barcode}
                        />
                      </InputGroup>
                      {barcodeStatus.type === "active" && (
                        <p className="text-[0.8rem] font-medium text-destructive">
                          Ya existe un producto con este código: {barcodeStatus.name}
                        </p>
                      )}
                      {barcodeStatus.type === "inactive" && (
                        <p className="text-[0.8rem] font-medium text-amber-500">
                          Existe un producto inactivo con este código; se reactivará al
                          guardar
                        </p>
                      )}
                      {!wBarcode &&
                        !editProduct &&
                        !isCatalogMode &&
                        barcodeStatus.type !== "inactive" &&
                        !errors.barcode && (
                          <p className="text-[0.8rem] font-medium text-muted-foreground">
                            Si lo dejas vacío, se generará el código de barras
                            automáticamente al guardar.
                          </p>
                        )}
                      <FieldError message={errors.barcode?.message} />
                    </div>
                  )}
                />
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <div className="space-y-1.5">
                      <Label className="font-medium text-muted-foreground">
                        Nombre del producto
                      </Label>
                      <InputGroup>
                        <InputGroupAddon>
                          <Boxes className="h-4 w-4 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          {...field}
                          disabled={isCatalogMode}
                          placeholder="Ej: Coca Cola 600ml"
                          aria-invalid={!!errors.name}
                        />
                      </InputGroup>
                      <FieldError message={errors.name?.message} />
                    </div>
                  )}
                />
                <Controller
                  name="brand"
                  control={control}
                  render={({ field }) => (
                    <div className="space-y-1.5">
                      <Label className="font-medium text-muted-foreground">
                        Marca
                      </Label>
                      <InputGroup>
                        <InputGroupAddon>
                          <Tag className="h-4 w-4 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          {...field}
                          disabled={isCatalogMode}
                          placeholder="Ej: Coca Cola (opcional)"
                        />
                      </InputGroup>
                    </div>
                  )}
                />
              </div>
              </div>
              {/* Proveedor y Categoría: fila completa debajo de la foto. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="supplier_id"
                  control={control}
                  render={({ field }) => (
                    <div className="space-y-1.5">
                      <Label className="font-medium text-muted-foreground">
                        Proveedor
                      </Label>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <Truck className="h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Seleccionar proveedor" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
                <Controller
                  name="category_id"
                  control={control}
                  render={({ field }) => (
                    <div className="space-y-1.5">
                      <Label className="font-medium text-muted-foreground">
                        Categoría
                      </Label>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isCatalogMode}
                      >
                        <SelectTrigger>
                          <Shapes className="h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Seleccionar categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
              </div>
            </section>

            <Separator />

            <section className="space-y-4">
              <SectionTitle icon={Package} title="Unidad de venta y precios" />

              <div className="space-y-1.5">
                <Label className="font-medium text-muted-foreground">
                  Unidad de venta
                </Label>
                <div className="flex justify-center">
                  <div className="flex h-10 w-fit flex-wrap items-center gap-1 rounded-lg bg-accent p-1 text-muted-foreground">
                  {UNIT_OPTIONS.map((u) => (
                    <button
                      key={u.value}
                      type="button"
                      onClick={() =>
                        setValue("sale_unit", u.value, { shouldDirty: true })
                      }
                      className={cn(
                        "flex h-8 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors",
                        su === u.value
                          ? "bg-background text-foreground shadow"
                          : "hover:text-foreground",
                      )}
                    >
                      {u.label}
                    </button>
                  ))}
                  </div>
                </div>
                {su === "weight" && (
                  <p className="text-[0.8rem] text-muted-foreground">
                    El precio se cobrará por kilogramo. En la venta se pedirá el peso.
                  </p>
                )}
                {isBox && (
                  <p className="text-[0.8rem] text-muted-foreground">
                    {su === "boxpack"
                      ? "Vende por caja, por paquete o por pieza suelta. Configura los tres precios."
                      : `Vende por ${unitInfo.singular} o por pieza suelta. Configura ambos precios.`}
                  </p>
                )}
              </div>

              {/* Paso 1 (contenedores): qué trae, antes de los precios. */}
              {isBox && (
                <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
                  {su === "boxpack" && (
                    <>
                      <span className="text-sm font-semibold text-foreground">
                        Paquete (unidad media)
                      </span>
                      <p className="text-[0.8rem] text-muted-foreground">
                        La caja se vende completa, por paquetes o por pieza suelta.
                        Ej: caja con 12 paquetes de 10 piezas → 120 piezas por caja.
                      </p>
                    </>
                  )}
                  {su === "boxpack" ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Controller
                        name="packs_per_box"
                        control={control}
                        render={({ field }) => (
                          <NumberField
                            icon={Hash}
                            label="Paquetes por caja"
                            value={field.value}
                            onChange={field.onChange}
                            min={1}
                            placeholder="Ej: 12"
                            error={errors.packs_per_box?.message}
                          />
                        )}
                      />
                      <Controller
                        name="pack_qty"
                        control={control}
                        render={({ field }) => (
                          <NumberField
                            icon={Hash}
                            label="Piezas por paquete"
                            value={field.value}
                            onChange={field.onChange}
                            min={1}
                            placeholder="Ej: 10"
                            error={errors.pack_qty?.message}
                          />
                        )}
                      />
                      <div className="space-y-1.5">
                        <Label className="font-medium text-muted-foreground">
                          Piezas por caja
                        </Label>
                        <div className="flex h-9 items-center gap-1 rounded-lg border border-border bg-muted/40 px-3 text-sm font-semibold tabular-nums">
                          {boxQtyDisplay > 0 ? boxQtyDisplay : "—"}
                          <span className="text-[0.75rem] font-normal text-muted-foreground">
                            (se calcula sola)
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Controller
                      name="box_qty"
                      control={control}
                      render={({ field }) => (
                        <NumberField
                          icon={Hash}
                          label={`Piezas por ${unitInfo.singular}`}
                          value={field.value}
                          onChange={field.onChange}
                          min={1}
                          placeholder="Ej: 12"
                          className="sm:max-w-xs"
                        />
                      )}
                    />
                  )}
                </div>
              )}

              {/* Paso 2: precios, con su equivalencia por pieza. */}
              <div
                className={cn(
                  "grid grid-cols-1 gap-4",
                  su === "boxpack"
                    ? "sm:grid-cols-2"
                    : isBox
                      ? "sm:grid-cols-3"
                      : "sm:grid-cols-2",
                )}
              >
                {isBox && (
                  <Controller
                    name="box_price"
                    control={control}
                    render={({ field }) => (
                      <NumberField
                        label={`Precio por ${unitInfo.singular}`}
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        step={0.01}
                        placeholder="0.00"
                        helper={perPieceHelper(wBoxPrice, boxQtyDisplay)}
                      />
                    )}
                  />
                )}
                <Controller
                  name="price"
                  control={control}
                  render={({ field }) => (
                    <NumberField
                      id="add-product-price"
                      label={priceLabel}
                      value={field.value}
                      onChange={field.onChange}
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                      error={errors.price?.message}
                      helper={
                        su === "boxpack"
                          ? perPieceHelper(wPrice, toInt(wPackQty))
                          : undefined
                      }
                    />
                  )}
                />
                {su === "boxpack" && (
                  <Controller
                    name="pack_price"
                    control={control}
                    render={({ field }) => (
                      <NumberField
                        label="Precio por pieza"
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        step={0.01}
                        placeholder="0.00"
                        error={errors.pack_price?.message}
                      />
                    )}
                  />
                )}
                <Controller
                  name="cost_price"
                  control={control}
                  render={({ field }) => (
                    <NumberField
                      label={costLabel}
                      value={field.value}
                      onChange={field.onChange}
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                      helper={
                        isBox
                          ? perPieceHelper(wCostPrice, boxQtyDisplay)
                          : undefined
                      }
                    />
                  )}
                />
              </div>

              {priceWarnings.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[0.8rem] text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-0.5">
                    {priceWarnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-4">
              <SectionTitle
                icon={Warehouse}
                title={editProduct ? "Inventario" : "Inventario inicial"}
              />
              <InventoryFields
                control={control}
                saleUnit={su}
                wBoxQty={wBoxQty}
                wPacksPerBox={wPacksPerBox}
                wPackQty={wPackQty}
                stockLabel={stockLabel}
                stockStep={stockStep}
                errors={errors}
              />
            </section>

            <Separator />

            <section className="space-y-4">
              <SectionTitle icon={BadgePercent} title="Descuento / Promoción" />

              <div className="overflow-hidden rounded-xl border border-border bg-card/50 shadow-sm">
                <div className="relative flex flex-col gap-2 px-4 py-3.5">
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent" />
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="relative min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">
                          {wHasDiscount ? "Promoción" : "Descuento/Promoción"}
                        </p>
                        {statusPill && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${statusPill.cls}`}
                          >
                            {statusPill.label}
                          </span>
                        )}
                      </div>
                      {promoChips.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {promoChips.map((chip, i) => (
                            <span
                              key={i}
                              className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground"
                            >
                              {chip}
                            </span>
                          ))}
                          {(wPromoStart || wPromoEnd) && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-blue-600">
                              <CalendarRange className="h-3 w-3" />
                              {fmtDate(wPromoStart) || "siempre"} → {fmtDate(wPromoEnd) || "siempre"}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[0.8rem] text-muted-foreground">
                          Sin descuento/promoción para este producto.
                        </p>
                      )}
                    </div>
                    <div className="relative flex shrink-0 items-center gap-2">
                      {wHasDiscount && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setPromoOpen((o) => !o)}
                        >
                          {promoOpen ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Controller
                        name="has_discount"
                        control={control}
                        render={({ field }) => (
                          <Switch
                            checked={!!field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked);
                              if (!checked) {
                                setPriceTiers([]);
                                setValue("allow_manual_discount", false);
                              } else {
                                setPromoOpen(true);
                                setValue("allow_manual_discount", true);
                              }
                            }}
                          />
                        )}
                      />
                    </div>
                  </div>
                  {wHasDiscount && (
                    <div className="relative flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground">
                        <CalendarRange className="h-3.5 w-3.5" />
                        Vigencia de la promoción
                      </div>
                      <DateRangePicker
                        value={{
                          from: wPromoStart || undefined,
                          to: wPromoEnd || undefined,
                        }}
                        onApply={(r) => {
                          setValue("promo_start_date", r?.from || "");
                          setValue("promo_end_date", r?.to || "");
                        }}
                        placeholder="Sin vigencia — siempre activa"
                        showClear
                        align="start"
                        className="h-8 text-xs sm:w-[210px]"
                      />
                      {dateIssue && (
                        <p className="w-full text-[0.75rem] text-destructive">
                          {dateIssue}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {wHasDiscount && promoOpen && (
                  <div className="border-t border-border p-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div
                        ref={discountColRef}
                        className={`space-y-3 rounded-lg border p-3 transition-shadow duration-500 ${autoBlocked ? "opacity-60" : ""} ${focusFlash === "discount" ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
                            <Percent className="h-3.5 w-3.5" />
                          </span>
                          <p className="text-sm font-semibold text-foreground">
                            Descuento automático
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={promoMode === "fixed" ? "outline" : "default"}
                            disabled={autoBlocked}
                            onClick={() => {
                              setPromoMode("percent");
                              setValue("promo_fixed_price", "0");
                            }}
                          >
                            Porcentaje %
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={promoMode === "fixed" ? "default" : "outline"}
                            disabled={autoBlocked}
                            onClick={() => {
                              setPromoMode("fixed");
                              setValue("discount_percent", "0");
                              setValue(
                                "promo_fixed_price",
                                basePrice > 0 ? basePrice.toFixed(2) : "",
                              );
                            }}
                          >
                            Precio fijo
                          </Button>
                        </div>
                        {promoMode === "fixed" ? (
                          <NumberField
                            icon={DollarSign}
                            label="Precio de promoción ($)"
                            value={wPromoFixed}
                            onChange={(e) =>
                              setValue("promo_fixed_price", e.target.value)
                            }
                            min={0}
                            step={0.01}
                            placeholder="0.00"
                            helper={autoHelper}
                            disabled={autoBlocked}
                          />
                        ) : (
                          <Controller
                            name="discount_percent"
                            control={control}
                            render={({ field }) => (
                              <NumberField
                                icon={Percent}
                                label="Descuento (%)"
                                value={field.value}
                                onChange={field.onChange}
                                min={0}
                                max={100}
                                step={1}
                                placeholder="0"
                                helper={autoHelper}
                                disabled={autoBlocked}
                              />
                            )}
                          />
                        )}
                        {basePrice > 0 && promoMode === "fixed" && promoFixed > 0 && (
                          <p className="text-[0.75rem] font-medium text-emerald-600">
                            Precio de promoción: {fmtMoney(promoFixed)} —
                            ahorras {fmtMoney(basePrice - promoFixed)}.
                          </p>
                        )}
                        {basePrice > 0 && promoMode === "percent" && promoPercent > 0 && (
                          <p className="text-[0.75rem] font-medium text-emerald-600">
                            Queda en {fmtMoney(effective)} — ahorras{" "}
                            {fmtMoney(basePrice - effective)}.
                          </p>
                        )}
                        {autoBlocked && (
                          <p className="text-[0.75rem] text-destructive">
                            Desactiva las promos por cantidad para usar el descuento
                            automático.
                          </p>
                        )}
                      </div>

                      <STooltipProvider delayDuration={200}>
                      <div
                        ref={promoColRef}
                        className={`space-y-3 rounded-lg border p-3 transition-shadow duration-500 ${tiersBlocked ? "opacity-60" : ""} ${focusFlash === "promo" ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600">
                              <Boxes className="h-3.5 w-3.5" />
                            </span>
                            <p className="text-sm font-semibold text-foreground">
                              Promociones por cantidad
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            onClick={addPriceTier}
                            disabled={tiersBlocked}
                            className="shrink-0"
                          >
                            <Plus className="h-4 w-4" />
                            Agregar
                          </Button>
                        </div>
                        {tiersBlocked && (
                          <p className="text-[0.75rem] text-destructive">
                            Desactiva el descuento automático para usar promos por
                            cantidad.
                          </p>
                        )}

                        {priceTiers.length === 0 ? (
                          <div className="text-center py-6 rounded-lg border-2 border-dashed border-border/50 bg-muted/30">
                            <Boxes className="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
                            <p className="text-sm text-muted-foreground">
                              Sin promos configuradas
                            </p>
                            <p className="text-[0.75rem] text-muted-foreground/70 mt-0.5">
                              Haz clic en <strong>"Agregar"</strong> para crear un mayoreo,
                              combo, 2×1 o 2ª al %.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {priceTiers.map((tier, i) => (
                              <div
                                key={i}
                                className="rounded-xl border border-border/60 bg-card p-3"
                              >
                                {/* Header: índice + tipo + eliminar */}
                                <div className="mb-3 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.7rem] font-bold text-primary">
                                      {i + 1}
                                    </span>
                                    <div className="flex flex-wrap items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
                                      {TIER_TYPES.filter((x) => su !== "weight" || x.kg).map((x) => (
                                        <button
                                          key={x.value}
                                          type="button"
                                          disabled={tiersBlocked}
                                          onClick={() => updatePriceTier(i, "type", x.value)}
                                          className={cn(
                                            "rounded-md px-2.5 py-1 text-[0.7rem] font-semibold transition-colors disabled:opacity-50",
                                            tier.type === x.value
                                              ? x.cls
                                              : "text-muted-foreground hover:text-foreground",
                                          )}
                                        >
                                          {x.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <STooltip>
                                    <STooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
                                        onClick={() => removePriceTier(i)}
                                        disabled={tiersBlocked}
                                        aria-label="Eliminar esta promo"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </STooltipTrigger>
                                    <STooltipContent side="top" align="center">
                                      Eliminar promo
                                    </STooltipContent>
                                  </STooltip>
                                </div>

                                {/* A qué unidad aplica (sólo productos por caja/paquete) */}
                                {tierUnitOptions(su).length > 0 && (
                                  <div className="mb-2 flex items-center gap-2">
                                    <span className="text-[0.75rem] font-medium text-muted-foreground">
                                      Aplica a
                                    </span>
                                    <div className="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
                                      {tierUnitOptions(su).map((o) => (
                                        <button
                                          key={o.value}
                                          type="button"
                                          disabled={tiersBlocked}
                                          onClick={() => updatePriceTier(i, "unit", o.value)}
                                          className={cn(
                                            "rounded-md px-2.5 py-1 text-[0.7rem] font-semibold transition-colors disabled:opacity-50",
                                            tierUnitOf(tier, su) === o.value
                                              ? "bg-background text-foreground shadow"
                                              : "text-muted-foreground hover:text-foreground",
                                          )}
                                        >
                                          {o.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Campos (su significado depende del tipo) */}
                                {(() => {
                                  const noun = tierUnitNoun(tierUnitOf(tier, su), su);
                                  const isKg = su === "weight";
                                  const [qtyLabel, priceLabel, priceIcon, priceStep] =
                                    tier.type === "llevapaga"
                                      ? ["Lleva", "Paga", Hash, 1]
                                      : tier.type === "piezan"
                                        ? ["Pieza número", "Descuento (%)", Percent, 1]
                                        : tier.type === "combo"
                                          ? [`Lleva (${noun})`, "Por ($)", DollarSign, 0.01]
                                          : [`Desde (${noun})`, "Precio c/u ($)", DollarSign, 0.01];
                                  return (
                                    <div className="grid grid-cols-2 gap-2">
                                      <NumberField
                                        icon={Hash}
                                        label={qtyLabel}
                                        value={tier.qty}
                                        onChange={(e) => updatePriceTier(i, "qty", e.target.value)}
                                        min={tier.type === "piezan" ? 2 : 1}
                                        step={isKg ? 0.1 : 1}
                                        placeholder={tier.type === "piezan" ? "2" : "0"}
                                        disabled={tiersBlocked}
                                      />
                                      <NumberField
                                        icon={priceIcon}
                                        label={priceLabel}
                                        value={tier.price}
                                        onChange={(e) => updatePriceTier(i, "price", e.target.value)}
                                        min={0}
                                        step={priceStep}
                                        placeholder={priceStep === 1 ? "0" : "0.00"}
                                        disabled={tiersBlocked}
                                      />
                                    </div>
                                  );
                                })()}

                                {/* Preview */}
                                <div className="mt-2 space-y-1">
                                  <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                                    {(TIER_TYPES.find((x) => x.value === tier.type) || TIER_TYPES[1]).help}
                                  </p>
                                  {tierPreview(tier) && (
                                    <p className="flex items-center gap-1 text-[0.72rem] font-medium text-emerald-600">
                                      <CheckCircle2 className="h-3 w-3" />
                                      {tierPreview(tier)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                            {tierIssues.length > 0 && (
                              <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                                {tierIssues.map((issue, j) => (
                                  <p key={j} className="text-[0.75rem] text-destructive flex items-center gap-1.5">
                                    <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" />
                                    {issue}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      </STooltipProvider>
                    </div>
                    <div className="mt-4 space-y-2 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            Descuento manual en caja
                          </p>
                          <p className="text-[0.8rem] text-muted-foreground">
                            Permite al cajero aplicar un descuento libre (tecla F6) al vender este
                            producto.
                          </p>
                        </div>
                        <Switch
                          checked={!!wAllowManual && !manualBlocked}
                          disabled={!!manualBlocked}
                          onCheckedChange={(v) =>
                            setValue("allow_manual_discount", v)
                          }
                          className={manualBlocked ? "opacity-40" : ""}
                        />
                      </div>
                      {manualBlocked && (
                        <p className="text-[0.75rem] text-destructive">
                          Desactiva el descuento automático y las promociones por cantidad para
                          permitir descuento manual.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Resumen: lo que se va a guardar, para revisarlo de un vistazo. */}
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold text-foreground">Resumen</p>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Se vende</dt>
                <dd className="text-right font-medium text-foreground">
                  {saleSummary}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {editProduct ? "Inventario" : "Inventario inicial"}
                </dt>
                <dd className="text-right font-medium tabular-nums text-foreground">
                  {stockSummary}
                </dd>
              </div>
              {priceSummary.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium tabular-nums text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Ganancia
                </dt>
                <dd
                  className={cn(
                    "text-right font-extrabold tabular-nums",
                    margin === null
                      ? "text-muted-foreground"
                      : margin < 0
                        ? "text-destructive"
                        : "text-emerald-600",
                  )}
                >
                  {margin !== null ? `${margin.toFixed(1)}%` : "—"}
                  {packMargin !== null && (
                    <span className="ml-1 text-[0.75rem] font-semibold text-muted-foreground">
                      (paquete {packMargin.toFixed(1)}%)
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <DialogFooter className="items-center justify-between gap-2 border-t bg-card px-6 py-3">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                {editProduct ? "Actualizando..." : "Agregando..."}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {editProduct ? "Actualizar Producto" : "Agregar Producto"}
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddProductModal;


















