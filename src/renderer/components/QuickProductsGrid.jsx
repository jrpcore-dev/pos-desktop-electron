import React, { useCallback, useEffect, useState } from "react";
import { useDbChanges } from "../lib/useDbChanges";
import { Flame, PackagePlus, Zap, Plus, X } from "lucide-react";

import { Skeleton } from "./ui/skeleton";
import { Input } from "./ui/input";
import { Kbd } from "./ui/kbd";
import {
  Dialog,
  DialogPortal,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Hint } from "./ui/hint";
import { InitialsAvatar } from "./ui/initials-avatar";
import { fmtMoney } from "@/utils/format";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";
import { promoInfo } from "../utils/cartMath";

const GRID_CLS = {
  compact: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3",
  default: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4",
};

const STORAGE_KEY = "quickAccessIds";
// Los más vendidos se fijan solos al inicio (sin ✕); después van los que
// el usuario fijó a mano.
const TOP_LIMIT = 4;

const readFavorites = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map((v) => parseInt(v)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
  } catch {
    return [];
  }
};

const writeFavorites = (ids) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
};

/**
 * Grid de productos rápidos: primero los TOP_LIMIT más vendidos (automáticos,
 * marcados "Top"), luego los que el usuario fija con "+" (localStorage por
 * caja). Un producto que es top y además fijado sale una sola vez.
 */
