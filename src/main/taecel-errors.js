"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Taecel · normalización de estados, montos y errores.
//
// Taecel responde SIEMPRE con el sobre {success,error,message,data,extra}.
// El HTTP no es autoritativo: 405/3127/5051 llegan con HTTP 200 y 403 llega
// con HTTP 403. Por eso el adaptador lee el JSON y decide por `error`.
//
// `StatusTXN.success` sólo significa "la consulta funcionó". El resultado real
// de la recarga es `data.Status` y puede venir como texto ("Exitosa",
// "Fracasada ", "en proceso") o, en cuentas/versiones viejas, como "1"/"0".
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_MESSAGES = Object.freeze({
  1: "Teléfono no válido",
  2: "Saldo insuficiente",
  3: "Error de comunicación con el operador",
  4: "Recarga rechazada por el operador",
  5: "Error del operador",
  6: "Error del operador",
  7: "Error del operador",
  8: "Error del operador",
  403: "Usted no tiene permisos suficientes",
  405: "Datos inválidos para Taecel",
  429: "Solicitud rechazada por Reglas",
  3127: "Es obligatorio el número de referencia a recargar",
  3133: "El producto ya no está disponible",
  5051: "La transacción no existe",
  8888: "Ocurrió un error en su solicitud",
});

const PROVIDER_FAILED_CODES = new Set([1, 2, 4]);
const PROVIDER_AMBIGUOUS_CODES = new Set([3, 5, 6, 7, 8, 8888, 5051]);

const providerMessage = (code, message) =>
  String(message || PROVIDER_MESSAGES[Number(code)] || "Error de Taecel").trim();

/**
 * Error de una solicitud de recarga (RequestTXN).
 *
 * `kind`:
 *   failed      → el proveedor rechazó; NO se creó transacción.
 *   unknown     → no sabemos si se creó; NUNCA reenviar RequestTXN.
 *   validation  → datos inválidos; no se creó transacción.
 *   config      → credenciales/permisos; no se creó transacción.
 *   catalog     → producto viejo/inexistente; no se creó transacción.
 *   rate_limit  → bloqueo temporal; no se creó transacción.
 */
const mapRequestError = (code, message, httpStatus = null) => {
  const n = Number(code);
  const text = providerMessage(n, message);
  if (n === 403) {
    return {
      kind: "config",
      code: "TAECEL_FORBIDDEN",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  if (n === 405) {
    return {
      kind: "validation",
      code: "TAECEL_VALIDATION",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  if (n === 3127) {
    return {
      kind: "validation",
      code: "TAECEL_REFERENCE_REQUIRED",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  if (n === 3133) {
    return {
      kind: "catalog",
      code: "TAECEL_PRODUCT_NOT_FOUND",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  if (n === 429) {
    return {
      kind: "rate_limit",
      code: "TAECEL_RATE_LIMITED",
      providerCode: n,
      message: text,
      retryable: true,
      retryAfterMs: 60000,
      httpStatus,
    };
  }
  if (PROVIDER_FAILED_CODES.has(n)) {
    return {
      kind: "failed",
      code: "TAECEL_PROVIDER_FAILED",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  if (PROVIDER_AMBIGUOUS_CODES.has(n) || !Number.isFinite(n)) {
    return {
      kind: "unknown",
      code: "TAECEL_UNKNOWN",
      providerCode: Number.isFinite(n) ? n : null,
      message: text,
      retryable: false,
      ambiguous: true,
      httpStatus,
    };
  }
  // Cualquier código no documentado se trata como ambiguo: es más seguro
  // revisarlo que marcarlo fallido y perder una recarga que sí entró.
  return {
    kind: "unknown",
    code: "TAECEL_UNKNOWN",
    providerCode: n,
    message: text,
    retryable: false,
    ambiguous: true,
    httpStatus,
  };
};

/**
 * Error de una consulta de estado (StatusTXN). Una consulta fallida NUNCA
 * significa que la recarga falló: sólo significa que no pudimos confirmarla.
 */
const mapStatusError = (code, message, httpStatus = null) => {
  const n = Number(code);
  const text = providerMessage(n, message);
  if (n === 5051) {
    return {
      kind: "not_found",
      code: "TAECEL_TXN_NOT_FOUND",
      providerCode: n,
      message: text,
      retryable: true,
      httpStatus,
    };
  }
  if (n === 429) {
    return {
      kind: "rate_limit",
      code: "TAECEL_RATE_LIMITED",
      providerCode: n,
      message: text,
      retryable: true,
      retryAfterMs: 60000,
      httpStatus,
    };
  }
  if (n === 403) {
    return {
      kind: "config",
      code: "TAECEL_FORBIDDEN",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  if (n === 405) {
    return {
      kind: "validation",
      code: "TAECEL_VALIDATION",
      providerCode: n,
      message: text,
      retryable: false,
      httpStatus,
    };
  }
  return {
    kind: "unknown",
    code: "TAECEL_UNKNOWN",
    providerCode: Number.isFinite(n) ? n : null,
    message: text,
    retryable: true,
    httpStatus,
  };
};

/**
 * Traduce el `Status` del proveedor a nuestro vocabulario.
 * Texto (API actual): Exitosa / Fracasada / en proceso.
 * Numérico (doc vieja): 1 = exitosa, 0 = en proceso. Cualquier otro número
 * se deja como `unknown` a propósito: no se adivina un fallo.
 */
const normalizeStatus = (raw) => {
  const s = String(raw == null ? "" : raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return "unknown";
  if (["exitosa", "exitoso", "aplicada", "aplicado", "success", "1"].includes(s)) {
    return "applied";
  }
  if (
    ["fracasada", "fracasado", "fallida", "fallido", "rechazada", "rechazado", "cancelada", "cancelado", "failed"].includes(
      s,
    )
  ) {
    return "failed";
  }
  if (
    ["en proceso", "enproceso", "procesando", "pendiente", "pending", "0"].includes(s)
  ) {
    return "pending";
  }
  return "unknown";
};

/** Convierte "$1,234.56", "1,234.56", "899,968,134" o 10.5 a centavos. */
const parseMoneyToCents = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const clean = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!clean || clean === "-" || clean === ".") return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const formatCents = (cents) => {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return `$${(n / 100).toFixed(2)}`;
};

const normalizeReference = (value) =>
  String(value == null ? "" : value).replace(/\s+/g, "").trim();

const maskReference = (value) => {
  const v = normalizeReference(value);
  if (!v) return "";
  if (v.length <= 4) return "*".repeat(v.length);
  return `${v.slice(0, 2)}${"*".repeat(Math.max(3, v.length - 4))}${v.slice(-2)}`;
};

module.exports = {
  PROVIDER_MESSAGES,
  providerMessage,
  mapRequestError,
  mapStatusError,
  normalizeStatus,
  parseMoneyToCents,
  formatCents,
  normalizeReference,
  maskReference,
};
