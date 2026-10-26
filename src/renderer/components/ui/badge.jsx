import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Las variantes sólidas (default/destructive/success/warning) usan el par
// token + foreground de index.css, que ya pasa contraste en claro y oscuro.
// Las `soft-*` son la forma preferida para estados en tablas y tarjetas:
// fondo tenue, texto del color del estado y un borde sutil del mismo tono.
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-success text-success-foreground shadow hover:bg-success/85",
        warning:
          "border-transparent bg-warning text-warning-foreground shadow hover:bg-warning/85",
        "soft-success": "border-success/25 bg-success/10 text-success",
        "soft-warning":
          "border-warning/30 bg-warning/12 text-amber-700 dark:text-warning",
        "soft-destructive":
          "border-destructive/25 bg-destructive/10 text-destructive dark:text-red-400",
        "soft-info": "border-info/25 bg-info/10 text-sky-700 dark:text-info",
        "soft-neutral": "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
