import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  CloudUpload,
  FlaskConical,
  Loader2,
  Printer,
  ReceiptText,
  Save,
  SlidersHorizontal,
  Smartphone,
  Store,
  Trash2,
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
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/utils";

const trimWhitespace = (canvas) => {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d");
  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return canvas;
  }
  const threshold = 245;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isWhite =
        data[i + 3] < 16 ||
        (data[i] >= threshold &&
          data[i + 1] >= threshold &&
          data[i + 2] >= threshold);
      if (!isWhite) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return canvas;
  const pad = 2;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w === width && h === height) return canvas;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, w, h);
  octx.drawImage(canvas, left, top, w, h, 0, 0, w, h);
  return out;
};

const resizeImage = (dataUrl, maxSize = 256) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(trimWhitespace(canvas).toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

const TABS = [
  { id: "store", label: "Datos Generales", icon: Store },
  { id: "ticket", label: "Tickets", icon: ReceiptText },
  { id: "pos", label: "Parámetros del POS", icon: SlidersHorizontal },
  { id: "mobile", label: "App Móvil", icon: Smartphone },
  { id: "printer", label: "Impresora", icon: Printer },
];

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
};

const PREVIEW_ITEMS = [
  { name: "Coca-Cola 600 ml", qty: 2, price: 21.5 },
  { name: "Pan Blanco Bimbo", qty: 1, price: 38.0 },
];

const fmt = (n) =>
  n.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const ROUNDING_MODES = [
  { value: "0.10", label: "Cada $0.10", example: "$10.23 → $10.20" },
  { value: "0.20", label: "Cada $0.20", example: "$10.15 → $10.20" },
  { value: "0.50", label: "Cada $0.50", example: "$10.30 → $10.50" },
  { value: "1.00", label: "Cada peso", example: "$10.30 → $10.00" },
];

const SELECT_TRIGGER = "h-10 w-full";

const STORE_PRINTER = "GHIA-GTP582";

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
      return;
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
    } catch (err) {
      console.error("Error saving store settings:", err);
      notify("Error al guardar los datos generales.", "error");
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
      } catch (err) {
        console.error("Error loading ticket settings:", err);
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
    } catch (err) {
      console.error("Error saving ticket settings:", err);
      notify("Error al guardar los ajustes de tickets.", "error");
    } finally {
      setSavingTicket(false);
    }
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
    } catch (err) {
      console.error("Error saving POS settings:", err);
      notify("Error al guardar los parámetros del POS.", "error");
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
        "¿Revocar este dispositivo? Perderá el acceso y deberá introducir el código de activación para volver a emparejarse."
      )
    )
      return;
    const res = await window.api.invoke("revoke-device", deviceId);
    if (res.success) {
      notify("Dispositivo revocado.", "success");
      const status = await reloadActivation();
      setActivation(status);
    } else {
      notify("No se pudo revocar el dispositivo.", "error");
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

      <div className="-mx-6 -mb-6 mt-2 flex items-center justify-end gap-3 border-t border-border/40 bg-muted/30 px-6 py-4 lg:-mx-8 lg:-mb-8 lg:px-8">
        <Button
          onClick={handleSaveStore}
          disabled={loadingStore || savingStore}
        >
          {savingStore ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {savingStore ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </>
  );

  const renderTicketTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Impresión habilitada"
          description="Emitir el ticket automáticamente al cobrar. Si está desactivada, el resto de las opciones quedan bloqueadas."
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
                    {item.qty} pza x ${fmt(item.price)}
                  </span>
                  <span>${fmt(item.qty * item.price)}</span>
                </div>
                <div className="my-1 border-b border-dotted border-black/30" />
              </div>
            ))}
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>${fmt(previewSubtotal)}</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between py-0.5 text-[15px] font-bold">
              <span>TOTAL:</span>
              <span>${fmt(previewSubtotal)}</span>
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

      <div className="-mx-6 -mb-6 mt-2 flex items-center justify-end gap-3 border-t border-border/40 bg-muted/30 px-6 py-4 lg:-mx-8 lg:-mb-8 lg:px-8">
        <Button onClick={handleSaveTicket} disabled={savingTicket}>
          {savingTicket ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {savingTicket ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
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
          title="Ventas sin stock"
          description="Permitir vender aunque el producto no tenga existencias."
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

      <div className="-mx-6 -mb-6 mt-2 flex items-center justify-end gap-3 border-t border-border/40 bg-muted/30 px-6 py-4 lg:-mx-8 lg:-mb-8 lg:px-8">
        <Button onClick={handleSavePos} disabled={savingPos}>
          {savingPos ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {savingPos ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
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

      {activation?.enabled && (
        <>
          <Separator className="my-2" />

          <section>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Dispositivos emparejados ({activation?.devices?.length || 0})
                </p>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  Teléfonos con acceso a este negocio vía la app móvil.
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
                  const dotClass =
                    d.state === "revoked"
                      ? "bg-muted-foreground/40"
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
                            : d.state === "online"
                              ? "Visto recientemente"
                              : "Visto hace más de 24 h"
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {d.deviceName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.cashierName ? `Emparejado por ${d.cashierName} · ` : ""}
                          Activado el {fmtDate(d.activatedAt)}
                          {d.lastSeenAt && ` · Visto ${fmtDate(d.lastSeenAt)}`}
                          {d.state === "revoked" && " · Revocado"}
                        </p>
                      </div>
                      {d.state !== "revoked" && (
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
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

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

  const renderPrinterTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <FieldRow
          label="Impresora de tickets"
          description="Nombre de impresora configurado en el sistema (spooler de Windows)."
        >
          <Input value={STORE_PRINTER} disabled readOnly />
        </FieldRow>
        <FieldRow
          label="Ancho de papel"
          description="Ancho del rollo térmico que usa el sistema para imprimir."
        >
          <Input value="58 mm" disabled readOnly />
        </FieldRow>
        <FieldRow
          label="Impresoras detectadas"
          description="Dispositivos disponibles en este equipo."
        >
          {loadingPrinters ? (
            <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando impresoras...
            </div>
          ) : detectedPrinters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No se detectaron impresoras en este equipo.
            </p>
          ) : (
            <ul className="w-full space-y-2">
              {detectedPrinters.map((p) => {
                const inUse = p.name === STORE_PRINTER;
                const statusLabel = PRINTER_STATUS[p.status] || "Desconocida";
                const dotClass = inUse
                  ? "bg-emerald-500"
                  : p.status === 2
                    ? "bg-destructive"
                    : p.status === 1 || p.status === 3
                      ? "bg-warning"
                      : "bg-muted-foreground/40";
                return (
                  <li
                    key={p.name}
                    className="flex items-start gap-2.5 text-sm text-foreground"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        dotClass
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {p.displayName || p.name}
                      </p>
                      {p.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {p.description}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {statusLabel}
                    </span>
                    {inUse && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        En uso
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </FieldRow>
      </section>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div />
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
          Volver a Ventas
        </Button>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-80">
          <nav className="rounded-2xl border bg-card px-2.5 py-3 shadow-sm">
            <div className="space-y-2">
              {TABS.map(({ id, label, icon: TabIcon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "group flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left text-sm transition-colors",
                    activeTab === id
                      ? "bg-primary/10 font-medium text-primary ring-1 ring-inset ring-primary/30"
                      : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <TabIcon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      activeTab === id
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
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
              {activeTab === "mobile" && renderMobileTab()}
              {activeTab === "printer" && renderPrinterTab()}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ConfigurationScreen;
