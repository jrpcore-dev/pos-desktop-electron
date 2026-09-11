import { deflateSync } from "node:zlib";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUILD = join(ROOT, "build");
if (!existsSync(BUILD)) mkdirSync(BUILD, { recursive: true });

const BG_TOP = [30, 58, 95];
const BG_BOTTOM = [24, 48, 82];
const BORDER = [84, 125, 172];
const WHITE = [255, 255, 255];
const GOLD = [230, 184, 76];

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function encodeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dirSize = 16 * count;
  let offset = 6 + dirSize;
  const dirs = [];
  const blobs = [];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = e.size >= 256 ? 0 : e.size;
    dir[1] = e.size >= 256 ? 0 : e.size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(e.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    blobs.push(e.png);
    offset += e.png.length;
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

function blend(buf, i, col, alpha) {
  const a0 = alpha / 255;
  const da = buf[i + 3] / 255;
  const oa = a0 + da * (1 - a0);
  if (oa <= 0) {
    buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
    return;
  }
  buf[i] = (col[0] * a0 + buf[i] * (da * (1 - a0))) / oa;
  buf[i + 1] = (col[1] * a0 + buf[i + 1] * (da * (1 - a0))) / oa;
  buf[i + 2] = (col[2] * a0 + buf[i + 2] * (da * (1 - a0))) / oa;
  buf[i + 3] = oa * 255;
}

function inRoundRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px >= x1 || py < y0 || py >= y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2 - r;
  const hh = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hw;
  const qy = Math.abs(py - cy) - hh;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function gradCol(t) {
  return [
    BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
    BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
    BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t,
  ];
}

const V_LEFT = [
  [0.18, 0.26],
  [0.44, 0.26],
  [0.5, 0.8],
  [0.24, 0.8],
];
const V_RIGHT = [
  [0.56, 0.26],
  [0.82, 0.26],
  [0.76, 0.8],
  [0.5, 0.8],
];

const COIN_CX = 0.69;
const COIN_CY = 0.47;
const COIN_R1 = 0.052;
const COIN_R2 = 0.03;

function render(S) {
  const buf = new Float32Array(S * S * 4);
  const m = Math.floor(S * 0.025);
  const edge = S - m;
  const r = S * 0.21;
  const borderW = Math.max(1, S * 0.008);

  for (let py = 0; py < S; py++) {
    const t = Math.max(0, Math.min(1, (py + 0.5 - m) / (edge - m)));
    const bgc = gradCol(t);
    for (let px = 0; px < S; px++) {
      const idx = (py * S + px) * 4;
      if (!inRoundRect(px + 0.5, py + 0.5, m, m, edge, edge, r)) continue;
      blend(buf, idx, bgc, 255);
      const sd = sdRoundRect(px + 0.5, py + 0.5, m, m, edge, edge, r);
      if (Math.abs(sd) <= borderW) {
        blend(buf, idx, BORDER, 110);
        continue;
      }
      const ux = (px + 0.5) / S;
      const uy = (py + 0.5) / S;
      if (inPoly(ux, uy, V_LEFT) || inPoly(ux, uy, V_RIGHT)) {
        blend(buf, idx, WHITE, 255);
        continue;
      }
      const dcx = ux - COIN_CX;
      const dcy = uy - COIN_CY;
      const dc = Math.hypot(dcx, dcy);
      if (dc <= COIN_R1) {
        if (dc <= COIN_R2) blend(buf, idx, bgc, 255);
        else blend(buf, idx, GOLD, 255);
      }
    }
  }
  return buf;
}

function downsample(src, srcS, outS) {
  const out = new Float32Array(outS * outS * 4);
  const step = srcS / outS;
  for (let y = 0; y < outS; y++) {
    for (let x = 0; x < outS; x++) {
      let sumA = 0, sumR = 0, sumG = 0, sumB = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const i = (Math.floor(y * step + dy) * srcS + Math.floor(x * step + dx)) * 4;
          const a = src[i + 3];
          if (a > 0) {
            sumA += a;
            sumR += src[i] * a;
            sumG += src[i + 1] * a;
            sumB += src[i + 2] * a;
          }
        }
      }
      const o = (y * outS + x) * 4;
      const a = sumA / (step * step);
      if (a <= 0) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      } else {
        out[o] = sumR / sumA;
        out[o + 1] = sumG / sumA;
        out[o + 2] = sumB / sumA;
        out[o + 3] = a;
      }
    }
  }
  return out;
}

function toBytes(f) {
  const b = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) b[i] = Math.round(Math.max(0, Math.min(255, f[i])));
  return b;
}

