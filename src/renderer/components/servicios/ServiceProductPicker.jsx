import { useMemo, useState } from "react";
import {
  Check,
  Clock,
  Gift,
  MessageCircle,
  Phone,
  Sparkles,
  TriangleAlert,
  Wifi,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";
import { isFreeAmount } from "./taecelCatalog";
import { VIGENCIA_BUCKETS, bucketOf, parsePackage } from "./packageInfo";

/* Lo que trae un producto, en chips con ícono. `withVigencia: false` la omite
   (la tarjeta de paquete ya la muestra como etiqueta propia). */
const featureChips = (info, { withVigencia = true } = {}) =>
  [
    info.data && { Icon: Wifi, label: info.data === "Ilimitado" ? "Internet ilimitado" : `${info.data} navegación` },
    info.social && { Icon: MessageCircle, label: info.social.label },
    info.social?.waUnlimited && { Icon: MessageCircle, label: "WhatsApp ilimitado" },
    info.calls && { Icon: Phone, label: info.calls },
    withVigencia && info.vigencia && { Icon: Clock, label: info.vigencia.label },
    ...info.extras.map((e) => ({ Icon: e.startsWith("Regalo") ? Gift : Sparkles, label: e })),
  ].filter(Boolean);

export const Chip = ({ Icon, label, active }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4",
      active ? "bg-card text-foreground ring-1 ring-primary/20" : "bg-muted text-muted-foreground",
    )}
  >
    <Icon size={11} className={active ? "text-primary" : undefined} aria-hidden />
    {label}
  </span>
);

/* Pastilla de recarga: el monto manda; debajo, la vigencia si el carrier
   la publica. Activa = degradado Vendia. */
export const AmountPill = ({ product, active, onSelect, disabled }) => {
  const info = parsePackage(product);
  const cents = product.amountCents % 100;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      data-option
      className={cn(
        "relative flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-2 transition-all duration-150",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-chart-2 bg-primary text-primary-foreground shadow-md ring-2 ring-chart-2/40"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/[0.05]",
      )}
    >
      <span className="flex items-start font-extrabold tabular-nums leading-none">
        <span className="mt-0.5 text-[11px] opacity-70">$</span>
        <span className="text-xl">{Math.floor(product.amountCents / 100)}</span>
        {cents > 0 && <span className="mt-0.5 text-[11px]">.{String(cents).padStart(2, "0")}</span>}
      </span>
      {info.vigencia && (
        <span
          className={cn(
            "text-[10px] font-semibold leading-none",
            active ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {info.vigencia.label}
        </span>
      )}
      {active && (
        <Check size={12} strokeWidth={3} className="absolute right-1.5 top-1.5" aria-hidden />
      )}
    </button>
  );
};

/* Tarjeta de paquete: lo que el cliente pregunta («¿cuántos datos?,
   ¿cuánto dura?») arriba y grande; el resto en chips. Si el carrier no
   escribió nada reconocible se muestra su texto tal cual. */
export const PackageCard = ({ product, active, onSelect, disabled }) => {
  const info = parsePackage(product);
  const chips = featureChips(info, { withVigencia: false }).filter(
    (c) => c.Icon !== Wifi,
  );
  const headline =
    info.data === "Ilimitado"
      ? "Internet ilimitado"
      : info.data || info.social?.label || info.calls || null;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      data-option
      className={cn(
        "relative flex w-full cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-all duration-150",
        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-chart-2 bg-primary/[0.07] shadow-sm ring-2 ring-chart-2/40"
          : "border-border bg-card hover:border-primary/50 hover:shadow-sm",
      )}
    >
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          {headline ? (
            <span className="flex items-baseline gap-1.5">
              <span className="text-lg font-extrabold leading-tight text-foreground">
                {headline}
              </span>
              {info.data && info.data !== "Ilimitado" && (
                <span className="text-xs font-medium text-muted-foreground">para navegar</span>
              )}
            </span>
          ) : (
            <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
              {product.name}
            </span>
          )}
          {info.vigencia && (
            <span
              className={cn(
                "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
                active ? "bg-primary text-primary-foreground" : "bg-primary/[0.07] text-primary",
              )}
            >
              <Clock size={11} aria-hidden />
              {info.vigencia.label}
            </span>
          )}
        </span>
        <span
          className={cn(
            "shrink-0 text-xl font-extrabold tabular-nums leading-tight",
            active ? "text-primary" : "text-foreground",
          )}
        >
          {/* Servicios de monto libre (CFE) no traen precio: el importe lo
              captura el cajero, así que aquí no se pinta nada. */}
          {product.amountCents > 0 && money(product.amountCents)}
        </span>
      </span>

      {chips.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <Chip key={c.label} {...c} active={active} />
          ))}
        </span>
      )}

      {info.notes.map((n) => (
        <span
          key={n}
          className="flex items-center gap-1 text-[11px] font-medium text-warning-foreground dark:text-warning"
        >
          <TriangleAlert size={11} className="text-warning" aria-hidden />
          {n}
        </span>
      ))}

      {active && (
        <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary shadow-sm">
          <Check size={12} strokeWidth={3} className="text-primary-foreground" aria-hidden />
        </span>
      )}
    </button>
  );
};

