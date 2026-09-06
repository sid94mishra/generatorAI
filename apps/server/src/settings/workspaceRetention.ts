// ────────────────────────────────────────────────────────────────
// Workspace retention — "may the server delete my old run directories?"
//
// Modelled on `computerUse.ts`: a persisted setting the app can flip from
// Settings, defaulting to OFF.
//
// WHY THIS EXISTS
// ---------------
// Every chat and workflow run gets a directory under
// `<workspacesDir>/executions/<ownerId>`, and nothing has ever removed them.
// `WorkspaceManager.cleanupExpiredWorkspaces()` was written for exactly this
// job but was only ever reachable from `POST /api/workspaces/cleanup`, which
// means it ran when somebody remembered to call it. Measured on a developer
// machine after a few months: 1,136 directories, 6.3GB, growing by ~50 a day.
//
// WHY IT DEFAULTS TO OFF
// ----------------------
// This is the only setting in the product that deletes the user's files on a
// timer. A workspace holds whatever an agent produced — plans, artifacts,
// scratch code — and the app cannot tell "stale" from "the thing I was going
// to come back to". Defaulting it on would silently delete work for every
// existing install on upgrade. So it stays off until somebody reads the
// sentence and decides, exactly like Computer Use.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILE = 'workspace-retention.json';

/** Below this, a sweep would delete work from the session you just finished. */
export const MIN_RETENTION_DAYS = 1;
/** Above this the setting is indistinguishable from "off". */
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 30;

export interface WorkspaceRetentionPreferences {
  /** Opt-in. Nothing is ever deleted on a timer while this is false. */
  enabled: boolean;
  /** Untouched for this many days ⇒ eligible for deletion. */
  retentionDays: number;
}

export const WORKSPACE_RETENTION_DEFAULTS: WorkspaceRetentionPreferences = {
  enabled: false,
  retentionDays: DEFAULT_RETENTION_DAYS,
};

function stateFilePath(dataDir: string): string {
  return path.join(dataDir, STATE_FILE);
}

/**
 * Force `days` into the supported range.
 *
 * A non-finite or out-of-range value resolves to the default rather than
 * being clamped to the MINIMUM: clamping garbage to 1 day would turn a typo
 * (or a hand-edited state file) into the most destructive possible setting.
 */
export function clampRetentionDays(days: unknown): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  const whole = Math.floor(days);
  if (whole < MIN_RETENTION_DAYS || whole > MAX_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
  return whole;
}

/**
 * Read the persisted preferences.
 *
 * Anything unreadable or malformed resolves to DISABLED rather than throwing.
 * A corrupt settings file must never be able to start deleting directories —
 * the failure direction for this setting is "do nothing", always.
 */
export function readWorkspaceRetentionPreferences(dataDir: string): WorkspaceRetentionPreferences {
  try {
    const raw = fs.readFileSync(stateFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorkspaceRetentionPreferences> | null;
    return {
      enabled: parsed?.enabled === true,
      retentionDays: clampRetentionDays(parsed?.retentionDays),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...WORKSPACE_RETENTION_DEFAULTS };
    return { ...WORKSPACE_RETENTION_DEFAULTS };
  }
}

/** Persist the preferences. Applies to the next nightly sweep; no restart. */
export function writeWorkspaceRetentionPreferences(
  dataDir: string,
  prefs: WorkspaceRetentionPreferences,
): WorkspaceRetentionPreferences {
  const normalized: WorkspaceRetentionPreferences = {
    enabled: prefs.enabled === true,
    retentionDays: clampRetentionDays(prefs.retentionDays),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    stateFilePath(dataDir),
    `${JSON.stringify({ ...normalized, updatedAt: Date.now() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return normalized;
}
