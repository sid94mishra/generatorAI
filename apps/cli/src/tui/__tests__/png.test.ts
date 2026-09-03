// ────────────────────────────────────────────────────────────────
// PNG decoding and the pixel-based renderers (open questions #30 / #40).
//
// Fixtures are ENCODED here rather than checked in as binaries: a
// hand-written decoder is only trustworthy against images whose exact pixel
// values the test knows, and a committed .png hides its own contents from
// the reader. Encoding also lets each filter type, colour type and edge case
// be constructed deliberately instead of hoping a sample file covers it.
//
// The failure mode all of this guards against is silent: a wrong filter or a
// mis-read colour type does not throw, it produces a plausible picture of
// the wrong thing.
// ────────────────────────────────────────────────────────────────

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, fitImage, type DecodedImage } from '../png.js';
import { encodeAscii, encodeHalfBlock, encodeInlineImage, encodeSixel } from '../imageRender.js';

const ESC = String.fromCharCode(0x1b);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** The decoder does not verify CRCs, but a real PNG has them — so the fixtures do too. */
function crc32(buffer: Buffer): number {
  let c = ~0;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

interface EncodeOptions {
  width: number;
  height: number;
  colorType: number;
  /** Per-row filter type, so each of the five can be exercised. */
  filters?: number[];
  /** Raw, UNFILTERED sample bytes, row-major. */
  samples: number[];
  palette?: number[];
  bitDepth?: number;
  interlace?: number;
}

/** Builds a PNG whose pixel values the test chose, with the filters it asked for. */
function encodePng(options: EncodeOptions): Uint8Array {
  const { width, height, colorType, samples, palette } = options;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 1;
  const stride = width * channels;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = colorType;
  ihdr[12] = options.interlace ?? 0;

  // Filter each row the way the PNG spec defines, so the decoder's
  // reconstruction is checked against a real encoder rather than against
  // itself.
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    const filter = options.filters?.[y] ?? 0;
    raw.push(filter);
    for (let x = 0; x < stride; x++) {
      const value = samples[y * stride + x]!;
      const a = x >= channels ? samples[y * stride + x - channels]! : 0;
      const b = y > 0 ? samples[(y - 1) * stride + x]! : 0;
      const c = y > 0 && x >= channels ? samples[(y - 1) * stride + x - channels]! : 0;
      raw.push(applyFilter(filter, value, a, b, c));
    }
  }

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      ...(palette ? [chunk('PLTE', Buffer.from(palette))] : []),
      chunk('IDAT', deflateSync(Buffer.from(raw))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function applyFilter(filter: number, x: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 1:
      return (x - a) & 0xff;
    case 2:
      return (x - b) & 0xff;
    case 3:
      return (x - ((a + b) >> 1)) & 0xff;
    case 4:
      return (x - paeth(a, b, c)) & 0xff;
    default:
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

const pixel = (image: DecodedImage, x: number, y: number): number[] => {
  const at = (y * image.width + x) * 4;
  return [...image.pixels.slice(at, at + 4)];
};

describe('decodePng', () => {
  it('decodes a truecolor image to the exact pixels it was built from', () => {
    const png = encodePng({
      width: 2,
      height: 2,
      colorType: 2,
      samples: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255],
    });
    const image = decodePng(png)!;
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 0, 1)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it('reconstructs every one of the five row filters', () => {
    // A wrong filter does not throw — it produces a plausible picture of the
    // wrong thing, which is why each is exercised on the same known data.
    const samples: number[] = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 4; x++) samples.push((x * 40 + y * 7) & 0xff, y * 30, x * 20, 255);
    }
    const png = encodePng({
      width: 4,
      height: 5,
      colorType: 6,
      filters: [0, 1, 2, 3, 4],
      samples,
    });
    const image = decodePng(png)!;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 4; x++) {
        expect(pixel(image, x, y), `pixel ${x},${y}`).toEqual([
          (x * 40 + y * 7) & 0xff,
          y * 30,
          x * 20,
          255,
        ]);
      }
    }
  });

  it('carries the alpha channel through rather than flattening it', () => {
    const png = encodePng({ width: 1, height: 1, colorType: 6, samples: [10, 20, 30, 128] });
    expect(pixel(decodePng(png)!, 0, 0)).toEqual([10, 20, 30, 128]);
  });

  it('expands greyscale and greyscale+alpha to RGBA', () => {
    expect(pixel(decodePng(encodePng({ width: 1, height: 1, colorType: 0, samples: [77] }))!, 0, 0))
      .toEqual([77, 77, 77, 255]);
    expect(
      pixel(decodePng(encodePng({ width: 1, height: 1, colorType: 4, samples: [77, 40] }))!, 0, 0),
    ).toEqual([77, 77, 77, 40]);
  });

  it('resolves palette indices through PLTE', () => {
    const png = encodePng({
      width: 2,
      height: 1,
      colorType: 3,
      samples: [1, 0],
      palette: [9, 9, 9, 200, 100, 50],
    });
    const image = decodePng(png)!;
    expect(pixel(image, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(pixel(image, 1, 0)).toEqual([9, 9, 9, 255]);
  });

  it('refuses what it cannot decode instead of producing a wrong image', () => {
    // Both of these decode to something plausible-but-wrong if handled
    // naively, which is far worse than the caller's external-viewer fallback.
    expect(decodePng(encodePng({ width: 1, height: 1, colorType: 2, samples: [1, 2, 3], bitDepth: 16 }))).toBeNull();
    expect(decodePng(encodePng({ width: 1, height: 1, colorType: 2, samples: [1, 2, 3], interlace: 1 }))).toBeNull();
  });

  it('returns null for anything that is not a PNG, without throwing', () => {
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePng(new Uint8Array(0))).toBeNull();
    expect(decodePng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });

  it('returns null for a truncated stream rather than reading past the end', () => {
    const png = encodePng({ width: 2, height: 2, colorType: 2, samples: new Array(12).fill(7) });
    expect(decodePng(png.slice(0, png.length - 20))).toBeNull();
  });

  it('returns null when the compressed data is corrupt', () => {
    const png = encodePng({ width: 2, height: 2, colorType: 2, samples: new Array(12).fill(7) });
    const corrupt = new Uint8Array(png);
    // Land inside the IDAT payload, past every header.
    corrupt[corrupt.length - 20] ^= 0xff;
    expect(decodePng(corrupt)).toBeNull();
  });
});

describe('fitImage', () => {
  const image: DecodedImage = {
    width: 4,
    height: 4,
    pixels: new Uint8Array(4 * 4 * 4).fill(200),
  };

  it('scales down into the box, preserving aspect ratio', () => {
    const out = fitImage(image, 2, 10);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
  });

  it('never scales UP — a 2×2 screenshot blown up to 80 columns is mush', () => {
    const out = fitImage(image, 100, 100);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out).toBe(image);
  });

  it('never produces a zero dimension', () => {
    const out = fitImage({ width: 100, height: 1, pixels: new Uint8Array(400) }, 1, 1);
    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe('encodeHalfBlock', () => {
  const image = (values: number[][]): DecodedImage => {
    const height = values.length;
    const width = values[0]!.length / 3;
    const pixels = new Uint8Array(width * height * 4);
    values.forEach((row, y) => {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        pixels[at] = row[x * 3]!;
        pixels[at + 1] = row[x * 3 + 1]!;
        pixels[at + 2] = row[x * 3 + 2]!;
        pixels[at + 3] = 255;
      }
    });
    return { width, height, pixels };
  };

  it('packs two pixel rows into one cell: top as foreground, bottom as background', () => {
    const out = encodeHalfBlock(image([[255, 0, 0], [0, 0, 255]]));
    expect(out).toContain(`${ESC}[38;2;255;0;0m`);
    expect(out).toContain(`${ESC}[48;2;0;0;255m`);
    expect(out).toContain('▀');
    // One text row for two pixel rows.
    expect(out.split('\n')).toHaveLength(1);
  });

  it('resets SGR at the end of every line, so colour does not bleed into the next', () => {
    const out = encodeHalfBlock(image([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]));
    for (const line of out.split('\n')) expect(line.endsWith(`${ESC}[0m`)).toBe(true);
  });

  it('repeats the top pixel for an odd final row rather than banding it over black', () => {
    const out = encodeHalfBlock(image([[9, 9, 9]]));
    expect(out).toContain(`${ESC}[38;2;9;9;9m`);
    expect(out).toContain(`${ESC}[48;2;9;9;9m`);
  });

  it('composites transparency onto mid-grey, not onto black', () => {
    // A fully transparent screenshot region rendered on black is a black
    // rectangle that reads as "the capture failed".
    const transparent: DecodedImage = { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 0]) };
    expect(encodeHalfBlock(transparent)).toContain('128;128;128');
  });
});

describe('encodeAscii', () => {
  const grey = (values: number[]): DecodedImage => ({
    width: values.length,
    height: 1,
    pixels: new Uint8Array(values.flatMap((v) => [v, v, v, 255])),
  });

  it('maps brightness onto the ramp, darkest first', () => {
    const out = encodeAscii(grey([0, 255]));
    expect(out[0]).toBe(' ');
    expect(out[1]).toBe('@');
  });

  it('weights green over blue, so two equally-bright colours are not identical', () => {
    // A flat channel average turns a saturated green and a saturated blue
    // into the same character.
    const green: DecodedImage = { width: 1, height: 1, pixels: new Uint8Array([0, 255, 0, 255]) };
    const blue: DecodedImage = { width: 1, height: 1, pixels: new Uint8Array([0, 0, 255, 255]) };
    expect(encodeAscii(green)).not.toBe(encodeAscii(blue));
  });

  it('emits no escape sequences at all — it is the no-colour fallback', () => {
    expect(encodeAscii(grey([0, 128, 255]))).not.toContain(ESC);
  });
});

describe('encodeSixel', () => {
  const solid = (r: number, g: number, b: number, w = 4, h = 6): DecodedImage => {
    const pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4] = r;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = 255;
    }
    return { width: w, height: h, pixels };
  };

  it('opens with the sixel DCS and closes with the string terminator', () => {
    const out = encodeSixel(solid(255, 0, 0));
    expect(out.startsWith(`${ESC}P0;0;8q`)).toBe(true);
    expect(out.endsWith(`${ESC}\\`)).toBe(true);
  });

  it('declares the raster size, so the terminal reserves the right area', () => {
    expect(encodeSixel(solid(1, 2, 3, 7, 12))).toContain('"1;1;7;12');
  });

  it('emits palette registers in sixel 0-100 units, not 0-255', () => {
    // 8-bit values here wash the whole image out; the bug is invisible in
    // code review and obvious on screen.
    const out = encodeSixel(solid(255, 255, 255));
    expect(out).toContain('#0;2;0;0;0');
    expect(out).toContain('#215;2;100;100;100');
    expect(out).not.toMatch(/#\d+;2;\d*[2-9]\d\d/);
  });

  it('run-length encodes a repeated column instead of one byte per pixel', () => {
    // A 400-column band of one colour is 400 bytes without this and 6 with.
    expect(encodeSixel(solid(255, 0, 0, 40, 6))).toMatch(/!\d+/);
  });

  it('separates bands with `-` and colour passes within a band with `$`', () => {
    const twoTone: DecodedImage = {
      width: 2,
      height: 12,
      pixels: new Uint8Array(2 * 12 * 4),
    };
    for (let i = 0; i < 24; i++) {
      const alternate = i % 2 === 0;
      twoTone.pixels[i * 4] = alternate ? 255 : 0;
      twoTone.pixels[i * 4 + 2] = alternate ? 0 : 255;
      twoTone.pixels[i * 4 + 3] = 255;
    }
    const out = encodeSixel(twoTone);
    expect(out).toContain('-');
    expect(out).toContain('$');
  });
});

