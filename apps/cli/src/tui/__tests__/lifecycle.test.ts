// ────────────────────────────────────────────────────────────────
// Entity lifecycle events → list caches (open question #4), plus the
// hidden-pane flush tiering (#5) and stream health counters (#6).
//
// The behaviour worth pinning is the SPLIT: creations ask for a refetch,
// everything else is applied directly. Getting that backwards produces the
// two failure modes this design exists to avoid — a half-populated row that
// fills itself in a second later (if creations were synthesised), or a
// deleted row that lingers for a whole poll interval (if deletions waited
// for a round trip).
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { StreamPort } from '@generatorai/cli-core';
import { applyLifecycleEvent } from '../lifecycle.js';
import { createTuiStore, setStore, StreamReconciler, type DataCache } from '../store.js';

const emptyCache: DataCache = {
  chats: [],
  workflows: [],
  runs: [],
  automations: [],
  projects: [],
  workspaces: [],
  agents: [],
  scripts: [],
  extensions: [],
};

const cacheWith = (patch: Partial<DataCache>): DataCache => ({ ...emptyCache, ...patch });

describe('applyLifecycleEvent — creations', () => {
  it('asks for a refetch rather than synthesising a half-populated row', () => {
    // `chat.created` carries an id and a name; the list renders status,
    // model and `updatedAt`. A synthesised row would fill itself in a second
    // later, which reads as a rendering bug.
    expect(applyLifecycleEvent(emptyCache, { kind: 'chat.created', data: { chatId: 'c1', name: 'x' } }))
      .toEqual({ refetch: 'chats' });
    expect(applyLifecycleEvent(emptyCache, { kind: 'workflow_run.created', data: { workflowRunId: 'r1' } }))
      .toEqual({ refetch: 'runs' });
  });

  it('refetches on a retry, whose NEW run id the event does not carry', () => {
    // `workflow_run.retried` names the ANCESTOR; the new run only exists
    // server-side.
    expect(
      applyLifecycleEvent(emptyCache, {
        kind: 'workflow_run.retried',
        data: { workflowRunId: 'r1', ancestorRunId: 'r0' },
      }),
    ).toEqual({ refetch: 'runs' });
  });
});

