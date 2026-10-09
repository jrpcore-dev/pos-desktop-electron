"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 2b — Vocabulario de scopes de la API móvil/Host y sets por tipo de
// dispositivo. Módulo puro (sin dependencias) para poder reusarlo desde
// activation.js, api-server.js y los harness de prueba.
// ─────────────────────────────────────────────────────────────────────────────

const SCOPE = Object.freeze({
  CATALOG_READ: "catalog:read",
  CATALOG_WRITE: "catalog:write",
  STOCK_READ: "stock:read",
  STOCK_WRITE: "stock:write",
  SALES_WRITE: "sales:write",
  REGISTER_ALL: "register:*",
  EVENTS_SUBSCRIBE: "events:subscribe",
  BACKUP_RECEIVE: "backup:receive",
});

const DEVICE_TYPE = Object.freeze({
  MOBILE: "mobile",
  DESKTOP_BOX: "desktop_box",
});

// Set EXACTO de lo que usa hoy la app móvil (pos-app-android/mobile/src/services/api.js).
// Ni más, ni menos. Ver tabla endpoint→scope en task.md / plan.
const MOBILE_SCOPES = Object.freeze([
  SCOPE.CATALOG_READ,
  SCOPE.CATALOG_WRITE,
  SCOPE.STOCK_READ,
  SCOPE.STOCK_WRITE,
]);

const DESKTOP_BOX_SCOPES = Object.freeze([
  SCOPE.CATALOG_READ,
  SCOPE.SALES_WRITE,
  SCOPE.REGISTER_ALL,
  SCOPE.EVENTS_SUBSCRIBE,
  SCOPE.BACKUP_RECEIVE,
]);

// Tipos desconocidos → scopes mínimos (fail-closed: ninguno).
const MINIMAL_SCOPES = Object.freeze([]);

// Scopes NUEVOS (Bloques 2c/3): el emparejamiento es obligatorio SIEMPRE,
// aunque el candado de activación esté apagado.
const NEW_SCOPE_NAMESPACES = Object.freeze([
  "sales",
  "register",
  "events",
  "backup",
]);

const scopesForDeviceType = (deviceType) => {
  if (deviceType === DEVICE_TYPE.DESKTOP_BOX) return [...DESKTOP_BOX_SCOPES];
  if (deviceType === DEVICE_TYPE.MOBILE) return [...MOBILE_SCOPES];
  return [...MINIMAL_SCOPES];
};

const namespaceOf = (scope) => String(scope || "").split(":")[0];

const isNewScope = (scope) => NEW_SCOPE_NAMESPACES.includes(namespaceOf(scope));

// Concede si el scope requerido está en la lista o cubierto por un `ns:*`.
const scopeAllowed = (granted, required) => {
  if (!Array.isArray(granted) || granted.length === 0) return false;
  if (!required) return true;
  return granted.some((g) => {
    if (typeof g !== "string") return false;
    if (g === required) return true;
    if (g.endsWith("*")) return required.startsWith(g.slice(0, -1));
    return false;
  });
};

const parseScopes = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

module.exports = {
  SCOPE,
  DEVICE_TYPE,
  MOBILE_SCOPES,
  DESKTOP_BOX_SCOPES,
  MINIMAL_SCOPES,
  NEW_SCOPE_NAMESPACES,
  scopesForDeviceType,
  isNewScope,
  namespaceOf,
  scopeAllowed,
  parseScopes,
};
