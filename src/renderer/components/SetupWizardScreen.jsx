import React, { useState, useEffect, useRef, Fragment } from "react";
import {
  Store, User, Phone, MapPin, Lock, Settings, CheckCircle2,
  ChevronLeft, ChevronRight, Eye, EyeOff, Coins, Zap, Rocket,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { InputGroup, InputGroupInput } from "./ui/input-group";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import { cn } from "@/lib/utils";
import CancelButton from "./CancelButton";

const PIN_LENGTH = 3;
const PIN_MIN = 3;
const PIN_VISIBLE_MIN = 3;

const CURRENCIES = [
  { code: "MXN", label: "Peso mexicano", symbol: "$" },
  { code: "USD", label: "Dólar estadounidense", symbol: "$" },
];

const steps = ["Identidad", "Seguridad", "Parámetros"];

const stepMeta = [
  {
    title: "Identidad",
    subtitle: "Cuéntanos sobre tu negocio",
  },
  {
    title: "Seguridad",
    subtitle: `Crea un NIP de ${PIN_MIN}${PIN_LENGTH > PIN_MIN ? ` a ${PIN_LENGTH}` : ""} dígitos y confírmalo. Lo usarás para iniciar sesión como administrador.`,
  },
  {
    title: "Parámetros",
    subtitle: "Elige tu moneda principal y verifica la información.",
  },
];

const showcase = [
  {
    icon: Zap,
    label: "Cobro Ágil",
    title: "Rápido e Intuitivo",
    phrase:
      "Diseñado para agilizar tus cobros diarios y mantener el control total de tu tienda sin complicaciones.",
  },
  {
    icon: Lock,
    label: "Protección de Caja",
    title: "Seguridad y Control",
    phrase:
      "Protege las operaciones críticas de caja con un acceso rápido y seguro mediante NIP de administrador.",
  },
  {
    icon: Rocket,
    label: "Listo para Vender",
    title: "Listo para Operar",
    phrase:
      "Configuración moderna y optimizada para ofrecerte la máxima estabilidad en el trabajo diario.",
  },
];

const Field = ({ label, required, error, children }) => (
  <div>
    <Label className="mb-1.5 block text-[13px] font-semibold text-foreground">
      {label}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </Label>
    {children}
    {error && <p className="mt-1.5 animate-in fade-in text-xs font-medium text-destructive">{error}</p>}
  </div>
);

const PinBoxes = ({ value, onValueChange, show, error, groupLabel }) => {
  const cellRefs = useRef([]);
  const prevLenRef = useRef(value.length);
  const visibleCount = Math.max(PIN_VISIBLE_MIN, Math.min(PIN_LENGTH, value.length));

  useEffect(() => {
    const len = value.length;
    if (len > prevLenRef.current && len <= PIN_LENGTH) {
      cellRefs.current[Math.min(len - 1, PIN_LENGTH - 1)]?.focus();
    }
    prevLenRef.current = len;
  }, [value]);

  const handleChange = (idx, raw) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    const isLastFilled = idx === value.length - 1 && !!value[idx];
    const next = isLastFilled
      ? (value + digit).slice(0, PIN_LENGTH)
      : value.slice(0, idx) + digit + value.slice(idx + 1);
    onValueChange(next);
    if (!isLastFilled && next.length < PIN_LENGTH) cellRefs.current[idx + 1]?.focus();
  };

  const handleKey = (idx, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (value[idx]) {
        onValueChange(value.slice(0, idx) + value.slice(idx + 1));
        cellRefs.current[Math.min(idx, value.length - 2)]?.focus();
      } else if (idx > 0) {
        cellRefs.current[idx - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      cellRefs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < PIN_LENGTH - 1) {
      e.preventDefault();
      cellRefs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const clean = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (!clean) return;
    onValueChange(clean);
    cellRefs.current[Math.min(clean.length - 1, PIN_LENGTH - 1)]?.focus();
  };

  return (
    <>
      <div className="flex items-center justify-center gap-2" role="group" aria-label={groupLabel}>
        {Array.from({ length: visibleCount }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            type={show ? "text" : "password"}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            autoComplete="one-time-code"
            value={value[i] || ""}
            onFocus={(e) => e.target.select()}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKey(i, e)}
            onPaste={handlePaste}
            aria-label={`${groupLabel}, dígito ${i + 1}`}
            className={cn(
              "h-16 w-12 rounded-lg border-2 border-border bg-field text-center text-2xl font-bold text-foreground shadow-sm outline-none transition-transform duration-150 will-change-transform",
              "focus:scale-[1.06] focus:border-primary focus:ring-1 focus:ring-primary",
              error && "border-destructive"
            )}
          />
        ))}
      </div>
      {error && (
        <p className="mt-3 animate-in fade-in text-xs font-medium text-destructive">{error}</p>
      )}
    </>
  );
};