const SUPERSAMPLE = 2048;
const hi = render(SUPERSAMPLE);

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const icoEntries = ICO_SIZES.map((s) => {
  const lo = downsample(hi, SUPERSAMPLE, s);
  return { size: s, png: encodePng(s, s, toBytes(lo)) };
});
writeFileSync(join(BUILD, "Icon.ico"), encodeIco(icoEntries));
console.log(`OK build/Icon.ico (${ICO_SIZES.join(", ")}px)`);

for (const s of [512, 1024]) {
  const lo = downsample(hi, SUPERSAMPLE, s);
  try {
    writeFileSync(join(BUILD, `logo-${s}.png`), encodePng(s, s, toBytes(lo)));
    console.log(`OK build/logo-${s}.png`);
  } catch (e) {
    if (e.code === "UNKNOWN" || e.code === "EPERM") {
      console.log(`build/logo-${s}.png está abierta/accesible en un visor; cierra la app de imágenes y vuelve a correr el script`);
    } else {
      throw e;
    }
  }
}

const GIF_DARK = [24, 48, 82];
const GIF_CARD = [30, 58, 95];
const GIF_GOLD = [230, 184, 76];
const GIF_PALETTE = [GIF_DARK, GIF_CARD, WHITE, GIF_GOLD];
const GIF_SIZE = 240;
const GIF_SPIN_CX = 0.5;
const GIF_SPIN_CY = 0.895;
const GIF_SPIN_R = 0.05;
const GIF_DOT_R = 0.025;
const GIF_FRAMES = 8;
const GIF_DELAY = 15;

function renderGifFrame(S, frame) {
  const idxOut = new Uint8Array(S * S);
  const m = Math.floor(S * 0.028);
  const edge = S - m;
  const r = S * 0.21;
  const base = (frame * Math.PI) / 4;
  const dots = [0, 1, 2].map((i) => {
    const a = base + (i * 2 * Math.PI) / 3;
    return [GIF_SPIN_CX + GIF_SPIN_R * Math.cos(a), GIF_SPIN_CY + GIF_SPIN_R * Math.sin(a)];
  });
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      let idx = 0;
      if (inRoundRect(x, y, m, m, edge, edge, r)) {
        idx = 1;
        const ux = x / S;
        const uy = y / S;
        if (inPoly(ux, uy, V_LEFT) || inPoly(ux, uy, V_RIGHT)) {
          idx = 2;
        } else {
          for (const [dcx, dcy] of dots) {
            if (Math.hypot(ux - dcx, uy - dcy) <= GIF_DOT_R) {
              idx = 3;
              break;
            }
          }
        }
      }
      idxOut[py * S + px] = idx;
    }
  }
  return idxOut;
}

function encodeLzw(pixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const dict = new Map();
  const out = [];
  let bitBuf = 0;
  let bitCount = 0;
  const writeCode = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };
  writeCode(clearCode);
  let prev = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = (prev << 8) | k;
    if (dict.has(key)) {
      prev = dict.get(key);
      continue;
    }
    writeCode(prev);
    dict.set(key, nextCode);
    nextCode++;
    if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
    if (nextCode > 4095) {
      writeCode(clearCode);
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      dict.clear();
    }
    prev = k;
  }
  writeCode(prev);
  writeCode(eoiCode);
  if (bitCount > 0) out.push(bitBuf & 0xff);
  return out;
}

