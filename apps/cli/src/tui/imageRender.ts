// ────────────────────────────────────────────────────────────────
// Drawing an image in a terminal, honestly (Phase 8 item 2).
//
// `TerminalCapabilities.graphics` has always reported which image transport
// the terminal supports — and nothing anywhere used it. A screenshot could
// only ever be written to a file whose path was printed.
//
// Two of the five reported protocols take PNG bytes verbatim: kitty's
// graphics protocol and iTerm2's inline-image OSC. The other three need
// actual pixels:
//
//   - `sixel` needs the image quantised to a palette and re-encoded;
//   - `halfblock` needs RGB averaged into upper/lower half-cells;
//   - `ascii` needs luminance.
//
// All three were refused while this CLI had no decoder, and the user got a
// file path instead of a picture. That was the right call against a guess
// and the wrong one against `png.ts` — half-block is the fallback that
// covers EVERY 256-colour terminal, which is most of them, and telling a
// user whose terminal plainly can show an image that it cannot is a worse
// answer than a slightly coarse one.
//
// The external-viewer fallback is still here, now reserved for what it is
// actually for: a file the decoder genuinely cannot read (16-bit samples,
// Adam7 interlacing, a corrupt stream).
// ────────────────────────────────────────────────────────────────

import type { GraphicsProtocol } from '@generatorai/cli-core';
import { decodePng, fitImage, type DecodedImage } from './png.js';

/** Every protocol this build can draw — which, since `png.ts`, is all of them. */
export function inlineImageSupported(protocol: GraphicsProtocol): boolean {
  return (
    protocol === 'kitty' ||
    protocol === 'iterm2' ||
    protocol === 'sixel' ||
    protocol === 'halfblock' ||
    protocol === 'ascii'
  );
}

/**
 * Why a protocol cannot draw inline — shown to the user instead of silently
 * falling back, so "it opened in Preview instead" is explained rather than
 * surprising.
 */
export function inlineImageLimitation(protocol: GraphicsProtocol): string {
  switch (protocol) {
    case 'kitty':
    case 'iterm2':
      return '';
    case 'sixel':
      return 'Drawn as sixel — colours are quantised to a 6×6×6 palette.';
    case 'halfblock':
      return 'Drawn with half-block characters — two pixels per cell, so fine detail is lost.';
    case 'ascii':
      return 'Drawn as ASCII art — this terminal reports no colour, so only brightness survives.';
    default:
      return 'This terminal reports no image support.';
  }
}

/**
 * The escape sequence that draws `png` inline, or `null` when the protocol
 * cannot.
 *
 * Kitty's payload is chunked at 4096 base64 characters because the protocol
 * requires it — a single oversized APC is dropped by the terminal with no
 * error, which looks exactly like the feature not working.
 */
