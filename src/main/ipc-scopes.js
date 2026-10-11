"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 2a — Clasificación de handlers IPC con fallar-cerrado.
//
// El rol por defecto es "host": en ese rol NO cambia absolutamente nada
// (passthrough exacto). El guard solo actúa cuando el dispositivo se configura
// como "client" (settings.device_role = "client"), y entonces rechaza los
// handlers cuyo scope no está permitido (fail-closed: canal no clasificado se
// trata como HOST_WRITE y se rechaza).
//
// Mapeo con el vocabulario del plan:
//   SYSTEM      → operación local del dispositivo/app (siempre permitida)
//   LOCAL_READ  → lectura local (permitida en cliente)
//   HOST_READ   → lectura de datos compartidos (permitida; en cliente vendrá del Host)
//   HOST_WRITE  → escritura de datos de negocio (RECHAZADA en cliente)
// ─────────────────────────────────────────────────────────────────────────────

// Kill-switch (Entrega 2b): mientras esté en false, es imposible activar el rol
// cliente. Motivo: con el rol cliente aún no hay aislamiento por scope en la API
// local y HOST_READ se resuelve localmente, así que mantener el rol apagado
// evita exponer datos compartidos. Se encenderá cuando el Bloque 3 (proxy al
// Host) esté listo. Ponlo en true para habilitar `device_role = "client"`.
const CLIENT_ROLE_ENABLED = false;

const ROLES = Object.freeze({ HOST: "host", CLIENT: "client" });

const SCOPES = Object.freeze({
  SYSTEM: "system",
  LOCAL_READ: "local_read",
  HOST_READ: "host_read",
  HOST_WRITE: "host_write",
});

// Fail-closed: cualquier canal no clasificado se considera escritura de negocio.
const DEFAULT_SCOPE = SCOPES.HOST_WRITE;

// Scopes que un dispositivo cliente puede ejecutar localmente. Los HOST_WRITE
// deben ir al Host (se implementan en 2c); por ahora fallan cerrado.
const ALLOWED_IN_CLIENT = new Set([
  SCOPES.SYSTEM,
  SCOPES.LOCAL_READ,
  SCOPES.HOST_READ,
]);

