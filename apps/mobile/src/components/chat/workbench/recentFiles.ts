// ────────────────────────────────────────────────────────────────
// Recent files — the last few files opened in a workspace's Files browser.
//
// A breadcrumb browser costs a tap per folder level; the file you opened a
// minute ago should cost one. Kept per workspace on the device (MMKV via the
// prefs façade, like the composer's draft keys), newest first, de-duplicated
// by alias + path, capped at RECENT_FILES_MAX.
//
// Pure except for the two storage helpers at the bottom, which take the
// storage as a parameter so the tests need no MMKV.
// ────────────────────────────────────────────────────────────────

export const RECENT_FILES_MAX = 8;
export const RECENT_FILES_KEY_PREFIX = 'workbench.recentFiles.';

export interface RecentFile {
  path: string;
  alias: string;
  /** Epoch ms of the last open. */
  at: number;
}

export function recentFilesKey(workspaceId: string): string {
  return `${RECENT_FILES_KEY_PREFIX}${workspaceId}`;
}

/** Move (or add) `entry` to the front, keeping at most `max`. */
export function pushRecentFile(list: readonly RecentFile[], entry: RecentFile, max = RECENT_FILES_MAX): RecentFile[] {
  const rest = list.filter((r) => !(r.path === entry.path && r.alias === entry.alias));
  return [entry, ...rest].slice(0, Math.max(0, max));
}

/** Tolerant parse: anything malformed is dropped, never thrown. */
export function parseRecentFiles(raw: string | undefined | null): RecentFile[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: RecentFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['path'] !== 'string' || !r['path'] || typeof r['alias'] !== 'string') continue;
    out.push({ path: r['path'], alias: r['alias'], at: typeof r['at'] === 'number' ? r['at'] : 0 });
  }
  return out.slice(0, RECENT_FILES_MAX);
}

/**
 * The recents that still exist in the listed tree, for one repo. A file
 * deleted since it was opened must not be offered as a dead row.
 */
export function visibleRecentFiles(
  list: readonly RecentFile[],
  alias: string | undefined,
  paths: readonly string[],
): RecentFile[] {
  if (!alias) return [];
  const present = new Set(paths);
  return list.filter((r) => r.alias === alias && present.has(r.path));
}

export interface StringStorage {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
}

export function readRecentFiles(storage: StringStorage, workspaceId: string): RecentFile[] {
  return parseRecentFiles(storage.getString(recentFilesKey(workspaceId)));
}

export function recordRecentFile(storage: StringStorage, workspaceId: string, entry: RecentFile): RecentFile[] {
  const next = pushRecentFile(readRecentFiles(storage, workspaceId), entry);
  storage.setString(recentFilesKey(workspaceId), JSON.stringify(next));
  return next;
}
