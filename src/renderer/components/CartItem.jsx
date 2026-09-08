import React, { useState } from "react";

import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";
import {
  canManualDiscount,
  promoInfo,
  lineTotal,
  lineUnitPrice,
} from "../utils/cartMath";
import {
  Carrot,
  Package,
  Layers,
  Circle,
  Minus,
  Plus,
  Trash2,
  Percent,
} from "lucide-react";

const badgeBase =
  "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 h-[18px] text-[0.65rem] font-bold whitespace-nowrap [contain-intrinsic-size:auto_18px]";

const unitBadgeLabel = (item) => {
  if (item.isWeightItem) return { label: "kg", cls: "bg-primary/15 text-primary" };
  if (item.isBoxItem)
    return {
      label: unitLabels(item.sale_unit)?.badge || "caja",
      cls: "bg-success/10 text-success",
    };
  if (item.isPackItem)
    return { label: "paquete", cls: "bg-warning/10 text-warning" };
  if (item.sale_unit && isContainerUnit(item.sale_unit))
    return { label: "pieza", cls: "bg-muted text-muted-foreground" };
  return null;
};

const unitBadgeIcon = (item) =>
  item.isWeightItem ? (
    <Carrot size={12} />
  ) : item.isBoxItem ? (
    <Package size={12} />
  ) : item.isPackItem ? (
    <Layers size={12} />
  ) : (
    <Circle size={12} />
  );

const CartItem = React.memo(
  ({
    item,
    index,
    isSelected,
    onSelect,
    onQuantityChange,
    onRemove,
    onDiscount,
  }) => {
    const [leaving, setLeaving] = useState(false);

    const promo = promoInfo(item, item.quantity).applied;
    const fp = lineUnitPrice(item, item.quantity);
    const unitBadge = unitBadgeLabel(item);
    const qtyDisplay = item.isWeightItem
      ? item.quantity.toFixed(3)
      : String(item.quantity);
    const qtyMinWidth = item.isWeightItem
      ? "min-w-[52px]"
      : "min-w-[30px]";

    const secondaryBadges = [];
    if (item.discount_percent > 0)
      secondaryBadges.push(`-${item.discount_percent}%`);
    if (item.discount > 0) secondaryBadges.push(`-$${item.discount.toFixed(2)}`);
    if (promo)
      secondaryBadges.push(
        promo.type === "mayoreo"
          ? `Mayoreo ${promo.qty}+`
          : `Oferta ${promo.qty}×$${promo.price.toFixed(2)}`,
      );

    const unitSuffix = item.isWeightItem
      ? "/ kg"
      : item.isBoxItem
        ? (unitLabels(item.sale_unit)?.perSlash || "/ caja")
        : item.isPackItem
          ? "/ paquete"
          : "c/u";

    const handleRemoveClick = () => {
      setLeaving(true);
      setTimeout(() => onRemove(item), 150);
    };

    return (
      <div
        onClick={() => onSelect(index)}
        className={cn(
          "cart-item-in mb-1 min-h-[66px] cursor-pointer rounded-xl border p-2 transition-colors duration-150",
          leaving && "cart-item-out pointer-events-none",
          isSelected
            ? "border-primary bg-primary/10"
            : "border-border bg-primary/[0.04] hover:bg-primary/10",
        )}
      >
        {/* Línea 1: nombre (truncate) + badge unificado + precio unitario discreto + acciones */}
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="truncate font-semibold text-[0.95rem] leading-5 text-foreground">
              {item.name}
            </span>
            {unitBadge && (
              <span className={cn(badgeBase, unitBadge.cls)}>
                {unitBadgeIcon(item)}
                {unitBadge.label}
              </span>
            )}
            {secondaryBadges.length > 0 && (
              <span
                className={cn(
                  badgeBase,
                  "max-w-[110px] truncate bg-destructive/10 text-destructive",
                )}
                title={secondaryBadges.join(" · ")}
              >
                {secondaryBadges.join(" · ")}
              </span>
            )}
          </div>

          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {item.discount_percent > 0 || item.discount > 0 || promo ? (
              <>
                <span className="line-through">${item.price.toFixed(2)}</span>{" "}
                ${fp.toFixed(2)}
              </>
            ) : (
              `$${item.price.toFixed(2)}`
            )}{" "}
            {unitSuffix}
          </span>

          {canManualDiscount(item) && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Descuento del producto"
              aria-label="Descuento del producto"
              onClick={() => onDiscount(item)}
              className={cn(
                "h-7 w-7 shrink-0 [&_svg]:!size-[16px]",
                item.discount > 0
                  ? "bg-destructive/10 text-destructive"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Percent size={16} />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Eliminar producto"
            onClick={handleRemoveClick}
            className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 [&_svg]:!size-[16px]"
          >
            <Trash2 size={16} />
          </Button>
        </div>

        {/* Línea 2: stepper de cantidad (38px touch/kiosco) + total de línea protagonista */}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {item.quantity <= 1 ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar"
                onClick={handleRemoveClick}
                className="h-[38px] w-[38px] rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-[18px]"
              >
                <Trash2 size={18} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Disminuir cantidad"
                onClick={() => onQuantityChange(item, -1)}
                className="h-[38px] w-[38px] rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-[18px]"
              >
                <Minus size={18} />
              </Button>
            )}
            <span
              key={item.quantity}
              className={cn(
                "cart-qty-pop inline-block text-center font-bold text-[1.05rem] tabular-nums",
                qtyMinWidth,
              )}
            >
              {qtyDisplay}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Aumentar cantidad"
              onClick={() => onQuantityChange(item, 1)}
              className="h-[38px] w-[38px] rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-[18px]"
            >
              <Plus size={18} />
            </Button>
          </div>

          <span className="text-lg font-extrabold tabular-nums text-success">
            ${lineTotal(item, item.quantity).toFixed(2)}
          </span>
        </div>
      </div>
    );
  },
);

export default CartItem;