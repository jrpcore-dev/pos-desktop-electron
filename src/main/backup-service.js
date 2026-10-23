"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Bloque 6 · respaldos: creación, recepción en una caja designada y retención.
//
// Reglas del plan:
//   · Host: cada 15 min, al cerrar caja y diario.
//   · Retención: 24 copias "horarias" (auto) + 8 semanales.
//   · Una caja designada recibe la copia (scope backup:receive) y la guarda
//     VERIFICADA (integrity_check) con checksum SHA-256.
//   · Copia adicional en una carpeta externa configurable (sin cifrar).
//   · El respaldo debe traer las tablas de identidad para poder promover una
//     caja a Host sin perder el código de activación ni los emparejamientos.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const HOURLY_KEEP = 24;
const WEEKLY_KEEP = 8;
// Fase 3 · las copias al cerrar caja no tenían retención y crecían sin fin.
// 60 cubre unos dos meses de cortes con dos turnos al día.
const CLOSE_KEEP = 60;
const IDENTITY_TABLES = Object.freeze([
  "settings",
  "cashiers",
  "cash_register",
  "paired_devices",
  "products",
  "sales",
]);

const isAutoBackup = (name) => /^pos-auto-.*\.db$/.test(name);
const isWeeklyBackup = (name) => /^pos-weekly-.*\.db$/.test(name);
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

const pruneDir = (dir, match, keep) => {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => match(f))
      .map((f) => {
        const fp = path.join(dir, f);
        return { f, mtime: fs.statSync(fp).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    files.slice(keep).forEach((x) => {
      try {
        fs.unlinkSync(path.join(dir, x.f));
        const side = path.join(dir, `${x.f}.sha256.json`);
        if (fs.existsSync(side)) fs.unlinkSync(side);
      } catch (err) {}
    });
  } catch (err) {}
};

// Retención 24 auto + 8 semanales + 60 de cierre. No toca las copias
// manuales ni las de seguridad (pre-restore / pre-promotion).
const applyRetention = (dir) => {
  pruneDir(dir, isAutoBackup, HOURLY_KEEP);
  pruneDir(dir, isWeeklyBackup, WEEKLY_KEEP);
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
  verifyDbFile,
  applyRetention,
  copyExternal,
  receiveBackup,
  latestBackup,
  safeBackupName,
  restoreIntoLiveDb,
};
