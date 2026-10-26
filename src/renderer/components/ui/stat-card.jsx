import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";
import { Hint } from "./hint";

/* ────────────────────────────────────────────────────────────
   StatCard: tarjeta de métrica.
   Distribución: etiqueta arriba, cifra grande debajo y una línea final con
   el chip de variación + contexto. El ícono va en grande, tenue y girado
   en la esquina inferior derecha, como marca de agua detrás de los datos.

   - `tone`: color de la marca de agua; sólo tokens de la paleta
     (primary, success, warning, destructive, info).
   - `hero`: métrica protagonista (una por pantalla); fondo `primary` de la
     paleta (marino en claro, azul en oscuro) con su `primary-foreground`.
   - `size`: "lg" para métricas principales, "sm" para secundarias.
   - `prominent`: título un paso más grande y cifra más grande (pantallas de
     operación: corte, transacciones, inventario, movimientos).
──────────────────────────────────────────────────────────── */

const WATERMARK = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
};

// Borde al pasar el ratón: toma el color de la tarjeta.
const HOVER_BORDER = {
  primary: "hover:border-primary/40",
  success: "hover:border-success/40",
  warning: "hover:border-warning/50",
  destructive: "hover:border-destructive/40",
  info: "hover:border-info/40",
};

// Tarjeta usada como filtro y activa: borde y anillo del color de la tarjeta
// más un fondo muy tenue del mismo tono.
const ACTIVE = {
  primary: "border-primary ring-2 ring-primary/25 bg-primary/[0.04]",
  success: "border-success ring-2 ring-success/25 bg-success/[0.05]",
  warning: "border-warning ring-2 ring-warning/30 bg-warning/[0.06]",
  destructive: "border-destructive ring-2 ring-destructive/25 bg-destructive/[0.05]",
  info: "border-info ring-2 ring-info/25 bg-info/[0.05]",
};

function DeltaChip({ value, invert, onHero }) {
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        onHero
          ? "bg-primary-foreground/15 text-primary-foreground"
          : good
            ? "bg-success/12 text-success"
            : "bg-destructive/10 text-destructive dark:text-red-400"
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {Math.abs(Math.round(value))}%
    </span>
  );
}

const StatCard = React.forwardRef(
  (
    {
      className,
      label,
      value,
      icon,
      tone = "primary",
      hero = false,
      delta,
      invert,
      caption,
      size = "lg",
      prominent = false,
      loading = false,
      onClick,
      active = false,
      // Texto del tooltip (p. ej. qué hace la tarjeta al pulsarla).
      hint,
      ...props
    },
    ref
  ) => {
    const lg = size === "lg";
    const hasDelta = typeof delta === "number" && Number.isFinite(delta);
    // Con onClick la tarjeta es un botón (filtro); `active` marca el filtro
    // aplicado y se anuncia con aria-pressed.
    const Comp = onClick ? "button" : "div";
    const card = (
      <Comp
        ref={ref}
        {...(onClick
          ? { type: "button", onClick, "aria-pressed": active }
          : {})}
        className={cn(
          "relative isolate flex min-w-0 flex-col justify-between overflow-hidden rounded-xl border transition-all duration-200 hover:-translate-y-0.5",
          lg ? "min-h-[8.5rem] gap-4 p-5" : prominent ? "gap-2 px-4 py-3" : "gap-3 p-4",
          hero
            ? "border-transparent bg-primary text-primary-foreground shadow-[0_12px_28px_-12px_hsl(var(--primary)/0.6)] hover:shadow-[0_16px_32px_-12px_hsl(var(--primary)/0.75)]"
            : cn(
                "bg-card text-card-foreground shadow-sm hover:shadow-md",
                HOVER_BORDER[tone] || HOVER_BORDER.primary
              ),
          onClick &&
            "w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          active && !hero && (ACTIVE[tone] || ACTIVE.primary),
          className
        )}
        {...props}
      >
        {icon && (
          // Marca de agua: el ícono en grande, girado y recortado en la
          // esquina inferior derecha (el giro hace que el corte se lea
          // intencional).
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -z-10",
              lg
                ? "-bottom-6 -right-5 -rotate-12 [&_svg]:size-[7.5rem]"
                : "-bottom-5 -right-4 -rotate-12 [&_svg]:size-[5.5rem]",
              hero
                ? "text-primary-foreground opacity-[0.16]"
                : cn(WATERMARK[tone] || WATERMARK.primary, "opacity-[0.20] dark:opacity-[0.24]")
            )}
          >
            {icon}
          </span>
        )}

        <p
          className={cn(
            "min-w-0 truncate font-medium",
            prominent
              ? cn("font-semibold", lg ? "text-base" : "text-sm")
              : lg ? "text-sm" : "text-xs",
            hero ? "text-primary-foreground/80" : "text-muted-foreground"
          )}
        >
          {label}
        </p>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className={cn(lg ? "h-8 w-36" : "h-6 w-24", hero && "bg-primary-foreground/20")} />
            <Skeleton className={cn("h-4 w-28", hero && "bg-primary-foreground/20")} />
          </div>
        ) : (
          <div className={cn("flex min-w-0 flex-col", lg ? "gap-2.5" : prominent ? "gap-1" : "gap-1.5")}>
            <p
              className={cn(
                "truncate font-bold leading-none tracking-tight tabular-nums",
                prominent
                  ? lg ? "text-4xl" : "text-3xl"
                  : lg ? "text-3xl" : "text-xl",
                hero ? "text-primary-foreground" : "text-foreground"
              )}
            >
              {value}
            </p>
            {(hasDelta || caption) && (
              <div className="flex min-w-0 items-center gap-2">
                {hasDelta && <DeltaChip value={delta} invert={invert} onHero={hero} />}
                {caption && (
                  <span
                    className={cn(
                      "truncate text-xs tabular-nums",
                      hero ? "text-primary-foreground/75" : "text-muted-foreground"
                    )}
                  >
                    {caption}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </Comp>
    );
    return hint ? <Hint label={hint}>{card}</Hint> : card;
  }
);
StatCard.displayName = "StatCard";

export { StatCard, DeltaChip };