const CLASSIFICATION = Object.freeze({
  // ── SYSTEM: dispositivo/app, siempre permitido ──────────────────────────
  "log-error": SCOPES.SYSTEM,
  "print-pdf": SCOPES.SYSTEM,
  "print-receipt": SCOPES.SYSTEM,
  "open-cash-drawer": SCOPES.SYSTEM,
  "get-printers": SCOPES.SYSTEM,
  "is-first-time": SCOPES.SYSTEM,
  "get-server-status": SCOPES.SYSTEM,
  "update:download": SCOPES.SYSTEM,
  "update:get-state": SCOPES.SYSTEM,
  "update:install": SCOPES.SYSTEM,
  "select-catalog-file": SCOPES.SYSTEM,
  "select-import-file": SCOPES.SYSTEM,
  "connect-scale": SCOPES.SYSTEM,
  "disconnect-scale": SCOPES.SYSTEM,
  "is-scale-connected": SCOPES.SYSTEM,
  "list-serial-ports": SCOPES.SYSTEM,
  "read-weight": SCOPES.SYSTEM,
  "start-weight-stream": SCOPES.SYSTEM,
  "stop-weight-stream": SCOPES.SYSTEM,
  "create-backup": SCOPES.SYSTEM,
  "get-backups": SCOPES.SYSTEM,
  "delete-backup": SCOPES.SYSTEM,
  "download-backup": SCOPES.SYSTEM,
  "verify-cashier-pin": SCOPES.SYSTEM,
  "vendesaldo:status": SCOPES.SYSTEM,

  // ── SYSTEM: vínculo caja ↔ Host (Entrega 3c) ───────────────────────────
  "box-discover-hosts": SCOPES.SYSTEM,
  "box-pair": SCOPES.SYSTEM,
  "box-wait-approval": SCOPES.SYSTEM,

  // ── LOCAL_READ: lectura local ───────────────────────────────────────────
  "get-next-barcode": SCOPES.LOCAL_READ,

  // ── HOST_READ: lectura de datos compartidos ─────────────────────────────
  "check-barcode-exists": SCOPES.HOST_READ,
  "get-activation-status": SCOPES.HOST_READ,
  "get-all-products": SCOPES.HOST_READ,
  "get-all-settings": SCOPES.HOST_READ,
  "get-cash-register-expenses": SCOPES.HOST_READ,
  "get-cash-register-status": SCOPES.HOST_READ,
  "get-cashiers": SCOPES.HOST_READ,
  "get-catalog-categories": SCOPES.HOST_READ,
  "get-catalog-products": SCOPES.HOST_READ,
  "get-catalog-stats": SCOPES.HOST_READ,
  "get-categories": SCOPES.HOST_READ,
  "get-closed-registers": SCOPES.HOST_READ,
  "get-customer": SCOPES.HOST_READ,
  "get-customer-by-qr": SCOPES.HOST_READ,
  "get-customer-prices": SCOPES.HOST_READ,
  "get-customer-pricing": SCOPES.HOST_READ,
  "get-daily-sales-week": SCOPES.HOST_READ,
  "get-expenses-by-date": SCOPES.HOST_READ,
  "get-expenses-by-range": SCOPES.HOST_READ,
  "get-insights": SCOPES.HOST_READ,
  "get-low-stock-count": SCOPES.HOST_READ,
  "get-outside-register-sales": SCOPES.HOST_READ,
  "get-previous-register-today": SCOPES.HOST_READ,
  "get-product-by-barcode": SCOPES.HOST_READ,
  "get-product-day-summary": SCOPES.HOST_READ,
  "get-products": SCOPES.HOST_READ,
  "get-products-by-ids": SCOPES.HOST_READ,
  "get-recent-customers": SCOPES.HOST_READ,
  "get-register-movements": SCOPES.HOST_READ,
  "get-register-products": SCOPES.HOST_READ,
  "get-register-sales-detail": SCOPES.HOST_READ,
  "get-sale-details": SCOPES.HOST_READ,
  "get-sales-by-date": SCOPES.HOST_READ,
  "get-sales-by-range": SCOPES.HOST_READ,
  "get-sales-for-today": SCOPES.HOST_READ,
  "get-setting": SCOPES.HOST_READ,
  "get-stock-movements": SCOPES.HOST_READ,
  "get-suppliers": SCOPES.HOST_READ,
  "get-tasks-by-date": SCOPES.HOST_READ,
  "get-tier-prices": SCOPES.HOST_READ,
  "get-tiers": SCOPES.HOST_READ,
  "get-today-tasks": SCOPES.HOST_READ,
  "get-top-products": SCOPES.HOST_READ,
  "get-weekly-sales": SCOPES.HOST_READ,
  "get-weekly-sales-range": SCOPES.HOST_READ,
  "search-customers": SCOPES.HOST_READ,
  "search-products": SCOPES.HOST_READ,
  "vendesaldo:get-balance": SCOPES.HOST_READ,
  "vendesaldo:get-catalog": SCOPES.HOST_READ,
  "box-link-status": SCOPES.HOST_READ,
  "box-get-settings": SCOPES.HOST_READ,

  // ── HOST_WRITE: escritura de datos de negocio (rechazada en cliente) ─────
  "activate-catalog-product": SCOPES.HOST_WRITE,
  "add-cashier": SCOPES.HOST_WRITE,
  "add-category": SCOPES.HOST_WRITE,
  "add-customer": SCOPES.HOST_WRITE,
  "add-product": SCOPES.HOST_WRITE,
  "add-stock": SCOPES.HOST_WRITE,
  "add-supplier": SCOPES.HOST_WRITE,
  "add-task": SCOPES.HOST_WRITE,
  "adjust-stock": SCOPES.HOST_WRITE,
  "cancel-sale": SCOPES.HOST_WRITE,
  "cancel-sale-item": SCOPES.HOST_WRITE,
  "close-cash-register": SCOPES.HOST_WRITE,
  "complete-task": SCOPES.HOST_WRITE,
  "delete-cash-expense": SCOPES.HOST_WRITE,
  "delete-cashier": SCOPES.HOST_WRITE,
  "delete-catalog-product": SCOPES.HOST_WRITE,
  "delete-category": SCOPES.HOST_WRITE,
  "delete-customer": SCOPES.HOST_WRITE,
  "delete-customer-price": SCOPES.HOST_WRITE,
  "delete-product": SCOPES.HOST_WRITE,
  "delete-supplier": SCOPES.HOST_WRITE,
  "delete-task": SCOPES.HOST_WRITE,
  "delete-tier-price": SCOPES.HOST_WRITE,
  "import-catalog-data": SCOPES.HOST_WRITE,
  "import-products-data": SCOPES.HOST_WRITE,
  "mark-insight": SCOPES.HOST_WRITE,
  "open-cash-register": SCOPES.HOST_WRITE,
  "record-sale": SCOPES.HOST_WRITE,
  "register-cash-expense": SCOPES.HOST_WRITE,
  "remove-stock": SCOPES.HOST_WRITE,
  "restore-backup": SCOPES.HOST_WRITE,
  "revoke-device": SCOPES.HOST_WRITE,
  "rotate-activation-code": SCOPES.HOST_WRITE,
  "run-weekly-pulse": SCOPES.HOST_WRITE,
  "save-setting": SCOPES.HOST_WRITE,
  "set-activation-enabled": SCOPES.HOST_WRITE,
  "set-activation-grace": SCOPES.HOST_WRITE,
  "set-customer-price": SCOPES.HOST_WRITE,
  "set-tier-price": SCOPES.HOST_WRITE,
  "touch-customer": SCOPES.HOST_WRITE,
  "update-cashier": SCOPES.HOST_WRITE,
  "update-catalog-name": SCOPES.HOST_WRITE,
  "update-category": SCOPES.HOST_WRITE,
  "update-customer": SCOPES.HOST_WRITE,
  "update-product": SCOPES.HOST_WRITE,
  "update-supplier": SCOPES.HOST_WRITE,
  "update-task": SCOPES.HOST_WRITE,
  "vendesaldo:recharge": SCOPES.HOST_WRITE,
  "vendesaldo:set-credentials": SCOPES.HOST_WRITE,
  "box-save-settings": SCOPES.HOST_WRITE,
  "approve-device": SCOPES.HOST_WRITE,
  "reject-device": SCOPES.HOST_WRITE,
});

