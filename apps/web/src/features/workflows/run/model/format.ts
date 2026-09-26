// ────────────────────────────────────────────────────────────────
// Run-page number formatting (WF-06 BudgetMeter, the usage panel, the
// stage history). Dollars are only ever what a provider reported — there is
// no pricing table, so nothing here is an estimate (D-35, D-81).
// ────────────────────────────────────────────────────────────────

import type { RunUsage } from '@generatorai/shared';

/** A count for dense rows: 950, 12.3k, 1.2M. */
export function compactCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** A dollar amount as a provider reported it. */
export function formatUsd(n: number): string {
  return `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
}

/** A duration for the run clock and wall-clock budgets: 42s, 3m 07s, 1h 05m. */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A finished stage's duration, or null under half a second (noise). */
export function formatStageDuration(ms: number | undefined): string | null {
  if (!ms || ms < 500) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/** `formatDuration` to the nearest second, with an em dash for an unknown span. */
export function formatMs(ms: number | undefined): string {
  return ms === undefined ? '—' : formatDuration(Math.round(ms / 1000) * 1000);
}

/** Milliseconds between two timestamps, or undefined when either is missing. */
export function spanMs(start: Date | string | number | undefined, end: Date | string | number | undefined): number | undefined {
  if (start === undefined || end === undefined) return undefined;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** A usage record's numbers (`StageRun.usage` is untyped JSON). */
export function usageNumbers(usage: Record<string, unknown> | RunUsage | undefined): RunUsage {
  const out: RunUsage = {};
  for (const k of ['turns', 'costUsd', 'inputTokens', 'outputTokens', 'toolCalls'] as const) {
    const v = (usage as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** A numeric budget limit, or undefined when the budget does not set it. */
export function limitOf(budget: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = budget?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