const QuickProductsGrid = React.memo(
  ({ onAddProduct, onOpenServicios, compact = false }) => {
    const [products, setProducts] = useState(null);
    const [favorites, setFavorites] = useState(readFavorites);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [pickerIdx, setPickerIdx] = useState(-1);

    const addFavorite = (id) => {
      if (favorites.includes(id)) return;
      const next = [...favorites, id];
      setFavorites(next);
      writeFavorites(next);
      setPickerOpen(false);
      setQuery("");
      setResults([]);
      setPickerIdx(-1);
    };

    const removeFavorite = (e, id) => {
      e.stopPropagation();
      const next = favorites.filter((v) => v !== id);
      setFavorites(next);
      writeFavorites(next);
    };

    // Carga/reaúsela de los accesos rápidos: también la dispara db-changed
    // (precio, stock o nombre cambiado en el Host) sin volver a la esqueleto.
    const loadFavorites = useCallback(() => {
      let cancelled = false;
      const normalize = (p) => ({
        ...p,
        sale_unit: p.sale_unit || "unit",
        price: p.price || 0,
        discount_percent: p.discount_percent || 0,
        stock: p.stock || 0,
      });
      (async () => {
        try {
          const [topRes, favRes] = await Promise.all([
            window.api.invoke("get-top-products", {}).catch(() => []),
            favorites.length > 0
              ? window.api.invoke("get-products-by-ids", favorites)
              : Promise.resolve([]),
          ]);
          if (cancelled) return;
          // Sólo productos que de verdad se han vendido.
          const top = (Array.isArray(topRes) ? topRes : [])
            .filter((p) => p?.id && Number(p.total_sold) > 0)
            .slice(0, TOP_LIMIT)
            .map((p) => ({ ...normalize(p), isTop: true }));
          const topIds = new Set(top.map((p) => p.id));
          const map = {};
          if (Array.isArray(favRes)) favRes.forEach((p) => { if (p?.id) map[p.id] = p; });
          const pinned = favorites
            .filter((id) => map[id] && !topIds.has(id))
            .map((id) => normalize(map[id]));
          setProducts([...top, ...pinned]);
        } catch {
          if (!cancelled) setProducts([]);
        }
      })();
      return () => { cancelled = true; };
    }, [favorites]);

    useEffect(() => loadFavorites(), [loadFavorites]);

    // In vivo: precios/stock al día; el carrito en curso queda intacto
    // (reglas 1 y 3).
    useDbChanges(() => loadFavorites(), ["products", "product_prices", "sales"]);

    useEffect(() => {
      if (!pickerOpen || query.trim().length < 1) { setResults([]); return; }
      let cancelled = false;
      (async () => {
        try {
          const res = await window.api.invoke("search-products", query.trim());
          if (!cancelled) setResults(Array.isArray(res) ? res : []);
        } catch {
          if (!cancelled) setResults([]);
        }
      })();
      return () => { cancelled = true; };
    }, [pickerOpen, query]);

    const handlePickerKeyDown = (e) => {
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setPickerIdx((p) => (p < results.length - 1 ? p + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setPickerIdx((p) => (p > 0 ? p - 1 : results.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (pickerIdx >= 0) addFavorite(results[pickerIdx].id);
        else if (results.length > 0) addFavorite(results[0].id);
      }
    };

    return (
      <div className="flex flex-col items-center px-4 pb-2 pt-1">
        <div className="mb-3 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div />
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Flame size={16} className="text-warning" aria-hidden />
            Productos rápidos
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Hint label="Fijar producto a accesos rápidos">
            <button type="button" onClick={() => setPickerOpen(true)}
              className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted px-2.5 text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Plus size={14} />
              Agregar
            </button>
            </Hint>
            {onOpenServicios && (
              <Hint label="Recargas y pagos de servicios">
              <button type="button" onClick={onOpenServicios}
                className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 text-xs font-semibold text-primary transition-all duration-150 hover:border-primary/70 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Zap size={14} aria-hidden />
                Servicios
              </button>
              </Hint>
            )}
          </div>
        </div>

        {products === null ? (
          <div className={cn("grid w-full gap-2.5", GRID_CLS[compact ? "compact" : "default"])}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex h-24 items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                <Skeleton className="size-[4.25rem] shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="py-8 text-xs text-muted-foreground">
            Agrega productos con el botón + para acceso rápido
          </p>
        ) : (
          <div className={cn("grid w-full gap-2.5", GRID_CLS[compact ? "compact" : "default"])}>
            {products.map((p) => {
              const promo = promoInfo(p, 1);
              const finalPrice = promo.unit;
              const hasPromo = promo.applied || (p.discount_percent || 0) > 0;
              const out = p.stock > 0 && p.stock <= 2;
              const unitLabel = isContainerUnit(p.sale_unit) ? unitLabels(p.sale_unit)?.badge || "c/u" : p.sale_unit === "weight" ? "kg" : "c/u";
              return (
                <div
                  key={`${p.isTop ? "top" : "fav"}-${p.id}`}
                  onClick={() => onAddProduct(p)}
                  className="group relative flex h-24 w-full cursor-pointer select-none items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg active:translate-y-0 active:scale-[0.985] active:shadow-sm"
                >
                  {/* Foto del producto; sin foto, iniciales con la paleta de marca. */}
                  <div className="relative shrink-0">
                  {p.image_path ? (
                    <img
                      src={p.image_path}
                      alt=""
                      className="size-[4.25rem] shrink-0 rounded-lg border border-border/60 bg-muted object-cover"
                    />
                  ) : (
                    <InitialsAvatar
                      id={p.id}
                      name={p.name}
                      className="size-[4.25rem] rounded-lg text-base"
                    />
                  )}
                  {p.isTop && (
                    <span className="absolute left-0.5 top-0.5 inline-flex items-center gap-0.5 rounded-md bg-warning px-1 py-px text-[10px] font-bold text-warning-foreground shadow-sm">
                      <Flame size={10} aria-hidden />
                      Top
                    </span>
                  )}
                  </div>
                  <div className="flex h-full min-w-0 flex-1 flex-col justify-between py-0.5">
                    <span className="line-clamp-2 pr-5 text-sm font-semibold leading-tight text-foreground">
                      {p.name}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-base font-bold leading-none text-foreground tabular-nums">
                          {fmtMoney(finalPrice)}
                        </span>
                        {hasPromo && (
                          <span className="text-xs leading-none text-muted-foreground line-through tabular-nums">
                            {fmtMoney(p.price)}
                          </span>
                        )}
                        <span className="text-[11px] leading-none text-muted-foreground">{unitLabel}</span>
                      </div>
                      {((p.discount_percent || 0) > 0 && !promo.applied) || out ? (
                        <div className="mt-1 flex gap-1">
                          {(p.discount_percent || 0) > 0 && !promo.applied && (
                            <Badge variant="soft-destructive" className="px-1.5 py-0">
                              -{p.discount_percent}%
                            </Badge>
                          )}
                          {out && (
                            <Badge variant="soft-warning" className="px-1.5 py-0">
                              Quedan {p.stock}
                            </Badge>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {!p.isTop && (
                  <Hint label="Quitar de accesos rápidos">
                    <button
                      type="button"
                      onClick={(e) => removeFavorite(e, p.id)}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label="Quitar de accesos rápidos"
                      className="absolute right-1.5 top-1.5 z-30 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </Hint>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogPortal>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Fijar a accesos rápidos</DialogTitle>
              </DialogHeader>
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPickerIdx(-1);
                }}
                onKeyDown={handlePickerKeyDown}
                placeholder="Buscar producto…"
                autoFocus
              />
              <div className="max-h-72 overflow-y-auto divide-y">
                {query.trim().length < 1 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">Escribí para buscar productos.</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">Sin resultados.</p>
                ) : (
                  results.map((p, index) => (
                    <button key={p.id} type="button" onClick={() => addFavorite(p.id)}
                      onMouseEnter={() => setPickerIdx(index)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                        index === pickerIdx
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-muted"
                      )}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <PackagePlus size={15} />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="text-xs text-foreground tabular-nums">{fmtMoney(p.price)}</span>
                    </button>
                  ))
                )}
              </div>
              {results.length > 0 && (
                <p className="pt-2 text-center text-[0.68rem] font-medium text-muted-foreground">
                  <Kbd>↑↓</Kbd> navega · <Kbd>Enter</Kbd> fija
                </p>
              )}
            </DialogContent>
          </DialogPortal>
        </Dialog>
      </div>
    );
  },
);

export default QuickProductsGrid;