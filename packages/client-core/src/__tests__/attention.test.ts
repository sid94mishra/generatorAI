// G-01 — the attention read model: seq rules, buffering, gap → refetch,
// project filtering, selectors, and the store's fetch/stream wiring.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyAttentionCounts, type AttentionItem, type AttentionSnapshot } from '@generatorai/shared';
import {
  applyAttentionEvent,
  ATTENTION_RETRY_BASE_MS,
  ATTENTION_RETRY_MAX_MS,
  attentionReducer,
  createAttentionStore,
  initialAttentionState,
  selectAttentionByProject,
  selectAttentionFor,
  selectCounts,
  selectNeedsYou,
  selectRunning,
  type AttentionStreamEvent,
  type AttentionStreamPort,
} from '../attention/index.js';

const item = (key: string, over: Partial<AttentionItem> = {}): AttentionItem => {
  const [entity, entityId] = key.split(':') as [AttentionItem['entity'], string];
  return {
    key,
    entity,
    entityId,
    title: key,
    href: `/x/${entityId}`,
    state: 'running',
    since: '2026-09-26T10:00:00.000Z',
    stoppable: true,
    ...over,
  };
};

const ask = (key: string, since: string, projectId?: string): AttentionItem =>
  item(key, {
    state: 'needs_you',
    since,
    ask: { kind: 'tool_permission', id: key.split(':')[2] ?? 'i', summary: 'Allow Bash?', actions: ['allow_once', 'deny', 'open'] },
    ...(projectId ? { project: { id: projectId, name: projectId } } : {}),
  });

const snapshot = (seq: number, needsYou: AttentionItem[] = [], running: AttentionItem[] = []): AttentionSnapshot => ({
  seq,
  generatedAt: '2026-09-26T10:00:00.000Z',
  needsYou,
  running,
  counts: { ...emptyAttentionCounts(), needsYou: needsYou.length, running: running.length },
});

const upsert = (seq: number, i: AttentionItem): AttentionStreamEvent => ({ kind: 'attention.upsert', data: { seq, item: i } });
const remove = (seq: number, key: string): AttentionStreamEvent => ({ kind: 'attention.remove', data: { seq, key } });

describe('applyAttentionEvent', () => {
  it('applies seq+1, ignores stale or foreign kinds, and reports a gap', () => {
    const base = snapshot(10);
    const next = applyAttentionEvent(base, upsert(11, item('chat:c1')));
    expect(next.gap).toBe(false);
    expect(next.snapshot.seq).toBe(11);
    expect(next.snapshot.running.map((i) => i.key)).toEqual(['chat:c1']);
    expect(next.snapshot.counts.byEntity.chat.running).toBe(1);

    expect(applyAttentionEvent(next.snapshot, upsert(11, item('chat:c2'))).snapshot).toBe(next.snapshot);
    expect(applyAttentionEvent(next.snapshot, { kind: 'attention.counts', data: { seq: 11 } }).snapshot).toBe(next.snapshot);
    expect(applyAttentionEvent(next.snapshot, { kind: 'chat.created', data: { seq: 12 } }).snapshot).toBe(next.snapshot);
    expect(applyAttentionEvent(next.snapshot, upsert(13, item('chat:c3')))).toEqual({ snapshot: next.snapshot, gap: true });
  });

  it('moves an item between lists by key and keeps each list oldest first', () => {
    let s = snapshot(0, [], [item('chat:c1')]);
    s = applyAttentionEvent(s, upsert(1, ask('chat:c9:i9', '2026-09-26T10:05:00.000Z'))).snapshot;
    s = applyAttentionEvent(s, remove(2, 'chat:c1')).snapshot;
    s = applyAttentionEvent(s, upsert(3, ask('chat:c1:i1', '2026-09-26T10:01:00.000Z'))).snapshot;
    expect(s.running).toEqual([]);
    expect(s.needsYou.map((i) => i.key)).toEqual(['chat:c1:i1', 'chat:c9:i9']);
    expect(s.counts).toMatchObject({ needsYou: 2, running: 0 });
  });

  it('treats an item outside the project filter as a removal but still advances seq', () => {
    let s = snapshot(0, [ask('chat:c1:i1', '2026-09-26T10:00:00.000Z', 'p1')]);
    s = applyAttentionEvent(s, upsert(1, ask('chat:c1:i1', '2026-09-26T10:00:00.000Z', 'p2')), { projectId: 'p1' }).snapshot;
    expect(s.seq).toBe(1);
    expect(s.needsYou).toEqual([]);
  });
});

