// ────────────────────────────────────────────────────────────────
// screencastOptions — the ONE place screencast frame rate and quality are
// bounded (W15, P1-34 "one clamp").
//
// There used to be three, each with different numbers and different failure
// behaviour:
//
//   • `browser-ws.ts`  read the env vars through `readBoundedInt` (20–95 / 5–30)
//   • `ServerPlaywrightHost.screencast()` re-clamped to 20–95 / 1–15
//   • `routes/browser.ts` clamped again with `Math.max(lo, Math.min(hi, …))`
//
// Three clamps are worse than none, because they disagree: a user who set
// `GENERATORAI_BROWSER_STREAM_FPS=25` got a value the first clamp accepted, the
// second silently cut to 15, and no log said so — the documented setting was
// half-honoured, which is the hardest kind of configuration bug to see. They
// also disagreed on NaN: `Math.max(20, Math.min(95, NaN))` is `NaN`, so the
// route's clamp passed a typo straight through to the encoder.
//
// One pure function, one set of bounds. Callers may invoke it more than once
// (it is idempotent by construction — clamping a clamped value is a no-op);
// what must not exist again is a second set of *numbers*.
// ────────────────────────────────────────────────────────────────

import type { ScreencastCodec } from '../../domain/ports/IBrowserBridge.js';

/**
 * The bounds themselves, exported so the env readers in `browser-ws.ts` use
 * these numbers rather than repeating them. `readBoundedInt` needs min/max as
 * arguments, so "one clamp" has to mean one set of constants shared by the
 * clamp and by anything that pre-validates for it.
 */
export const SCREENCAST_LIMITS = {
  /** Frames per second requested of the capture source. */
  fps: { min: 1, max: 30, default: 20 },
  /**
   * JPEG quality of the CAPTURE, 0–100.
   *
   * This is the source quality even on the VP8 path: CDP's only frame tap is
   * JPEG, so the VP8 encoder is fed decoded JPEG. Dropping it below ~50 shows
   * up as ringing in the encoded stream too, which is why the floor is not 0.
   */
  quality: { min: 20, max: 95, default: 60 },
} as const;

export interface ScreencastOptions {
  fps: number;
  quality: number;
}

function clampInt(value: unknown, bounds: { min: number; max: number; default: number }): number {
  const n = Math.round(Number(value));
  // `Number.isFinite` first, deliberately: `Math.min`/`Math.max` propagate NaN
  // instead of correcting it, which is how a mistyped env var reached the
  // encoder as NaN and produced a stream that emitted nothing at all.
  if (!Number.isFinite(n)) return bounds.default;
  return Math.max(bounds.min, Math.min(bounds.max, n));
}

/** Normalise any caller-supplied fps/quality into the supported range. */
export function clampScreencastOptions(opts: Partial<ScreencastOptions> | undefined): ScreencastOptions {
  return {
    fps: clampInt(opts?.fps, SCREENCAST_LIMITS.fps),
    quality: clampInt(opts?.quality, SCREENCAST_LIMITS.quality),
  };
}

/**
 * Intersect a client's accept-list with what the bridge can produce, preserving
 * the CLIENT's preference order (the client is the one that has to decode).
 * Falls back to `jpeg` when nothing intersects, because every client that can
 * render a frame at all can render a JPEG — an empty result would leave the
 * caller with nothing to send and no way to say why.
 */
export function negotiateScreencastCodec(
  clientAccepts: readonly ScreencastCodec[] | undefined,
  bridgeCodecs: readonly ScreencastCodec[],
): ScreencastCodec {
  const accepts = clientAccepts && clientAccepts.length > 0 ? clientAccepts : (['jpeg'] as const);
  for (const codec of accepts) {
    if (bridgeCodecs.includes(codec)) return codec;
  }
  return 'jpeg';
}
