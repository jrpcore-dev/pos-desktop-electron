"use strict";
// ─── TICKET HTML → IMAGEN → ESC/POS RASTER (GS v 0) ──────────────────────────
// Ruta de impresión para térmicas: el MISMO HTML del ticket (logo, negritas,
// tildes, separadores) se renderiza en la ventana oculta, se captura como
// bitmap al ancho físico en puntos del cabezal, se binariza y se envía como
// imagen raster ESC/POS en datatype RAW. El driver de Windows NO participa,
// así que da igual si está instalado "POS-80", "Generic / Text Only" u otro:
// basta con que la impresora hable ESC/POS (prácticamente todas las térmicas).
//
// Las funciones de bytes (toMonochrome, encodeRaster, …) son puras y se
// prueban sin GUI en scripts/check-print.cjs; renderHtmlToBitmap usa la
// BrowserWindow que ya prepara printing.js.

const PRINT_MODES = ["auto", "escpos", "driver"];

// Puntos imprimibles por ancho de rollo a 203 dpi (8 puntos/mm). 80 mm → 72 mm
// útiles (576), 58 mm → 48 mm (384); 48 mm → contenido de 38 mm (304).
const DOTS_BY_PAPER_MM = { 48: 304, 58: 384, 80: 576 };
const MIN_DOTS = 128;
const MAX_DOTS = 832;

// Patrones de nombre/driver que delatan una impresora de tickets. Se evalúan
// sobre "nombre + driver + descripción". "Generic / Text Only" va aquí: con
// ese driver el HTML sale en blanco, pero el RAW llega intacto al firmware.
const THERMAL_PATTERNS = [
  /\bpos[\s_-]?\d{2}/i, // POS-58, POS-80, POS80C, POS 58
  /\bxp[\s_-]?\d/i, // Xprinter XP-58, XP-80C
  /\btm[\s_-]?[tum]\d/i, // EPSON TM-T20, TM-U220, TM-m30
  /\brp[\s_-]?\d{2,3}/i, // RP80, RP-326
  /\b(58|80)\s?mm\b/i,
  /thermal|t[ée]rmica|receipt|ticket/i,
  /generic\s*\/\s*text\s*only/i,
  /\b(bixolon|srp-|star\s?tsp|tsp\d|citizen\s?ct|sewoo|3nstar|ec[\s-]?line|nexus|hprt|gprinter|zjiang|zj-\d|rongta|munbyn|goojprt)/i,
];

const normalizePrintMode = (value) =>
  PRINT_MODES.includes(value) ? value : "auto";

// Ancho en puntos: override válido (múltiplo de 8 dentro de rango) o el que
// corresponde al rollo.
function resolveDotsWidth(paperWidthMm, override) {
  const forced = Number(override);
  if (
    Number.isInteger(forced) &&
    forced >= MIN_DOTS &&
    forced <= MAX_DOTS &&
    forced % 8 === 0
  ) {
    return forced;
  }
  return DOTS_BY_PAPER_MM[Number(paperWidthMm)] || DOTS_BY_PAPER_MM[58];
}

// Texto con el que se decide el modo "auto". En Windows, Electron/Chromium
// expone el driver en `options.system_driverinfo` ("POS-80;3.0;…").
function printerFingerprint(printer) {
  if (!printer) return "";
  const options = printer.options || {};
  return [
    printer.name,
    printer.displayName,
    printer.description,
    options.system_driverinfo,
    options["printer-make-and-model"],
  ]
    .filter((v) => typeof v === "string" && v)
    .join(" | ");
}

const looksLikeThermalPrinter = (printer) => {
  const fingerprint = printerFingerprint(printer);
  return THERMAL_PATTERNS.some((pattern) => pattern.test(fingerprint));
};

// Modo efectivo para una impresora: el explícito manda; "auto" detecta.
function resolveEffectiveMode(mode, printer) {
  const normalized = normalizePrintMode(mode);
  if (normalized !== "auto") return { mode: normalized, detected: false };
  return {
    mode: looksLikeThermalPrinter(printer) ? "escpos" : "driver",
    detected: true,
  };
}

// BGRA (nativeImage.toBitmap) → 1 bit por punto, filas empaquetadas MSB
// primero (formato de GS v 0). Umbral sobre luminancia: 160 engorda un poco
// el antialiasing del texto, que en térmica sale más legible. Con `dither`
// se usa Floyd–Steinberg (útil para logos fotográficos).
function toMonochrome(bgra, width, height, { threshold = 160, dither = false } = {}) {
  const bytesPerRow = Math.ceil(width / 8);
  const bits = Buffer.alloc(bytesPerRow * height);
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const alpha = bgra[p + 3] / 255;
    // Transparente = papel (blanco).
    const l = 0.114 * bgra[p] + 0.587 * bgra[p + 1] + 0.299 * bgra[p + 2];
    lum[i] = l * alpha + 255 * (1 - alpha);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = lum[i];
      const black = old < threshold;
      if (black) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      if (dither) {
        const err = old - (black ? 0 : 255);
        if (x + 1 < width) lum[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) lum[i + width - 1] += (err * 3) / 16;
          lum[i + width] += (err * 5) / 16;
          if (x + 1 < width) lum[i + width + 1] += err / 16;
        }
      }
    }
  }
  return { bits, bytesPerRow, width, height };
}

// Recorta filas en blanco al final (el alto medido ya es justo, pero el
// redondeo de la captura puede dejar alguna).
function trimTrailingBlankRows({ bits, bytesPerRow, width, height }) {
  let last = height;
  while (last > 0) {
    const row = bits.subarray((last - 1) * bytesPerRow, last * bytesPerRow);
    if (row.some((b) => b !== 0)) break;
    last--;
  }
  return {
    bits: bits.subarray(0, last * bytesPerRow),
    bytesPerRow,
    width,
    height: last,
  };
}