export function encodeInlineImage(
  protocol: GraphicsProtocol,
  png: Uint8Array,
  options: { name?: string; columns?: number; rows?: number } = {},
): string | null {
  const base64 = Buffer.from(png).toString('base64');
  // Written as escapes rather than literal control bytes: a stray ESC in a
  // source file is invisible in review and silently mangled by any tool that
  // normalises whitespace.
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  /** Application Programme Command introducer / String Terminator. */
  const APC = `${ESC}_`;
  const ST = `${ESC}\\`;

  if (protocol === 'iterm2') {
    // `size` is the DECODED byte length; iTerm2 uses it to show progress and
    // rejects the sequence outright when it disagrees with the payload.
    const name = Buffer.from(options.name ?? 'screenshot.png', 'utf8').toString('base64');
    return `${ESC}]1337;File=name=${name};size=${png.byteLength};inline=1;preserveAspectRatio=1:${base64}${BEL}`;
  }

  if (protocol === 'sixel' || protocol === 'halfblock' || protocol === 'ascii') {
    const image = decodePng(png);
    // `null` means this decoder cannot read the file — the caller's
    // external-viewer fallback is the honest answer, not a blank rectangle.
    if (!image) return null;
    const { columns = 80, rows = 24 } = options;
    if (protocol === 'sixel') return encodeSixel(fitImage(image, columns * 8, rows * 16));
    if (protocol === 'halfblock') return encodeHalfBlock(fitImage(image, columns, rows * 2));
    return encodeAscii(fitImage(image, columns, rows * 2));
  }

  if (protocol === 'kitty') {
    const CHUNK = 4096;
    if (base64.length <= CHUNK) {
      // f=100: the payload is a PNG file, not raw RGB. a=T: transmit AND
      // display in one go.
      return `${APC}Gf=100,a=T;${base64}${ST}`;
    }
    let out = '';
    for (let at = 0; at < base64.length; at += CHUNK) {
      const chunk = base64.slice(at, at + CHUNK);
      const more = at + CHUNK < base64.length ? 1 : 0;
      // Only the FIRST chunk carries the format/action keys; every chunk
      // carries `m` (more-to-come). A terminal that sees `f=100` repeated
      // treats the later chunks as new images and paints garbage.
      const header = at === 0 ? `f=100,a=T,m=${more}` : `m=${more}`;
      out += `${APC}G${header};${chunk}${ST}`;
    }
    return out;
  }

  return null;
}

/**
 * How to hand a file to the platform's own viewer.
 *
 * `start` needs a title argument before the path — without it, a path
 * containing a space is parsed AS the title and nothing opens.
 */
export function externalOpenCommand(
  platform: NodeJS.Platform,
  filePath: string,
): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', filePath] };
  if (platform === 'darwin') return { command: 'open', args: [filePath] };
  return { command: 'xdg-open', args: [filePath] };
}

// ── Pixel-based encoders ───────────────────────────────────────────
//
// All three walk the decoded RGBA buffer and differ only in what one cell
// can express: sixel gets a palette and six vertical pixels per band,
// half-block gets a foreground and a background colour per cell (so two
// pixels), ASCII gets brightness alone.

const ESCAPE = String.fromCharCode(0x1b);
const STRING_TERMINATOR = ESCAPE + String.fromCharCode(0x5c);

/** Composites onto a mid-grey so a transparent screenshot region is not black-on-black. */
function rgb(image: DecodedImage, x: number, y: number): [number, number, number] {
  const at = (y * image.width + x) * 4;
  const alpha = image.pixels[at + 3]! / 255;
  const blend = (channel: number): number => Math.round(channel * alpha + 128 * (1 - alpha));
  return [blend(image.pixels[at]!), blend(image.pixels[at + 1]!), blend(image.pixels[at + 2]!)];
}

/**
 * Two pixels per character cell, using the upper-half block.
 *
 * The cell's FOREGROUND paints the top pixel through `▀` and its BACKGROUND
 * shows through underneath as the bottom one — the standard trick, and the
 * reason a terminal image is twice as tall as its cell count suggests.
 *
 * Truecolor SGR is used unconditionally here because half-block is only
 * selected when detection reports at least 256 colours; a truecolor escape
 * on a 256-colour terminal is approximated rather than mangled.
 */
export function encodeHalfBlock(image: DecodedImage): string {
  const lines: string[] = [];
  for (let y = 0; y < image.height; y += 2) {
    let line = '';
    for (let x = 0; x < image.width; x++) {
      const [tr, tg, tb] = rgb(image, x, y);
      // An odd final row has no bottom pixel; repeating the top one keeps
      // the cell a solid colour instead of a bright band over black.
      const [br, bg, bb] = y + 1 < image.height ? rgb(image, x, y + 1) : [tr, tg, tb];
      line += `${ESCAPE}[38;2;${tr};${tg};${tb}m${ESCAPE}[48;2;${br};${bg};${bb}m\u2580`;
    }
    lines.push(`${line}${ESCAPE}[0m`);
  }
  return lines.join('\n');
}

