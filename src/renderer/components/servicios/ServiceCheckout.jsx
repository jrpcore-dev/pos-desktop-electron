import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KIND_LABEL,
  filterOperators,
  getOperator,
  quote,
  toUiTransaction,
  validateInput,
} from "./taecelCatalog";
import { useToast } from "@/components/ToastProvider";
import { NEEDS_ATTENTION } from "./serviceStatus";
import { OperatorIcon } from "./OperatorIcon";
import ServiceCatalog from "./ServiceCatalog";
import ServiceProductPicker from "./ServiceProductPicker";
import ServiceInputField from "./ServiceInputField";
import ServiceSummary from "./ServiceSummary";
import ServiceResult from "./ServiceResult";

const firstSku = (op) => op?.products?.[0]?.sku || "";

// Mientras Taecel no da una respuesta final, se vuelve a consultar el estado
// (nunca a cobrar) cada pocos segundos, hasta un límite.
const POLL_MS = 4000;
const POLL_MAX = 15;

const newRequestId = () =>
  window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const ServiceCheckout = ({ operators, onTransaction, providerLive = false }) => {
  const notify = useToast();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [sku, setSku] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [tx, setTx] = useState(null);
  const [busy, setBusy] = useState(false);
  const polls = useRef(0);

  // Al llegar el catálogo se elige el primer operador.
  useEffect(() => {
    if (!operatorKey && operators?.length) setOperatorKey(operators[0].key);
  }, [operators, operatorKey]);

  const operator = useMemo(
    () => getOperator(operators, operatorKey),
    [operators, operatorKey],
  );
  const product = useMemo(
    () => operator?.products?.find((p) => p.sku === sku) || null,
    [operator, sku],
  );
  const quoteData = useMemo(
    () => (product ? quote(operator, product.amountCents) : null),
    [operator, product],
  );

  const reset = useCallback(() => {
    setSku(firstSku(operator));
    setInputValue("");
    setConfirmValue("");
    setInputError("");
    setTx(null);
    setBusy(false);
    polls.current = 0;
  }, [operator]);

  // Cambiar de operador reinicia la captura (mismo cuerpo que `reset`).
  useEffect(() => {
    reset();
  }, [operatorKey, operator, reset]);

  const handleCategoryChange = (next) => {
    setCategory(next);
    const list = filterOperators(operators, next, query);
    if (list.length && !list.some((o) => o.key === operatorKey)) {
      setOperatorKey(list[0].key);
    }
  };

  const validation = operator ? validateInput(operator, inputValue) : { ok: false };
  const confirmOk =
    !operator ||
    operator.input?.kind === "none" ||
    !operator.input?.confirmar ||
    confirmValue === inputValue;
  const canCharge =
    providerLive &&
    !!product &&
    validation.ok &&
    confirmOk &&
    !!quoteData &&
    !busy &&
    !tx;

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
      operatorName: operator.name,
      productName: product.name,
      sku: product.sku,
      inputValue,
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
        paymentMethod: "cash",
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
  }, [operator, product, inputValue, quoteData, tx, display, onTransaction]);

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
  if (!product) blockedHint = "Elige un producto";
  else if (!validation.ok) blockedHint = validation.error || "Captura el dato";
  else if (!confirmOk) blockedHint = "Repite el dato para confirmar";

  return (
    <form
      onSubmit={handleSubmit}
      className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]"
    >
      <section className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:h-[calc(100dvh-var(--app-chrome-h)-7.5rem)]">
        <ServiceCatalog
          operators={operators}
          category={category}
          onCategoryChange={handleCategoryChange}
          operatorKey={operatorKey}
          onOperatorChange={setOperatorKey}
          query={query}
          onQueryChange={setQuery}
          disabled={busy}
        />
      </section>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-3">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            {operator ? (
              <>
                <OperatorIcon
                  id={operator.logo}
                  name={operator.name}
                  size="md"
                  className="w-12"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold uppercase leading-tight tracking-wide text-foreground">
                    {operator.name}
                  </p>
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[operator.kind]}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">
                Sin operador
              </p>
            )}
          </div>

          <div className="p-3.5">
            {tx ? (
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
            ) : (
              <div className="flex flex-col gap-3">
                <ServiceProductPicker
                  operator={operator}
                  selectedSku={sku}
                  onSelect={setSku}
                  disabled={busy}
                />
                <ServiceInputField
                  key={operatorKey}
                  spec={operator?.input}
                  value={inputValue}
                  onChange={(v) => {
                    setInputValue(v);
                    if (inputError) setInputError("");
                  }}
                  confirm={confirmValue}
                  onConfirmChange={setConfirmValue}
                  error={inputError}
                  autoFocus
                />
                <ServiceSummary
                  quote={quoteData}
                  canCharge={canCharge}
                  blockedHint={blockedHint}
                  onReset={reset}
                  disabled={busy}
                />
              </div>
            )}
          </div>
        </div>

        {tx && NEEDS_ATTENTION.includes(tx.status) && !busy && (
          <p className="text-[11px] text-muted-foreground">
            {tx.status === "unknown"
              ? "Falta la confirmación de Taecel. Se consulta la misma operación; no se vuelve a cobrar."
              : tx.status === "needs_review"
                ? "Taecel aplicó la recarga pero la venta no se registró. Avisa al administrador; no la cobres otra vez."
                : "Taecel rechazó la operación: el reintento es un cobro nuevo."}
          </p>
        )}
      </aside>
    </form>
  );
};

export default ServiceCheckout;