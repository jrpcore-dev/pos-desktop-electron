import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog";
import { Button } from "./button";
import { Loader2, AlertTriangle } from "lucide-react";

const colorMap = { error: "text-red-500", warning: "text-amber-500" };

const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "destructive",
  loading = false,
  icon: Icon = AlertTriangle,
  iconColor = "error",
  confirmProps,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-xl">
            <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }} className={colorMap[iconColor] || colorMap.error}>
              <Icon size={20} />
              {title}
            </span>
          </DialogTitle>
          <DialogDescription className="space-y-2 text-base">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter style={{ paddingTop: "2px", marginBottom: "-8px" }}>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={loading}
            {...confirmProps}
          >
            {loading && <Loader2 className="animate-spin" />}
            {loading ? "Procesando..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { ConfirmDialog };