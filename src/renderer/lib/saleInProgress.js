// ¿Hay productos en algún ticket abierto de la terminal? Lo publica la
// terminal de venta y lo consulta, por ejemplo, la actualización para no
// reiniciar a media venta. Al quedar vacío se avisa con `vendia:tickets-empty`.

let openItems = 0;

export const setOpenItems = (n) => {
  const next = Math.max(0, Number(n) || 0);
  const wasBusy = openItems > 0;
  openItems = next;
  if (wasBusy && next === 0) {
    try {
      window.dispatchEvent(new Event("vendia:tickets-empty"));
    } catch (e) {}
  }
};

export const hasSaleInProgress = () => openItems > 0;
