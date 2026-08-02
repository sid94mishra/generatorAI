// Generates placeholder brand icons (PNG) into resources/ when missing.
// Dependency-free PNG encoder so the desktop app always has a valid icon and
// tray image without committing binary assets. Replace with real artwork for
// production releases.

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.resolve(__dirname, '..', 'resources');
fs.mkdirSync(RES, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const discR = size * 0.26;
  const innerR = size * 0.11;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-rect mask
      const inRoundedRect = roundedRectAlpha(x, y, size, radius);
      if (inRoundedRect <= 0) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
        continue;
      }
      // Diagonal brand gradient #1f6feb -> #4493f8
      const t = (x + y) / (2 * size);
      let r = lerp(0x1f, 0x44, t);
      let g = lerp(0x6f, 0x93, t);
      let b = lerp(0xeb, 0xf8, t);

      // Centered white disc with brand inner dot (stylised node).
      const d = Math.hypot(x - cx, y - cy);
      if (d <= discR) {
        if (d <= innerR) {
          r = 0x1f;
          g = 0x6f;
          b = 0xeb;
        } else {
          r = 0xff;
          g = 0xff;
          b = 0xff;
        }
      }
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(255 * inRoundedRect);
    }
  }
  return encodePNG(size, size, rgba);
}

// Anti-aliased rounded-rect coverage in [0,1].
function roundedRectAlpha(x, y, size, radius) {
  const margin = size * 0.06;
  const left = margin;
  const top = margin;
  const right = size - margin;
  const bottom = size - margin;
  if (x < left || x > right || y < top || y > bottom) return 0;
  const rx = Math.min(radius, (right - left) / 2);
  let dx = 0;
  let dy = 0;
  if (x < left + rx) dx = left + rx - x;
  else if (x > right - rx) dx = x - (right - rx);
  if (y < top + rx) dy = top + rx - y;
  else if (y > bottom - rx) dy = y - (bottom - rx);
  const dist = Math.hypot(dx, dy);
  if (dist <= rx - 1) return 1;
  if (dist >= rx + 1) return 0;
  return (rx + 1 - dist) / 2;
}

function writeIfMissing(name, buf) {
  const p = path.join(RES, name);
  if (fs.existsSync(p)) {
    console.log('keep', name);
    return;
  }
  fs.writeFileSync(p, buf);
  console.log('wrote', name, `${buf.length} bytes`);
}

writeIfMissing('icon.png', drawIcon(512));
writeIfMissing('tray.png', drawIcon(32));
console.log('resources ready at', RES);
