import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CloudUpload,
  Loader2,
  Printer,
  ReceiptText,
  Save,
  ShieldCheck,
  SlidersHorizontal,
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
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

const TABS = [
  { id: "store", label: "Datos Generales", icon: Store },
  { id: "ticket", label: "Tickets", icon: ReceiptText },
  { id: "pos", label: "Parámetros del POS", icon: SlidersHorizontal },
  { id: "security", label: "Seguridad y NIP", icon: ShieldCheck },
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
  security: {
    icon: ShieldCheck,
    title: "Seguridad y NIP",
    description: "Bloqueo automático y restricciones con contraseña del cajero.",
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
  { name: "Galletas Emperador", qty: 3, price: 24.5 },
];

const fmt = (n) =>
  n.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const SELECT_TRIGGER = "h-10 w-full";

const STORE_PRINTER = "GHIA-GTP582";

const PRINTER_STATUS = {
  0: "Disponible",
  1: "Ocupada",
  2: "Con error",
  3: "Advertencia",
  4: "Desconocida",
};

function FieldRow({ label, description, children, wide }) {
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className={cn("w-full shrink-0", wide ? "sm:w-96" : "sm:w-72")}>
        {children}
      </div>
    </div>
  );
}

function ToggleBlock({ title, description, checked, onCheckedChange, children }) {
  return (
    <div className="flex flex-col gap-4 py-5">
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
          className="mt-0.5 shrink-0"
        />
      </div>
      {children && <div className="w-full sm:pl-72">{children}</div>}
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
        if (settings.store_logo !== undefined) setStoreLogo(settings.store_logo);
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

  const [printHeaderNote, setPrintHeaderNote] = useState("Gracias por su compra");
  const [printFooterNote, setPrintFooterNote] = useState(
    "Vuelva pronto • Cambios con ticket"
  );
  const [printTaxBreakdown, setPrintTaxBreakdown] = useState(true);
  const [printTwoTickets, setPrintTwoTickets] = useState(false);
  const [printEnabled, setPrintEnabled] = useState(true);

  const [taxRate, setTaxRate] = useState(16);
  const [roundingEnabled, setRoundingEnabled] = useState(true);
  const [roundingMode, setRoundingMode] = useState("half");
  const [manualDiscount, setManualDiscount] = useState(true);
  const [saleWithoutStock, setSaleWithoutStock] = useState(false);

  const [lockTimeout, setLockTimeout] = useState("5");
  const [pinForDiscount, setPinForDiscount] = useState(true);
  const [maxDiscountPercent, setMaxDiscountPercent] = useState(25);
  const [pinForVoid, setPinForVoid] = useState(false);

  const meta = TABS_META[activeTab];
  const MetaIcon = meta.icon;

  const subtotal = PREVIEW_ITEMS.reduce((sum, i) => sum + i.qty * i.price, 0);
  const iva = (subtotal * taxRate) / 100;
  const total = subtotal + iva;

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
          title="Desglose de impuestos"
          description="Incluir la línea de IVA dentro del recibo."
          checked={printTaxBreakdown}
          onCheckedChange={setPrintTaxBreakdown}
        />
        <FieldRow
          label="Encabezado personalizado"
          description="Mensaje que aparece debajo del logo."
        >
          <Input
            value={printHeaderNote}
            onChange={(e) => setPrintHeaderNote(e.target.value)}
          />
        </FieldRow>
        <FieldRow
          label="Pie de página"
          description="Agradecimientos, políticas o publicidad."
        >
          <Textarea
            rows={2}
            value={printFooterNote}
            onChange={(e) => setPrintFooterNote(e.target.value)}
          />
        </FieldRow>
      </section>

      <Separator className="my-2" />

      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Copia del cliente"
          description="Imprimir dos copias por cada venta."
          checked={printTwoTickets}
          onCheckedChange={setPrintTwoTickets}
        />
        <ToggleBlock
          title="Impresión habilitada"
          description="Emitir el ticket automáticamente al cobrar."
          checked={printEnabled}
          onCheckedChange={setPrintEnabled}
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
        <div className="mt-6 flex justify-center rounded-2xl border border-border/40 bg-muted/40 p-8">
          <div className="w-full max-w-[300px] shrink-0 bg-white p-5 font-mono text-[11px] leading-relaxed text-black shadow-xl">
            <div className="text-center">
              <p className="text-[13px] font-bold uppercase tracking-tight">
                {storeName}
              </p>
              <p className="mt-0.5">{storeAddress}</p>
              <p className="mt-0.5">RFC: {storeRfc}</p>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            {printHeaderNote && (
              <p className="text-center italic">{printHeaderNote}</p>
            )}
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between">
              <span>{new Date().toLocaleDateString("es-MX")}</span>
              <span>Ticket #00125</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Cajero</span>
              <span>Ana López</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="space-y-1">
              {PREVIEW_ITEMS.map((item) => (
                <div key={item.name}>
                  <p className="font-semibold">{item.name}</p>
                  <div className="flex justify-between">
                    <span>
                      {item.qty} × {fmt(item.price)}
                    </span>
                    <span>{fmt(item.qty * item.price)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            {printTaxBreakdown && (
              <div className="flex justify-between">
                <span>IVA ({taxRate}%)</span>
                <span>{fmt(iva)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between text-[13px] font-bold">
              <span>TOTAL</span>
              <span>${fmt(total)}</span>
            </div>
            <div className="my-2 border-t border-dashed border-black/40" />
            {printFooterNote && (
              <p className="text-center italic">{printFooterNote}</p>
            )}
            <div className="mt-3 text-center text-[13px] tracking-[0.35em] text-black/70">
              || || || || || || || ||
            </div>
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
          description="Ajustar el cambio a la denominación más cercana."
          checked={roundingEnabled}
          onCheckedChange={setRoundingEnabled}
        >
          {roundingEnabled && (
            <Select value={roundingMode} onValueChange={setRoundingMode}>
              <SelectTrigger className={SELECT_TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="half">Al $0.50 más cercano</SelectItem>
                <SelectItem value="whole">Al peso completo</SelectItem>
                <SelectItem value="coin">A la moneda de $0.05</SelectItem>
              </SelectContent>
            </Select>
          )}
        </ToggleBlock>
      </section>

      <Separator className="my-2" />

      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="Descuento manual"
          description="Permitir aplicar descuento libre por producto."
          checked={manualDiscount}
          onCheckedChange={setManualDiscount}
        />
        <ToggleBlock
          title="Ventas sin stock"
          description="Permitir vender aunque el producto no tenga existencias."
          checked={saleWithoutStock}
          onCheckedChange={setSaleWithoutStock}
        />
      </section>
    </>
  );

  const renderSecurityTab = () => (
    <>
      <section className="divide-y divide-border/40">
        <FieldRow
          label="Bloqueo automático"
          description="La terminal pide NIP tras un periodo de inactividad."
        >
          <Select value={lockTimeout} onValueChange={setLockTimeout}>
            <SelectTrigger className={SELECT_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 minuto</SelectItem>
              <SelectItem value="5">5 minutos</SelectItem>
              <SelectItem value="15">15 minutos</SelectItem>
              <SelectItem value="0">Nunca</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        <ToggleBlock
          title="NIP para descuentos"
          description="Pedir contraseña antes de autorizar un descuento."
          checked={pinForDiscount}
          onCheckedChange={setPinForDiscount}
        >
          {pinForDiscount && (
            <InputGroup>
              <InputGroupInput
                type="number"
                min={0}
                max={100}
                value={maxDiscountPercent}
                onChange={(e) => setMaxDiscountPercent(Number(e.target.value) || 0)}
              />
              <InputGroupText align="inline-end">
                % de descuento máximo
              </InputGroupText>
            </InputGroup>
          )}
        </ToggleBlock>
      </section>

      <Separator className="my-2" />

      <section className="divide-y divide-border/40">
        <ToggleBlock
          title="NIP para anular ventas"
          description="Solicitar contraseña al eliminar un ticket completo."
          checked={pinForVoid}
          onCheckedChange={setPinForVoid}
        />
      </section>
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
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Configuración del sistema
          </p>
          <h1 className="text-display text-2xl font-bold text-foreground sm:text-3xl">
            Configuración
          </h1>
        </div>
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
              {activeTab === "security" && renderSecurityTab()}
              {activeTab === "printer" && renderPrinterTab()}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ConfigurationScreen;