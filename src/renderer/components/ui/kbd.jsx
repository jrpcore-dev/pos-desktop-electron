import * as React from "react";

import { cn } from "@/lib/utils";

const Kbd = React.forwardRef(({ className, ...props }, ref) => (
  <kbd
    ref={ref}
    className={cn(
      "inline-flex h-6 select-none items-center gap-1 whitespace-nowrap rounded-md border border-border/80 bg-muted px-2 font-sans text-[11px] font-bold uppercase tracking-wide text-foreground shadow-[0_2px_0_hsl(var(--border))]",
      className
    )}
    {...props}
  />
));
Kbd.displayName = "Kbd";

const KbdGroup = React.forwardRef(({ className, children, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("inline-flex items-center gap-1", className)}
    {...props}
  >
    {React.Children.map(children, (child, index) => {
      if (!React.isValidElement(child)) {
        return index > 0 ? (
          <React.Fragment key={index}>
            <span className="text-[10px] text-current opacity-70">+</span>
            {child}
          </React.Fragment>
        ) : (
          child
        );
      }
      return index > 0 ? (
        <React.Fragment key={index}>
          <span className="text-[10px] text-current opacity-70">+</span>
          {child}
        </React.Fragment>
      ) : (
        child
      );
    })}
  </span>
));
KbdGroup.displayName = "KbdGroup";

export { Kbd, KbdGroup };
