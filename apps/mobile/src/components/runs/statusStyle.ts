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

export { needsAttention } from '../../services/api/runActivity';

export { isActive } from '../../services/api/runActivity';

export { isTerminal } from '../../services/api/runActivity';
