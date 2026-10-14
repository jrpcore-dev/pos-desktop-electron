/**
 * Estado global mínimo de solo lectura para los atajos de teclado globales.
 *
 * El carrito vive en estado React dentro de `SalesTerminal` (useMultiCart) y no
 * se persiste, así que `Layout` no puede saberlo directamente. En vez de mover
 * el estado o acoplarse a un contexto, el terminal publica aquí si hay una venta
 * en curso y los atajos sensibles (F12 = cerrar sesión) lo consultan antes de
 * actuar.
 *
 * Es un flag booleano simple, sin suscriptores ni re-renders: se lee en el
 * instante del keydown.
 */
let saleInProgress = false;

/** Lo llama SalesTerminal cuando cambia el número de artículos del carrito. */
export const setSaleInProgress = (value) => {
  saleInProgress = !!value;
};

/** true si hay artículos en el carrito (venta en curso). */
export const isSaleInProgress = () => saleInProgress;
