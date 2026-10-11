import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// 3b · INERTE: no está montado en ningún sitio todavía.
//
// Pad de NIP para reabrir una sesión caducada. Se superpone a la pantalla
// (capa fija) sin desmontar nada: la venta que estaba en curso sigue viva
// detrás del overlay y el carrito no se pierde.
const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0", "ok"];

export default function ReauthModal({
  open,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
  className,
}) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (open) setPin("");
  }, [open]);

  const push = useCallback((d) => setPin((p) => (p.length >= 8 ? p : p + d)), []);
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const confirm = useCallback(() => {
    if (pin.length >= 4 && onConfirm) onConfirm(pin);
  }, [pin, onConfirm]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) push(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") confirm();
      else if (e.key === "Escape" && onCancel) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, push, back, confirm, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar NIP"
        className={cn(
          "relative w-full max-w-xs rounded-xl border border-border bg-background shadow-xl",
          className,
        )}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold">Sesión expirada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu sesión expiró. Confirma tu NIP para continuar. Tu venta sigue aquí.
          </p>
        </div>

        <div className="px-5 pb-2">
          <div className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/40 text-xl tracking-[0.5em]">
            {"•".repeat(pin.length) || <span className="text-xs tracking-normal text-muted-foreground">—</span>}
          </div>
          {error ? (
            <p className="mt-2 text-center text-xs text-destructive">{error}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2 px-5 pb-5 pt-2">
          {PAD.map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy || k === "ok" && pin.length < 4}
              onClick={() => {
                if (k === "ok") confirm();
                else if (k === "borrar") back();
                else push(k);
              }}
              className={cn(
                "h-11 rounded-md border border-border text-sm font-medium",
                "hover:bg-accent disabled:opacity-40",
                k === "ok" && "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {k === "borrar" ? "⌫" : k === "ok" ? "OK" : k}
            </button>
          ))}
        </div>

        {onCancel ? (
          <div className="px-5 pb-5">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
