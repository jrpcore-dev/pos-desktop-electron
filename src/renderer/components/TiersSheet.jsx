import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Layers, Pencil, PlusCircle, Trash2, X } from "lucide-react";

import { useToast } from "./ToastProvider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Hint } from "./ui/hint";
import { ConfirmDialog } from "./ui/confirm";
import ProductPicker from "./ProductPicker";
import { fmtMoney } from "../utils/format";

// Clientes → Niveles: crear, renombrar y eliminar niveles, y fijar sus
// precios especiales por producto (tier_prices). Un cliente con nivel paga
// esos precios; su precio especial propio (customer_prices) gana sobre el
// del nivel. Editar es sólo del propietario.

const TiersSheet = ({ open, onClose, isAdmin, onChanged }) => {
  const notify = useToast();
  const role = isAdmin ? "admin" : "cashier";
  const [tiers, setTiers] = useState([]);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null); // { id, name }
  const [deleting, setDeleting] = useState(null);
  const [selected, setSelected] = useState(null); // nivel abierto
  const [prices, setPrices] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [newPrice, setNewPrice] = useState(null); // { product, value }

  const loadTiers = useCallback(async () => {
    const rows = await window.api.invoke("get-tiers").catch(() => []);
    setTiers(Array.isArray(rows) ? rows : []);
    return rows;
  }, []);

  const loadPrices = useCallback(async (tierId) => {
    const rows = await window.api.invoke("get-tier-prices", tierId).catch(() => []);
    setPrices(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setEditing(null);
    setNewName("");
    loadTiers();
  }, [open, loadTiers]);

  const changed = async () => {
    await loadTiers();
    onChanged?.();
  };

  const addTier = async () => {
    const res = await window.api.invoke("add-tier", { name: newName, role });
    if (!res?.success) return notify(res?.error || "No se pudo crear el nivel", "error");
    setNewName("");
    notify("Nivel creado", "success");
    changed();
  };

  const saveName = async () => {
    const res = await window.api.invoke("update-tier", { id: editing.id, name: editing.name, role });
    if (!res?.success) return notify(res?.error || "No se pudo renombrar", "error");
    setEditing(null);
    changed();
  };

  const removeTier = async () => {
    const res = await window.api.invoke("delete-tier", { id: deleting.id, role });
    setDeleting(null);
    if (!res?.success) return notify(res?.error || "No se pudo eliminar", "error");
    notify("Nivel eliminado", "success");
    changed();
  };

  const openTier = (t) => {
    setSelected(t);
    setShowPicker(false);
    setNewPrice(null);
    loadPrices(t.id);
  };

  const savePrice = async () => {
    const price = parseFloat(newPrice?.value);
    if (!(price > 0)) return notify("Precio inválido", "error");
    const res = await window.api.invoke("set-tier-price", selected.id, newPrice.product.id, price);
    if (!res?.success) return notify(res?.error || "No se pudo guardar", "error");
    setNewPrice(null);
    loadPrices(selected.id);
    changed();
  };

  const removePrice = async (row) => {
    await window.api.invoke("delete-tier-price", row.id);
    loadPrices(selected.id);
    changed();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="flex flex-row items-center gap-2.5 border-b px-6 py-4 text-left">
          <Layers size={26} className="shrink-0" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">
              {selected ? `Precios de ${selected.name}` : "Niveles de precio"}
            </SheetTitle>
            <SheetDescription>
              {selected
                ? "Los clientes con este nivel pagan estos precios."
                : "Agrupa clientes con precios especiales (p. ej. Mayorista)."}
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-6 py-4">
          {!selected ? (
            <>
              {/* ─── Lista de niveles ─── */}
              {isAdmin && (
                <div className="mb-4 flex gap-2">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && newName.trim() && addTier()}
                    placeholder="Nombre del nuevo nivel"
                    className="h-10"
                  />
                  <Button onClick={addTier} disabled={!newName.trim()} className="h-10 shrink-0">
                    <PlusCircle className="h-4 w-4" />
                    Agregar
                  </Button>
                </div>
              )}

              {tiers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  Aún no hay niveles
                </p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {tiers.map((t) => (
                    <li key={t.id} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                      {editing?.id === t.id ? (
                        <>
                          <Input
                            autoFocus
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            className="h-9"
                          />
                          <Hint label="Guardar">
                            <Button size="icon" variant="ghost" className="size-8" onClick={saveName}>
                              <Check className="h-4 w-4" />
                            </Button>
                          </Hint>
                          <Hint label="Cancelar">
                            <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </Hint>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => openTier(t)}
                            className="min-w-0 flex-1 cursor-pointer text-left"
                          >
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {t.name}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {t.customers_count || 0}{" "}
                              {t.customers_count === 1 ? "cliente" : "clientes"} ·{" "}
                              {t.prices_count || 0}{" "}
                              {t.prices_count === 1 ? "precio especial" : "precios especiales"}
                            </span>
                          </button>
                          {isAdmin && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              <Hint label="Renombrar">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-8"
                                  onClick={() => setEditing({ id: t.id, name: t.name })}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </Hint>
                              <Hint label="Eliminar">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => setDeleting(t)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </Hint>
                            </div>
                          )}
                          <Badge variant="soft-primary" className="shrink-0">
                            Precios
                          </Badge>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!isAdmin && (
                <p className="mt-3 text-xs text-muted-foreground">Solo el propietario puede editar los niveles.</p>
              )}
            </>
          ) : (
            <>
              {/* ─── Precios del nivel ─── */}
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="-ml-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                  Niveles
                </button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      setShowPicker(true);
                      setNewPrice(null);
                    }}
                  >
                    <PlusCircle size={14} />
                    Agregar precio
                  </Button>
                )}
              </div>

              {showPicker && (
                <div className="mb-3">
                  <ProductPicker
                    onPick={(p) => {
                      setShowPicker(false);
                      setNewPrice({ product: p, value: "" });
                    }}
                    onClose={() => setShowPicker(false)}
                  />
                </div>
              )}

              {newPrice && (
                <div className="mb-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
                  <p className="truncate text-sm font-semibold text-foreground">{newPrice.product.name}</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Precio normal {fmtMoney(newPrice.product.price)}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      inputMode="decimal"
                      autoFocus
                      value={newPrice.value}
                      onChange={(e) =>
                        /^\d*\.?\d{0,2}$/.test(e.target.value) &&
                        setNewPrice({ ...newPrice, value: e.target.value })
                      }
                      onKeyDown={(e) => e.key === "Enter" && savePrice()}
                      placeholder="Precio para este nivel"
                      className="h-11 flex-1 tabular-nums"
                    />
                    <Button className="h-11" onClick={savePrice}>
                      Guardar
                    </Button>
                  </div>
                </div>
              )}

              {prices.length === 0 && !showPicker && !newPrice ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  Este nivel aún no tiene precios especiales
                </p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {prices.map((row) => (
                    <li key={row.id} className="group flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-muted/40">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {row.product_name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="text-sm font-bold tabular-nums text-primary">{fmtMoney(row.price)}</span>
                        {isAdmin && (
                          <Hint label="Quitar precio">
                            <button
                              type="button"
                              onClick={() => removePrice(row)}
                              className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <Trash2 size={14} />
                            </button>
                          </Hint>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </SheetContent>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        onConfirm={removeTier}
        title="Eliminar nivel"
        description={
          deleting
            ? `Se eliminará "${deleting.name}" y sus precios especiales.${
                deleting.customers_count > 0
                  ? ` ${deleting.customers_count} ${deleting.customers_count === 1 ? "cliente quedará" : "clientes quedarán"} sin nivel (precio normal).`
                  : ""
              }`
            : ""
        }
        confirmLabel="Eliminar"
      />
    </Sheet>
  );
};

export default TiersSheet;
