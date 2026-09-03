// ────────────────────────────────────────────────────────────────
// Inline image encoding and the external-open fallback (Phase 8 item 2).
//
// Every assertion here is about a failure that is INVISIBLE in development:
// a malformed escape does not throw, it paints garbage into the user's
// scrollback or silently draws nothing at all. So the sequences are checked
// byte-for-byte against the protocol specs, and the "cannot draw" path is
// checked for saying WHY rather than falling back silently.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  encodeInlineImage,
  externalOpenCommand,
  inlineImageLimitation,
  inlineImageSupported,
} from '../imageRender.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('inlineImageSupported', () => {
  it('is true for every protocol, now that pixels are reachable', () => {
    // The three pixel protocols were refused while this CLI had no PNG
    // decoder. `png.ts` closed that, and half-block in particular covers
    // every 256-colour terminal — telling a user whose terminal plainly can
    // show an image that it cannot was the worse answer.
    for (const protocol of ['kitty', 'iterm2', 'sixel', 'halfblock', 'ascii'] as const) {
      expect(inlineImageSupported(protocol), protocol).toBe(true);
    }
  });

  it('states each pixel protocol’s real trade-off, and none for the verbatim two', () => {
    // Still shown to the user — "drawn, but quantised" is information, not
    // an apology, and it explains why a screenshot looks coarse.
    for (const protocol of ['sixel', 'halfblock', 'ascii'] as const) {
      expect(inlineImageLimitation(protocol).length).toBeGreaterThan(0);
    }
    expect(inlineImageLimitation('kitty')).toBe('');
    expect(inlineImageLimitation('iterm2')).toBe('');
  });
});

describe('encodeInlineImage', () => {
  it('returns null when the bytes are not a decodable image, whatever the protocol', () => {
    // `png` here is an 8-byte signature stub with no IHDR — the caller's
    // external-viewer fallback is the honest answer for a file this decoder
    // cannot read. (Real decoding is covered in `png.test.ts`.)
    expect(encodeInlineImage('sixel', png)).toBeNull();
    expect(encodeInlineImage('halfblock', png)).toBeNull();
    expect(encodeInlineImage('ascii', png)).toBeNull();
  });

  it("wraps iTerm2's payload in OSC 1337 … BEL with the decoded byte length", () => {
    const out = encodeInlineImage('iterm2', png, { name: 'shot.png' })!;
    expect(out.startsWith(`${ESC}]1337;File=`)).toBe(true);
    expect(out.endsWith(BEL)).toBe(true);
    // iTerm2 rejects the sequence outright when `size` disagrees with the
    // payload, which reads as the image simply not appearing.
    expect(out).toContain(`size=${png.byteLength};`);
    expect(out).toContain('inline=1');
    expect(out).toContain(Buffer.from(png).toString('base64'));
    // The name is base64 too — a literal filename with a `;` would end the
    // parameter early.
    expect(out).toContain(`name=${Buffer.from('shot.png', 'utf8').toString('base64')}`);
  });

  it("wraps kitty's payload in APC … ST with the file format and display action", () => {
    const out = encodeInlineImage('kitty', png)!;
    expect(out).toBe(`${ESC}_Gf=100,a=T;${Buffer.from(png).toString('base64')}${ESC}\\`);
  });

  it('chunks a large kitty payload at 4096 base64 characters', () => {
    // A single oversized APC is dropped by the terminal with no error.
    const big = new Uint8Array(9000).fill(0x41);
    const out = encodeInlineImage('kitty', big)!;
    const chunks = out.split(`${ESC}_G`).slice(1);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const payload = chunk.slice(chunk.indexOf(';') + 1).replace(`${ESC}\\`, '');
      expect(payload.length).toBeLessThanOrEqual(4096);
    }
  });

  it('puts the format keys on the FIRST chunk only, and m=0 on the last', () => {
    // A terminal that sees `f=100` repeated treats later chunks as new
    // images and paints garbage.
    const big = new Uint8Array(9000).fill(0x41);
    const chunks = encodeInlineImage('kitty', big)!.split(`${ESC}_G`).slice(1);
    expect(chunks[0]?.startsWith('f=100,a=T,m=1;')).toBe(true);
    for (const chunk of chunks.slice(1, -1)) expect(chunk.startsWith('m=1;')).toBe(true);
    expect(chunks.at(-1)?.startsWith('m=0;')).toBe(true);
  });

  it('reassembles to exactly the original bytes', () => {
    const big = new Uint8Array(9000).map((_, i) => i % 256);
    const chunks = encodeInlineImage('kitty', big)!.split(`${ESC}_G`).slice(1);
    const joined = chunks
      .map((chunk) => chunk.slice(chunk.indexOf(';') + 1).replace(`${ESC}\\`, ''))
      .join('');
    expect(Buffer.from(joined, 'base64')).toEqual(Buffer.from(big));
  });
});

describe('externalOpenCommand', () => {
  it('passes an empty title before the path on Windows', () => {
    // Without it, `start "C:\a path\x.png"` treats the path AS the window
    // title and nothing opens.
    expect(externalOpenCommand('win32', 'C:\\a path\\x.png')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'C:\\a path\\x.png'],
    });
  });

  it('uses the platform opener elsewhere', () => {
    expect(externalOpenCommand('darwin', '/tmp/x.png').command).toBe('open');
    expect(externalOpenCommand('linux', '/tmp/x.png').command).toBe('xdg-open');
  });

  it('never interpolates the path into a shell string', () => {
    // A path is passed as its own argv entry, so a filename containing a
    // quote or a semicolon cannot become part of the command.
    const { args } = externalOpenCommand('linux', '/tmp/a";rm -rf ~;".png');
    expect(args).toEqual(['/tmp/a";rm -rf ~;".png']);
  });
});
