import * as React from "react";

import { cn } from "@/lib/utils";

const EmptyState = React.forwardRef(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground/70">
          {icon}
        </div>
      )}
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      {description && (
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
