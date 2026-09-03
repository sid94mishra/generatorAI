// ────────────────────────────────────────────────────────────────
// A PNG decoder, in the standard library (open questions #30 / #40).
//
// `TerminalCapabilities.graphics` reports five protocols. Two (kitty,
// iTerm2) take PNG bytes verbatim; the other three — sixel, half-block and
// ASCII — need actual PIXELS, and this CLI had no way to get them, so all
// three were refused and the user got a file path instead of a picture.
//
// Refusing was the right call while the alternative was a guess. It is the
// wrong call now that the decode is ~120 lines of `zlib` and a filter loop:
// half-block is the fallback that covers EVERY 256-colour terminal, which is
// most of them, and shipping "your terminal cannot show this" to a user
// whose terminal plainly can is a worse answer than a slightly coarse image.
//
// Deliberately not a general PNG library. It handles what the server's own
// screenshot pipeline produces — 8-bit, non-interlaced, RGB/RGBA/grey —
// and reports anything else as unsupported rather than decoding it wrongly.
// A malformed or exotic file returns `null`, and the caller falls back to
// the system viewer exactly as before.
// ────────────────────────────────────────────────────────────────

import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
}

/** PNG's 8-byte signature. Anything else is not a PNG at all. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channel count per PNG colour type. Indexed (3) needs a palette; see `decodePng`. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decodes a PNG to RGBA, or returns `null` when it is not one this decoder
 * supports.
 *
 * `null` is a normal outcome, not an error: the caller's fallback (write the
 * file, offer the system viewer) is a working path, and throwing here would
 * turn "we cannot draw this inline" into a crash.
 */
export function decodePng(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const dataStart = offset + 8;
    // A truncated file must not read past the end — `subarray` would clamp
    // silently and produce garbage pixels rather than an honest refusal.
    if (dataStart + length > bytes.length) return null;

    if (type === 'IHDR') {
      if (length < 13) return null;
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataStart + length);
    } else if (type === 'tRNS') {
      transparency = bytes.subarray(dataStart, dataStart + length);
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4; // + CRC
  }

  // Unsupported rather than mis-decoded: 16-bit samples and Adam7 interlacing
  // both produce a plausible-looking wrong image if handled naively.
  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  const channels = CHANNELS[colorType];
  if (!channels) return null;
  if (colorType === 3 && !palette) return null;
  if (idat.length === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  } catch {
    return null;
  }

  const stride = width * channels;
  // Each row is prefixed by one filter byte.
  if (raw.length < (stride + 1) * height) return null;

  const unfiltered = new Uint8Array(stride * height);
  let rawAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawAt++]!;
    const rowStart = y * stride;
    const priorStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[rawAt++]!;
      // `a` is the byte `channels` to the left, `b` the one above, `c` the
      // one above-left — the PNG filter neighbourhood.
      const a = x >= channels ? unfiltered[rowStart + x - channels]! : 0;
      const b = y > 0 ? unfiltered[priorStart + x]! : 0;
      const c = y > 0 && x >= channels ? unfiltered[priorStart + x - channels]! : 0;
      unfiltered[rowStart + x] = reconstruct(filter, value, a, b, c);
    }
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const at = i * channels;
    if (colorType === 0) {
      const grey = unfiltered[at]!;
      pixels[p] = grey;
      pixels[p + 1] = grey;
      pixels[p + 2] = grey;
      pixels[p + 3] = 255;
    } else if (colorType === 4) {
      const grey = unfiltered[at]!;
      pixels[p] = grey;
      pixels[p + 1] = grey;
      pixels[p + 2] = grey;
      pixels[p + 3] = unfiltered[at + 1]!;
    } else if (colorType === 3) {
      const index = unfiltered[at]!;
      pixels[p] = palette![index * 3] ?? 0;
      pixels[p + 1] = palette![index * 3 + 1] ?? 0;
      pixels[p + 2] = palette![index * 3 + 2] ?? 0;
      pixels[p + 3] = transparency?.[index] ?? 255;
    } else {
      pixels[p] = unfiltered[at]!;
      pixels[p + 1] = unfiltered[at + 1]!;
      pixels[p + 2] = unfiltered[at + 2]!;
      pixels[p + 3] = colorType === 6 ? unfiltered[at + 3]! : 255;
    }
  }

  return { width, height, pixels };
}

/** The five PNG row filters (RFC 2083 §6). */
function reconstruct(filter: number, x: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 0:
      return x;
    case 1:
      return (x + a) & 0xff;
    case 2:
      return (x + b) & 0xff;
    case 3:
      return (x + ((a + b) >> 1)) & 0xff;
    case 4:
      return (x + paeth(a, b, c)) & 0xff;
    default:
      // An unknown filter byte means the stream is not what it claims; the
      // safest reading is the unfiltered value rather than aborting a
      // decode that is otherwise fine.
      return x;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Nearest-neighbour resize into a target box, preserving aspect ratio.
 *
 * Nearest-neighbour rather than a filtered resample because the target is a
 * terminal cell grid — at that resolution a box filter mostly averages
 * detail into mud, and the extra cost buys nothing a reader can see.
 */
export function fitImage(image: DecodedImage, maxWidth: number, maxHeight: number): DecodedImage {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));
  if (width === image.width && height === image.height) return image;

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      pixels[to] = image.pixels[from]!;
      pixels[to + 1] = image.pixels[from + 1]!;
      pixels[to + 2] = image.pixels[from + 2]!;
      pixels[to + 3] = image.pixels[from + 3]!;
    }
  }
  return { width, height, pixels };
}
