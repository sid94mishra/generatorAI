// ────────────────────────────────────────────────────────────────
// globFiles — a tiny glob for the repo's invariant-checker scripts.
//
// Why this exists: the checkers used `globSync` from `node:fs`, which landed
// in **Node 22**. CI pins `node-version: 20` and `package.json` declares
// `engines.node: ">=20"`, so on CI every one of those scripts died with a
// link-time `SyntaxError` before its first rule ran — and because they sit in
// the root `lint` script's `&&` chain, the chain failed at the first one and
// none of them ever executed. That is the same failure mode as CI calling
// `turbo lint` (which skipped the composite script entirely): a guard that
// cannot run is indistinguishable from a guard that passes.
//
// `readdirSync(dir, { recursive: true })` is available from Node 20.1, so this
// works on the declared floor. Deliberately supports only the subset of glob
// syntax the checkers actually use — `**`, `*`, and `{a,b}` alternation —
// because a checker's matcher should be boring and auditable, not general.
// ────────────────────────────────────────────────────────────────

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Directories never worth walking. Skipped for speed, not correctness. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-bundle', 'dist-electron', '.turbo']);

/**
 * Translate the supported glob subset into a RegExp anchored at both ends.
 *
 * Order matters: `**` must be consumed before `*`, and every literal
 * regex-significant character must be escaped first so a `.` in `*.ts` cannot
 * match an arbitrary character.
 */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more path segments; a trailing `**` matches
        // the rest of the path including separators.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close > i) {
        const alts = glob.slice(i + 1, close).split(',');
        out += `(?:${alts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
        i = close;
        continue;
      }
    }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * Files under `cwd` matching `glob`, as repo-relative POSIX paths.
 *
 * Returns `[]` for a glob that matches nothing — callers that treat an empty
 * result as "rule satisfied" must check for it themselves, since a renamed
 * file would otherwise silently disable a rule.
 */
export function globFiles(glob, cwd) {
  const re = globToRegExp(glob);
  const out = [];

  // A manual walk, NOT `readdirSync(cwd, { recursive: true })`.
  //
  // The recursive option enumerates everything and only then lets you filter,
  // so on a pnpm monorepo it walks several hundred thousand `node_modules`
  // entries per glob — the first version of this file did exactly that and
  // took long enough to look like a hang. Recursing manually lets the skip
  // list PRUNE, which is the whole difference: the walk never descends into a
  // directory it is going to discard.
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory is not a match; it is also not an error.
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(join(absDir, e.name), rel);
      } else if (e.isFile() && re.test(rel)) {
        out.push(rel);
      }
    }
  };

  walk(cwd, '');
  return out;
}
