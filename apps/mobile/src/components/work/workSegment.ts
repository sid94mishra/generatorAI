// ────────────────────────────────────────────────────────────────
// Work tab segments — the peer catalogues and their persistence.
//
// Pure so the "which segment did I leave this on" rule can be tested
// without MMKV in the runner. The store itself is `src/storage/prefs.ts`,
// which has a generic string API; the key below is the one it is saved
// under.
// ────────────────────────────────────────────────────────────────

export type WorkSegment = 'workflows' | 'runs' | 'automations';

/**
 * `scripts` was a fourth segment whose only content was "Scripts are
 * coming". Because the last-used segment is remembered, the Work tab could
 * OPEN on a permanent placeholder — a destination that can never have
 * content, sitting in primary navigation. It comes back when the listing
 * does; `resolveWorkSegment` already discards an unknown stored value, so a
 * phone left on `scripts` lands on Runs.
 */
export const WORK_SEGMENTS: readonly WorkSegment[] = ['workflows', 'runs', 'automations'];

export const WORK_SEGMENT_LABEL: Record<WorkSegment, string> = {
  workflows: 'Workflows',
  runs: 'Runs',
  automations: 'Automations',
};

/** The preference key the last-used segment is stored under. */
export const WORK_SEGMENT_PREF_KEY = 'work.segment';

export const DEFAULT_WORK_SEGMENT: WorkSegment = 'runs';

export function isWorkSegment(value: unknown): value is WorkSegment {
  return typeof value === 'string' && (WORK_SEGMENTS as readonly string[]).includes(value);
}

/**
 * Which segment to open on.
 *
 * A route param (`/runs?segment=workflows`, from Home's quick action or a
 * notification) beats the remembered one; the remembered one beats the
 * default. Anything unrecognised falls through rather than throwing, so a
 * stale preference from an older build cannot strand the tab.
 */
export function resolveWorkSegment(
  param: string | string[] | undefined,
  stored: string | undefined,
): WorkSegment {
  const fromParam = Array.isArray(param) ? param[0] : param;
  if (isWorkSegment(fromParam)) return fromParam;
  if (isWorkSegment(stored)) return stored;
  return DEFAULT_WORK_SEGMENT;
}
