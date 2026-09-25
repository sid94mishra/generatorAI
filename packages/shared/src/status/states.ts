// ────────────────────────────────────────────────────────────────
// The 8 visual status states (D-18, 02-design-system-spec.md §7.1).
//
// React-free and free of design-tokens imports: `glyph` is an icon concept id
// (checked against ICON_CONCEPTS by a web test), `tone` names a design colour
// token. The labels are the shared status copy (M-13); web and mobile render
// these words, never their own.
// ────────────────────────────────────────────────────────────────

export const STATUS_STATES = [
  'queued',
  'running',
  'waiting',
  'needs_you',
  'paused',
  'succeeded',
  'failed',
  'skipped',
] as const;
export type StatusState = (typeof STATUS_STATES)[number];

/** Design colour token used for the glyph (and the dense-row dot). */
export type StatusTone = 'fg-2' | 'fg-3' | 'run' | 'ok' | 'warn' | 'err';

/** Badge recipe: `idle` = `bg-selected text-fg-2`, the rest = `bg-<x>-bg text-<x>`. */
export type StatusBadgeTone = 'idle' | 'run' | 'ok' | 'warn' | 'err';

export interface StatusStateDef {
  /** Default word. Always shown next to the glyph (never colour alone). */
  label: string;
  /** Icon concept id (`packages/design-tokens` ICON_CONCEPTS). */
  glyph: `status-${string}`;
  tone: StatusTone;
  badge: StatusBadgeTone;
  /** The glyph spins (static under reduced motion). */
  spin: boolean;
}

export const STATUS_STATE_DEFS: Record<StatusState, StatusStateDef> = {
  queued: { label: 'Queued', glyph: 'status-queued', tone: 'fg-3', badge: 'idle', spin: false },
  running: { label: 'Running', glyph: 'status-running', tone: 'run', badge: 'run', spin: true },
  waiting: { label: 'Waiting', glyph: 'status-waiting', tone: 'fg-2', badge: 'idle', spin: false },
  needs_you: { label: 'Needs you', glyph: 'status-needs-you', tone: 'warn', badge: 'warn', spin: false },
  paused: { label: 'Paused', glyph: 'status-paused', tone: 'fg-2', badge: 'idle', spin: false },
  succeeded: { label: 'Succeeded', glyph: 'status-succeeded', tone: 'ok', badge: 'ok', spin: false },
  failed: { label: 'Failed', glyph: 'status-failed', tone: 'err', badge: 'err', spin: false },
  skipped: { label: 'Skipped', glyph: 'status-skipped', tone: 'fg-3', badge: 'idle', spin: false },
};

export function isStatusState(value: unknown): value is StatusState {
  return typeof value === 'string' && (STATUS_STATES as readonly string[]).includes(value);
}
