// ────────────────────────────────────────────────────────────────
// The Changes panel's compare picker (D-162): one dropdown, few choices.
//
//   Uncommitted changes   working tree vs each repo's last commit (default in a chat)
//   This chat / This run  working tree vs the session-start snapshot
//   Last turn             working tree vs the snapshot before the newest turn
//
// "Branch vs <base>" is not here: what a branch adds is what its pull request
// will contain, so the PR dialog shows it (commits + files against the base).
// Older turns are picked on the checkpoint timeline (Compare); while one is the
// base it shows as a fourth, labelled entry so the picker never lies.
// ────────────────────────────────────────────────────────────────

import type { CheckpointGroup } from './checkpoints/checkpointGroups.js';
import { checkpointLabel } from './checkpoints/checkpointGroups.js';

export interface CompareOption {
  value: string;
  label: string;
  /** Trailing context ("since last commit", a time). */
  meta?: string;
  disabled?: boolean;
}

export interface CompareChoicesInput {
  /** The selected base selector. */
  base: string;
  /** Some mount is a git repository (else there is no "last commit"). */
  hasGit: boolean;
  /** A chat says "This chat"; a workflow or automation run says "This run". */
  scope: 'chat' | 'run';
  /** Checkpoint groups (any order); turns are the ones with a `turnId`. */
  groups: readonly CheckpointGroup[];
  formatTime: (iso: string) => string;
}

/** Each mount's own HEAD. */
export const UNCOMMITTED_BASE = 'head';
/** The session-start snapshot. */
export const SESSION_BASE = 'baseline';

/** The base actually asked for: with no git repository there is no HEAD, so "Uncommitted" means the session. */
export function effectiveCompareBase(base: string, hasGit: boolean): string {
  return base === UNCOMMITTED_BASE && !hasGit ? SESSION_BASE : base;
}

export function compareChoices({ base, hasGit, scope, groups, formatTime }: CompareChoicesInput): CompareOption[] {
  const turns = groups.filter((g) => g.turnId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = turns.at(-1);
  const options: CompareOption[] = [];
  if (hasGit) options.push({ value: UNCOMMITTED_BASE, label: 'Uncommitted changes', meta: 'since last commit' });
  options.push({ value: SESSION_BASE, label: scope === 'chat' ? 'This chat' : 'This run', meta: 'since it started' });
  if (latest) options.push({ value: `turn:${latest.turnId}`, label: 'Last turn', meta: formatTime(latest.createdAt) });

  const selected = effectiveCompareBase(base, hasGit);
  if (!options.some((o) => o.value === selected)) options.push(customChoice(selected, turns, groups, formatTime));
  return options;
}

/** The entry for a base picked elsewhere (the timeline's Compare, a run page's stage). */
function customChoice(
  base: string,
  turns: readonly CheckpointGroup[],
  groups: readonly CheckpointGroup[],
  formatTime: (iso: string) => string,
): CompareOption {
  if (base.startsWith('turn:')) {
    const index = turns.findIndex((t) => `turn:${t.turnId}` === base);
    const turn = turns[index];
    if (turn) return { value: base, label: `Since turn ${index + 1}`, meta: formatTime(turn.createdAt) };
  }
  if (base.startsWith('stage:')) return { value: base, label: 'This stage' };
  if (base.startsWith('ref:')) return { value: base, label: 'Branch base' };
  const group = groups.find((g) => g.compareValue === base);
  if (group) return { value: base, label: `Since ${checkpointLabel(group).toLowerCase()}`, meta: formatTime(group.createdAt) };
  return { value: base, label: 'Selected point' };
}

/** Where Undo puts files back for `base`, as the end of a sentence ("back to the last commit"). */
export function undoTargetOf(base: string, options: readonly CompareOption[], scope: 'chat' | 'run'): string {
  if (base === UNCOMMITTED_BASE) return 'to the last commit';
  if (base === SESSION_BASE) return `to how it was when this ${scope} started`;
  const option = options.find((o) => o.value === base);
  if (option?.label === 'Last turn') return 'to how it was before the last turn';
  if (option?.label.startsWith('Since ')) return `to how it was before ${option.label.slice('Since '.length)}`;
  return 'to the selected point';
}
