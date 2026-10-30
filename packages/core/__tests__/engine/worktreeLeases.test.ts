import { parseGraph } from '@generatorai/workflow-spec';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/domain/workflow-graph/index.js';
import type { MapItemState, MapState } from '../../src/domain/scheduler/types.js';
import { itemKept } from '../../src/services/engine/MapEffects.js';
import { WorktreeLeases } from '../../src/services/engine/WorktreeLeases.js';
import { Sim } from '../scheduler/harness.js';

const K = ['worktree:m1'];
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('WorktreeLeases (P05 §4.1)', () => {
  // MAPWAIT-R1: two parallel mount_per_item maps; and a writer queued before a merge.
  it("a merge coexists with another map's shared lease and does not wait behind queued writers", async () => {
    const L = new WorktreeLeases();
    await L.acquire(K, 'shared', 'map-A');
    await L.acquire(K, 'shared', 'map-B');
    let writer = false;
    void L.acquire(K, 'write', 'outside').then(() => (writer = true));
    const mergeA = await L.acquire(K, 'exclusive', 'map-A');
    let mergeB = false;
    void L.acquire(K, 'exclusive', 'map-B').then(() => (mergeB = true));
    await tick();
    expect(mergeB).toBe(false); // merges exclude each other
    mergeA();
    await tick();
    expect(mergeB).toBe(true);
    expect(writer).toBe(false); // writers still wait for both maps
  });

  // MAPWAIT-R6: a map cancelled while its snapshot waits for the shared lease.
  it('releasing a map withdraws its queued snapshot, so later writers are not blocked forever', async () => {
    const L = new WorktreeLeases();
    const writer = await L.acquire(K, 'write', 'stage-outside');
    const snapshot = L.acquire(K, 'shared', 'map-1');
    L.release('map-1', 'shared');
    await expect(snapshot).rejects.toMatchObject({ name: 'AbortError' });
    writer();
    let next = false;
    void L.acquire(K, 'write', 'next-stage').then(() => (next = true));
    await tick();
    expect(next).toBe(true);
  });

  // MAPWAIT-R7: map_release during a merge releases only the shared lease.
  it("a map's release keeps its merge's exclusive lease until the merge ends", async () => {
    const L = new WorktreeLeases();
    await L.acquire(K, 'shared', 'map-1');
    const merge = await L.acquire(K, 'exclusive', 'map-1');
    let writer = false;
    void L.acquire(K, 'write', 'other').then(() => (writer = true));
    L.release('map-1', 'shared');
    await tick();
    expect(writer).toBe(false);
    merge();
    await tick();
    expect(writer).toBe(true);
  });
});

describe('map item worktrees (MAPWAIT-R2)', () => {
  const item = (over: Partial<MapItemState>): MapItemState => ({
    index: 0, key: '0', item: 'a', phase: 'done', status: 'completed', errorCode: null, error: null,
    workspaceId: 'ws0', mounts: { app: '/w0' }, primaryDir: '/w0', branch: 'b0', pr: null, ...over,
  });
  const map = (over: Partial<MapState> = {}): MapState => ({ kind: 'map', phase: 'done', count: 1, snapshot: { app: 'sha' }, items: [], ...over });

  it('releases what no later stage reads and keeps the rest until finalize', () => {
    expect(itemKept(map(), 'none', item({}))).toBe('all'); // later stages read its workdir
    expect(itemKept(map(), 'none', item({ status: 'failed' }))).toBe('none');
    expect(itemKept(map(), 'sequential', item({ status: 'cancelled' }))).toBe('none');
    expect(itemKept(map(), 'sequential', item({ status: 'failed', errorCode: 'merge_conflict' }))).toBe('all');
    expect(itemKept(map(), 'pr_per_item', item({}))).toBe('branch');
    const waiting = map({ winner: { phase: 'waiting', index: null, key: null, outcome: null, error: null } });
    expect(itemKept(waiting, 'winner', item({ status: 'failed' }))).toBe('all');
    const failed = map({ winner: { phase: 'done', index: 0, key: '0', outcome: 'failed', error: 'x' } });
    expect(itemKept(failed, 'winner', item({}))).toBe('all');
    expect(itemKept(failed, 'winner', item({ index: 1 }))).toBe('none');
  });

  it('a winner that settles releases the candidates', () => {
    const graph = compile(
      parseGraph({
        formatVersion: 2,
        workflow: { name: 'panel' },
        stages: [
          { key: 'panel', name: 'panel', kind: 'map', map: { items: "['a', 'b']", itemKey: 'item', maxItems: 5, concurrency: 2, workspace: 'mount_per_item', merge: { mode: 'winner', key: 'stages.judge.output.winner' } } },
          { key: 'attempt', name: 'attempt', kind: 'agent', parentKey: 'panel', prompts: [{ label: 'm', text: 'try' }] },
          { key: 'judge', name: 'judge', kind: 'agent', prompts: [{ label: 'm', text: 'judge' }], output: { format: 'json' } },
        ],
        edges: [{ from: 'panel', to: 'judge' }],
      }),
    );
    const s = new Sim(graph);
    s.boot();
    const id = s.inst('panel').id;
    s.send({ type: 'map_snapshot_taken', stageRunId: id, snapshot: { app: 'sha0' } });
    for (const i of [0, 1]) s.send({ type: 'map_item_prepared', stageRunId: id, index: i, ok: true, workspaceId: `ws${i}`, mounts: { app: `/w${i}` }, primaryDir: `/w${i}`, branch: `b${i}` });
    s.succeed('panel#0/attempt');
    s.succeed('panel#1/attempt');
    s.succeed('judge', { data: { winner: 'b' } });
    const merged = s.send({ type: 'map_item_merged', stageRunId: id, index: 1, ok: true });
    expect(merged.some((d) => d.t === 'map_release' && d.stageRunId === id)).toBe(true);
  });

  // MAPWAIT-R6: a snapshot that lands after its map was cancelled gives its lease back.
  it('a snapshot taken for a cancelled map is released', () => {
    const graph = compile(
      parseGraph({
        formatVersion: 2,
        workflow: { name: 'm' },
        stages: [
          { key: 'm', name: 'm', kind: 'map', map: { items: "['a']", maxItems: 5, concurrency: 1, workspace: 'mount_per_item', merge: 'sequential' } },
          { key: 'work', name: 'work', kind: 'agent', parentKey: 'm', prompts: [{ label: 'm', text: 'work' }] },
        ],
        edges: [],
      }),
    );
    const s = new Sim(graph);
    s.boot();
    const id = s.inst('m').id;
    s.send({ type: 'command', command: { command: 'cancel' } as never });
    const late = s.send({ type: 'map_snapshot_taken', stageRunId: id, snapshot: { app: 'sha0' } });
    expect(late.some((d) => d.t === 'map_release' && d.stageRunId === id)).toBe(true);
  });
});