const SetupWizardScreen = ({ open, isPreviewMode = false, onComplete, onClose }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState({
    storeName: "",
    ownerName: "",
    phone: "",
    address: "",
    adminPin: "",
    confirmPin: "",
    currency: "MXN",
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaderPhase, setLoaderPhase] = useState("starting");
  const [progress, setProgress] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  const storeNameRef = useRef(null);
  const loadTimersRef = useRef([]);

  const clearLoadTimers = () => {
    loadTimersRef.current.forEach((t) => window.clearTimeout(t));
    loadTimersRef.current = [];
  };

  const activeIndex = activeStep;
  const selectedCurrency =
    CURRENCIES.find((c) => c.code === formData.currency) ?? CURRENCIES[0];

  const panelClassName = (idx) =>
    cn(
      "absolute inset-0 transition-[transform,opacity] duration-300 ease-out will-change-transform",
      idx === activeIndex
        ? "z-10 translate-x-0 opacity-100"
        : idx < activeIndex
          ? "z-0 -translate-x-8 opacity-0 pointer-events-none"
          : "z-0 translate-x-8 opacity-0 pointer-events-none"
    );

  const stepState = (idx) =>
    idx < activeStep ? "done" : idx === activeStep ? "active" : "todo";

  useEffect(() => {
    if (open) {
      setActiveStep(0);
      setErrors({});
      setShowPin(false);
      setLoading(false);
      setLoaderPhase("starting");
      setProgress(0);
      setIsExiting(false);
      clearLoadTimers();
    } else {
      clearLoadTimers();
      setLoading(false);
      setLoaderPhase("starting");
      setProgress(0);
      setIsExiting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (activeStep === 0) storeNameRef.current?.focus();
    }, 240);
    return () => window.clearTimeout(t);
  }, [open, activeStep]);

  useEffect(() => () => clearLoadTimers(), []);

  const validateStep = (step) => {
    const nextErrors = {};
    if (step === 0) {
      if (!formData.storeName.trim()) nextErrors.storeName = "El nombre de la tienda es requerido";
      if (!formData.ownerName.trim()) nextErrors.ownerName = "El nombre del propietario es requerido";
      if (formData.phone.trim() && !/^[\d\s()+-]{7,}$/.test(formData.phone.trim())) {
        nextErrors.phone = "Ingresa un teléfono válido";
      }
    }
    if (step === 1) {
      const pin = formData.adminPin;
      const confirm = formData.confirmPin;
      if (!pin) nextErrors.adminPin = "Ingresa tu NIP";
      else if (pin.length !== PIN_LENGTH) nextErrors.adminPin = `El NIP debe tener ${PIN_LENGTH} dígitos`;
      else if (!/^\d+$/.test(pin)) nextErrors.adminPin = "Solo números permitidos";
      if (new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
        if (!confirm) nextErrors.confirmPin = "Confirma tu NIP";
        else if (confirm !== pin) nextErrors.confirmPin = "Los NIP no coinciden";
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const setField = (key) => (value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      if (next[key]) next[key] = null;
      if (key === "adminPin" && next.confirmPin) next.confirmPin = null;
      return next;
    });
  };

  const handleFieldChange = (field) => (e) => setField(field)(e.target.value);

  const handleNext = () => {
    if (validateStep(activeStep)) setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => setActiveStep((prev) => prev - 1);

  const handlePanelEnter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (isSubmitting || loading) return;
    if (activeStep === 2) handleFinish();
    else if (validateStep(activeStep)) handleNext();
  };

  const handleFinish = async () => {
    if (!formData.storeName.trim() || !formData.ownerName.trim()) {
      setErrors({
        storeName: formData.storeName.trim() ? null : "El nombre de la tienda es requerido",
        ownerName: formData.ownerName.trim() ? null : "El nombre del propietario es requerido",
      });
      setActiveStep(0);
      return;
    }
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(formData.adminPin)) {
      setErrors({ adminPin: `El NIP debe tener ${PIN_LENGTH} dígitos` });
      setActiveStep(1);
      return;
    }
    if (formData.confirmPin !== formData.adminPin) {
      setErrors({ confirmPin: "Los NIP no coinciden" });
      setActiveStep(1);
      return;
    }

    const setupData = {
      storeName: formData.storeName.trim(),
      ownerName: formData.ownerName.trim(),
      address: formData.address.trim(),
      phone: formData.phone.trim(),
      currency: formData.currency,
      adminPin: formData.adminPin,
    };

    setIsSubmitting(true);
    try {
      if (!isPreviewMode) {
        await window.api.invoke("save-setting", "store_name", setupData.storeName);
        await window.api.invoke("save-setting", "owner_name", setupData.ownerName);
        await window.api.invoke("save-setting", "store_address", setupData.address);
        await window.api.invoke("save-setting", "store_phone", setupData.phone);
        await window.api.invoke("save-setting", "currency", setupData.currency);
        await window.api.invoke("save-setting", "setup_completed", "true");
        await window.api.invoke("add-cashier", {
          name: setupData.ownerName,
          pin: setupData.adminPin,
          role: "admin",
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      clearLoadTimers();
      setLoading(true);
      setLoaderPhase("starting");
      setProgress(0);
      loadTimersRef.current = [
        window.setTimeout(() => setProgress(100), 50),
        window.setTimeout(() => setLoaderPhase("configuring"), 800),
        window.setTimeout(() => setLoaderPhase("done"), 1600),
        window.setTimeout(() => setIsExiting(true), 2200),
        window.setTimeout(() => onComplete?.(setupData), 2500),
      ];
    } catch (error) {
      console.error("Error saving setup:", error);
      setErrors((prev) => ({ ...prev, submit: "Error al guardar la configuración, inténtalo de nuevo" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (!isSubmitting && !loading && onClose) {
      setActiveStep(0);
      onClose();
    }
  };

  const handleOpenChange = (next) => {
    if (!next && isPreviewMode) onClose?.();
  };

  const preventOutside = (e) => {
    if (!isPreviewMode) e.preventDefault();
  };

  const AccentIcon = showcase[activeStep].icon;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName={cn(
          "transition-opacity duration-300 ease-out",
          isExiting && "opacity-0"
        )}
        className={cn(
          "setup-wizard-dialog !flex h-screen w-full !max-w-none items-stretch !gap-0 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none overflow-hidden transition-opacity duration-300 ease-out",
          !isPreviewMode && "[&>button]:hidden",
          isExiting && "opacity-0 pointer-events-none"
        )}
        onPointerDownOutside={preventOutside}
        onEscapeKeyDown={preventOutside}
      >
        <DialogTitle className="sr-only">Configuración inicial de VENDIA</DialogTitle>
        <DialogDescription className="sr-only">
          Asistente de configuración del sistema de ventas
        </DialogDescription>

        {/* ============ PANEL IZQUIERDO: SHOWCASE VENDIA ============ */}
        <aside className="relative flex w-[420px] shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-b from-slate-950 to-slate-900 px-10 py-10 text-white">
          <div className="pointer-events-none absolute -top-24 -right-20 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl" />

          <header className="relative text-center">
            <p className="text-2xl font-extrabold uppercase leading-none tracking-[5px] text-white text-display">
              VENDIA
            </p>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-[2px] text-white/50">
              Sistema de Punto de Venta
            </p>
          </header>

          <div className="relative -my-4 flex flex-1 items-center justify-center">
            <div
              key={activeStep}
              className="animate-in fade-in zoom-in-95 duration-500 ease-out flex flex-col items-center gap-4 text-center"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">
                <AccentIcon size={12} />
                {showcase[activeStep].label}
              </span>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                {showcase[activeStep].title}
              </h2>
              <p className="max-w-[300px] text-sm leading-relaxed text-white/55">
                {showcase[activeStep].phrase}
              </p>
            </div>
          </div>

          <footer className="relative text-center text-[10px] font-semibold uppercase tracking-[2px] text-white/30">
            POWERED BY JRP CORE v1.0
          </footer>
        </aside>

        {/* ============ PANEL DERECHO: FORMULARIO ============ */}
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-14 py-12">
            {errors.submit && (
              <Alert variant="destructive" className="mb-4 animate-in fade-in">
                <AlertDescription className="font-semibold">{errors.submit}</AlertDescription>
              </Alert>
            )}

            {loading ? (
              <div className="m-auto flex w-full max-w-sm animate-in fade-in zoom-in-95 duration-500 ease-out flex-col items-center gap-5 py-6 text-center">
                <div className="relative">
                  <div className="pointer-events-none absolute -inset-5 rounded-full bg-primary/15 blur-2xl" />
                  {loaderPhase !== "done" ? (
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-black/20">
                      <Settings size={28} className="animate-setup-gear" />
                    </div>
                  ) : (
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
                      <CheckCircle2 size={40} className="setup-check-scale text-success" />
                    </div>
                  )}
                </div>

                <div key={loaderPhase} className="animate-in fade-in">
                  <h3 className="text-xl font-extrabold tracking-tight text-foreground">
                    {loaderPhase === "starting" && "Inicializando VENDIA..."}
                    {loaderPhase === "configuring" && "Configurando Sistema..."}
                    {loaderPhase === "done" && "¡Todo Listo!"}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {loaderPhase === "starting" && "Preparando tu punto de venta..."}
                    {loaderPhase === "configuring" && "Guardando datos de la tienda y clave de acceso..."}
                    {loaderPhase === "done" && "Entrando a tu caja de cobro..."}
                  </p>
                </div>

                <Progress
                  value={progress}
                  indicatorClassName="bg-primary transition-transform duration-[2200ms] ease-out"
                  className="h-1.5"
                />

                <p className="mt-2 text-[10px] font-semibold uppercase tracking-[2px] text-muted-foreground/60">
                  POWERED BY JRP CORE
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {steps.map((label, i) => {
                    const state = stepState(i);
                    return (
                      <Fragment key={label}>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-200",
                            state === "done" && "bg-success/15 text-success",
                            state === "active" && "bg-primary text-primary-foreground shadow-sm",
                            state === "todo" && "bg-muted text-muted-foreground"
                          )}
                        >
                          {i + 1}. {label}
                        </span>
                        {i < steps.length - 1 && <span className="h-px w-5 bg-border" />}
                      </Fragment>
                    );
                  })}
                </div>

                <h2 className="mt-4 text-[24px] font-extrabold tracking-tight text-foreground">
                  {stepMeta[activeStep].title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{stepMeta[activeStep].subtitle}</p>

                <div className="relative mt-8 min-h-[420px] overflow-hidden">
                  <div className={panelClassName(0)}>
                    <div className="space-y-4" onKeyDown={handlePanelEnter}>
                      <Field label="Nombre de la Tienda" required error={errors.storeName}>
                        <InputGroup
                          className={cn(
                            errors.storeName &&
                              "!border-destructive focus-within:!border-destructive focus-within:!ring-destructive"
                          )}
                        >
                          <Store size={18} data-icon="inline-start" className="text-muted-foreground" />
                          <InputGroupInput
                            ref={storeNameRef}
                            className="h-11"
                            placeholder="Ej: Mi Super Tienda"
                            value={formData.storeName}
                            onChange={handleFieldChange("storeName")}
                          />
                        </InputGroup>
                      </Field>

                      <Field label="Propietario" required error={errors.ownerName}>
                        <InputGroup
                          className={cn(
                            errors.ownerName &&
                              "!border-destructive focus-within:!border-destructive focus-within:!ring-destructive"
                          )}
                        >
                          <User size={18} data-icon="inline-start" className="text-muted-foreground" />
                          <InputGroupInput
                            className="h-11"
                            placeholder="Tu nombre completo"
                            value={formData.ownerName}
                            onChange={handleFieldChange("ownerName")}
                          />
                        </InputGroup>
                      </Field>

                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Teléfono" error={errors.phone}>
                          <InputGroup
                            className={cn(
                              errors.phone &&
                                "!border-destructive focus-within:!border-destructive focus-within:!ring-destructive"
                            )}
                          >
                            <Phone size={18} data-icon="inline-start" className="text-muted-foreground" />
                            <InputGroupInput
                              className="h-11"
                              type="tel"
                              placeholder="Ej: 55 1234 5678"
                              value={formData.phone}
                              onChange={handleFieldChange("phone")}
                            />
                          </InputGroup>
                        </Field>
                        <Field label="Dirección">
                          <InputGroup>
                            <MapPin size={18} data-icon="inline-start" className="text-muted-foreground" />
                            <InputGroupInput
                              className="h-11"
                              placeholder="Calle Principal 123"
                              value={formData.address}
                              onChange={handleFieldChange("address")}
                            />
                          </InputGroup>
                        </Field>
                      </div>
                    </div>
                  </div>

                  <div className={panelClassName(1)}>
                    <div className="flex min-h-0 flex-col items-center overflow-y-auto px-1 py-2 text-center" onKeyDown={handlePanelEnter}>
                      <div className="m-auto w-full max-w-md">
                        <div className="mb-4 flex items-center justify-center gap-2">
                          <Lock size={16} className="text-muted-foreground" />
                          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            NIP de administrador
                          </p>
                        </div>
                        <PinBoxes
                          value={formData.adminPin}
                          onValueChange={setField("adminPin")}
                          show={showPin}
                          error={errors.adminPin}
                          groupLabel="NIP de administrador"
                        />

                        <Separator className="mx-auto my-6 w-44" />

                        <div className="mb-4 flex items-center justify-center gap-2">
                          <Lock size={16} className="text-muted-foreground" />
                          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Confirma tu NIP
                          </p>
                        </div>
                        <PinBoxes
                          value={formData.confirmPin}
                          onValueChange={setField("confirmPin")}
                          show={showPin}
                          error={errors.confirmPin}
                          groupLabel="Confirmación de NIP"
                        />

                        <button
                          type="button"
                          onClick={() => setShowPin(!showPin)}
                          className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                          {showPin ? "Ocultar NIP" : "Mostrar NIP"}
                        </button>
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          Puedes pegar o escribir los dígitos directamente
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={panelClassName(2)}>
                    <div onKeyDown={handlePanelEnter}>
                      <Field label="Moneda principal" required>
                        <InputGroup>
                          <Coins size={18} data-icon="inline-start" className="text-muted-foreground" />
                          <Select
                            value={formData.currency}
                            onValueChange={(value) => {
                              setFormData((prev) => ({ ...prev, currency: value }));
                              if (errors.submit) setErrors((prev) => ({ ...prev, submit: null }));
                            }}
                          >
                            <SelectTrigger className="h-11 w-full border-none bg-transparent shadow-none focus-visible:ring-0">
                              <SelectValue placeholder="Selecciona tu moneda" />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>
                                  {c.label} ({c.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </InputGroup>
                      </Field>

                      <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
                        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Resumen de confirmación
                        </p>
                        <div className="space-y-2.5 text-sm">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">Tienda</span>
                            <span className="truncate font-semibold text-foreground">{formData.storeName}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">Propietario</span>
                            <span className="truncate font-semibold text-foreground">{formData.ownerName}</span>
                          </div>
                          {formData.phone && (
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="shrink-0 text-muted-foreground">Teléfono</span>
                              <span className="truncate font-semibold text-foreground">{formData.phone}</span>
                            </div>
                          )}
                          {formData.address && (
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="shrink-0 text-muted-foreground">Dirección</span>
                              <span className="truncate font-semibold text-foreground">{formData.address}</span>
                            </div>
                          )}
                          <Separator className="my-1" />
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">Moneda</span>
                            <span className="truncate font-semibold text-foreground">
                              {selectedCurrency.label} ({selectedCurrency.code})
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {!loading && (
            <footer className="flex shrink-0 items-center justify-between border-t border-border bg-background px-8 py-5">
              <div className="flex min-w-0 flex-1 justify-start">
                {activeStep === 0 ? (
                  onClose && !isSubmitting && (
                    <CancelButton onClick={handleCancel}>Cancelar</CancelButton>
                  )
                ) : (
                  <Button variant="ghost" onClick={handleBack} disabled={isSubmitting}>
                    <ChevronLeft size={16} />
                    Atrás
                  </Button>
                )}
              </div>
              <div className="flex min-w-0 flex-1 justify-end">
                {activeStep < 2 ? (
                  <Button
                    onClick={handleNext}
                    disabled={isSubmitting}
                    className="h-11 px-8 text-base"
                  >
                    Siguiente
                    <ChevronRight size={18} />
                  </Button>
                ) : (
                  <Button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="h-11 min-w-[168px] px-8 text-base"
                  >
                    Inicializar Sistema
                  </Button>
                )}
              </div>
            </footer>
          )}
        </main>
      </DialogContent>
    </Dialog>
  );
};

export default SetupWizardScreen;