describe('applyLifecycleEvent — deletions and status', () => {
  it('drops a deleted chat immediately, without waiting for a round trip', () => {
    const data = cacheWith({ chats: [{ id: 'c1' }, { id: 'c2' }] });
    const out = applyLifecycleEvent(data, { kind: 'chat.deleted', data: { chatId: 'c1' } });
    expect(out.patch).toEqual({ key: 'chats', rows: [{ id: 'c2' }] });
    expect(out.refetch).toBeUndefined();
  });

  it('does nothing when the deleted row was never cached', () => {
    // Returning a new array here would replace the cache with an identical
    // one and re-render every list for nothing.
    const data = cacheWith({ chats: [{ id: 'c1' }] });
    expect(applyLifecycleEvent(data, { kind: 'chat.deleted', data: { chatId: 'zzz' } })).toEqual({});
  });

  it('maps every run status kind onto the row', () => {
    const data = cacheWith({ runs: [{ id: 'r1', status: 'pending' }] });
    const statusFor = (kind: string): unknown =>
      applyLifecycleEvent(data, { kind, data: { workflowRunId: 'r1' } }).patch?.rows[0]?.['status'];

    expect(statusFor('workflow_run.running')).toBe('running');
    expect(statusFor('workflow_run.paused')).toBe('paused');
    // Resuming is not its own status — the row goes back to running.
    expect(statusFor('workflow_run.resumed')).toBe('running');
    expect(statusFor('workflow_run.completed')).toBe('completed');
    expect(statusFor('workflow_run.failed')).toBe('failed');
    expect(statusFor('workflow_run.cancelled')).toBe('cancelled');
  });

  it('carries the error onto a failed run, so the list can show why', () => {
    const data = cacheWith({ runs: [{ id: 'r1', status: 'running' }] });
    const rows = applyLifecycleEvent(data, {
      kind: 'workflow_run.failed',
      data: { workflowRunId: 'r1', error: 'stage 2 blew up' },
    }).patch?.rows;
    expect(rows?.[0]).toMatchObject({ status: 'failed', error: 'stage 2 blew up' });
  });

  it('leaves every other row untouched', () => {
    const data = cacheWith({ runs: [{ id: 'r1', status: 'running' }, { id: 'r2', status: 'running' }] });
    const rows = applyLifecycleEvent(data, {
      kind: 'workflow_run.completed',
      data: { workflowRunId: 'r2' },
    }).patch?.rows;
    expect(rows?.[0]).toEqual({ id: 'r1', status: 'running' });
    expect(rows?.[1]).toMatchObject({ id: 'r2', status: 'completed' });
  });

  it('does not invent a row for a status event about something it has not loaded', () => {
    // A run outside the fetched page, or a list never opened. Inserting here
    // would produce a row with a status and nothing else.
    expect(
      applyLifecycleEvent(emptyCache, { kind: 'workflow_run.completed', data: { workflowRunId: 'r9' } }),
    ).toEqual({});
  });

  it('applies chat mode and agent changes in place', () => {
    const data = cacheWith({ chats: [{ id: 'c1', permissionMode: 'default' }] });
    expect(
      applyLifecycleEvent(data, {
        kind: 'chat.mode_changed',
        data: { chatId: 'c1', previous: 'default', next: 'plan' },
      }).patch?.rows[0],
    ).toMatchObject({ permissionMode: 'plan' });

    // Unbinding an agent sends the key with no value — reading the KEY
    // rather than testing the string is what makes "cleared" expressible.
    expect(
      applyLifecycleEvent(data, { kind: 'chat.agent_changed', data: { chatId: 'c1' } }).patch?.rows[0],
    ).toMatchObject({ agentRef: undefined });
  });

  it('ignores automation execution events — they do not change an automation ROW', () => {
    // Refetching the list on every execution transition would be one request
    // per iteration of a batch automation, to redraw identical rows.
    const data = cacheWith({ automations: [{ id: 'a1', name: 'nightly' }] });
    expect(
      applyLifecycleEvent(data, {
        kind: 'automation_execution.completed',
        data: { executionId: 'e1', automationId: 'a1' },
      }),
    ).toEqual({});
  });

  it('ignores anything that is not a lifecycle kind', () => {
    expect(applyLifecycleEvent(emptyCache, { kind: 'harness.token', data: { text: 'x' } })).toEqual({});
  });
});

// ── Reconciler integration ─────────────────────────────────────────

function fakeStream(): StreamPort & {
  emit: (scope: string, id: string, event: { kind: string; data: Record<string, unknown> }) => void;
  scopes: () => string[];
} {
  const handlers = new Map<string, { scope: string; id: string; cb: (e: unknown) => void }>();
  let seq = 0;
  return {
    subscribe(scope: string, id: string, onEvent: (e: unknown) => void) {
      const key = `s${++seq}`;
      handlers.set(key, { scope, id, cb: onEvent });
      return () => handlers.delete(key);
    },
    emit(scope, id, event) {
      for (const entry of handlers.values()) {
        if (entry.scope === scope && entry.id === id) entry.cb(event);
      }
    },
    scopes: () => [...handlers.values()].map((h) => `${h.scope}:${h.id}`),
  } as unknown as StreamPort & {
    emit: (scope: string, id: string, event: { kind: string; data: Record<string, unknown> }) => void;
    scopes: () => string[];
  };
}

describe('the global lifecycle subscription', () => {
  it('opens exactly one, addressed at global/all', () => {
    const store = createTuiStore();
    setStore(store);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();

    expect(stream.scopes().filter((s) => s.startsWith('global'))).toEqual(['global:all']);
    stop();
    expect(stream.scopes().filter((s) => s.startsWith('global'))).toEqual([]);
  });

  it('patches the list cache from a live delete', () => {
    const store = createTuiStore();
    setStore(store);
    store.getState().setData('chats', [{ id: 'c1' }, { id: 'c2' }]);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();

    stream.emit('global', 'all', { kind: 'chat.deleted', data: { chatId: 'c1' } });
    expect(store.getState().data.chats).toEqual([{ id: 'c2' }]);
    stop();
  });

  it('reports a creation to the owner ONCE for a burst, not once per event', async () => {
    const onStale = vi.fn();
    const store = createTuiStore();
    setStore(store);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start({ onStale });

    for (let i = 0; i < 5; i++) {
      stream.emit('global', 'all', { kind: 'chat.created', data: { chatId: `c${i}` } });
    }
    expect(onStale).not.toHaveBeenCalled();

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith(['chats']);
    stop();
  });
});

