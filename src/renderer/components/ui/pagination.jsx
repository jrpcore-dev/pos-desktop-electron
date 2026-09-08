import * as React from "react";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

const Pagination = React.forwardRef(({ className, ...props }, ref) => (
  <nav
    ref={ref}
    className={cn(
      "flex flex-wrap items-center justify-between gap-3",
      className,
    )}
    aria-label="Paginación"
    {...props}
  />
));
Pagination.displayName = "Pagination";

const PaginationInfo = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs tabular-nums text-muted-foreground", className)}
    {...props}
  />
));
PaginationInfo.displayName = "PaginationInfo";

const PaginationControls = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-1.5", className)}
    {...props}
  />
));
PaginationControls.displayName = "PaginationControls";

const PaginationLabel = React.forwardRef(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("px-1 text-xs tabular-nums text-muted-foreground", className)}
    {...props}
  />
));
PaginationLabel.displayName = "PaginationLabel";

const PaginationButton = React.forwardRef(
  ({ className, label, icon, children, ...props }, ref) => (
    <Button
      ref={ref}
      variant="outline"
      size="sm"
      className={cn("h-8 gap-1 px-2.5 text-xs", className)}
      {...props}
    >
      {icon === "prev" && <ChevronLeft className="h-4 w-4" />}
      {children || label}
      {icon === "next" && <ChevronRight className="h-4 w-4" />}
    </Button>
  ),
);
PaginationButton.displayName = "PaginationButton";

export {
  Pagination,
  PaginationInfo,
  PaginationControls,
  PaginationLabel,
  PaginationButton,
};
