import { useEffect } from "react";
import { CircleCheck, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { getStatus, maskInput } from "./serviceStatus";
import { ServiceResultArt } from "./serviceIcons";
import { money } from "./serviceMoney";
import { OperatorIcon } from "./OperatorIcon";

// Panel de resultado. Reemplaza el resumen mientras la transacción vive.
// `unknown` se explica en pantalla: el cliente ya pagó y no sabemos si el
// operador aplicó la recarga. Se reintenta con el MISMO folio para no cobrar dos veces.
const ServiceResult = ({ tx, onRetry, onDone, onReconcile, onPrint, busy }) => {
  const status = getStatus(tx.status);
  const needsInput = tx.operatorKey && tx.inputValue;

  useEffect(() => {
    if (tx.status !== "unknown") return undefined;
    const t = setTimeout(() => onReconcile?.(tx.folio), 2500);
    return () => clearTimeout(t);
  }, [tx.status, tx.folio, onReconcile]);

  return (
    <div className="flex flex-col items-center gap-3 p-3 text-center">
      <ServiceResultArt status={tx.status} ringClassName={status.artRing} />

      <div>
        <p className="text-sm font-bold text-foreground">{title(tx.status)}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {subtitle(tx.status)}
        </p>
      </div>

      <div className="w-full rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
          <OperatorIcon
            id={tx.operatorKey}
            name={tx.operatorName}
            size="sm"
            className="max-h-5 max-w-8"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">
              {tx.operatorName}
            </p>
            {needsInput && (
              <p className="truncate text-[10px] tabular-nums text-muted-foreground">
                {maskInput(tx.inputValue)}
              </p>
            )}
          </div>
          <span className="text-[13px] font-bold tabular-nums text-foreground">
            {money(tx.quote.totalCents)}
          </span>
        </div>

        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Folio
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">
            {tx.folio}
          </span>
        </div>

        {tx.providerRef && (
          <div className="flex items-center justify-between px-2.5 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Referencia
            </span>
            <span className="text-[11px] font-semibold tabular-nums text-foreground">
              {tx.providerRef}
            </span>
          </div>
        )}
      </div>

      {tx.message && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {tx.message}
        </p>
      )}

      <div className="mt-auto flex w-full flex-col gap-1.5">
        {tx.status === "applied" && (
          <>
            <Button
              size="lg"
              onClick={onDone}
              className="h-9 w-full gap-1.5 bg-success text-[13px] font-bold text-white hover:bg-success/90"
            >
              <CircleCheck size={15} />
              Cobrar otro
            </Button>
            <Button variant="outline" onClick={() => onPrint?.(tx)} className="h-9 w-full gap-1.5 text-[13px]">
              <Printer size={14} />
              Imprimir ticket
            </Button>
          </>
        )}

        {(tx.status === "failed" || tx.status === "unknown") && (
          <Button
            size="lg"
            onClick={() => onRetry(tx)}
            disabled={busy}
            className="h-9 w-full gap-1.5 text-[13px]"
          >
            {busy ? (
              <Spinner size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            Reintentar
          </Button>
        )}

        {tx.status === "pending" && (
          <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Consultando al operador
          </div>
        )}

        {(tx.status === "failed" || tx.status === "reversed") && (
          <Button variant="outline" onClick={onDone} className="h-9 w-full text-[13px]">
            Volver
          </Button>
        )}
      </div>
    </div>
  );
};

const title = (status) =>
  ({
    pending: "Procesando…",
    applied: "¡Recarga aplicada!",
    failed: "No se pudo aplicar",
    unknown: "Estamos verificando",
    reversed: "Recarga revertida",
  })[status] || "Procesando…";

const subtitle = (status) =>
  ({
    pending: "No retires el cambio todavía",
    applied: "Ya puede entregar su recarga",
    failed: "No se le cobró nada al cliente",
    unknown: "El pago sí entró, falta la confirmación",
    reversed: "El operador devolvió el importe",
  })[status] || "";

export default ServiceResult;