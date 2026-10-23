"use strict";
/*
 * Pruebas del motor de impresión de tickets (src/main/printing.js) y del
 * generador HTML del ticket (src/renderer/utils/receiptTemplate.js).
 *
 * Qué cubre (sin hardware ni GUI):
 *   - sanitización del nombre de impresora (frontera hacia el spooler);
 *   - política de resolución de la impresora destino (sin fallbacks mudos);
 *   - cálculo de pageSize en micrones (ancho por rollo, alto medido, topes);
 *   - opciones de webContents.print de Electron 37 (scaleFactor 100, sin dpi,
 *     sin usePrinterDefaultPageSize, pageSize SIEMPRE explícito);
 *   - timeout del callback de print y limpieza pospuesta de la ventana;
 *   - orquestación del motor con dependencias falsas (NO_PRINTER, render
 *     vacío, éxito, fellBack, variante PDF);
 *   - HTML del ticket: anchos 48/58/80, logo, escaping, texto largo.
 *   - modo de impresión: detección "auto" por nombre/driver, binarización,
 *     codificación raster GS v 0 y camino ESC/POS del motor (sendRaw);
 *   - protocolo del worker RAW persistente.
 *
 * NO valida la salida física de ninguna impresora: eso requiere hardware.
 *
 * Uso: node scripts/check-print.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const REPO = path.resolve(__dirname, "..");
const printing = require(path.join(REPO, "src", "main", "printing.js"));

let pass = 0;
let fail = 0;
const check = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? " :: " + extra : ""));
  }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log("=== check-print · motor de impresión y ticket HTML ===");

  // ── 1. normalizePaperWidth ────────────────────────────────────────────────
  check(printing.normalizePaperWidth(48) === 48, "normalizePaperWidth(48)");
  check(printing.normalizePaperWidth("80") === 80, 'normalizePaperWidth("80")');
  check(printing.normalizePaperWidth(58) === 58, "normalizePaperWidth(58)");
  check(printing.normalizePaperWidth(99) === 58, "normalizePaperWidth(99) → 58");
  check(printing.normalizePaperWidth(undefined) === 58, "normalizePaperWidth(undefined) → 58");

  // ── 2. sanitizePrinterName ────────────────────────────────────────────────
  check(printing.sanitizePrinterName(" POS-80 ") === "POS-80", "sanitizePrinterName recorta espacios");
  check(printing.sanitizePrinterName("A".repeat(129)) === "", "sanitizePrinterName rechaza >128");
  check(printing.sanitizePrinterName("EP\r\nON") === "", "sanitizePrinterName rechaza CRLF");
  check(printing.sanitizePrinterName("EP\0SON") === "", "sanitizePrinterName rechaza NUL");
  check(printing.sanitizePrinterName(null) === "", "sanitizePrinterName(null) → vacío");
  check(printing.sanitizePrinterName(42) === "", "sanitizePrinterName(no string) → vacío");

  // ── 3. resolvePrinterTarget (política explícita) ──────────────────────────
  const printers = [
    { name: "EPSON L3150 Series", isDefault: false },
    { name: "POS-80", isDefault: true },
  ];
  check(
    eq(printing.resolvePrinterTarget(printers, "POS-80"), { name: "POS-80", fellBack: false }),
    "resolución: nombre configurado exacto",
  );
  check(
    eq(printing.resolvePrinterTarget(printers, "Inexistente"), { name: "POS-80", fellBack: true }),
    "resolución: ausente → predeterminada CON fellBack",
  );
  check(
    eq(printing.resolvePrinterTarget(printers, ""), { name: "POS-80", fellBack: false }),
    "resolución: sin configurar → predeterminada sin fellBack",
  );
  check(
    eq(printing.resolvePrinterTarget([], "POS-80"), { name: null, fellBack: false }),
    "resolución: sin impresoras → name null",
  );

  // ── 4. buildPageSize ──────────────────────────────────────────────────────
  const ps58 = printing.buildPageSize(58, 500);
  check(ps58.width === 58000, "pageSize: ancho = rollo en micrones", String(ps58.width));
  check(
    ps58.height === Math.ceil((501 * 25400) / 96),
    "pageSize: alto = altura medida + 1 px, en micrones",
    String(ps58.height),
  );
  const ps80 = printing.buildPageSize(80, 1200);
  check(ps80.width === 80000, "pageSize: 80 mm → 80000 micrones");
  check(
    ps80.height === Math.ceil((1201 * 25400) / 96),
    "pageSize: ticket largo usa la altura medida (no un rollo fijo)",
  );
  const psClamp = printing.buildPageSize(58, 10 ** 9);
  check(
    psClamp.height === Math.ceil(((printing.MAX_TICKET_HEIGHT_MM * 96) / 25.4 + 1) * 25400 / 96),
    "pageSize: altura tope a MAX_TICKET_HEIGHT_MM",
    String(psClamp.height),
  );
  for (const bad of [0, -5, NaN, Infinity]) {
    let threw = false;
    try {
      printing.buildPageSize(58, bad);
    } catch {
      threw = true;
    }
    check(threw, `pageSize: altura ${String(bad)} lanza`);
  }

  // ── 5. buildPrintOptions (semántica Electron 37) ──────────────────────────
  const opts = printing.buildPrintOptions({
    deviceName: "POS-80",
    pageSize: { width: 58000, height: 300000 },
  });
  check(opts.scaleFactor === 100, "opciones: scaleFactor 100 (porcentaje real)");
  check(!("dpi" in opts), "opciones: sin dpi (resolución nativa del driver)");
  check(
    !("usePrinterDefaultPageSize" in opts),
    "opciones: sin usePrinterDefaultPageSize (no existe en Electron 37)",
  );
  check(opts.deviceName === "POS-80", "opciones: deviceName exacto");
  check(opts.silent === true, "opciones: silent");
  check(opts.color === false, "opciones: grayscale (ticket monocromo)");
  check(eq(opts.margins, { marginType: "none" }), "opciones: sin márgenes");
  check(
    eq(opts.pageSize, { width: 58000, height: 300000 }),
    "opciones: pageSize SIEMPRE explícito",
  );

  // ── 6. printWithElectron (timeout y callback) ─────────────────────────────
  {
    const ok = await printing.printWithElectron(
      { print: (o, cb) => cb(true, "") },
      {},
      1000,
    );
    check(ok === true, "printWithElectron: callback success resuelve");
  }
  {
    let err = null;
    try {
      await printing.printWithElectron(
        { print: (o, cb) => cb(false, "Print job failed") },
        {},
        1000,
      );
    } catch (e) {
      err = e;
    }
    check(err?.message === "Print job failed", "printWithElectron: propaga failureReason", err?.message);
  }
  {
    let err = null;
    let timedOut = false;
    const t0 = Date.now();
    try {
      await printing.printWithElectron(
        { print: () => {} }, // callback nunca viene (driver colgado)
        {},
        120,
        () => {
          timedOut = true;
        },
      );
    } catch (e) {
      err = e;
    }
    check(/^TIMEOUT/.test(err?.message || ""), "printWithElectron: timeout con callback ausente", err?.message);
    check(timedOut, "printWithElectron: invoca onTimeout para la limpieza pospuesta");
    check(Date.now() - t0 < 2000, "printWithElectron: el timeout corta de verdad");
  }
  {
    // Callback tardío tras timeout: no debe revivir la promesa ni reventar.
    let err = null;
    let lateCb = null;
    try {
      await printing.printWithElectron(
        { print: (o, cb) => { lateCb = cb; } },
        {},
        80,
      );
    } catch (e) {
      err = e;
    }
    check(/^TIMEOUT/.test(err?.message || ""), "printWithElectron: timeout antes del callback tardío");
    let threw = false;
    try {
      lateCb(true, "");
    } catch {
      threw = true;
    }
    check(!threw, "printWithElectron: el callback tardío no revienta");
  }

  // ── 7. createPrintEngine (orquestación con deps falsas) ───────────────────
  const makeWindow = ({ measure = { hasContent: true, heightCssPx: 500 }, onPrint } = {}) => {
    const state = { destroyed: false, printCalls: [], previewFiles: [] };
    return {
      state,
      loadURL: async () => {},
      isDestroyed: () => state.destroyed,
      destroy: () => { state.destroyed = true; },
      webContents: {
        executeJavaScript: async () => measure,
        capturePage: async () => ({ toPNG: () => Buffer.from("png") }),
        printToPDF: async () => Buffer.from("%PDF-1.4"),
        print: (options, cb) => {
          state.printCalls.push(options);
          if (onPrint) onPrint(options, cb);
          else cb(true, "");
        },
      },
    };
  };

  // 7a. Sin impresoras → NO_PRINTER explícito.
  {
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-80", paperWidthMm: 58 }),
      listSystemPrinters: async () => [],
      createPrintWindow: () => {
        throw new Error("no debe crear ventana si no hay impresoras");
      },
      getTempPath: () => os.tmpdir(),
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>");
    check(res.success === false && res.code === "NO_PRINTER", "motor: sin impresoras → NO_PRINTER", JSON.stringify(res));
  }

  // 7b. Camino de éxito: opciones correctas y ventana limpiada.
  {
    const win = makeWindow();
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-80", paperWidthMm: 80, printMode: "driver" }),
      listSystemPrinters: async () => [{ name: "POS-80", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      log: () => {},
    });
    const res = await engine.printReceipt("<html><body>ticket</body></html>");
    check(res.success === true && res.acceptedByElectron === true, "motor: éxito devuelve acceptedByElectron", JSON.stringify(res));
    check(res.printer === "POS-80" && res.fellBack === false, "motor: destino correcto sin fellBack");
    const sent = win.state.printCalls[0];
    check(sent?.pageSize?.width === 80000, "motor: envía pageSize del rollo 80 mm", JSON.stringify(sent?.pageSize));
    check(sent?.scaleFactor === 100 && !("dpi" in sent), "motor: scaleFactor 100 y sin dpi");
    check(win.state.destroyed, "motor: la ventana se destruye al terminar");
  }

  // 7c. Render vacío → error claro (separa HTML roto de driver roto).
  {
    const win = makeWindow({ measure: { hasContent: false, heightCssPx: 0 } });
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "", paperWidthMm: 58 }),
      listSystemPrinters: async () => [{ name: "Default", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>");
    check(
      res.success === false && /contenido imprimible/.test(res.error),
      "motor: render vacío → error de preparación",
      JSON.stringify(res),
    );
    check(win.state.destroyed && win.state.printCalls.length === 0, "motor: render vacío no imprime y limpia la ventana");
  }

  // 7d. Configurada ausente → fellBack para que el renderer avise.
  {
    const win = makeWindow();
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "Desconectada", paperWidthMm: 58 }),
      listSystemPrinters: async () => [{ name: "Default", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>");
    check(res.success === true && res.fellBack === true && res.printer === "Default", "motor: ausente → respaldo marcado con fellBack", JSON.stringify(res));
  }

  // 7e. Timeout del callback → error + limpieza pospuesta de la ventana.
  {
    const win = makeWindow({ onPrint: () => {} }); // nunca responde
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-80", paperWidthMm: 58, printMode: "driver" }),
      listSystemPrinters: async () => [{ name: "POS-80", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      printTimeoutMs: 100,
      destroyGraceMs: 100,
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>");
    check(res.success === false && /^TIMEOUT/.test(res.error), "motor: callback colgado → TIMEOUT", JSON.stringify(res));
    check(!win.state.destroyed, "motor: no destruye la ventana con el trabajo en curso");
    await new Promise((r) => setTimeout(r, 250));
    check(win.state.destroyed, "motor: destruye la ventana tras la gracia");
  }

  // 7f. Variante PDF (diagnóstico): devuelve el buffer en pulgadas.
  {
    const win = makeWindow();
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-80", paperWidthMm: 48 }),
      listSystemPrinters: async () => [{ name: "POS-80", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>", {
      printerName: "POS-80",
      paperWidthMm: 48,
      printVariant: "PDF",
    });
    check(res.success === true && res.variant === "PDF" && res.pdf instanceof Uint8Array, "motor: variante PDF devuelve Uint8Array", JSON.stringify({ ...res, pdf: typeof res.pdf }));
    check(win.state.printCalls.length === 0, "motor: la variante PDF no envía trabajo a la impresora");
    // La captura diagnóstica del botón de prueba se escribe en temp.
    check(fs.existsSync(path.join(os.tmpdir(), "vendia-print-preview.png")), "motor: test print deja la vista previa PNG en temp");
    try { fs.unlinkSync(path.join(os.tmpdir(), "vendia-print-preview.png")); } catch {}
  }

  // 7g. Overrides: impresora y ancho de la UI de prueba (sin guardar).
  {
    const win = makeWindow();
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "Guardada", paperWidthMm: 58 }),
      listSystemPrinters: async () => [
        { name: "Guardada", isDefault: false },
        { name: "Otra", isDefault: true },
      ],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>", {
      printerName: "Otra",
      paperWidthMm: 999, // inválido → debe caer al configurado (58)
    });
    check(res.printer === "Otra", "motor: override de impresora aplica", JSON.stringify(res));
    check(win.state.printCalls[0]?.pageSize?.width === 58000, "motor: ancho inválido cae al configurado", JSON.stringify(win.state.printCalls[0]?.pageSize));
  }

  // ── 8. receiptTemplate.js (ESM) ───────────────────────────────────────────
  const tpl = await import(pathToFileURL(path.join(REPO, "src", "renderer", "utils", "receiptTemplate.js")).href);
  const baseModel = {
    store: { name: "MI TIENDA" },
    ticketNum: "T-1",
    items: [{ name: "Refresco", qtyDisplay: 2, unit: "pza", unitPrice: 15, lineTotal: 30 }],
    subtotal: 30,
    total: 30,
  };
  for (const [mm, content] of [[48, 38], [58, 48], [80, 70]]) {
    const html = tpl.buildReceiptHTML({ ...baseModel, paperWidthMm: mm });
    check(html.includes(`width:${content}mm`), `ticket ${mm} mm → contenido ${content} mm`);
    check(html.includes("@page{margin:0}"), `ticket ${mm} mm → @page sin tamaño fijo (page size = Electron)`);
    check(!/@page\{size:/.test(html), `ticket ${mm} mm → sin @page size conflictivo`);
  }
  {
    const withLogo = tpl.buildReceiptHTML({ ...baseModel, store: { name: "X", logo: "data:image/png;base64,AAAA" } });
    const withoutLogo = tpl.buildReceiptHTML(baseModel);
    check(withLogo.includes('src="data:image/png;base64,AAAA"'), "ticket: logo incluido cuando existe");
    check(withLogo.includes("max-height:75px"), "ticket: logo con tope de altura");
    check(!withoutLogo.includes("<img"), "ticket: sin <img> si no hay logo");
  }
  {
    const nasty = tpl.buildReceiptHTML({
      ...baseModel,
      items: [{ name: "<script>alert(1)</script> & cia", qtyDisplay: 1, unit: "pza", unitPrice: 1, lineTotal: 1 }],
      cashierName: '<img src=x onerror=1>',
    });
    check(!nasty.includes("<script>alert(1)"), "ticket: escapa < y > en nombres");
    check(nasty.includes("&lt;script&gt;"), "ticket: escaping HTML efectivo");
    check(nasty.includes("&amp; cia"), "ticket: escapa &");
  }
  {
    const long = tpl.buildReceiptHTML({
      ...baseModel,
      items: [{ name: "Producto con nombre larguísimo que no cabe en una línea del ticket", qtyDisplay: 1, unit: "pza", unitPrice: 99.5, lineTotal: 99.5 }],
    });
    check(long.includes("Producto con nombre larguísimo"), "ticket: conserva el nombre largo (wrap, no truncado)");
    check(long.includes("overflow-wrap:break-word"), "ticket: CSS anti-desborde de palabras largas");
  }
  {
    const longTicket = tpl.buildReceiptHTML({
      ...baseModel,
      items: Array.from({ length: 60 }, (_, i) => ({ name: `Producto ${i}`, qtyDisplay: 1, unit: "pza", unitPrice: 10, lineTotal: 10 })),
    });
    const rows = (longTicket.match(/Producto \d+/g) || []).length;
    check(rows === 60, "ticket largo: los 60 renglones presentes (sin altura fija que corte)");
    check(longTicket.includes('height:20px'), "ticket: mantiene el espacio final para el corte");
  }
  {
    const money = tpl.buildReceiptHTML({ ...baseModel, total: 1234.5, subtotal: 1234.5 });
    check(money.includes("1,234.50"), "ticket: importes con formato es-MX");
  }

  // ── 9. Prueba ESC/POS (RAW, src/main/escpos.js) ─────────────────────────
  {
    const escpos = require(path.join(REPO, "src", "main", "escpos.js"));
    const ticket = escpos.buildEscPosTestTicket({
      printerLabel: "POS-80",
      paperWidthMm: 80,
    });
    check(
      ticket.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])),
      "escpos: abre con ESC @ (inicializar)",
    );
    check(
      ticket.subarray(ticket.length - 4).equals(Buffer.from([0x1d, 0x56, 0x42, 0x00])),
      "escpos: cierra con GS V B 0 (corte parcial)",
    );
    check(ticket.includes(Buffer.from("PRUEBA ESC/POS (RAW)", "ascii")), "escpos: texto de prueba presente");
    check(ticket.includes(Buffer.from("Papel: 80 mm", "ascii")), "escpos: informa el ancho de papel");
    check(
      [...ticket].every((b) => b < 0x80),
      "escpos: payload ASCII puro (code page por defecto seguro)",
    );
    check(ticket.includes(Buffer.from([0x1b, 0x64, 0x04])), "escpos: avance final ESC d 4");
    check(
      ticket.includes(Buffer.from(`-${"".repeat(47)}`, "ascii")),
      "escpos: separador de 48 columnas para 80 mm (llena el rollo)",
    );
    const ticket58 = escpos.buildEscPosTestTicket({
      printerLabel: "POS-58",
      paperWidthMm: 58,
    });
    check(
      ticket58.includes(Buffer.from(`-${"".repeat(31)}`, "ascii")),
      "escpos: separador de 32 columnas para 58 mm",
    );
    const wideName = escpos.buildEscPosTestTicket({
      printerLabel: "Impresora con nombre larguísimo que no cabe en una línea del ticket",
      paperWidthMm: 58,
    });
    check(wideName.includes(Buffer.from("Impresora: ", "ascii")), "escpos: etiqueta de impresora presente aunque sea larga");
    const script = escpos.buildRawWorkerScript();
    check(script.includes("WritePrinter"), "raw: worker usa winspool WritePrinter");
    check(script.includes('pDatatype = "RAW"'), "raw: datatype RAW (sin driver de render)");
    check(script.includes("GetLastWin32Error"), "raw: worker reporta código Win32 en errores");
    check(script.includes("READY") && script.includes("ReadLine"), "raw: worker persistente por stdin");
    const cmd = escpos.buildRawCommand("Impresión ñ", "Doc", Buffer.from([0x1b, 0x40]));
    const parts = cmd.trim().split(" ");
    check(parts.length === 4 && parts[0] === "RAW", "raw: comando de 4 campos");
    check(Buffer.from(parts[1], "base64").toString("utf8") === "Impresión ñ", "raw: nombre con tildes viaja en base64 UTF-8");
    check(Buffer.from(parts[3], "base64").equals(Buffer.from([0x1b, 0x40])), "raw: payload intacto en base64");
    check(escpos.CASH_DRAWER_PULSE.equals(Buffer.from([0x1b, 0x70, 0x00, 0x32, 0x00])), "raw: pulso del cajón ESC p");
  }

  // ── 10. Modo ESC/POS raster (src/main/escpos-raster.js) ──────────────────
  const raster = require(path.join(REPO, "src", "main", "escpos-raster.js"));
  {
    const mode = (name, extra = {}) =>
      raster.resolveEffectiveMode("auto", { name, ...extra }).mode;
    check(mode("POS-80") === "escpos", "auto: POS-80 → escpos");
    check(mode("POS58 Printer") === "escpos", "auto: POS58 → escpos");
    check(mode("XP-58") === "escpos", "auto: XP-58 → escpos");
    check(mode("EPSON TM-T20II Receipt") === "escpos", "auto: EPSON TM-T20 → escpos");
    check(mode("Caja 1", { options: { system_driverinfo: "Generic / Text Only;6.1;" } }) === "escpos", "auto: driver Generic / Text Only → escpos");
    check(mode("Caja 1", { options: { system_driverinfo: "POS-80C;3.0" } }) === "escpos", "auto: driver POS-80C con nombre libre → escpos");
    check(mode("HP LaserJet Pro M404") === "driver", "auto: HP LaserJet → driver");
    check(mode("Microsoft Print to PDF") === "driver", "auto: Print to PDF → driver");
    check(mode("Microsoft XPS Document Writer") === "driver", "auto: XPS → driver");
    check(mode("EPSON L3150 Series") === "driver", "auto: Epson inyección → driver");
    check(raster.resolveEffectiveMode("driver", { name: "POS-80" }).mode === "driver", "modo explícito driver manda sobre la detección");
    check(raster.resolveEffectiveMode("escpos", { name: "HP" }).mode === "escpos", "modo explícito escpos manda sobre la detección");
    check(raster.normalizePrintMode("x") === "auto", "modo inválido → auto");
    check(raster.resolveDotsWidth(80) === 576 && raster.resolveDotsWidth(58) === 384 && raster.resolveDotsWidth(48) === 304, "puntos por rollo 80/58/48");
    check(raster.resolveDotsWidth(80, "512") === 512, "override de puntos válido");
    check(raster.resolveDotsWidth(80, "513") === 576, "override de puntos inválido se ignora");
  }
  {
    // 10 px de ancho × 2 filas: fila 0 negra, fila 1 blanca.
    const w = 10, h = 2;
    const bgra = Buffer.alloc(w * h * 4, 0xff);
    for (let x = 0; x < w; x++) bgra.fill(0, x * 4, x * 4 + 3);
    const mono = raster.toMonochrome(bgra, w, h);
    check(mono.bytesPerRow === 2, "mono: bytes por fila = ceil(w/8)");
    check(mono.bits[0] === 0xff && mono.bits[1] === 0xc0, "mono: fila negra empaquetada MSB primero");
    check(mono.bits[2] === 0 && mono.bits[3] === 0, "mono: fila blanca en cero");
    const transparent = raster.toMonochrome(Buffer.alloc(8 * 4, 0), 8, 1);
    check(transparent.bits[0] === 0, "mono: transparente = papel blanco");
    const trimmed = raster.trimTrailingBlankRows(mono);
    check(trimmed.height === 1, "mono: recorta filas en blanco al final");
  }
  {
    const h = 600;
    const mono = { bits: Buffer.alloc(72 * h, 0xaa), bytesPerRow: 72, width: 576, height: h };
    const job = raster.encodeRaster(mono);
    check(job.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])), "raster: abre con ESC @");
    const bands = [];
    for (let i = 0; i < job.length - 3; i++) {
      if (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30 && job[i + 3] === 0) {
        bands.push({ xL: job[i + 4], xH: job[i + 5], rows: job[i + 6] | (job[i + 7] << 8) });
        i += 7 + job[i + 4] * (job[i + 6] | (job[i + 7] << 8));
      }
    }
    check(bands.length === 3, "raster: 600 filas → 3 bandas GS v 0", JSON.stringify(bands));
    check(bands.every((b) => b.rows <= 255), "raster: bandas de máximo 255 filas");
    check(bands.reduce((a, b) => a + b.rows, 0) === h, "raster: suma de filas = alto");
    check(bands[0].xL === 72 && bands[0].xH === 0, "raster: ancho en bytes 72 (576 puntos)");
    check(job.subarray(job.length - 4).equals(Buffer.from([0x1d, 0x56, 0x42, 0x00])), "raster: termina con corte");
    const noCut = raster.encodeRaster(mono, { cut: false });
    check(!noCut.subarray(noCut.length - 4).equals(Buffer.from([0x1d, 0x56, 0x42, 0x00])), "raster: sin corte si se desactiva");
  }

  // 10b. Motor en modo ESC/POS: captura por franjas → sendRaw, sin print().
  const makeRasterWindow = (heightCssPx) => {
    const state = { destroyed: false, printCalls: [], captures: [], zoom: 1 };
    const bodyWidth = 264;
    return {
      state,
      loadURL: async () => {},
      isDestroyed: () => state.destroyed,
      destroy: () => { state.destroyed = true; },
      setContentSize: (w, hh) => { state.size = [w, hh]; },
      webContents: {
        insertCSS: async () => {},
        setZoomFactor: (z) => { state.zoom = z; },
        executeJavaScript: async (code) => {
          if (code.includes("getBoundingClientRect().width")) return bodyWidth;
          if (code.includes("scrollTo")) {
            const y = Number(/scrollTo\(0, ([\d.]+)\)/.exec(code)[1]);
            return Math.min(y, heightCssPx - state.size[1] / state.zoom);
          }
          if (code.includes("innerWidth")) return bodyWidth;
          return { hasContent: true, heightCssPx };
        },
        capturePage: async (rect) => {
          state.captures.push(rect);
          const bitmap = Buffer.alloc(rect.width * rect.height * 4, Buffer.from([0, 0, 0, 255]));
          return {
            isEmpty: () => false,
            getSize: () => ({ width: rect.width, height: rect.height }),
            toBitmap: () => bitmap,
            toPNG: () => Buffer.from("png"),
          };
        },
        print: (options, cb) => { state.printCalls.push(options); cb(true, ""); },
      },
    };
  };
  {
    const win = makeRasterWindow(500);
    const sentJobs = [];
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-80", paperWidthMm: 80, printMode: "auto" }),
      listSystemPrinters: async () => [{ name: "POS-80", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      sendRaw: async (printer, payload) => { sentJobs.push({ printer, payload }); return { ok: true, bytes: payload.length }; },
      nativeImage: {},
      log: () => {},
    });
    const res = await engine.printReceipt("<html><body>ticket</body></html>");
    check(res.success === true && res.mode === "escpos" && res.detected === true, "motor escpos: auto detecta POS-80", JSON.stringify(res));
    check(sentJobs.length === 1 && sentJobs[0].printer === "POS-80", "motor escpos: un trabajo RAW a la impresora");
    check(win.state.printCalls.length === 0, "motor escpos: no usa webContents.print (driver)");
    const totalDip = Math.ceil(500 * (576 / 264));
    check(win.state.captures.length === Math.ceil(totalDip / 600), "motor escpos: captura por franjas", JSON.stringify(win.state.captures));
    check(win.state.captures.every((c) => c.width === 576), "motor escpos: franjas de 576 puntos");
    const job = sentJobs[0].payload;
    check(job.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00, 72, 0])), "motor escpos: payload raster de 72 bytes por fila");
    check(win.state.destroyed, "motor escpos: la ventana se destruye al terminar");
  }
  {
    const win = makeRasterWindow(300);
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-58", paperWidthMm: 58, printMode: "escpos" }),
      listSystemPrinters: async () => [{ name: "POS-58", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      sendRaw: async () => ({ ok: false, error: "OpenPrinter Win32=1801" }),
      nativeImage: {},
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>");
    check(res.success === false && res.code === "ESCPOS_RAW_ERROR" && /Win32=1801/.test(res.error), "motor escpos: error RAW explícito (sin caída silenciosa)", JSON.stringify(res));
    check(win.state.printCalls.length === 0, "motor escpos: error RAW no reintenta por driver");
  }
  {
    const win = makeWindow();
    const engine = printing.createPrintEngine({
      getPrinterConfig: () => ({ printerName: "POS-80", paperWidthMm: 80, printMode: "auto" }),
      listSystemPrinters: async () => [{ name: "POS-80", isDefault: true }],
      createPrintWindow: () => win,
      getTempPath: () => os.tmpdir(),
      sendRaw: async () => { throw new Error("no debe usar RAW"); },
      log: () => {},
    });
    const res = await engine.printReceipt("<html></html>", { paperWidthMm: 80, printMode: "driver" });
    check(res.success === true && res.mode === "driver" && win.state.printCalls.length === 1, "motor: override de modo driver desde la prueba", JSON.stringify(res));
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("check-print revienta:", e);
  process.exit(1);
});