describe('hidden-pane flush tiering', () => {
  const chatPane = (id: string) => ({
    kind: 'chat' as const,
    entityId: id,
    title: `chat ${id}`,
    attachment: { scope: 'chat' as const, id },
  });

  it('holds a hidden pane\'s events back, then applies them — never drops one', async () => {
    // The point is COST, not data: pausing the subscription would lose
    // messages the user expects to find on switching back.
    const store = createTuiStore();
    setStore(store);
    const visibleId = store.getState().openPane(chatPane('seen'), 'tab');
    const hiddenId = store.getState().openPane(chatPane('unseen'), 'split-v');
    store.getState().setVisiblePaneIds(new Set([visibleId]));

    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();

    stream.emit('chat', 'unseen', { kind: 'harness.message_complete', data: { content: 'hi' } });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Still buffered — the microtask flush deliberately skipped it.
    expect(store.getState().timelines[hiddenId]).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(store.getState().timelines[hiddenId]?.items).toHaveLength(1);
    expect(store.getState().timelines[hiddenId]?.items[0]?.text).toBe('hi');
    stop();
  });

  it('flushes a hidden pane immediately once it becomes visible', async () => {
    const store = createTuiStore();
    setStore(store);
    const visibleId = store.getState().openPane(chatPane('seen'), 'tab');
    const hiddenId = store.getState().openPane(chatPane('unseen'), 'split-v');
    store.getState().setVisiblePaneIds(new Set([visibleId]));

    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();
    stream.emit('chat', 'unseen', { kind: 'harness.message_complete', data: { content: 'hi' } });
    await Promise.resolve();
    expect(store.getState().timelines[hiddenId]).toBeUndefined();

    // Switching to it must not wait on the background timer.
    store.getState().setVisiblePaneIds(new Set([visibleId, hiddenId]));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().timelines[hiddenId]?.items).toHaveLength(1);
    stop();
  });

  it('applies a visible pane on the microtask, as before', async () => {
    const store = createTuiStore();
    setStore(store);
    const visibleId = store.getState().openPane(chatPane('seen'), 'tab');
    store.getState().setVisiblePaneIds(new Set([visibleId]));

    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();
    stream.emit('chat', 'seen', { kind: 'harness.message_complete', data: { content: 'hi' } });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().timelines[visibleId]?.items).toHaveLength(1);
    stop();
  });
});

describe('stream health counters', () => {
  it('counts what arrived, what was applied, and how deep the queue got', async () => {
    const store = createTuiStore();
    setStore(store);
    const paneId = store.getState().openPane(
      { kind: 'chat', entityId: 'c1', title: 'c', attachment: { scope: 'chat', id: 'c1' } },
      'tab',
    );
    store.getState().setVisiblePaneIds(new Set([paneId]));

    const stream = fakeStream();
    const reconciler = new StreamReconciler(store, stream);
    const stop = reconciler.start();

    for (let i = 0; i < 10; i++) {
      stream.emit('chat', 'c1', { kind: 'harness.token', data: { text: `t${i}` } });
    }
    expect(reconciler.stats().received).toBe(10);
    expect(reconciler.stats().queueDepthPeak).toBe(10);
    expect(reconciler.stats().globalAttached).toBe(true);
    expect(reconciler.stats().subscriptions).toBe(1);

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ten events, ONE store update — the expensive unit is the flush.
    expect(reconciler.stats().applied).toBe(10);
    expect(reconciler.stats().flushes).toBe(1);
    expect(reconciler.stats().queueDepth).toBe(0);
    stop();
  });
});
