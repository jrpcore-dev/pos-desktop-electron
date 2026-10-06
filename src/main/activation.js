const crypto = require("crypto");

// Código de activación por negocio: 16 caracteres sobre un alfabeto de 32
// símbolos que excluye caracteres ambiguos (0/O, 1/I/L/U), agrupados en
// 4 bloques de 4 separados por guiones para facilitar lectura y escritura
// en el celular. Generado una sola vez en el escritorio.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTVWXYZ23456789"; // 32 símbolos
const CODE_BLOCKS = 4;
const BLOCK_LEN = 4;
const CODE_LENGTH = CODE_BLOCKS * BLOCK_LEN;

// Ventana de migración: M se auto-emparejan en silencio con un PIN válido.
const GRACE_DAYS = 7;
const PAIR_MAX_ATTEMPTS = 5;
const PAIR_RATE_WINDOW_MS = 15 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

const generateCode = () => {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return raw.match(new RegExp(`.{${BLOCK_LEN}}`, "g")).join("-");
};

// Normaliza lo que teclea el empleado: mayúsculas, sin guiones ni espacios.
const normalizeCode = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

// Los tokens de emparejamiento se guardan hasheados (sha256): el valor crudo
// solo existe en el teléfono, nunca en disco.
const hashToken = (t) =>
  crypto.createHash("sha256").update(String(t)).digest("hex");

const timingSafe = (a, b) => {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const getSetting = (db, key) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
};

const setSetting = (db, key, value) => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    value,
  );
};

// SQLite CURRENT_TIMESTAMP guarda "YYYY-MM-DD HH:MM:SS" en UTC.
const parseSqliteDate = (s) =>
  s ? new Date(String(s).replace(" ", "T") + "Z").getTime() : 0;

const ensureSchema = (db) => {
  db.exec(`CREATE TABLE IF NOT EXISTS paired_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    device_name TEXT DEFAULT '',
    paired_token_hash TEXT NOT NULL,
    cashier_id INTEGER,
    activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME,
    revoked INTEGER DEFAULT 0
  )`);
  if (!getSetting(db, "activation_code")) {
    setSetting(db, "activation_code", generateCode());
  }
};

const getActivationCode = (db) => getSetting(db, "activation_code");

const isEnabled = (db) => getSetting(db, "activation_enabled") === "1";

const graceEndsAt = (db) => getSetting(db, "activation_grace_ends") || null;

const graceActive = (db) => {
  if (!isEnabled(db)) return false;
  const ends = graceEndsAt(db);
  if (!ends) return false;
  return Date.now() < new Date(ends).getTime();
};

const ensureGraceEnd = (db) => {
  if (getSetting(db, "activation_grace_ends")) return;
  setSetting(db, "activation_grace_ends", new Date(Date.now() + GRACE_DAYS * 86400000).toISOString());
};

// Helper de pruebas/operación: fija explícitamente el fin de la ventana de
// gracia (permite simular vencimiento o restaurar los 7 días sin esperar).
const setGraceEnd = (db, iso) => setSetting(db, "activation_grace_ends", iso);

// Prueba de emparejamiento: device_id + token firman cada petición.
const isPaired = (db, deviceId, token) => {
  if (!deviceId || !token) return false;
  const row = db
    .prepare("SELECT paired_token_hash, revoked, last_seen_at FROM paired_devices WHERE device_id = ?")
    .get(deviceId);
  if (!row || row.revoked) return false;
  if (!timingSafe(hashToken(token), row.paired_token_hash)) return false;
  if (Date.now() - parseSqliteDate(row.last_seen_at) > LAST_SEEN_THROTTLE_MS) {
    db.prepare("UPDATE paired_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = ?").run(deviceId);
  }
  return true;
};

const registerPairing = (db, { deviceId, deviceName, token, cashierId }) => {
  const name = String(deviceName || "Dispositivo móvil").slice(0, 80);
  db.prepare(`
    INSERT INTO paired_devices (device_id, device_name, paired_token_hash, cashier_id, activated_at, last_seen_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name = COALESCE(NULLIF(excluded.device_name, ''), paired_devices.device_name),
      paired_token_hash = excluded.paired_token_hash,
      cashier_id = COALESCE(excluded.cashier_id, paired_devices.cashier_id),
      revoked = 0,
      activated_at = CURRENT_TIMESTAMP,
      last_seen_at = CURRENT_TIMESTAMP
  `).run(deviceId, name, hashToken(token), cashierId || null);
};

// Auto-emparejamiento silencioso durante la ventana de gracia: se llama solo
// DESPUÉS de verificar un PIN correcto. Devuelve el token del dispositivo para
// que el teléfono lo guarde (cura también a teléfonos que perdieron su token y
// reactiva los revocados durante la gracia). Mientras dure la gracia, cada
// login con PIN correcto rota el token del dispositivo al último recibido.
const autoPairIfGrace = (db, deviceId, cashierId, cashierName) => {
  if (!graceActive(db) || !deviceId) return null;
  const token = crypto.randomBytes(32).toString("hex");
  registerPairing(db, {
    deviceId,
    deviceName: cashierName ? `App de ${cashierName}` : "Dispositivo móvil",
    token,
    cashierId,
  });
  return { status: "paired", pairedToken: token };
};

const listDevices = (db) =>
  db
    .prepare(`
      SELECT d.device_id, d.device_name, d.cashier_id, d.activated_at, d.last_seen_at, d.revoked,
             c.name AS cashier_name
      FROM paired_devices d
      LEFT JOIN cashiers c ON c.id = d.cashier_id
      ORDER BY d.activated_at DESC
    `)
    .all();

const revokeDevice = (db, deviceId) => {
  const info = db
    .prepare("UPDATE paired_devices SET revoked = 1 WHERE device_id = ?")
    .run(deviceId);
  return { success: info.changes > 0 };
};

const rotateCode = (db) => {
  const code = generateCode();
  setSetting(db, "activation_code", code);
  return code;
};

module.exports = {
  CODE_ALPHABET,
  GRACE_DAYS,
  PAIR_MAX_ATTEMPTS,
  PAIR_RATE_WINDOW_MS,
  ensureSchema,
  generateCode,
  normalizeCode,
  hashToken,
  timingSafe,
  getSetting,
  setSetting,
  getActivationCode,
  isEnabled,
  graceEndsAt,
  graceActive,
  ensureGraceEnd,
  setGraceEnd,
  isPaired,
  registerPairing,
  autoPairIfGrace,
  listDevices,
  revokeDevice,
  rotateCode,
};