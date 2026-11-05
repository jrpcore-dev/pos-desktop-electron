"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Bloque 6 · respaldos: creación, recepción en una caja designada y retención.
//
// Reglas del plan:
//   · Host: cada hora (cada 20 min con cajas conectadas) si hubo cambios, al
//     cerrar caja y diario.
//   · Retención: 24 automáticas de 2 días como máximo + 8 diarias + 8 semanales.
//   · Una caja designada recibe la copia (scope backup:receive) y la guarda
//     VERIFICADA (integrity_check) con checksum SHA-256.
//   · Copia adicional en una carpeta externa configurable (sin cifrar).
//   · El respaldo debe traer las tablas de identidad para poder promover una
//     caja a Host sin perder el código de activación ni los emparejamientos.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { CHANGE_LOG_TABLE } = require("./db-schema");

const HOURLY_KEEP = 24;
const WEEKLY_KEEP = 8;
const SEMANAL_KEEP = 8;
// Fase 3 · las copias al cerrar caja no tenían retención y crecían sin fin.
// 60 cubre unos dos meses de cortes con dos turnos al día.
const CLOSE_KEEP = 60;
const AUTO_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const AUTO_EVERY_MS_SINGLE = 60 * 60 * 1000;
const AUTO_EVERY_MS_MULTI = 20 * 60 * 1000;
const IDENTITY_TABLES = Object.freeze([
  "settings",
  "cashiers",
  "cash_register",
  "paired_devices",
  "products",
  "sales",
]);

// Datos del negocio que `change_log` no registra: se comparan completos.
const UNLOGGED_TABLES = Object.freeze([
  "product_lots",
  "service_transactions",
  "stock_conflict_resolutions",
  "tasks",
]);

// Cachés que se refrescan solas y llevan su hora: con ellas la huella cambiaría
// siempre, aunque no se haya vendido nada.
const VOLATILE_SETTINGS = Object.freeze([
  "taecel_balance_json",
  "taecel_catalog_at",
  "taecel_catalog_json",
]);

const isAutoBackup = (name) => /^pos-auto-.*\.db$/.test(name);
// `pos-weekly-` son las copias DIARIAS: el nombre viene de cuando eran semanales
// y se conserva por los archivos que ya existen.
const isWeeklyBackup = (name) => /^pos-weekly-.*\.db$/.test(name);
const isSemanalBackup = (name) => /^pos-semanal-.*\.db$/.test(name);
const isCloseBackup = (name) => /^pos-close-.*\.db$/.test(name);

const sha256File = (filePath) => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
};

const sha256Buffer = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const safeBackupName = (name) => {
  const base = path.basename(String(name || ""));
  if (!/^[A-Za-z0-9._-]+\.db$/.test(base)) return null;
  return base;
};

// Huella de los datos: si no cambió, una copia nueva sería igual a la anterior.
// `sqlite_sequence` y no MAX(seq): la compactación de change_log no la mueve.
// Devuelve null si no se pudo calcular, y quien la usa debe respaldar igual.
const dataFingerprint = (db) => {
  try {
    const hash = crypto.createHash("sha256");
    const log = db
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
      .get(CHANGE_LOG_TABLE);
    hash.update(`seq:${log ? log.seq : 0}\n`);
    const settings = db
      .prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'backup%' ORDER BY key")
      .all()
      .filter((row) => !VOLATILE_SETTINGS.includes(row.key));
    hash.update(JSON.stringify(settings));
    for (const table of UNLOGGED_TABLES) {
      hash.update(`\n${table}:`);
      for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()) {
        hash.update(JSON.stringify(row));
      }
    }
    return hash.digest("hex");
  } catch (error) {
    return null;
  }
};

// Con cajas conectadas el Host guarda los datos de todas, y perderlo cuesta más.
const autoBackupIntervalMs = (db) => {
  const { boxes } = db
    .prepare(
      "SELECT COUNT(*) AS boxes FROM paired_devices WHERE device_type = 'desktop_box' AND COALESCE(revoked, 0) = 0",
    )
    .get();
  return boxes > 0 ? AUTO_EVERY_MS_MULTI : AUTO_EVERY_MS_SINGLE;
};

