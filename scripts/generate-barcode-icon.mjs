import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(ROOT, '..', 'mobile', 'assets');

const BG_TOP = [30, 58, 95]; // #1e3a5f (azul oscuro del sistema)
const BG_BOTTOM = [24, 48, 82]; // #183052 (ligeramente más oscuro abajo)
const BAR = [30, 58, 95]; // #1e3a5f
const WHITE = [255, 255, 255];

// ---- PNG encoder (RGBA8) ----
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
  const t = Buffer.from(type, 'ascii');
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
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Pixel helpers ----
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

function fillRect(buf, S, x, y, w, h, col, alpha) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(S, Math.ceil(x + w));
  const y1 = Math.min(S, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    const row = py * S;
    for (let px = x0; px < x1; px++) {
      blend(buf, (row + px) * 4, col, alpha);
    }
  }
}

function inRoundRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px >= x1 || py < y0 || py >= y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundRect(buf, S, x0, y0, x1, y1, r, col, alpha) {
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(S, Math.ceil(x1));
  const by1 = Math.min(S, Math.ceil(y1));
  for (let py = by0; py < by1; py++) {
    const row = py * S;
    for (let px = bx0; px < bx1; px++) {
      if (inRoundRect(px + 0.5, py + 0.5, x0, y0, x1, y1, r)) {
        blend(buf, (row + px) * 4, col, alpha);
      }
    }
  }
}

function fillRoundRectGrad(buf, S, x0, y0, x1, y1, r, topCol, botCol) {
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(S, Math.ceil(x1));
  const by1 = Math.min(S, Math.ceil(y1));
  for (let py = by0; py < by1; py++) {
    const row = py * S;
    const t = Math.max(0, Math.min(1, (py + 0.5 - y0) / (y1 - y0)));
    const col = [
      topCol[0] + (botCol[0] - topCol[0]) * t,
      topCol[1] + (botCol[1] - topCol[1]) * t,
      topCol[2] + (botCol[2] - topCol[2]) * t,
    ];
    for (let px = bx0; px < bx1; px++) {
      if (inRoundRect(px + 0.5, py + 0.5, x0, y0, x1, y1, r)) {
        blend(buf, (row + px) * 4, col, 255);
      }
    }
  }
}

function fillGradient(buf, S, topCol, botCol) {
  for (let py = 0; py < S; py++) {
    const t = py / (S - 1);
    const col = [
      topCol[0] + (botCol[0] - topCol[0]) * t,
      topCol[1] + (botCol[1] - topCol[1]) * t,
      topCol[2] + (botCol[2] - topCol[2]) * t,
    ];
    for (let px = 0; px < S; px++) {
      blend(buf, (py * S + px) * 4, col, 255);
    }
  }
}

function cutRect(buf, S, x, y, w, h) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(S, Math.ceil(x + w));
  const y1 = Math.min(S, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    const row = py * S;
    for (let px = x0; px < x1; px++) {
      const i = (row + px) * 4;
      buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
    }
  }
}

// ---- EAN-13 bit pattern ----
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const DIGITS_L = [7, 5, 0, 0, 0, 4];
const DIGITS_R = [9, 6, 6, 5, 3, 1];

function barcodeRuns() {
  const bits =
    '101' +
    DIGITS_L.map((d) => L[d]).join('') +
    '01010' +
    DIGITS_R.map((d) => R[d]).join('') +
    '101';
  const runs = [];
  let i = 0;
  while (i < bits.length) {
    const bit = bits[i] === '1';
    let j = i;
    while (j < bits.length && (bits[j] === '1') === bit) j++;
    const guard = (i <= 2 && bit) || (i >= 45 && i <= 49 && bit) || (i >= 92 && bit);
    runs.push({ x0: i, x1: j, isBar: bit, guard });
    i = j;
  }
  return runs;
}

// ---- 5x7 digit font ----
const FONT = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
];

