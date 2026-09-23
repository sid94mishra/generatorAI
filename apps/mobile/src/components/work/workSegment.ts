// ────────────────────────────────────────────────────────────────
// Work catalogues — Workflows, Scripts, Automations.
//
// One mounted scene renders whichever catalogue the navigation drawer asks
// for (`/runs?segment=workflows`). There is no "Runs" catalogue: as on desktop
// a run lives under its workflow, so a workflow's runs are on the workflow's
// own page and nowhere else. The scene shows no switcher of its own.
//
// Pure so the resolution rule can be tested without MMKV in the runner. The
// store itself is `src/storage/prefs.ts`; the key below is the one the last
// catalogue is saved under.
// ────────────────────────────────────────────────────────────────

export type WorkSegment = 'workflows' | 'automations' | 'scripts';

/** Desktop sidebar order. */
export const WORK_SEGMENTS: readonly WorkSegment[] = ['workflows', 'scripts', 'automations'];

export const WORK_SEGMENT_LABEL: Record<WorkSegment, string> = {
  workflows: 'Workflows',
  automations: 'Automations',
  scripts: 'Scripts',
};

/** The preference key the last-used catalogue is stored under. */
export const WORK_SEGMENT_PREF_KEY = 'work.segment';

export const DEFAULT_WORK_SEGMENT: WorkSegment = 'workflows';

export function isWorkSegment(value: unknown): value is WorkSegment {
  return typeof value === 'string' && (WORK_SEGMENTS as readonly string[]).includes(value);
}

/**
 * Which catalogue to open on.
 *
 * A route param (from the drawer, a back-fallback or a notification) beats the
 * remembered one; the remembered one beats the default. Anything unrecognised
 * falls through rather than throwing — including `runs`, which older builds
 * stored and older links carry: it lands on Workflows, where runs now live.
 */
export function resolveWorkSegment(
  param: string | string[] | undefined,
  stored: string | undefined,
): WorkSegment {
  const fromParam = Array.isArray(param) ? param[0] : param;
  if (isWorkSegment(fromParam)) return fromParam;
  if (fromParam === 'runs') return 'workflows';
  if (isWorkSegment(stored)) return stored;
  return DEFAULT_WORK_SEGMENT;
}
