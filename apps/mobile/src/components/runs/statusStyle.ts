import { runStatus, runStatusTone } from '../../theme/status';
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

const TONE_STYLES = {
  neutral: ['bg-subtle', 'text-muted-foreground'],
  info: ['bg-info-muted', 'text-info'],
  warning: ['bg-warning-muted', 'text-warning'],
  success: ['bg-success-muted', 'text-success'],
  danger: ['bg-danger-muted', 'text-danger'],
} as const;

export function statusStyle(status: AnyRunStatus): StatusStyle {
  return TONE_STYLES[runStatusTone(status)];
}

export function statusLabel(status: AnyRunStatus): string {
  return runStatus(status)?.label ?? (status ? status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Unknown');
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
  return ACTIVE.has(status);
}

const ACTIVE: ReadonlySet<string> = new Set([
  'ready',
  'starting',
  'running',
  'validating',
  'retry_wait',
  'finalizing',
]);

/** Statuses that will never change again without an explicit action. */
export function isTerminal(status: AnyRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';
}
