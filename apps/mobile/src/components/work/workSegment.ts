// ────────────────────────────────────────────────────────────────
// Work tab segments — the peer catalogues and their persistence.
//
// Pure so the "which segment did I leave this on" rule can be tested
// without MMKV in the runner. The store itself is `src/storage/prefs.ts`,
// which has a generic string API; the key below is the one it is saved
// under.
// ────────────────────────────────────────────────────────────────

export type WorkSegment = 'workflows' | 'runs' | 'automations' | 'scripts';

/**
 * `scripts` was once removed because its only content was "Scripts are
 * coming" and a remembered segment could OPEN the tab on a placeholder. It
 * is back now that it lists real scripts (`GET /workflow-scripts`) and each
 * opens a detail screen that can run it. Last, because it is the least used.
 */
export const WORK_SEGMENTS: readonly WorkSegment[] = ['workflows', 'runs', 'automations', 'scripts'];

export const WORK_SEGMENT_LABEL: Record<WorkSegment, string> = {
  workflows: 'Workflows',
  runs: 'Runs',
  automations: 'Automations',
  scripts: 'Scripts',
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
