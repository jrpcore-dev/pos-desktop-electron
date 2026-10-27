// Genera `catalog-images/` (fotos del catálogo precargado) a partir de la
// lista aprobada { "<código>": "<ruta relativa de la foto original>" }.
// Cada foto distinta se guarda una vez como WebP pequeño; `index.json` liga
// cada código de barras con su archivo. La carpeta va al instalador como
// extraResource, junto a `bd sku.xlsx`.
//
// Uso: node scripts/build-catalog-images.mjs <aprobadas.json> <carpeta-base-fotos>
import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "catalog-images");
const MAX_SIDE = 200;
const QUALITY = 72;

const [approvedPath, baseDir] = process.argv.slice(2);
if (!approvedPath || !baseDir) {
  console.error("Uso: node scripts/build-catalog-images.mjs <aprobadas.json> <carpeta-base-fotos>");
  process.exit(1);
}

const approved = JSON.parse(fs.readFileSync(approvedPath, "utf8"));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const byFile = new Map(); // ruta original → nombre webp
const index = {};
let bytes = 0;
let failed = 0;

for (const [barcode, rel] of Object.entries(approved)) {
  if (!byFile.has(rel)) {
    const name = crypto.createHash("sha1").update(rel).digest("hex").slice(0, 12) + ".webp";
    try {
      const info = await sharp(path.join(baseDir, rel))
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .webp({ quality: QUALITY })
        .toFile(path.join(OUT, name));
      bytes += info.size;
      byFile.set(rel, name);
    } catch (err) {
      console.warn(`  no se pudo convertir ${rel}: ${err.message}`);
      byFile.set(rel, null);
      failed++;
    }
  }
  const name = byFile.get(rel);
  if (name) index[barcode] = name;
}

fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
const files = [...byFile.values()].filter(Boolean).length;
console.log(
  `[catalog-images] ${Object.keys(index).length} productos · ${files} fotos · ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB · ${failed} fallidas`,
);
