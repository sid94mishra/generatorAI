// ────────────────────────────────────────────────────────────────
// useTicker — re-renders on a fixed interval while `active` is true.
// Used by the mission-control dashboard to drive live elapsed timers
// for *multiple* in-flight runs at once (the workflowRunStore's
// `elapsedMs` only tracks the single currently-open run).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

/** Returns a `Date.now()` value that updates every `intervalMs` while active. */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** Format a duration in ms as a compact `1h 05m` / `12m 34s` / `45s` string. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
