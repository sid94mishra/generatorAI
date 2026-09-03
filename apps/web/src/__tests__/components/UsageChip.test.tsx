// ────────────────────────────────────────────────────────────────
// UsageChip — W30 cache-miss notice.
//
// Two defects are pinned here:
//   • `reportedCache` was derived per render from the immediately preceding
//     turn, so a cache-WRITE turn suppressed the next turn's genuine miss and
//     one 0-read turn reclassified a caching provider as non-caching;
//   • the miss compared `inputTokens`, which EXCLUDES cached tokens, instead
//     of prompt tokens — which made the notice essentially unreachable.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UsageChip,
  cacheScopeKey,
  computeCacheMiss,
  estimateMissCost,
  hasReportedCache,
  noteCacheReport,
  promptTokensOf,
  _resetCacheReportLedger,
} from '@/components/agent/UsageChip.js';
import type { UsageInfo } from '@/components/chat/redesign/types.js';

afterEach(cleanup);
beforeEach(_resetCacheReportLedger);

function usage(over: Partial<UsageInfo> = {}): UsageInfo {
  return {
    model: 'claude-sonnet-4-6',
    inputTokens: 1_000,
    outputTokens: 500,
    durationMs: 4_000,
    provider: 'claude-agent',
    ...over,
  };
}

describe('promptTokensOf', () => {
  it('adds cached tokens back — inputTokens alone is not the prompt size', () => {
    expect(promptTokensOf(usage({ inputTokens: 200, cacheReadTokens: 48_000, cacheWriteTokens: 1_000 })))
      .toBe(49_200);
  });
});

describe('sticky reportedCache ledger', () => {
  it('a cache-WRITE turn counts as proof the provider caches', () => {
    const scope = cacheScopeKey('s1', usage());
    expect(hasReportedCache(scope)).toBe(false);
    noteCacheReport(scope, usage({ cacheWriteTokens: 40_000, cacheReadTokens: 0 }));
    expect(hasReportedCache(scope)).toBe(true);
  });

  it('does not leak across sessions or providers', () => {
    noteCacheReport(cacheScopeKey('s1', usage()), usage({ cacheReadTokens: 10 }));
    expect(hasReportedCache(cacheScopeKey('s2', usage()))).toBe(false);
    expect(hasReportedCache(cacheScopeKey('s1', usage({ provider: 'copilot' })))).toBe(false);
  });

  it('stays set once observed — a later 0-read turn does not unset it', () => {
    const scope = cacheScopeKey('s1', usage());
    noteCacheReport(scope, usage({ cacheReadTokens: 30_000 }));
    noteCacheReport(scope, usage({ cacheReadTokens: 0 }));
    expect(hasReportedCache(scope)).toBe(true);
  });
});

describe('computeCacheMiss', () => {
  const prev = usage({ inputTokens: 300, cacheReadTokens: 48_000 });
  const cold = usage({ inputTokens: 50_000, cacheReadTokens: 0 });

  it('reports the miss using prompt tokens, not uncached input tokens', () => {
    // min(48_300, 50_000) - 0
    expect(computeCacheMiss(cold, prev, true)).toBe(48_300);
  });

  it('is silent when the provider has never reported caching', () => {
    expect(computeCacheMiss(cold, prev, false)).toBe(0);
  });

  it('is silent below the 1024-token noise floor', () => {
    const small = usage({ inputTokens: 900, cacheReadTokens: 0 });
    expect(computeCacheMiss(small, usage({ inputTokens: 900 }), true)).toBe(0);
  });

  it('clamps a hit larger than expected to zero', () => {
    const warm = usage({ inputTokens: 200, cacheReadTokens: 60_000 });
    expect(computeCacheMiss(warm, prev, true)).toBe(0);
  });

  it('needs a previous turn to compare against', () => {
    expect(computeCacheMiss(cold, null, true)).toBe(0);
  });
});

describe('estimateMissCost', () => {
  it('prices against every token the turn was billed for, cache included', () => {
    const u = usage({ inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 8_000, cost: 0.1 });
    // 10_000 billed tokens → 0.00001/token.
    expect(estimateMissCost(u, 2_000)).toBeCloseTo(0.02, 6);
  });

  it('returns null when the turn reports no cost', () => {
    expect(estimateMissCost(usage(), 5_000)).toBeNull();
  });
});

describe('UsageChip rendering', () => {
  it('shows the miss on the turn after a cache WRITE — the false negative', () => {
    // Turn 1 wrote the cache and read nothing. Under the old per-render check
    // this suppressed turn 2's notice entirely.
    const write = usage({ inputTokens: 50_000, cacheWriteTokens: 50_000, cacheReadTokens: 0 });
    const missTurn = usage({ inputTokens: 50_000, cacheReadTokens: 0, model: 'claude-opus-4-5' });

    render(<UsageChip usage={missTurn} prevUsage={write} scopeId="s1" />);
    expect(screen.getByTitle(/model changed between turns/i)).toBeTruthy();
  });

  it('says nothing for a provider that has never reported caching', () => {
    const a = usage({ inputTokens: 50_000 });
    const b = usage({ inputTokens: 50_000 });
    render(<UsageChip usage={b} prevUsage={a} scopeId="s-nocache" />);
    expect(screen.queryByText(/cache miss/i)).toBeNull();
    expect(screen.queryByText(/tokens uncached/i)).toBeNull();
  });
});
