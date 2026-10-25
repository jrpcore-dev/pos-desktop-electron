// ─── BÁSCULA (driver serial general) ────────────────────────────────────
// Reemplaza el esquema anterior (un PowerShell nuevo por lectura). El puerto
// se abre UNA vez con `serialport` y queda abierto: cada lectura cuesta
// milisegundos en vez de arrancar un proceso.
//
// Es general por dos ejes independientes:
//   · protocolo: qué comando pide el peso (P, W, ENQ, SICS) o si la báscula
//     transmite sola (continuo). "auto" prueba cada uno hasta obtener peso.
//   · formato de trama: 8N1 / 7E1 / 7O1 (las Toledo suelen ser 7E1).
// El parser entiende las tramas comunes (`  1.234kg`, `ST,GS,+  1.234kg`,
// `S S     1.234 kg`, `\x02 01.234\r`), convierte g/lb/oz a kg y detecta
// estabilidad y sobrecarga. Si la báscula no reporta estabilidad, se calcula
// por software (mismo peso en lecturas consecutivas).
const { EventEmitter } = require("events");

const PROFILES = {
  torrey: { label: "Torrey / Rhino (P)", command: "P" },
  w: { label: "Toledo 8213 / CAS (W)", command: "W" },
  enq: { label: "CAS ER / Avery (ENQ)", command: "\x05" },
  sics: { label: "Mettler Toledo SICS (SI)", command: "SI\r\n" },
  continuous: { label: "Transmisión continua", command: null },
};
// Orden en que "auto" prueba: continuo primero (sólo escucha, no envía nada).
const AUTO_ORDER = ["continuous", "torrey", "w", "enq", "sics"];

const FORMATS = {
  "8N1": { dataBits: 8, parity: "none", stopBits: 1 },
  "7E1": { dataBits: 7, parity: "even", stopBits: 1 },
  "7O1": { dataBits: 7, parity: "odd", stopBits: 1 },
};

const UNIT_TO_KG = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };
const STABLE_EPS_KG = 0.002;
const STABLE_SAMPLES = 3;

