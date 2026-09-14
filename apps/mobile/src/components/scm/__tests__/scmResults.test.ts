// Folding the persisted stream into the commit cards: the paging walk and
// the last-write-wins rule. Both matter for the bug this fixes — a chat
// reopened after its turns settled showed no cards at all, and a turn that
// was re-run after a conflict must show what is true NOW.

import { describe, expect, it, vi } from 'vitest';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import { foldScmResults, scmResultOf, type ReplayPage, type ReplayRow } from '../scmResults';

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

function result(over: Partial<ScmFlowResult> = {}): ScmFlowResult {
  return {
    status: 'ok',
    alias: '.',
    steps: [{ id: 'commit', status: 'done' }],
    commit: { sha: 'abc1234def', message: 'Fix the cart' },
    pushed: true,
    readiness,
    ...over,
  };
}

/** A persisted `chat.scm.result` row. */
function row(seq: number, turnId: string, flow: ScmFlowResult = result()): ReplayRow {
  return { seq, kind: 'chat.scm.result', payload: { chatId: 'c1', turnId, alias: '.', result: flow } };
}

function noise(seq: number): ReplayRow {
  return { seq, kind: 'chat.token', payload: { text: 'hello' } };
}

/** Serves `rows` in pages of `pageSize`, the way `/api/stream/replay` does. */
function pager(rows: readonly ReplayRow[], pageSize: number) {
  const seen: number[] = [];
  const fn = vi.fn(async (afterSeq: number): Promise<ReplayPage> => {
    seen.push(afterSeq);
    const page = rows.filter((r) => r.seq > afterSeq).slice(0, pageSize);
    return { rows: page, nextAfterSeq: page.length > 0 ? page[page.length - 1]!.seq : afterSeq };
  });
  return { fn, seen };
}

describe('scmResultOf', () => {
  it('takes the documented payload', () => {
    const found = scmResultOf({ chatId: 'c1', turnId: 't1', result: result() });
    expect(found?.turnId).toBe('t1');
    expect(found?.result.status).toBe('ok');
  });

  it('drops a payload that could not render a card', () => {
    expect(scmResultOf(undefined)).toBeNull();
    expect(scmResultOf({ turnId: 't1' })).toBeNull();
    expect(scmResultOf({ result: result() })).toBeNull();
    expect(scmResultOf({ turnId: '', result: result() })).toBeNull();
    expect(scmResultOf({ turnId: 't1', result: { status: 'weird', alias: '.', steps: [] } })).toBeNull();
  });
});

describe('foldScmResults', () => {
  it('pages until a short page, keeping only the source-control events', async () => {
    const rows = [row(1, 't1'), noise(2), noise(3), row(4, 't2'), noise(5), row(6, 't3')];
    const { fn, seen } = pager(rows, 2);

    const folded = await foldScmResults(fn, { pageSize: 2 });

    // 0 → 2 → 4 → 6, and the page after seq 6 comes back empty and stops it.
    expect(seen).toEqual([0, 2, 4, 6]);
    expect([...folded.keys()]).toEqual(['t1', 't2', 't3']);
  });

  it('stops on the first short page without asking again', async () => {
    const { fn, seen } = pager([row(1, 't1')], 100);
    const folded = await foldScmResults(fn);
    expect(seen).toEqual([0]);
    expect(folded.size).toBe(1);
  });

  it('lets the LAST write for a turn win — a re-run after a conflict', async () => {
    const conflicted = result({
      status: 'conflicts',
      commit: undefined,
      pushed: false,
      conflicts: { base: 'main', head: 'generatorai/cart', files: ['src/cart.ts'], mergeStarted: false },
    });
    const settled = result({ commit: { sha: 'fff9999', message: 'Fix the cart' } });
    const { fn } = pager([row(1, 't1', conflicted), row(2, 't1', settled)], 100);

    const folded = await foldScmResults(fn);

    expect(folded.size).toBe(1);
    expect(folded.get('t1')?.status).toBe('ok');
    expect(folded.get('t1')?.commit?.sha).toBe('fff9999');
  });

  it('keeps the turn order it first saw, so cards land where the turns did', async () => {
    const { fn } = pager([row(1, 't1'), row(2, 't2'), row(3, 't1')], 100);
    expect([...(await foldScmResults(fn)).keys()]).toEqual(['t1', 't2']);
  });

  it('honours a cursor that stops advancing instead of looping forever', async () => {
    // A server that always echoes the same `nextAfterSeq` with a full page.
    const fn = vi.fn(async (): Promise<ReplayPage> => ({ rows: [row(1, 't1'), row(1, 't1')], nextAfterSeq: 0 }));
    await foldScmResults(fn, { pageSize: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up at the page cap rather than walking a whole long-lived chat', async () => {
    let seq = 0;
    const fn = vi.fn(async (): Promise<ReplayPage> => {
      seq += 2;
      return { rows: [noise(seq - 1), noise(seq)], nextAfterSeq: seq };
    });
    await foldScmResults(fn, { pageSize: 2, maxPages: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('survives a page with no rows array at all', async () => {
    const fn = vi.fn(async () => ({ nextAfterSeq: 0 }) as unknown as ReplayPage);
    await expect(foldScmResults(fn)).resolves.toEqual(new Map());
  });
});
