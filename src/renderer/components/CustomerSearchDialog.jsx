import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, UserPlus, Clock, User } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const CustomerRow = ({ customer, onSelect, highlighted, index }) => (
  <button
    type="button"
    data-csel={index}
    onClick={() => onSelect(customer)}
    className={
      "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors duration-100 " +
      (highlighted
        ? "border-primary/50 bg-primary/10 ring-1 ring-inset ring-primary/40"
        : "border-transparent bg-card hover:bg-muted/60")
    }
  >
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold text-foreground">
        {customer.name}
      </span>
      <span className="block text-[0.7rem] text-muted-foreground tabular-nums">
        {customer.phone || "Sin teléfono"}
      </span>
    </span>
    {customer.tier_name && (
      <Badge className="h-5 shrink-0 px-1.5 text-[10px] font-bold">
        {customer.tier_name}
      </Badge>
    )}
  </button>
);

const CustomerSearchDialog = ({ open, onClose, onSelect }) => {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState([]);
  const [results, setResults] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setShowCreate(false);
    setNewName("");
    setNewPhone("");
    setResults([]);
    setSelectedIndex(0);
    window.api.invoke("get-recent-customers").then(setRecents).catch(() => {});
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, results, recents]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await window.api.invoke("search-customers", q);
        if (!cancelled) setResults(rows || []);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const list = useMemo(
    () => (query.trim() ? results : recents),
    [query, results, recents],
  );

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelectorAll("[data-csel]")[selectedIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, list]);

  const selectAt = (i) => {
    const c = list[i];
    if (c) onSelect(c);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((p) =>
        Math.min(p + 1, Math.max(list.length - 1, 0)),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list[selectedIndex]) {
        selectAt(selectedIndex);
      } else if (list.length > 0) {
        selectAt(0);
      } else if (query.trim()) {
        setNewName(query.trim());
        setNewPhone("");
        setShowCreate(true);
      }
    } else if (e.key === "Escape" && showCreate) {
      e.preventDefault();
      e.stopPropagation();
      setShowCreate(false);
      inputRef.current?.focus();
    }
  };

  const handleQuickCreate = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const res = await window.api.invoke("add-customer", {
        name,
        phone: newPhone.trim(),
      });
      if (res.success && res.customer) {
        onSelect(res.customer);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const showEmpty =
    query.trim().length >= 2 && results.length === 0 && !showCreate;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) return;
        if (showCreate) {
          setShowCreate(false);
          return;
        }
        onClose();
      }}
    >
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <User size={20} />
            {query.trim() ? "Resultados" : "Últimos clientes"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4">
          <div className="relative">
            <Search
              size={18}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Nombre o teléfono..."
              autoComplete="off"
              className="h-12 pl-10 text-base"
            />
          </div>
        </div>

        <div className="max-h-[45vh] overflow-auto px-2 pb-2">
          {!query.trim() && recents.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Clock size={12} aria-hidden /> Recientes
            </div>
          )}
          {query.trim() && (
            <div className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Search size={12} aria-hidden /> Resultados
            </div>
          )}
          <div ref={listRef} className="flex flex-col gap-1 p-1">
            {list.map((c, i) => (
              <CustomerRow
                key={c.id}
                customer={c}
                onSelect={onSelect}
                highlighted={i === selectedIndex}
                data-csel=""
                index={i}
              />
            ))}
            {showEmpty && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                Sin resultados para "{query.trim()}"
              </p>
            )}
          </div>
        </div>

        {!showCreate ? (
          <div className="border-t border-border p-3">
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base font-semibold"
              onClick={() => setShowCreate(true)}
            >
              <UserPlus size={18} />
              Crear cliente rápido
            </Button>
          </div>
        ) : (
          <div className="space-y-2 border-t border-border p-4">
            <Input
              ref={nameRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  phoneRef.current?.focus();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowCreate(false);
                  inputRef.current?.focus();
                }
              }}
              placeholder="Nombre *"
              autoComplete="off"
              className="h-12 text-base"
              autoFocus
            />
            <Input
              ref={phoneRef}
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleQuickCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowCreate(false);
                  inputRef.current?.focus();
                }
              }}
              placeholder="Teléfono"
              autoComplete="off"
              className="h-12 text-base tabular-nums"
            />
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1"
                onClick={() => setShowCreate(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="h-12 flex-1 bg-success text-white hover:bg-success/90"
                disabled={!newName.trim() || saving}
                onClick={handleQuickCreate}
              >
                Guardar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CustomerSearchDialog;