// Trama → { weight (kg), unit, stable (true|false|null), overload, raw }
// o null si no contiene un peso.
const parseFrame = (frame) => {
  const raw = String(frame || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  if (/(^|[^A-Z])(O-?L|OVER|OVERLOAD)([^A-Z]|$)/.test(upper) || /^[+-]?O-?L/.test(upper)) {
    return { weight: null, unit: null, stable: false, overload: true, raw };
  }

  let stable = null;
  if (/(^|[^A-Z])US([^A-Z]|$)/.test(upper) || /^S\s+D\b/.test(upper)) stable = false;
  else if (/(^|[^A-Z])ST([^A-Z]|$)/.test(upper) || /^S\s+S\b/.test(upper)) stable = true;

  const withUnit = raw.match(/([+-]?)\s*(\d+(?:[.,]\d+)?)\s*(kg|lb|oz|g)\b/i);
  let sign = "";
  let num = null;
  let unit = "kg";
  if (withUnit) {
    [, sign, num] = withUnit;
    unit = withUnit[3].toLowerCase();
  } else {
    const all = [...raw.matchAll(/([+-]?)\s*(\d+(?:[.,]\d+)?)/g)];
    if (!all.length) return null;
    // Sin unidad: el número con decimales es el peso; si no hay, el último.
    const pick = all.find((m) => /[.,]/.test(m[2])) || all[all.length - 1];
    [, sign, num] = pick;
  }
  const value = parseFloat(num.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const kg = (sign === "-" ? -value : value) * UNIT_TO_KG[unit];
  return {
    weight: Math.round(kg * 1000) / 1000,
    unit,
    stable,
    overload: false,
    raw,
  };
};

const normalizeConfig = (cfg = {}) => {
  const c = typeof cfg === "number" ? { baudRate: cfg } : cfg || {};
  const baudRate = parseInt(c.baudRate, 10) || 9600;
  const profile = PROFILES[c.profile] ? c.profile : "auto";
  const format = FORMATS[c.format] ? c.format : "8N1";
  return { baudRate, profile, format };
};

const isValidPortPath = (p) =>
  typeof p === "string" && /^(COM\d{1,3}|\/dev\/[\w.-]+)$/i.test(p);

class ScaleDriver extends EventEmitter {
  // `openPort(options)` → objeto tipo SerialPort ya abierto. Inyectable para
  // pruebas; por defecto usa `serialport`.
  constructor({ openPort, log = () => {} } = {}) {
    super();
    this.openPortImpl = openPort || defaultOpenPort;
    this.log = log;
    this.port = null;
    this.path = "";
    this.config = normalizeConfig();
    this.profile = null; // perfil efectivo (resuelto si era "auto")
    this.buffer = "";
    this.waiters = [];
    this.pollTimer = null;
    this.history = [];
    this.last = null;
  }

  get isOpen() {
    return !!this.port;
  }

  async open(path, cfg) {
    if (!isValidPortPath(path)) throw new Error(`Puerto inválido: ${path}`);
    await this.close();
    const config = normalizeConfig(cfg);
    const port = await this.openPortImpl({
      path,
      baudRate: config.baudRate,
      ...FORMATS[config.format],
    });
    this.port = port;
    this.path = path;
    this.config = config;
    this.profile = config.profile === "auto" ? null : config.profile;
    this.buffer = "";
    this.history = [];
    this.last = null;
    port.on("data", (chunk) => this.onData(chunk));
    port.on("error", (err) => this.emit("error", err));
    port.on("close", () => {
      if (this.port !== port) return;
      this.cleanup();
      this.emit("close");
    });
    return this;
  }

  onData(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString("latin1") : String(chunk);
    // Sólo se procesan tramas COMPLETAS (CR, LF o ETX); lo demás espera.
    const parts = this.buffer.split(/[\r\n\x03]/);
    this.buffer = parts.pop().slice(-256);
    for (const part of parts) {
      const reading = parseFrame(part);
      if (reading) this.onReading(reading);
    }
  }

  onReading(reading) {
    if (reading.weight != null) {
      this.history.push(reading.weight);
      if (this.history.length > STABLE_SAMPLES) this.history.shift();
    }
    const softStable =
      this.history.length >= STABLE_SAMPLES &&
      Math.max(...this.history) - Math.min(...this.history) <= STABLE_EPS_KG;
    const out = {
      ...reading,
      stable: reading.overload ? false : reading.stable ?? softStable,
    };
    this.last = out;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w(out);
    this.emit("reading", out);
  }

  nextReading(timeoutMs) {
    return new Promise((resolve) => {
      const done = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(done);
    });
  }

  send(profile) {
    const cmd = PROFILES[profile]?.command;
    if (cmd && this.port) this.port.write(cmd);
  }

  // Una lectura. Si el perfil es "auto" y aún no se detecta, prueba cada
  // protocolo y se queda con el primero que responda un peso.
  async read(timeoutMs = 1200) {
    if (!this.port) throw new Error("Báscula no conectada");
    if (!this.profile) return this.detect();
    const pending = this.nextReading(timeoutMs);
    this.send(this.profile);
    return pending;
  }

  async detect() {
    for (const profile of AUTO_ORDER) {
      if (!this.port) return null;
      this.buffer = "";
      const pending = this.nextReading(profile === "continuous" ? 700 : 500);
      this.send(profile);
      const r = await pending;
      if (r) {
        this.profile = profile;
        this.log(`protocolo detectado: ${profile}`);
        return r;
      }
    }
    return null;
  }

  // Lecturas continuas para la caja. Con protocolo por comando se envía la
  // siguiente petición sólo al recibir respuesta (o tras un timeout): nunca
  // se satura la báscula.
  startStream(intervalMs = 200) {
    this.stopStream();
    const tick = async () => {
      if (!this.port) return;
      const r =
        this.profile === "continuous"
          ? await this.nextReading(1000)
          : await this.read(800).catch(() => null);
      if (!this.pollTimer) return;
      if (!r) this.emit("timeout");
      this.pollTimer = setTimeout(tick, this.profile === "continuous" ? 0 : intervalMs);
    };
    this.pollTimer = setTimeout(tick, 0);
  }

  stopStream() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  cleanup() {
    this.stopStream();
    this.port = null;
    this.buffer = "";
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w(null);
  }

  async close() {
    const port = this.port;
    this.cleanup();
    if (port && port.isOpen !== false) {
      await new Promise((resolve) => port.close(() => resolve()));
    }
  }
}

function defaultOpenPort(options) {
  const { SerialPort } = require("serialport");
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ ...options, autoOpen: false });
    port.open((err) => (err ? reject(err) : resolve(port)));
  });
}

const listPorts = async () => {
  const { SerialPort } = require("serialport");
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || "",
    friendlyName: p.friendlyName || p.path,
  }));
};

module.exports = {
  PROFILES,
  FORMATS,
  AUTO_ORDER,
  parseFrame,
  normalizeConfig,
  isValidPortPath,
  ScaleDriver,
  listPorts,
};
