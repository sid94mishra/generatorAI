// ────────────────────────────────────────────────────────────────
// W15 / P1-34 — ONE clamp.
//
// Before this, three independent clamps bounded the same two numbers with
// different limits and different NaN behaviour:
//   browser-ws.ts 20–95 / 5–30, ServerPlaywrightHost 20–95 / 1–15, and
//   routes/browser.ts a `Math.max(lo, Math.min(hi, Number(x)))` that returns
//   NaN for a NaN input rather than correcting it.
//
// These tests pin the numbers AND the NaN behaviour, because it was the NaN
// case that actually reached production: `Math.min(95, NaN) === NaN`.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  SCREENCAST_LIMITS,
  clampScreencastOptions,
  negotiateScreencastCodec,
} from '../screencastOptions.js';

describe('clampScreencastOptions', () => {
  it('passes through a value already inside the bounds', () => {
    expect(clampScreencastOptions({ fps: 20, quality: 60 })).toEqual({ fps: 20, quality: 60 });
  });

  it('clamps to the bounds rather than rejecting', () => {
    expect(clampScreencastOptions({ fps: 999, quality: 999 })).toEqual({
      fps: SCREENCAST_LIMITS.fps.max,
      quality: SCREENCAST_LIMITS.quality.max,
    });
    expect(clampScreencastOptions({ fps: -5, quality: 0 })).toEqual({
      fps: SCREENCAST_LIMITS.fps.min,
      quality: SCREENCAST_LIMITS.quality.min,
    });
  });

  it('corrects NaN to the default instead of propagating it', () => {
    // The regression: `Math.max(20, Math.min(95, NaN))` is NaN, so a mistyped
    // env var used to reach the encoder as NaN and produce no stream at all.
    const out = clampScreencastOptions({ fps: Number.NaN, quality: Number.NaN });
    expect(out).toEqual({ fps: SCREENCAST_LIMITS.fps.default, quality: SCREENCAST_LIMITS.quality.default });
    expect(Number.isNaN(out.fps)).toBe(false);
    expect(Number.isNaN(out.quality)).toBe(false);
  });

  it('corrects Infinity and non-numeric input the same way', () => {
    expect(clampScreencastOptions({ fps: Number.POSITIVE_INFINITY }).fps).toBe(SCREENCAST_LIMITS.fps.default);
    expect(clampScreencastOptions({ quality: 'sixty' as unknown as number }).quality)
      .toBe(SCREENCAST_LIMITS.quality.default);
  });

  it('defaults an entirely absent request', () => {
    expect(clampScreencastOptions(undefined)).toEqual({
      fps: SCREENCAST_LIMITS.fps.default,
      quality: SCREENCAST_LIMITS.quality.default,
    });
  });

  it('is idempotent, so calling it in more than one place is not a second clamp', () => {
    const once = clampScreencastOptions({ fps: 99, quality: 3 });
    expect(clampScreencastOptions(once)).toEqual(once);
  });

  it('accepts the whole documented range of GENERATORAI_BROWSER_STREAM_FPS', () => {
    // The bug this catches: browser-ws accepted up to 30 and the bridge then
    // silently cut it to 15, so the documented setting was half-honoured.
    for (const fps of [SCREENCAST_LIMITS.fps.min, 15, 25, SCREENCAST_LIMITS.fps.max]) {
      expect(clampScreencastOptions({ fps }).fps).toBe(fps);
    }
  });
});

describe('negotiateScreencastCodec', () => {
  it('honours the CLIENT preference order, not the bridge order', () => {
    // The client is the one that has to decode, so its order wins.
    expect(negotiateScreencastCodec(['jpeg', 'vp8'], ['vp8', 'jpeg'])).toBe('jpeg');
    expect(negotiateScreencastCodec(['vp8', 'jpeg'], ['vp8', 'jpeg'])).toBe('vp8');
  });

  it('falls back to jpeg when nothing intersects', () => {
    expect(negotiateScreencastCodec(['vp8'], ['jpeg'])).toBe('jpeg');
  });

  it('treats a missing or empty accept list as jpeg-only', () => {
    expect(negotiateScreencastCodec(undefined, ['vp8', 'jpeg'])).toBe('jpeg');
    expect(negotiateScreencastCodec([], ['vp8', 'jpeg'])).toBe('jpeg');
  });
});
