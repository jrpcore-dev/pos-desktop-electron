import React from "react";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
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

// Badge compacto del carrito (misma altura en todas las filas).
const BADGE = "h-[18px] shrink-0 px-1.5 py-0 [&_svg]:size-3";

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// Unidad de la línea: badges de la paleta (kg en minúscula: es símbolo).
const unitBadgeLabel = (item) => {
  if (item.isWeightItem) return { label: "kg", variant: "unit" };
  if (item.isBoxItem)
    return { label: cap(unitLabels(item.sale_unit)?.badge || "caja"), variant: "unit" };
  if (item.isPackItem) return { label: "Paquete", variant: "unit" };
  if (item.sale_unit && isContainerUnit(item.sale_unit))
    return { label: "Pieza", variant: "unit" };
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
    const payable = lineTotal(item, item.quantity);
    const savings = Math.max(0, item.price * item.quantity - payable);
    const unitBadge = unitBadgeLabel(item);
    const qtyDisplay = item.isWeightItem
      ? item.quantity.toFixed(3)
      : String(item.quantity);
    const qtyMinWidth = item.isWeightItem
      ? "min-w-[60px]"
      : "min-w-[40px]";

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
          "cart-item-in group relative min-h-[66px] cursor-pointer px-3 py-2.5 transition-colors duration-150",
          isSelected ? "bg-chart-2/15" : "hover:bg-muted/40",
          flash && "bg-success/15",
        )}
      >
        {/* Barra lateral: fila elegida (primary) o recién agregada (success). */}
        {(isSelected || flash) && (
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-1.5 left-0 w-1 rounded-r-full",
              flash ? "bg-success" : "bg-primary",
            )}
          />
        )}
        {/* Línea 1: nombre y precio unitario a la izquierda, total de línea a la derecha */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-[15px] leading-5 text-foreground">
              {item.name}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                {savings >= 0.005 ? (
                  <>
                    <span className="line-through">{fmtMoney(item.price)}</span>{" "}
                    {fmtMoney(fp)}
                  </>
                ) : (
                  fmtMoney(item.price)
                )}{" "}
                {unitSuffix}
              </span>
              {unitBadge && (
                <Badge variant={unitBadge.variant} className={BADGE}>
                  {unitBadgeIcon(item)}
                  {unitBadge.label}
                </Badge>
              )}
              {secondaryBadges.length > 0 && (
                <Badge variant="soft-destructive" className={cn(BADGE, "max-w-[110px]")}>
                  <span className="truncate">{secondaryBadges.join(" · ")}</span>
                </Badge>
              )}
              {bundleBadge && (
                <Badge variant="soft-primary" className={cn(BADGE, "max-w-[130px]")}>
                  <Package />
                  <span className="truncate">{bundleBadge}</span>
                </Badge>
              )}
            </div>
          </div>

          <div className="text-right">
            <p className="text-lg font-bold leading-6 tabular-nums text-foreground">
              {fmtMoney(roundValue(payable))}
            </p>
            {savings >= 0.005 && (
              <p className="text-xs font-medium text-success">Ahorro {fmtMoney(savings)}</p>
            )}
          </div>
        </div>

        {/* Línea 2: stepper a la izquierda; descuento y eliminar bajo el total */}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            {item.quantity <= 1 ? (
              <button
                type="button"
                aria-label="Eliminar"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item);
                }}
                className="flex h-full w-9 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Trash2 size={16} />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Disminuir cantidad"
                onClick={() => onQuantityChange(item, -1)}
                className="flex h-full w-9 cursor-pointer items-center justify-center text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Minus size={16} />
              </button>
            )}
            <span
              key={item.quantity}
              className={cn(
                "cart-qty-pop inline-flex h-full items-center justify-center border-x border-border px-1 text-[17px] font-bold tabular-nums",
                qtyMinWidth,
              )}
            >
              {qtyDisplay}
            </span>
            <button
              type="button"
              aria-label="Aumentar cantidad"
              disabled={!!item.recharge}
              onClick={() => onQuantityChange(item, 1)}
              className="flex h-full w-9 cursor-pointer items-center justify-center text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:hidden"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
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

            {/* Con cantidad 1 el stepper ya trae su botón de eliminar. Con más
                sale al pasar el mouse; en la fila elegida con teclado y en
                pantallas táctiles (sin hover) queda siempre visible. */}
            {item.quantity > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Eliminar producto"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item);
                }}
                className={cn(
                  "h-9 w-9 shrink-0 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 [&_svg]:!size-[16px]",
                  isSelected ? "opacity-100" : "opacity-0",
                )}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default CartItem;
