// 3b · INERTE: todavía no está conectado a ningún flujo.
//
// Respaldo del carrito POR PESTAÑA (sessionStorage, no localStorage) con la
// clave apuntada por device_id. El carrito NO se persiste hoy: en el renderer
// solo hay claves de UI (cartWidth, lastPaymentMethod, ...), así que esto no
// duplica nada. El device_id llega como parámetro: el renderer todavía no
// tiene canal para pedírselo al Host.

const keyFor = (deviceId) => `vendia:cart-backup:${deviceId || "sin-dispositivo"}`;

const store = () =>
  typeof window === "undefined" || !window.sessionStorage ? null : window.sessionStorage;

export function backupCart(deviceId, carts, extra = {}) {
  const ss = store();
  if (!ss) return { ok: false, reason: "sessionStorage no disponible" };
  try {
    ss.setItem(
      keyFor(deviceId),
      JSON.stringify({ carts, deviceId, savedAt: new Date().toISOString(), ...extra }),
    );
    return { ok: true, at: Date.now() };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export function readCartBackup(deviceId) {
  const ss = store();
  if (!ss) return null;
  try {
    const raw = ss.getItem(keyFor(deviceId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function clearCartBackup(deviceId) {
  const ss = store();
  if (!ss) return { ok: false, reason: "sessionStorage no disponible" };
  try {
    ss.removeItem(keyFor(deviceId));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
