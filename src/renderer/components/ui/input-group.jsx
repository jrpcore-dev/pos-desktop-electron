import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "./input";

const InputGroup = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "group flex w-full items-center overflow-hidden rounded-lg border border-input bg-field shadow-sm transition-colors duration-150 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/50",
      "[&:has([data-icon=inline-start])]:pl-2.5",
      "[&:has([data-icon=inline-end])]:pr-2.5",
      "[&_[data-icon=inline-start]]:mr-1.5",
      "[&_[data-icon=inline-end]]:ml-1.5",
      className
    )}
    {...props}
  />
));
InputGroup.displayName = "InputGroup";

const InputGroupInput = React.forwardRef(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    className={cn(
      "h-9 w-full border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
      className
    )}
    {...props}
  />
));
InputGroupInput.displayName = "InputGroupInput";

const InputGroupText = React.forwardRef(
  ({ className, align = "inline-start", ...props }, ref) => (
    <span
      ref={ref}
      data-icon={align}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);
InputGroupText.displayName = "InputGroupText";

const InputGroupAddon = React.forwardRef(
  ({ className, align = "inline-start", children, ...props }, ref) => (
    <span
      ref={ref}
      data-icon={align}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
);
InputGroupAddon.displayName = "InputGroupAddon";

export { InputGroup, InputGroupInput, InputGroupAddon, InputGroupText };