describe('attentionReducer', () => {
  it('buffers deltas until the first snapshot, then replays the ones it does not cover', () => {
    let state = initialAttentionState();
    state = attentionReducer(state, { type: 'stream', event: upsert(5, item('chat:old')) });
    state = attentionReducer(state, { type: 'stream', event: upsert(6, item('chat:new')) });
    state = attentionReducer(state, { type: 'stream', event: { kind: 'workflow_run.created', data: {} } });
    expect(state.buffered).toHaveLength(2);
    expect(selectCounts(state)).toBeNull();

    state = attentionReducer(state, { type: 'snapshot', snapshot: snapshot(5, [], [item('chat:old')]) });
    expect(state.buffered).toEqual([]);
    expect(state.needsResync).toBe(false);
    expect(selectRunning(state).map((i) => i.key)).toEqual(['chat:new', 'chat:old']);
    expect(state.snapshot!.seq).toBe(6);
  });

  it('flags a resync on a gap, and a fresh snapshot clears it', () => {
    let state = attentionReducer(initialAttentionState(), { type: 'snapshot', snapshot: snapshot(1) });
    state = attentionReducer(state, { type: 'stream', event: upsert(9, item('chat:c1')) });
    expect(state.needsResync).toBe(true);
    expect(selectRunning(state)).toEqual([]);
    state = attentionReducer(state, { type: 'snapshot', snapshot: snapshot(9, [], [item('chat:c1')]) });
    expect(state.needsResync).toBe(false);
    expect(selectRunning(state)).toHaveLength(1);
  });

  it('selectors narrow by entity and by project', () => {
    const state = attentionReducer(initialAttentionState(), {
      type: 'snapshot',
      snapshot: snapshot(
        1,
        [ask('workflow_run:r1:s1', '2026-09-26T10:00:00.000Z', 'p1')],
        [item('workflow_run:r2'), item('chat:c1', { project: { id: 'p1', name: 'p1' } })],
      ),
    });
    expect(selectNeedsYou(state)).toHaveLength(1);
    expect(selectAttentionFor(state, 'workflow_run', 'r1').map((i) => i.key)).toEqual(['workflow_run:r1:s1']);
    const p1 = selectAttentionByProject(state, 'p1');
    expect(p1.needsYou.map((i) => i.key)).toEqual(['workflow_run:r1:s1']);
    expect(p1.running.map((i) => i.key)).toEqual(['chat:c1']);
    expect(p1.counts.byEntity.chat.running).toBe(1);
  });
});

