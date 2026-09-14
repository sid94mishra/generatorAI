// Where a replayed commit card lands in the transcript, and when it does
// not land at all.

import { describe, expect, it } from 'vitest';
import type { StreamBlock } from '@generatorai/client-core';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import { liveScmTurnIds, mergeScmRows, replayedScmBlock, replayedScmRowId } from '../mergeScmRows';

const readiness: RepoReadiness = {
  alias: '.',
  repoDir: '/w/app',
  isRepo: true,
  hasRemote: true,
  connected: true,
  branch: 'generatorai/cart',
  detached: false,
  defaultBranch: 'main',
  onDefaultBranch: false,
  dirty: false,
  changedFiles: 0,
  ahead: 1,
  behind: 0,
  hasUpstream: true,
  mergeInProgress: false,
  conflictedFiles: [],
  openPullRequest: null,
  can: { commit: true, push: true, pullRequest: true },
  reasons: {},
};

function result(sha = 'abc1234def'): ScmFlowResult {
  return {
    status: 'ok',
    alias: '.',
    steps: [{ id: 'commit', status: 'done' }],
    commit: { sha, message: 'Fix the cart' },
    pushed: true,
    readiness,
  };
}

/** Stand-in for the screen's `Row`: some rows carry a turn, some do not. */
interface Item {
  id: string;
  turnId?: string;
  card?: true;
}

const turnOf = (item: Item): string | undefined => item.turnId;
const make = (turnId: string): Item => ({ id: replayedScmRowId(turnId), turnId, card: true });

describe('mergeScmRows', () => {
  it('puts the card after the turn’s LAST row, not its first', () => {
    const items: Item[] = [
      { id: 'u1' },
      { id: 'a', turnId: 't1' },
      { id: 'b', turnId: 't1' },
      { id: 'c', turnId: 't1' },
    ];
    const out = mergeScmRows(items, turnOf, new Map([['t1', result()]]), make);
    expect(out.map((i) => i.id)).toEqual(['u1', 'a', 'b', 'c', 'scm-replay-t1']);
  });

  it('emits once per turn even when the turn spans several messages', () => {
    const items: Item[] = [
      { id: 'a', turnId: 't1' },
      { id: 'b', turnId: 't1' },
      { id: 'c', turnId: 't2' },
    ];
    const out = mergeScmRows(items, turnOf, new Map([['t1', result()], ['t2', result('def')]]), make);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'scm-replay-t1', 'c', 'scm-replay-t2']);
    expect(out.filter((i) => i.card)).toHaveLength(2);
  });

  it('ignores the user bubble that sits between two turns', () => {
    const items: Item[] = [
      { id: 'a', turnId: 't1' },
      { id: 'u2' },
      { id: 'b', turnId: 't2' },
    ];
    const out = mergeScmRows(items, turnOf, new Map([['t1', result()]]), make);
    expect(out.map((i) => i.id)).toEqual(['a', 'scm-replay-t1', 'u2', 'b']);
  });

  it('skips a turn the live stream already renders a card for', () => {
    const items: Item[] = [{ id: 'a', turnId: 't1' }, { id: 'b', turnId: 't2' }];
    const results = new Map([['t1', result()], ['t2', result('def')]]);
    const out = mergeScmRows(items, turnOf, results, make, new Set(['t2']));
    expect(out.map((i) => i.id)).toEqual(['a', 'scm-replay-t1', 'b']);
  });

  it('drops a result whose turn is not in history — the live turn owns it', () => {
    const items: Item[] = [{ id: 'a', turnId: 't1' }];
    const out = mergeScmRows(items, turnOf, new Map([['t9', result()]]), make);
    expect(out).toBe(items);
  });

  it('returns the very same array when there is nothing to merge', () => {
    const items: Item[] = [{ id: 'a', turnId: 't1' }];
    expect(mergeScmRows(items, turnOf, undefined, make)).toBe(items);
    expect(mergeScmRows(items, turnOf, new Map(), make)).toBe(items);
  });
});

describe('liveScmTurnIds', () => {
  it('names the turns the live stream is already showing', () => {
    const blocks = [
      { type: 'text', blockId: 1, content: 'Done.', isComplete: true },
      { type: 'scm_result', blockId: 2, turnId: 't7', result: result() },
      { type: 'scm_result', blockId: 3, result: result() },
    ] as unknown as StreamBlock[];
    expect([...liveScmTurnIds(blocks)]).toEqual(['t7']);
    expect(liveScmTurnIds(undefined).size).toBe(0);
  });
});

describe('replayedScmBlock', () => {
  it('is the same object for the same result, so the row memo holds', () => {
    const flow = result();
    const a = replayedScmBlock('t1', flow, 'c1');
    expect(replayedScmBlock('t1', flow, 'c1')).toBe(a);
    expect(a.blockId).toBe(-1);
    expect(a.chatId).toBe('c1');
    expect(a.turnId).toBe('t1');
  });

  it('rebuilds when the result itself changed', () => {
    const a = replayedScmBlock('t1', result(), 'c1');
    expect(replayedScmBlock('t1', result('zzz'), 'c1')).not.toBe(a);
  });
});
