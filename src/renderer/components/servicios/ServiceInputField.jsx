import { CircleCheck, Hash, Smartphone, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// Celular de 10 dígitos: se ve "999 123 4567" pero el valor sigue siendo
// sólo dígitos (lo que valida `validateInput` y recibe el Host).
const formatPhone = (digits, spec) => {
  if (!spec.numeric || spec.max !== 10) return digits;
  const d = String(digits || "");
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(" ");
};

const fieldClass = (tone) =>
  cn(
    "h-12 w-full rounded-xl border bg-field pl-10 pr-14 text-lg font-semibold tabular-nums tracking-wide shadow-sm transition-colors",
    "placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/80",
    "focus-visible:outline-none focus-visible:ring-4",
    tone === "error"
      ? "border-destructive focus-visible:ring-destructive/15"
      : tone === "ok"
        ? "border-success focus-visible:ring-success/15"
        : "border-input focus-visible:border-primary focus-visible:ring-primary/15",
  );

const ServiceInputField = ({
  spec,
  value,
  onChange,
  confirm,
  onConfirmChange,
  error,
  inputRef,
  confirmRef,
  onComplete,
}) => {
  if (!spec || spec.kind === "none") return null;

  const needsConfirm = spec.confirmar !== false;
  const matched = !!confirm && confirm === value;
  const mismatch = !!confirm && confirm.length >= value.length && !matched;
  // Referencias alfanuméricas (tags IAVE/Televía): mayúsculas y sin espacios,
  // como vienen impresas.
  const clean = (raw) =>
    spec.numeric
      ? raw.replace(/\D/g, "").slice(0, spec.max)
      : raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, spec.max);
  const FieldIcon = spec.numeric ? Smartphone : Hash;
  const noun = spec.numeric ? "número" : "dato";
  const complete = (v) => v.length >= spec.min && v.length <= spec.max;

  const handleMain = (raw) => {
    const v = clean(raw);
    onChange(v);
    // Al llenar el número se pasa solo a "Confirmar" (o al siguiente paso).
    if (v.length === spec.max && v !== value) {
      if (needsConfirm) requestAnimationFrame(() => confirmRef?.current?.focus());
      else onComplete?.();
    }
  };

  const handleConfirm = (raw) => {
    const v = clean(raw);
    onConfirmChange(v);
    if (v === value && complete(v)) onComplete?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <FieldIcon
          size={17}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-primary"
        />
        <input
          id="service-input"
          ref={inputRef}
          type="text"
          inputMode={spec.numeric ? "numeric" : "text"}
          autoComplete="off"
          placeholder={spec.alnum ? spec.placeholder : spec.label || spec.placeholder}
          aria-label={spec.label}
          value={formatPhone(value, spec)}
          onChange={(e) => handleMain(e.target.value)}
          className={fieldClass(error ? "error" : undefined)}
          aria-invalid={!!error}
          aria-describedby="service-input-msg"
        />
        <span
          className={cn(
            "pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums",
            complete(value) ? "text-success" : "text-muted-foreground",
          )}
        >
          {value.length}/{spec.max}
        </span>
      </div>

      {needsConfirm && (
        <div className="relative">
          {matched ? (
            <CircleCheck
              size={17}
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-success"
            />
          ) : (
            <FieldIcon
              size={17}
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          )}
          <input
            id="service-confirm"
            ref={confirmRef}
            type="text"
            inputMode={spec.numeric ? "numeric" : "text"}
            autoComplete="off"
            placeholder={`Repite el ${noun} para confirmar`}
            aria-label={`Confirmar ${noun}`}
            value={formatPhone(confirm, spec)}
            onChange={(e) => handleConfirm(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            className={fieldClass(mismatch ? "error" : matched ? "ok" : undefined)}
            aria-invalid={mismatch}
            aria-describedby="service-input-msg"
          />
          {matched && (
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-success">
              Coincide
            </span>
          )}
        </div>
      )}

      <p id="service-input-msg" aria-live="polite" className="min-h-4 px-0.5">
        {error ? (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert size={12} aria-hidden />
            {error}
          </span>
        ) : mismatch ? (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert size={12} aria-hidden />
            {spec.numeric ? "Los números no coinciden" : "Los datos no coinciden"}
          </span>
        ) : (
          spec.hint && <span className="text-xs text-muted-foreground">{spec.hint}</span>
        )}
      </p>
    </div>
  );
};

export default ServiceInputField;
