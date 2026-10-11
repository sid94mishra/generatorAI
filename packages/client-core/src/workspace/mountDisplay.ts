// ────────────────────────────────────────────────────────────────
// What a workspace mount means to the person reading it (D-135).
//
// A mount row is the server's truth about a directory the agent may edit, but
// two of its fields are internal and read as something they are not:
//   • a chat with NO sources gets a `generated` mount — an empty managed
//     folder at `<workspace>/source/main`, `git init -b main`-ed so checkpoints
//     work. Its alias "main" and branch "main" look like a linked repository.
//   • a worktree's `path` sits in the app's data directory, not the user's
//     project.
// Every surface that names a mount (composer Sources chip and popover, the
// chat header's branch chip, the Files dock's Sources list, mobile) reads it
// through `describeMount`, so none of them shows the managed folder as a repo
// or an app-data path as the user's folder.
// ────────────────────────────────────────────────────────────────

import type { WorkspaceMount } from '@generatorai/shared';

/**
 * empty     — no sources: the agent builds in an empty folder the chat owns.
 * chat      — that folder once it holds files (D-141): "Chat folder", kept
 *             beside any folder the user links later.
 * folder    — the user's plain folder, edited in place.
 * repo      — the user's git repository, edited in place on its own branch.
 * worktree  — an isolated git worktree cut from the user's repo (or a project
 *             codebase), on a branch of its own.
 */
export type MountDisplayKind = 'empty' | 'chat' | 'folder' | 'repo' | 'worktree';

export interface MountDisplay {
  kind: MountDisplayKind;
  /** "Empty workspace", else the mount's alias. */
  label: string;
  /** The branch the agent works on — only for a repository the user linked. */
  branch?: string;
  /** "In place" / "Worktree"; absent for the empty workspace. */
  modeLabel?: string;
  /**
   * A path the user recognises as THEIRS: the folder edited in place, or the
   * repository a worktree was cut from. Never a managed (app-data) directory;
   * absent when there is none (empty workspace, a project codebase's clone).
   */
  userPath?: string;
  /** One sentence: what the agent works in. */
  detail: string;
}

export const EMPTY_WORKSPACE_LABEL = 'Empty workspace';
export const CHAT_FOLDER_LABEL = 'Chat folder';

type MountLike = Pick<WorkspaceMount, 'alias' | 'mode' | 'originKind' | 'path'> &
  Partial<Pick<WorkspaceMount, 'originPath' | 'git' | 'fileCount'>>;

export function describeMount(mount: MountLike): MountDisplay {
  if (mount.mode === 'generated') {
    const files = mount.fileCount ?? 0;
    if (files > 0) {
      return {
        kind: 'chat',
        label: CHAT_FOLDER_LABEL,
        detail: `${files >= 1000 ? '1000+' : files} file${files === 1 ? '' : 's'} the agent made in this chat. They stay when you link a folder.`,
      };
    }
    return {
      kind: 'empty',
      label: EMPTY_WORKSPACE_LABEL,
      detail: 'Nothing linked yet. The agent works in an empty folder of its own — use Edit sources to add your folder.',
    };
  }
  const branch = mount.git?.isRepo ? mount.git.branch : undefined;
  if (mount.mode === 'worktree') {
    // A folder's origin is the user's repo; a codebase's may be the app's clone of a remote.
    const userPath = mount.originKind === 'folder' ? mount.originPath : undefined;
    return {
      kind: 'worktree',
      label: mount.alias,
      ...(branch ? { branch } : {}),
      modeLabel: 'Worktree',
      ...(userPath ? { userPath } : {}),
      detail: userPath
        ? 'An isolated worktree of your repository, on its own branch; your checkout is left alone.'
        : 'An isolated worktree of the project codebase, on its own branch.',
    };
  }
  // in-place: the directory the agent edits IS the user's folder.
  const isRepo = mount.git?.isRepo === true;
  return {
    kind: isRepo ? 'repo' : 'folder',
    label: mount.alias,
    ...(branch ? { branch } : {}),
    modeLabel: 'In place',
    userPath: mount.path,
    detail: isRepo ? 'Your repository, edited where it lives.' : 'Your folder, edited where it lives. Not a git repository.',
  };
}

/**
 * The tail of a server path within `budget` characters, keeping the path's
 * own separator (a Windows server's `C:\src\app` stays backslashed). The last
 * segment always survives — it names the folder; earlier ones are added while
 * they fit. Show the full path in a tooltip and copy it whole.
 */
export function pathTail(p: string, budget = 48): string {
  if (p.length <= budget) return p;
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return p;
  const kept: string[] = [parts[parts.length - 1]!];
  let length = kept[0]!.length + 2;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const next = parts[i]!;
    if (length + next.length + 1 > budget) break;
    kept.unshift(next);
    length += next.length + 1;
  }
  return `…${sep}${kept.join(sep)}`;
}
