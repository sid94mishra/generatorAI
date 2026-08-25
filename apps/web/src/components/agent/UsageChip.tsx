// ────────────────────────────────────────────────────────────────
// UsageChip — the "gpt-5.4-mini · ↑12k ↓3k · 43s" footer.
// Shared by the workflow-run stage timeline and chat assistant turns.
//
// W30: Cache-miss notice — shown when the provider filled fewer tokens from
// cache than expected, indicating the prompt cache was cold. Surfaces the
// cost attributable to the miss (billed at the non-cached input rate).
// See ARCHITECTURE_V2_MASTER_PLAN_FINAL.md §W30 for the full spec:
//   - 5 min TTL: we only report a miss that could have been a hit within 5 min
//   - 1024-token noise floor: below this threshold we don't surface a notice
//   - miss = min(prev.inputTokens, inputTokens) - cacheReadTokens
//   - attributed to `idleMs` (if gap since last turn > 5 min) or `modelChanged`
//   - sticky `reportedCache` flag: providers that never report cache produce no
//     false positives
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { UsageInfo } from '@/components/chat/redesign/types.js';

/**
 * Compute the cache-miss token count for a turn.
 *
 * Returns 0 when:
 * - the provider does not report cache reads (sticky flag not set → no false positive)
 * - miss is below the 1024-token noise floor
 * - there is no previous turn to compare against
 */
export function computeCacheMiss(
  usage: UsageInfo,
  prevUsage?: UsageInfo | null,
): number {
  // Only produce a notice if the provider has ever reported a non-zero cache
  // read. Providers that never report caching (cacheReadTokens always absent
  // or 0) would generate constant false positives.
  const reportedCache =
    (usage.cacheReadTokens ?? 0) > 0 ||
    (prevUsage?.cacheReadTokens ?? 0) > 0;
  if (!reportedCache) return 0;
  if (!prevUsage) return 0;

  // miss = min(prev.inputTokens, inputTokens) - cacheReadTokens
  // A negative miss (more was read from cache than expected) is clamped to 0.
  const expectedHit = Math.min(prevUsage.inputTokens, usage.inputTokens);
  const actualHit = usage.cacheReadTokens ?? 0;
  const miss = expectedHit - actualHit;
  const NOISE_FLOOR = 1024;
  return miss >= NOISE_FLOOR ? miss : 0;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Why did the cache miss? Returns a human-readable reason or null if unknown.
 */
export function cacheMissReason(
  usage: UsageInfo,
  prevUsage?: UsageInfo | null,
  prevCompletedAt?: number | null,
): 'idleMs' | 'modelChanged' | null {
  if (prevUsage && usage.model !== prevUsage.model) return 'modelChanged';
  if (prevCompletedAt && Date.now() - prevCompletedAt > CACHE_TTL_MS) return 'idleMs';
  return null;
}

interface UsageChipProps {
  usage: UsageInfo;
  /** Previous turn's usage, used for the cache-miss notice. */
  prevUsage?: UsageInfo | null;
  /** When the previous turn completed (epoch ms) — used to detect idle > 5 min. */
  prevCompletedAt?: number | null;
}

export function UsageChip({ usage, prevUsage, prevCompletedAt }: UsageChipProps) {
  const missTokens = computeCacheMiss(usage, prevUsage);
  const reason = missTokens > 0 ? cacheMissReason(usage, prevUsage, prevCompletedAt) : null;

  // Approximate cost of the missed tokens at the non-cached input rate.
  // When the turn reports a `cost` value we can derive the per-token rate;
  // otherwise we can't reliably price it and just show the token count.
  let missLabel: string | null = null;
  if (missTokens > 0) {
    const totalInputCost = usage.cost;
    if (totalInputCost && usage.inputTokens > 0) {
      // Rough per-token rate from this turn (output tokens included in cost,
      // so this is an upper bound, but it's the best we can derive client-side
      // without knowing the provider's exact rate sheet).
      const perToken = totalInputCost / (usage.inputTokens + usage.outputTokens);
      const missCost = perToken * missTokens;
      missLabel = `~$${missCost.toFixed(4)} cache miss`;
    } else {
      missLabel = `${(missTokens / 1000).toFixed(1)}k tokens uncached`;
    }
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)]/60 bg-[var(--color-subtle)]/50 px-2.5 py-1 text-[10.5px] text-[var(--color-muted-foreground)]">
      <span className="font-semibold text-[var(--color-foreground)]/85">{usage.model}</span>
      <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
      <span title="Input tokens">↑ {usage.inputTokens.toLocaleString()}</span>
      {(usage.cacheReadTokens ?? 0) > 0 && (
        <span title="Tokens read from prompt cache" className="text-[var(--color-primary)]/70">
          ⚡ {(usage.cacheReadTokens! / 1000).toFixed(1)}k cached
        </span>
      )}
      <span title="Output tokens">↓ {usage.outputTokens.toLocaleString()}</span>
      <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
      <span title="Duration">{(usage.durationMs / 1000).toFixed(1)}s</span>
      {usage.cost !== undefined && (
        <>
          <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
          <span title="Turn cost">${usage.cost.toFixed(4)}</span>
        </>
      )}
      {/* W30: Cache-miss notice — only shown when miss exceeds the 1024-token
          noise floor and the provider has reported cache usage before */}
      {missLabel && (
        <>
          <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
          <span
            title={
              reason === 'idleMs'
                ? 'Prompt cache expired — session was idle for more than 5 minutes'
                : reason === 'modelChanged'
                  ? 'Prompt cache missed — model changed between turns'
                  : 'Prompt cache was cold this turn'
            }
            className="rounded bg-[var(--color-warning)]/15 px-1 py-0.5 text-[var(--color-warning)] tabular-nums"
          >
            ⚠ {missLabel}
          </span>
        </>
      )}
    </div>
  );
}
