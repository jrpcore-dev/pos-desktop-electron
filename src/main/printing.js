"use strict";
// ─── MOTOR DE IMPRESIÓN DE TICKETS ───────────────────────────────────────────
// Módulo extraído de main.js para aislar el sistema de impresión:
//   1) Configuración (nombre de impresora + ancho de papel) y su sanitización.
//   2) Resolución de la impresora destino (política explícita, sin sorpresas).
//   3) Preparación del documento (medición del HTML renderizado).
//   4) Construcción de las opciones de `webContents.print` de Electron.
//   5) Ejecución del trabajo, timeout, limpieza y diagnóstico.
//   6) Modo de impresión: "escpos" (HTML → imagen → ESC/POS raster en RAW,
//      sin driver; ver escpos-raster.js) o "driver" (webContents.print). En
//      "auto" se elige por nombre/driver de la impresora.
//
// Nada de esto depende de Electron de forma estática: todo pasa por `deps`,
// lo que permite testear el motor sin GUI (scripts/check-print.cjs).
//
// ── Evidencia de semántica de Electron 37.2.0 (instalado) ────────────────────
// Revisada en la fuente oficial (shell/browser/api/electron_api_web_contents.cc,
// rama v37.2.0) y verificada empíricamente con page-size-probe.js:
//   * `scaleFactor` es un PORCENTAJE; el default del propio Electron es 100
//     (`options.ValueOrDefault("scaleFactor", 100)`). Un valor de 1 imprime el
//     contenido al 1 % (commit 2d57257 introdujo exactamente ese bug).
//   * SIN `pageSize`, Electron envía A4 (210×297 mm) al spooler — la rama v37
//     no tiene `usePrinterDefaultPageSize` (esa opción llegó después); pasarla
//     aquí NO tiene ningún efecto. Por eso el ticket SIEMPRE lleva pageSize
//     explícito en micrones.
//   * `pageSize` personalizado se valida: mínimo 352 micrones por lado
//     ( Chromium lanza "must be minimum 352 micrones" antes de tocar el driver).
//   * `dpi` sólo se envía al driver si se pasa explícitamente; sin él se usa
//     la resolución NATIVA del controlador (correcto para cualquier impresora).
//   * `printToPDF` recibe tamaños personalizados en PULGADAS (no micrones).
//
// Tamaño de ticket: el ancho viene de `paper_width_mm` (48/58/80 mm) y el ALTO
// se mide del propio HTML (ticket de N mm, no un rollo fijo de 200 mm), con
// tope de 1024 mm para no descontrolar drivers con DEVMODE de 16 bits.

const fs = require("fs");
const path = require("path");

const escpos = require("./escpos");
const raster = require("./escpos-raster");

const PAPER_WIDTHS_MM = [48, 58, 80];

// Límites del tamaño de página personalizado (Electron/Chromium validan el
// mínimo; el máximo evita alturas absurdas por un HTML corrupto).
const MIN_PAGE_DIMENSION_MICRONS = 353;
const MAX_TICKET_HEIGHT_MM = 1024;

// Ventana oculta de render: CSS px = mm × 96 / 25.4. El ancho de la ventana
// sigue al rollo para que el layout del body (fijado en mm) no sufra recortes
// por viewport angosto; el ALTO de la ventana no limita la impresión (la
// página la define `pageSize`), pero da un render inicial razonable.
const PRINT_WINDOW_HEIGHT_PX = 700;
const PRINT_EXTRA_WIDTH_PX = 20;

// Tiempo máximo a esperar el callback de webContents.print. En la práctica un
// trabajo válido responde en < 2 s; drivers rotos pueden no responder NUNCA
// (observado empíricamente con mediaSize inválido: el callback queda colgado).
const PRINT_CALLBACK_TIMEOUT_MS = 8000;
// Si el callback nunca vino, el WebContents no se destruye al instante (destrir
// a mitad de un trabajo en curso puede tumbar el proceso); pero tampoco se
// fuga para siempre: a los 30 s se fuerza la limpieza.
const PRINT_DESTROY_GRACE_MS = 30000;

const normalizePaperWidth = (value) => {
  const width = Number(value);
  return PAPER_WIDTHS_MM.includes(width) ? width : 58;
};

