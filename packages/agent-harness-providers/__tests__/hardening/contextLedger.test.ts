// ────────────────────────────────────────────────────────────────
// W13 — append-only context invariant + the four-breakpoint cache scheme.
//
// The cache semantics asserted here are Anthropic's, not invented:
// prompt caching is a PREFIX match; at most FOUR `cache_control` breakpoints
// per request; the minimum cacheable prefix is model-dependent (512 tokens on
// Claude Opus 5 / Fable 5, 1024 on Opus 4.8 / Sonnet 5 / Sonnet 4.6, 2048 on
// Opus 4.7, 4096 on Opus 4.6 / Haiku 4.5) and a shorter prefix silently does
// not cache at all.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  AppendOnlyContext,
  ContextInvariantError,
  MAX_CACHE_BREAKPOINTS,
  cacheMinPrefixTokens,
  DEFAULT_CACHE_MIN_PREFIX_TOKENS,
  type ContextRecord,
} from '../../src/hardening/contextLedger.js';

const rec = (id: string, text: string): ContextRecord => ({ id, text });
/** Enough characters to clear the 512-token minimum at 4 chars/token. */
const bulk = (id: string, tokens = 600) => rec(id, `${id}:${'x'.repeat(tokens * 4)}`);

describe('W13 — append-only context invariant', () => {
  it('accepts a context that only grew', () => {
    const ctx = new AppendOnlyContext();
    ctx.append(rec('sys', 'system'));
    ctx.append(rec('u1', 'hello'));
    expect(() =>
      ctx.assertPrefixOf([rec('sys', 'system'), rec('u1', 'hello'), rec('a1', 'hi')]),
    ).not.toThrow();
  });

  it('REJECTS a rewritten record, naming it', () => {
    const ctx = new AppendOnlyContext();
    ctx.append(rec('sys', 'system'));
    ctx.append(rec('u1', 'hello'));
    try {
      ctx.assertPrefixOf([rec('sys', 'system'), rec('u1', 'hello (edited)')]);
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(ContextInvariantError);
      expect((err as ContextInvariantError).index).toBe(1);
      expect((err as Error).message).toContain('"u1"');
      expect((err as Error).message).toMatch(/prefix match/);
    }
  });

  it('REJECTS a one-byte change in the system prompt, which is the expensive case', () => {
    const ctx = new AppendOnlyContext();
    ctx.append(rec('sys', 'You are a helpful assistant.'));
    ctx.append(rec('u1', 'hi'));
    // A "current date:" line, a UUID, a re-serialised tool list — all of them
    // land here, and all of them cost full price on the entire conversation
    // for the rest of its life, silently.
    expect(() =>
      ctx.assertPrefixOf([rec('sys', 'You are a helpful assistant. '), rec('u1', 'hi')]),
    ).toThrow(ContextInvariantError);
  });

  it('REJECTS a shrunk context', () => {
    const ctx = new AppendOnlyContext();
    ctx.append(rec('a', '1'));
    ctx.append(rec('b', '2'));
    expect(() => ctx.assertPrefixOf([rec('a', '1')])).toThrow(/Context shrank/);
  });

  it('REJECTS a reordered context even when the same records are present', () => {
    const ctx = new AppendOnlyContext();
    ctx.append(rec('a', '1'));
    ctx.append(rec('b', '2'));
    expect(() => ctx.assertPrefixOf([rec('b', '2'), rec('a', '1')])).toThrow(ContextInvariantError);
  });

  it('append() is the only mutator and returns the new index', () => {
    const ctx = new AppendOnlyContext();
    expect(ctx.append(rec('a', '1'))).toBe(0);
    expect(ctx.append(rec('b', '2'))).toBe(1);
    expect(ctx.length).toBe(2);
    expect(ctx.renderPrefix(1)).toBe('12');
  });
});

