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
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="service-input"
            className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
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
              "h-9 text-sm tabular-nums",
              error && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/40",
            )}
            aria-invalid={!!error}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="service-confirm"
            className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
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
              "h-9 text-sm tabular-nums",
              matched && "border-success focus-visible:border-success focus-visible:ring-success/40",
            )}
            aria-invalid={false}
          />
        </div>
      </div>

      {error ? (
        <p className="flex items-center gap-1 text-[11px] font-medium text-destructive">
          <TriangleAlert size={11} aria-hidden />
          {error}
        </p>
      ) : matched ? (
        <p className="flex items-center gap-1 text-[11px] font-medium text-success">
          <CircleCheck size={11} aria-hidden />
          Coincide
        </p>
      ) : (
        spec.hint && <p className="text-[11px] text-muted-foreground">{spec.hint}</p>
      )}
    </div>
  );
};

export default ServiceInputField;