describe('encodeInlineImage — pixel protocols', () => {
  const png = encodePng({
    width: 2,
    height: 2,
    colorType: 2,
    samples: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255],
  });

  it('draws half-block, sixel and ASCII from a real PNG', () => {
    expect(encodeInlineImage('halfblock', png, { columns: 20, rows: 10 })).toContain('▀');
    expect(encodeInlineImage('sixel', png, { columns: 20, rows: 10 })!.startsWith(`${ESC}P`)).toBe(true);
    expect(encodeInlineImage('ascii', png, { columns: 20, rows: 10 })).not.toContain(ESC);
  });

  it('fits the image to the reported cell grid rather than the source size', () => {
    const wide = encodePng({
      width: 40,
      height: 40,
      colorType: 2,
      samples: new Array(40 * 40 * 3).fill(128),
    });
    const out = encodeInlineImage('ascii', wide, { columns: 10, rows: 10 })!;
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(10);
  });

  it('returns null for a file it cannot decode, so the caller falls back', () => {
    expect(encodeInlineImage('halfblock', new Uint8Array([1, 2, 3]))).toBeNull();
    expect(encodeInlineImage('sixel', new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('still passes PNG bytes through untouched for kitty and iTerm2', () => {
    // The decode path must not have changed the two protocols that never
    // needed it.
    expect(encodeInlineImage('kitty', png)).toContain(Buffer.from(png).toString('base64'));
    expect(encodeInlineImage('iterm2', png)).toContain(Buffer.from(png).toString('base64'));
  });
});