// Frontera de validación del nombre de impresora: viaja al spooler de Windows
// y a `deviceName` de Electron. Vacío = "sin configurar" (predeterminada del
// sistema), que es un estado legítimo y explícito.
const sanitizePrinterName = (value) => {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length === 0 || name.length > 128 || /[\r\n\0]/.test(name)) {
    return "";
  }
  return name;
};

// Política de resolución de la impresora destino:
//   * nombre configurado y presente  → ese exacto (sin normalizar mayúsculas:
//     Electron exige el nombre del sistema, no el "friendly").
//   * nombre configurado y AUSENTE   → predeterminada del sistema, marcando
//     `fellBack: true` para que el renderer avise al cajero (nunca en silencio).
//   * sin configurar                 → predeterminada del sistema.
//   * no hay impresoras              → { name: null } (error explícito arriba).
function resolvePrinterTarget(printers, configuredName) {
  const list = printers || [];
  const configured = sanitizePrinterName(configuredName);
  if (configured) {
    const exact = list.find((p) => p.name === configured);
    if (exact) return { name: exact.name, fellBack: false };
    console.warn(
      `[PRINT] «${configured}» no está disponible; se usa la predeterminada.`,
    );
  }
  const fallback = list.find((p) => p.isDefault) || list[0];
  if (!fallback) return { name: null, fellBack: false };
  return { name: fallback.name, fellBack: Boolean(configured) };
}

// Altura medida del ticket (CSS px, 1 px = 1/96") → página en micrones.
// Lanza si el contenido no admite una página válida; tope superior defensivo.
function buildPageSize(paperWidthMm, heightCssPx) {
  const width = normalizePaperWidth(paperWidthMm) * 1000;
  const heightPx = Number(heightCssPx);
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    throw new Error("Altura de ticket inválida para calcular la página.");
  }
  // +1 CSS px cubre redondeos fraccionarios (siempre redondea HACIA ARRIBA:
  // una fracción de píxel de contenido no debe cortarse en el borde).
  const maxPx = (MAX_TICKET_HEIGHT_MM * 96) / 25.4;
  const height = Math.ceil(
    ((Math.min(heightPx, maxPx) + 1) * 25400) / 96,
  );
  if (
    width < MIN_PAGE_DIMENSION_MICRONS ||
    height < MIN_PAGE_DIMENSION_MICRONS
  ) {
    throw new Error("El tamaño de página calculado no es válido para Electron.");
  }
  return { width, height };
}

// Opciones de webContents.print con semántica verificada de Electron 37:
// scaleFactor 100 (tamaño real), SIN dpi (resolución nativa del controlador),
// SIN usePrinterDefaultPageSize (no existe en 37; además sería A4 implícito),
// y pageSize SIEMPRE explícito (jamás el A4 silencioso por omisión).
function buildPrintOptions({ deviceName, pageSize }) {
  return {
    silent: true,
    printBackground: true,
    color: false,
    deviceName,
    margins: { marginType: "none" },
    pageSize,
    scaleFactor: 100,
  };
}

// Script inyectado en la ventana oculta ANTES de imprimir:
//   * espera fuentes e imágenes (logos) — sin esto, 30 ms de sleep no cubre
//     una imagen base64 grande y el ticket saldría sin ella;
//   * mide la altura REAL del contenido (body), no la de la ventana;
//   * avisa si el documento quedó vacío (separa "HTML roto" de "driver roto").
const PRINT_MEASURE_JS = `
  (async () => {
    await document.fonts?.ready;
    await Promise.all(Array.from(document.images, (image) => {
      const loaded = image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          });
      return loaded.then(() => image.decode?.().catch(() => {}));
    }));
    const body = document.body;
    const bodyTop = body.getBoundingClientRect().top;
    const contentBottom = Math.max(0, ...Array.from(body.children, (element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom - bodyTop + Math.max(0, element.scrollHeight - element.clientHeight);
    }));
    const paddingBottom = Number.parseFloat(getComputedStyle(body).paddingBottom) || 0;
    return {
      hasContent: Boolean(body.innerText.trim() || body.querySelector("img, canvas, svg")),
      // Medir el contenido real. La altura del viewport/root/body puede ser
      // la de la ventana oculta y no la longitud del ticket.
      heightCssPx: Math.ceil(contentBottom + paddingBottom)
    };
  })()
`;

