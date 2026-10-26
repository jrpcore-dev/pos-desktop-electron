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
//   RPC         → 3g/D: en cliente NO se ejecuta aquí, viaja al Host por HTTP
//
// Así el rol cliente tiene exactamente tres modos: LOCAL (system/local_read/
// host_read, se resuelve en la propia caja), RPC (scope `rpc`, se traduce a
// HTTP contra el Host) y BLOQUEADO (cualquier otro scope, se rechaza).
// ─────────────────────────────────────────────────────────────────────────────

// 3g/E · candado ENCENDIDO: el rol cliente ya tiene su puente al Host (scope
// `rpc` + box-rpc-client), así que `device_role = "client"` se toma en serio.
// Sólo el asistente de vinculación lo pone; `save-setting` lo rechaza.
const CLIENT_ROLE_ENABLED = true;

const ROLES = Object.freeze({ HOST: "host", CLIENT: "client" });

// C9 · los listeners registrados aquí se guardan también en el registro que
// lee `/api/rpc`; es el único punto por el que pasa todo `ipcMain.handle`.
const ipcRegistry = require("./ipc-registry");

const SCOPES = Object.freeze({
  SYSTEM: "system",
  LOCAL_READ: "local_read",
  HOST_READ: "host_read",
  HOST_WRITE: "host_write",
  // 3g/D · el canal no se ejecuta en la caja: el guard lo traduce a HTTP.
  RPC: "rpc",
});

// 3g/D · la lista de canales que van al Host vive en rpc-channels.js (única
// fuente de verdad, la comparte /api/rpc). Dos no pasan por /api/rpc porque
// tienen su propio endpoint con su propia defensa.
const rpcChannels = require("./rpc-channels");
const OWN_ENDPOINT = new Set(["record-sale", "verify-cashier-pin"]);

// Fail-closed: cualquier canal no clasificado se considera escritura de negocio.
const DEFAULT_SCOPE = SCOPES.HOST_WRITE;

// Scopes que un dispositivo cliente puede ejecutar LOCALMENTE. Los HOST_WRITE
// se rechazan (fail-cerrado) y los RPC viajan al Host: los tres modos.
const ALLOWED_IN_CLIENT = new Set([
  SCOPES.SYSTEM,
  SCOPES.LOCAL_READ,
  SCOPES.HOST_READ,
]);

const CLASSIFICATION_BASE = {
  // ── SYSTEM: dispositivo/app, siempre permitido ──────────────────────────
  "log-error": SCOPES.SYSTEM,
  "print-pdf": SCOPES.SYSTEM,
  "print-receipt": SCOPES.SYSTEM,
  "print-escpos-test": SCOPES.SYSTEM,
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
  // Bloque 6 · configuración local del respaldo y promoción manual.
  "get-backup-config": SCOPES.LOCAL_READ,
  "save-backup-config": SCOPES.SYSTEM,
  "pull-backup-now": SCOPES.SYSTEM,
  "promote-to-host": SCOPES.SYSTEM,
  // 3g/D · verify-cashier-pin ya no está aquí: va al Host (scope RPC).
  // Taecel: las lecturas y la recarga van al Host (scope RPC). Sólo la
  // configuración de credenciales es una escritura local del Host.

  // ── SYSTEM: vínculo caja ↔ Host (Entrega 3c) ───────────────────────────
  "box-discover-hosts": SCOPES.SYSTEM,
  "box-pair": SCOPES.SYSTEM,
  "box-wait-approval": SCOPES.SYSTEM,
  // 3d · sincronizar la réplica escribe en la BD y usa la red: SYSTEM.
  "replica-sync-now": SCOPES.SYSTEM,
  "replica-reset": SCOPES.SYSTEM,
  // Bloque 4/C · cola offline: es estado del propio aparato.
  "pending-sales-summary": SCOPES.SYSTEM,
  "pending-sales-list": SCOPES.SYSTEM,
  "pending-sales-cancel": SCOPES.SYSTEM,
  "pending-sales-retry": SCOPES.SYSTEM,
  "pending-sales-sync-now": SCOPES.SYSTEM,
  // Bloque 5 · leer el archivo elegido en el diálogo LOCAL de la caja.
  "read-import-file": SCOPES.SYSTEM,

  // ── LOCAL_READ: lectura local ───────────────────────────────────────────
  "get-next-barcode": SCOPES.LOCAL_READ,
  // 3d · estado de la réplica: lectura local de la propia BD de la caja.
  "replica-status": SCOPES.LOCAL_READ,

  // ── HOST_READ: lectura de datos compartidos ─────────────────────────────
  "check-barcode-exists": SCOPES.HOST_READ,
  "get-activation-status": SCOPES.HOST_READ,
  "get-all-products": SCOPES.HOST_READ,
  "get-all-settings": SCOPES.HOST_READ,
  "get-cashiers": SCOPES.HOST_READ,
  "get-catalog-categories": SCOPES.HOST_READ,
  "get-catalog-products": SCOPES.HOST_READ,
  "get-catalog-stats": SCOPES.HOST_READ,
  "get-categories": SCOPES.HOST_READ,
  "get-customer": SCOPES.HOST_READ,
  "get-customer-by-qr": SCOPES.HOST_READ,
  "get-customer-prices": SCOPES.HOST_READ,
  "get-customer-pricing": SCOPES.HOST_READ,
  "get-low-stock-count": SCOPES.HOST_READ,
  "get-product-by-barcode": SCOPES.HOST_READ,
  "get-product-day-summary": SCOPES.HOST_READ,
  "get-products": SCOPES.HOST_READ,
  "get-products-by-ids": SCOPES.HOST_READ,
  "get-promotions": SCOPES.HOST_READ,
  "get-product-promos": SCOPES.HOST_READ,
  "get-recent-customers": SCOPES.HOST_READ,
  "get-setting": SCOPES.HOST_READ,
  "get-tier-prices": SCOPES.HOST_READ,
  "get-tiers": SCOPES.HOST_READ,
  "search-customers": SCOPES.HOST_READ,
  "search-products": SCOPES.HOST_READ,
  "box-link-status": SCOPES.HOST_READ,
  "box-get-settings": SCOPES.HOST_READ,

  // ── HOST_WRITE: sólo ADMINISTRACIÓN de la instalación (rechazada en caja) ─
  // Las escrituras de negocio (catálogo, clientes, stock…) van al Host vía RPC.
  "import-catalog-data": SCOPES.HOST_WRITE,
  "import-products-data": SCOPES.HOST_WRITE,
  "restore-backup": SCOPES.HOST_WRITE,
  "revoke-device": SCOPES.HOST_WRITE,
  "rename-device": SCOPES.HOST_WRITE,
  "rotate-activation-code": SCOPES.HOST_WRITE,
  "set-activation-enabled": SCOPES.HOST_WRITE,
  "set-activation-grace": SCOPES.HOST_WRITE,
  "taecel:set-credentials": SCOPES.HOST_WRITE,
  "taecel:test-credentials": SCOPES.HOST_WRITE,
  // 3g/D · ajusta el vínculo de ESTA caja con su Host: es del propio aparato.
  "box-save-settings": SCOPES.SYSTEM,
  "approve-device": SCOPES.HOST_WRITE,
  "reject-device": SCOPES.HOST_WRITE,
};

