"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// C9 · Registro de los listeners IPC del proceso main.
//
// `ipcMain.handle` no deja leer de vuelta el listener que se registró, y
// `/api/rpc` necesita ejecutar exactamente el MISMO código que ejecuta el
// renderer local: si se reescribiera la lógica en el servidor habría dos
// versiones de la verdad y se desincronizarían.
//
// Se llena en el único punto por el que pasan todos los registros,
// `installIpcScopeGuard` (que ya envolvía `ipcMain.handle` para aplicar el
// guard de rol). Se guarda el listener CRUDO, sin envolver: el guard del rol
// protege el IPC local, y quien llega por HTTP ya pasó por su propia lista
// blanca.
// ─────────────────────────────────────────────────────────────────────────────

const handlers = new Map();

const set = (channel, listener) => {
  if (typeof channel !== "string" || typeof listener !== "function") return;
  handlers.set(channel, listener);
};

const get = (channel) => handlers.get(channel) || null;

const has = (channel) => handlers.has(channel);

const channels = () => [...handlers.keys()].sort();

module.exports = { set, get, has, channels };
