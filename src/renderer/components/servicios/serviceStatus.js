/**
 * Estados posibles de una transacción de servicio.
 *
 *   pending   -> creada, en vuelo hacia el proveedor
 *   applied   -> el proveedor confirmó que se aplicó
 *   failed    -> el proveedor la rechazó (reintentable con el MISMO folio)
 *   unknown   -> enviamos pero no sabemos si entró (se reconcilia con query)
 *   reversed  -> se aplicó y después se revirtió
 *
 * `unknown` es el estado que casi nadie implementa y el que salva el negocio:
 * si se corta el internet a media recarga, sin él no hay forma de saber si
 * le cobraste o no al cliente.
 */
export const SERVICE_STATUS = {
  pending: {
    key: "pending",
    label: "Procesando",
    badgeVariant: "warning",
    /** clases del círculo grande del panel de resultado */
    artRing: "bg-warning/15 text-warning",
  },
  applied: {
    key: "applied",
    label: "Aplicada",
    badgeVariant: "success",
    artRing: "bg-success/15 text-success",
  },
  failed: {
    key: "failed",
    label: "Fallida",
    badgeVariant: "destructive",
    artRing: "bg-destructive/15 text-destructive",
  },
  unknown: {
    key: "unknown",
    label: "Por verificar",
    badgeVariant: "secondary",
    artRing: "bg-muted text-muted-foreground",
  },
  // Taecel la aplicó pero la venta no se pudo registrar (p. ej. caja
  // cerrada): el admin la revisa; NO se vuelve a cobrar.
  needs_review: {
    key: "needs_review",
    label: "Por revisar",
    badgeVariant: "warning",
    artRing: "bg-warning/15 text-warning",
  },
  reversed: {
    key: "reversed",
    label: "Revertida",
    badgeVariant: "outline",
    artRing: "bg-muted text-muted-foreground",
  },
};

export const STATUS_ORDER = [
  "applied",
  "needs_review",
  "unknown",
  "failed",
  "pending",
  "reversed",
];

export const getStatus = (key) =>
  SERVICE_STATUS[key] || {
    key: key || "unknown",
    label: key || "Desconocido",
    badgeVariant: "secondary",
    artRing: "bg-muted text-muted-foreground",
  };

/** Estados que todavía pueden cambiar o que exigen atención del cajero. */
export const NEEDS_ATTENTION = ["failed", "unknown", "needs_review"];

/** Un estado ya no va a cambiar solo: se puede cerrar. */
export const isSettled = (key) => key === "applied" || key === "reversed";

// Enmascara el dato del cliente para auditarlo sin exponerlo.
// 5512345678 -> 55 *** *** 78   |   contrato largo -> 1234••••9012
export const maskInput = (value = "") => {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.includes("@")) {
    const [user, domain] = v.split("@");
    return `${user.slice(0, 2)}${"*".repeat(Math.max(2, user.length - 2))}@${domain}`;
  }
  if (v.length <= 4) return "*".repeat(v.length);
  if (v.length <= 10) {
    return `${v.slice(0, 2)} ${"*".repeat(Math.max(3, v.length - 4))} ${v.slice(-2)}`;
  }
  return `${v.slice(0, 4)}${"*".repeat(Math.max(4, v.length - 8))}${v.slice(-4)}`;
};