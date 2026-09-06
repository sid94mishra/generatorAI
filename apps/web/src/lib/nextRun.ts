// ────────────────────────────────────────────────────────────────
// formatNextRun — when a scheduled automation fires next.
//
// The automation pages showed the cron expression and the LAST run, so the
// one question an operator actually asks — "is this still going to fire, and
// when?" — had no answer on screen, even though the scheduler has stored
// `nextRunAt` all along (review 6.x / E11). A disabled automation, or one
// whose cron no longer produces a slot, has no next run at all, and saying so
// plainly is the point: a blank field reads as "loading", not "never".
// ────────────────────────────────────────────────────────────────

/** Absolute wall-clock time, in the viewer's own locale and zone. */
function absolute(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A coarse "in 5 min" / "in 3 h" lead-in. Deliberately coarse: the exact
 * second is noise, and the absolute time is shown beside it anyway.
 */
function relative(deltaMs: number): string | null {
  if (deltaMs <= 0) return 'due now';
  const mins = Math.round(deltaMs / 60_000);
  if (mins < 1) return 'in under a minute';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

export interface NextRunDisplay {
  /** Short form for a dense list row, e.g. `in 5 min`. */
  short: string;
  /** Full form for a detail card, e.g. `in 5 min · Sep 4, 09:00`. */
  full: string;
  /** True when nothing is scheduled, so callers can tone it down. */
  none: boolean;
}

export function formatNextRun(
  nextRunAt: Date | string | null | undefined,
  opts: { enabled?: boolean } = {},
): NextRunDisplay {
  if (opts.enabled === false) {
    return { short: 'Paused', full: 'Paused — no runs scheduled', none: true };
  }
  if (!nextRunAt) {
    return { short: 'Not scheduled', full: 'Not scheduled', none: true };
  }
  const d = typeof nextRunAt === 'string' ? new Date(nextRunAt) : nextRunAt;
  if (Number.isNaN(d.getTime())) {
    return { short: 'Not scheduled', full: 'Not scheduled', none: true };
  }
  const rel = relative(d.getTime() - Date.now());
  const abs = absolute(d);
  return { short: rel ?? abs, full: rel ? `${rel} · ${abs}` : abs, none: false };
}
