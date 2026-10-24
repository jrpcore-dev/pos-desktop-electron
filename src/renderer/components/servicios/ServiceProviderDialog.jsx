import { useState } from "react";
import { Eye, EyeOff, Loader2, Save } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

// Configuración del proveedor (Taecel). La Key y el NIP se prueban contra
// Taecel antes de guardarse y quedan cifradas (safeStorage) en el Host. En una
// caja este canal es del Host: se avisa que se configura allá.
const ServiceProviderDialog = ({ open, onOpenChange, onSaved }) => {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = user.trim().length > 0 && pass.length > 0 && !saving;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const api = window.api;
      if (!api?.invoke) throw new Error("Sin puente IPC");
      const creds = { key: user.trim(), nip: pass };
      const test = await api.invoke("taecel:test-credentials", creds);
      if (!test?.ok) {
        throw new Error(
          test?.code === "IPC_SCOPE_DENIED"
            ? "Las credenciales de Taecel se configuran en el equipo Host"
            : test?.error || "Taecel rechazó la Key o el NIP",
        );
      }
      const saved = await api.invoke("taecel:set-credentials", creds);
      if (!saved?.ok) throw new Error(saved?.error || "No se pudo guardar");
      setUser("");
      setPass("");
      onSaved?.();
      onOpenChange?.(false);
    } catch (err) {
      setError(err?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Proveedor de recargas</DialogTitle>
          <DialogDescription>
            Key y NIP de tu cuenta Taecel. Se validan con Taecel y se guardan
            cifrados en el equipo Host.
          </DialogDescription>
        </DialogHeader>

        <form id="taecel-config" onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="taecel-key"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Key
            </label>
            <Input
              id="taecel-key"
              autoComplete="off"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="Key de Taecel"
              className="h-9 text-sm"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="taecel-nip"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              NIP
            </label>
            <div className="relative">
              <Input
                id="taecel-nip"
                type={show ? "text" : "password"}
                autoComplete="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                className="h-9 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Ocultar NIP" : "Mostrar NIP"}
                className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-[11px] font-medium text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange?.(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSave}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Save size={13} aria-hidden />
              )}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ServiceProviderDialog;