// ────────────────────────────────────────────────────────────────
// Status → colour + label mapping.
//
// Pure data, kept out of the component file so it is testable without React
// Native, and so a single lookup table serves pills, timeline rails and the
// activity feed rather than each inventing its own.
//
// Status colour is SEMANTIC: it comes from the status tokens (success /
// warning / danger / info), which are deliberately NOT accent-controlled.
// "Failed" must read as failure whatever accent the user picked.
// ────────────────────────────────────────────────────────────────

export type AnyRunStatus = string;

/** [background class, foreground class] */
export type StatusStyle = readonly [string, string];

const STYLES: Record<string, StatusStyle> = {
  running: ['bg-info-muted', 'text-info'],
  starting: ['bg-info-muted', 'text-info'],

  queued: ['bg-subtle', 'text-muted-foreground'],
  pending: ['bg-subtle', 'text-muted-foreground'],
  created: ['bg-subtle', 'text-muted-foreground'],
  cancelled: ['bg-subtle', 'text-muted-foreground'],
  skipped: ['bg-subtle', 'text-muted-foreground'],

  paused: ['bg-warning-muted', 'text-warning'],
  awaiting_input: ['bg-warning-muted', 'text-warning'],

  completed: ['bg-success-muted', 'text-success'],
  failed: ['bg-danger-muted', 'text-danger'],
};

const FALLBACK: StatusStyle = ['bg-subtle', 'text-muted-foreground'];

export function statusStyle(status: AnyRunStatus): StatusStyle {
  return STYLES[status] ?? FALLBACK;
}

/** Statuses whose wire name is not what a person should read. */
const LABELS: Record<string, string> = {
  awaiting_input: 'Needs you',
};

export function statusLabel(status: AnyRunStatus): string {
  const override = LABELS[status];
  if (override) return override;
  if (!status) return 'Unknown';
  // `changes_requested` → `Changes requested`
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Statuses that require a human before anything else happens.
 *
 * This drives the "Needs attention" grouping — the single most valuable thing
 * a phone can surface, because a blocked run costs nothing to unblock but
 * stalls everything downstream until someone notices.
 */
export function needsAttention(status: AnyRunStatus): boolean {
  return status === 'paused' || status === 'awaiting_input' || status === 'failed';
}

/** Statuses that are still in flight. */
export function isActive(status: AnyRunStatus): boolean {
  return status === 'running' || status === 'starting' || status === 'queued';
}

/** Statuses that will never change again without an explicit action. */
export function isTerminal(status: AnyRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';
}
