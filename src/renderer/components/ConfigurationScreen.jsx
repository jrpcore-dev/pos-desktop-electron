import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Blocks,
  Check,
  CloudUpload,
  FlaskConical,
  Loader2,
  Pencil,
  Printer,
  ReceiptText,
  RefreshCw,
  Save,
  Scale,
  SlidersHorizontal,
  Smartphone,
  Store,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/utils";

import PageHeader from "./PageHeader";
import { fmtNumber } from "../utils/format";
import { buildReceiptHTML } from "../utils/receiptTemplate";
import { resizeImage } from "../utils/logo";
import { FEATURE_KEYS, FEATURES_EVENT } from "../lib/useFeatures";
import {
  getScaleConfig,
  openScaleDialog,
  setScaleEnabled,
  useScaleEnabled,
} from "../utils/scaleConfig";

const TABS = [
  { id: "store", label: "Datos Generales", icon: Store, group: "Tienda" },
  { id: "ticket", label: "Tickets", icon: ReceiptText, group: "Tienda" },
  { id: "pos", label: "Parámetros del POS", icon: SlidersHorizontal, group: "Operación" },
  { id: "features", label: "Funciones", icon: Blocks, group: "Operación" },
  { id: "printer", label: "Impresora", icon: Printer, group: "Dispositivos" },
  { id: "scale", label: "Báscula", icon: Scale, group: "Dispositivos" },
  { id: "mobile", label: "App Móvil", icon: Smartphone, group: "Dispositivos" },
];
const TAB_GROUPS = ["Tienda", "Operación", "Dispositivos"];

const TABS_META = {
  store: {
    icon: Store,
    title: "Datos Generales",
    description:
      "Información comercial de la tienda: nombre, contacto y logotipo.",
  },
  ticket: {
    icon: ReceiptText,
    title: "Tickets",
    description:
      "Contenido e impresión del recibo, con previsualización en vivo.",
  },
  pos: {
    icon: SlidersHorizontal,
    title: "Parámetros del POS",
    description: "Impuestos, redondeo y reglas de operación de la terminal.",
  },
  features: {
    icon: Blocks,
    title: "Funciones",
    description:
      "Enciende solo lo que usa tu tienda. Apagar oculta la función en todas las cajas; no borra nada.",
  },
  mobile: {
    icon: Smartphone,
    title: "App Móvil",
    description:
      "Código de activación y dispositivos autorizados para la app móvil.",
  },
  printer: {
    icon: Printer,
    title: "Impresora",
    description: "Dispositivo de impresión térmica y ancho del papel.",
  },
  scale: {
    icon: Scale,
    title: "Báscula",
    description: "Báscula para vender productos a granel. Se configura en cada caja.",
  },
};

const PREVIEW_ITEMS = [
  { name: "Coca-Cola 600 ml", qty: 2, price: 21.5 },
  { name: "Pan Blanco Bimbo", qty: 1, price: 38.0 },
];

const ROUNDING_MODES = [
  { value: "0.10", label: "Cada $0.10", example: "$10.23 → $10.20" },
  { value: "0.20", label: "Cada $0.20", example: "$10.15 → $10.20" },
  { value: "0.50", label: "Cada $0.50", example: "$10.30 → $10.50" },
  { value: "1.00", label: "Cada peso", example: "$10.30 → $10.00" },
];

const SELECT_TRIGGER = "h-10 w-full";

// "" = impresora predeterminada del sistema. Ningún modelo se hardcodea:
// la selección vive en la setting `printer_name`.
const PAPER_WIDTH_OPTIONS = [48, 58, 80];
// Setting `print_mode`; el main valida los mismos valores.
const PRINT_MODE_OPTIONS = [
  { value: "auto", label: "Automático" },
  { value: "escpos", label: "ESC/POS directo" },
  { value: "driver", label: "Driver de Windows" },
];

const PRINTER_STATUS = {
  0: "Disponible",
  1: "Ocupada",
  2: "Con error",
  3: "Advertencia",
  4: "Desconocida",
};

function FieldRow({ label, description, children, wide, disabled }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8",
        disabled && "opacity-40",
      )}
    >
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div
        className={cn(
          "w-full shrink-0",
          wide ? "sm:w-96" : "sm:w-72",
          disabled && "pointer-events-none",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Mapeo de status del spooler (PrinterInfo.status) a tono semántico del
 *  design system — misma lógica que StockStatus/SystemStatus (dot + texto). */
const PRINTER_STATUS_TONE = {
  0: "ok", // Disponible
  1: "warn", // Ocupada
  2: "err", // Con error
  3: "warn", // Advertencia
  4: "muted", // Desconocida
};

/** Disponibilidad de la impresora: dot + etiqueta coloreada por tono
 *  (patrón idéntico a StockStatus para mantener el lenguaje del app). */
function PrinterStatusPill({ status }) {
  if (!status) return null;
  const tone = PRINTER_STATUS_TONE[status.code] ?? "muted";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "ok" && "bg-success",
          tone === "warn" && "bg-warning",
          tone === "err" && "bg-destructive",
          tone === "muted" && "bg-muted-foreground/40",
        )}
      />
      <span
        className={cn(
          "whitespace-nowrap text-[11px] font-medium",
          tone === "ok" && "text-success",
          tone === "warn" && "text-warning",
          tone === "err" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {status.label}
      </span>
    </span>
  );
}

/**
 * Opción de impresora como card seleccionable (role="radio" dentro de un
 * radiogroup). Semántica de tres estados, sin duplicar señales:
 *  - Selección (pendiente de guardar) → radio + borde primary + tinte.
 *  - "En uso" (guardada en settings, la que realmente imprime) → badge success.
 *  - Disponibilidad → PrinterStatusPill en la segunda línea.
 * Mismo lenguaje visual que los métodos de pago del carrito.
 */
function PrinterOption({
  selected,
  onSelect,
  title,
  description,
  status,
  isDefault,
  isActive,
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected
          ? "border-primary bg-primary/10 ring-1 ring-inset ring-primary/20"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/[0.04]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
          selected
            ? "border-primary"
            : "border-muted-foreground/40 group-hover:border-primary/50",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full transition-colors duration-150",
            selected ? "bg-primary" : "bg-transparent",
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-foreground">
            {title}
          </span>
          {isActive && (
            <Badge className="shrink-0 gap-1 border-transparent bg-success px-1.5 py-0 text-[10px] font-semibold text-success-foreground hover:bg-success">
              <Check className="h-2.5 w-2.5" />
              En uso
            </Badge>
          )}
          {isDefault && (
            <Badge
              variant="outline"
              className="shrink-0 px-1.5 py-0 text-[10px] font-semibold"
            >
              Predeterminada
            </Badge>
          )}
        </span>
        <span className="mt-1 flex items-center gap-2">
          {description && description !== title && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {description}
            </span>
          )}
          <PrinterStatusPill status={status} />
        </span>
      </span>
    </button>
  );
}

