import React, { useEffect, useState } from "react";
import { Flame, PackagePlus, Smartphone, Plus, X } from "lucide-react";

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
import { isContainerUnit, unitLabels } from "../utils/unitLabels";

const GRID_CLS = {
  compact: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3",
  default: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4",
};

const STORAGE_KEY = "quickAccessIds";

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
 * Grid de productos rápidos configurables manualmente.
 * Vacío por defecto; el usuario fija productos con "+".
 * Persistencia en localStorage por caja.
 */
const QuickProductsGrid = React.memo(
  ({ onAddProduct, onOpenRecarga, compact = false }) => {
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

    useEffect(() => {
      if (favorites.length === 0) {
        setProducts([]);
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const res = await window.api.invoke("get-products-by-ids", favorites);
          if (cancelled) return;
          const map = {};
          if (Array.isArray(res)) res.forEach((p) => { if (p?.id) map[p.id] = p; });
          setProducts(
            favorites.filter((id) => map[id]).map((id) => ({ ...map[id], sale_unit: map[id].sale_unit || "unit", price: map[id].price || 0, discount_percent: map[id].discount_percent || 0, stock: map[id].stock || 0 })),
          );
        } catch {
          if (!cancelled) setProducts([]);
        }
      })();
      return () => { cancelled = true; };
    }, [favorites]);

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
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div />
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Flame size={16} className="text-warning" aria-hidden />
            Productos rápidos
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button type="button" onClick={() => setPickerOpen(true)} title="Fijar producto a accesos rápidos"
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted px-2.5 text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Plus size={14} />
              Agregar
            </button>
            {onOpenRecarga && (
              <button type="button" onClick={onOpenRecarga} title="Venta de recarga"
                className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 text-xs font-semibold text-primary transition-all duration-150 hover:border-primary/70 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Smartphone size={14} aria-hidden />
                Recarga
              </button>
            )}
          </div>
        </div>

        {products === null ? (
          <div className={cn("grid w-full gap-2.5", GRID_CLS[compact ? "compact" : "default"])}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex h-[5.5rem] flex-col justify-between rounded-xl border border-border bg-background/60 p-2.5 shadow-md">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-9 w-9 rounded-md" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="py-8 text-xs text-muted-foreground">
            Agregá productos con el botón + para acceso rápido
          </p>
        ) : (
          <div className={cn("grid w-full gap-2.5", GRID_CLS[compact ? "compact" : "default"])}>
            {products.map((p) => {
              const price = (p.price * (1 - (p.discount_percent || 0) / 100)).toFixed(2);
              const out = p.stock > 0 && p.stock <= 2;
              const unitLabel = isContainerUnit(p.sale_unit) ? unitLabels(p.sale_unit)?.badge || "c/u" : p.sale_unit === "weight" ? "kg" : "c/u";
              return (
                <div key={p.id} onClick={() => onAddProduct(p)}
                  className="group relative flex h-[5.5rem] w-full cursor-pointer select-none flex-col items-start justify-between gap-1.5 overflow-hidden rounded-xl border border-border bg-background/60 p-2.5 text-left shadow-md transition-all duration-150 hover:border-primary/60 hover:bg-primary/5 hover:shadow-lg active:scale-95">
                  <button type="button" onClick={(e) => removeFavorite(e, p.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Quitar de accesos rápidos"
                    className="absolute right-1 top-1 z-30 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-border bg-background/90 text-muted-foreground opacity-60 transition-all duration-150 hover:opacity-100 hover:border-destructive hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X size={14} />
                  </button>
                  <span className="flex w-full min-w-0 items-center gap-1.5 pr-5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <PackagePlus size={18} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.9rem] font-semibold text-foreground">
                      {p.name}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-[1.05rem] font-extrabold text-success tabular-nums">
                      ${price}
                    </span>
                    {p.discount_percent > 0 && (
                      <span className="text-[0.65rem] font-bold text-destructive">-{p.discount_percent}%</span>
                    )}
                    <span className="rounded border border-border px-1.5 py-0 text-[0.6rem] font-medium">{unitLabel}</span>
                    {out && (
                      <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[0.6rem] font-semibold text-destructive">
                        {p.stock} uds
                      </span>
                    )}
                  </span>
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
                      <span className="text-xs text-success tabular-nums">${(p.price || 0).toFixed(2)}</span>
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