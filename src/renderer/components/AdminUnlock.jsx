import React, { useState } from "react";
import { Loader2, Lock, ShieldCheck } from "lucide-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogBrandFooter,
  DialogBrandHeader,
  DialogContent,
} from "./ui/dialog";
import { Input } from "./ui/input";

// Candado para una sección que sólo un administrador puede cambiar: enseña los
// datos deshabilitados hasta que un administrador confirma con su NIP. La
// confirmación no cambia la sesión de quien está usando el sistema.
const AdminUnlock = ({ locked, onUnlock, children }) => {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setPin("");
    setError("");
  };

  const confirm = async () => {
    if (!pin || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await window.api.invoke("verify-admin-pin", pin);
      if (res?.success) {
        close();
        onUnlock();
      } else {
        setError(res?.error || "NIP incorrecto");
        setPin("");
      }
    } catch (err) {
      setError(err?.message || "No se pudo verificar el NIP");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/50 p-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Solo el administrador puede cambiar estos datos</p>
            <p className="text-xs text-muted-foreground">Pídele que confirme con su NIP para editarlos.</p>
          </div>
          <Button type="button" onClick={() => setOpen(true)}>
            <ShieldCheck className="h-4 w-4" />
            Desbloquear
          </Button>
        </div>
      )}

      <fieldset disabled={locked} className={locked ? "min-w-0 space-y-6 opacity-60" : "min-w-0 space-y-6"}>
        {children}
      </fieldset>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent brand className="max-w-sm">
          <DialogBrandHeader
            icon={<ShieldCheck size={20} />}
            title="Confirmación del administrador"
            description="Ingresa el NIP de un administrador para editar los datos generales."
          />
          <div className="px-6 py-5">
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              aria-label="NIP del administrador"
              placeholder="NIP"
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
            />
            {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
          </div>
          <DialogBrandFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="button" disabled={busy || !pin} onClick={confirm}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogBrandFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminUnlock;
