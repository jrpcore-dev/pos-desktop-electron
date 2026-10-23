"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// C9/3g-D · Lista blanca de canales que una CAJA ejecuta en el Host.
//
// Regla (paridad total, decisión del dueño): la caja es el sistema completo.
// Todo lo que NO se puede resolver con datos replicados viaja al Host:
//
//   · Se resuelven en la propia caja (replicados o hardware): productos,
//     categorías, clientes, precios, cajeros y settings de negocio se leen
//     local; Báscula, impresora, respaldos locales y descubrimiento son del
//     propio aparato.
//   · Pasan por aquí: ventas, cajas, gastos, movimientos de stock, proveedores,
//     tareas, insights, saldos, informes, y las ESCRITURAS de catálogo y
//     clientes. El Host serializa las escrituras y la réplica se las manda a
//     todas las cajas: un solo dueño del dato, sin choques.
//
//   Dos van por su PROPIO endpoint, no por /api/rpc:
//     record-sale         → POST /api/sales   (Idempotency-Key)
//     verify-cashier-pin  → POST /api/auth    (token de sesión)
//
//   `save-setting` va por aquí con truco: sólo las claves de negocio
//   (REPLICATED_SETTINGS_KEYS) viajan al Host; las del propio aparato
//   (báscula, impresora) se escriben en la caja (ver box-rpc-client).
//
//   FUERA de la lista, y por tanto rechazadas en la caja, queda sólo la
//   ADMINISTRACIÓN de la instalación: activación, dispositivos emparejados,
//   restauración de respaldos, importación masiva del catálogo y las
//   credenciales de Taecel. Eso se hace en el Host.
//
// Nota sobre `get-outside-register-sales` y `cancel-sale`: son los dos casos
// en los que "la venta" puede no tener caja asignada (`register_id IS NULL`).
// Bloque 4/A · el filtro por `sales.device_id` y la comprobación de propiedad
// se aplican de verdad en main.js: una caja remota no puede leer ni cancelar
// ventas hechas en otra. El Host local (sin device) sí administra todas, y
// `cancel-sale` conserva las reglas de rol y de corte cerrado.
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
  "get-closed-registers",
  "get-register-movements",
  "get-register-products",
  "get-register-sales-detail",
  // ── cancelaciones (con comprobación de propiedad en main.js) ──────────────
  "cancel-sale",
  "cancel-sale-item",
  // ── ventas e informes: las ventas viven en el Host ────────────────────────
  "get-sale-details",
  "get-sales-by-date",
  "get-sales-by-range",
  "list-sale-devices",
  "get-daily-sales-week",
  "get-weekly-sales",
  "get-weekly-sales-range",
  "get-top-products",
  "get-expenses-by-date",
  "get-expenses-by-range",
  // ── Bloque 4/E · conflictos de stock (se resuelven en el Host) ────────────
  "get-stock-conflicts",
  "resolve-stock-conflict",
  // ── Bloque 5 · la caja lee su archivo y manda el contenido ────────────────
  "import-products-content",
  // ── catálogo: el inventario se lee local, se ESCRIBE en el Host ───────────
  "get-stock-movements",
  "add-product",
  "update-product",
  "delete-product",
  "add-category",
  "update-category",
  "delete-category",
  "add-stock",
  "remove-stock",
  "adjust-stock",
  "activate-catalog-product",
  "delete-catalog-product",
  "update-catalog-name",
  // ── clientes, niveles y precios ───────────────────────────────────────────
  "add-customer",
  "update-customer",
  "delete-customer",
  "set-customer-price",
  "delete-customer-price",
  "set-tier-price",
  "delete-tier-price",
  // ── proveedores ───────────────────────────────────────────────────────────
  "get-suppliers",
  "add-supplier",
  "update-supplier",
  "delete-supplier",
  // ── cajeros y tareas (se replican; la escritura va al Host) ───────────────
  "add-cashier",
  "update-cashier",
  "delete-cashier",
  "add-task",
  "update-task",
  "delete-task",
  "complete-task",
  "get-tasks-by-date",
  // ── home: tareas e insights no están replicadas ───────────────────────────
  "get-today-tasks",
  "get-insights",
  "mark-insight",
  "run-weekly-pulse",
  "touch-customer",
  // ── ajustes de negocio (los del propio aparato se quedan locales) ─────────
  "save-setting",
  // ── recargas / paquetes: la integración con Taecel vive en el Host ────────
  "taecel:status",
  "taecel:get-balance",
  "taecel:get-catalog",
  "taecel:refresh-catalog",
  "taecel:recharge",
  "taecel:transaction-status",
  "taecel:history",
  "taecel:reconcile",
]);

const has = (channel) => RPC_CHANNELS.has(channel);

const list = () => [...RPC_CHANNELS].sort();

module.exports = { RPC_CHANNELS, has, list };
