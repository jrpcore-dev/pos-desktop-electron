import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KIND_LABEL,
  filterOperators,
  getOperator,
  mockExecute,
  mockFolio,
  quote,
  validateInput,
} from "./serviceCatalog.mock";
import { useToast } from "@/components/ToastProvider";
import { NEEDS_ATTENTION } from "./serviceStatus";
import { OperatorIcon } from "./OperatorIcon";
import ServiceCatalog from "./ServiceCatalog";
import ServiceProductPicker from "./ServiceProductPicker";
import ServiceInputField from "./ServiceInputField";
import ServiceSummary from "./ServiceSummary";
import ServiceResult from "./ServiceResult";

const firstSku = (op) => op?.products?.[0]?.sku || "";

const ServiceCheckout = ({ onTransaction, providerLive = false }) => {
  const notify = useToast();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [operatorKey, setOperatorKey] = useState("TELCEL");
  const [sku, setSku] = useState("10");
  const [inputValue, setInputValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [tx, setTx] = useState(null);
  const [busy, setBusy] = useState(false);

  const operator = useMemo(() => getOperator(operatorKey), [operatorKey]);
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
  }, [operator]);

  // Cambiar de operador reinicia la captura (mismo cuerpo que `reset`).
  useEffect(() => {
    reset();
  }, [operatorKey, operator, reset]);

  const handleCategoryChange = (next) => {
    setCategory(next);
    const list = filterOperators(next, query);
    if (list.length && !list.some((o) => o.key === operatorKey)) {
      setOperatorKey(list[0].key);
    }
  };

  const validation = operator ? validateInput(operator, inputValue) : { ok: false };
  const confirmOk =
    !operator || operator.input?.kind === "none" || confirmValue === inputValue;
  const canCharge =
    !!product && validation.ok && confirmOk && !!quoteData && !busy && !tx;

  // Ejecuta la venta: va al WebService real si el proveedor está configurado;
  // sin proveedor usa la simulación local. Los servicios tipo CFE aún usan
  // simulación hasta tener `realizarServicio`.
  const runCharge = useCallback(
    async (folio) => {
      const api = window.api;
      if (providerLive && operator?.kind !== "bill" && api?.invoke) {
        try {
          const r = await api.invoke("vendesaldo:recharge", {
            operatorName: operator.name,
            sku: product.sku,
            phone: inputValue,
          });
          if (r?.ok) {
            return {
              status: "applied",
              providerRef: r.providerRef || folio,
              message: r.message || "Recarga aplicada por el proveedor",
            };
          }
          return {
            status: "failed",
            providerRef: "",
            message: r?.error || "El proveedor rechazó la recarga",
          };
        } catch (e) {
          return {
            status: "failed",
            providerRef: "",
            message: e?.message || "Error de red con el proveedor",
          };
        }
      }
      return mockExecute({ folio });
    },
    [providerLive, operator, product, inputValue],
  );

  const charge = useCallback(async () => {
    if (!operator || !product || !quoteData) return;

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
      operatorLogo: operator.logo,
      operatorName: operator.name,
      productName: product.name,
      sku: product.sku,
      inputValue,
      quote: quoteData,
    });

    const res = await runCharge(folio);

    const next = {
      folio,
      status: res.status,
      providerRef: res.providerRef,
      message: res.message,
      operatorKey: operator.key,
      operatorLogo: operator.logo,
      operatorName: operator.name,
      productName: product.name,
      sku: product.sku,
      inputValue,
      quote: quoteData,
    };
    setTx(next);
    setBusy(false);
    onTransaction?.(next);
  }, [operator, product, inputValue, quoteData, tx, runCharge, onTransaction]);

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
              ? "Confirmado por el proveedor"
              : "El proveedor no encontró la operación",
        };
        onTransaction?.(next);
        return next;
      });
    },
    [onTransaction],
  );

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
                onRetry={charge}
                onDone={reset}
                onReconcile={reconcile}
                onPrint={() =>
                  notify("El ticket se imprime cuando exista el proveedor", "info")
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
              ? "El pago sí entró, falta la confirmación del proveedor. El reintento usa el mismo folio."
              : "El reintento usa el mismo folio para no cobrar dos veces."}
          </p>
        )}
      </aside>
    </form>
  );
};

export default ServiceCheckout;