/** Darkest-to-lightest, chosen for even perceived steps in a monospace font. */
const ASCII_RAMP = ' .:-=+*#%@';

/** Brightness only — the last resort, for a terminal reporting no colour at all. */
export function encodeAscii(image: DecodedImage): string {
  const lines: string[] = [];
  for (let y = 0; y < image.height; y += 2) {
    let line = '';
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = rgb(image, x, y);
      // Rec. 601 luma: the eye is far more sensitive to green than to blue,
      // and a flat average turns a green button and a blue one into the same
      // grey.
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const index = Math.min(ASCII_RAMP.length - 1, Math.round(luma * (ASCII_RAMP.length - 1)));
      line += ASCII_RAMP[index];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Sixel: six vertical pixels per byte, one pass per palette colour per band.
 *
 * Quantised to the 6×6×6 colour cube rather than an optimal palette. A
 * median-cut palette would look better and would mean two passes over every
 * band plus a colour-distance search per pixel; at the size a terminal shows
 * a screenshot, the cube is not the limiting factor — the cell grid is.
 */
export function encodeSixel(image: DecodedImage): string {
  const CUBE = 6;
  const step = 255 / (CUBE - 1);
  const quantise = (channel: number): number => Math.round(channel / step);

  // Palette registers, emitted once up front. Sixel colours are 0-100 per
  // channel, not 0-255 — sending 8-bit values here washes everything out.
  let out = `${ESCAPE}P0;0;8q"1;1;${image.width};${image.height}`;
  for (let i = 0; i < CUBE * CUBE * CUBE; i++) {
    // Each `| 0` matters: without it the division leaves a fraction and the
    // register's red channel drifts off the cube for every index that is not
    // an exact multiple of 36 — a wrong palette, which looks like a
    // colour-shifted image rather than like a bug.
    const r = Math.round((((i / (CUBE * CUBE)) | 0) % CUBE) * step * (100 / 255));
    const g = Math.round((((i / CUBE) | 0) % CUBE) * step * (100 / 255));
    const b = Math.round(((i | 0) % CUBE) * step * (100 / 255));
    out += `#${i};2;${r};${g};${b}`;
  }

  for (let top = 0; top < image.height; top += 6) {
    // Which colours appear in this band, and the six-pixel bitmask each one
    // occupies per column. Only colours actually present get a pass.
    const bands = new Map<number, number[]>();
    for (let x = 0; x < image.width; x++) {
      for (let dy = 0; dy < 6; dy++) {
        const y = top + dy;
        if (y >= image.height) break;
        const [r, g, b] = rgb(image, x, y);
        const index = quantise(r) * CUBE * CUBE + quantise(g) * CUBE + quantise(b);
        let columns = bands.get(index);
        if (!columns) {
          columns = new Array<number>(image.width).fill(0);
          bands.set(index, columns);
        }
        columns[x]! |= 1 << dy;
      }
    }

    let first = true;
    for (const [index, columns] of bands) {
      // `$` returns to the start of the band so the next colour overlays it;
      // the first pass of a band must not emit one or the band shifts right.
      out += first ? `#${index}` : `$#${index}`;
      first = false;
      // Run-length encoding is not optional in practice: a 400-column band
      // of one colour is 400 bytes without it and 6 with.
      let run = 0;
      let previous = -1;
      for (let x = 0; x < image.width; x++) {
        const value = columns[x]!;
        if (value === previous) {
          run += 1;
          continue;
        }
        if (previous >= 0) out += emitRun(previous, run);
        previous = value;
        run = 1;
      }
      if (previous >= 0) out += emitRun(previous, run);
    }
    out += '-'; // next band
  }

  return `${out}${STRING_TERMINATOR}`;
}

function emitRun(mask: number, count: number): string {
  const char = String.fromCharCode(0x3f + mask);
  return count > 3 ? `!${count}${char}` : char.repeat(count);
}
