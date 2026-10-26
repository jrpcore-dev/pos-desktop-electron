import React from "react";

import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtMoneyAbs } from "@/utils/format";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";
import {
  canManualDiscount,
  linePromo,
  promoLabel,
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
  "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 h-[18px] text-[0.7rem] font-bold whitespace-nowrap [contain-intrinsic-size:auto_18px]";

const unitBadgeLabel = (item) => {
  if (item.isWeightItem)
    return { label: "kg", cls: "bg-primary text-primary-foreground" };
  if (item.isBoxItem)
    return {
      label: unitLabels(item.sale_unit)?.badge || "caja",
      cls: "bg-success text-success-foreground",
    };
  if (item.isPackItem)
    return { label: "paquete", cls: "bg-warning text-warning-foreground" };
  if (item.sale_unit && isContainerUnit(item.sale_unit))
    return { label: "pieza", cls: "bg-secondary text-secondary-foreground" };
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
    round,
    flash = false,
  }) => {
    const roundValue = round || ((v) => v);
    const promo = linePromo(item);
    const fullyBundled = item.bundleUnits > 0 && item.bundleUnits >= item.quantity;
    const fp = lineUnitPrice(item, item.quantity);
    const unitBadge = unitBadgeLabel(item);
    const qtyDisplay = item.isWeightItem
      ? item.quantity.toFixed(3)
      : String(item.quantity);
    const qtyMinWidth = item.isWeightItem
      ? "min-w-[52px]"
      : "min-w-[30px]";

    // El % propio sólo se anuncia si es el que se cobró: no con precio de
    // cliente, ni si ganó la promo de categoría/marca, ni todo en paquete.
    const promoPct =
      item.customerPriced || promo?.type === "grupo" || fullyBundled
        ? 0
        : item.discount_percent;
    const secondaryBadges = [];
    if (item.customerPriced && !promo && !item.bundleUnits)
      secondaryBadges.push("Precio cliente");
    if (promoPct > 0) secondaryBadges.push(`-${promoPct}%`);
    if (item.discount > 0)
      secondaryBadges.push(`-${fmtMoneyAbs(item.discount)}`);
    if (promo) secondaryBadges.push(promoLabel(promo));
    const bundleBadge =
      item.bundleUnits > 0
        ? fullyBundled
          ? `Paquete ${item.bundleLabel}`
          : `${item.bundleUnits} en ${item.bundleLabel}`
        : null;

    const unitSuffix = item.isWeightItem
      ? "/ kg"
      : item.isBoxItem
        ? (unitLabels(item.sale_unit)?.perSlash || "/ caja")
        : item.isPackItem
          ? "/ paquete"
          : "c/u";

    return (
      <div
        onClick={() => onSelect(index)}
        className={cn(
          "cart-item-in mb-1 min-h-[66px] cursor-pointer rounded-xl border p-2 transition-colors duration-150",
          isSelected
            ? "border-primary bg-primary/10"
            : "border-border bg-primary/[0.04] hover:bg-primary/10",
          flash
            ? "border-emerald-500/60 bg-emerald-50 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
            : "",
        )}
      >
        {/* Línea 1: nombre (truncate) + badge unificado + precio unitario discreto + acciones */}
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="truncate font-semibold text-[15px] leading-5 text-foreground">
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
            {bundleBadge && (
              <span
                className={cn(
                  badgeBase,
                  "max-w-[130px] truncate bg-amber-500/15 text-amber-700 dark:text-amber-400",
                )}
                title={bundleBadge}
              >
                <Package size={12} />
                {bundleBadge}
              </span>
            )}
          </div>

          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {promoPct > 0 || item.discount > 0 || promo || bundleBadge ? (
              <>
                <span className="line-through">{fmtMoney(item.price)}</span>{" "}
                {fmtMoney(fp)}
              </>
            ) : (
              fmtMoney(item.price)
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
                "h-9 w-9 shrink-0 [&_svg]:!size-[16px]",
                item.discount > 0
                  ? "bg-destructive/10 text-destructive"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Percent size={16} />
            </Button>
          )}

          {/* Trash de fila 1: se oculta en qty<=1 porque el stepper ya muestra
              su propio botón de eliminar (minus→trash), evitando dos papeletas
              redundantes a ~30px de distancia. */}
          {item.quantity > 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Eliminar producto"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item);
              }}
              className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10 [&_svg]:!size-[16px]"
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>

        {/* Línea 2: stepper de cantidad (h-9 en escala) + total de línea protagonista */}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {item.quantity <= 1 ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item);
                }}
                className="h-9 w-9 rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-[18px]"
              >
                <Trash2 size={18} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Disminuir cantidad"
                onClick={() => onQuantityChange(item, -1)}
                className="h-9 w-9 rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-[18px]"
              >
                <Minus size={18} />
              </Button>
            )}
            <span
              key={item.quantity}
              className={cn(
                "cart-qty-pop inline-block text-center font-bold text-[17px] tabular-nums",
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
              className="h-9 w-9 rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-[18px]"
            >
              <Plus size={18} />
            </Button>
          </div>

          <span className="text-lg font-bold tabular-nums text-foreground">
            {fmtMoney(roundValue(lineTotal(item, item.quantity)))}
          </span>
        </div>
      </div>
    );
  },
);

export default CartItem;