// Umbrales de antigüedad de los datos de una caja (réplica del Host). Una sola
// fuente para el aviso del encabezado y la pantalla de estado: antes cada una
// tenía su propio número y podían contradecirse.
export const STALE_WARN_MS = 30 * 60 * 1000;
export const STALE_STRONG_MS = 4 * 60 * 60 * 1000;
// Ventas en cola más viejas que esto: hay que avisar al administrador.
export const PENDING_ADMIN_MS = 60 * 60 * 1000;