function buildGif(frames, size, palette, delay) {
  const nLog = Math.ceil(Math.log2(palette.length));
  const tableCount = 1 << nLog;
  const minCodeSize = Math.max(2, nLog);
  const parts = [Buffer.from("GIF89a", "ascii")];
  const sd = Buffer.alloc(7);
  sd.writeUInt16LE(size, 0);
  sd.writeUInt16LE(size, 2);
  sd[4] = 0x80 | (7 << 4) | (nLog - 1);
  sd[5] = 0;
  sd[6] = 0;
  parts.push(sd);
  const gct = Buffer.alloc(tableCount * 3);
  for (let i = 0; i < tableCount; i++) {
    const c = palette[i] || [0, 0, 0];
    gct[i * 3] = c[0];
    gct[i * 3 + 1] = c[1];
    gct[i * 3 + 2] = c[2];
  }
  parts.push(gct);
  for (const frame of frames) {
    const gce = Buffer.alloc(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 4;
    gce[3] = 0x04;
    gce.writeUInt16LE(delay, 4);
    gce[6] = 0;
    gce[7] = 0;
    parts.push(gce);
    const id = Buffer.alloc(10);
    id[0] = 0x2c;
    id.writeUInt16LE(0, 1);
    id.writeUInt16LE(0, 3);
    id.writeUInt16LE(size, 5);
    id.writeUInt16LE(size, 7);
    id[9] = 0;
    parts.push(id, Buffer.from([minCodeSize]));
    const data = encodeLzw(frame, minCodeSize);
    for (let o = 0; o < data.length; o += 255) {
      const block = data.slice(o, o + 255);
      parts.push(Buffer.from([block.length]), Buffer.from(block));
    }
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

const gifFrames = [];
for (let f = 0; f < GIF_FRAMES; f++) {
  gifFrames.push(renderGifFrame(GIF_SIZE, f));
}
writeFileSync(join(BUILD, "loading.gif"), buildGif(gifFrames, GIF_SIZE, GIF_PALETTE, GIF_DELAY));
console.log(`OK build/loading.gif (${GIF_FRAMES} frames, ${GIF_SIZE}x${GIF_SIZE}, spinner)`);

// ─── NSIS branding (BMP, sin alfa: fondo sólido) ──────────────────────────
function drawBadge(buf, W, H, yTop, xLeft, sizePx) {
  const m = Math.floor(sizePx * 0.025);
  const edge = sizePx - m;
  const r = sizePx * 0.21;
  const borderW = Math.max(1, sizePx * 0.008);
  for (let dy = 0; dy < sizePx; dy++) {
    const y = yTop + dy;
    if (y < 0 || y >= H) continue;
    const t = Math.max(0, Math.min(1, (dy + 0.5 - m) / (edge - m)));
    const bgc = gradCol(t);
    for (let dx = 0; dx < sizePx; dx++) {
      const x = xLeft + dx;
      if (x < 0 || x >= W) continue;
      const idx = (y * W + x) * 4;
      if (!inRoundRect(dx + 0.5, dy + 0.5, m, m, edge, edge, r)) continue;
      blend(buf, idx, bgc, 255);
      const sd = sdRoundRect(dx + 0.5, dy + 0.5, m, m, edge, edge, r);
      if (Math.abs(sd) <= borderW) {
        blend(buf, idx, BORDER, 110);
        continue;
      }
      const ux = (dx + 0.5) / sizePx;
      const uy = (dy + 0.5) / sizePx;
      if (inPoly(ux, uy, V_LEFT) || inPoly(ux, uy, V_RIGHT)) {
        blend(buf, idx, WHITE, 255);
        continue;
      }
      const dcx = ux - COIN_CX;
      const dcy = uy - COIN_CY;
      const dc = Math.hypot(dcx, dcy);
      if (dc <= COIN_R1) {
        if (dc <= COIN_R2) blend(buf, idx, bgc, 255);
        else blend(buf, idx, GOLD, 255);
      }
    }
  }
}

function renderRect(W, H, badgeSizePx, cxNorm, cyNorm) {
  const buf = new Float32Array(H * W * 4);
  for (let y = 0; y < H; y++) {
    const t = Math.max(0, Math.min(1, (y + 0.5) / H));
    const bgc = gradCol(t);
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      blend(buf, idx, bgc, 255);
    }
  }
  drawBadge(buf, W, H, Math.round(cyNorm * H - badgeSizePx / 2), Math.round(cxNorm * W - badgeSizePx / 2), badgeSizePx);
  return buf;
}

function encodeBmp24(w, h, rgba) {
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelOffset = 54;
  const dataSize = rowSize * h;
  const b = Buffer.alloc(pixelOffset + dataSize);
  b.write("BM", 0, "ascii");
  b.writeUInt32LE(54 + dataSize, 2);
  b.writeUInt32LE(pixelOffset, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(0, 30);
  b.writeUInt32LE(dataSize, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const i = (srcY * w + x) * 4;
      const o = pixelOffset + y * rowSize + x * 3;
      b[o] = Math.round(Math.max(0, Math.min(255, rgba[i + 2])));
      b[o + 1] = Math.round(Math.max(0, Math.min(255, rgba[i + 1])));
      b[o + 2] = Math.round(Math.max(0, Math.min(255, rgba[i])));
    }
  }
  return b;
}

const bmpSidebar = renderRect(164, 314, 118, 0.5, 0.42);
writeFileSync(join(BUILD, "installerSidebar.bmp"), encodeBmp24(164, 314, bmpSidebar));
console.log("OK build/installerSidebar.bmp (164x314)");

const bmpHeader = renderRect(150, 57, 48, 0.5, 0.5);
writeFileSync(join(BUILD, "installerHeader.bmp"), encodeBmp24(150, 57, bmpHeader));
console.log("OK build/installerHeader.bmp (150x57)");