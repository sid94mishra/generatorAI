// ────────────────────────────────────────────────────────────────
// changePaths — one definition of "how a changed file is named in the chat".
//
// The provider reports absolute paths (`C:\…\executions\<chat>\source\todo-api\src\x.js`);
// the Changes tab names the same file `todo-api/src/x.js` (repo alias + repo-relative
// path, alias `.` for the workspace root). Every surface that shows a changed file
// in the transcript — the per-op chips, the end-of-turn summary, the composer tray —
// goes through `toDisplayPath` so a click in one lands on the same row in the other.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';
import type { ToolFileOp } from '@generatorai/client-core';

/** Managed workspaces live at `…/workspaces/executions/<ownerId>/`. */
const EXECUTION_MARKER = '/workspaces/executions/';
/** Legacy layout: linked codebases were checked out under `source/<alias>/`. */
const SOURCE_PREFIX = 'source/';

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * One mounted directory, as the naming layer needs it: where it lives on
 * disk and what the chat calls it.
 */
export interface MountRoot {
  alias: string;
  path: string;
}

/** A bare string root is a mount with no alias (legacy local-folder chats). */
export type PathRoot = MountRoot | string;

function asMountRoot(root: PathRoot): MountRoot {
  return typeof root === 'string' ? { alias: '', path: root } : root;
}

/**
 * The chat's mounts, in workspace order, so an absolute path the agent
 * reported can be named the way the Changes tab names it. Provided by the
 * page via `PathRootsContext` from `GET /api/workspaces/:id` (`mounts`).
 */
export const PathRootsContext = createContext<readonly PathRoot[]>([]);
export function usePathRoots(): readonly PathRoot[] {
  return useContext(PathRootsContext);
}

/**
 * Should a displayed path carry its mount alias?
 *
 * Only when there is more than one mount. With a single mount the alias is
 * the same word on every row — pure noise that also makes the path wrong to
 * copy into a terminal.
 */
export function shouldPrefixAlias(mountCount: number): boolean {
  return mountCount > 1;
}

/**
 * `<alias>/<path>` or `<path>`, by the rule above. The workspace root
 * (alias `.`) is never prefixed.
 */
export function withAliasPrefix(alias: string, path: string, multi: boolean): string {
  if (!multi || !alias || alias === '.') return path;
  return `${alias}/${path}`;
}

/**
 * Display path for a file the agent touched, in the Changes tab's own naming.
 *
 * The mounts are the authority: a path under a mount is that mount's
 * repo-relative path, prefixed with the alias only when the chat has more
 * than one mount. The managed-workspace and last-three-segments rules below
 * are fallbacks for chats whose mounts we have not loaded (or that predate
 * them).
 *
 *   <mount todo-api>/src/a.js  (2 mounts)  → todo-api/src/a.js
 *   <mount todo-api>/src/a.js  (1 mount)   → src/a.js
 *   …/executions/<id>/notes.md             → notes.md
 *   anything else                          → last three segments
 */
export function toDisplayPath(raw: string, roots: readonly PathRoot[] = []): string {
  const norm = normalizeSlashes(raw);
  const lower = norm.toLowerCase();
  const mounts = roots.map(asMountRoot).filter((m) => m.path);
  const multi = shouldPrefixAlias(mounts.length);
  // Longest root first: a nested mount (`repo/packages/ui`) must win over the
  // parent it sits inside, or every one of its files is named after the parent.
  const ordered = [...mounts].sort(
    (a, b) => normalizeSlashes(b.path).length - normalizeSlashes(a.path).length,
  );
  for (const mount of ordered) {
    const r = normalizeSlashes(mount.path).replace(/\/+$/, '');
    if (!r) continue;
    if (lower.startsWith(`${r.toLowerCase()}/`)) {
      return withAliasPrefix(mount.alias, norm.slice(r.length + 1), multi);
    }
  }
  const i = norm.indexOf(EXECUTION_MARKER);
  if (i !== -1) {
    const rest = norm.slice(i + EXECUTION_MARKER.length);
    const slash = rest.indexOf('/');
    if (slash !== -1) {
      const inside = rest.slice(slash + 1);
      return inside.startsWith(SOURCE_PREFIX) ? inside.slice(SOURCE_PREFIX.length) : inside;
    }
  }
  if (!/^([a-z]:)?\//i.test(norm)) return norm; // already relative
  const parts = norm.split('/').filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join('/') : parts.join('/');
}

/**
 * Whether a path the agent reported is code the Changes tab lists: inside one of the chat's mounts, or relative
 * (relative paths resolve against the working directory, the primary mount). With no mounts loaded every path counts.
 * Workspace scaffolding outside the mounts — the plan file under `plans/`, scratch notes — is hidden from the change
 * counts the same way `splitWorkspaceChanges` hides it from the tab.
 */
export function isInMount(raw: string, roots: readonly PathRoot[] = []): boolean {
  const mounts = roots.map(asMountRoot).filter((m) => m.path);
  if (mounts.length === 0) return true;
  const norm = normalizeSlashes(raw);
  if (!/^([a-z]:)?\//i.test(norm)) return true;
  const lower = norm.toLowerCase();
  return mounts.some((m) => {
    const r = normalizeSlashes(m.path).replace(/\/+$/, '').toLowerCase();
    return r !== '' && (lower === r || lower.startsWith(`${r}/`));
  });
}

/**
 * An absolute path for a repo-relative file inside a mount, in the mount's
 * own separator style (a Windows mount path gets `\`, everything else `/`).
 * Hands "Open in editor" a real path on the server host.
 */
export function joinPath(dir: string, relative: string): string {
  if (!dir) return relative;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const trimmed = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${relative.replace(/^[\\/]+/, '')}`;
}

export type ChangeStatusLetter = 'A' | 'M' | 'D' | 'R';

export function statusFromOpKind(kind: ToolFileOp['kind']): ChangeStatusLetter {
  if (kind === 'create') return 'A';
  if (kind === 'delete') return 'D';
  return 'M';
}
