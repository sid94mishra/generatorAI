// ────────────────────────────────────────────────────────────────
// Flat path list → one directory level.
//
// The server serves a workspace as a flat, sorted list of repo-relative
// paths. A tree widget spends most of a phone's width on indentation, so the
// Files browser walks ONE level at a time with a breadcrumb instead.
//
// Pure, and deliberately in its own module rather than inside the component:
// the folding rules have real edge cases (nested prefixes, files and folders
// at the same level) and testing them must not require React Native.
// ────────────────────────────────────────────────────────────────

export interface TreeEntry {
  /** Display name at this level — NOT the full path. */
  name: string;
  /** Full path for a file; the prefix (with trailing slash) for a folder. */
  path: string;
  isDir: boolean;
  /** Folders only: how many files live under this prefix. */
  count?: number;
}

/**
 * The entries directly under `prefix`.
 *
 * Directories are listed first, then files, each alphabetically — the
 * convention every file browser uses, and the one that makes "keep tapping
 * down" predictable.
 */
export function levelEntries(paths: readonly string[], prefix: string): TreeEntry[] {
  const dirs = new Map<string, number>();
  const files: TreeEntry[] = [];

  for (const path of paths) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = prefix ? path.slice(prefix.length) : path;
    if (!rest) continue;

    const slash = rest.indexOf('/');
    if (slash === -1) files.push({ name: rest, path, isDir: false });
    else {
      const name = rest.slice(0, slash);
      dirs.set(name, (dirs.get(name) ?? 0) + 1);
    }
  }

  return [
    ...[...dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, path: `${prefix}${name}/`, isDir: true, count })),
    ...files.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

/** Breadcrumb segments for a prefix. Empty at the repository root. */
export function crumbsFor(prefix: string): string[] {
  return prefix ? prefix.split('/').filter(Boolean) : [];
}

/** The prefix one level up: `a/b/` → `a/`, `a/` → ``. */
export function parentPrefix(prefix: string): string {
  const crumbs = crumbsFor(prefix);
  return crumbs.length <= 1 ? '' : `${crumbs.slice(0, -1).join('/')}/`;
}

/** The folder prefix that contains `path`: `a/b/c.ts` → `a/b/`. */
export function prefixOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
}

/**
 * Search-in-tree: every path containing `query` (case-insensitive), ranked
 * so a match in the file NAME beats a match in a parent folder, then by
 * position, then by length — the shortest exact-name hit floats first.
 */
export function searchEntries(paths: readonly string[], query: string, limit = 200): TreeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ entry: TreeEntry; score: number }> = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const at = lower.indexOf(q);
    if (at === -1) continue;
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    const nameAt = name.indexOf(q);
    const score = (nameAt === -1 ? 1_000_000 : nameAt * 1_000) + path.length;
    scored.push({ entry: { name: path, path, isDir: false }, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, limit)
    .map((s) => s.entry);
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);

export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXT.has(path.slice(dot + 1).toLowerCase());
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}
