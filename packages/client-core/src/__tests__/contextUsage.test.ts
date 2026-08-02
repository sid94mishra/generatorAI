// ────────────────────────────────────────────────────────────────
// contextUsage resolution tests.
//
// The composer's model picker and the context gauge must agree, because
// disagreeing (264K in the picker vs 200K in the gauge) is exactly the bug
// this module exists to prevent.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  contextTokensFromUsage,
  formatPctLabel,
  formatTokens,
  resolveContextUsage,
  resolveModelLimit,
} from '../stream/contextUsage.js';

describe('resolveModelLimit', () => {
  it('prefers the prompt budget over the advertised total', () => {
    expect(
      resolveModelLimit({ promptTokenLimit: 200_000, totalContextWindow: 264_000 }),
    ).toBe(200_000);
  });

  it('returns the long tier when that tier is selected', () => {
    const model = {
      promptTokenLimit: 200_000,
      longContext: { promptTokenLimit: 936_000 },
      contextWindow: 1_000_000,
    };
    expect(resolveModelLimit(model, 'default')).toBe(200_000);
    expect(resolveModelLimit(model, 'long_context')).toBe(936_000);
  });

  it('treats a zero window as unknown', () => {
    // Copilot's `auto` model reports 0. `??` would pass that straight through
    // and pin the gauge at 0% forever.
    expect(resolveModelLimit({ contextWindow: 0 })).toBeNull();
    expect(resolveModelLimit(null)).toBeNull();
  });

  it('falls back to legacy fields for older servers', () => {
    expect(resolveModelLimit({ standardContextWindow: 128_000 })).toBe(128_000);
  });
});

describe('contextTokensFromUsage', () => {
  it('adds Anthropic cache buckets back into the input total', () => {
    expect(
      contextTokensFromUsage({
        model: 'x',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 40_000,
        cacheWriteTokens: 5_000,
      }),
    ).toBe(45_100);
  });
});

describe('resolveContextUsage', () => {
  const model = { promptTokenLimit: 200_000, totalContextWindow: 264_000 };

  it('uses the provider snapshot over the turn usage', () => {
    const r = resolveContextUsage({
      snapshot: { source: 'provider', currentTokens: 50_000, promptTokenLimit: 200_000 },
      usage: { model: 'x', inputTokens: 1, outputTokens: 1 },
      model,
    });
    expect(r.used).toBe(50_000);
    expect(r.limit).toBe(200_000);
    expect(r.source).toBe('provider');
    expect(r.pct).toBeCloseTo(0.25);
    expect(r.remaining).toBe(150_000);
  });

  it("lets the provider's runtime limit override the catalog's", () => {
    // The session may have negotiated the long-context tier.
    const r = resolveContextUsage({
      snapshot: { source: 'provider', currentTokens: 10, promptTokenLimit: 936_000 },
      model,
    });
    expect(r.limit).toBe(936_000);
  });

  it('falls back to turn usage when no snapshot exists', () => {
    const r = resolveContextUsage({
      usage: { model: 'x', inputTokens: 1_000, outputTokens: 10, cacheReadTokens: 9_000 },
      model,
    });
    expect(r.used).toBe(10_000);
    expect(r.source).toBe('turn-usage');
    expect(r.limit).toBe(200_000);
  });

  it('reports unknown rather than inventing a window', () => {
    const r = resolveContextUsage({ usage: { model: 'x', inputTokens: 500, outputTokens: 5 } });
    expect(r.used).toBe(500);
    expect(r.limit).toBeNull();
    expect(r.pct).toBeNull();
  });

  it('has nothing to show before the first response', () => {
    const r = resolveContextUsage({ model });
    expect(r.used).toBeNull();
    expect(r.pct).toBeNull();
    expect(r.source).toBe('none');
  });

  it('allows the value to drop after compaction', () => {
    const before = resolveContextUsage({
      snapshot: { source: 'provider', currentTokens: 180_000, promptTokenLimit: 200_000 },
      model,
    });
    const after = resolveContextUsage({
      snapshot: { source: 'provider', currentTokens: 22_000, promptTokenLimit: 200_000 },
      model,
    });
    expect(before.pct!).toBeGreaterThan(after.pct!);
    expect(after.used).toBe(22_000);
  });

  it('clamps an over-full window to 100%', () => {
    const r = resolveContextUsage({
      snapshot: { source: 'provider', currentTokens: 250_000, promptTokenLimit: 200_000 },
    });
    expect(r.pct).toBe(1);
    expect(r.remaining).toBe(0);
  });
});

describe('formatting', () => {
  it('formats token counts compactly', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(200_000)).toBe('200k');
    expect(formatTokens(1_000_000)).toBe('1.00M');
  });

  it('labels sub-1% without rounding it away', () => {
    expect(formatPctLabel(null)).toBe('—');
    expect(formatPctLabel(0)).toBe('0');
    expect(formatPctLabel(0.004)).toBe('<1');
    expect(formatPctLabel(0.42)).toBe('42');
  });
});