// webContents.print con timeout. El callback de Electron puede no llegar nunca
// (drivers con ajustes inválidos): el timeout devuelve un error claro en vez
// de colgar la venta. Al vencer, `onTimeout` pospone la destrucción de la
// ventana (destrir a mitad de un trabajo en curso puede tumbar Electron); si
// el callback llega TARDE, la ventana ya queda cubierta por esa limpieza.
function printWithElectron(webContents, options, timeoutMs, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      if (onTimeout) onTimeout();
      reject(
        new Error(
          `TIMEOUT: el callback de print no respondió en ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);
    try {
      webContents.print(options, (success, failureReason) => {
        if (settled) {
          // Callback tardío tras timeout: la ventana ya tiene limpieza
          // pospuesta; aquí no se toca nada.
          return;
        }
        clearTimeout(timeoutId);
        settled = true;
        if (success) resolve(true);
        else reject(new Error(failureReason || "No se pudo enviar el trabajo de impresión"));
      });
    } catch (error) {
      clearTimeout(timeoutId);
      settled = true;
      reject(error);
    }
  });
}

// Motor de impresión con dependencias inyectadas (testeable sin GUI):
//   getPrinterConfig()             → { printerName, paperWidthMm } (main.js/BD)
//   listSystemPrinters()           → PrinterInfo[] de Electron
//   createPrintWindow(opts)        → BrowserWindow oculta de render
//   getTempPath()                  → app.getPath("temp")
//   sendRaw(printer, bytes, opts)  → worker RAW (escpos.createRawPrinterWorker)
//   nativeImage                    → nativeImage de Electron (modo ESC/POS)
//   printTimeoutMs / destroyGraceMs (opcionales)
//   log (opcional)                 → console.log por defecto
function createPrintEngine(deps) {
  const {
    getPrinterConfig,
    listSystemPrinters,
    createPrintWindow,
    getTempPath,
    sendRaw,
    nativeImage,
    printTimeoutMs = PRINT_CALLBACK_TIMEOUT_MS,
    destroyGraceMs = PRINT_DESTROY_GRACE_MS,
    log = (...args) => console.log(...args),
  } = deps;

  // Vista previa del ticket TAL COMO se manda a la térmica (1 bit), para el
  // botón de prueba: separa "imagen mal generada" de "impresora no responde".
  function saveMonoPreview({ bits, bytesPerRow, width, height }) {
    try {
      const bgra = Buffer.alloc(width * height * 4, 0xff);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (bits[y * bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) {
            const p = (y * width + x) * 4;
            bgra[p] = bgra[p + 1] = bgra[p + 2] = 0;
          }
        }
      }
      const image = nativeImage.createFromBitmap(bgra, { width, height });
      const previewPath = path.join(getTempPath(), "vendia-escpos-preview.png");
      fs.writeFileSync(previewPath, image.toPNG());
      log("[PRINT] Vista previa ESC/POS:", previewPath);
    } catch (previewError) {
      log("[PRINT] No se pudo guardar la vista previa ESC/POS:", previewError.message);
    }
  }

  async function printReceipt(htmlContent, overrides) {
    const startedAt = Date.now();
    let printWin = null;
    let printTimedOut = false;
    let variant = "ticket";
    try {
      const config = getPrinterConfig();
      // `overrides` sólo lo usa "Imprimir prueba" de Configuración para
      // reflejar ajustes aún no guardados; se sanitiza aquí.
      const ovPrinter = sanitizePrinterName(overrides?.printerName);
      const ovWidth = Number(overrides?.paperWidthMm);
      const printerName = overrides && ovPrinter ? ovPrinter : config.printerName;
      const paperWidthMm =
        overrides && PAPER_WIDTHS_MM.includes(ovWidth)
          ? ovWidth
          : config.paperWidthMm;
      // "PDF" es la variante diagnóstica del botón de prueba.
      variant = overrides?.printVariant === "PDF" ? "PDF" : "ticket";
      const requestedMode =
        overrides && raster.PRINT_MODES.includes(overrides.printMode)
          ? overrides.printMode
          : config.printMode;
      const dotsOverride =
        overrides && Object.hasOwn(overrides, "dotsWidth")
          ? overrides.dotsWidth
          : config.dotsWidth;

      const printers = await listSystemPrinters();
      const target = resolvePrinterTarget(printers, printerName);
      if (!target.name) {
        return {
          success: false,
          code: "NO_PRINTER",
          error: "No se detectaron impresoras en este equipo.",
        };
      }
      const { mode, detected } = raster.resolveEffectiveMode(
        requestedMode,
        printers.find((p) => p.name === target.name),
      );
      log(
        "[PRINT] destino:",
        target.name,
        target.fellBack ? "(respaldo: la configurada no existe)" : "",
        "| papel:",
        `${paperWidthMm} mm`,
        "| modo:",
        mode,
        detected ? "(automático)" : "",
        "| variant:",
        variant,
        "| impresoras:",
        printers.map((p) => p.name).join(", "),
      );

      printWin = createPrintWindow({
        show: false,
        width: Math.ceil((paperWidthMm * 96) / 25.4) + PRINT_EXTRA_WIDTH_PX,
        height: PRINT_WINDOW_HEIGHT_PX,
        backgroundColor: "#ffffff",
        // Sin throttling: la captura raster espera frames de una ventana
        // que nunca se muestra.
        webPreferences: { sandbox: true, backgroundThrottling: false },
      });

      await printWin.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
      );

      // Render listo = fuentes + imágenes cargadas + contenido medido.
      const rendered = await printWin.webContents.executeJavaScript(
        PRINT_MEASURE_JS,
      );
      if (
        !rendered?.hasContent ||
        !Number.isFinite(rendered.heightCssPx) ||
        rendered.heightCssPx <= 0
      ) {
        throw new Error("El ticket no produjo contenido imprimible.");
      }
      const pageSize = buildPageSize(paperWidthMm, rendered.heightCssPx);

      // Captura diagnóstica sólo para el botón "Imprimir prueba": permite
      // separar un HTML que ya se ve vacío de un fallo del controlador.
      if (overrides && Object.hasOwn(overrides, "paperWidthMm")) {
        try {
          const preview = await printWin.webContents.capturePage();
          const previewPath = path.join(
            getTempPath(),
            "vendia-print-preview.png",
          );
          fs.writeFileSync(previewPath, preview.toPNG());
          log("[PRINT] Vista previa del render:", previewPath);
        } catch (previewError) {
          log("[PRINT] No se pudo capturar la vista previa:", previewError.message);
        }
      }

      if (variant === "PDF") {
        // printToPDF recibe tamaños personalizados en PULGADAS (a diferencia
        // de webContents.print, que los recibe en micrones).
        const pdfBuffer = await printWin.webContents.printToPDF({
          printBackground: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: {
            width: paperWidthMm / 25.4,
            height: (rendered.heightCssPx + 1) / 96,
          },
        });
        log(
          `[PRINT] PDF diagnóstico listo (${pageSize.width}×${pageSize.height} µm) en ${Date.now() - startedAt} ms`,
        );
        return {
          success: true,
          printer: target.name,
          fellBack: target.fellBack,
          variant: "PDF",
          pdf: new Uint8Array(pdfBuffer),
        };
      }

      if (mode === "escpos") {
        const dotsWidth = raster.resolveDotsWidth(paperWidthMm, dotsOverride);
        const bitmap = await raster.renderHtmlToBitmap(printWin, {
          dotsWidth,
          heightCssPx: rendered.heightCssPx,
          nativeImage,
        });
        const mono = raster.trimTrailingBlankRows(
          raster.toMonochrome(bitmap.bgra, bitmap.width, bitmap.height),
        );
        if (mono.height === 0) {
          throw new Error("El ticket rasterizado quedó en blanco.");
        }
        if (overrides && Object.hasOwn(overrides, "paperWidthMm")) {
          saveMonoPreview(mono);
        }
        const payload = raster.encodeRaster(mono, { cut: config.escposCut !== false });
        log(
          `[PRINT] ESC/POS raster ${mono.width}×${mono.height} puntos, ${payload.length} bytes`,
        );
        const sent = await sendRaw(target.name, payload, { docName: "Vendia ticket" });
        if (!sent.ok) {
          return {
            success: false,
            code: "ESCPOS_RAW_ERROR",
            mode,
            printer: target.name,
            error: `No se pudo enviar el ticket ESC/POS: ${sent.error}. Si la impresora no es térmica, cambia el modo a "Driver de Windows".`,
          };
        }
        log(
          `[PRINT] spooler aceptó el ticket ESC/POS en ${Date.now() - startedAt} ms; esto no confirma la salida física.`,
        );
        return {
          success: true,
          printer: target.name,
          fellBack: target.fellBack,
          variant: "ticket",
          mode,
          detected,
        };
      }

      const printOptions = buildPrintOptions({
        deviceName: target.name,
        pageSize,
      });
      log(
        "[PRINT] solicitud:",
        JSON.stringify({
          printer: target.name,
          paperWidthMm,
          heightCssPx: rendered.heightCssPx,
          pageSizeMicrons: pageSize,
          options: printOptions,
        }),
      );

      // Si el callback NUNCA llega (driver colgado), la ventana se destruye
      // de forma pospuesta: destrir a mitad de trabajo puede tumbar Electron,
      // pero una ventana oculta no puede fugarse para siempre.
      await printWithElectron(printWin.webContents, printOptions, printTimeoutMs, () => {
        printTimedOut = true;
        setTimeout(() => {
          if (printWin && !printWin.isDestroyed()) printWin.destroy();
        }, destroyGraceMs);
      });

      log(
        `[PRINT] Electron aceptó el trabajo en ${Date.now() - startedAt} ms; esto no confirma la salida física.`,
      );
      return {
        success: true,
        printer: target.name,
        fellBack: target.fellBack,
        variant: "ticket",
        mode,
        detected,
        acceptedByElectron: true,
      };
    } catch (error) {
      console.error(`[PRINT ERROR] (${variant}):`, error.message);
      return { success: false, code: "PRINT_ERROR", error: error.message };
    } finally {
      // Con timeout, la limpieza pospuesta (30 s) se encarga: no destruir la
      // ventana mientras Electron pueda tener el trabajo en curso.
      if (!printTimedOut && printWin && !printWin.isDestroyed()) {
        printWin.destroy();
      }
    }
  }

  // Prueba ESC/POS en texto (botón "Prueba ESC/POS" de Configuración):
  // mismo spooler y misma política de impresora que printReceipt, pero sin
  // imagen: si ESTO imprime y el modo driver no, usar el modo ESC/POS.
  async function printEscPosTest(overrides) {
    try {
      const config = getPrinterConfig();
      const ovPrinter = sanitizePrinterName(overrides?.printerName);
      const ovWidth = Number(overrides?.paperWidthMm);
      const printerName = ovPrinter || config.printerName;
      const paperWidthMm = PAPER_WIDTHS_MM.includes(ovWidth)
        ? ovWidth
        : config.paperWidthMm;

      const printers = await listSystemPrinters();
      const target = resolvePrinterTarget(printers, printerName);
      if (!target.name) {
        return {
          success: false,
          code: "NO_PRINTER",
          error: "No se detectaron impresoras en este equipo.",
        };
      }
      const payload = escpos.buildEscPosTestTicket({
        printerLabel: target.name,
        paperWidthMm: normalizePaperWidth(paperWidthMm),
      });
      log(
        "[ESCPOS] prueba RAW de",
        payload.length,
        "bytes a «",
        target.name,
        "»",
        target.fellBack ? "(respaldo: la configurada no existe)" : "",
      );
      const result = await sendRaw(target.name, payload, {
        docName: "Vendia ESC/POS test",
      });
      if (!result.ok) {
        return {
          success: false,
          code: "ESCPOS_RAW_ERROR",
          printer: target.name,
          error: result.error,
        };
      }
      log("[ESCPOS] spooler aceptó", result.bytes, "bytes (no confirma salida física).");
      return {
        success: true,
        printer: target.name,
        fellBack: target.fellBack,
        rawBytes: payload.length,
      };
    } catch (error) {
      console.error("[ESCPOS ERROR]:", error.message);
      return { success: false, code: "ESCPOS_ERROR", error: error.message };
    }
  }

  return { printReceipt, printEscPosTest };
}

module.exports = {
  PAPER_WIDTHS_MM,
  MIN_PAGE_DIMENSION_MICRONS,
  MAX_TICKET_HEIGHT_MM,
  PRINT_MEASURE_JS,
  normalizePaperWidth,
  sanitizePrinterName,
  resolvePrinterTarget,
  buildPageSize,
  buildPrintOptions,
  printWithElectron,
  createPrintEngine,
};
