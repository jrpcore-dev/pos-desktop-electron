import { CircleCheck, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { getStatus, maskInput } from "./serviceStatus";
import { ServiceResultArt } from "./serviceIcons";
import { money } from "./serviceMoney";
import { OperatorIcon } from "./OperatorIcon";

// Panel de resultado. Reemplaza el resumen mientras la transacción vive.
// `unknown` se explica en pantalla: el cliente ya pagó y no sabemos si el
// operador aplicó la recarga. El checkout consulta el estado solo (misma
// operación, nunca un cobro nuevo); "Reintentar" fuerza esa consulta.
const ServiceResult = ({ tx, onRetry, onDone, onPrint, busy }) => {
  const status = getStatus(tx.status);
  const needsInput = tx.operatorKey && tx.inputValue;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-3 p-3 text-center"
    >
      <ServiceResultArt status={tx.status} ringClassName={status.artRing} />

      <div>
        <p className="text-base font-bold text-foreground">{title(tx.status)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {subtitle(tx.status)}
        </p>
      </div>

      <div className="w-full rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-2.5">
          <OperatorIcon
            id={tx.operatorLogo || tx.operatorKey}
            remote={tx.operatorRemoteLogo}
            name={tx.operatorName}
            size="sm"
            className="w-10"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {tx.operatorName}
            </p>
            {needsInput && (
              <p className="truncate text-xs tabular-nums text-muted-foreground">
                {maskInput(tx.inputValue)}
              </p>
            )}
          </div>
          <span className="text-sm font-bold tabular-nums text-foreground">
            {money(tx.quote.totalCents)}
          </span>
        </div>

        <div className="flex items-center justify-between px-2.5 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Folio
          </span>
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {tx.folio}
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-border px-2.5 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Forma de pago
          </span>
          <span className="text-xs font-semibold text-foreground">
            {paymentLabel(tx.paymentMethod)}
          </span>
        </div>

        {tx.providerRef && (
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Referencia
            </span>
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {tx.providerRef}
            </span>
          </div>
        )}
      </div>

      {tx.message && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {tx.message}
        </p>
      )}

      <div className="mt-auto flex w-full flex-col gap-2">
        {tx.status === "applied" && (
          <>
            <Button
              size="lg"
              onClick={onDone}
              className="h-11 w-full gap-1.5 bg-success text-sm font-bold text-success-foreground hover:bg-success/90"
            >
              <CircleCheck size={16} />
              Cobrar otro
            </Button>
            <Button variant="outline" onClick={() => onPrint?.(tx)} className="h-11 w-full gap-1.5 text-sm">
              <Printer size={15} />
              Imprimir ticket
            </Button>
          </>
        )}

        {(tx.status === "failed" || tx.status === "unknown") && (
          <Button
            size="lg"
            onClick={() => onRetry(tx)}
            disabled={busy}
            className="h-11 w-full gap-1.5 text-sm"
          >
            {busy ? (
              <Spinner size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            Reintentar
          </Button>
        )}

        {tx.status === "pending" && (
          <div className="flex items-center justify-center gap-2 py-1 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" />
            Consultando al operador
          </div>
        )}

        {(tx.status === "failed" ||
          tx.status === "reversed" ||
          tx.status === "needs_review") && (
          <Button variant="outline" onClick={onDone} className="h-11 w-full text-sm">
            Volver
          </Button>
        )}
      </div>
    </div>
  );
};

const paymentLabel = (method) =>
  ({ cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia" })[method] ||
  "Efectivo";

const title = (status) =>
  ({
    pending: "Procesando…",
    applied: "¡Recarga aplicada!",
    failed: "No se pudo aplicar",
    unknown: "Estamos verificando",
    reversed: "Recarga revertida",
    needs_review: "Aplicada, por revisar",
  })[status] || "Procesando…";

const subtitle = (status) =>
  ({
    pending: "No retires el cambio todavía",
    applied: "Ya puede entregar su recarga",
    failed: "No se le cobró nada al cliente",
    unknown: "El pago sí entró, falta la confirmación",
    reversed: "El operador devolvió el importe",
    needs_review: "La venta no quedó registrada en caja",
  })[status] || "";

export default ServiceResult;