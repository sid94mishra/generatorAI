// ────────────────────────────────────────────────────────────────
// Screenshot transcoding — X-14 / P1-30, Phase 0 item 10.
//
// The cua-driver writes a full-resolution PNG. On a 4K display that is 3-8 MB
// on disk, and the same bytes reach the model as base64 with a further +33%.
// PNG is lossless, which is the wrong trade for a UI screenshot the model
// looks at once: WebP at quality 75 measures 3-5x smaller with no observable
// loss of readability for text and controls.
//
// The downscale half is not an optimisation, it is a correctness fix. Anthropic
// documents that when a screenshot exceeds the provider's pixel budget the API
// downscales it server-side and the model then "returns coordinates in the
// space of the image it saw" — which is not the space our driver clicks in, and
// the provider gives us no factor to undo. Owning the resize means we know the
// factor. `ComputerService` records it per session and
// `scalePointsToDriverSpace` applies it to every pixel-addressed action before
// dispatch; without that consumer this module would BE the bug it prevents.
// `screenshotMaxEdge` already existed in AppConfig with a comment promising
// exactly this; nothing implemented it.
//
// `sharp` is optional. It arrives transitively today (via the server's
// transformers dependency) and is declared here as an optionalDependency so a
// platform without a prebuilt binary still runs — it just keeps the PNG.
// ────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ILogger } from '@generatorai/shared';

export type ScreenshotFormat = 'png' | 'jpeg' | 'webp';

export interface TranscodeRequest {
  /** Absolute path to the file the driver wrote. */
  sourcePath: string;
  format: ScreenshotFormat;
  /** Longest edge in pixels after resize. */
  maxEdge: number;
  /** 1-100. Ignored for `png`. */
  quality: number;
  logger?: ILogger;
}

export interface TranscodeResult {
  /** Absolute path to the file to keep. Equals `sourcePath` when unchanged. */
  path: string;
  mimeType: string;
  format: ScreenshotFormat;
  width: number;
  height: number;
  /**
   * Source pixels per output pixel. 1 when not resized. A caller mapping a
   * model-reported coordinate back to the capture multiplies by this.
   */
  downscale: number;
  /** False when the source was returned untouched (no sharp, or an error). */
  transcoded: boolean;
}

interface SharpLike {
  (input: string): SharpInstance;
}

interface SharpInstance {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(opts: { width?: number; height?: number; fit: 'inside'; withoutEnlargement: boolean }): SharpInstance;
  jpeg(opts: { quality: number; mozjpeg?: boolean }): SharpInstance;
  webp(opts: { quality: number }): SharpInstance;
  toBuffer(opts: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number };
  }>;
}

const MIME: Record<ScreenshotFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const EXT: Record<ScreenshotFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
};

let sharpPromise: Promise<SharpLike | null> | undefined;
let warnedUnavailable = false;

async function loadSharp(logger?: ILogger): Promise<SharpLike | null> {
  sharpPromise ??= import('sharp')
    .then((m) => ((m as { default?: SharpLike }).default ?? (m as unknown as SharpLike)))
    .catch(() => null);
  const sharp = await sharpPromise;
  if (!sharp && !warnedUnavailable) {
    warnedUnavailable = true;
    logger?.warn?.(
      '[screenshotCodec] sharp is unavailable; screenshots stay full-resolution PNG. ' +
        'Expect 3-5x larger artifacts and provider-side downscaling of coordinates.',
    );
  }
  return sharp;
}

/** Test seam. Resets the memoised module handle and the one-time warning. */
export function __resetScreenshotCodec(): void {
  sharpPromise = undefined;
  warnedUnavailable = false;
}

function unchanged(sourcePath: string, width: number, height: number): TranscodeResult {
  return {
    path: sourcePath,
    mimeType: MIME.png,
    format: 'png',
    width,
    height,
    downscale: 1,
    transcoded: false,
  };
}

/**
 * Re-encode a driver screenshot in place.
 *
 * On success the source file is removed and the returned path is the new one.
 * The write is temp-and-rename, so a failure never leaves a partially written
 * image where a whole one used to be. On any failure the source is left exactly
 * as it was and `transcoded` is false — a screenshot that cannot be shrunk is
 * still a usable screenshot, so this never throws into the capture path.
 */
