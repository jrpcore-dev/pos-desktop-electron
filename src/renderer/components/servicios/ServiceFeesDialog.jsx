import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { OperatorIcon } from "./OperatorIcon";

// Comisión que cobra la tienda encima del importe. Se guarda en el Host, que
// es quien la suma al cobrar; aquí sólo se edita. Montos en pesos en pantalla,
// centavos hacia el Host.
const TYPES = [
  { key: "servicios", label: "Pago de servicios", hint: "CFE, Telmex, cable, agua…" },
  { key: "recargas", label: "Recargas", hint: "Tiempo aire" },
  { key: "paquetes", label: "Paquetes", hint: "Datos y planes" },
  { key: "tarjetas", label: "Tarjetas de regalo", hint: "Google Play, Spotify…" },
];
const CATEGORY_LABEL = {
  recargas: "Recarga",
  paquetes: "Paquete",
  servicios: "Servicio",
  tarjetas: "Tarjeta",
};

const toPesos = (cents) => (cents ? String(cents / 100) : "");
const toCents = (pesos) => {
  const n = parseFloat(String(pesos).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const cleanPesos = (raw) => {
  const v = String(raw).replace(/[^\d.]/g, "");
  const [int, ...rest] = v.split(".");
  return rest.length ? `${int}.${rest.join("").slice(0, 2)}` : int;
};

const MoneyField = ({ id, value, onChange, label, className = "" }) => (
  <div className={`relative ${className}`}>
    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
      $
    </span>
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(cleanPesos(e.target.value))}
      placeholder="0"
      className="h-9 w-24 pl-6 text-right text-sm font-semibold tabular-nums"
    />
  </div>
);

const ServiceFeesDialog = ({ open, onOpenChange, operators = [], onSaved }) => {
  const [byType, setByType] = useState({});
  const [byCarrier, setByCarrier] = useState({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    setQuery("");
    window.api
      .invoke("taecel:get-fees")
      .then((r) => {
        if (!alive) return;
        const fees = r?.fees || {};
        setByType(
          Object.fromEntries(TYPES.map((t) => [t.key, toPesos(fees.byCategory?.[t.key])])),
        );
        setByCarrier(
          Object.fromEntries(
            Object.entries(fees.byCarrier || {}).map(([id, c]) => [id, c ? String(c / 100) : "0"]),
          ),
        );
      })
      .catch((e) => alive && setError(e?.message || "No se pudo leer la comisión"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  const byId = useMemo(
    () => new Map(operators.map((op) => [String(op.id ?? op.key), op])),
    [operators],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return operators
      .filter((op) => !(String(op.id ?? op.key) in byCarrier))
      .filter((op) => String(op.name || "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, operators, byCarrier]);

  const addCarrier = (op) => {
    const id = String(op.id ?? op.key);
    setByCarrier((prev) => ({ ...prev, [id]: byType[op.category] || "0" }));
    setQuery("");
  };
  const removeCarrier = (id) =>
    setByCarrier((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const fees = {
        byCategory: Object.fromEntries(TYPES.map((t) => [t.key, toCents(byType[t.key])])),
        byCarrier: Object.fromEntries(
          Object.entries(byCarrier).map(([id, pesos]) => [id, toCents(pesos)]),
        ),
      };
      const r = await window.api.invoke("taecel:set-fees", { fees });
      if (!r?.ok) {
        throw new Error(
          r?.code === "FORBIDDEN"
            ? "Sólo un administrador puede cambiar la comisión"
            : r?.error || "No se pudo guardar",
        );
      }
      onSaved?.();
      onOpenChange?.(false);
    } catch (err) {
      setError(err?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const overrides = Object.keys(byCarrier);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Comisión de la tienda</DialogTitle>
          <DialogDescription>
            Se cobra encima del importe y queda como ganancia de la tienda. A Taecel
            sólo se le paga el importe del recibo o la recarga.
          </DialogDescription>
        </DialogHeader>

        <form id="service-fees" onSubmit={handleSave} className="flex flex-col gap-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 size={18} className="animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : (
            <>
              <section className="flex flex-col gap-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Por tipo
                </h3>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {TYPES.map((t) => (
                    <label
                      key={t.key}
                      htmlFor={`fee-${t.key}`}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">{t.label}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{t.hint}</span>
                      </span>
                      <MoneyField
                        id={`fee-${t.key}`}
                        label={`Comisión ${t.label}`}
                        value={byType[t.key] || ""}
                        onChange={(v) => setByType((prev) => ({ ...prev, [t.key]: v }))}
                      />
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Vacío o $0 = sin comisión.
                </p>
              </section>

              <section className="flex flex-col gap-1.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Otra comisión para una compañía
                </h3>
                {overrides.length > 0 && (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {overrides.map((id) => {
                      const op = byId.get(id);
                      return (
                        <div key={id} className="flex items-center gap-2.5 px-3 py-1.5">
                          <OperatorIcon
                            id={op?.logo}
                            remote={op?.remoteLogo}
                            name={op?.name || id}
                            size="sm"
                            className="w-8 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {op?.name || `Compañía ${id}`}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {op ? CATEGORY_LABEL[op.category] || "" : "Ya no está en el catálogo"}
                            </span>
                          </span>
                          <MoneyField
                            label={`Comisión ${op?.name || id}`}
                            value={byCarrier[id]}
                            onChange={(v) => setByCarrier((prev) => ({ ...prev, [id]: v }))}
                          />
                          <button
                            type="button"
                            onClick={() => removeCarrier(id)}
                            aria-label={`Quitar ${op?.name || id}`}
                            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X size={14} aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="relative">
                  <Search
                    size={14}
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar compañía (ej. CFE)"
                    aria-label="Buscar compañía"
                    autoComplete="off"
                    className="h-9 pl-8 text-sm"
                  />
                </div>
                {matches.length > 0 && (
                  <div className="flex flex-col rounded-lg border border-border">
                    {matches.map((op) => (
                      <button
                        key={op.id ?? op.key}
                        type="button"
                        onClick={() => addCarrier(op)}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <Plus size={13} aria-hidden className="text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium">{op.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {CATEGORY_LABEL[op.category] || ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange?.(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || loading} className="gap-1.5">
              {saving ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Save size={13} aria-hidden />
              )}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ServiceFeesDialog;