function drawDigit(buf, S, x, y, ch, fs, col, cutout) {
  const bm = FONT[ch];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 5; c++) {
      if (bm[r][c] === '1') {
        if (cutout) cutRect(buf, S, x + c * fs, y + r * fs, fs, fs);
        else fillRect(buf, S, x + c * fs, y + r * fs, fs, fs, col, 255);
      }
    }
  }
}

// ---- Design renderer ----
function renderIcon(S, cfg) {
  const buf = new Float32Array(S * S * 4);

  if (cfg.mode === 'background') {
    fillGradient(buf, S, BG_TOP, BG_BOTTOM);
    return buf;
  }

  const zone = cfg.fraction;
  const inset = (S - S * zone) / 2;
  const cardX0 = inset;
  const cardY0 = inset;
  const cardW = S * zone;
  const cardH = S * zone;
  const cardR = cardW * 0.16;

  if (cfg.mode === 'icon' || cfg.mode === 'favicon') {
    const m = Math.max(1, S * 0.02);
    fillRoundRectGrad(buf, S, m, m, S - m, S - m, S * 0.21, BG_TOP, BG_BOTTOM);
  }

  const cardCol = WHITE;
  const barCol = cfg.mode === 'monochrome' ? null : BAR;
  const cutout = cfg.mode === 'monochrome';
  fillRoundRect(buf, S, cardX0, cardY0, cardX0 + cardW, cardY0 + cardH, cardR, cardCol, 255);

  const pad = cardW * 0.045;
  const innerX0 = cardX0 + pad;
  const innerY0 = cardY0 + pad;
  const innerW = cardW - pad * 2;
  const innerH = cardH - pad * 2;

  const QUIET = 9;
  const TOTAL = 113;
  const u = innerW / TOTAL;
  const barTop = innerY0 + innerH * 0.12;
  const barH = innerH * 0.56;
  const guardTop = barTop - innerH * 0.05;
  const guardBottom = barTop + barH + innerH * 0.02;

  for (const run of barcodeRuns()) {
    if (!run.isBar) continue;
    const x = innerX0 + (QUIET + run.x0) * u;
    const w = (run.x1 - run.x0) * u;
    const top = run.guard ? guardTop : barTop;
    const h = run.guard ? guardBottom - guardTop : barH;
    if (cutout) cutRect(buf, S, x, top, w, h);
    else fillRect(buf, S, x, top, w, h, barCol, 255);
  }

  if (cfg.withDigits) {
    const fs = Math.max(1, Math.floor(innerH * 0.03));
    const gap = Math.max(1, Math.floor(fs * 0.5));
    const text = DIGITS_L.join('') + DIGITS_R.join('');
    const textW = text.length * fs * 5 + (text.length - 1) * gap;
    let x = innerX0 + (innerW - textW) / 2;
    const y = barTop + barH + innerH * 0.06;
    for (const ch of text) {
      drawDigit(buf, S, x, y, +ch, fs, barCol, cutout);
      x += fs * 5 + gap;
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
          const i = ((Math.floor(y * step + dy) * srcS + Math.floor(x * step + dx))) * 4;
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

function save(name, renderSize, outSize, cfg) {
  const hi = renderIcon(renderSize, cfg);
  const lo = downsample(hi, renderSize, outSize);
  writeFileSync(join(ASSETS, name), encodePng(outSize, outSize, toBytes(lo)));
  console.log(`OK ${name} (${outSize}x${outSize})`);
}

save('icon.png', 2048, 1024, { mode: 'icon', fraction: 0.94, withDigits: true });
save('splash-icon.png', 2048, 1024, { mode: 'icon', fraction: 0.94, withDigits: true });
save('android-icon-background.png', 512, 512, { mode: 'background', fraction: 1 });
save('android-icon-foreground.png', 1024, 512, { mode: 'foreground', fraction: 0.6, withDigits: true });
save('android-icon-monochrome.png', 864, 432, { mode: 'monochrome', fraction: 0.6, withDigits: true });
save('favicon.png', 96, 48, { mode: 'favicon', fraction: 0.94, withDigits: false });
