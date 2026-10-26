const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "design-preview");
const OUT = path.join(ROOT, "design-preview");

const SIZES = [64, 128, 256, 512];

async function svgToPng(svgFile, outFile, size) {
  await sharp(svgFile)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outFile);
  console.log(`✅ ${outFile}  (${size}x${size})`);
}

async function main() {
  const mark = path.join(SRC, "favicon-vendia.svg");
  const icon = path.join(SRC, "icon-vendia.svg");
  const logo = path.join(SRC, "logo-vendia.svg");

  for (const size of SIZES) {
    await svgToPng(mark, path.join(OUT, `vendia-mark-${size}.png`), size);
    await svgToPng(icon, path.join(OUT, `vendia-icon-${size}.png`), size);
  }

  // Logo completo es ancho, renderizamos a un ancho fijo alto proporcional
  await sharp(logo)
    .resize(1200, null, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, "vendia-logo-1200.png"));
  console.log(`✅ ${path.join(OUT, "vendia-logo-1200.png")}  (logo completo)`);

  console.log("\n🎉 Previews generadas en:", OUT);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