// Recargas en pastillas de monto; paquetes como tarjetas con su contenido.
const ServiceProductPicker = ({ operator, selectedSku, onSelect, disabled, listRef }) => {
  const [bucket, setBucket] = useState("all");
  // Recargas van en pastillas de monto; todo lo demás (paquetes, servicios y
  // tarjetas) va en tarjeta. Un servicio de monto libre no tiene productos que
  // filtrar por vigencia, así que se salta los filtros de paquete.
  const isPackage = operator ? operator.category !== "telefonia" : false;
  const isFree = operator ? isFreeAmount(operator) : false;
  const products = operator?.products || [];

  const buckets = useMemo(() => {
    if (isFree || !isPackage || products.length < 5) return [];
    const present = new Set(products.map(bucketOf).filter(Boolean));
    const list = VIGENCIA_BUCKETS.filter((b) => present.has(b.key));
    return list.length > 1 ? list : [];
  }, [isFree, isPackage, products]);

  // Si el filtro activo ya no existe en este operador, se muestran todos.
  const activeBucket = buckets.some((b) => b.key === bucket) ? bucket : "all";
  const visible =
    activeBucket === "all" ? products : products.filter((p) => bucketOf(p) === activeBucket);

  const selected = products.find((p) => p.sku === selectedSku) || null;
  const selectedChips = selected && !isPackage ? featureChips(parsePackage(selected)) : [];

  if (!operator) return null;

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      {buckets.length > 0 && (
        <div role="group" aria-label="Vigencia" className="flex flex-wrap gap-1">
          {[{ key: "all", label: "Todos" }, ...buckets].map((b) => {
            const active = b.key === activeBucket;
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={active}
                onClick={() => setBucket(b.key)}
                className={cn(
                  "h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={listRef}
        className={cn(
          isPackage
            ? "flex flex-col gap-2"
            : "grid grid-cols-3 content-start gap-2 xl:grid-cols-4",
        )}
      >
        {visible.map((p) =>
          isPackage ? (
            <PackageCard
              key={p.sku}
              product={p}
              active={p.sku === selectedSku}
              onSelect={() => onSelect(p.sku)}
              disabled={disabled}
            />
          ) : (
            <AmountPill
              key={p.sku}
              product={p}
              active={p.sku === selectedSku}
              onSelect={() => onSelect(p.sku)}
              disabled={disabled}
            />
          ),
        )}
      </div>

      {selectedChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-primary/[0.07] px-2.5 py-2">
          <span className="mr-0.5 text-[11px] font-bold text-primary">Incluye</span>
          {selectedChips.map((c) => (
            <Chip key={c.label} {...c} active />
          ))}
        </div>
      )}
    </div>
  );
};

export default ServiceProductPicker;
