import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import {
  buildFamilies,
  defaultMember,
  familyOfOperator,
  quote,
  toUiTransaction,
  validateInput,
} from "./taecelCatalog";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/utils";
import { NEEDS_ATTENTION } from "./serviceStatus";
import { OperatorIcon } from "./OperatorIcon";
import ServiceCatalog from "./ServiceCatalog";
import ServiceProductPicker from "./ServiceProductPicker";
import ServiceInputField from "./ServiceInputField";
import ServiceSummary from "./ServiceSummary";
import ServiceResult from "./ServiceResult";

// Mientras Taecel no da una respuesta final, se vuelve a consultar el estado
// (nunca a cobrar) cada pocos segundos, hasta un límite.
const POLL_MS = 4000;
const POLL_MAX = 15;

const PANEL_H = "lg:h-[calc(100dvh-var(--app-chrome-h)-7.5rem)]";

const newRequestId = () =>
  window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const isToday = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

const ServiceCheckout = ({
  operators,
  transactions = [],
  onTransaction,
  providerLive = false,
  cashierId = null,
}) => {
  const notify = useToast();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [sku, setSku] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [received, setReceived] = useState("");
  const [tx, setTx] = useState(null);
  const [busy, setBusy] = useState(false);
  // Foco pedido tras un render (el campo puede no existir todavía).
  const [focusReq, setFocusReq] = useState(null);
  const polls = useRef(0);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const listRef = useRef(null);
  const chargeRef = useRef(null);

  const families = useMemo(() => buildFamilies(operators), [operators]);
  const family = useMemo(
    () => familyOfOperator(families, operatorKey),
    [families, operatorKey],
  );
  // El miembro de la familia trae `memberLabel` ("Recargas", "Internet Amigo").
  const operator = useMemo(
    () => family?.members.find((m) => m.key === operatorKey) || null,
    [family, operatorKey],
  );
  const product = useMemo(
    () => operator?.products?.find((p) => p.sku === sku) || null,
    [operator, sku],
  );
  const quoteData = useMemo(
    () => (product ? quote(operator, product.amountCents) : null),
    [operator, product],
  );

  // Compañías más cobradas hoy (aplicadas), para tenerlas a un toque.
  const frequent = useMemo(() => {
    const counts = new Map();
    for (const t of transactions || []) {
      if (t.status !== "applied" || !t.createdAt || !isToday(t.createdAt)) continue;
      const fam = familyOfOperator(families, t.operatorKey);
      if (fam) counts.set(fam, (counts.get(fam) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([fam]) => fam);
  }, [transactions, families]);

  const validation = operator ? validateInput(operator, inputValue) : { ok: false };
  const confirmOk =
    !operator ||
    operator.input?.kind === "none" ||
    !operator.input?.confirmar ||
    confirmValue === inputValue;
  const numberReady = !!operator && validation.ok && confirmOk;
  const canCharge = providerLive && !!product && numberReady && !!quoteData && !busy && !tx;

  useEffect(() => {
    if (!focusReq) return;
    const id = requestAnimationFrame(() => {
      if (focusReq.target === "input") inputRef.current?.focus();
      else if (focusReq.target === "charge") chargeRef.current?.focus();
      else if (focusReq.target === "list") {
        const list = listRef.current;
        (list?.querySelector("[aria-pressed=true]") || list?.querySelector("[data-option]"))?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [focusReq]);

  const focusNext = (target) => setFocusReq({ target, at: Date.now() });

  const clearCapture = () => {
    setInputValue("");
    setConfirmValue("");
    setInputError("");
    setReceived("");
  };

  // Elegir compañía (tile, frecuente o resultado de búsqueda). Cambiar de
  // compañía borra el número; cambiar entre recargas y paquetes de la misma,
  // no: es el mismo cliente.
  const pick = (fam, { memberKey, sku: wantSku, amountCents, fromSearch } = {}) => {
    const member =
      fam.members.find((m) => m.key === memberKey) || defaultMember(fam, category);
    const sameFamily = family?.key === fam.key;
    const nextSku =
      wantSku ||
      (amountCents && member.products.find((p) => p.amountCents === amountCents)?.sku) ||
      "";
    setOperatorKey(member.key);
    setSku(nextSku);
    setTx(null);
    polls.current = 0;
    if (!sameFamily) clearCapture();
    if (fromSearch) setQuery("");
    const keepNumber = sameFamily && numberReady;
    focusNext(keepNumber ? (nextSku ? "charge" : "list") : "input");
  };

  const switchMember = (member) => {
    if (member.key === operatorKey) return;
    setOperatorKey(member.key);
    setSku("");
    focusNext(numberReady ? "list" : "input");
  };

  const reset = useCallback(() => {
    setSku("");
    clearCapture();
    setTx(null);
    setBusy(false);
    polls.current = 0;
    focusNext("input");
  }, []);

  const closeOperator = () => {
    setOperatorKey("");
    setSku("");
    clearCapture();
    setTx(null);
    polls.current = 0;
  };

  const handleCategoryChange = (next) => setCategory(next);

  const handleSelectSku = (next) => {
    setSku(next);
    focusNext(numberReady ? "charge" : "input");
  };

  const display = useCallback(
    (row, fallback) => ({
      ...fallback,
      ...toUiTransaction(row),
      operatorLogo: operator?.logo || fallback?.operatorLogo,
      inputValue: fallback?.inputValue ?? row?.inputValue,
    }),
    [operator],
  );

  // Cobro: el Host habla con Taecel. `clientRequestId` es la llave de
  // idempotencia: el mismo intento nunca se cobra dos veces aunque se repita
  // la llamada (timeout, doble clic).
  const charge = useCallback(async () => {
    if (!operator || !product || !quoteData) return;

    const check = validateInput(operator, inputValue);
    if (!check.ok) {
      setInputError(check.error);
      return;
    }
    setInputError("");

    // Un intento FALLIDO es definitivo en Taecel: el reintento es un cobro
    // nuevo con su propio id. Uno pendiente o desconocido se consulta.
    const clientRequestId =
      tx && tx.status !== "failed" && tx.clientRequestId
        ? tx.clientRequestId
        : newRequestId();
    const base = {
      clientRequestId,
      folio: tx?.folio || "—",
      status: "pending",
      operatorKey: operator.key,
      operatorLogo: operator.logo,
      operatorRemoteLogo: operator.remoteLogo,
      operatorName: operator.name,
      productName: product.name,
      sku: product.sku,
      inputValue,
      paymentMethod,
      quote: quoteData,
    };
    setBusy(true);
    setTx(base);
    polls.current = 0;

    let next;
    try {
      const r = await window.api.invoke("taecel:recharge", {
        clientRequestId,
        productCode: product.sku,
        reference: inputValue,
        amountCents: product.amountCents,
        paymentMethod,
        cashierId,
      });
      next =
        r && r.status
          ? display(r, base)
          : {
              ...base,
              status: "failed",
              message: r?.error || "Taecel rechazó la recarga",
            };
    } catch (e) {
      // La llamada no volvió: no se sabe si Taecel la aplicó. Se consulta
      // con el mismo id en vez de cobrar otra vez.
      next = {
        ...base,
        status: "unknown",
        message: e?.message || "Sin respuesta del Host",
      };
    }
    setTx(next);
    setBusy(false);
    onTransaction?.(next);
  }, [operator, product, inputValue, quoteData, paymentMethod, cashierId, tx, display, onTransaction]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (canCharge) charge();
  };

  // Consulta el estado de la operación en curso (no cobra).
  const reconcile = useCallback(async () => {
    const cur = tx;
    if (!cur?.clientRequestId) return;
    try {
      const r = await window.api.invoke("taecel:transaction-status", {
        clientRequestId: cur.clientRequestId,
      });
      if (!r?.ok || !r.transaction) return;
      const next = display(r.transaction, cur);
      setTx((prev) =>
        prev && prev.clientRequestId === cur.clientRequestId ? next : prev,
      );
      onTransaction?.(next);
    } catch (e) {
      // Se reintenta en el siguiente ciclo.
    }
  }, [tx, display, onTransaction]);

  useEffect(() => {
    if (!tx || busy) return undefined;
    if (tx.status !== "pending" && tx.status !== "unknown") return undefined;
    if (polls.current >= POLL_MAX) return undefined;
    const t = setTimeout(() => {
      polls.current += 1;
      reconcile();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [tx, busy, reconcile]);

  const retry = useCallback(() => {
    if (tx?.status === "unknown" || tx?.status === "pending") {
      polls.current = 0;
      reconcile();
      return;
    }
    charge();
  }, [tx, reconcile, charge]);

  let blockedHint = "";
  if (!validation.ok) blockedHint = validation.error || "Captura el número";
  else if (!confirmOk) blockedHint = "Repite el número para confirmar";
  else if (!product) blockedHint = "Elige un monto o paquete";
  else if (!providerLive) blockedHint = "Sin conexión con Taecel";

  const isPackage = operator && operator.category !== "telefonia";

  return (
    // Sin compañía elegida el catálogo ocupa todo el ancho; al elegir una,
    // el panel de cobro entra desde la derecha (misma curva que el Sheet).
    <form
      onSubmit={handleSubmit}
      className={cn(
        "grid items-start gap-3",
        operator && "lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]",
      )}
    >
      <section
        className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-card p-3", PANEL_H)}
      >
        <ServiceCatalog
          families={families}
          category={category}
          onCategoryChange={handleCategoryChange}
          selectedFamilyKey={family?.key}
          onPick={pick}
          query={query}
          onQueryChange={setQuery}
          frequent={frequent}
          disabled={busy}
          wide={!operator}
        />
      </section>

      {operator && (
        <aside
          key={family.key}
          className={cn(
            "flex min-h-0 flex-col gap-2 lg:sticky lg:top-3",
            "animate-in fade-in slide-in-from-right-8 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            PANEL_H,
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Compañía elegida */}
            <div className="shrink-0 border-b border-border bg-muted/40 px-3 pb-2.5 pt-3">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-card px-1.5">
                  <OperatorIcon
                    id={family.logo}
                    remote={family.remoteLogo}
                    name={family.name}
                    size="md"
                    className="w-full"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-extrabold leading-tight text-foreground">
                    {family.name}
                  </p>
                  <p className="truncate text-xs font-medium text-muted-foreground">
                    {operator.memberLabel}
                    {" · "}
                    {operator.products.length} {isPackage ? "paquetes" : "montos"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeOperator}
                  disabled={busy}
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={14} aria-hidden />
                  Cambiar
                </button>
              </div>

              {family.members.length > 1 && !tx && (
                <div
                  role="group"
                  aria-label="Tipo de producto"
                  className="mt-2.5 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
                >
                  {family.members.map((m) => {
                    const active = m.key === operatorKey;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => switchMember(m)}
                        className={cn(
                          "h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {m.memberLabel}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {tx ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
                <ServiceResult
                  tx={tx}
                  busy={busy}
                  onRetry={retry}
                  onDone={reset}
                  onPrint={() =>
                    notify(
                      `La recarga quedó como venta ${tx.saleFolio || ""}; reimprímela desde Transacciones`,
                      "info",
                    )
                  }
                />
              </div>
            ) : (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5">
                  <Step n={1} title={operator.input?.label || "Número"} done={numberReady} current={!numberReady}>
                    <ServiceInputField
                      key={family.key}
                      spec={operator.input}
                      value={inputValue}
                      onChange={(v) => {
                        setInputValue(v);
                        if (inputError) setInputError("");
                      }}
                      confirm={confirmValue}
                      onConfirmChange={setConfirmValue}
                      error={inputError}
                      inputRef={inputRef}
                      confirmRef={confirmRef}
                      onComplete={() => focusNext(sku ? "charge" : "list")}
                    />
                  </Step>

                  <Step
                    n={2}
                    title={isPackage ? "Paquete" : "Monto"}
                    done={!!product}
                    current={numberReady && !product}
                    aside={product ? undefined : `${operator.products.length} opciones`}
                  >
                    <ServiceProductPicker
                      key={operator.key}
                      operator={operator}
                      selectedSku={sku}
                      onSelect={handleSelectSku}
                      disabled={busy}
                      listRef={listRef}
                    />
                  </Step>
                </div>

                <div className="shrink-0 border-t border-border bg-card p-3.5">
                  <ServiceSummary
                    quote={quoteData}
                    canCharge={canCharge}
                    blockedHint={blockedHint}
                    onReset={reset}
                    disabled={busy}
                    paymentMethod={paymentMethod}
                    onPaymentMethodChange={setPaymentMethod}
                    received={received}
                    onReceivedChange={setReceived}
                    chargeRef={chargeRef}
                  />
                </div>
              </>
            )}
          </div>

          {tx && NEEDS_ATTENTION.includes(tx.status) && !busy && (
            <p className="shrink-0 text-[11px] text-muted-foreground">
              {tx.status === "unknown"
                ? "Falta la confirmación de Taecel. Se consulta la misma operación; no se vuelve a cobrar."
                : tx.status === "needs_review"
                  ? "Taecel aplicó la recarga pero la venta no se registró. Avisa al administrador; no la cobres otra vez."
                  : "Taecel rechazó la operación: el reintento es un cobro nuevo."}
            </p>
          )}
        </aside>
      )}
    </form>
  );
};

// Paso numerado del flujo: el círculo pasa a check al completarse y el
// paso en curso se resalta para que el cajero sepa qué sigue.
const Step = ({ n, title, done, current, aside, children }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
          done
            ? "bg-success text-success-foreground"
            : current
              ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
              : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check size={13} strokeWidth={3} aria-hidden /> : n}
      </span>
      <h3
        className={cn(
          "flex-1 text-xs font-bold uppercase tracking-wider",
          current || done ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {title}
      </h3>
      {aside && <span className="text-xs tabular-nums text-muted-foreground">{aside}</span>}
    </div>
    {children}
  </section>
);

export default ServiceCheckout;