describe('W13 — the four-breakpoint cache scheme', () => {
  it('knows the API limit is four', () => {
    expect(MAX_CACHE_BREAKPOINTS).toBe(4);
  });

  it('never exceeds four breakpoints however many turns are rolled', () => {
    const ctx = new AppendOnlyContext({ model: 'claude-opus-5' });
    ctx.append(bulk('tools-and-system'));
    ctx.pin(0, 0, 'tools+system');
    ctx.append(bulk('docs'));
    ctx.pin(1, 1, 'stable prefix');

    for (let turn = 0; turn < 25; turn++) {
      const i = ctx.append(bulk(`turn-${turn}`, 100));
      ctx.roll(i, `turn ${turn}`);
      expect(ctx.activeBreakpoints().length).toBeLessThanOrEqual(MAX_CACHE_BREAKPOINTS);
    }
    expect(ctx.activeBreakpoints()).toHaveLength(4);
  });

  it('ALTERNATES the two rolling slots so the older one survives as a read point', () => {
    const ctx = new AppendOnlyContext({ model: 'claude-opus-5' });
    ctx.append(bulk('base'));
    const a = ctx.roll(ctx.append(bulk('t1', 100)), 't1');
    const b = ctx.roll(ctx.append(bulk('t2', 100)), 't2');
    const c = ctx.roll(ctx.append(bulk('t3', 100)), 't3');

    expect(a?.slot).toBe(2);
    expect(b?.slot).toBe(3);
    expect(c?.slot).toBe(2); // reuses slot 2, retiring t1 — never a pinned slot

    // After three rolls the request still carries a marker at t2's prefix,
    // which the PREVIOUS request wrote. That is the read hit. With a single
    // rolling breakpoint there would be no marker at any previously-written
    // position, and every turn would pay a full cache write.
    const active = ctx.activeBreakpoints();
    expect(active.map((bp) => bp.label).sort()).toEqual(['t2', 't3']);
  });

  it('never retires a PINNED slot', () => {
    const ctx = new AppendOnlyContext({ model: 'claude-opus-5' });
    ctx.append(bulk('sys'));
    ctx.pin(0, 0, 'tools+system');
    ctx.append(bulk('docs'));
    ctx.pin(1, 1, 'docs');
    for (let i = 0; i < 10; i++) ctx.roll(ctx.append(bulk(`t${i}`, 100)), `t${i}`);

    const pinned = ctx.activeBreakpoints().filter((bp) => bp.pinned);
    expect(pinned.map((bp) => bp.label)).toEqual(['tools+system', 'docs']);
  });

  it('returns breakpoints in prompt order', () => {
    const ctx = new AppendOnlyContext({ model: 'claude-opus-5' });
    ctx.append(bulk('sys'));
    ctx.pin(0, 0, 'sys');
    const i1 = ctx.append(bulk('t1', 100));
    const i2 = ctx.append(bulk('t2', 100));
    ctx.roll(i1, 't1');
    ctx.roll(i2, 't2');
    const idx = ctx.activeBreakpoints().map((bp) => bp.index);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('REFUSES a breakpoint on a prefix too short to cache', () => {
    const ctx = new AppendOnlyContext({ model: 'claude-opus-5' }); // 512-token minimum
    ctx.append(rec('tiny', 'hello'));
    // Placing a marker here would pay the cache-write premium for zero reads.
    expect(ctx.pin(0, 0, 'too short')).toBeUndefined();
    expect(ctx.roll(0, 'too short')).toBeUndefined();
    expect(ctx.activeBreakpoints()).toHaveLength(0);
  });

  it('uses the model-specific minimum, which is NOT monotonic across generations', () => {
    expect(cacheMinPrefixTokens('claude-opus-5')).toBe(512);
    expect(cacheMinPrefixTokens('claude-opus-4-8')).toBe(1024);
    expect(cacheMinPrefixTokens('claude-opus-4-7')).toBe(2048);
    // Newer generation, LARGER minimum: a 3K-token prompt caches on Opus 5 and
    // silently does not on Opus 4.6.
    expect(cacheMinPrefixTokens('claude-opus-4-6')).toBe(4096);
    expect(cacheMinPrefixTokens('claude-haiku-4-5')).toBe(4096);
  });

  it('falls back to the LARGEST minimum for an unknown model', () => {
    // Fail-closed: guessing 512 for an unknown model would place markers that
    // silently never cache.
    expect(cacheMinPrefixTokens('some-future-model')).toBe(DEFAULT_CACHE_MIN_PREFIX_TOKENS);
    expect(cacheMinPrefixTokens(undefined)).toBe(4096);
  });

  it('rejects a breakpoint index outside the context', () => {
    const ctx = new AppendOnlyContext({ model: 'claude-opus-5' });
    ctx.append(bulk('a'));
    expect(() => ctx.pin(0, 5, 'nope')).toThrow(RangeError);
    expect(() => ctx.roll(-1, 'nope')).toThrow(RangeError);
  });
});
