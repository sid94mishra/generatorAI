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
//   - miss = min(prev.promptTokens, promptTokens) - cacheReadTokens
//   - attributed to `idleMs` (if gap since last turn > 5 min) or `modelChanged`
//   - sticky `reportedCache` flag: providers that never report caching produce
//     no false positives — see `cacheReportLedger` below, which is what makes
//     the flag actually sticky rather than a read of the previous turn.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { UsageInfo } from '@/components/chat/redesign/types.js';

// ── Sticky `reportedCache` ledger ────────────────────────────────
//
// The flag has to survive turns. Derived per render from the immediately
// preceding turn it produced two wrong answers:
//
//   • a cache-WRITE turn reports 0 reads, so the genuine miss on the turn
//     after it was suppressed (false negative);
//   • a provider that demonstrated caching five turns ago was reclassified
//     as non-caching the moment any single turn reported 0 reads.
//
// Once a scope has shown that it caches, it caches. The evidence is monotonic
// and the ledger only ever grows, so there is nothing to invalidate.
//
// Scope is (session, provider): the same provider behaves the same way across
// a session, and two sessions on different providers must not contaminate
// each other. It is persisted so a reload does not restart the observation —
// the alternative is that the first turn after every refresh is unclassified.

const LEDGER_STORAGE_KEY = 'generatorai:usage:cacheCapableScopes';

function loadLedger(): Set<string> {
  try {
    const raw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

const cacheCapableScopes: Set<string> = typeof window === 'undefined' ? new Set() : loadLedger();

function persistLedger(): void {
  try {
    window.localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify([...cacheCapableScopes]));
  } catch {
    /* quota / private mode — the in-memory ledger still works for this tab */
  }
}

/** Ledger key for a turn. Falls back to the model when no provider is named. */
export function cacheScopeKey(sessionId: string | undefined, usage: UsageInfo): string {
  return `${sessionId ?? 'global'}::${usage.provider ?? usage.model}`;
}

/**
 * Record what a turn proved about its provider.
 *
 * A cache WRITE counts as proof exactly like a read: writing the cache is the
 * provider telling us it supports caching, and it is precisely the turn whose
 * successor's miss the old per-render check suppressed.
 */
export function noteCacheReport(scope: string, usage: UsageInfo | null | undefined): void {
  if (!usage) return;
  if ((usage.cacheReadTokens ?? 0) <= 0 && (usage.cacheWriteTokens ?? 0) <= 0) return;
  if (cacheCapableScopes.has(scope)) return;
  cacheCapableScopes.add(scope);
  persistLedger();
}

/** Has this (session, provider) ever reported prompt caching? */
export function hasReportedCache(scope: string): boolean {
  return cacheCapableScopes.has(scope);
}

/** Test-only: forget everything the ledger has observed. */
export function _resetCacheReportLedger(): void {
  cacheCapableScopes.clear();
  try {
    window.localStorage.removeItem(LEDGER_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// ── Miss computation ─────────────────────────────────────────────

/**
 * Prompt tokens actually sent this turn.
 *
 * `inputTokens` EXCLUDES cached tokens (Anthropic's `usage.input_tokens`
 * semantics, preserved end to end — see `contextTokensFromUsage`), so it is
 * NOT the prompt size the spec's `min(prev.promptTokens, promptTokens)` means.
 * Using it made the comparison meaningless: on a warm turn `inputTokens` is a
 * few hundred, so the minimum sat under the 1024-token noise floor and the
 * notice could essentially never fire.
 */
export function promptTokensOf(usage: UsageInfo): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/** Below this many tokens a "miss" is noise, not a cold cache. */
const NOISE_FLOOR = 1024;

/**
 * Compute the cache-miss token count for a turn.
 *
 * Returns 0 when:
 * - the provider has never reported cache usage (`reportedCache` false → no
 *   false positive on a provider that simply does not cache)
 * - miss is below the 1024-token noise floor
 * - there is no previous turn to compare against
 */
export function computeCacheMiss(
  usage: UsageInfo,
  prevUsage: UsageInfo | null | undefined,
  reportedCache: boolean,
): number {
  if (!reportedCache) return 0;
  if (!prevUsage) return 0;

  // miss = min(prev.promptTokens, promptTokens) - cacheReadTokens
  // A negative miss (more was read from cache than expected) clamps to 0.
  const expectedHit = Math.min(promptTokensOf(prevUsage), promptTokensOf(usage));
  const actualHit = usage.cacheReadTokens ?? 0;
  const miss = expectedHit - actualHit;
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

/**
 * Approximate cost of the missed tokens.
 *
 * KNOWN DEVIATION from §W30, which asks for the rate "actually paid" from the
 * message's own cost breakdown. The wire carries a single `costUsd` scalar for
 * the whole turn and no per-component breakdown, and `ChatModel.pricing` is
 * a credit-batch tier that no provider populates — so no exact input rate is
 * reachable from the client. What we can do honestly is divide the turn's cost
 * by EVERY token the provider billed for, cache tokens included; the previous
 * denominator (`inputTokens + outputTokens`) omitted the cache tokens that
 * `cost` already covers and so inflated the rate on exactly the cache-heavy
 * turns this notice is about.
 *
 * Returns null when the turn reports no cost, in which case the caller shows
 * the token count instead of a dollar figure.
 */
export function estimateMissCost(usage: UsageInfo, missTokens: number): number | null {
  if (!usage.costUsd || missTokens <= 0) return null;
  const billedTokens = promptTokensOf(usage) + usage.outputTokens;
  if (billedTokens <= 0) return null;
  return (usage.costUsd / billedTokens) * missTokens;
}

interface UsageChipProps {
  usage: UsageInfo;
  /** Previous turn's usage, used for the cache-miss notice. */
  prevUsage?: UsageInfo | null;
  /** When the previous turn completed (epoch ms) — used to detect idle > 5 min. */
  prevCompletedAt?: number | null;
  /**
   * Session (or stage stream key) this turn belongs to. Scopes the sticky
   * `reportedCache` ledger; without it every surface shares one global scope,
   * which is only correct for a single-session view.
   */
  scopeId?: string;
}

export function UsageChip({ usage, prevUsage, prevCompletedAt, scopeId }: UsageChipProps) {
  const scope = cacheScopeKey(scopeId, usage);
  // Recording during render rather than in an effect: the flag is needed by
  // THIS render, and the write is an idempotent set insertion, so a double
  // invocation under StrictMode is a no-op.
  noteCacheReport(scope, prevUsage);
  noteCacheReport(scope, usage);

  const missTokens = computeCacheMiss(usage, prevUsage, hasReportedCache(scope));
  const reason = missTokens > 0 ? cacheMissReason(usage, prevUsage, prevCompletedAt) : null;

  let missLabel: string | null = null;
  if (missTokens > 0) {
    const missCost = estimateMissCost(usage, missTokens);
    missLabel =
      missCost !== null
        ? `~$${missCost.toFixed(4)} cache miss`
        : `${(missTokens / 1000).toFixed(1)}k tokens uncached`;
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
      {/* Dollars only from `costUsd`: Copilot's `cost` is a premium-request multiplier. */}
      {usage.costUsd !== undefined && (
        <>
          <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
          <span title="Turn cost">${usage.costUsd.toFixed(4)}</span>
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