// Bloques de GS v 0 de como máximo 255 filas: varios firmwares baratos
// fallan (o imprimen basura) con una sola imagen alta.
const RASTER_BAND_ROWS = 255;

// Trabajo ESC/POS completo: inicializar → imagen por bandas → avance → corte.
function encodeRaster(mono, { cut = true, feedLines = 4 } = {}) {
  const { bits, bytesPerRow, height } = mono;
  const chunks = [Buffer.from([0x1b, 0x40])]; // ESC @
  chunks.push(Buffer.from([0x1b, 0x61, 0x00])); // ESC a 0 — sin centrado extra
  for (let y = 0; y < height; y += RASTER_BAND_ROWS) {
    const rows = Math.min(RASTER_BAND_ROWS, height - y);
    chunks.push(
      Buffer.from([
        0x1d, 0x76, 0x30, 0x00, // GS v 0 m=0 (densidad normal)
        bytesPerRow & 0xff,
        (bytesPerRow >> 8) & 0xff,
        rows & 0xff,
        (rows >> 8) & 0xff,
      ]),
    );
    chunks.push(bits.subarray(y * bytesPerRow, (y + rows) * bytesPerRow));
  }
  if (feedLines > 0) chunks.push(Buffer.from([0x1b, 0x64, feedLines])); // ESC d n
  if (cut) chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V B 0
  return Buffer.concat(chunks);
}

// Alto de cada franja de captura (DIP). Cabe en cualquier pantalla: Windows
// recorta ventanas más altas que el escritorio, por eso no se captura de una.
const CAPTURE_SLICE_DIP = 600;

const nextPaint = `new Promise((resolve) => {
  const done = () => resolve(true);
  setTimeout(done, 120);
  requestAnimationFrame(() => requestAnimationFrame(done));
})`;

// Renderiza el HTML YA cargado en `win` a un bitmap BGRA de `dotsWidth`
// columnas. El body (ancho fijo en mm) se pega a la izquierda y se aplica
// zoom de página para que su ancho sea exactamente `dotsWidth` DIP; luego se
// captura por franjas desplazando el scroll y se normaliza a 1 px = 1 punto
// (en pantallas HiDPI capturePage devuelve píxeles físicos).
async function renderHtmlToBitmap(win, { dotsWidth, heightCssPx, nativeImage }) {
  const wc = win.webContents;
  await wc.insertCSS(
    "html,body{margin:0!important}::-webkit-scrollbar{display:none}html{scrollbar-width:none}",
  );
  const bodyWidthCss = await wc.executeJavaScript(
    "document.body.getBoundingClientRect().width",
  );
  if (!Number.isFinite(bodyWidthCss) || bodyWidthCss <= 0) {
    throw new Error("No se pudo medir el ancho del ticket.");
  }
  const zoom = dotsWidth / bodyWidthCss;
  const totalDip = Math.ceil(heightCssPx * zoom);
  const sliceDip = Math.min(CAPTURE_SLICE_DIP, totalDip);
  win.setContentSize(dotsWidth, sliceDip);
  wc.setZoomFactor(zoom);
  // El zoom se aplica de forma asíncrona: esperar a que el viewport refleje
  // el ancho del body antes de capturar.
  await wc.executeJavaScript(`(async () => {
    for (let i = 0; i < 40; i++) {
      if (Math.abs(window.innerWidth - ${bodyWidthCss}) < 2) break;
      await ${nextPaint};
    }
    return window.innerWidth;
  })()`);

  const out = Buffer.alloc(dotsWidth * totalDip * 4, 0xff);
  for (let y0 = 0; y0 < totalDip; y0 += sliceDip) {
    const rows = Math.min(sliceDip, totalDip - y0);
    // scrollTo en CSS px; el navegador recorta al máximo desplazable, así que
    // se lee el scroll real para saber dónde cae y0 dentro de la franja.
    const scrollCss = await wc.executeJavaScript(`(async () => {
      window.scrollTo(0, ${y0 / zoom});
      await ${nextPaint};
      return window.scrollY;
    })()`);
    const offsetDip = Math.max(0, Math.round(y0 - scrollCss * zoom));
    const captureRows = Math.min(rows, sliceDip - offsetDip);
    if (captureRows <= 0) break;
    let image = await wc.capturePage({
      x: 0,
      y: offsetDip,
      width: dotsWidth,
      height: captureRows,
    });
    if (!image || image.isEmpty()) {
      throw new Error("La captura del ticket salió vacía.");
    }
    const size = image.getSize();
    if (size.width !== dotsWidth || size.height !== captureRows) {
      image = nativeImage
        .createFromBuffer(image.toPNG())
        .resize({ width: dotsWidth, height: captureRows, quality: "best" });
    }
    const bitmap = image.toBitmap();
    bitmap.copy(out, y0 * dotsWidth * 4, 0, dotsWidth * captureRows * 4);
  }
  return { bgra: out, width: dotsWidth, height: totalDip };
}

module.exports = {
  PRINT_MODES,
  DOTS_BY_PAPER_MM,
  RASTER_BAND_ROWS,
  normalizePrintMode,
  resolveDotsWidth,
  printerFingerprint,
  looksLikeThermalPrinter,
  resolveEffectiveMode,
  toMonochrome,
  trimTrailingBlankRows,
  encodeRaster,
  renderHtmlToBitmap,
};
