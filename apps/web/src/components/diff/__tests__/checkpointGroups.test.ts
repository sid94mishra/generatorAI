import { describe, expect, it } from 'vitest';
import type { CheckpointRecord } from '@/types/changes.js';
import {
  CHECKPOINT_KIND_LABEL,
  checkpointLabel,
  formatAliasList,
  groupCheckpoints,
} from '../checkpointGroups.js';

let seq = 0;
function cp(over: Partial<CheckpointRecord>): CheckpointRecord {
  seq += 1;
  return {
    id: `c${String(seq)}`,
    workspaceId: 'w1',
    repoAlias: 'frontend',
    seq,
    kind: 'turn',
    refKind: 'git_tree',
    refValue: 'refs/x',
    treeSha: 'deadbeef',
    fileCount: 0,
    additions: 0,
    deletions: 0,
    createdAt: '2026-09-06T10:00:00.000Z',
    ...over,
  };
}

describe('groupCheckpoints', () => {
  it('collapses one turn across several mounts into a single row', () => {
    const groups = groupCheckpoints([
      cp({ id: 'b1', turnId: 't1', phase: 'before', repoAlias: 'frontend', seq: 1 }),
      cp({ id: 'b2', turnId: 't1', phase: 'before', repoAlias: 'backend', seq: 2 }),
      cp({ id: 'a1', turnId: 't1', phase: 'after', repoAlias: 'frontend', seq: 3, fileCount: 2, additions: 10, deletions: 1 }),
      cp({ id: 'a2', turnId: 't1', phase: 'after', repoAlias: 'backend', seq: 4, fileCount: 1, additions: 3, deletions: 0 }),
    ]);

    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.turnId).toBe('t1');
    expect(g.aliases).toEqual(['frontend', 'backend']);
    // Rewind means "put it back the way it was", so the `before` snapshots win.
    expect(g.undoesTurn).toBe(true);
    expect(g.restoreTargets.map((t) => t.id)).toEqual(['b1', 'b2']);
    // …while the counts describe what the turn produced.
    expect(g.fileCount).toBe(3);
    expect(g.additions).toBe(13);
    expect(g.deletions).toBe(1);
    expect(g.compareValue).toBe('turn:t1');
  });

  it('restores exactly one checkpoint per mount', () => {
    const [g] = groupCheckpoints([
      cp({ id: 'b1', turnId: 't1', phase: 'before', repoAlias: 'frontend', seq: 5 }),
      cp({ id: 'b0', turnId: 't1', phase: 'before', repoAlias: 'frontend', seq: 1 }),
    ]);
    // Lowest seq wins: the earliest state on that side of the turn.
    expect(g!.restoreTargets.map((t) => t.id)).toEqual(['b0']);
  });

  it('keeps checkpoints without a turn as rows of their own', () => {
    const groups = groupCheckpoints([
      cp({ id: 'm1', kind: 'manual', label: 'Before refactor' }),
      cp({ id: 'p1', kind: 'pre_restore' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['cp:m1', 'cp:p1']);
    expect(groups[0]!.compareValue).toBe('checkpoint:m1');
    expect(groups.every((g) => g.undoesTurn === false)).toBe(true);
  });

  it('falls back to the members themselves when a turn has no `before` side', () => {
    const [g] = groupCheckpoints([
      cp({ id: 'a1', turnId: 't9', phase: 'after', repoAlias: 'frontend', fileCount: 4 }),
    ]);
    expect(g!.undoesTurn).toBe(false);
    expect(g!.restoreTargets.map((t) => t.id)).toEqual(['a1']);
    expect(g!.fileCount).toBe(4);
  });

  it('drops auto-save noise', () => {
    expect(groupCheckpoints([cp({ kind: 'live' })])).toHaveLength(0);
  });

  it('takes the earliest time in the group as the row’s time', () => {
    const [g] = groupCheckpoints([
      cp({ turnId: 't2', createdAt: '2026-09-06T10:00:05.000Z' }),
      cp({ turnId: 't2', createdAt: '2026-09-06T10:00:01.000Z', repoAlias: 'backend' }),
    ]);
    expect(g!.createdAt).toBe('2026-09-06T10:00:01.000Z');
  });
});

describe('labels', () => {
  it('calls a pre-restore snapshot what it is for, not where it came from', () => {
    expect(CHECKPOINT_KIND_LABEL['pre_restore']).toBe('Redo point');
    expect(checkpointLabel({ kind: 'pre_restore' })).toBe('Redo point');
  });

  it('prefers an explicit label', () => {
    expect(checkpointLabel({ kind: 'turn', label: 'Before refactor' })).toBe('Before refactor');
  });
});

describe('formatAliasList', () => {
  it('names the mounts a rewind will touch', () => {
    expect(formatAliasList(['frontend'])).toBe('frontend');
    expect(formatAliasList(['frontend', 'backend'])).toBe('frontend and backend');
    expect(formatAliasList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(formatAliasList(['.'])).toBe('the workspace');
    expect(formatAliasList([])).toBe('this workspace');
  });
});
