import React, { useState, useEffect, useMemo } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { InputGroup, InputGroupInput, InputGroupAddon } from "./ui/input-group";
import { Alert } from "./ui/alert";
import { cn } from "@/lib/utils";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";

const productSchema = z.object({
  barcode: z.string().optional(),
  name: z.string().min(1, "El nombre del producto es requerido"),
  brand: z.string().optional(),
  price: z
    .string()
    .min(1, "El precio es requerido")
    .refine((v) => parseFloat(v) > 0, "El precio debe ser mayor a 0"),
  stock: z.string().optional(),
  supplier_id: z.string().optional(),
  category_id: z.string().optional(),
  cost_price: z.string().optional(),
  min_stock: z.string().optional(),
  discount_percent: z.string().optional(),
  has_discount: z.boolean().optional(),
  sale_unit: z.string().optional(),
  box_qty: z.string().optional(),
  box_price: z.string().optional(),
  pack_qty: z.string().optional(),
  pack_price: z.string().optional(),
  packs_per_box: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.sale_unit !== "weight") {
    if (
      data.stock !== "" &&
      data.stock != null &&
      !/^\d+$/.test(String(data.stock).trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stock"],
        message: "Solo números enteros",
      });
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
        message: "Indica el precio del paquete",
      });
    }
  }
});

const UNIT_OPTIONS = [
  { value: "piece", label: "Pieza" },
  { value: "weight", label: "Kilo" },
  { value: "box", label: "Caja·Pz" },
  { value: "package", label: "Paq·Pz" },
  { value: "boxpack", label: "Caja·Paq·Pz" },
];

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

