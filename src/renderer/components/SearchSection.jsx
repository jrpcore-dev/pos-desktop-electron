import React from "react";
import {
  Search,
  Carrot,
  Package,
  Layers,
  ScanBarcode,
} from "lucide-react";

import QuickProductsGrid from "./QuickProductsGrid";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Kbd } from "./ui/kbd";
import { Skeleton } from "./ui/skeleton";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "./ui/hover-card";
import { cn } from "@/lib/utils";

const calcFinalPrice = (price, discount) =>
  price * (1 - (discount || 0) / 100);

const F_KEYS = [
  ["F1", "Ayuda"],
  ["F2", "Sin código"],
  ["F6", "Descuento"],
  ["F9", "Cantidad"],
  ["F8", "Vender"],
  ["F10", "Retiro"],
  ["F11", "Cerrar caja"],
];

/**
 * Panel de búsqueda / catálogo.
 * - Input de código de barras / nombre (auto-focus, atajos preservados).
 * - Si el input está vacío: muestra `QuickProductsGrid` (Productos Rápidos).
 * - Si el usuario tipea/escanea: oculta el grid y muestra la lista de
 *   sugerencias / resultados tal y como operaba antes.
 */
const SearchSection =
  ({
    barcode,
    onBarcodeChange,
    onBarcodeKeyDown,
    pendingQty,
    onOpenRecarga,
    searchResults,
    showSuggestions,
    selectedSuggestionIndex,
    isSearching,
    searchTimedOut,
    suggestionListRef,
    onSuggestionClick,
    onAddProduct,
  }) => {
    const showGrid = barcode === "";

    return (
      <div className="flex h-full w-full min-w-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col overflow-hidden pt-1.5">
          <div className="flex shrink-0 flex-col gap-3 p-3 sm:p-4">
            {showGrid && (
              <div className="mb-1 text-center">
                <ScanBarcode
                  size={52}
                  className="mx-auto mb-3 text-muted-foreground/40"
                  aria-hidden
                />
                <div className="relative mx-auto h-[3px] w-40 overflow-hidden rounded-full bg-muted">
                  <span className="scan-bar absolute block h-full w-2/5 rounded-full" />
                </div>
                <style>{`
                  .scan-bar {
                    left: 0;
                    background: linear-gradient(90deg, transparent, hsl(var(--primary)), transparent);
                    animation: scanMove 2s ease-in-out infinite;
                    will-change: transform;
                  }
                  @keyframes scanMove {
                    0% { transform: translateX(-100%); }
                    50% { transform: translateX(250%); }
                    100% { transform: translateX(-100%); }
                  }
                `}</style>
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                  Para productos sin código, usa "Productos rápidos" o busca por
                  nombre
                </p>
              </div>
            )}

            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="barcode-input"
                type="text"
                value={barcode}
                onChange={(e) => onBarcodeChange(e.target.value)}
                onKeyDown={onBarcodeKeyDown}
                autoFocus
                autoComplete="off"
                spellCheck="false"
                placeholder={
                  /^\d/.test(barcode)
                    ? "Código de barras (mín. 5 dígitos)"
                    : "Nombre del producto (mín. 3 caracteres)"
                }
                className="h-12 pl-10 pr-14 text-base text-foreground placeholder:text-muted-foreground/80"
              />
              <Kbd className="absolute right-3 top-1/2 -translate-y-1/2">
                F5
              </Kbd>
            </div>
          </div>

          <div ref={suggestionListRef} className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
            {showGrid ? (
              <QuickProductsGrid
                onAddProduct={onAddProduct}
                onOpenRecarga={onOpenRecarga}
              />
            ) : (
              <div className="flex flex-col gap-1 p-1">
                {showSuggestions && searchResults.length > 0 && (
                  <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
                    {searchResults.map((product, index) => (
                      <HoverCard
                        key={product.id}
                        openDelay={350}
                        closeDelay={120}
                      >
                        <HoverCardTrigger asChild>
                          <button
                            type="button"
                            data-suggestion-idx={index}
                            onClick={() => onSuggestionClick(product)}
                            className={cn(
                              "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left shadow-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              index === selectedSuggestionIndex
                                ? "border-primary/50 bg-primary/10 text-foreground ring-1 ring-inset ring-primary/40"
                                : "border-transparent bg-card hover:bg-muted/60",
                            )}
                          >
                            <span className="min-w-0 text-left">
                              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                                {product.name}
                                {product.sale_unit === "weight" && (
                                  <Badge
                                    variant="success"
                                    className="h-5 gap-0.5 px-1 text-[10px] font-bold"
                                  >
                                    <Carrot size={11} aria-hidden /> kg
                                  </Badge>
                                )}
                                {isContainerUnit(product.sale_unit) && (
                                  <Badge
                                    className="h-5 gap-0.5 px-1 text-[10px] font-bold text-emerald-700"
                                    variant="success"
                                  >
                                    {product.sale_unit === "package" ? (
                                      <Layers size={11} aria-hidden />
                                    ) : (
                                      <Package size={11} aria-hidden />
                                    )}
                                    {unitLabels(product.sale_unit).badge}
                                  </Badge>
                                )}
                              </span>
                              <span className="block text-[0.7rem] text-muted-foreground">
                                {product.brand}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[0.9rem] font-bold text-success tabular-nums">
                                $
                                {calcFinalPrice(
                                  product.price,
                                  product.discount_percent,
                                ).toFixed(2)}
                              </span>
                              {product.discount_percent > 0 && (
                                <span className="block text-[0.65rem] font-semibold text-destructive">
                                  -{product.discount_percent}%
                                </span>
                              )}
                            </span>
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent
                          sideOffset={6}
                          align="start"
                          className="w-80 overflow-hidden p-0"
                        >
                          <div className="flex flex-col">
                            <div className="flex h-28 w-full items-center justify-center overflow-hidden bg-gradient-to-b from-muted to-muted/40">
                              {product.image_path ? (
                                <img
                                  src={product.image_path}
                                  alt={product.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted text-lg font-bold text-primary">
                                  {product.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 p-3">
                              <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
                                {product.name}
                              </span>
                              {product.brand && (
                                <span className="text-[0.7rem] font-medium text-muted-foreground">
                                  {product.brand}
                                </span>
                              )}
                              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                                <span className="rounded-md bg-success/10 px-2 py-0.5 text-[0.95rem] font-bold tabular-nums text-success">
                                  $
                                  {calcFinalPrice(
                                    product.price,
                                    product.discount_percent,
                                  ).toFixed(2)}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                                  <span
                                    className={cn(
                                      "h-2 w-2 rounded-full",
                                      product.stock > 0
                                        ? "bg-emerald-500"
                                        : "bg-red-500",
                                    )}
                                  />
                                  {product.stock > 0
                                    ? `${product.stock} disponibles`
                                    : "Sin stock"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    ))}
                  </div>
                )}

                {isSearching && !searchTimedOut && (
                  <div className="flex flex-col gap-2 p-1">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2.5 shadow-sm"
                      >
                        <div className="space-y-1.5">
                          <Skeleton className="h-3 w-28" />
                          <Skeleton className="h-2.5 w-20" />
                        </div>
                        <Skeleton className="h-3 w-14" />
                      </div>
                    ))}
                  </div>
                )}

                {searchTimedOut && (
                  <div className="py-6 text-center opacity-70">
                    <Search
                      size={36}
                      className="mx-auto mb-2 text-muted-foreground"
                      aria-hidden
                    />
                    <p className="text-xs text-muted-foreground">
                      La búsqueda está tardando demasiado
                    </p>
                  </div>
                )}

                {!isSearching &&
                  !searchTimedOut &&
                  barcode.length >= 3 &&
                  searchResults.length === 0 && (
                    <div className="py-6 text-center opacity-70">
                      <Search
                        size={36}
                        className="mx-auto mb-2 text-muted-foreground"
                        aria-hidden
                      />
                      <p className="text-xs text-muted-foreground">
                        No se encontraron productos
                      </p>
                    </div>
                  )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2.5 border-t border-border/60 bg-muted/20 px-3 py-2.5">
            {F_KEYS.map(([key, label]) => (
              <span
                key={key}
                className="inline-flex items-center gap-2 text-xs font-semibold text-foreground"
              >
                <Kbd className="h-7 px-1.5 text-[11px] font-bold">{key}</Kbd>
                <span className="whitespace-nowrap">{label}</span>
              </span>
            ))}
            {pendingQty > 1 && (
              <Badge className="h-6 px-2 text-xs">Próximo: x{pendingQty}</Badge>
            )}
          </div>
        </div>
      </div>
    );
  };

export default SearchSection;