// 3g/D · la tabla se completa con los canales que van al Host: la fuente única
// es la lista blanca (rpc-channels.js, la misma que valida /api/rpc) más los
// dos canales con endpoint propio. Así CLASSIFICATION cubre el 100 % de los
// handlers registrados, que es lo que exige el harness de completitud.
const CLASSIFICATION = Object.freeze({
  ...CLASSIFICATION_BASE,
  ...Object.fromEntries([
    ...rpcChannels.list().map((channel) => [channel, SCOPES.RPC]),
    ...[...OWN_ENDPOINT].map((channel) => [channel, SCOPES.RPC]),
  ]),
});

const scopeOf = (channel) => CLASSIFICATION[channel] || DEFAULT_SCOPE;

const isAllowed = (channel, role) => {
  if (role !== ROLES.CLIENT) return true; // host: todo permitido (sin cambios)
  // 3g/D · scope RPC = "no se ejecuta aquí": el guard lo manda al Host, y sin
  // puente inyectado (tests, arranque a medias) cae al fail-cerrado.
  return ALLOWED_IN_CLIENT.has(scopeOf(channel));
};

// Con el kill-switch apagado, cualquier valor "client" se trata como "host".
const normalizeRole = (value, clientEnabled = CLIENT_ROLE_ENABLED) =>
  clientEnabled && String(value || "").toLowerCase() === ROLES.CLIENT
    ? ROLES.CLIENT
    : ROLES.HOST;

// Envuelve ipcMain.handle para aplicar el guard. Idempotente.
// 3g/D · `forwardRpc(channel, args)` es el puente IPC→HTTP de la caja: si no
// inyecta, los canales RPC se rechazan como cualquier otro scope no permitido.
const installIpcScopeGuard = ({ ipcMain, getRole, onDenied, forwardRpc }) => {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("installIpcScopeGuard requiere ipcMain.handle");
  }
  if (ipcMain.__vendiaScopeGuard) return;

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    // C9 · se archiva el listener CRUDO, sin envolver. `/api/rpc` lo ejecuta
    // con el contexto del llamante y con su propia lista blanca; el guard de
    // rol de abajo sólo protege el IPC local.
    ipcRegistry.set(channel, listener);
    const guarded = (event, ...args) => {
      const role =
        typeof getRole === "function" ? getRole() : ROLES.HOST;
      // 3g/D · modo RPC: el canal se traduce a HTTP contra el Host.
      if (
        role === ROLES.CLIENT &&
        scopeOf(channel) === SCOPES.RPC &&
        typeof forwardRpc === "function"
      ) {
        return forwardRpc(channel, args);
      }
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
