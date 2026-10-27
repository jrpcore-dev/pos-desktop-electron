import { useEffect, useMemo, useRef } from "react";
import { Check, Clock, Package, Search, Sparkles, WifiOff, X } from "lucide-react";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";
import { CAT_TABS, familyInCategory, searchCatalog } from "./taecelCatalog";
import { parsePackage } from "./packageInfo";
import { money } from "./serviceMoney";
import { OperatorIcon } from "./OperatorIcon";

// Catálogo de compañías. Cada tile es una familia de marca (Telcel agrupa
// sus recargas, Internet Amigo y Amigo Sin Límite); el buscador además
// encuentra paquetes por monto, vigencia o contenido y los lista arriba.
const ServiceCatalog = ({
  families,
  category,
  onCategoryChange,
  selectedFamilyKey,
  onPick,
  query,
  onQueryChange,
  frequent = [],
  disabled,
  wide = false,
  loading = false,
}) => {
  const searchRef = useRef(null);
  const resultsRef = useRef(null);

  const result = useMemo(
    () => searchCatalog(families, query, category),
    [families, query, category],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        CAT_TABS.map((t) => [
          t.key,
          (families || []).filter((f) => familyInCategory(f, t.key)).length,
        ]),
      ),
    [families],
  );
  const searching = !result.query.empty;
  // "100" sin texto: al tocar una compañía se preselecciona ese monto.
  const amountHint =
    result.query.amounts.length === 1 && !result.query.words.length
      ? result.query.amounts[0]
      : null;

  // `/` enfoca el buscador desde cualquier parte de la pantalla.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickFamily = (fam) =>
    onPick(fam, { memberKey: fam.preferred, amountCents: amountHint, fromSearch: searching });

  const pickHit = (hit) =>
    onPick(hit.family, {
      memberKey: hit.operator.key,
      sku: hit.product.sku,
      fromSearch: true,
    });

  const handleSearchKey = (e) => {
    if (e.key === "Escape") {
      if (query) {
        e.preventDefault();
        e.stopPropagation();
        onQueryChange("");
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (result.hits.length) pickHit(result.hits[0]);
      else if (result.families.length) pickFamily(result.families[0]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      resultsRef.current?.querySelector("[data-result]")?.focus();
    }
  };

  // Flechas entre resultados (hits y tiles comparten `data-result`).
  const handleResultsKey = (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const items = [...(resultsRef.current?.querySelectorAll("[data-result]") || [])];
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
    if (!forward && i === 0) {
      searchRef.current?.focus();
      return;
    }
    items[Math.min(items.length - 1, Math.max(0, i + (forward ? 1 : -1)))]?.focus();
  };

  const nothing = searching && !result.families.length && !result.hits.length;

  if (loading) return <CatalogSkeleton wide={wide} />;
  if (!(families || []).length) return <CatalogEmpty />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Buscador */}
      <div className="relative shrink-0">
        <Search
          size={17}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-primary"
        />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="Busca compañía, monto o paquete — ej. «telcel 100», «internet 7 días»"
          aria-label="Buscar compañía, monto o paquete"
          className={cn(
            "h-12 w-full rounded-xl border border-input bg-field pl-10 pr-24 text-sm shadow-sm transition-colors",
            "placeholder:text-muted-foreground/80",
            "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15",
          )}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {query ? (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X size={15} aria-hidden />
            </button>
          ) : (
            <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted-foreground">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Categorías: control segmentado con conteo */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Categorías"
          className="inline-flex rounded-xl border border-border bg-muted/60 p-1"
        >
          {CAT_TABS.filter((tab) => tab.key === "all" || counts[tab.key] > 0).map((tab) => {
            const active = tab.key === category;
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={active}
                onClick={() => onCategoryChange(tab.key)}
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.name}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4",
                    active ? "bg-primary text-primary-foreground" : "bg-border text-muted-foreground",
                  )}
                >
                  {counts[tab.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        {searching && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {result.families.length} compañías
            {result.totalHits ? ` · ${result.totalHits} productos` : ""}
          </span>
        )}
      </div>

      <div
        ref={resultsRef}
        onKeyDown={handleResultsKey}
        className="-mr-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
      >
        {/* Frecuentes de hoy */}
        {!searching && category === "all" && frequent.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionTitle icon={Sparkles}>Más cobradas hoy</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {frequent.map((fam) => {
                const active = fam.key === selectedFamilyKey;
                return (
                  <button
                    key={fam.key}
                    type="button"
                    data-result
                    disabled={disabled}
                    onClick={() => onPick(fam, {})}
                    className={cn(
                      "flex h-11 cursor-pointer items-center gap-2 rounded-xl border bg-card pl-2 pr-3.5 text-sm font-semibold shadow-xs transition-all",
                      "hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      active ? "border-chart-2 text-primary ring-2 ring-chart-2/40" : "border-border text-foreground",
                    )}
                  >
                    <OperatorIcon id={fam.logo} remote={fam.remoteLogo} name={fam.name} size="sm" className="w-12" />
                    {fam.name}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Productos encontrados */}
        {result.hits.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionTitle icon={Package}>
              Productos encontrados
              {result.totalHits > result.hits.length && (
                <span className="font-normal normal-case tracking-normal">
                  {" "}
                  · mostrando {result.hits.length} de {result.totalHits}
                </span>
              )}
            </SectionTitle>
            <div className="grid gap-2 xl:grid-cols-2">
              {result.hits.map((hit) => (
                <HitRow
                  key={`${hit.operator.key}:${hit.product.sku}`}
                  hit={hit}
                  disabled={disabled}
                  onClick={() => pickHit(hit)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Compañías */}
        {result.families.length > 0 && (
          <section className="flex flex-col gap-2">
            {(searching || (category === "all" && frequent.length > 0)) && (
              <SectionTitle>Compañías</SectionTitle>
            )}
            <div
              className={cn(
                "grid content-start grid-cols-2 gap-3 sm:grid-cols-3",
                wide ? "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" : "2xl:grid-cols-4",
              )}
            >
              {result.families.map((fam) => (
                <FamilyTile
                  key={fam.key}
                  family={fam}
                  active={fam.key === selectedFamilyKey}
                  disabled={disabled}
                  onClick={() => pickFamily(fam)}
                />
              ))}
            </div>
          </section>
        )}

        {nothing && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary">
              <Search size={22} aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Nada coincide con “{query}”
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Prueba con el nombre de la compañía, un monto («50») o lo que
                incluye («redes», «7 días»).
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onQueryChange("")}
              className="gap-1.5"
            >
              <X size={14} aria-hidden />
              Limpiar búsqueda
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

// Mientras llega el catálogo de Taecel: misma silueta que la pantalla real
// (buscador, categorías y rejilla) para que nada brinque al cargar.
const CatalogSkeleton = ({ wide }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy="true" aria-label="Cargando catálogo">
    <Skeleton className="h-12 w-full rounded-xl" />
    <div className="flex gap-1.5">
      {[16, 20, 20, 20, 18].map((w, i) => (
        <Skeleton key={i} className="h-9 rounded-lg" style={{ width: `${w * 4}px` }} />
      ))}
    </div>
    <div
      className={cn(
        "grid content-start grid-cols-2 gap-3 overflow-hidden sm:grid-cols-3",
        wide ? "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" : "2xl:grid-cols-4",
      )}
    >
      {Array.from({ length: 18 }, (_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
          style={{ animationDelay: `${(i % 6) * 60}ms` }}
        >
          <div className="flex h-32 items-center justify-center px-6">
            <Skeleton className="h-12 w-3/4 rounded-lg" style={{ animationDelay: `${(i % 6) * 60}ms` }} />
          </div>
          <div className="flex justify-center border-t border-border px-3 py-3">
            <Skeleton className="h-3.5 w-1/2 rounded" style={{ animationDelay: `${(i % 6) * 60}ms` }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const CatalogEmpty = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
    <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
      <WifiOff size={22} aria-hidden />
    </div>
    <div>
      <p className="text-sm font-semibold text-foreground">Sin catálogo de Taecel</p>
      <p className="mx-auto mt-0.5 max-w-xs text-xs text-muted-foreground">
        No llegó el catálogo. Revisa la conexión o la configuración del proveedor y usa
        «Reintentar» o «Actualizar catálogo» arriba.
      </p>
    </div>
  </div>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
    {Icon && <Icon size={13} className="text-primary" aria-hidden />}
    {children}
  </h3>
);

const FamilyTile = ({ family, active, disabled, onClick }) => (
  <button
    type="button"
    data-result
    disabled={disabled}
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-xs transition-all duration-150",
      "hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
      active
        ? "border-chart-2 ring-2 ring-chart-2/40"
        : "border-border hover:border-primary/40",
    )}
  >
    <span
      className={cn(
        "flex h-32 items-center justify-center px-5 py-4 transition-colors",
        active ? "bg-primary/[0.07]" : "bg-card",
      )}
    >
      <OperatorIcon
        id={family.logo}
        remote={family.remoteLogo}
        name={family.name}
        size="xl"
        className="h-full w-full transition-transform duration-150 group-hover:scale-105"
      />
    </span>
    <span className="flex items-center justify-center border-t border-border px-3 py-2.5">
      <span
        className={cn(
          "line-clamp-1 text-center text-sm font-bold leading-tight",
          active ? "text-primary" : "text-foreground",
        )}
      >
        {family.name}
      </span>
    </span>
    {/* Sólo se marca lo que no es obvio: que la marca trae más de un producto. */}
    {extraLabel(family) && (
      <span className="absolute left-2 top-2">
        <Tag tone="primary">{extraLabel(family)}</Tag>
      </span>
    )}
    {active && (
      <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary shadow-sm">
        <Check size={14} className="text-primary-foreground" strokeWidth={3} aria-hidden />
      </span>
    )}
  </button>
);

const EXTRA_NOUN = {
  paquetes: ["paquete", "paquetes"],
  servicios: ["servicio", "servicios"],
  tarjetas: ["tarjeta", "tarjetas"],
};

// "+2 paquetes" en Telcel, "+2 tarjetas" en Xbox; "Paquetes" si la marca
// sólo vende paquetes (no hay recarga que "sumar").
const extraLabel = (family) => {
  const extra = family.members.slice(1);
  if (!extra.length) return family.category === "paquetes" ? "Paquetes" : null;
  const [one, many] = EXTRA_NOUN[extra[0].category] || ["opción", "opciones"];
  return `+${extra.length} ${extra.length === 1 ? one : many}`;
};

const Tag = ({ tone, children }) => (
  <span
    className={cn(
      "rounded-md px-1.5 py-px text-[10px] font-semibold leading-4",
      tone === "primary"
        ? "bg-primary/[0.07] text-primary"
        : "bg-muted text-muted-foreground",
    )}
  >
    {children}
  </span>
);

const HitRow = ({ hit, disabled, onClick }) => {
  const info = parsePackage(hit.product);
  const bits = [info.data && `${info.data} datos`, info.social?.label, info.calls].filter(
    Boolean,
  );
  return (
    <button
      type="button"
      data-result
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-2 pr-3 text-left shadow-xs transition-all",
        "hover:border-primary/50 hover:shadow-md focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-card px-1.5 ring-1 ring-border">
        <OperatorIcon id={hit.family.logo} remote={hit.family.remoteLogo} name={hit.family.name} size="sm" className="w-full" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-bold text-foreground">
            {hit.family.name}
          </span>
          <span className="shrink-0 rounded bg-primary/[0.07] px-1.5 text-[10px] font-semibold leading-4 text-primary">
            {hit.operator.memberLabel}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {bits.length ? bits.join(" · ") : hit.product.name}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-[15px] font-extrabold tabular-nums text-foreground">
          {hit.product.amountCents > 0 ? money(hit.product.amountCents) : "Monto libre"}
        </span>
        {info.vigencia && (
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
            <Clock size={10} aria-hidden />
            {info.vigencia.label}
          </span>
        )}
      </span>
    </button>
  );
};

export default ServiceCatalog;
