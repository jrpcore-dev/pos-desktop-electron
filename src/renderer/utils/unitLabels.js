export const isContainerUnit = (u) => u === "box" || u === "package" || u === "boxpack";

export const unitLabels = (u) => {
  if (u === "box") {
    return {
      singular: "caja",
      plural: "cajas",
      short: "cj",
      badge: "caja",
      full: "Caja / Pieza",
      containerNoun: "Caja",
      priceContainer: "Precio caja",
      stockContainer: "Stock en cajas",
      pzasPer: "Pzas/caja",
      per: "por caja",
      perSlash: "/ caja",
      quantity: "Cantidad (cajas)",
      reduce: "Cantidad a reducir (cajas)",
      costPer: "Costo por caja",
      piecesPer: "piezas por caja",
      saleDetail: "Precio venta (caja)",
    };
  }
  if (u === "package") {
    return {
      singular: "paquete",
      plural: "paquetes",
      short: "pq",
      badge: "paquete",
      full: "Paquete / Pieza",
      containerNoun: "Paquete",
      priceContainer: "Precio paquete",
      stockContainer: "Stock en paquetes",
      pzasPer: "Pzas/paquete",
      per: "por paquete",
      perSlash: "/ paquete",
      quantity: "Cantidad (paquetes)",
      reduce: "Cantidad a reducir (paquetes)",
      costPer: "Costo por paquete",
      piecesPer: "piezas por paquete",
      saleDetail: "Precio venta (paquete)",
    };
  }
  if (u === "boxpack") {
    return {
      singular: "caja",
      plural: "cajas",
      short: "cj",
      badge: "caja",
      full: "Caja / Paquete / Pieza",
      containerNoun: "Caja",
      priceContainer: "Precio caja",
      stockContainer: "Stock en cajas",
      pzasPer: "Piezas/caja",
      per: "por caja",
      perSlash: "/ caja",
      quantity: "Cantidad (cajas)",
      reduce: "Cantidad a reducir (cajas)",
      costPer: "Costo por caja",
      piecesPer: "piezas por caja",
      saleDetail: "Precio venta (caja)",
    };
  }
  return null;
};
