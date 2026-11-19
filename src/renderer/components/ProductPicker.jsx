import React, { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { fmtMoney } from "../utils/format";

// Buscador de productos para fijar precios especiales (por cliente o por
// nivel). Busca desde 3 letras y devuelve el producto elegido con onPick.
const ProductPicker = ({ onPick, onClose }) => {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(null);
  const results = matches ?? [];
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const listRef = useRef(null);
  const activeOption = results[activeIndex];

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await window.api.invoke("search-products", q);
        if (!cancelled) setMatches(rows || []);
      } catch {
        if (!cancelled) setMatches([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    if (activeOption) {
      listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, activeOption]);

  const handleSearchKeys = (event) => {
    if (event.nativeEvent.isComposing || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        event.key === "ArrowDown"
          ? Math.min(index + 1, results.length - 1)
          : index < 0 ? results.length - 1 : Math.max(index - 1, 0),
      );
    } else if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      onPick(activeOption);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="relative mb-2">
        <Search
          size={18}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="text"
          role="combobox"
          aria-label="Buscar producto"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatches(null);
            setActiveIndex(-1);
          }}
          onKeyDown={handleSearchKeys}
          placeholder="Buscar producto (mín. 3)..."
          className="h-12 pl-10 text-base"
          autoFocus
        />
      </div>
      <div id={listId} ref={listRef} role="listbox" aria-label="Productos encontrados" className="max-h-56 overflow-auto">
        {results.map((p, index) => (
          <button
            key={p.id}
            id={`${listId}-${p.id}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => onPick(p)}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
              index === activeIndex && "border-primary/30 bg-primary/10 hover:bg-primary/15",
            )}
          >
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {p.name}
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-success">
              {fmtMoney(p.price)}
            </span>
          </button>
        ))}
      </div>
      {query.trim().length >= 3 && matches?.length === 0 && (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">
          Sin resultados
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-11 w-full"
        onClick={onClose}
      >
        Cancelar
      </Button>
    </div>
  );
};

export default ProductPicker;
