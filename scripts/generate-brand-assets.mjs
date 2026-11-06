// Genera todos los recursos de marca de Vendia a partir de build/brand/:
//   - build/Icon.ico (app, instalador, bandeja) y build/logo-{512,1024}.png
//   - build/installerHeader.bmp y build/installerSidebar.bmp (desinstalador)
//   - build/installerSplash-{100,125,150,175,200}.bmp (ventana de instalación)
//   - src/renderer/assets/{icon,favicon,logo}-vendia.svg
//
// Uso: node scripts/generate-brand-assets.mjs
//
// Variante elegida para la app: oscura (build/brand/vendia-icon-oscuro.svg).
// Los textos ya vienen como trazos en build/brand/textos.json (Inter Display en el
// logotipo, Instrument Sans en el resto),
// así el resultado no depende de las fuentes instaladas en la máquina.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const ASSETS = join(ROOT, "src/renderer/assets");

const ICON_SVG = readFileSync(join(BUILD, "brand/vendia-icon-oscuro.svg"), "utf8");
const TEXTS = JSON.parse(readFileSync(join(BUILD, "brand/textos.json"), "utf8"));

// Colores tomados del propio icono oscuro.
const BG_TOP = "#1F2B47";
const BG_BOTTOM = "#0A101E";
const GLOW = "#3664DE";
const INK = "#0F172A"; // --primary del sistema (azul casi negro)
const MUTED = "#9FB0CF";

// Debe coincidir con los valores de scripts/nsis-custom.nsh.
const SPLASH = { width: 460, height: 280 };
const SPLASH_SCALES = [100, 125, 150, 175, 200];

const TILE_RE = /<g clip-path="url\(#sq\)">.*?<\/g>\s*<rect [^>]*stroke[^>]*\/>/s;
const inner = (svg) => svg.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/s, "");

// Icono sin el fondo redondeado, para colocarlo sobre fondos de la marca.
const MARK_INNER = inner(ICON_SVG.replace(TILE_RE, ""));

// En 16–32 px el relieve se vuelve ruido: se quitan sombras y brillo, y el
// símbolo crece para que siga leyéndose como la V con rayo.
const SMALL_ICON_SVG = ICON_SVG
  .replace(/ filter="url\(#(sh|blur)\)"/g, "")
  .replace('<rect width="1024" height="1024" fill="url(#gloss)"/>', "")
  .replace(/<rect x="2" y="2"[^>]*\/>/, "")
  .replace("scale(1.75)", "scale(2.2)");

const nested = (content, x, y, size, id) => {
  const scoped = content.replaceAll('id="', `id="${id}-`).replaceAll("url(#", `url(#${id}-`);
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 1024 1024">${scoped}</svg>`;
};

const textPath = (key, x, baseline, capHeight, fill, { center = false } = {}) => {
  const t = TEXTS[key];
  const k = capHeight / t.capHeight;
  const left = center ? x - (t.width * k) / 2 : x;
  return `<path transform="translate(${left} ${baseline}) scale(${k})" fill="${fill}" d="${t.d}"/>`;
};

const brandBackground = (w, h, glowCy) => `
  <defs>
    <linearGradient id="page" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="${glowCy}" r="0.6"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.34"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#page)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>`;

const splashSvg = (scale) => {
  const { width: w, height: h } = SPLASH;
  const px = (n) => Math.round((n * scale) / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px(w)}" height="${px(h)}" viewBox="0 0 ${w} ${h}">
    ${brandBackground(w, h, 0.32)}
    ${nested(MARK_INNER, w / 2 - 68, 12, 136, "m")}
    ${textPath("wordmark", w / 2, 178, 36, "#FFFFFF", { center: true })}
    ${textPath("installing", w / 2, 212, 9.5, MUTED, { center: true })}
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#FFFFFF" stroke-opacity="0.12"/>
  </svg>`;
};

const sidebarSvg = () => {
  const [w, h] = [164, 314];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${brandBackground(w, h, 0.34)}
    ${nested(MARK_INNER, w / 2 - 66, 44, 132, "m")}
    ${textPath("wordmark", w / 2, 208, 26, "#FFFFFF", { center: true })}
    ${textPath("tagline", w / 2, 232, 8.5, MUTED, { center: true })}
  </svg>`;
};

const headerSvg = () => {
  const [w, h] = [150, 57];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#FFFFFF"/>
    ${nested(inner(ICON_SVG), 8, 8, 41, "t")}
    ${textPath("wordmark", 56, 37, 19, INK)}
  </svg>`;
};

const lockupSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 700">
  ${nested(inner(ICON_SVG), 60, 30, 640, "t")}
  ${textPath("wordmark", 760, 470, 380, INK)}
</svg>
`;

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dirs = entries.map(({ size, data }) => {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += data.length;
    return dir;
  });
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.data)]);
}

async function writeBmp(svg, file) {
  const { data, info } = await sharp(Buffer.from(svg))
    .flatten({ background: "#FFFFFF" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const stride = (width * 3 + 3) & ~3;
  const size = 54 + stride * height;
  const bmp = Buffer.alloc(size);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(size, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      bmp[row + x * 3] = data[src + 2];
      bmp[row + x * 3 + 1] = data[src + 1];
      bmp[row + x * 3 + 2] = data[src];
    }
  }
  writeFileSync(file, bmp);
}

const icoEntries = [];
for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
  icoEntries.push({ size, data: await png(size <= 32 ? SMALL_ICON_SVG : ICON_SVG, size) });
}
writeFileSync(join(BUILD, "Icon.ico"), encodeIco(icoEntries));

for (const size of [512, 1024]) {
  writeFileSync(join(BUILD, `logo-${size}.png`), await png(ICON_SVG, size));
}

await writeBmp(sidebarSvg(), join(BUILD, "installerSidebar.bmp"));
await writeBmp(headerSvg(), join(BUILD, "installerHeader.bmp"));
for (const scale of SPLASH_SCALES) {
  await writeBmp(splashSvg(scale), join(BUILD, `installerSplash-${scale}.bmp`));
}

writeFileSync(join(ASSETS, "icon-vendia.svg"), ICON_SVG);
writeFileSync(join(ASSETS, "favicon-vendia.svg"), SMALL_ICON_SVG);
writeFileSync(join(ASSETS, "logo-vendia.svg"), lockupSvg());

console.log("Recursos de marca generados.");
