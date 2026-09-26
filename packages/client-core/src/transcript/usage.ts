// ────────────────────────────────────────────────────────────────
// Turn usage — the pure half of the usage chip (W30 cache-miss notice).
// Moved from apps/web components/agent/UsageChip.tsx in P4-07; the sticky
// per-scope `reportedCache` ledger (browser storage) stays on the web side.
//
//   - 5 min TTL: only report a miss that could have been a hit within 5 min
//   - 1024-token noise floor
//   - miss = min(prev.promptTokens, promptTokens) - cacheReadTokens
//   - attributed to `idleMs` (gap > 5 min) or `modelChanged`
// ────────────────────────────────────────────────────────────────

import type { UsageInfo } from './types.js';

/**
 * Prompt tokens actually sent this turn. `inputTokens` EXCLUDES cached tokens
 * (Anthropic's `usage.input_tokens` semantics), so it is not the prompt size.
 */
export function promptTokensOf(usage: UsageInfo): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/** Below this many tokens a "miss" is noise, not a cold cache. */
export const CACHE_MISS_NOISE_FLOOR = 1024;

/** Prompt-cache TTL the miss attribution assumes. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The cache-miss token count for a turn; 0 when the provider never reported
 * caching, when there is no previous turn, or below the noise floor.
 */
export function computeCacheMiss(
  usage: UsageInfo,
  prevUsage: UsageInfo | null | undefined,
  reportedCache: boolean,
): number {
  if (!reportedCache) return 0;
  if (!prevUsage) return 0;
  const expectedHit = Math.min(promptTokensOf(prevUsage), promptTokensOf(usage));
  const actualHit = usage.cacheReadTokens ?? 0;
  const miss = expectedHit - actualHit;
  return miss >= CACHE_MISS_NOISE_FLOOR ? miss : 0;
}

/** Why did the cache miss? */
export function cacheMissReason(
  usage: UsageInfo,
  prevUsage?: UsageInfo | null,
  prevCompletedAt?: number | null,
  now: number = Date.now(),
): 'idleMs' | 'modelChanged' | null {
  if (prevUsage && usage.model !== prevUsage.model) return 'modelChanged';
  if (prevCompletedAt && now - prevCompletedAt > CACHE_TTL_MS) return 'idleMs';
  return null;
}

/**
 * Approximate cost of the missed tokens: the turn's cost divided by every
 * token billed (cache included). Null when the turn reports no cost.
 */
export function estimateMissCost(usage: UsageInfo, missTokens: number): number | null {
  if (!usage.cost || missTokens <= 0) return null;
  const billedTokens = promptTokensOf(usage) + usage.outputTokens;
  if (billedTokens <= 0) return null;
  return (usage.cost / billedTokens) * missTokens;
}

/** Duration text for step rows and turn summaries ("850ms", "4.2s", "2m 44s"); null under 50 ms. */
export function formatStepDuration(ms?: number): string | null {
  if (!ms || ms < 50) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
