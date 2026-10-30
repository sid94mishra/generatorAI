import { describe, expect, it } from 'vitest';

import { describePrompt, formatAliasList, groupCheckpoints } from './checkpointGroups';

describe('checkpointGroups', () => {
  const row = (id: string, extra: Record<string, unknown>) =>
    ({ id, workspaceId: 'w', repoAlias: '.', kind: 'turn', createdAt: 1000, fileCount: 0, ...extra }) as never;

  it('groups a turn across mounts and restores the before snapshots', () => {
    const groups = groupCheckpoints([
      row('a1', { turnId: 't1', phase: 'after', repoAlias: 'api', seq: 4, fileCount: 2, additions: 5, deletions: 1, createdAt: 2000 }),
      row('b1', { turnId: 't1', phase: 'before', repoAlias: 'api', seq: 3, createdAt: 1500 }),
      row('b2', { turnId: 't1', phase: 'before', repoAlias: 'web', seq: 3, createdAt: 1400 }),
      row('live', { kind: 'live' }),
      row('base', { kind: 'baseline', createdAt: 100 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['turn:t1', 'cp:base']);
    const turn = groups[0]!;
    expect(turn.undoesTurn).toBe(true);
    expect(turn.restoreTargets.map((c) => c.id).sort()).toEqual(['b1', 'b2']);
    expect(turn.aliases).toEqual(['api', 'web']);
    expect(turn.createdAt).toBe(1400);
    expect(turn).toMatchObject({ fileCount: 2, additions: 5, deletions: 1, compareValue: 'turn:t1' });
    expect(groups[1]).toMatchObject({ label: 'Session start', compareValue: 'checkpoint:base' });
  });

  it('formats alias lists and summarises review prompts', () => {
    expect(formatAliasList(['.'])).toBe('the workspace');
    expect(formatAliasList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(describePrompt('plain prompt')).toBe('plain prompt');
    expect(describePrompt('<review_feedback><file path="a.ts"><comment intent="fix">rename it</comment>')).toBe('Review: rename it');
    expect(describePrompt('<review_feedback><file path="a.ts">')).toBe('Review on a.ts');
  });
});
