// Logo del ticket: se redimensiona y se le recorta el margen blanco para que
// el dibujo llene el alto disponible en el ticket (max-height:75px). Se usa
// al subir el logo (Configuración) y al imprimir (venta y reimpresión), así
// un logo guardado sin recortar (antes de existir el recorte) sale igual en
// la prueba, en la venta y en la reimpresión.

const trimWhitespace = (canvas) => {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d");
  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return canvas;
  }
  const threshold = 245;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isWhite =
        data[i + 3] < 16 ||
        (data[i] >= threshold &&
          data[i + 1] >= threshold &&
          data[i + 2] >= threshold);
      if (!isWhite) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return canvas;
  const pad = 2;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w === width && h === height) return canvas;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, w, h);
  octx.drawImage(canvas, left, top, w, h, 0, 0, w, h);
  return out;
};

export const resizeImage = (dataUrl, maxSize = 256) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(trimWhitespace(canvas).toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

// Versión para imprimir con caché: el procesado (canvas) se hace una vez por
// logo distinto y las ventas siguientes reutilizan el resultado.
let ticketLogoCache = { source: null, result: Promise.resolve("") };
export const prepareTicketLogo = (dataUrl) => {
  if (!dataUrl) return Promise.resolve("");
  if (ticketLogoCache.source !== dataUrl) {
    ticketLogoCache = { source: dataUrl, result: resizeImage(dataUrl) };
  }
  return ticketLogoCache.result;
};
