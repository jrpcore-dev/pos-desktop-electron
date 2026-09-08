export const isContainerUnit = (u) => u === "box" || u === "package";

export const unitLabels = (u) => {
  if (u === "box") {
    return {
      singular: "caja",
      plural: "cajas",
      full: "Caja / Pieza",
      label: "Caja",
      priceContainer: "Precio venta caja",
      pricePieza: "Precio pieza",
      stockContainer: "Stock inicial (cajas)",
      pzasPer: "Piezas por caja",
      quantity: "Cantidad (cajas)",
      per: "por caja",
      piecesPer: "piezas por caja",
      saleDetail: "Precio venta (caja)",
      showMsg: "cajas",
      short: "pz",
    };
  }
  if (u === "package") {
    return {
      singular: "paquete",
      plural: "paquetes",
      full: "Paquete / Pieza",
      label: "Paquete",
      priceContainer: "Precio venta paquete",
      pricePieza: "Precio pieza",
      stockContainer: "Stock inicial (paquetes)",
      pzasPer: "Piezas por paquete",
      quantity: "Cantidad (paquetes)",
      per: "por paquete",
      piecesPer: "piezas por paquete",
      saleDetail: "Precio venta (paquete)",
      showMsg: "paquetes",
      short: "pz",
    };
  }
  return null;
};
