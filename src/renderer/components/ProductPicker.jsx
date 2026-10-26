import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { fmtMoney } from "../utils/format";

// Buscador de productos para fijar precios especiales (por cliente o por
// nivel). Busca desde 3 letras y devuelve el producto elegido con onPick.
const ProductPicker = ({ onPick, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await window.api.invoke("search-products", q);
        if (!cancelled) setResults(rows || []);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto (mín. 3)..."
          className="h-12 pl-10 text-base"
          autoFocus
        />
      </div>
      <div className="max-h-56 overflow-auto">
        {results.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {p.name}
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-success">
              {fmtMoney(p.price)}
            </span>
          </button>
        ))}
        {query.trim().length >= 3 && results.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            Sin resultados
          </p>
        )}
      </div>
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
