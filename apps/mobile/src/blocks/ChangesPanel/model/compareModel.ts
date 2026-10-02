// The Changes tab's compare bar and groups (03 MB-22; web CompareBar / changeVisibility), pure. The three quick modes
// map onto the server's base selectors: This turn = the newest turn (`turn:<id>`), This chat = `baseline` (since the
// session started), Branch = the first mount's branch base (`ref:<sha>`); a mode with nothing behind it is disabled
// with the reason (D-36). The list splits into the files to review and the kept ones (MD-07), and — only for a
// workspace that still has the legacy root repo beside real codebases — "Changed in this chat" (the codebases) vs
// "Also changed in the workspace" (the root's scaffolding).
import type { WorkspaceCheckpoint } from '@generatorai/client-core';

import { checkpointTime } from '../../CheckpointScrubber/model/checkpointGroups';
import type { ChangeRow } from './changeKinds';
import { splitKept } from './keptModel';

export type CompareMode = 'turn' | 'chat' | 'branch';

export interface MountInfo {
  alias: string;
  status?: string;
  git?: { baseCommit?: string; baseRef?: string; branch?: string } | null;
}

export interface CompareModes {
  /** The newest turn's selector, when any turn was recorded. */
  turn: string | null;
  /** The first mount's branch base, when known. */
  branch: { value: string; label: string } | null;
}

export function compareModes(mounts: readonly MountInfo[], checkpoints: readonly WorkspaceCheckpoint[]): CompareModes {
  const withBase = mounts.find((m) => m.status !== 'removed' && m.git?.baseCommit);
  const ref = withBase?.git?.baseRef ?? withBase?.git?.branch ?? null;
  let newest: WorkspaceCheckpoint | null = null;
  for (const c of checkpoints) {
    if (!c.turnId || c.kind === 'baseline' || c.kind === 'pre_restore') continue;
    if (!newest || checkpointTime(c.createdAt) >= checkpointTime(newest.createdAt)) newest = c;
  }
  return {
    turn: newest?.turnId ? `turn:${newest.turnId}` : null,
    branch: withBase?.git?.baseCommit ? { value: `ref:${withBase.git.baseCommit}`, label: ref ? `Branch vs ${ref}` : 'Branch' } : null,
  };
}

/** Which quick mode a base selector is ('' when it is none of them: a checkpoint picked elsewhere). */
export function compareModeOf(base: string, modes: CompareModes): CompareMode | '' {
  if (base === 'baseline') return 'chat';
  if (base === modes.turn) return 'turn';
  if (base === modes.branch?.value) return 'branch';
  return '';
}

export interface ChangeSection {
  key: 'chat' | 'workspace' | 'kept';
  title: string;
  rows: ChangeRow[];
}

/**
 * The list's sections: files still to review ("Changed in this chat", and the legacy root repo's files as "Also
 * changed in the workspace" when real codebases sit beside it), then "Kept" (MD-07). Empty sections are dropped.
 */
export function changeSections(rows: readonly ChangeRow[], rootAliases: ReadonlySet<string>): ChangeSection[] {
  const { pending, kept } = splitKept(rows);
  const hasCodebase = pending.some((r) => !rootAliases.has(r.alias)) || kept.some((r) => !rootAliases.has(r.alias));
  const workspace = hasCodebase ? pending.filter((r) => rootAliases.has(r.alias)) : [];
  const chat = hasCodebase ? pending.filter((r) => !rootAliases.has(r.alias)) : pending;
  const sections: ChangeSection[] = [
    { key: 'chat', title: 'Changed in this chat', rows: chat },
    { key: 'workspace', title: 'Also changed in the workspace', rows: workspace },
    { key: 'kept', title: 'Kept', rows: kept },
  ];
  return sections.filter((s) => s.rows.length > 0);
}

/** "2 files ready · into fix/checkout-flake" (the commit footer). */
export function commitSummary(files: number, branch: string | null): { title: string; subtitle: string | null } {
  return { title: `${files} ${files === 1 ? 'file' : 'files'} ready`, subtitle: branch ? `into ${branch}` : null };
}
