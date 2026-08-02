// ────────────────────────────────────────────────────────────────
// safePath — filesystem path hardening utilities (SEC-05)
//
// `path.resolve` alone does NOT follow symlinks, so an attacker-planted
// symlink inside `baseDir` could escape it. These helpers use `fs.realpath`
// so containment checks reflect the actual on-disk target.
//
// Audit (SEC-05, Phase 3) — behaviour confirmed:
//   - `resolveWithinBase` realpath-resolves BOTH base AND target, so a
//     symlink that points out of the base fails the prefix check.
//   - Non-existent targets (e.g. "file we're about to create") walk up to
//     the deepest existing ancestor, realpath that, and re-join the tail.
//     Without this walk, `fs.realpath(joinedPath)` throws ENOENT and a
//     naive fallback to `path.resolve` would miss symlinks in the ancestor
//     chain.
//   - Windows & case-insensitive FS: `path.sep` is `\\` on Windows, which
//     is correctly used for the boundary check. `fs.realpath` returns the
//     canonical casing, so both `realBase` and `realTarget` match the
//     on-disk case. Mixed-case user input is normalised through `realpath`.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Resolve `userPath` relative to `baseDir` and guarantee the real target
 * stays within `baseDir` even across symlinks.
 *
 * For non-existent targets (e.g. writing a new file), walks up to the
 * deepest existing ancestor, resolves that with realpath, and re-joins
 * the remaining tail.
 *
 * @returns the canonical absolute path on success, or `null` if the
 * target escapes the base (traversal or symlink escape).
 */
export async function resolveWithinBase(
  baseDir: string,
  userPath: string,
): Promise<string | null> {
  const realBase = await fs.realpath(baseDir).catch(() => path.resolve(baseDir));
  const joined = path.resolve(baseDir, userPath);

  let realTarget: string;
  try {
    realTarget = await fs.realpath(joined);
  } catch {
    let ancestor = joined;
    const tail: string[] = [];
    for (let i = 0; i < 64; i += 1) {
      try {
        ancestor = await fs.realpath(ancestor);
        break;
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        tail.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    realTarget = tail.length > 0 ? path.join(ancestor, ...tail) : ancestor;
  }

  const sep = path.sep;
  if (realTarget !== realBase && !realTarget.startsWith(realBase + sep)) {
    return null;
  }
  return realTarget;
}

/** Return true if `p` is a symbolic link (swallows ENOENT). */
export async function isSymlink(p: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(p);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}