const scopeOf = (channel) => CLASSIFICATION[channel] || DEFAULT_SCOPE;

const isAllowed = (channel, role) => {
  if (role !== ROLES.CLIENT) return true; // host: todo permitido (sin cambios)
  return ALLOWED_IN_CLIENT.has(scopeOf(channel));
};

// Con el kill-switch apagado, cualquier valor "client" se trata como "host".
const normalizeRole = (value, clientEnabled = CLIENT_ROLE_ENABLED) =>
  clientEnabled && String(value || "").toLowerCase() === ROLES.CLIENT
    ? ROLES.CLIENT
    : ROLES.HOST;

// Envuelve ipcMain.handle para aplicar el guard. Idempotente.
const installIpcScopeGuard = ({ ipcMain, getRole, onDenied }) => {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("installIpcScopeGuard requiere ipcMain.handle");
  }
  if (ipcMain.__vendiaScopeGuard) return;

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    const guarded = (event, ...args) => {
      const role =
        typeof getRole === "function" ? getRole() : ROLES.HOST;
      if (!isAllowed(channel, role)) {
        const err = new Error(
          `[IPC] El canal "${channel}" no está permitido para el rol "${role}".`,
        );
        err.code = "IPC_SCOPE_DENIED";
        err.channel = channel;
        err.scope = scopeOf(channel);
        if (typeof onDenied === "function") onDenied(err);
        else console.error(err.message);
        throw err;
      }
      return listener(event, ...args);
    };
    return originalHandle(channel, guarded);
  };

  Object.defineProperty(ipcMain, "__vendiaScopeGuard", {
    value: true,
    enumerable: false,
    configurable: true,
  });
};

module.exports = {
  CLIENT_ROLE_ENABLED,
  ROLES,
  SCOPES,
  DEFAULT_SCOPE,
  ALLOWED_IN_CLIENT,
  CLASSIFICATION,
  scopeOf,
  isAllowed,
  normalizeRole,
  installIpcScopeGuard,
};
