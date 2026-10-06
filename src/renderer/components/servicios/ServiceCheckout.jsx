import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL,
  filterOperators,
  getOperator,
  mockExecute,
  mockFolio,
  quote,
  setNextMockStatus,
  validateInput,
} from "./serviceCatalog.mock";
import { useToast } from "@/components/ToastProvider";
import { NEEDS_ATTENTION } from "./serviceStatus";
import { OperatorIcon } from "./OperatorIcon";
import ServiceCatalog from "./ServiceCatalog";
import ServiceAmountPicker from "./ServiceAmountPicker";
import ServiceInputField from "./ServiceInputField";
import ServiceSummary from "./ServiceSummary";
import ServiceResult from "./ServiceResult";

const FORCED = [
  { key: "applied", label: "Aplicada" },
  { key: "failed", label: "Fallida" },
  { key: "unknown", label: "Por verificar" },
  { key: "reversed", label: "Revertida" },
];

const ServiceCheckout = ({ onTransaction }) => {
  const notify = useToast();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [operatorKey, setOperatorKey] = useState("telcel");
  const [amountCents, setAmountCents] = useState(2000);
  const [inputValue, setInputValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [tx, setTx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forced, setForced] = useState(null);

  const operator = useMemo(() => getOperator(operatorKey), [operatorKey]);
  const quoteData = useMemo(
    () => (operator ? quote(operator, amountCents) : null),
    [operator, amountCents],
  );

  const reset = useCallback(() => {
    setAmountCents(operator?.amounts?.[0] || 0);
    setInputValue("");
    setConfirmValue("");
    setInputError("");
    setTx(null);
    setBusy(false);
  }, [operator]);

  useEffect(() => {
    setAmountCents(operator?.amounts?.[0] || 0);
    setInputValue("");
    setConfirmValue("");
    setInputError("");
    setTx(null);
    setBusy(false);
  }, [operatorKey]);

  const handleCategoryChange = (next) => {
    setCategory(next);
    const list = filterOperators(next, query);
    if (list.length && !list.some((o) => o.key === operatorKey)) {
      setOperatorKey(list[0].key);
    }
  };

  const inRange =
    !!operator &&
    (operator.fixedAmounts
      ? operator.amounts.includes(amountCents)
      : amountCents >= operator.minAmountCents &&
        amountCents <= operator.maxAmountCents);

  const validation = operator ? validateInput(operator, inputValue) : { ok: false };
  const confirmOk = !operator || operator.input?.kind === "none" || confirmValue === inputValue;
  const canCharge = inRange && validation.ok && confirmOk && !!quoteData && !busy && !tx;

  const charge = useCallback(async () => {
    if (!operator || !quoteData) return;

    const check = validateInput(operator, inputValue);
    if (!check.ok) {
      setInputError(check.error);
      return;
    }
    setInputError("");

    const folio = tx?.folio || mockFolio();
    setBusy(true);
    setTx({
      folio,
      status: "pending",
      operatorKey: operator.key,
      operatorName: operator.name,
      inputValue,
      quote: quoteData,
    });

    if (forced) setNextMockStatus(forced);

    const res = await mockExecute({ folio });

    const next = {
      folio,
      status: res.status,
      providerRef: res.providerRef,
      message: res.message,
      operatorKey: operator.key,
      operatorName: operator.name,
      inputValue,
      quote: quoteData,
    };
    setTx(next);
    setBusy(false);
    onTransaction?.(next);
  }, [operator, inputValue, quoteData, tx, forced, onTransaction]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (canCharge) charge();
  };

  const reconcile = useCallback(
    async (folio) => {
      const res = await mockExecute({ folio });
      setTx((cur) => {
        if (!cur || cur.folio !== folio) return cur;
        const next = {
          ...cur,
          status: res.status,
          providerRef: res.providerRef || cur.providerRef,
          message:
            res.status === "applied"
              ? "Confirmado por el operador"
              : "El operador no encontró la operación",
        };
        onTransaction?.(next);
        return next;
      });
    },
    [onTransaction],
  );

  const setForcedNext = (key) => setForced((prev) => (prev === key ? null : key));

  let blockedHint = "";
  if (!inRange) blockedHint = "Elige un monto dentro del rango";
  else if (!validation.ok) blockedHint = validation.error || "Captura el dato";
  else if (!confirmOk) blockedHint = "Repite el dato para confirmar";

  return (
    <form
      onSubmit={handleSubmit}
      className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]"
    >
      <section className="flex min-h-0 flex-col gap-2.5 rounded-lg border border-border bg-card p-3 lg:h-[calc(100dvh-11rem)]">
        <ServiceCatalog
          category={category}
          onCategoryChange={handleCategoryChange}
          operatorKey={operatorKey}
          onOperatorChange={setOperatorKey}
          query={query}
          onQueryChange={setQuery}
          disabled={busy}
        />

        <div className="flex shrink-0 items-center gap-1.5 border-t border-dashed border-border pt-2">
          <FlaskConical size={11} className="text-muted-foreground" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Probar
          </span>
          {FORCED.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setForcedNext(f.key)}
              className={cn(
                "cursor-pointer rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                forced === f.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-3">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            {operator ? (
              <>
                <OperatorIcon
                  id={operator.logo}
                  name={operator.name}
                  size="md"
                  className="max-h-6 max-w-12 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-extrabold uppercase leading-tight tracking-wide text-foreground">
                    {operator.name}
                  </p>
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[operator.kind]}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[13px] font-semibold text-muted-foreground">
                Sin operador
              </p>
            )}
          </div>

          <div className="p-3">
            {tx ? (
              <ServiceResult
                tx={tx}
                busy={busy}
                onRetry={charge}
                onDone={reset}
                onReconcile={reconcile}
                onPrint={() =>
                  notify("El ticket se imprime cuando exista el proveedor", "info")
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                <ServiceAmountPicker
                  operator={operator}
                  amountCents={amountCents}
                  onAmountChange={setAmountCents}
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
              ? "El pago sí entró, falta la confirmación del operador. El reintento usa el mismo folio."
              : "El reintento usa el mismo folio para no cobrar dos veces."}
          </p>
        )}
      </aside>
    </form>
  );
};

export default ServiceCheckout;