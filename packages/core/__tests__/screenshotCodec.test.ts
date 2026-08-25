// Screenshot transcoding (X-14 / Phase 0 item 10).
//
// The behaviour that matters is not "it makes files smaller" — it is that the
// downscale factor it reports can be trusted to map a model-reported
// coordinate back to the driver's space, and that a failure never costs us the
// capture.

import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { transcodeScreenshot } from '../src/infrastructure/computer/screenshotCodec.js';

let dir: string;

// Resolved at module load, not in `beforeAll` — `it.runIf` is evaluated while
// the describe body runs, which is before any hook has fired.
const sharpAvailable = await import('sharp').then(
  () => true,
  () => false,
);

async function makePng(name: string, width: number, height: number): Promise<string> {
  const sharp = (await import('sharp')).default;
  const file = path.join(dir, name);
  await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 90, b: 200 } },
  })
    .png()
    .toFile(file);
  return file;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'shotcodec-'));
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can still hold a handle from libvips' worker pool. Leaving a temp
    // directory behind must not fail the suite.
  }
});

/** Reads the dimensions back off the produced FILE, never off the return value. */
async function realSize(file: string): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default;
  // From a buffer, not a path: `metadata()` never consumes the pipeline, so a
  // path-based instance leaves the file open and Windows then refuses to delete
  // the temp directory in teardown.
  const meta = await sharp(await fs.readFile(file)).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe('transcodeScreenshot', () => {
  it.runIf(sharpAvailable)('re-encodes to webp and reports downscale 1 when under the cap', async () => {
    const src = await makePng('small.png', 800, 600);
    const out = await transcodeScreenshot({ sourcePath: src, format: 'webp', maxEdge: 1280, quality: 75 });

    expect(out.transcoded).toBe(true);
    expect(out.format).toBe('webp');
    expect(out.mimeType).toBe('image/webp');
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    expect(out.downscale).toBe(1);
    // The source must not survive — two files per capture is the bug this
    // replaces, not a new one.
    await expect(fs.access(src)).rejects.toThrow();
    await expect(fs.access(out.path)).resolves.toBeUndefined();
  });

  it.runIf(sharpAvailable)('downscales the long edge and reports a factor that maps coordinates back', async () => {
    const src = await makePng('wide.png', 2560, 1440);
    const out = await transcodeScreenshot({ sourcePath: src, format: 'webp', maxEdge: 1280, quality: 75 });

    expect(out.width).toBe(1280);
    expect(out.height).toBe(720);
    expect(out.downscale).toBe(2);
    // The contract the model depends on: a click at the centre of the image
    // the model saw must land at the centre of the real window.
    expect(Math.round(640 * out.downscale)).toBe(1280);
  });

  it.runIf(sharpAvailable)('honours a portrait aspect ratio on the correct axis', async () => {
    const src = await makePng('tall.png', 1000, 2000);
    const out = await transcodeScreenshot({ sourcePath: src, format: 'jpeg', maxEdge: 1000, quality: 75 });

    expect(out.height).toBe(1000);
    expect(out.width).toBe(500);
    expect(out.mimeType).toBe('image/jpeg');
    expect(path.extname(out.path)).toBe('.jpg');
  });

  // The reported dimensions ARE the coordinate mapping. Asserting the returned
  // numbers against arithmetic proves nothing — the encoder rounds, and a
  // one-pixel disagreement is silent because the image still looks right. Every
  // case here uses a ratio that does not divide evenly.
  it.runIf(sharpAvailable).each([
    [1919, 1079, 1280],
    [1000, 1667, 1024],
    [2001, 999, 800],
    [777, 777, 500],
  ])('reports the encoder\u2019s own dimensions for %ix%i at maxEdge %i', async (w, h, maxEdge) => {
    const src = await makePng(`odd-${w}x${h}-${maxEdge}.png`, w, h);
    const out = await transcodeScreenshot({ sourcePath: src, format: 'webp', maxEdge, quality: 75 });

    const actual = await realSize(out.path);
    expect(out.width).toBe(actual.width);
    expect(out.height).toBe(actual.height);
    expect(out.downscale).toBeCloseTo(w / actual.width, 10);
    expect(Math.max(actual.width, actual.height)).toBeLessThanOrEqual(maxEdge);
  });

  it.runIf(sharpAvailable)('produces a materially smaller file than the source png', async () => {
    const src = await makePng('big.png', 2560, 1440);
    const before = (await fs.stat(src)).size;
    const out = await transcodeScreenshot({ sourcePath: src, format: 'webp', maxEdge: 1280, quality: 75 });
    const after = (await fs.stat(out.path)).size;

    expect(after).toBeLessThan(before);
  });

  it.runIf(sharpAvailable)('leaves a png alone when no resize is needed', async () => {
    const src = await makePng('keep.png', 640, 480);
    const out = await transcodeScreenshot({ sourcePath: src, format: 'png', maxEdge: 1280, quality: 75 });

    expect(out.transcoded).toBe(false);
    expect(out.path).toBe(src);
    await expect(fs.access(src)).resolves.toBeUndefined();
  });

  // The destructive path: target === source, so a direct write would truncate
  // the only copy of the capture. It must still end up as a valid, resized PNG.
  it.runIf(sharpAvailable)('rewrites a png in place safely when a resize IS needed', async () => {
    const src = await makePng('inplace.png', 2000, 1000);
    const out = await transcodeScreenshot({ sourcePath: src, format: 'png', maxEdge: 1000, quality: 75 });

    expect(out.transcoded).toBe(true);
    expect(path.resolve(out.path)).toBe(path.resolve(src));
    expect(out.mimeType).toBe('image/png');
    const actual = await realSize(out.path);
    expect(actual.width).toBe(1000);
    expect(actual.height).toBe(500);
    expect(out.downscale).toBe(2);
    // No temp file left behind.
    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('returns the source untouched rather than throwing when the file is unreadable', async () => {
    const missing = path.join(dir, 'does-not-exist.png');
    const out = await transcodeScreenshot({ sourcePath: missing, format: 'webp', maxEdge: 1280, quality: 75 });

    expect(out.transcoded).toBe(false);
    expect(out.path).toBe(missing);
    expect(out.downscale).toBe(1);
    expect(out.mimeType).toBe('image/png');
  });
});