function ToggleBlock({
  title,
  description,
  checked,
  onCheckedChange,
  children,
  disabled,
  fullWidth,
}) {
  return (
    <div className={cn("flex flex-col gap-4 py-5", disabled && "opacity-40")}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className="mt-0.5 shrink-0"
        />
      </div>
      {children && (
        <div
          className={cn(
            "w-full",
            !fullWidth && "sm:pl-72",
            disabled && "pointer-events-none",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ConfigurationScreen() {
  const navigate = useNavigate();
  const notify = useToast();
  const fileInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState("store");
  const scaleEnabled = useScaleEnabled();

  const [storeName, setStoreName] = useState("");
  const [storeRfc, setStoreRfc] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeEmail, setStoreEmail] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [storeLogo, setStoreLogo] = useState("");
  const [loadingStore, setLoadingStore] = useState(true);
  const [savingStore, setSavingStore] = useState(false);
  const [storeError, setStoreError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const settings = await window.api.invoke("get-all-settings");
        if (settings.store_name !== undefined) setStoreName(settings.store_name);
        if (settings.store_address !== undefined)
          setStoreAddress(settings.store_address);
        if (settings.store_rfc !== undefined) setStoreRfc(settings.store_rfc);
        if (settings.store_phone !== undefined) setStorePhone(settings.store_phone);
        if (settings.store_email !== undefined) setStoreEmail(settings.store_email);
        if (settings.store_logo) {
          const trimmed = await resizeImage(settings.store_logo);
          setStoreLogo(trimmed);
        } else if (settings.store_logo !== undefined) {
          setStoreLogo("");
        }
      } catch (err) {
        console.error("Error loading store settings:", err);
      } finally {
        setLoadingStore(false);
      }
    };
    load();
  }, []);

  const [detectedPrinters, setDetectedPrinters] = useState([]);
  const [loadingPrinters, setLoadingPrinters] = useState(true);

  // Selección de impresora: "" = predeterminada del sistema. Se persiste en
  // la setting `printer_name`; ningún modelo viene hardcodeado.
  // `activePrinterName` = la guardada en settings (badge "En uso");
  // `printerName` = la elegida en la UI, que puede diferir hasta guardar.
  const [printerName, setPrinterName] = useState("");
  const [activePrinterName, setActivePrinterName] = useState("");
  const [paperWidth, setPaperWidth] = useState("58");
  const [activePaperWidth, setActivePaperWidth] = useState("58");
  // Modo de impresión: "auto" (detecta por nombre/driver), "escpos" (imagen
  // ESC/POS en crudo, sin driver) o "driver" (driver de Windows).
  const [printMode, setPrintMode] = useState("auto");
  const [activePrintMode, setActivePrintMode] = useState("auto");
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const testReceiptHtmlRef = useRef(null);

  useEffect(() => {
    const loadPrinters = async () => {
      try {
        const printers = await window.api.invoke("get-printers");
        setDetectedPrinters(Array.isArray(printers) ? printers : []);
      } catch (err) {
        console.error("Error loading printers:", err);
        setDetectedPrinters([]);
      } finally {
        setLoadingPrinters(false);
      }
    };
    loadPrinters();
  }, []);

  useEffect(() => {
    const loadPrinterSettings = async () => {
      try {
        const s = await window.api.invoke("get-all-settings");
        const name =
          typeof s.printer_name === "string" ? s.printer_name : "";
        const width = s.paper_width_mm ?? "58";
        const mode = PRINT_MODE_OPTIONS.some((o) => o.value === s.print_mode)
          ? s.print_mode
          : "auto";
        setPrinterName(name);
        setActivePrinterName(name);
        setPaperWidth(width);
        setActivePaperWidth(width);
        setPrintMode(mode);
        setActivePrintMode(mode);
      } catch (err) {
        console.error("Error loading printer settings:", err);
      }
    };
    loadPrinterSettings();
  }, []);

  const reloadPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const printers = await window.api.invoke("get-printers");
      setDetectedPrinters(Array.isArray(printers) ? printers : []);
    } catch (err) {
      console.error("Error loading printers:", err);
      setDetectedPrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  };

  const handleSavePrinter = async () => {
    setSavingPrinter(true);
    try {
      const results = await Promise.all([
        window.api.invoke("save-setting", "printer_name", printerName),
        window.api.invoke("save-setting", "paper_width_mm", paperWidth),
        window.api.invoke("save-setting", "print_mode", printMode),
      ]);
      const failed = results.find((r) => r && r.success === false);
      if (failed) throw new Error(failed.error);
      setActivePrinterName(printerName);
      setActivePaperWidth(paperWidth);
      setActivePrintMode(printMode);
      notify("Configuración de impresora guardada correctamente.", "success");
      reloadPrinters();
      return true;
    } catch (err) {
      console.error("Error saving printer settings:", err);
      notify("Error al guardar la configuración de impresora.", "error");
      return false;
    } finally {
      setSavingPrinter(false);
    }
  };

  const handleTestPrint = async () => {
    setTestingPrint(true);
    try {
      // Imprime con la selección ACTUAL de la UI (aunque no esté guardada):
      // print-receipt acepta overrides que el main sanitiza antes de usar.
      const htmlKey = JSON.stringify([storeName, storeLogo, printerName, paperWidth]);
      if (testReceiptHtmlRef.current?.key !== htmlKey) {
        testReceiptHtmlRef.current = {
          key: htmlKey,
          html: buildReceiptHTML({
            store: { name: storeName || "Vendia", logo: storeLogo },
            headerNote: "Prueba de impresión",
            ticketNum: "PRUEBA",
            items: [
              {
                name: "Artículo de prueba",
                qtyDisplay: 1,
                unit: "pza",
                unitPrice: 10,
                lineTotal: 10,
              },
            ],
            subtotal: 10,
            total: 10,
            methodLabel: "EFECTIVO",
            footerNote: `${printerName || "Impresora predeterminada"} · ${paperWidth} mm`,
            paperWidthMm: paperWidth,
          }),
        };
      }
      const html = testReceiptHtmlRef.current.html;
      const res = await window.api.invoke("print-receipt", html, {
        printerName,
        paperWidthMm: Number(paperWidth),
        printMode,
        printVariant: "ticket",
      });
      if (res && res.success) {
        const via =
          res.mode === "escpos" ? "ESC/POS directo" : "driver de Windows";
        notify(
          res.fellBack
            ? `Prueba enviada (${via}) a «${res.printer}»: la seleccionada no está disponible. Verifica físicamente la impresión.`
            : `Prueba enviada (${via}) a «${res.printer}». Verifica físicamente el ticket.`,
          res.fellBack ? "info" : "success",
        );
      } else {
        notify(
          `Falló la impresión de prueba: ${(res && res.error) || "no se pudo enviar el trabajo."}`,
          "error",
        );
      }
    } catch (err) {
      console.error("Error printing test:", err);
      notify(`Falló la impresión de prueba: ${err.message || "error de impresión."}`, "error");
    } finally {
      setTestingPrint(false);
    }
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const resized = await resizeImage(reader.result);
      setStoreLogo(resized);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSaveStore = async () => {
    if (!storeName.trim()) {
      setStoreError("El nombre de la tienda es obligatorio");
      return false;
    }
    setStoreError("");
    setSavingStore(true);
    try {
      await window.api.invoke("save-setting", "store_name", storeName.trim());
      await window.api.invoke("save-setting", "store_address", storeAddress.trim());
      await window.api.invoke("save-setting", "store_rfc", storeRfc.trim().toUpperCase());
      await window.api.invoke("save-setting", "store_phone", storePhone.trim());
      await window.api.invoke("save-setting", "store_email", storeEmail.trim());
      await window.api.invoke("save-setting", "store_logo", storeLogo);
      window.dispatchEvent(
        new CustomEvent("storeSettingsUpdated", {
          detail: {
            storeName: storeName.trim().toUpperCase(),
            address: storeAddress.trim(),
            storeLogo,
          },
        })
      );
      notify("Datos generales guardados correctamente.", "success");
      return true;
    } catch (err) {
      console.error("Error saving store settings:", err);
      notify("Error al guardar los datos generales.", "error");
      return false;
    } finally {
      setSavingStore(false);
    }
  };

  const [printHeaderNote, setPrintHeaderNote] = useState(
    "Sistema de Punto de Venta"
  );
  const [printFooterNote, setPrintFooterNote] = useState(
    "¡GRACIAS POR SU COMPRA!"
  );
  const [printTaxBreakdown, setPrintTaxBreakdown] = useState(true);
  const [printTwoTickets, setPrintTwoTickets] = useState(false);
  const [printEnabled, setPrintEnabled] = useState(true);

  const [taxRate, setTaxRate] = useState(16);
  const [roundingEnabled, setRoundingEnabled] = useState(true);
  const [roundingMode, setRoundingMode] = useState("0.50");
  const [saleWithoutStock, setSaleWithoutStock] = useState(false);
  const [pinForVoid, setPinForVoid] = useState(false);

  const [savingTicket, setSavingTicket] = useState(false);
  const [savingPos, setSavingPos] = useState(false);

  // Funciones de la tienda (ver lib/useFeatures). Sin valor = encendida.
  const [featureFlags, setFeatureFlags] = useState({
    customers: true,
    credit: true,
    services: true,
    expiry: true,
    promos: false,
  });
  const [savedFeatureFlags, setSavedFeatureFlags] = useState(featureFlags);
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    const loadTicketSettings = async () => {
      try {
        const s = await window.api.invoke("get-all-settings");
        if (s.print_enabled !== undefined)
          setPrintEnabled(s.print_enabled !== "false");
        if (s.print_two_tickets !== undefined)
          setPrintTwoTickets(s.print_two_tickets === "true");
        if (s.print_tax_breakdown !== undefined)
          setPrintTaxBreakdown(s.print_tax_breakdown !== "false");
        if (s.print_header_note !== undefined)
          setPrintHeaderNote(s.print_header_note);
        if (s.print_footer_note !== undefined)
          setPrintFooterNote(s.print_footer_note);
        if (s.rounding_enabled !== undefined)
          setRoundingEnabled(s.rounding_enabled !== "false");
        if (s.rounding_mode !== undefined) setRoundingMode(s.rounding_mode);
        if (s.sale_without_stock !== undefined)
          setSaleWithoutStock(s.sale_without_stock === "true");
        if (s.pin_for_void !== undefined)
          setPinForVoid(s.pin_for_void === "true");
        const flags = {};
        for (const [k, key] of Object.entries(FEATURE_KEYS))
          // Promociones avanzadas arranca apagada (ver lib/useFeatures).
          flags[k] = k === "promos" ? s[key] === "true" : s[key] !== "false";
        setFeatureFlags(flags);
        setSavedFeatureFlags(flags);
      } catch (err) {
        console.error("Error loading ticket settings:", err);
      } finally {
        setPrefsLoaded(true);
      }
    };
    loadTicketSettings();
  }, []);

  const handleSaveTicket = async () => {
    setSavingTicket(true);
    try {
      const b = (v) => (v ? "true" : "false");
      await window.api.invoke("save-setting", "print_enabled", b(printEnabled));
      await window.api.invoke(
        "save-setting",
        "print_two_tickets",
        b(printTwoTickets)
      );
      await window.api.invoke(
        "save-setting",
        "print_tax_breakdown",
        b(printTaxBreakdown)
      );
      await window.api.invoke(
        "save-setting",
        "print_header_note",
        printHeaderNote
      );
      await window.api.invoke(
        "save-setting",
        "print_footer_note",
        printFooterNote
      );
      notify("Ajustes de tickets guardados correctamente.", "success");
      return true;
    } catch (err) {
      console.error("Error saving ticket settings:", err);
      notify("Error al guardar los ajustes de tickets.", "error");
      return false;
    } finally {
      setSavingTicket(false);
    }
  };

  const handleSaveFeatures = async () => {
    const flags = {
      ...featureFlags,
      credit: featureFlags.customers && featureFlags.credit,
    };
    // No se apaga el fiado con cuentas por cobrar pendientes.
    const creditWasOn = savedFeatureFlags.customers && savedFeatureFlags.credit;
    if (creditWasOn && !flags.credit) {
      try {
        const res = await window.api.invoke("get-credit-balances");
        if (res?.success && res.receivable > 0) {
          notify(
            `Hay $${res.receivable.toFixed(2)} por cobrar en fiado. Liquídalos o ajústalos antes de apagar el fiado.`,
            "error",
          );
          return;
        }
      } catch {}
    }
    setSavingFeatures(true);
    try {
      for (const [k, key] of Object.entries(FEATURE_KEYS)) {
        await window.api.invoke("save-setting", key, flags[k] ? "true" : "false");
      }
      setFeatureFlags(flags);
      setSavedFeatureFlags(flags);
      window.dispatchEvent(new Event(FEATURES_EVENT));
      notify("Funciones guardadas.", "success");
      return true;
    } catch (err) {
      console.error("Error saving features:", err);
      notify("Error al guardar las funciones.", "error");
      return false;
    } finally {
      setSavingFeatures(false);
    }
  };

  const renderFeaturesTab = () => {
    const set = (k) => (v) =>
      setFeatureFlags((f) => ({
        ...f,
        [k]: v,
        // Apagar Clientes apaga también el fiado.
        ...(k === "customers" && !v ? { credit: false } : {}),
      }));
    return (
      <>
        <section className="divide-y divide-border/40">
          <ToggleBlock
            title="Clientes"
            description="Registro de clientes, niveles y precios especiales. Apagado se ocultan el menú Clientes y el botón Cliente de la terminal."
            checked={featureFlags.customers}
            onCheckedChange={set("customers")}
          />
          <ToggleBlock
            title="Fiado"
            description={
              featureFlags.customers
                ? "Venta a crédito con estado de cuenta y abonos. Apagado se oculta el botón Fiado al cobrar."
                : "Requiere Clientes."
            }
            checked={featureFlags.customers && featureFlags.credit}
            onCheckedChange={set("credit")}
            disabled={!featureFlags.customers}
          />
          <ToggleBlock
            title="Servicios y recargas"
            description="Tiempo aire, paquetes y pago de servicios. Apagado se oculta el menú Servicios."
            checked={featureFlags.services}
            onCheckedChange={set("services")}
          />
          <ToggleBlock
            title="Caducidades"
            description="Fecha de caducidad al agregar stock y avisos antes de que venza. Apagado se oculta el campo y no se generan esos avisos."
            checked={featureFlags.expiry}
            onCheckedChange={set("expiry")}
          />
          <ToggleBlock
            title="Promociones avanzadas"
            description="Descuentos por categoría o marca y paquetes de productos distintos, en su propia sección del menú. Las promos de cada producto siguen en el producto."
            checked={featureFlags.promos}
            onCheckedChange={set("promos")}
          >
            {!featureFlags.promos && (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-snug text-muted-foreground">
                Apagado, las promos por categoría, marca y paquetes no se cobran, pero se
                conservan: vuelven al encenderlo. Aplica a todas las cajas.
              </p>
            )}
          </ToggleBlock>
        </section>

      </>
    );
  };

  const handleSavePos = async () => {
    setSavingPos(true);
    try {
      const b = (v) => (v ? "true" : "false");
      await window.api.invoke(
        "save-setting",
        "rounding_enabled",
        b(roundingEnabled)
      );
      await window.api.invoke("save-setting", "rounding_mode", roundingMode);
      await window.api.invoke(
        "save-setting",
        "sale_without_stock",
        b(saleWithoutStock)
      );
      await window.api.invoke("save-setting", "pin_for_void", b(pinForVoid));
      window.dispatchEvent(
        new CustomEvent("posSettingsUpdated", {
          detail: { roundingEnabled, roundingMode, saleWithoutStock },
        })
      );
      notify("Parámetros del POS guardados correctamente.", "success");
      return true;
    } catch (err) {
      console.error("Error saving POS settings:", err);
      notify("Error al guardar los parámetros del POS.", "error");
      return false;
    } finally {
      setSavingPos(false);
    }
  };

  const [activation, setActivation] = useState(null);
  const [loadingActivation, setLoadingActivation] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const status = await window.api.invoke("get-activation-status");
        setActivation(status);
      } catch (err) {
        console.error("Error loading activation status:", err);
      } finally {
        setLoadingActivation(false);
      }
    };
    load();
  }, []);

  const reloadActivation = async () => {
    const status = await window.api.invoke("get-activation-status");
    setActivation(status);
    return status;
  };

  const handleSetActivation = async (enabled) => {
    if (enabled) {
      const ok = window.confirm(
        "Al activar la seguridad, los nuevos teléfonos necesitarán el código de activación para emparejar la app. Los dispositivos que ya están en uso se emparejarán solos durante los próximos 7 días (período de gracia). ¿Deseas continuar?"
      );
      if (!ok) return;
    }
    const res = await window.api.invoke("set-activation-enabled", enabled);
    if (res.success) {
      setActivation(res.status);
      notify(
        enabled
          ? "Seguridad de App Móvil activada."
          : "Seguridad de App Móvil desactivada.",
        "success"
      );
    } else {
      notify(res.error || "No se pudo cambiar la seguridad.", "error");
    }
  };

  const handleCopyCode = async () => {
    if (!activation?.code) return;
    try {
      await navigator.clipboard.writeText(activation.code);
      notify("Código de activación copiado.", "success");
    } catch (err) {
      notify("No se pudo copiar el código.", "error");
    }
  };

  const handleRotateCode = async () => {
    if (
      !window.confirm(
        "Generar un código nuevo invalida el actual. Los dispositivos ya emparejados seguirán funcionando; solo los no emparejados necesitarán el nuevo código. ¿Deseas continuar?"
      )
    )
      return;
    const res = await window.api.invoke("rotate-activation-code");
    if (res.success) {
      setActivation(res.status);
      notify("Código de activación regenerado.", "success");
    } else {
      notify(res.error || "No se pudo regenerar el código.", "error");
    }
  };

  const handleRevokeDevice = async (deviceId) => {
    if (
      !window.confirm(
        "¿Revocar este dispositivo? Perderá el acceso al momento. Para volver necesitará el código de activación y tu aprobación aquí."
      )
    )
      return;
    const res = await window.api.invoke("revoke-device", deviceId);
    if (res.success) {
      notify("Dispositivo revocado.", "success");
      const status = await reloadActivation();
      setActivation(status);
    } else {
      notify(res?.error || "No se pudo revocar el dispositivo.", "error");
    }
  };

  // Bloque 5 · renombrar una caja sin revocar ni re-emparejar.
  const handleRenameDevice = async (deviceId, currentName) => {
    const name = window.prompt("Nuevo nombre para esta caja", currentName || "");
    if (name == null) return;
    const next = name.trim();
    if (!next || next === currentName) return;
    const res = await window.api.invoke("rename-device", {
      deviceId,
      name: next,
    });
    if (res?.success) {
      setActivation(res.status);
      notify("Nombre actualizado.", "success");
    } else {
      notify(res?.error || "No se pudo renombrar la caja.", "error");
    }
  };

  const handleApproveDevice = async (deviceId) => {
    const res = await window.api.invoke("approve-device", deviceId);    if (res.success) {
      setActivation(res.status);
      notify("Dispositivo aprobado.", "success");
    } else {
      notify(res.error || "No se pudo aprobar el dispositivo.", "error");
    }
  };

  const handleRejectDevice = async (deviceId) => {
    if (
      !window.confirm(
        "¿Rechazar este dispositivo? No podrá usar el sistema hasta volver a emparejarse."
      )
    )
      return;
    const res = await window.api.invoke("reject-device", deviceId);
    if (res.success) {
      setActivation(res.status);
      notify("Dispositivo rechazado.", "success");
    } else {
      notify(res.error || "No se pudo rechazar el dispositivo.", "error");
    }
  };

  const handleSetActivationGrace = async (mode) => {
    const isExpire = mode === "expire";
    if (
      !window.confirm(
        isExpire
          ? "Solo pruebas: marcar como vencido el período de gracia. A partir de ahora, todo teléfono no emparejado pedirá el código. ¿Continuar?"
          : "Solo pruebas: restablecer el período de gracia a 7 días completos a partir de ahora. ¿Continuar?"
      )
    )
      return;
    const res = await window.api.invoke("set-activation-grace", mode);
    if (res.success) {
      setActivation(res.status);
      notify(
        isExpire ? "Gracia vencida (simulado)." : "Gracia reiniciada a 7 días.",
        "success"
      );
    } else {
      notify(res.error || "No se pudo ajustar la gracia.", "error");
    }
  };

  const fmtDate = (s) =>
    s
      ? new Date(String(s).replace(" ", "T") + "Z").toLocaleString("es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const meta = TABS_META[activeTab];
  const MetaIcon = meta.icon;
  // Fase 5 · la lista se muestra siempre que haya dispositivos: con la
  // seguridad apagada una caja aprobada también hay que poder renombrarla o
  // revocarla.
  const showDevices =
    !!activation?.enabled || (activation?.devices || []).length > 0;

  const previewSubtotal = PREVIEW_ITEMS.reduce(
    (sum, i) => sum + i.qty * i.price,
    0
  );

  const renderStoreTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <FieldRow
          label="Nombre de la tienda"
          description="Se muestra en el encabezado del ticket."
        >
          <Input
            value={storeName}
            disabled={loadingStore}
            aria-invalid={!!storeError}
            className={cn(storeError && "border-destructive focus-visible:ring-destructive/40")}
            onChange={(e) => {
              setStoreName(e.target.value);
              if (storeError) setStoreError("");
            }}
            placeholder="Nombre del establecimiento"
          />
        </FieldRow>
        <FieldRow label="RFC" description="Registro fiscal del establecimiento.">
          <Input
            className="uppercase"
            value={storeRfc}
            disabled={loadingStore}
            onChange={(e) => setStoreRfc(e.target.value)}
            placeholder="XAXX010101000"
          />
        </FieldRow>
        <FieldRow label="Teléfono">
          <Input
            type="tel"
            value={storePhone}
            disabled={loadingStore}
            onChange={(e) => setStorePhone(e.target.value)}
            placeholder="(00) 0000 0000"
          />
        </FieldRow>
        <FieldRow label="Correo electrónico">
          <Input
            type="email"
            value={storeEmail}
            disabled={loadingStore}
            onChange={(e) => setStoreEmail(e.target.value)}
            placeholder="ventas@mitienda.mx"
          />
        </FieldRow>
        <FieldRow
          label="Dirección"
          description="Aparece debajo del nombre en el recibo."
          wide
        >
          <Textarea
            rows={2}
            value={storeAddress}
            disabled={loadingStore}
            onChange={(e) => setStoreAddress(e.target.value)}
            placeholder="Calle, número, colonia, ciudad"
          />
        </FieldRow>
      </section>

      <Separator className="my-2" />

      <section className="divide-y divide-border/40">
        <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
          <div className="min-w-0 sm:w-64 sm:shrink-0">
            <p className="text-sm font-medium text-foreground">Logo de la tienda</p>
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              Se imprime en el ticket y en la barra superior. PNG o JPG · máx.
              256 × 256 px.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed bg-muted/40">
              {storeLogo ? (
                <img
                  src={storeLogo}
                  alt="Logo de la tienda"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-2xl font-bold text-primary">
                  {storeName.charAt(0) || "?"}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingStore}
                onClick={() => fileInputRef.current?.click()}
              >
                <CloudUpload className="h-4 w-4" />
                Subir logo
              </Button>
              {storeLogo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStoreLogo("")}
                >
                  <Trash2 className="h-4 w-4" />
                  Quitar logo
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {storeError && (
        <p className="mt-2 text-sm font-medium text-destructive">{storeError}</p>
      )}

    </>
  );

  const renderTicketTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Impresión habilitada"
          description="Emitir el ticket automáticamente al cobrar en ESTE equipo (cada caja decide si imprime). Las demás opciones del ticket son del negocio y se comparten con todas las cajas."
          checked={printEnabled}
          onCheckedChange={setPrintEnabled}
        />
      </section>

      <Separator className="my-2" />

      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Desglose de impuestos"
          description="Incluir la línea de IVA dentro del recibo."
          checked={printTaxBreakdown}
          onCheckedChange={setPrintTaxBreakdown}
          disabled={!printEnabled}
        />
        <FieldRow
          label="Encabezado personalizado"
          description="Mensaje que aparece debajo del logo."
          disabled={!printEnabled}
        >
          <Input
            value={printHeaderNote}
            onChange={(e) => setPrintHeaderNote(e.target.value)}
          />
        </FieldRow>
        <FieldRow
          label="Pie de página"
          description="Agradecimientos, políticas o publicidad."
          disabled={!printEnabled}
        >
          <Textarea
            rows={2}
            value={printFooterNote}
            onChange={(e) => setPrintFooterNote(e.target.value)}
          />
        </FieldRow>
        <ToggleBlock
          title="Copia del cliente"
          description="Imprimir dos copias por cada venta."
          checked={printTwoTickets}
          onCheckedChange={setPrintTwoTickets}
          disabled={!printEnabled}
        />
      </section>

      <Separator className="my-2" />

      <section>
        <p className="text-sm font-medium text-foreground">
          Previsualización del ticket
        </p>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          Así se imprimirá el recibo al cobrar, con los valores de esta pantalla.
        </p>
        <div className="mt-6 flex justify-center rounded-2xl border border-border/40 bg-muted/40 p-6">
          <div className="max-h-[620px] w-full max-w-[340px] shrink-0 overflow-y-auto rounded-xl bg-white p-5 text-[12px] leading-relaxed text-black shadow-xl">
            <p className="m-0 text-center text-[16px] font-bold uppercase leading-none tracking-[0.5px]">
              {storeName || "MI TIENDA POS"}
            </p>
            {storeLogo && (
              <div className="mt-1.5 flex justify-center">
                <img
                  src={storeLogo}
                  alt="Logo de la tienda"
                  className="max-h-14 w-auto max-w-full"
                />
              </div>
            )}
            {printHeaderNote && (
              <p className="mt-0.5 text-center">{printHeaderNote}</p>
            )}
            <div className="my-2 border-t border-dashed border-black/40" />
            <p className="text-center">
              {new Date().toLocaleDateString("es-MX", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              <br />
              {new Date().toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between">
              <span>Cajero:</span>
              <span>Ana López</span>
            </div>
            <div className="flex justify-between">
              <span>Ticket #:</span>
              <span>00125</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            <p className="text-center font-bold">DETALLE DE COMPRA</p>
            <div className="my-2 border-t border-dashed border-black/40" />
            {PREVIEW_ITEMS.map((item) => (
              <div key={item.name}>
                <p className="font-bold">{item.name}</p>
                <div className="flex justify-between">
                  <span>
                    {item.qty} pza x ${fmtNumber(item.price)}
                  </span>
                  <span>${fmtNumber(item.qty * item.price)}</span>
                </div>
                <div className="my-1 border-b border-dotted border-black/30" />
              </div>
            ))}
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>${fmtNumber(previewSubtotal)}</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between py-0.5 text-[15px] font-bold">
              <span>TOTAL:</span>
              <span>${fmtNumber(previewSubtotal)}</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between">
              <span>Metodo:</span>
              <span className="font-bold">EFECTIVO</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            {printFooterNote && (
              <p className="text-center font-bold">{printFooterNote}</p>
            )}
            <p className="text-center">Conserve este ticket</p>
            <p className="mt-1 text-center text-[9px]">Vendia</p>
          </div>
        </div>
      </section>

    </>
  );

  const renderPosTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <FieldRow
          label="Impuesto (IVA)"
          description="Porcentaje que se aplica a cada venta."
        >
          <InputGroup>
            <InputGroupInput
              type="number"
              min={0}
              max={100}
              value={taxRate}
              onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
            />
            <InputGroupText align="inline-end">%</InputGroupText>
          </InputGroup>
        </FieldRow>
        <ToggleBlock
          title="Redondeo de efectivo"
          description="Ajustar el total en efectivo al múltiplo más cercano."
          checked={roundingEnabled}
          onCheckedChange={setRoundingEnabled}
          fullWidth
        >
          {roundingEnabled && (
            <div className="grid grid-cols-4 gap-2">
              {ROUNDING_MODES.map((opt) => {
                const active = roundingMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRoundingMode(opt.value)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border/60 bg-background hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-semibold">
                        {opt.label}
                      </span>
                      {active && <Check className="h-5 w-5 text-primary" />}
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground/80">
                      {opt.example}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </ToggleBlock>
      </section>

      <Separator className="my-2" />

      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Agregar sin stock al carrito"
          description="Solo controla si se pueden agregar productos al carrito sin existencias. Al cobrar, la venta nunca se rechaza por stock: si el inventario queda negativo, se avisa para ajustarlo."
          checked={saleWithoutStock}
          onCheckedChange={setSaleWithoutStock}
        />
        <ToggleBlock
          title="NIP para anular ventas"
          description="Solicitar el NIP del usuario al cancelar una venta en Turnos y Cortes."
          checked={pinForVoid}
          onCheckedChange={setPinForVoid}
        />

      </section>

    </>
  );

  const renderMobileTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Requerir código de activación"
          description="La app móvil solo se puede emparejar con este negocio. Apagado por defecto: los clientes existentes no notan cambio alguno."
          checked={activation?.enabled || false}
          onCheckedChange={handleSetActivation}
        >
          {activation?.enabled && activation.graceActive && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-snug text-warning">
              Período de gracia activo: los teléfonos en uso se emparejan solos
              hasta el {fmtDate(activation.graceEndsAt)} ({activation.graceDaysLeft} días).
              Después, todo teléfono nuevo necesitará el código.
            </p>
          )}
        </ToggleBlock>

        {activation?.enabled && (
          <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="min-w-0 sm:w-64 sm:shrink-0">
              <p className="text-sm font-medium text-foreground">
                Código de activación
              </p>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                Compártelo con empleados nuevos, no con dispositivos no
                autorizados.
              </p>
            </div>
            <div className="flex w-full shrink-0 items-center gap-2 sm:w-96">
              <Input
                value={activation?.code || ""}
                readOnly
                className="text-sm tracking-widest"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCode}
              >
                Copiar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRotateCode}
                title="Generar un código nuevo"
              >
                Regenerar
              </Button>
            </div>
          </div>
        )}
      </section>

      {showDevices && (
        <>
          <Separator className="my-2" />

          <section>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Dispositivos emparejados ({activation?.devices?.length || 0})
                </p>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  Teléfonos y cajas con acceso a este negocio.
                </p>
              </div>
            </div>
            {loadingActivation ? (
              <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando dispositivos...
              </div>
            ) : (activation?.devices?.length || 0) === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                Aún no hay dispositivos emparejados.
              </p>
            ) : (
              <ul className="mt-1 space-y-2">
                {activation.devices.map((d) => {
                  const isPending =
                    d.approved === false && d.state !== "revoked";
                  const dotClass =
                    d.state === "revoked"
                      ? "bg-muted-foreground/40"
                      : d.state === "pending"
                        ? "bg-amber-500"
                        : d.state === "online"
                          ? "bg-emerald-500"
                          : "bg-warning";
                  return (
                    <li
                      key={d.deviceId}
                      className="flex items-center gap-3 rounded-xl border border-border/40 px-3.5 py-3"
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          dotClass
                        )}
                        title={
                          d.state === "revoked"
                            ? "Revocado"
                            : d.state === "pending"
                              ? "Pendiente de aprobación"
                              : d.state === "online"
                                ? "Visto recientemente"
                                : "Visto hace más de 24 h"
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {d.deviceName}
                          {d.deviceCode ? ` · ${d.deviceCode}` : ""}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.deviceType === "desktop_box"
                            ? "Caja adicional"
                            : "App móvil"}
                          {d.cashierName
                            ? ` · Emparejado por ${d.cashierName}`
                            : ""}
                          {` · Activado el ${fmtDate(d.activatedAt)}`}
                          {d.lastSeenAt && ` · Visto ${fmtDate(d.lastSeenAt)}`}
                          {d.deviceType === "desktop_box" &&
                            (d.state === "online"
                              ? " · En línea"
                              : d.state === "offline"
                                ? " · Sin conexión"
                                : "")}
                          {d.pendingSync > 0 &&
                            ` · ${d.pendingSync} venta(s) sin subir`}
                          {d.state === "revoked" && " · Revocado"}
                          {isPending && " · Pendiente de aprobación"}
                        </p>
                      </div>
                      {isPending ? (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleApproveDevice(d.deviceId)}
                          >
                            Aprobar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleRejectDevice(d.deviceId)}
                          >
                            Rechazar
                          </Button>
                        </div>
                      ) : d.state !== "revoked" ? (
                        <div className="flex shrink-0 items-center gap-1">
                          {d.deviceType === "desktop_box" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleRenameDevice(d.deviceId, d.deviceName)
                              }
                            >
                              <Pencil className="h-4 w-4" />
                              Renombrar
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-destructive hover:text-destructive"
                            onClick={() => handleRevokeDevice(d.deviceId)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Revocar
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {activation?.enabled && (
        <>
          <Separator className="my-4" />

          <section className="rounded-xl border border-dashed border-amber-500/40 bg-warning/5 p-4">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-amber-500" />
              <p className="text-sm font-medium text-foreground">Pruebas</p>
            </div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Acciones de desarrollo para validar el comportamiento del
              período de gracia. Cambios inmediatos; dejan de valer al
              volver a activar la seguridad o aplicando la acción contraria.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSetActivationGrace("expire")}
              >
                Simular vencimiento de gracia
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSetActivationGrace("reset")}
              >
                Reiniciar gracia (7 días)
              </Button>
            </div>
          </section>
        </>
      )}
    </>
  );

  const renderScaleTab = () => {
    const savedPort = getScaleConfig().port;
    return (
      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Esta caja tiene báscula"
          description="Actívalo sólo si hay una báscula conectada a esta computadora. Apagado, el sistema no la busca ni la muestra, y el peso de los productos a granel se escribe a mano."
          checked={scaleEnabled}
          onCheckedChange={(v) => {
            setScaleEnabled(v);
            notify(
              v ? "Báscula activada en esta caja" : "Báscula desactivada en esta caja",
              "success",
            );
          }}
        />
        {scaleEnabled && (
          <FieldRow
            label="Conexión"
            description={
              savedPort
                ? `Configurada en ${savedPort}. Puedes probarla o cambiarla.`
                : "Aún no está configurada. Conéctala para leer el peso automáticamente."
            }
          >
            <Button variant="outline" className="w-full" onClick={openScaleDialog}>
              <Scale className="h-4 w-4" />
              {savedPort ? "Probar o cambiar báscula" : "Configurar báscula"}
            </Button>
          </FieldRow>
        )}
      </section>
    );
  };

  const renderPrinterTab = () => {
    const selectedMissing =
      printerName !== "" &&
      !detectedPrinters.some((p) => p.name === printerName);
    const defaultPrinter = detectedPrinters.find((p) => p.isDefault);
    const hasUnsavedChanges =
      printerName !== activePrinterName ||
      paperWidth !== activePaperWidth ||
      printMode !== activePrintMode;
    // Lo que haría "Automático" con la impresora que se usaría al imprimir.
    const effectivePrinter =
      detectedPrinters.find((p) => p.name === printerName) ||
      (printerName === "" ? defaultPrinter : null) ||
      defaultPrinter;
    const autoModeLabel = effectivePrinter
      ? effectivePrinter.autoMode === "escpos"
        ? `ESC/POS directo (detectada como térmica: ${effectivePrinter.displayName || effectivePrinter.name})`
        : `Driver de Windows (${effectivePrinter.displayName || effectivePrinter.name} no parece térmica)`
      : null;
    return (
      <>
        <section className="divide-y divide-border/40">
          <FieldRow
            wide
            label="Impresora de tickets"
            description="Selecciona la impresora del spooler de Windows. Si la configurada no está disponible en el equipo, se usa la predeterminada del sistema."
          >
            {loadingPrinters ? (
              <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando impresoras...
              </div>
            ) : detectedPrinters.length === 0 ? (
              <div className="flex w-full flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4">
                <p className="text-sm text-muted-foreground">
                  No se detectaron impresoras en este equipo.
                </p>
                <Button variant="outline" size="sm" onClick={reloadPrinters}>
                  <RefreshCw className="h-4 w-4" />
                  Volver a buscar
                </Button>
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="Impresora de tickets"
                className="flex w-full flex-col gap-2"
              >
                <PrinterOption
                  selected={printerName === ""}
                  onSelect={() => setPrinterName("")}
                  title="Predeterminada del sistema"
                  description={
                    defaultPrinter
                      ? `Windows usará: ${defaultPrinter.displayName}`
                      : "Windows elegirá la impresora en cada impresión."
                  }
                  isActive={activePrinterName === ""}
                />
                {detectedPrinters.map((p) => (
                  <PrinterOption
                    key={p.name}
                    selected={printerName === p.name}
                    onSelect={() => setPrinterName(p.name)}
                    title={p.displayName || p.name}
                    description={p.description}
                    status={{
                      code: p.status,
                      label: PRINTER_STATUS[p.status] || "Desconocida",
                    }}
                    isDefault={p.isDefault}
                    isActive={p.name === activePrinterName}
                  />
                ))}
              </div>
            )}
            {selectedMissing && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-snug text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  «{printerName}» no está disponible en este equipo: al
                  imprimir se usará la predeterminada del sistema.
                </span>
              </p>
            )}
          </FieldRow>
          <FieldRow
            label="Ancho de papel"
            description="Ancho del rollo térmico que usa el sistema para imprimir."
          >
            <div
              role="group"
              aria-label="Ancho de papel"
              className="flex w-full gap-1 rounded-lg border border-border bg-background p-1"
            >
              {PAPER_WIDTH_OPTIONS.map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={paperWidth === String(w)}
                  onClick={() => setPaperWidth(String(w))}
                  className={cn(
                    "h-9 flex-1 cursor-pointer rounded-md border text-sm font-bold tabular-nums transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    paperWidth === String(w)
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {w} mm
                </button>
              ))}
            </div>
          </FieldRow>
          <FieldRow
            label="Modo de impresión"
            description="ESC/POS directo manda el ticket como imagen sin pasar por el driver (recomendado para térmicas: funciona con cualquier driver). Driver de Windows es para impresoras láser o de inyección."
          >
            <div className="flex w-full flex-col gap-2">
              <div
                role="group"
                aria-label="Modo de impresión"
                className="flex w-full gap-1 rounded-lg border border-border bg-background p-1"
              >
                {PRINT_MODE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={printMode === o.value}
                    onClick={() => setPrintMode(o.value)}
                    className={cn(
                      "h-9 flex-1 cursor-pointer rounded-md border px-2 text-sm font-bold transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      printMode === o.value
                        ? "border-primary bg-primary/10 text-primary shadow-sm"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {printMode === "auto" && autoModeLabel && (
                <p className="text-xs text-muted-foreground">
                  Se usará: {autoModeLabel}. Si no imprime, elige el modo
                  manualmente.
                </p>
              )}
            </div>
          </FieldRow>
          <FieldRow
            label="Acciones"
            description="Guarda la selección o imprime un ticket de prueba con los ajustes actuales."
          >
            <div className="flex w-full flex-col items-end gap-2">
              {hasUnsavedChanges && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                  />
                  Cambios sin guardar — la impresora en uso no cambiará hasta
                  que guardes.
                </span>
              )}
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={reloadPrinters}
                  disabled={loadingPrinters}
                >
                  {loadingPrinters ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Recargar
                </Button>
                <Button
                  variant="outline"
                  onClick={handleTestPrint}
                  disabled={testingPrint}
                  title="Envía este ticket real a la impresora seleccionada con el ancho y el modo de impresión elegidos."
                >
                  {testingPrint ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  Imprimir prueba
                </Button>
              </div>
            </div>
          </FieldRow>
        </section>
      </>
    );
  };

  // ─── Cambios sin guardar ────────────────────────────────────────────────
  // Cada pestaña con guardado manual expone su valor actual, cómo aplicar un
  // valor (para "Descartar") y su guardado. La "foto" guardada se toma al
  // terminar de cargar y después de guardar bien.
  const [savedSnap, setSavedSnap] = useState({});
  const [pendingTab, setPendingTab] = useState(null);
  const tabForms = {
    store: {
      value: { storeName, storeRfc, storePhone, storeEmail, storeAddress, storeLogo },
      apply: (v) => {
        setStoreName(v.storeName);
        setStoreRfc(v.storeRfc);
        setStorePhone(v.storePhone);
        setStoreEmail(v.storeEmail);
        setStoreAddress(v.storeAddress);
        setStoreLogo(v.storeLogo);
        setStoreError("");
      },
      save: handleSaveStore,
      saving: savingStore,
    },
    ticket: {
      value: { printEnabled, printTwoTickets, printTaxBreakdown, printHeaderNote, printFooterNote },
      apply: (v) => {
        setPrintEnabled(v.printEnabled);
        setPrintTwoTickets(v.printTwoTickets);
        setPrintTaxBreakdown(v.printTaxBreakdown);
        setPrintHeaderNote(v.printHeaderNote);
        setPrintFooterNote(v.printFooterNote);
      },
      save: handleSaveTicket,
      saving: savingTicket,
    },
    pos: {
      value: { roundingEnabled, roundingMode, saleWithoutStock, pinForVoid },
      apply: (v) => {
        setRoundingEnabled(v.roundingEnabled);
        setRoundingMode(v.roundingMode);
        setSaleWithoutStock(v.saleWithoutStock);
        setPinForVoid(v.pinForVoid);
      },
      save: handleSavePos,
      saving: savingPos,
    },
    features: {
      value: featureFlags,
      savedValue: savedFeatureFlags,
      apply: setFeatureFlags,
      save: handleSaveFeatures,
      saving: savingFeatures,
    },
    printer: {
      value: { printerName, paperWidth, printMode },
      savedValue: {
        printerName: activePrinterName,
        paperWidth: activePaperWidth,
        printMode: activePrintMode,
      },
      apply: (v) => {
        setPrinterName(v.printerName);
        setPaperWidth(v.paperWidth);
        setPrintMode(v.printMode);
      },
      save: handleSavePrinter,
      saving: savingPrinter,
    },
  };
  const savedOf = (tab) => tabForms[tab]?.savedValue ?? savedSnap[tab];
  const isDirty = (tab) => {
    const f = tabForms[tab];
    const sv = savedOf(tab);
    return !!f && !!sv && JSON.stringify(f.value) !== JSON.stringify(sv);
  };
  const activeDirty = isDirty(activeTab);
  const activeForm = tabForms[activeTab];

  // Foto inicial cuando termina cada carga.
  useEffect(() => {
    if (!loadingStore)
      setSavedSnap((s) => (s.store ? s : { ...s, store: tabForms.store.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingStore]);
  useEffect(() => {
    if (prefsLoaded)
      setSavedSnap((s) =>
        s.ticket ? s : { ...s, ticket: tabForms.ticket.value, pos: tabForms.pos.value },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded]);

  const saveActive = async () => {
    if (!activeForm || activeForm.saving) return;
    const value = activeForm.value;
    const ok = await activeForm.save();
    if (ok && !activeForm.savedValue)
      setSavedSnap((s) => ({ ...s, [activeTab]: value }));
  };
  const discardActive = () => {
    const sv = savedOf(activeTab);
    if (activeForm && sv) activeForm.apply(sv);
  };
  // Cambiar de pestaña con cambios pendientes pide confirmación.
  const requestTab = (id) => {
    if (id === activeTab) return;
    if (activeDirty) setPendingTab(id);
    else setActiveTab(id);
  };
  // Ctrl+S guarda la pestaña actual.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && activeDirty) {
        e.preventDefault();
        saveActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader
        className="xl:mb-6"
        description="Ajusta la tienda, el ticket, la impresión y los dispositivos móviles"
        actions={
          <Button variant="outline" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
            Volver a Ventas
          </Button>
        }
      />

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-80">
          <nav className="flex flex-col gap-3 rounded-xl border border-border bg-card p-2.5">
            {TAB_GROUPS.map((group) => (
              <div key={group}>
                <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{group}</p>
                <div className="flex flex-col gap-0.5">
                  {TABS.filter((t) => t.group === group).map(({ id, label, icon: TabIcon }) => {
                    const active = activeTab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => requestTab(id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "group relative flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors duration-150",
                          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          active
                            ? "bg-primary/10 font-semibold text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                            active ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <TabIcon
                          className={cn(
                            "size-[18px] shrink-0",
                            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        <span className="flex-1 truncate">{label}</span>
                        {isDirty(id) && (
                          <span className="size-2 shrink-0 rounded-full bg-warning" aria-label="Cambios sin guardar" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <Card className="overflow-hidden rounded-xl border border-border/60 shadow-sm">
            <div className="flex items-start gap-3 border-b border-border/40 px-6 py-5 lg:px-8">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MetaIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-display text-lg font-bold text-foreground">
                  {meta.title}
                </h2>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {meta.description}
                </p>
              </div>
            </div>

            <div className="space-y-6 px-6 py-6 lg:px-8 lg:py-8">
              {activeTab === "store" && renderStoreTab()}
              {activeTab === "ticket" && renderTicketTab()}
              {activeTab === "pos" && renderPosTab()}
              {activeTab === "features" && renderFeaturesTab()}
              {activeTab === "mobile" && renderMobileTab()}
              {activeTab === "printer" && renderPrinterTab()}
              {activeTab === "scale" && renderScaleTab()}
            </div>
          </Card>

          {activeDirty && (
            <div className="sticky bottom-4 z-20 mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-card px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className="size-2 rounded-full bg-warning" aria-hidden />
                Tienes cambios sin guardar
                <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                  · Ctrl+S para guardar
                </span>
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={discardActive} disabled={activeForm?.saving}>
                  Descartar
                </Button>
                <Button onClick={saveActive} disabled={activeForm?.saving}>
                  {activeForm?.saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {activeForm?.saving ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </div>
          )}

          <ConfirmDialog
            open={!!pendingTab}
            onOpenChange={(o) => !o && setPendingTab(null)}
            title="Cambios sin guardar"
            description="Tienes cambios sin guardar en esta sección. Si cambias de sección se descartarán."
            confirmLabel="Descartar y continuar"
            cancelLabel="Seguir editando"
            variant="default"
            iconColor="warning"
            onConfirm={() => {
              discardActive();
              setActiveTab(pendingTab);
              setPendingTab(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default ConfigurationScreen;