describe('createAttentionStore', () => {
  function fakeMux() {
    let handler: ((e: AttentionStreamEvent) => void) | null = null;
    let options: Parameters<AttentionStreamPort['subscribe']>[3];
    const port: AttentionStreamPort = {
      subscribe: vi.fn((_scope, _id, h, o) => {
        handler = h;
        options = o;
        return () => {
          handler = null;
        };
      }),
    };
    return {
      port,
      push: (e: AttentionStreamEvent) => handler?.(e),
      connected: () => options?.onConnected?.(),
      disconnected: (reason?: string) => options?.onDisconnected?.(reason),
      get subscribed() {
        return handler !== null;
      },
    };
  }

  it('subscribes global before fetching, folds deltas in, and refetches on a gap', async () => {
    const mux = fakeMux();
    const snapshots = [snapshot(3, [], [item('chat:a')]), snapshot(20, [], [item('chat:z')])];
    const api = { getAttention: vi.fn(async () => snapshots.shift()!) };
    const store = createAttentionStore(api, mux.port);
    const seen = vi.fn();
    store.subscribe(seen);
    store.start();

    expect(mux.port.subscribe).toHaveBeenCalledWith('global', 'all', expect.any(Function), expect.objectContaining({ filter: ['attention.'] }));
    // A delta that lands while the first fetch is in flight is not lost.
    mux.push(upsert(4, item('chat:b')));
    await vi.waitFor(() => expect(store.getState().snapshot?.seq).toBe(4));
    expect(selectRunning(store.getState()).map((i) => i.key)).toEqual(['chat:a', 'chat:b']);
    expect(seen).toHaveBeenCalled();

    mux.push(upsert(7, item('chat:c'))); // 5 and 6 never arrived
    await vi.waitFor(() => expect(store.getState().snapshot?.seq).toBe(20));
    expect(api.getAttention).toHaveBeenCalledTimes(2);
    expect(selectRunning(store.getState()).map((i) => i.key)).toEqual(['chat:z']);
    expect(store.getState().needsResync).toBe(false);

    store.stop();
    expect(mux.subscribed).toBe(false);
  });

  it('refetches after a reconnect and on a gap disconnect, and passes the project filter', async () => {
    const mux = fakeMux();
    const api = { getAttention: vi.fn(async () => snapshot(1)) };
    const store = createAttentionStore(api, mux.port, { projectId: 'p1' });
    store.start();
    await vi.waitFor(() => expect(store.getState().snapshot).not.toBeNull());
    expect(api.getAttention).toHaveBeenLastCalledWith({ projectId: 'p1' });

    mux.connected(); // first connect: nothing to repair
    expect(api.getAttention).toHaveBeenCalledTimes(1);
    mux.disconnected('network');
    mux.connected();
    await vi.waitFor(() => expect(api.getAttention).toHaveBeenCalledTimes(2));
    mux.disconnected('gap:replay_unavailable');
    await vi.waitFor(() => expect(api.getAttention).toHaveBeenCalledTimes(3));
    store.stop();
  });

  it('records a failed fetch without inventing data', async () => {
    const api = { getAttention: vi.fn(async () => Promise.reject(new Error('403 Forbidden'))) };
    const store = createAttentionStore(api, fakeMux().port);
    store.start();
    await vi.waitFor(() => expect(store.getState().error).toBe('403 Forbidden'));
    expect(store.getState().snapshot).toBeNull();
    expect(selectCounts(store.getState())).toBeNull();
    store.stop();
  });

  it('P2-R12: a burst of deltas during a slow fetch neither stalls it nor is lost, and an older response never rolls the view back', async () => {
    const mux = fakeMux();
    const pending: Array<(s: AttentionSnapshot) => void> = [];
    const api = { getAttention: vi.fn(() => new Promise<AttentionSnapshot>((r) => pending.push(r))) };
    const store = createAttentionStore(api, mux.port);
    store.start();
    pending.shift()!(snapshot(10, [], [item('chat:a')]));
    await vi.waitFor(() => expect(store.getState().snapshot?.seq).toBe(10));

    // A refresh goes out; while it is in flight 50 deltas arrive and are
    // applied live (the view never waits on the request).
    void store.refresh();
    await vi.waitFor(() => expect(api.getAttention).toHaveBeenCalledTimes(2));
    for (let seq = 11; seq <= 60; seq++) mux.push(upsert(seq, item(`chat:n${seq}`)));
    expect(store.getState().snapshot?.seq).toBe(60);
    // Nothing cancelled or re-issued the request in flight.
    expect(api.getAttention).toHaveBeenCalledTimes(2);

    // The response was built at seq 12 — older than the view. The replay
    // brings it forward instead of rolling back.
    pending.shift()!(snapshot(12, [], [item('chat:a'), item('chat:n11'), item('chat:n12')]));
    await vi.waitFor(() => expect(store.getState().fetching).toBe(false));
    expect(store.getState().snapshot?.seq).toBe(60);
    expect(selectRunning(store.getState())).toHaveLength(51);
    expect(store.getState().needsResync).toBe(false);
    expect(api.getAttention).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it('P2-R12: a gap during a fetch is settled by the replay; a resync during a fetch queues exactly one more', async () => {
    const mux = fakeMux();
    const pending: Array<(s: AttentionSnapshot) => void> = [];
    const api = { getAttention: vi.fn(() => new Promise<AttentionSnapshot>((r) => pending.push(r))) };
    const store = createAttentionStore(api, mux.port);
    store.start();
    // 5 and 7 arrive before the first snapshot; 6 was lost in transit but is
    // inside the snapshot, so the replay has no hole.
    mux.push(upsert(5, item('chat:five')));
    mux.push(upsert(7, item('chat:seven')));
    pending.shift()!(snapshot(6, [], [item('chat:five'), item('chat:six')]));
    await vi.waitFor(() => expect(store.getState().snapshot?.seq).toBe(7));
    expect(api.getAttention).toHaveBeenCalledTimes(1);

    void store.refresh();
    await vi.waitFor(() => expect(api.getAttention).toHaveBeenCalledTimes(2));
    mux.disconnected('gap:replay_unavailable'); // the server lost our place mid-fetch
    pending.shift()!(snapshot(7, [], [item('chat:five'), item('chat:six'), item('chat:seven')]));
    await vi.waitFor(() => expect(api.getAttention).toHaveBeenCalledTimes(3));
    pending.shift()!(snapshot(900, [], []));
    await vi.waitFor(() => expect(store.getState().snapshot?.seq).toBe(900));
    expect(store.getState().needsResync).toBe(false);
    expect(api.getAttention).toHaveBeenCalledTimes(3);
    store.stop();
  });
});

describe('createAttentionStore — retry with backoff (P2-R31)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeMux() {
    let handler: ((e: AttentionStreamEvent) => void) | null = null;
    const port: AttentionStreamPort = {
      subscribe: vi.fn((_scope, _id, h) => {
        handler = h;
        return () => {
          handler = null;
        };
      }),
    };
    return { port, push: (e: AttentionStreamEvent) => handler?.(e) };
  }

  /** A server whose answers the test scripts: `fail` rejects, otherwise the given snapshot. */
  function scriptedApi(answers: Array<AttentionSnapshot | 'fail'>) {
    return {
      getAttention: vi.fn(async () => {
        const next = answers.shift() ?? 'fail';
        if (next === 'fail') throw new Error('503 Service Unavailable');
        return next;
      }),
    };
  }

  it('retries a failed first fetch on its own; deltas meanwhile wait for the retry and are replayed on it', async () => {
    vi.useFakeTimers();
    const mux = fakeMux();
    const api = scriptedApi(['fail', snapshot(5, [], [item('chat:a')])]);
    const store = createAttentionStore(api, mux.port);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ snapshot: null, error: '503 Service Unavailable' });

    // The probe: 20 deltas after the failure. None of them fires a request …
    for (let seq = 6; seq <= 25; seq++) mux.push(upsert(seq, item(`chat:n${seq}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAttention).toHaveBeenCalledTimes(1);

    // … the store retries after the first backoff step and replays them.
    await vi.advanceTimersByTimeAsync(ATTENTION_RETRY_BASE_MS);
    expect(api.getAttention).toHaveBeenCalledTimes(2);
    expect(store.getState().snapshot?.seq).toBe(25);
    expect(selectRunning(store.getState())).toHaveLength(21);
    expect(store.getState()).toMatchObject({ error: null, needsResync: false, buffered: [] });

    // Settled: no further requests on their own.
    await vi.advanceTimersByTimeAsync(10 * ATTENTION_RETRY_MAX_MS);
    expect(api.getAttention).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it('deltas while the server keeps failing do not each fire a request: requests follow the backoff', async () => {
    vi.useFakeTimers();
    const mux = fakeMux();
    const api = scriptedApi([snapshot(1)]); // then every request fails
    const store = createAttentionStore(api, mux.port);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().snapshot?.seq).toBe(1);

    // A gap marks the snapshot stale; the resync request fails.
    mux.push(upsert(3, item('chat:gap')));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAttention).toHaveBeenCalledTimes(2);
    expect(store.getState().needsResync).toBe(true);

    // The probe: 11 more deltas. Before the fix this was 11 more requests.
    for (let seq = 4; seq <= 14; seq++) mux.push(upsert(seq, item(`chat:n${seq}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAttention).toHaveBeenCalledTimes(2);

    // One request per backoff step: 1 s, 2 s, 4 s …
    await vi.advanceTimersByTimeAsync(999);
    expect(api.getAttention).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getAttention).toHaveBeenCalledTimes(3);
    mux.push(upsert(15, item('chat:n15')));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(api.getAttention).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getAttention).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(api.getAttention).toHaveBeenCalledTimes(5);

    // stop() cancels the pending retry.
    store.stop();
    await vi.advanceTimersByTimeAsync(10 * ATTENTION_RETRY_MAX_MS);
    expect(api.getAttention).toHaveBeenCalledTimes(5);
  });

  it('doubles the delay up to the cap, resets it on success, and refresh() fetches now', async () => {
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    const timers = {
      setTimeout: (callback: () => void, ms: number) => {
        delays.push(ms);
        pending.push(callback);
        return pending.length;
      },
      clearTimeout: vi.fn(),
    };
    const answers: Array<AttentionSnapshot | 'fail'> = Array.from({ length: 7 }, () => 'fail' as const);
    answers.push(snapshot(1), 'fail');
    const api = scriptedApi(answers);
    const store = createAttentionStore(api, fakeMux().port, { timers });
    store.start();
    for (let i = 0; i < 7; i++) {
      await vi.waitFor(() => expect(delays).toHaveLength(i + 1));
      pending.shift()!();
    }
    await vi.waitFor(() => expect(store.getState().snapshot?.seq).toBe(1));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(api.getAttention).toHaveBeenCalledTimes(8);

    // A live, current view whose refresh fails needs no retry.
    await store.refresh();
    expect(store.getState().error).toBe('503 Service Unavailable');
    expect(delays).toHaveLength(7);

    // Stale again: the backoff starts over from the base, and an explicit
    // refresh during it cancels the timer and fetches immediately.
    const mux = fakeMux();
    const second = createAttentionStore(scriptedApi(['fail', snapshot(9)]), mux.port, { timers, retry: { baseMs: 50, maxMs: 200 } });
    second.start();
    await vi.waitFor(() => expect(delays).toHaveLength(8));
    expect(delays[7]).toBe(50);
    await second.refresh();
    expect(timers.clearTimeout).toHaveBeenCalledTimes(1);
    expect(second.getState().snapshot?.seq).toBe(9);
    store.stop();
    second.stop();
  });
});

