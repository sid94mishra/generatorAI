// ────────────────────────────────────────────────────────────────
// workspaceMounts — "which directories of this workspace can git act on?"
// ────────────────────────────────────────────────────────────────
//
// The SCM routes (`apps/server/src/routes/workspaces.ts`) resolve a mount
// alias to a directory with exactly this logic. Agent-native mode (doc §5)
// runs the same flow from inside core, after a turn rather than from a
// request, so the resolution lives here and the route mirrors it — one
// definition of "alias → repoDir", not two that drift.

import * as path from 'node:path';
import type { WorkspaceInfo } from '@generatorai/shared';

/** One git target: the alias every other SCM call names it by, and its path. */
export interface ScmMountTarget {
  alias: string;
  dir: string;
}

/**
 * Directory behind a mount alias, or null.
 *
 * `'.'` (and the empty alias) is the workspace's working directory — the
 * agent's cwd — which is how every client addresses "the main repo". A
 * repository inside a mount is `<alias>/<path>`, and only the ones the mount
 * lists are answered: anything else (`<alias>/../x`) is not a repository of
 * this workspace.
 */
export function mountDirFor(info: WorkspaceInfo, alias: string): string | null {
  if (!alias || alias === '.') return info.workingDirectory;
  const direct = (info.mounts ?? []).find((m) => m.alias === alias);
  if (direct) return direct.path;
  const slash = alias.indexOf('/');
  if (slash > 0) {
    const parent = (info.mounts ?? []).find((m) => m.alias === alias.slice(0, slash));
    const rel = alias.slice(slash + 1);
    if (parent?.git?.nested?.includes(rel)) return path.join(parent.path, ...rel.split('/'));
  }
  return null;
}

/**
 * Every directory this workspace exposes to source control, primary first:
 * each mount, then the repositories inside it (`<alias>/<path>`) — each its own
 * commit, push and pull request.
 *
 * Mounts keep their own alias (`mounts[0]` is the agent's cwd, and answering
 * for it under `'.'` would lose the alias every other SCM call needs). The
 * working directory is appended only when it is not already one of them.
 * Duplicated paths are collapsed so a workspace that mounts the same repo
 * twice is not committed twice.
 */
export function scmMountTargets(info: WorkspaceInfo): ScmMountTarget[] {
  const out: ScmMountTarget[] = [];
  const seen = new Set<string>();
  const add = (alias: string, dir: string) => {
    const key = path.resolve(dir);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ alias, dir });
  };
  for (const mount of [...(info.mounts ?? [])].filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position)) {
    add(mount.alias, mount.path);
    for (const rel of mount.git?.nested ?? []) add(`${mount.alias}/${rel}`, path.join(mount.path, ...rel.split('/')));
  }
  const rootKey = path.resolve(info.workingDirectory);
  if (!seen.has(rootKey)) out.push({ alias: '.', dir: info.workingDirectory });
  return out;
}

/**
 * The order to commit several targets in: a repository before the one that
 * contains it, so a parent that tracks it as a submodule commits the new
 * pointer, not the old one.
 */
export function commitOrder<T extends { dir: string }>(targets: readonly T[]): T[] {
  // Deeper first is enough: a repository inside another always has the longer path. Ties keep their order.
  const depth = (dir: string) => path.resolve(dir).split(path.sep).length;
  return targets
    .map((t, i) => ({ t, i, d: depth(t.dir) }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .map(({ t }) => t);
}
