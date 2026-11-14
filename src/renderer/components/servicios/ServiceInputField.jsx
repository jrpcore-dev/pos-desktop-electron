import { useEffect, useRef, useState } from "react";
import { CircleCheck, Hash, ScanBarcode, Smartphone, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// Un lector de código de barras "teclea" muy rápido (pocos ms entre letras).
// Si llegan SCAN_MIN_CHARS seguidas a menos de SCAN_GAP_MS, es un escaneo.
const SCAN_GAP_MS = 40;
const SCAN_MIN_CHARS = 6;
// Lectores sin Enter al final: el escaneo se da por terminado tras esta pausa.
const SCAN_IDLE_MS = 150;
// Un código escaneado se guarda completo (hasta aquí) para poder avisar si
// trae más datos que la referencia, en vez de recortarlo en silencio.
const SCAN_MAX_CHARS = 64;

// Celular de 10 dígitos: se ve "999 123 4567" pero el valor sigue siendo
// sólo dígitos (lo que valida `validateInput` y recibe el Host).
const formatPhone = (digits, spec) => {
  if (!spec.numeric || spec.max !== 10) return digits;
  const d = String(digits || "");
  if (d.length > 10) return d;
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
        : "border-input focus-visible:border-ring focus-visible:ring-ring/15",
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
  known = false,
}) => {
  const burst = useRef({ last: 0, count: 0, scanning: false });
  const idleTimer = useRef(null);
  const [scannedValue, setScannedValue] = useState("");
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  if (!spec || spec.kind === "none") return null;

  const scanned = !!scannedValue && scannedValue === value;
  const tooLong = value.length > spec.max;
  // Un número que ya se recargó con éxito, o que leyó el escáner, no se pide
  // dos veces.
  const needsConfirm = spec.confirmar !== false && !known && !scanned;
  const matched = !!confirm && confirm === value;
  const mismatch = !!confirm && confirm.length >= value.length && !matched;
  // Referencias alfanuméricas (tags IAVE/Televía): mayúsculas y sin espacios,
  // como vienen impresas. Tecleando no se pasa del máximo; escaneando se
  // guarda todo, para que un código más largo que la referencia se note (y no
  // se pague a otra cuenta por recortarlo).
  const clean = (raw, limit = spec.max) =>
    spec.numeric
      ? raw.replace(/\D/g, "").slice(0, limit)
      : raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, limit);
  const FieldIcon = spec.numeric ? Smartphone : Hash;
  const noun = spec.numeric ? "número" : "dato";
  const complete = (v) => v.length >= spec.min && v.length <= spec.max;

  // Termina un escaneo: lo leído por máquina no necesita confirmarse. Sólo el
  // Enter del lector avanza de paso; si el lector no manda Enter, el dato se
  // queda listo y el cajero sigue (así ningún Enter tardío cae en «Cobrar»).
  const finishScan = (raw, { advance }) => {
    clearTimeout(idleTimer.current);
    burst.current = { last: 0, count: 0, scanning: false };
    const v = clean(raw, SCAN_MAX_CHARS);
    if (!v) return;
    setScannedValue(v);
    if (v !== value) onChange(v);
    if (complete(v)) {
      onConfirmChange?.(v);
      if (advance) onComplete?.();
    }
  };

  const handleKeyDown = (e) => {
    const b = burst.current;
    if (e.key === "Enter") {
      // El Enter del lector nunca envía el cobro.
      if (b.scanning) {
        e.preventDefault();
        finishScan(e.currentTarget.value, { advance: true });
      }
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = performance.now();
    b.count = now - b.last < SCAN_GAP_MS ? b.count + 1 : 1;
    b.last = now;
    if (b.count >= SCAN_MIN_CHARS) b.scanning = true;
    if (b.scanning) {
      const input = e.currentTarget;
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(
        () => finishScan(input.value, { advance: false }),
        SCAN_IDLE_MS,
      );
    }
  };

  const handleMain = (raw) => {
    const scanning = burst.current.scanning;
    const v = clean(raw, scanning || tooLong ? SCAN_MAX_CHARS : spec.max);
    onChange(v);
    if (!scanning && scannedValue && v !== scannedValue) setScannedValue("");
    // Al llenar el número se pasa solo a "Confirmar" (o al siguiente paso).
    // Escaneando no: el código puede venir más largo y se decide al final.
    if (!scanning && v.length === spec.max && v !== value) {
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
          onKeyDown={handleKeyDown}
          className={fieldClass(error || tooLong ? "error" : undefined)}
          aria-invalid={!!error || tooLong}
          aria-describedby="service-input-msg"
        />
        <span
          className={cn(
            "pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums",
            tooLong
              ? "text-destructive"
              : complete(value)
                ? "text-success"
                : "text-muted-foreground",
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
        {tooLong ? (
          <span className="flex items-start gap-1 text-xs font-medium text-destructive">
            <TriangleAlert size={12} aria-hidden className="mt-0.5 shrink-0" />
            El código trae {value.length} {spec.numeric ? "dígitos" : "caracteres"} y aquí
            se piden {spec.max}. Escribe la referencia impresa en el recibo.
          </span>
        ) : scanned && !error ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-success">
            <ScanBarcode size={13} aria-hidden />
            Leído con escáner · no hace falta repetirlo
          </span>
        ) : known && !error ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-success">
            <CircleCheck size={13} aria-hidden />
            Número ya usado · no hace falta repetirlo
          </span>
        ) : error ? (
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
