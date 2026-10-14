import { CircleCheck, TriangleAlert } from "lucide-react";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";

const ServiceInputField = ({
  spec,
  value,
  onChange,
  confirm,
  onConfirmChange,
  error,
  autoFocus,
}) => {
  if (!spec || spec.kind === "none") return null;

  const matched = !!confirm && confirm === value;
  const digitsOnly = (raw) =>
    spec.numeric ? raw.replace(/\D/g, "").slice(0, spec.max) : raw;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="service-input"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {spec.label}
          </label>
          <Input
            id="service-input"
            type="text"
            inputMode={spec.numeric ? "numeric" : "tel"}
            autoComplete="off"
            placeholder={spec.placeholder}
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => onChange(digitsOnly(e.target.value))}
            className={cn(
              "h-12 text-base tabular-nums",
              error &&
                "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/40",
            )}
            aria-invalid={!!error}
            aria-describedby="service-input-msg"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="service-confirm"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Confirmar
          </label>
          <Input
            id="service-confirm"
            type="text"
            inputMode={spec.numeric ? "numeric" : "tel"}
            autoComplete="off"
            placeholder="Repite el dato"
            value={confirm}
            onChange={(e) => onConfirmChange(digitsOnly(e.target.value))}
            className={cn(
              "h-12 text-base tabular-nums",
              matched &&
                "border-success focus-visible:border-success focus-visible:ring-success/40",
            )}
            aria-invalid={!!confirm && !matched}
            aria-describedby="service-input-msg"
          />
        </div>
      </div>

      <p id="service-input-msg" aria-live="polite" className="min-h-4">
        {error ? (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert size={12} aria-hidden />
            {error}
          </span>
        ) : matched ? (
          <span className="flex items-center gap-1 text-xs font-medium text-success">
            <CircleCheck size={12} aria-hidden />
            Coincide
          </span>
        ) : (
          spec.hint && (
            <span className="text-xs text-muted-foreground">{spec.hint}</span>
          )
        )}
      </p>
    </div>
  );
};

export default ServiceInputField;