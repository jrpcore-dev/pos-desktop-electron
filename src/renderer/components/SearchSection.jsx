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
import { InitialsAvatar } from "./ui/initials-avatar";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/utils/format";
import { promoInfo } from "../utils/cartMath";

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
// "caja" → "Caja" (los símbolos como "kg" se dejan tal cual).
const capitalize = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// Resalta la primera coincidencia de lo que se escribió dentro del nombre.
const Highlight = ({ text, query }) => {
  const q = (query || "").toLowerCase();
  const i = q.length >= 2 ? String(text).toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
};

const SearchSection =
  ({
    barcode,
    onBarcodeChange,
    onBarcodeKeyDown,
    pendingQty,
    onOpenServicios,
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
    const query = String(barcode || "").replace(/^\d+\*/, "").trim();
    // Miniaturas sólo si algún resultado tiene foto; si ninguno, la lista va
    // compacta y el nombre usa todo el ancho.
    const showThumbs = searchResults.some((p) => p.image_path);

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
                onOpenServicios={onOpenServicios}
              />
            ) : (
              <div className="flex flex-col gap-1 p-1">
                {showSuggestions && searchResults.length > 0 && (
                  <div className="animate-in fade-in slide-in-from-bottom-1 space-y-0.5 duration-200">
                    {searchResults.map((product, index) => {
                      const selected = index === selectedSuggestionIndex;
                      const promo = promoInfo(product, 1);
                      const hasPromo = promo.applied || product.discount_percent > 0;
                      const unit =
                        product.sale_unit === "weight"
                          ? "kg"
                          : isContainerUnit(product.sale_unit)
                            ? capitalize(unitLabels(product.sale_unit).badge)
                            : null;
                      const stock = Number(product.stock) || 0;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          data-suggestion-idx={index}
                          onClick={() => onSuggestionClick(product)}
                          className={cn(
                            "relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "bg-primary/10 shadow-xs ring-1 ring-inset ring-primary/35"
                              : "hover:bg-muted/60",
                          )}
                        >
                          {/* Barra de la fila elegida con el teclado. */}
                          {selected && (
                            <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" aria-hidden />
                          )}
                          {showThumbs &&
                            (product.image_path ? (
                              <img
                                src={product.image_path}
                                alt=""
                                className="size-10 shrink-0 rounded-lg border border-border/60 bg-muted object-cover"
                              />
                            ) : (
                              <InitialsAvatar id={product.id} name={product.name} className="size-10 rounded-lg" />
                            ))}
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-sm font-semibold",
                                selected ? "text-primary" : "text-foreground",
                              )}
                            >
                              <Highlight text={product.name} query={query} />
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {product.brand && <span className="truncate">{product.brand}</span>}
                              {product.brand && <span aria-hidden>·</span>}
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1",
                                  stock > 0 ? "text-muted-foreground" : "font-medium text-destructive dark:text-red-400",
                                )}
                              >
                                <span
                                  className={cn("size-1.5 rounded-full", stock > 0 ? "bg-success" : "bg-destructive")}
                                  aria-hidden
                                />
                                {stock > 0
                                  ? `${product.sale_unit === "weight" ? Number(stock.toFixed(2)) : stock} disp.`
                                  : "Sin stock"}
                              </span>
                              {unit && (
                                <Badge variant="unit" className="shrink-0 px-1.5 py-0">
                                  {unit}
                                </Badge>
                              )}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span
                              className={cn(
                                "block text-lg font-bold leading-tight tabular-nums",
                                selected ? "text-primary" : "text-foreground",
                              )}
                            >
                              {fmtMoney(promo.unit)}
                            </span>
                            {hasPromo && (
                              <span className="flex items-center justify-end gap-1 text-[11px]">
                                <span className="text-muted-foreground line-through tabular-nums">
                                  {fmtMoney(product.price)}
                                </span>
                                {product.discount_percent > 0 && !promo.applied && (
                                  <span className="font-semibold text-destructive dark:text-red-400">
                                    -{product.discount_percent}%
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
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