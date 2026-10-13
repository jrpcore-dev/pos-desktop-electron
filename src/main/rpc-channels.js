"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// C9 · Lista blanca de canales que una CAJA puede ejecutar en el Host.
//
// Se derivó leyendo qué invoca exactamente cada pantalla que la caja tiene
// permitida (Terminal de Ventas, Caja, Layout y el login). La regla es
// sencilla y es fallar-cerrado: sólo pasa el canal que NO se puede resolver
// con datos que la caja ya tiene replicados.
//
//   NO aparecen aquí (se resuelven en la propia caja):
//     get-setting, get-cashiers, search-products, get-customer-by-qr,
//     get-customer-pricing, get-low-stock-count
//     → settings, cashiers, products y customers SÍ están replicados, y
//       volver a pedirlos al Host por cada tecla costaría una ida y vuelta
//       para traer lo que ya está en disco.
//     get-server-status, print-receipt, open-cash-drawer, el hilo de la
//     báscula, list-serial-ports, disconnect-scale, is-scale-connected
//     → SYSTEM: son hardware del aparato.
//
//   Dos van por su PROPIO endpoint, no por aquí (entrega 3g/D):
//     record-sale         → POST /api/sales   (Idempotency-Key)
//     verify-cashier-pin  → POST /api/auth    (token de sesión)
//
//   Todo lo demás queda FUERA de la lista y se rechaza. En particular
//   `add-product`, `save-setting`, `import-catalog-data` o `adjust-stock`
//   jamás deberían poder ejecutarse en el Host desde una caja.
//
// Nota sobre `get-outside-register-sales` y `cancel-sale`: son los dos casos
// en los que "la venta" puede no tener caja asignada (`register_id IS NULL`).
// Se incluyen en la lista y se les añadió el filtro por `sales.device_id`
// (entrega 3g/C): sin esa columna, una caja habría podido leer y cancelar
// ventas hechas en otra.
// ─────────────────────────────────────────────────────────────────────────────

const RPC_CHANNELS = new Set([
  // ── caja: estado y movimiento del registro ────────────────────────────────
  "get-cash-register-status",
  "get-previous-register-today",
  "get-sales-for-today",
  "get-outside-register-sales",
  "get-cash-register-expenses",
  "open-cash-register",
  "close-cash-register",
  "register-cash-expense",
  "delete-cash-expense",
  // ── caja: cancelaciones (con comprobación de propiedad en main.js) ────────
  "cancel-sale",
  "cancel-sale-item",
  // ── home / Layout: tareas e insights no están replicadas ─────────────────
  "get-today-tasks",
  "get-insights",
  "mark-insight",
  "run-weekly-pulse",
  // ── terminal: el "cliente visto por última vez" se actualiza en el Host ──
  "touch-customer",
]);

const has = (channel) => RPC_CHANNELS.has(channel);

const list = () => [...RPC_CHANNELS].sort();

module.exports = { RPC_CHANNELS, has, list };
