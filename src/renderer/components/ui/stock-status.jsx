import React from "react";

import { cn } from "@/lib/utils";

export const getStockStatus = (stock, minStock) => {
  const min = minStock || 5;
  if (stock === 0) return { label: "Agotado", tone: "err" };
  if (stock <= min) return { label: "Stock Bajo", tone: "warn" };
  return { label: "En Stock", tone: "ok" };
};

export const StockStatus = React.memo(({ label, tone }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "bg-warning",
        tone === "err" && "bg-destructive",
      )}
    />
    <span
      className={cn(
        "text-[12px] font-medium whitespace-nowrap",
        tone === "ok" && "text-success",
        tone === "warn" && "text-warning",
        tone === "err" && "text-destructive",
      )}
    >
      {label}
    </span>
  </span>
));
StockStatus.displayName = "StockStatus";