const computeStockPieces = (m, stock, saleUnit) => {
  const boxQty =
    saleUnit === "boxpack"
      ? (parseInt(m.packs_per_box, 10) || 0) *
        (parseInt(m.pack_qty, 10) || 0)
      : parseInt(m.box_qty, 10) || 0;
  return isContainerUnit(saleUnit)
    ? (parseInt(stock, 10) || 0) * boxQty
    : parseFloat(stock) || 0;
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
  const stockStr = useWatch({ control, name: "stock" }) || "";
  const minStockStr = useWatch({ control, name: "min_stock" }) || "";
  const watchMargins = {
    box_qty: wBoxQty,
    packs_per_box: wPacksPerBox,
    pack_qty: wPackQty,
  };
  const watchedStockPieces = useMemo(
    () => computeStockPieces(watchMargins, stockStr, saleUnit),
    [wBoxQty, wPacksPerBox, wPackQty, stockStr, saleUnit],
  );
  const watchedAutoMin = useMemo(
    () => Math.max(1, Math.floor(watchedStockPieces * 0.4)),
    [watchedStockPieces],
  );
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Controller
        name="stock"
        control={control}
        render={({ field }) => (
          <NumberField
            icon={Hash}
            label={stockLabel}
            value={field.value}
            onChange={field.onChange}
            stepper={stockStep}
            min={0}
            step={stockStep}
            placeholder="0"
            error={errors?.stock?.message}
          />
        )}
      />
      <Controller
        name="min_stock"
        control={control}
        render={({ field }) => (
          <NumberField
            icon={Hash}
            label="Stock mínimo"
            value={field.value}
            onChange={field.onChange}
            min={0}
            placeholder="0"
            error={errors?.min_stock?.message}
            helper={
              watchedStockPieces > 0 && !(parseInt(minStockStr, 10) > 0)
                ? `Mínimo automático: ${watchedAutoMin}`
                : "Alerta de stock bajo"
            }
          />
        )}
      />
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
}) => {
  const isCatalogMode = !!catalogProduct && !editProduct;
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState({ type: null, name: "" });
  const [priceTiers, setPriceTiers] = useState([]);

  const addPriceTier = () =>
    setPriceTiers((prev) => [
      ...prev,
      { type: "combo", qty: "", price: "" },
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
    formState: { errors },
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const applyFormState = () => {
      if (editProduct) {
        const isBox = isContainerUnit(editProduct.sale_unit);
        const boxQty = editProduct.box_qty || 0;
        reset({
          barcode: editProduct.barcode || "",
          name: editProduct.name || "",
          brand: editProduct.brand || "",
          price: editProduct.price?.toString() || "",
          stock:
            isBox && boxQty > 0
              ? Math.floor(editProduct.stock / boxQty).toString()
              : editProduct.stock?.toString() || "0",
          supplier_id: editProduct.supplier_id?.toString() || "",
          category_id: editProduct.category_id?.toString() || "",
          cost_price: editProduct.cost_price?.toString() || "",
          min_stock: editProduct.min_stock?.toString() || "",
          discount_percent: editProduct.discount_percent?.toString() || "0",
          has_discount: !!editProduct.has_discount,
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
          })),
        );
      } else if (catalogProduct) {
        reset({
          barcode: catalogProduct.barcode || "",
          name: catalogProduct.cat_name || catalogProduct.name || "",
          brand: catalogProduct.brand || "",
          price: "",
          stock: "",
          supplier_id: "",
          category_id: catalogProduct.category_id?.toString() || "",
          cost_price: "",
          min_stock: "",
          discount_percent: "0",
          has_discount: false,
          sale_unit: catalogProduct.sale_unit || "piece",
          box_qty: (catalogProduct.box_qty || "").toString(),
          box_price: "",
          pack_qty: "0",
          pack_price: "",
          packs_per_box: "0",
        });
        setPriceTiers([]);
      } else {
        reset({
          barcode: initialBarcode || "",
          name: "",
          brand: "",
          price: "",
          stock: "",
          supplier_id: "",
          category_id: "",
          cost_price: "",
          min_stock: "",
          discount_percent: "",
          has_discount: false,
          sale_unit: "piece",
          box_qty: "",
          box_price: "",
          pack_qty: "",
          pack_price: "",
          packs_per_box: "",
        });
        setPriceTiers([]);
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
        barcode: barcode,
        name: data.name.trim(),
        brand: data.brand.trim() || "Sin marca",
        price: parseFloat(data.price),
        stock:
          data.sale_unit === "weight"
            ? parseFloat(data.stock) || 0
            : (parseInt(data.stock, 10) || 0) *
                (isContainerUnit(data.sale_unit) ? boxQty : 1),
        supplier_id: data.supplier_id ? parseInt(data.supplier_id) : null,
        category_id: data.category_id ? parseInt(data.category_id) : null,
        cost_price: parseFloat(data.cost_price) || 0,
        min_stock: parseInt(data.min_stock) > 0 ? parseInt(data.min_stock) : 0,
        discount_percent: data.has_discount
          ? parseFloat(data.discount_percent) || 0
          : 0,
        has_discount: data.has_discount ? 1 : 0,
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
              .map((t) => ({
                type: t.type === "mayoreo" ? "mayoreo" : "combo",
                qty: parseInt(t.qty) || 0,
                price: parseFloat(t.price) || 0,
              }))
              .filter((t) => t.qty > 0 && t.price > 0)
          : [],
      };

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
  const { unitInfo, isBox, stockStep, stockLabel, costLabel, priceLabel, boxPriceLabel, boxQtyLabel, priceCols } = useMemo(() => {
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
      boxPriceLabel: info.priceContainer || "Precio",
      boxQtyLabel: info.pzasPer || "Piezas/caja",
      priceCols: isBoxUnit ? "sm:grid-cols-3" : "sm:grid-cols-2",
    };
  }, [su]);

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
                  ? "Modifique la información del producto"
                  : "Complete la información del producto"}
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      onClick={() => setValue("sale_unit", u.value)}
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

              <div className={`grid grid-cols-2 gap-4 ${priceCols}`}>
                {isBox && (
                  <Controller
                    name="box_price"
                    control={control}
                    render={({ field }) => (
                      <NumberField
                        label={boxPriceLabel}
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        step={0.01}
                        placeholder="0.00"
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
                    />
                  )}
                />
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
                    />
                  )}
                />
              </div>

              {(isBox || su === "boxpack") && (
                <div className="rounded-lg border border-border bg-card/50 p-3">
                  {su === "boxpack" ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          Paquete (unidad media)
                        </span>
                      </div>
                      <p className="text-[0.8rem] text-muted-foreground">
                        La caja se vende completa, por paquetes o por pieza suelta.
                        Ej: caja con 12 paquetes de 10 piezas → 120 piezas por caja.
                      </p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                              label="Piezas/paquete"
                              value={field.value}
                              onChange={field.onChange}
                              min={1}
                              placeholder="Ej: 10"
                              error={errors.pack_qty?.message}
                            />
                          )}
                        />
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
                        <div className="flex flex-col justify-end pb-1">
                          <Label className="font-medium text-muted-foreground">
                            Piezas por caja
                          </Label>
                          <div className="flex h-9 items-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-semibold">
                            {boxQtyDisplay > 0 ? boxQtyDisplay : "—"}
                            <span className="text-[0.75rem] font-normal text-muted-foreground">
                              (calculado)
                            </span>
                          </div>
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
                          label={boxQtyLabel}
                          value={field.value}
                          onChange={field.onChange}
                          min={1}
                          placeholder="Ej: 10"
                          helper="Ej: 10 pz"
                          className="max-w-xs"
                        />
                      )}
                    />
                  )}
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-4">
              <SectionTitle icon={Warehouse} title="Inventario inicial" />
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
              <Controller
                name="has_discount"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Descuento/Promoción
                      </p>
                      <p className="text-[0.8rem] text-muted-foreground">
{wHasDiscount
                          ? "Activo. Define el % o deja en 0 para descontar manual en caja."
                          : "Sin descuento/promoción para este producto."}
                      </p>
                    </div>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked);
                        if (!checked) setPriceTiers([]);
                      }}
                    />
                  </div>
                )}
              />

              {wHasDiscount && (
                <div className="space-y-4">
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
                        helper={
                          parseFloat(watchMargins.discount_percent || "0") === 0
                            ? "Con 0%, el botón de descuento aparecerá en el carrito."
                            : "Este % se aplicará automáticamente en cada venta."
                        }
                      />
                    )}
                  />

                  <div className="rounded-lg border border-dashed p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Mayoreo / Promociones por cantidad
                        </p>
                        <p className="text-[0.8rem] text-muted-foreground">
                          Combos: precio fijo al comprar una cantidad exacta (p. ej. 10 por $25; si piden 11, todo va a precio normal). Mayoreo: precio por pieza al comprar desde cierta cantidad (p. ej. desde 15, $30 por las 15).
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={addPriceTier}
                      >
                        <Plus className="h-4 w-4" />
                        Agregar
                      </Button>
                    </div>

                    {priceTiers.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {priceTiers.map((tier, i) => (
                          <div
                            key={i}
                            className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-2"
                          >
                            <div className="space-y-1">
                              <Label className="text-muted-foreground">Tipo</Label>
                              <Select
                                value={tier.type}
                                onValueChange={(v) => updatePriceTier(i, "type", v)}
                              >
                                <SelectTrigger className="w-44">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="combo">Combo X por $Y</SelectItem>
                                  <SelectItem value="mayoreo">Mayoreo desde X</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex flex-col gap-1">
                              <NumberField
                                icon={Hash}
                                label={tier.type === "combo" ? "Cantidad (X)" : "Desde (X)"}
                                value={tier.qty}
                                onChange={(e) => updatePriceTier(i, "qty", e.target.value)}
                                min={1}
                                placeholder="0"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <NumberField
                                label={
                                  tier.type === "mayoreo"
                                    ? "Precio por pieza ($)"
                                    : "Precio ($)"
                                }
                                value={tier.price}
                                onChange={(e) =>
                                  updatePriceTier(i, "price", e.target.value)
                                }
                                min={0}
                                step={0.01}
                                placeholder="0.00"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removePriceTier(i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-foreground">
                Margen Calculado
              </p>
              <p className="text-[0.8rem] text-muted-foreground">
                Basado en costo y venta:{" "}
                <span className="font-extrabold text-emerald-600">
                  {margin !== null ? `${margin.toFixed(1)}%` : "—"}
                </span>
                {packMargin !== null && (
                  <span className="mt-0.5 block">
                    Margen paquete:{" "}
                    <span className="font-extrabold text-emerald-600">
                      {packMargin.toFixed(1)}%
                    </span>
                  </span>
                )}
              </p>
            </div>
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
