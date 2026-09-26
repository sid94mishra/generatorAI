// ────────────────────────────────────────────────────────────────
// UsageChip — "model · ↑12,034 ↓3,210 · 43.1s · $0.0213" for a finished turn
// (B-15 "usage chip on hover"), with the W30 cache-miss notice.
//
// The miss arithmetic is client-core's (`computeCacheMiss` …). What stays
// here is the sticky per-(session, provider) `reportedCache` ledger: once a
// scope has shown it caches, it caches — persisted so a reload does not
// restart the observation (a cache-WRITE turn reports 0 reads, and reading the
// flag off the previous turn alone produced false negatives).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import {
  cacheMissReason,
  computeCacheMiss,
  estimateMissCost,
  type UsageInfo,
} from '@generatorai/client-core';
import { cn } from '@/ui/lib/cn.js';

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

/** Record what a turn proved about its provider (a cache WRITE counts like a read). */
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

export interface UsageChipProps extends Omit<ComponentProps<'div'>, 'children'> {
  usage: UsageInfo;
  /** Previous turn's usage, for the cache-miss notice. */
  prevUsage?: UsageInfo | null;
  /** When the previous turn completed (epoch ms) — idle > 5 min attribution. */
  prevCompletedAt?: number | null;
  /** Session (or stage stream key) the turn belongs to — scopes the ledger. */
  scopeId?: string | undefined;
}

const MISS_TITLE = {
  idleMs: 'Prompt cache expired — session was idle for more than 5 minutes',
  modelChanged: 'Prompt cache missed — model changed between turns',
  none: 'Prompt cache was cold this turn',
} as const;

/** One finished turn's model, tokens, duration and cost. */
export function UsageChip({ usage, prevUsage, prevCompletedAt, scopeId, className, ...rest }: UsageChipProps) {
  const scope = cacheScopeKey(scopeId, usage);
  // Recording during render: the flag is needed by THIS render, and the write
  // is an idempotent set insertion (a StrictMode double render is a no-op).
  noteCacheReport(scope, prevUsage);
  noteCacheReport(scope, usage);

  const missTokens = computeCacheMiss(usage, prevUsage, hasReportedCache(scope));
  const reason = missTokens > 0 ? cacheMissReason(usage, prevUsage, prevCompletedAt) : null;
  let missLabel: string | null = null;
  if (missTokens > 0) {
    const missCost = estimateMissCost(usage, missTokens);
    missLabel = missCost !== null ? `~$${missCost.toFixed(4)} cache miss` : `${(missTokens / 1000).toFixed(1)}k tokens uncached`;
  }
  const sep = <span aria-hidden className="text-fg-3">·</span>;

  return (
    <div
      className={cn('inline-flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-micro text-fg-3', className)}
      data-testid="usage-chip"
      {...rest}
    >
      <span className="font-sans text-small font-medium text-fg-2">{usage.model}</span>
      {sep}
      <span title="Input tokens">↑ {usage.inputTokens.toLocaleString()}</span>
      {(usage.cacheReadTokens ?? 0) > 0 ? (
        <span title="Tokens read from prompt cache">{((usage.cacheReadTokens ?? 0) / 1000).toFixed(1)}k cached</span>
      ) : null}
      <span title="Output tokens">↓ {usage.outputTokens.toLocaleString()}</span>
      {sep}
      <span title="Duration">{(usage.durationMs / 1000).toFixed(1)}s</span>
      {/* Dollars only from `costUsd`: Copilot's `cost` is a premium-request multiplier. */}
      {usage.costUsd !== undefined ? (
        <>
          {sep}
          <span title="Turn cost">${usage.costUsd.toFixed(4)}</span>
        </>
      ) : null}
      {missLabel ? (
        <>
          {sep}
          <span title={MISS_TITLE[reason ?? 'none']} className="rounded-badge bg-warn-bg px-1 text-warn">
            {missLabel}
          </span>
        </>
      ) : null}
    </div>
  );
}
