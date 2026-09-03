// ────────────────────────────────────────────────────────────────
// Long-running resource behaviour (Phase 9 item 4).
//
// A TUI is a process that stays up for days. Every leak here is invisible
// for the first hour and fatal by the end of the week, and none of them
// throws — the app just gets slower and heavier until it is killed:
//
//   - pane ids come from an ever-incrementing counter and are never reused,
//     so a per-pane `Record` that is not cleaned on close grows forever;
//   - a stream subscription not disposed on close keeps delivering into a
//     pane nobody can see;
//   - buffered events flushed after a pane closes RESURRECT its timeline
//     entry, undoing the cleanup a moment after it happened;
//   - a timeline with no bound grows with the conversation.
//
// Everything here is hermetic: a fake `StreamPort` stands in for the mux
// client, so this is about lifecycle bookkeeping, not transport.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { StreamPort } from '@generatorai/cli-core';
import { createTuiStore, setStore, StreamReconciler } from '../store.js';

/** A `StreamPort` that records every subscribe/dispose so leaks are countable. */
function fakeStream(): StreamPort & {
  live: () => number;
  emit: (scope: string, id: string, event: { kind: string; data: Record<string, unknown> }) => void;
} {
  const handlers = new Map<string, { scope: string; id: string; cb: (e: unknown) => void }>();
  let seq = 0;
  return {
    subscribe(scope, id, onEvent) {
      const key = `s${++seq}`;
      handlers.set(key, { scope, id, cb: onEvent as (e: unknown) => void });
      return () => handlers.delete(key);
    },
    // PANE subscriptions only. The reconciler also holds exactly one
    // process-wide `global`/`all` subscription for entity lifecycle events
    // (open question #4), which is not a per-pane resource and would
    // otherwise show up as an off-by-one in every count here.
    live: () => [...handlers.values()].filter((h) => h.scope !== 'global').length,
    emit(scope, id, event) {
      for (const entry of handlers.values()) {
        if (entry.scope === scope && entry.id === id) entry.cb(event);
      }
    },
  } as unknown as StreamPort & {
    live: () => number;
    emit: (scope: string, id: string, event: { kind: string; data: Record<string, unknown> }) => void;
  };
}

const chatPane = (id: string) =>
  ({
    kind: 'chat' as const,
    entityId: id,
    title: `chat ${id}`,
    attachment: { scope: 'chat' as const, id },
  });

describe('per-pane state cleanup', () => {
  it('leaves nothing behind after a hundred open/close cycles', () => {
    // Pane ids are never reused (`PaneModel.nextId`), so an uncleaned entry
    // is unreachable AND permanent — the worst combination.
    const store = createTuiStore();
    setStore(store);

    for (let i = 0; i < 100; i++) {
      const paneId = store.getState().openPane(chatPane(`c${i}`), 'tab');
      store.getState().applyEvent(paneId, { kind: 'harness.message_complete', data: { content: 'hi' } });
      store.getState().setSelection(paneId, 3);
      store.getState().setSearch(paneId, 'query');
      store.getState().setVerbosity(paneId, 'verbose');
      store.getState().closeActiveTab();
    }

    const state = store.getState();
    // One tab always survives — `closeTab` recreates a dashboard rather than
    // leaving the workbench with nothing to draw.
    expect(state.workbench.tabs).toHaveLength(1);
    expect(Object.keys(state.timelines)).toHaveLength(0);
    expect(Object.keys(state.selection)).toHaveLength(0);
    expect(Object.keys(state.search)).toHaveLength(0);
    expect(Object.keys(state.verbosity)).toHaveLength(0);
    expect(Object.keys(state.unseen)).toHaveLength(0);
  });

  it('cleans up a closed PANE inside a tab that stays open', () => {
    const store = createTuiStore();
    setStore(store);
    const first = store.getState().openPane(chatPane('a'), 'tab');
    const second = store.getState().openPane(chatPane('b'), 'split-h');
    store.getState().applyEvent(first, { kind: 'harness.message_complete', data: { content: 'x' } });
    store.getState().applyEvent(second, { kind: 'harness.message_complete', data: { content: 'y' } });
    expect(Object.keys(store.getState().timelines)).toHaveLength(2);

    store.getState().closeActivePane();
    expect(Object.keys(store.getState().timelines)).toEqual([first]);
  });
});

describe('stream subscription lifecycle', () => {
  it('disposes every subscription when the reconciler stops', () => {
    const store = createTuiStore();
    setStore(store);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();

    for (let i = 0; i < 20; i++) store.getState().openPane(chatPane(`c${i}`), 'tab');
    expect(stream.live()).toBe(20);

    stop();
    expect(stream.live()).toBe(0);
  });

  it('holds one subscription per attached pane across churn, not one per open', () => {
    // Reconciling from the pane tree is what makes the live-socket set a
    // pure function of what is on screen; a subscribe-on-mount design leaks
    // one per unmount that raced a re-render.
    const store = createTuiStore();
    setStore(store);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();

    for (let i = 0; i < 50; i++) {
      store.getState().openPane(chatPane(`c${i}`), 'tab');
      if (i % 2 === 1) store.getState().closeActiveTab();
    }
    expect(stream.live()).toBe(25);

    stop();
    expect(stream.live()).toBe(0);
  });

  it('never resurrects a closed pane from events buffered before it closed', async () => {
    // `enqueue` buffers and flushes on a microtask; a pane closed in between
    // would otherwise have its timeline entry recreated by the flush, a
    // moment after teardown deleted it.
    const store = createTuiStore();
    setStore(store);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();

    const paneId = store.getState().openPane(chatPane('doomed'), 'tab');
    stream.emit('chat', 'doomed', { kind: 'harness.message_complete', data: { content: 'late' } });
    store.getState().closeActiveTab();

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().timelines[paneId]).toBeUndefined();
    stop();
  });
});

describe('bounded memory under sustained events', () => {
  it('keeps a pane timeline bounded through a long burst', () => {
    // The soak budget ("heap growth bounded over two hours at 100 events/s")
    // rests entirely on this cap holding.
    const store = createTuiStore();
    setStore(store);
    const paneId = store.getState().openPane(chatPane('busy'), 'tab');

    const events = Array.from({ length: 6000 }, (_, i) => ({
      kind: 'harness.message_complete',
      data: { content: `m${i}` },
    }));
    // Through `applyEvents`, the coalesced path the reconciler actually uses.
    for (let at = 0; at < events.length; at += 250) {
      store.getState().applyEvents(paneId, events.slice(at, at + 250));
    }

    const items = store.getState().timelines[paneId]?.items ?? [];
    expect(items.length).toBeLessThanOrEqual(2000);
    expect(items.at(-1)?.text).toBe('m5999');
  });

  it('coalesces a burst into ONE store notification instead of one per event', async () => {
    // Every store update also re-runs attachment reconciliation over the
    // whole workbench (audit §6.4), so a notification per token is the
    // expensive part, not the reduction.
    const store = createTuiStore();
    setStore(store);
    const stream = fakeStream();
    const stop = new StreamReconciler(store, stream).start();
    store.getState().openPane(chatPane('fast'), 'tab');

    const notified = vi.fn();
    const unsubscribe = store.subscribe(notified);
    for (let i = 0; i < 200; i++) {
      stream.emit('chat', 'fast', { kind: 'harness.token', data: { delta: `t${i}` } });
    }
    expect(notified).not.toHaveBeenCalled(); // still buffered

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notified.mock.calls.length).toBeLessThanOrEqual(2);

    unsubscribe();
    stop();
  });
});
