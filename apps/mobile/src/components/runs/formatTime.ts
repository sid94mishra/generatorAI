// ────────────────────────────────────────────────────────────────
// Time formatting for run lists and timelines.
//
// Deliberately a plain .ts module, not part of the component file: these are
// pure functions with real edge cases, and keeping them here means they can
// be unit-tested without dragging React Native into the test runner.
//
// Also deliberately not `Intl.RelativeTimeFormat`: its output varies across
// Hermes versions and locales, so a run list would shift width on every
// re-render and snapshot tests would be untrustworthy.
//
// Every entry point takes a `Timestamp` (number OR ISO string) rather than a
// number, because ISO strings are what the server actually sends. Declaring
// `number` here produced NaN arithmetic that fell through to a bare date, so
// nothing ever rendered "2h ago".
// ────────────────────────────────────────────────────────────────

import { toEpochMs, type Timestamp } from '@generatorai/client-core';

/** Compact "how long ago", stable in width and wording. */
export function relativeTime(at: Timestamp | null | undefined, now = Date.now()): string {
  const ms = toEpochMs(at);
  if (ms === null) return 'not started';

  // A clock skew between phone and server can make `at` slightly future.
  // Showing "in 3 seconds" for a run that just started reads as a bug.
  const delta = Math.max(0, now - ms);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(ms).toLocaleDateString();
}

/** Elapsed duration for a run in flight, or a completed run's total. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * How long a run has been going, or ran for.
 *
 * Returns null when it never started, so callers can omit the element rather
 * than render a misleading "0s".
 *
 * `fallbackEnd` matters more than it looks: a run left PAUSED weeks ago has
 * no `completedAt`, so measuring to "now" reported `3109h 7m` — technically
 * true, and useless. Callers pass `updatedAt` for anything not actively
 * running so the number describes the work rather than the neglect.
 */
export function runElapsed(
  run: { startedAt?: Timestamp | null; completedAt?: Timestamp | null },
  fallbackEnd?: Timestamp | null,
  now = Date.now(),
): number | null {
  const started = toEpochMs(run.startedAt);
  if (started === null) return null;
  const ended = toEpochMs(run.completedAt) ?? toEpochMs(fallbackEnd) ?? now;
  return Math.max(0, ended - started);
}
