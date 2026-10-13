"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// C9 · Contexto de llamada: ¿quién está haciendo esta petición?
//
// Los handlers de `ipcMain` no reciben ninguna identidad de dispositivo: sólo
// `event` y los argumentos. Dentro del Host local eso no importa (todo es del
// mismo aparato), pero en cuanto el MISMO handler se ejecuta porque una caja
// remota lo pidió por `/api/rpc`, el handler necesita saber de qué caja viene
// para no mirar el cajón del vecino.
//
// La solución es un AsyncLocalStorage: `/api/rpc` envuelve la ejecución con
// `runWithCallContext({deviceId, cashierId}, ...)` y los handlers consultan
// `currentDeviceId()`. Fuera de una llamada RPC el almacén está vacío y la
// función devuelve `null`, con lo que el comportamiento del Host local queda
// byte a byte idéntico al de siempre.
// ─────────────────────────────────────────────────────────────────────────────

const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

const runWithCallContext = (ctx, fn) => storage.run(ctx || {}, fn);

const currentDeviceId = () => {
  const store = storage.getStore();
  return (store && store.deviceId) || null;
};

const currentCashierId = () => {
  const store = storage.getStore();
  return (store && store.cashierId) || null;
};

// true sólo dentro de una ejecución de `/api/rpc`; sirve para que un handler
// pueda ser más estricto con lo que acepta cuando no es su propio renderer.
const inCallContext = () => storage.getStore() !== undefined;

module.exports = {
  runWithCallContext,
  currentDeviceId,
  currentCashierId,
  inCallContext,
};