describe('attentionReducer — fetch window (P2-R12)', () => {
  it('holds deltas from the moment a fetch starts and replays only those past the response', () => {
    let state = attentionReducer(initialAttentionState(), { type: 'snapshot', snapshot: snapshot(1) });
    state = attentionReducer(state, { type: 'fetch' });
    state = attentionReducer(state, { type: 'stream', event: upsert(2, item('chat:b')) });
    state = attentionReducer(state, { type: 'stream', event: upsert(3, item('chat:c')) });
    expect(state.snapshot!.seq).toBe(3);
    expect(state.buffered).toHaveLength(2);
    state = attentionReducer(state, { type: 'snapshot', snapshot: snapshot(2, [], [item('chat:b')]) });
    expect(state.snapshot!.seq).toBe(3);
    expect(selectRunning(state).map((i) => i.key)).toEqual(['chat:b', 'chat:c']);
    expect(state).toMatchObject({ buffered: [], fetching: false, needsResync: false });
  });

  it('does not apply deltas to a stale snapshot, and a hole in the replay asks for another fetch', () => {
    let state = attentionReducer(initialAttentionState(), { type: 'snapshot', snapshot: snapshot(1) });
    state = attentionReducer(state, { type: 'resync' });
    state = attentionReducer(state, { type: 'fetch' });
    state = attentionReducer(state, { type: 'stream', event: upsert(9, item('chat:x')) });
    expect(state.snapshot!.seq).toBe(1);
    state = attentionReducer(state, { type: 'snapshot', snapshot: snapshot(5) });
    expect(state.needsResync).toBe(true);
    expect(state.snapshot!.seq).toBe(5);
  });
});
