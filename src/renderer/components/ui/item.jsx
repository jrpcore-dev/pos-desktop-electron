import * as React from "react";

import { cn } from "@/lib/utils";

const itemVariants = {
  default: "flex items-center gap-3 bg-card",
  muted: "flex items-center gap-3 bg-muted",
  outline: "flex items-center gap-3 border border-border bg-card",
};

const Item = React.forwardRef(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item"
    className={cn(
      "w-full rounded-lg px-3 py-2.5 text-foreground",
      itemVariants[variant],
      "[&_[data-icon=inline-start]]:mr-1.5",
      "[&_[data-icon=inline-end]]:ml-1.5",
      className
    )}
    {...props}
  />
));
Item.displayName = "Item";

const ItemMedia = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-media"
    className={cn("flex shrink-0 items-center self-start", className)}
    {...props}
  />
));
ItemMedia.displayName = "ItemMedia";

const ItemContent = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-content"
    className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
    {...props}
  />
));
ItemContent.displayName = "ItemContent";

const ItemTitle = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="item-title"
    className={cn("text-sm font-medium leading-snug", className)}
    {...props}
  />
));
ItemTitle.displayName = "ItemTitle";

export { Item, ItemMedia, ItemContent, ItemTitle };
