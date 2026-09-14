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
 * Directory behind a mount alias (nested `<alias>/<sub>` included), or null.
 *
 * `'.'` (and the empty alias) is the workspace's working directory — the
 * agent's cwd — which is how every client addresses "the main repo".
 */
export function mountDirFor(info: WorkspaceInfo, alias: string): string | null {
  if (!alias || alias === '.') return info.workingDirectory;
  const direct = (info.mounts ?? []).find((m) => m.alias === alias);
  if (direct) return direct.path;
  const slash = alias.indexOf('/');
  if (slash > 0) {
    const parent = (info.mounts ?? []).find((m) => m.alias === alias.slice(0, slash));
    if (parent) return path.join(parent.path, alias.slice(slash + 1));
  }
  return null;
}

/**
 * Every directory this workspace exposes to source control, primary first.
 *
 * Mounts come first and each keeps its own alias (`mounts[0]` is the agent's
 * cwd, and answering for it under `'.'` would lose the alias every other SCM
 * call needs). The working directory is appended only when it is not already
 * one of them. Duplicated paths are collapsed so a workspace that mounts the
 * same repo twice is not committed twice.
 */
export function scmMountTargets(info: WorkspaceInfo): ScmMountTarget[] {
  const out: ScmMountTarget[] = [];
  const seen = new Set<string>();
  for (const mount of info.mounts ?? []) {
    const key = path.resolve(mount.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ alias: mount.alias, dir: mount.path });
  }
  const rootKey = path.resolve(info.workingDirectory);
  if (!seen.has(rootKey)) out.push({ alias: '.', dir: info.workingDirectory });
  return out;
}