export async function transcodeScreenshot(req: TranscodeRequest): Promise<TranscodeResult> {
  const { sourcePath, format, maxEdge, quality, logger } = req;

  const sharp = await loadSharp(logger);
  if (!sharp) return unchanged(sourcePath, 0, 0);

  try {
    const pipeline = sharp(sourcePath);
    const meta = await pipeline.metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (srcW <= 0 || srcH <= 0) return unchanged(sourcePath, srcW, srcH);

    const longest = Math.max(srcW, srcH);
    const needsResize = longest > maxEdge;
    let out = needsResize
      ? pipeline.resize(
          srcW >= srcH
            ? { width: maxEdge, fit: 'inside', withoutEnlargement: true }
            : { height: maxEdge, fit: 'inside', withoutEnlargement: true },
        )
      : pipeline;

    if (format === 'webp') out = out.webp({ quality });
    else if (format === 'jpeg') out = out.jpeg({ quality, mozjpeg: true });
    else if (!needsResize) {
      // PNG requested and no resize needed: nothing to gain, skip the rewrite.
      return unchanged(sourcePath, srcW, srcH);
    }

    // `resolveWithObject` so the dimensions are libvips' OWN, not our
    // arithmetic. `downscale` is a coordinate mapping: a value derived from the
    // requested edge disagrees with the encoder by up to a pixel per axis once
    // rounding is involved, and that error is silent because the image still
    // looks correct.
    const { data: buffer, info } = await out.toBuffer({ resolveWithObject: true });
    const outW = info.width;
    const outH = info.height;

    const targetPath =
      path.join(path.dirname(sourcePath), path.basename(sourcePath, path.extname(sourcePath))) +
      EXT[format];

    // Temp-and-rename, always. When the target IS the source — `format:'png'`
    // with a resize, or a source already carrying the target extension — a
    // direct write truncates the only copy of the capture, and a write that
    // fails partway leaves a corrupt file that still stats, still gets an
    // artifact row, and still renders. Rename is atomic on both platforms.
    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmpPath, buffer);
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
    if (path.resolve(targetPath) !== path.resolve(sourcePath)) {
      await fs.rm(sourcePath, { force: true }).catch(() => undefined);
    }

    return {
      path: targetPath,
      mimeType: MIME[format],
      format,
      width: outW,
      height: outH,
      downscale: outW > 0 ? srcW / outW : 1,
      transcoded: true,
    };
  } catch (err) {
    logger?.warn?.('[screenshotCodec] transcode failed; keeping the original capture', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unchanged(sourcePath, 0, 0);
  }
}

// ────────────────────────────────────────────────────────────────
// X-15 — frame integrity.
//
// "A truncated JPEG has a valid header and renders as a grey half-frame to the
// model", so the magic number alone proves nothing: the plan asks for the
// TERMINATOR and the BYTE LENGTH. The previous implementation checked SOI+EOI
// and only for JPEG — and the shipped default codec is `webp`
// (`AppConfig.ts:screenshotFormat`), so on the default configuration the check
// never ran at all.
//
// Format is detected from the bytes themselves rather than from the extension
// or the artifact row's mimeType: both are metadata a corrupt or tampered
// capture can carry while the payload is something else entirely, and the
// question being asked here is "is this file a whole image".
// ────────────────────────────────────────────────────────────────

/**
 * Smallest plausible screenshot, in bytes.
 *
 * A 1280x720 WebP of a real desktop measures tens of kilobytes; the smallest
 * legal *anything* in these three containers is still ~70 bytes of header and
 * terminator. Anything under this is a stub, a truncated first write, or an
 * error page the driver wrote where an image should be — none of which the
 * terminator check would necessarily catch, because a 20-byte file can still
 * end in the right two bytes by accident.
 */
export const MIN_FRAME_BYTES = 100;

export interface FrameIntegrity {
  ok: boolean;
  /** Detected container, or `unknown` when no signature matched. */
  format: ScreenshotFormat | 'unknown';
  /** Human-readable cause, present only when `ok` is false. */
  reason?: string;
}

function detectFormat(bytes: Buffer): ScreenshotFormat | 'unknown' {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return 'unknown';
}

/**
 * Decides whether a captured frame is a WHOLE image.
 *
 * Cheap and total: a signature, a terminator, and — for WebP, the only one of
 * the three whose container declares its own length — an arithmetic check that
 * the declared length matches the bytes actually on disk. That last one is the
 * strongest truncation detector available here, because a truncated RIFF keeps
 * its original header claiming the full size.
 *
 * Never throws. A caller deciding whether to show a frame to the model must be
 * able to ask this about arbitrary bytes.
 */
export function validateFrameBytes(bytes: Buffer): FrameIntegrity {
  const format = detectFormat(bytes);
  if (bytes.length < MIN_FRAME_BYTES) {
    return { ok: false, format, reason: `only ${bytes.length}B (minimum ${MIN_FRAME_BYTES}B)` };
  }

  switch (format) {
    case 'png': {
      // IEND is the last chunk and is fixed-width: type + CRC, no payload.
      const tail = bytes.subarray(bytes.length - 8);
      const ok = tail.toString('latin1', 0, 4) === 'IEND' && tail.readUInt32BE(4) === 0xae426082;
      return ok ? { ok: true, format } : { ok: false, format, reason: 'missing PNG IEND terminator' };
    }
    case 'jpeg': {
      const ok = bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
      return ok ? { ok: true, format } : { ok: false, format, reason: 'missing JPEG EOI terminator' };
    }
    case 'webp': {
      // RIFF declares "everything after the 8-byte header". Chunks are padded
      // to even lengths, so a writer may leave one trailing pad byte the size
      // field does not count — hence the 1-byte tolerance, and only upward: a
      // file SHORTER than it claims is exactly the truncation being hunted.
      const declared = bytes.readUInt32LE(4) + 8;
      if (bytes.length < declared) {
        return { ok: false, format, reason: `truncated: RIFF declares ${declared}B, file is ${bytes.length}B` };
      }
      if (bytes.length > declared + 1) {
        return { ok: false, format, reason: `trailing garbage: RIFF declares ${declared}B, file is ${bytes.length}B` };
      }
      return { ok: true, format };
    }
    default:
      // We only ever write these three, so an unrecognised container means the
      // capture is not an image at all. Fail closed — the whole point of this
      // check is that the model must not reason about a frame we cannot vouch
      // for.
      return { ok: false, format, reason: 'no PNG/JPEG/WebP signature' };
  }
}
