"use strict";
// ─── ENVÍO ESC/POS (RAW) ──────────────────────────────────────────────────────
// 1) Worker RAW persistente (winspool WritePrinter, datatype RAW): lo usan el
//    ticket en modo ESC/POS (imagen raster, ver escpos-raster.js), la prueba
//    ESC/POS de Configuración y el cajón de dinero. Se salta por completo el
//    driver de render (Unidrv), que es justo lo que falla con drivers
//    genéricos tipo "POS-80" (el papel avanza pero sale en blanco).
// 2) Ticket de prueba en texto ESC/POS: discriminador de diagnóstico.
//    * imprime  → la impresora acepta ESC/POS: usar modo "ESC/POS directo".
//    * no sale  → la impresora no interpreta ESC/POS (usar modo driver).
// Sin dependencias nuevas: powershell.exe + Add-Type. El payload de la prueba
// es ASCII puro: el code page por defecto varía, así que se evitan tildes/ñ
// (el ticket real va como imagen, por eso ahí no hay ese problema).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ESCPOS_SEND_TIMEOUT_MS = 15000;

// Líneas del ticket de prueba. `printerLabel` llega del sistema (nombre del
// spooler) y puede contener espacios; se trunca para no desbordar el ancho.
function buildEscPosTestTicket({ printerLabel, paperWidthMm }) {
  const chunks = [];
  const push = (...bytes) => chunks.push(Buffer.from(bytes));
  const text = (value) => chunks.push(Buffer.from(String(value), "ascii"));

  // Columnas seguras para llenar el ancho del rollo con la fuente A (12 puntos
  // de ancho): 80 mm ≈ 53 columnas a 203 dpi, 58 mm ≈ 38, 48 mm ≈ 32. Se usa
  // el valor prudente por debajo para que el separador NO envuelva en
  // impresoras de 180 dpi (menos puntos por ancho).
  const columns = paperWidthMm >= 80 ? 48 : paperWidthMm >= 58 ? 32 : 24;
  const line = "-".repeat(columns);
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");

  push(0x1b, 0x40); // ESC @ — inicializar
  push(0x1b, 0x61, 0x01); // ESC a 1 — centrado
  push(0x1b, 0x45, 0x01); // ESC E 1 — negrita
  push(0x1d, 0x21, 0x11); // GS ! 0x11 — doble ancho y alto
  text("VENDIA");
  push(0x0a);
  push(0x1d, 0x21, 0x00); // GS ! 0 — tamaño normal
  push(0x1b, 0x45, 0x00); // ESC E 0 — negrita off
  text("PRUEBA ESC/POS (RAW)");
  push(0x0a, 0x0a);
  push(0x1b, 0x61, 0x00); // ESC a 0 — izquierda
  text(line);
  push(0x0a);
  text(`Impresora: ${printerLabel}`.slice(0, 40));
  push(0x0a);
  text(`Papel: ${paperWidthMm} mm`);
  push(0x0a);
  text(`Fecha: ${stamp}`);
  push(0x0a);
  text(line);
  push(0x0a, 0x0a);
  text("Si lee este ticket, la impresora");
  push(0x0a);
  text("acepta ESC/POS por el spooler.");
  push(0x0a, 0x0a);
  push(0x1b, 0x64, 0x04); // ESC d 4 — avance de 4 líneas
  push(0x1d, 0x56, 0x42, 0x00); // GS V B 0 — corte parcial

  return Buffer.concat(chunks);
}

