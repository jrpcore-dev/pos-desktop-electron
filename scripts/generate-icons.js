const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src/renderer/assets");
const OUT = path.join(ROOT, "build");

// Tamaños para el icono de app / favicon
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

async function svgToPng(svgFile, outFile, size) {
  await sharp(svgFile)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outFile);
  console.log(`✅ ${outFile}  (${size}x${size})`);
}

// ---------- ICO writer (PNG-embedded, válido en Windows Vista+) ----------
function writeIco(pngBuffers, outFile) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (ICO)
  header.writeUInt16LE(count, 4); // image count

  const entrySize = 16;
  const dirStart = 6;
  const dataStart = dirStart + count * entrySize;

  const dirs = Buffer.alloc(count * entrySize);
  let offset = dataStart;

  pngBuffers.forEach((buf, i) => {
    const w = buf.readUInt32BE(16) || 256; // PNG IHDR width  @ offset 16
    const h = buf.readUInt32BE(20) || 256; // PNG IHDR height @ offset 20
    const e = Buffer.alloc(entrySize);
    e.writeUInt8(w >= 256 ? 0 : w, 0); // width (0 = 256)
    e.writeUInt8(h >= 256 ? 0 : h, 1); // height
    e.writeUInt8(0, 2); // color count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(buf.length, 8); // bytes in res
    e.writeUInt32LE(offset, 12); // image offset
    e.copy(dirs, i * entrySize);
    offset += buf.length;
  });

  const parts = [header, dirs, ...pngBuffers];
  fs.writeFileSync(outFile, Buffer.concat(parts));
  console.log(`✅ ${outFile}  (ICO con ${count} tamaños)`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const baseName = "vendia";
  const svgMark = path.join(SRC, "favicon-vendia.svg");

  // PNGs individuales (útiles para web/favicon)
  for (const size of SIZES) {
    await svgToPng(svgMark, path.join(OUT, `vendia-${size}.png`), size);
  }

  // Construir ICO con varios tamaños (16,32,48,256 son los esenciales)
   await Promise.all([
    svgToPng(svgMark, path.join(OUT, "vendia-16.png"), 16),
    svgToPng(svgMark, path.join(OUT, "vendia-32.png"), 32),
    svgToPng(svgMark, path.join(OUT, "vendia-48.png"), 48),
    svgToPng(svgMark, path.join(OUT, "vendia-256.png"), 256),
  ]).then(() => {
    const icoSizes = [16, 32, 48, 256];
    const bufs = icoSizes.map((s) =>
      fs.readFileSync(path.join(OUT, `vendia-${s}.png`))
    );
    writeIco(bufs, path.join(OUT, "vendia.ico"));
  });

  // También un .ico llamado Icon.ico (el que ya usa forge.config.js)
  const icoBufs = [16, 32, 48, 256].map((s) =>
    fs.readFileSync(path.join(OUT, `vendia-${s}.png`))
  );
  writeIco(icoBufs, path.join(OUT, "Icon.ico"));

  console.log("\n🎉 Iconos generados en:", OUT);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
