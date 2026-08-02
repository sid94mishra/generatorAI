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
}

/**
 * The entries directly under `prefix`.
 *
 * Directories are listed first, then files, each alphabetically — the
 * convention every file browser uses, and the one that makes "keep tapping
 * down" predictable.
 */
export function levelEntries(paths: readonly string[], prefix: string): TreeEntry[] {
  const dirs = new Set<string>();
  const files: TreeEntry[] = [];

  for (const path of paths) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = prefix ? path.slice(prefix.length) : path;
    if (!rest) continue;

    const slash = rest.indexOf('/');
    if (slash === -1) files.push({ name: rest, path, isDir: false });
    else dirs.add(rest.slice(0, slash));
  }

  return [
    ...[...dirs]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, path: `${prefix}${name}/`, isDir: true })),
    ...files.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

/** Breadcrumb segments for a prefix. Empty at the repository root. */
export function crumbsFor(prefix: string): string[] {
  return prefix ? prefix.split('/').filter(Boolean) : [];
}