// Script del worker RAW. Patrón canónico DOCINFO + StartDocPrinter +
// WritePrinter con charset Unicode; se valida cada retorno de winspool.
// Protocolo (una línea por trabajo, todo en base64 para no depender del code
// page de la consola con nombres con tildes/ñ):
//   RAW <impresora b64> <documento b64> <payload b64>  →  OK <bytes> | ERR <motivo>
function buildRawWorkerScript() {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VendiaRaw {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFO { public string pDocName; public string pOutputFile; public string pDatatype; }
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFO di);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
    static string Decode(string b64) { return Encoding.UTF8.GetString(Convert.FromBase64String(b64)); }
    public static string Handle(string line) {
        string[] parts = line.Split(' ');
        if (parts.Length != 4 || parts[0] != "RAW") return "ERR comando invalido";
        string printerName, docName; byte[] data;
        try { printerName = Decode(parts[1]); docName = Decode(parts[2]); data = Convert.FromBase64String(parts[3]); }
        catch { return "ERR base64 invalido"; }
        if (String.IsNullOrEmpty(printerName)) return "ERR nombre de impresora vacio";
        if (data.Length == 0) return "ERR payload vacio";
        IntPtr h;
        if (!OpenPrinter(printerName, out h, IntPtr.Zero)) return "ERR OpenPrinter Win32=" + Marshal.GetLastWin32Error();
        try {
            var di = new DOCINFO { pDocName = docName, pDatatype = "RAW" };
            if (!StartDocPrinter(h, 1, ref di)) return "ERR StartDocPrinter Win32=" + Marshal.GetLastWin32Error();
            try {
                StartPagePrinter(h);
                IntPtr p = Marshal.AllocHGlobal(data.Length);
                try {
                    Marshal.Copy(data, 0, p, data.Length);
                    int w;
                    if (!WritePrinter(h, p, data.Length, out w)) return "ERR WritePrinter Win32=" + Marshal.GetLastWin32Error();
                    if (w != data.Length) return "ERR WritePrinter escribio " + w + " de " + data.Length + " bytes";
                } finally { Marshal.FreeHGlobal(p); }
                EndPagePrinter(h);
            } finally { EndDocPrinter(h); }
            return "OK " + data.Length;
        } finally { ClosePrinter(h); }
    }
}
"@
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    try { $res = [VendiaRaw]::Handle($line.Trim()) } catch { $res = "ERR " + $_.Exception.Message }
    [Console]::Out.WriteLine($res)
    [Console]::Out.Flush()
}
`;
}

const RAW_WORKER_SCRIPT_NAME = "pos-raw-worker.ps1";
const RAW_WORKER_READY_TIMEOUT_MS = 15000;

const b64 = (value) => Buffer.from(String(value), "utf8").toString("base64");

// Línea de comando del protocolo (exportada para pruebas).
const buildRawCommand = (printerName, docName, payload) =>
  `RAW ${b64(printerName)} ${b64(docName || "Vendia")} ${Buffer.from(payload).toString("base64")}\n`;

// Worker persistente: un solo powershell.exe compila el Add-Type UNA vez y
// queda escuchando por stdin, así cada ticket no paga ~1-2 s de arranque.
// `send` serializa los trabajos (el spooler los recibe en orden) y nunca
// rechaza: resuelve { ok, bytes } | { ok:false, error }.
function createRawPrinterWorker({ getTempPath, spawnImpl = spawn, log = () => {} }) {
  let proc = null;
  let readyPromise = null;
  const waiters = [];
  let chain = Promise.resolve();

  const scriptPath = () => path.join(getTempPath(), RAW_WORKER_SCRIPT_NAME);
  const alive = () => proc && proc.exitCode === null && !proc.killed;
  const failAll = (error) => {
    waiters.splice(0).forEach((w) => w({ ok: false, error }));
  };

  function spawnWorker() {
    fs.writeFileSync(scriptPath(), buildRawWorkerScript(), "utf8");
    const child = spawnImpl(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath()],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    proc = child;
    let buffer = "";
    let onReady = () => {};
    const ready = new Promise((resolve) => {
      onReady = resolve;
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "").trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (line === "READY") {
          onReady(true);
        } else if (waiters.length > 0) {
          const waiter = waiters.shift();
          if (line.startsWith("OK")) {
            waiter({ ok: true, bytes: Number(line.slice(2).trim()) || 0 });
          } else if (line.startsWith("ERR")) {
            waiter({ ok: false, error: line.slice(3).trim() });
          } else {
            waiter({ ok: false, error: `Respuesta inesperada: ${line}` });
          }
        }
      }
    });
    child.stderr.on("data", (d) => log("[RAW stderr]", d.toString().trim()));
    const onGone = (message) => {
      if (proc !== child) return;
      proc = null;
      readyPromise = null;
      onReady(false);
      failAll(message);
    };
    child.on("error", (e) => onGone(`No se pudo ejecutar powershell: ${e.message}`));
    child.on("exit", () => onGone("El proceso de impresión RAW terminó inesperadamente"));
    return ready;
  }

  function ensure() {
    if (alive() && readyPromise) return readyPromise;
    readyPromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), RAW_WORKER_READY_TIMEOUT_MS);
      try {
        spawnWorker().then((ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
      } catch (error) {
        clearTimeout(timer);
        log("[RAW] No se pudo iniciar el worker:", error.message);
        resolve(false);
      }
    });
    return readyPromise;
  }

  function stop() {
    const child = proc;
    proc = null;
    readyPromise = null;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        /* ya cerrado */
      }
      try {
        child.kill();
      } catch {
        /* ya terminó */
      }
    }
    failAll("Proceso de impresión RAW detenido");
  }

  async function sendNow(printerName, payload, { docName, timeoutMs }) {
    const ready = await ensure();
    if (!ready || !alive()) {
      return { ok: false, error: "No se pudo iniciar el proceso de impresión RAW" };
    }
    return new Promise((resolve) => {
      const waiter = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        // Ya no se puede emparejar la respuesta: reiniciar el worker.
        stop();
        resolve({ ok: false, error: `TIMEOUT: sin respuesta del spooler en ${timeoutMs} ms` });
      }, timeoutMs);
      waiters.push(waiter);
      try {
        proc.stdin.write(buildRawCommand(printerName, docName, payload));
      } catch (error) {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        waiter({ ok: false, error: error.message });
      }
    });
  }

  function send(printerName, payload, { docName = "Vendia", timeoutMs = ESCPOS_SEND_TIMEOUT_MS } = {}) {
    const task = chain.then(() => sendNow(printerName, payload, { docName, timeoutMs }));
    chain = task.catch(() => {});
    return task;
  }

  function destroy() {
    stop();
    try {
      fs.unlinkSync(scriptPath());
    } catch {
      /* no existía */
    }
  }

  return { ensure, send, destroy };
}

// Pulso de apertura del cajón conectado a la impresora (ESC p 0 25 250 ms).
const CASH_DRAWER_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x32, 0x00]);

module.exports = {
  ESCPOS_SEND_TIMEOUT_MS,
  CASH_DRAWER_PULSE,
  buildEscPosTestTicket,
  buildRawWorkerScript,
  buildRawCommand,
  createRawPrinterWorker,
};