// Valida que el archivo sea una BD SQLite sana y que traiga las tablas de
// identidad. Devuelve {ok, error, tables, integrity}.
const verifyDbFile = (filePath, { requireIdentity = true } = {}) => {
  let db = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      return { ok: false, error: `integrity_check: ${integrity}`, integrity };
    }
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    if (requireIdentity) {
      const have = new Set(tables);
      const missing = IDENTITY_TABLES.filter((t) => !have.has(t));
      if (missing.length) {
        return {
          ok: false,
          integrity,
          error: `faltan tablas de identidad: ${missing.join(", ")}`,
        };
      }
    }
    return { ok: true, integrity, tables };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (db) {
      try {
        db.close();
      } catch (err) {}
    }
  }
};

// La copia más reciente nunca se borra por vieja: tras días sin abrir la app
// puede ser la única de ese tipo.
const pruneDir = (dir, match, keep, maxAgeMs = Infinity) => {
  try {
    const now = Date.now();
    const files = fs
      .readdirSync(dir)
      .filter((f) => match(f))
      .map((f) => {
        const fp = path.join(dir, f);
        return { f, mtime: fs.statSync(fp).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const doomed = files.filter(
      (x, i) => i >= keep || (i > 0 && now - x.mtime > maxAgeMs),
    );
    doomed.forEach((x) => {
      try {
        fs.unlinkSync(path.join(dir, x.f));
        const side = path.join(dir, `${x.f}.sha256.json`);
        if (fs.existsSync(side)) fs.unlinkSync(side);
      } catch (err) {}
    });
  } catch (err) {}
};

const mondayOf = (isoDate) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

// La diaria que ya no cabe pasa a ser la semanal de su semana. Se recorren de
// la más vieja a la más nueva, así queda la última copia de cada semana.
const promoteToSemanal = (dir) => {
  try {
    fs.readdirSync(dir)
      .filter((f) => isWeeklyBackup(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(WEEKLY_KEEP)
      .reverse()
      .forEach(({ f }) => {
        const day = /^pos-weekly-(\d{4}-\d{2}-\d{2})/.exec(f);
        if (!day) return;
        const target = `pos-semanal-${mondayOf(day[1])}.db`;
        fs.renameSync(path.join(dir, f), path.join(dir, target));
        const side = path.join(dir, `${f}.sha256.json`);
        if (fs.existsSync(side)) {
          fs.renameSync(side, path.join(dir, `${target}.sha256.json`));
        }
      });
  } catch (err) {}
};

// Retención: 24 auto (máximo 2 días), 8 diarias, 8 semanales y 60 de cierre. No
// toca las copias manuales ni las de seguridad (pre-restore / pre-promotion).
const applyRetention = (dir) => {
  pruneDir(dir, isAutoBackup, HOURLY_KEEP, AUTO_MAX_AGE_MS);
  promoteToSemanal(dir);
  pruneDir(dir, isWeeklyBackup, WEEKLY_KEEP);
  pruneDir(dir, isSemanalBackup, SEMANAL_KEEP);
  pruneDir(dir, isCloseBackup, CLOSE_KEEP);
};

const copyExternal = (filePath, externalDir) => {
  const dir = String(externalDir || "").trim();
  if (!dir) return { copied: false };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    // Fase 3 · la carpeta externa sigue la misma retención y la copia se
    // comprueba: un USB lleno o dañado no debe pasar por respaldo válido.
    if (sha256File(dest) !== sha256File(filePath)) {
      return { copied: false, error: "La copia externa no coincide con el original" };
    }
    applyRetention(dir);
    return { copied: true, path: dest };
  } catch (error) {
    return { copied: false, error: error.message };
  }
};

const receiveBackup = ({ dir, externalDir, name, buffer, expectedSha256 }) => {
  const safe = safeBackupName(name);
  if (!safe) return { success: false, error: "Nombre de respaldo inválido" };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { success: false, error: "Respaldo vacío" };
  }
  // Fase 3 · extremo a extremo: lo que llegó es lo que el Host hasheó.
  if (expectedSha256 && sha256Buffer(buffer) !== String(expectedSha256).toLowerCase()) {
    return { success: false, code: "BACKUP_CHECKSUM_MISMATCH", error: "El respaldo llegó dañado (SHA-256 distinto al del Host)" };
  }
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, safe);
  const expected = sha256Buffer(buffer);
  if (fs.existsSync(finalPath) && sha256File(finalPath) === expected) {
    return { success: true, skipped: true, name: safe, sha256: expected };
  }
  const tmp = `${finalPath}.part-${process.pid}`;
  try {
    fs.writeFileSync(tmp, buffer);
    const check = verifyDbFile(tmp, { requireIdentity: true });
    if (!check.ok) {
      return { success: false, error: `Respaldo rechazado: ${check.error}` };
    }
    const actual = sha256File(tmp);
    fs.renameSync(tmp, finalPath);
    const meta = {
      name: safe,
      sha256: actual,
      size: buffer.length,
      receivedAt: new Date().toISOString(),
      integrity: check.integrity,
      verified: true,
    };
    fs.writeFileSync(`${finalPath}.sha256.json`, JSON.stringify(meta, null, 2));
    const external = copyExternal(finalPath, externalDir);
    applyRetention(dir);
    return {
      success: true,
      name: safe,
      sha256: actual,
      size: buffer.length,
      external,
    };
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (err) {}
    return { success: false, error: error.message };
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (err) {}
  }
};

// Última copia disponible en una carpeta (por fecha de modificación).
const latestBackup = (dir) => {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".db") && !f.endsWith(".part"))
      .map((f) => {
        const fp = path.join(dir, f);
        return { name: f, path: fp, mtime: fs.statSync(fp).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files[0] || null;
  } catch (err) {
    return null;
  }
};

// Restaura un respaldo DENTRO de una conexión viva. better-sqlite3 sólo sabe
// hacer `backup()` hacia una RUTA, así que no se puede usar para reemplazar
// una base ya abierta (y cerrarla rompería statements del resto de la app).
// Se adjunta el respaldo y se copian las tablas en una transacción.
const restoreIntoLiveDb = (db, backupPath) => {
  const check = verifyDbFile(backupPath, { requireIdentity: true });
  if (!check.ok) {
    throw new Error(`Respaldo no válido: ${check.error}`);
  }
  db.pragma("foreign_keys = OFF");
  let attached = false;
  try {
    db.prepare("ATTACH DATABASE ? AS backup_src").run(backupPath);
    attached = true;
    const backupTables = new Set(
      db
        .prepare(
          "SELECT name FROM backup_src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((r) => r.name),
    );
    const mainTables = db
      .prepare(
        "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);
    const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of mainTables) {
        if (!backupTables.has(table)) {
          // Tabla nueva que el respaldo no trae: se deja vacía, no con datos
          // de la instalación que se está reemplazando.
          db.prepare(`DELETE FROM main.${quote(table)}`).run();
          continue;
        }
        const mainCols = db
          .prepare(`PRAGMA main.table_info(${quote(table)})`)
          .all()
          .map((c) => c.name);
        const srcCols = new Set(
          db
            .prepare(`PRAGMA backup_src.table_info(${quote(table)})`)
            .all()
            .map((c) => c.name),
        );
        const cols = mainCols.filter((c) => srcCols.has(c));
        if (!cols.length) continue;
        const list = cols.map(quote).join(", ");
        db.prepare(`DELETE FROM main.${quote(table)}`).run();
        db.prepare(
          `INSERT INTO main.${quote(table)} (${list}) SELECT ${list} FROM backup_src.${quote(table)}`,
        ).run();
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch (err) {}
      throw error;
    }
  } finally {
    if (attached) {
      try {
        db.exec("DETACH DATABASE backup_src");
      } catch (err) {}
    }
    db.pragma("foreign_keys = ON");
  }
  return check;
};

module.exports = {
  HOURLY_KEEP,
  WEEKLY_KEEP,
  IDENTITY_TABLES,
  isAutoBackup,
  isWeeklyBackup,
  sha256File,
  sha256Buffer,
  dataFingerprint,
  autoBackupIntervalMs,
  verifyDbFile,
  applyRetention,
  copyExternal,
  receiveBackup,
  latestBackup,
  safeBackupName,
  restoreIntoLiveDb,
};
