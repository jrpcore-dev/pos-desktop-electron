import { useMemo, useState } from "react";
import { Check, Clock, Gift, Globe, MessageSquareText, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "./serviceMoney";
import { parseGiftcard } from "./cardInfo";
import { OperatorIcon } from "./OperatorIcon";

// Grupos para marcas que venden cosas distintas (Cinépolis: boletos y
// combos; Nintendo: eShop y Switch Online). Sólo se muestran si hay más de uno.
const groupOf = (variant) => {
  const v = String(variant || "").toLowerCase();
  if (!v) return "Saldo";
  if (/boleto|entrada/.test(v)) return "Boletos";
  if (/combo/.test(v)) return "Combos";
  if (/premium|platino/.test(v)) return "Salas";
  if (/mes|365|online/.test(v)) return "Suscripción";
  return "Saldo";
};

/* Cómo funciona una tarjeta de regalo, dicho en una línea para el cajero. */
export const GiftcardHowTo = ({ operator }) => {
  const redeem = (operator?.products || [])
    .map((p) => parseGiftcard(p, operator.name)?.redeem)
    .find(Boolean);
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
      <MessageSquareText size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <b className="font-semibold text-foreground">El código llega por SMS</b> al celular del
        cliente al cobrar.
        {redeem && (
          <>
            {" "}
            Se canjea en <b className="font-semibold text-foreground">{redeem}</b>.
          </>
        )}
      </p>
    </div>
  );
};

/* Tarjeta con forma de gift card: logo arriba, valor grande abajo. */
const GiftTile = ({ product, operator, active, onSelect, disabled }) => {
  const info = parseGiftcard(product, operator.name);
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      data-option
      className={cn(
        "group relative flex aspect-[1.6/1] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border p-2.5 text-left transition-all duration-150",
        "bg-gradient-to-br from-card to-muted/70",
        "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary shadow-md ring-2 ring-primary/25"
          : "border-border hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
      )}
    >
      {/* Banda decorativa de tarjeta */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 size-20 rounded-full transition-colors",
          active ? "bg-primary/15" : "bg-primary/[0.06] group-hover:bg-primary/10",
        )}
      />
      <span className="relative flex items-start justify-between gap-2">
        <span className="flex h-7 w-14 items-center justify-start">
          <OperatorIcon
            id={operator.logo}
            remote={operator.remoteLogo}
            name={operator.name}
            size="sm"
            className="h-full w-full justify-start"
          />
        </span>
        {active ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary shadow-sm">
            <Check size={12} strokeWidth={3} className="text-primary-foreground" aria-hidden />
          </span>
        ) : (
          <Gift size={14} className="text-muted-foreground/60" aria-hidden />
        )}
      </span>
      <span className="relative min-w-0">
        <span
          className={cn(
            "block text-xl font-extrabold leading-none tabular-nums",
            active ? "text-primary" : "text-foreground",
          )}
        >
          {money(product.amountCents)}
        </span>
        {info.variant && (
          <span className="mt-1 block truncate text-[11px] font-semibold text-muted-foreground">
            {info.variant}
          </span>
        )}
      </span>
    </button>
  );
};

const Detail = ({ Icon, children, tone }) => (
  <span
    className={cn(
      "flex items-start gap-1.5 text-xs leading-snug",
      tone === "warning" ? "font-medium text-foreground" : "text-muted-foreground",
    )}
  >
    <Icon
      size={13}
      className={cn("mt-px shrink-0", tone === "warning" ? "text-warning" : "text-primary")}
      aria-hidden
    />
    <span>{children}</span>
  </span>
);

const ServiceGiftcardPicker = ({ operator, selectedSku, onSelect, disabled, listRef }) => {
  const [group, setGroup] = useState("all");
  const products = operator?.products || [];

  const groups = useMemo(() => {
    const set = new Set(products.map((p) => groupOf(parseGiftcard(p, operator?.name).variant)));
    return set.size > 1 ? [...set] : [];
  }, [products, operator]);

  const activeGroup = groups.includes(group) ? group : "all";
  const visible =
    activeGroup === "all"
      ? products
      : products.filter((p) => groupOf(parseGiftcard(p, operator.name).variant) === activeGroup);

  const selected = products.find((p) => p.sku === selectedSku) || null;
  const info = selected ? parseGiftcard(selected, operator.name) : null;

  if (!operator) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {groups.length > 0 && (
        <div role="group" aria-label="Tipo de tarjeta" className="flex flex-wrap gap-1">
          {["all", ...groups].map((g) => {
            const active = g === activeGroup;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={active}
                onClick={() => setGroup(g)}
                className={cn(
                  "h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {g === "all" ? "Todas" : g}
              </button>
            );
          })}
        </div>
      )}

      <div ref={listRef} className="grid grid-cols-2 gap-2 xl:grid-cols-3">
        {visible.map((p) => (
          <GiftTile
            key={p.sku}
            product={p}
            operator={operator}
            active={p.sku === selectedSku}
            onSelect={() => onSelect(p.sku)}
            disabled={disabled}
          />
        ))}
      </div>

      {info && (
        <div className="animate-in fade-in slide-in-from-top-1 flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5 duration-150">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
            {info.variant || "Tarjeta"} · {money(selected.amountCents)}
          </p>
          {info.blurb && <p className="text-xs leading-snug text-foreground">{info.blurb}</p>}
          {info.redeem && <Detail Icon={Globe}>Se canjea en {info.redeem}</Detail>}
          {info.vigencia && <Detail Icon={Clock}>{info.vigencia}</Detail>}
          {info.notes.map((n) => (
            <Detail key={n} Icon={TriangleAlert} tone="warning">
              {n}
            </Detail>
          ))}
        </div>
      )}
    </div>
  );
};

export default ServiceGiftcardPicker;
