import { describe, expect, it } from 'vitest';
import { blockedWorkItems, createTuiStore, StreamReconciler } from '../store.js';
import type { StreamPort } from '@generatorai/cli-core';

describe('pane teardown — timelines/selection/search cleanup', () => {
  it('closeActivePane removes the closed pane\'s entries from timelines, selection and search', () => {
    const store = createTuiStore();
    const actions = store.getState();

    // Split so closing the focused pane does not also close the whole tab —
    // isolates this test to the cleanup itself, not closePane's own
    // tab-collapsing behavior (already covered by closePane.test.ts).
    actions.openPane({ kind: 'chats', title: 'Sibling' }, 'split-v');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.applyEvent(paneId, { kind: 'harness.user_message', data: { content: 'hi' } });
    actions.setSelection(paneId, 3);
    actions.setSearch(paneId, 'query');
    expect(store.getState().timelines[paneId]).toBeDefined();
    expect(store.getState().selection[paneId]).toBe(3);
    expect(store.getState().search[paneId]).toBe('query');

    actions.closeActivePane();

    expect(store.getState().timelines[paneId]).toBeUndefined();
    expect(store.getState().selection[paneId]).toBeUndefined();
    expect(store.getState().search[paneId]).toBeUndefined();
  });

  it('closeActiveTab removes EVERY pane in that tab, not just the focused one', () => {
    const store = createTuiStore();
    const actions = store.getState();

    actions.openPane({ kind: 'chats', title: 'Tab with a split' }, 'tab');
    actions.openPane({ kind: 'runs', title: 'Sibling' }, 'split-v');
    const tab = store.getState().workbench.tabs.at(-1)!;
    const paneIds =
      tab.root.type === 'split' ? [tab.root.first.id, tab.root.second.id] : [tab.root.id];
    expect(paneIds).toHaveLength(2);

    for (const id of paneIds) {
      actions.setSelection(id, 1);
      actions.setSearch(id, 'x');
    }
    expect(store.getState().selection[paneIds[0]!]).toBe(1);
    expect(store.getState().selection[paneIds[1]!]).toBe(1);

    actions.closeActiveTab();

    for (const id of paneIds) {
      expect(store.getState().selection[id]).toBeUndefined();
      expect(store.getState().search[id]).toBeUndefined();
    }
  });

  it('does not touch OTHER panes\' entries when one pane closes', () => {
    const store = createTuiStore();
    const actions = store.getState();

    actions.openPane({ kind: 'chats', title: 'Survivor' }, 'tab');
    const survivorId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.setSelection(survivorId, 7);

    actions.openPane({ kind: 'runs', title: 'Doomed' }, 'tab');
    const doomedId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.setSelection(doomedId, 2);

    actions.closeActiveTab(); // closes "Doomed" (the active tab)

    expect(store.getState().selection[survivorId]).toBe(7);
    expect(store.getState().selection[doomedId]).toBeUndefined();
  });

  it('pane ids are never reused, so a leaked entry could never be reclaimed by coincidence — the cleanup has to be explicit', () => {
    const store = createTuiStore();
    const actions = store.getState();

    actions.openPane({ kind: 'chats', title: 'First' }, 'tab');
    const firstId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.closeActiveTab();

    actions.openPane({ kind: 'chats', title: 'Second' }, 'tab');
    const secondId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    expect(secondId).not.toBe(firstId);
  });
});

describe('StreamReconciler — coalescing (Phase 3 item 5)', () => {
  /** A `StreamPort` whose `subscribe` hands the caller its handler directly, so a test can fire events on demand. */
  function fakeStream(): { port: StreamPort; fire: (scope: string, id: string, event: { kind: string; data: Record<string, unknown>; sequence?: number }) => void } {
    const handlers = new Map<string, (event: { kind: string; data: Record<string, unknown>; sequence?: number }) => void>();
    const port: StreamPort = {
      subscribe(scope, id, handler) {
        handlers.set(`${scope}:${id}`, handler);
        return () => handlers.delete(`${scope}:${id}`);
      },
    };
    return {
      port,
      fire: (scope, id, event) => handlers.get(`${scope}:${id}`)?.(event),
    };
  }

  it('folds a burst of same-tick events into exactly one store update, applied in order', async () => {
    const store = createTuiStore();
    const { port, fire } = fakeStream();
    const reconciler = new StreamReconciler(store, port);
    const stop = reconciler.start();

    store.getState().openPane({ kind: 'chats', entityId: 'c1', title: 'Chat', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    let renders = 0;
    const unsubscribe = store.subscribe(() => renders++);
    renders = 0; // ignore whatever `start()`/`openPane` already triggered

    // Three token deltas fired in the same tick — a real burst.
    fire('chat', 'c1', { kind: 'harness.token', data: { text: 'a' } });
    fire('chat', 'c1', { kind: 'harness.token', data: { text: 'b' } });
    fire('chat', 'c1', { kind: 'harness.token', data: { text: 'c' } });

    expect(renders).toBe(0); // nothing applied yet — still buffered
    await Promise.resolve(); // let the coalescing microtask run
    await Promise.resolve();

    expect(renders).toBe(1); // one store update for all three
    expect(store.getState().timelines[paneId]?.items.at(-1)?.text).toBe('abc');

    unsubscribe();
    stop();
  });

  it('drops events buffered for a pane that closed before the flush ran, instead of resurrecting its timeline', async () => {
    const store = createTuiStore();
    const { port, fire } = fakeStream();
    const reconciler = new StreamReconciler(store, port);
    const stop = reconciler.start();

    store.getState().openPane({ kind: 'chats', entityId: 'c1', title: 'Chat', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    fire('chat', 'c1', { kind: 'harness.token', data: { text: 'late' } });
    store.getState().closeActiveTab(); // reconcile() disposes the subscription synchronously

    await Promise.resolve();
    await Promise.resolve();

    // The teardown (item 7) already deleted this; a resurrected entry here
    // would mean the coalescing buffer outlived the pane it was for.
    expect(store.getState().timelines[paneId]).toBeUndefined();

    stop();
  });
});

describe('resizePane / moveTab / lastTab actions (Phase 4 item 4)', () => {
  it('resizePane mutates the focused split, both directions', () => {
    const store = createTuiStore();
    store.getState().openPane({ kind: 'chats', title: 'Chat' }, 'split-v');
    const root = store.getState().workbench.tabs[0]!.root as { ratio: number };
    const before = root.ratio;

    store.getState().resizePane('grow');
    const afterGrow = (store.getState().workbench.tabs[0]!.root as { ratio: number }).ratio;
    expect(afterGrow).not.toBe(before);

    store.getState().resizePane('shrink');
    store.getState().resizePane('shrink');
    const afterShrink = (store.getState().workbench.tabs[0]!.root as { ratio: number }).ratio;
    expect(afterShrink).not.toBe(afterGrow);
  });

  it('moveTab reorders the ACTIVE tab, wherever it is', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'First' }, 'tab');
    actions.openPane({ kind: 'runs', title: 'Second' }, 'tab');
    const firstId = store.getState().workbench.tabs[1]!.id; // "First" landed at index 1 (after Dashboard)
    actions.focusTab(1); // "moveTab" operates on whichever tab is active — make it "First"

    actions.moveTab(1);
    expect(store.getState().workbench.tabs[2]!.id).toBe(firstId);
  });

  it('lastTab pings back to the previously active tab', () => {
    const store = createTuiStore();
    const actions = store.getState();
    const dashId = store.getState().workbench.activeTabId;
    actions.openPane({ kind: 'chats', title: 'Chat' }, 'tab');
    const chatId = store.getState().workbench.activeTabId;

    actions.lastTab();
    expect(store.getState().workbench.activeTabId).toBe(dashId);
    actions.lastTab();
    expect(store.getState().workbench.activeTabId).toBe(chatId);
  });
});

describe('unseen output tracking (Phase 4 item 7)', () => {
  it('marks a pane unseen when an event lands while its tab is NOT active', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Background', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const backgroundPaneId = store.getState().workbench.activeTabId; // tab id === focused pane's tab; use the pane id below instead
    const bgPaneId = store.getState().workbench.tabs.find((t) => t.id === backgroundPaneId)!.focusedPaneId;

    actions.openPane({ kind: 'dashboard', title: 'Foreground' }, 'tab'); // now active — Background is no longer visible

    actions.applyEvent(bgPaneId, { kind: 'harness.token', data: { text: 'hi' } });

    expect(store.getState().unseen[bgPaneId]).toBe(true);
  });

  it('does NOT mark a pane unseen when the event lands while its tab IS active', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Chat', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.applyEvent(paneId, { kind: 'harness.token', data: { text: 'hi' } });

    expect(store.getState().unseen[paneId]).toBeUndefined();
  });

  it('markSeen clears the flag (what Pane calls on every render of a visible pane)', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Background', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const bgPaneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.openPane({ kind: 'dashboard', title: 'Foreground' }, 'tab');
    actions.applyEvent(bgPaneId, { kind: 'harness.token', data: { text: 'hi' } });
    expect(store.getState().unseen[bgPaneId]).toBe(true);

    actions.markSeen(bgPaneId);

    expect(store.getState().unseen[bgPaneId]).toBeUndefined();
  });

  it('markSeen is a genuine no-op (no new object) when there is nothing to clear', () => {
    const store = createTuiStore();
    const before = store.getState().unseen;
    store.getState().markSeen('nonexistent-pane');
    expect(store.getState().unseen).toBe(before); // same reference — no `set()` mutation happened
  });

  it('closing a pane/tab removes its unseen entry too (no leak alongside timelines/selection/search)', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Background', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const bgTabId = store.getState().workbench.activeTabId;
    const bgPaneId = store.getState().workbench.tabs.find((t) => t.id === bgTabId)!.focusedPaneId;
    actions.openPane({ kind: 'dashboard', title: 'Foreground' }, 'tab');
    actions.applyEvent(bgPaneId, { kind: 'harness.token', data: { text: 'hi' } });
    expect(store.getState().unseen[bgPaneId]).toBe(true);

    actions.focusTab(store.getState().workbench.tabs.findIndex((t) => t.id === bgTabId));
    actions.closeActiveTab();

    expect(store.getState().unseen[bgPaneId]).toBeUndefined();
  });

  it('marks a pane unseen when it is in the ACTIVE tab but zoom/breakpoint collapsed it off screen (regression: used to require a different tab entirely)', () => {
    // Before the fix, `isPaneInActiveTab` only checked "is this leaf
    // anywhere in the active tab's tree" — true for BOTH panes of a split
    // even when zoom or a narrow terminal renders only one of them. This
    // drives the real symptom: two panes in the SAME (active) tab, only one
    // of which `App.tsx` actually reports as painted via `setVisiblePaneIds`.
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Visible', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const visibleId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.openPane({ kind: 'runs', title: 'Hidden by zoom' }, 'split-v');
    const hiddenId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    // Both panes are leaves of the SAME active tab — the old, coarser check
    // would call both "visible." Report only `visibleId` as actually
    // painted, matching what a zoomed or breakpoint-collapsed render does.
    actions.setVisiblePaneIds(new Set([visibleId]));

    // A REAL event kind: the reducer returns the state unchanged for one it
    // does not model, and an event that changes nothing on screen must not
    // raise a "new content" badge (see the next test).
    actions.applyEvent(hiddenId, { kind: 'run.status', data: { status: 'running' } });
    expect(store.getState().unseen[hiddenId]).toBe(true);

    // The genuinely visible pane in the same tab must NOT be flagged.
    actions.applyEvent(visibleId, { kind: 'harness.token', data: { text: 'hi' } });
    expect(store.getState().unseen[visibleId]).toBeUndefined();
  });

  it('does not badge a tab for an event that changed nothing on screen', () => {
    // The badge means "new content arrived while you were not looking". An
    // event this app does not model produces no content, so badging for it
    // is a notification about nothing — and the server emits plenty of
    // kinds no pane renders. The reducer returns the SAME object for those,
    // which is also what keeps a store update (and with it a full
    // reconciliation pass over the workbench) from happening at all.
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Visible' }, 'tab');
    const visibleId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.openPane({ kind: 'runs', title: 'Hidden' }, 'split-v');
    const hiddenId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;
    actions.setVisiblePaneIds(new Set([visibleId]));

    actions.applyEvent(hiddenId, { kind: 'some.kind.no.pane.renders', data: {} });
    expect(store.getState().unseen[hiddenId]).toBeUndefined();
    expect(store.getState().timelines[hiddenId]).toBeUndefined();

    // …but one that DOES produce content still badges it.
    actions.applyEvent(hiddenId, { kind: 'harness.message_complete', data: { content: 'done' } });
    expect(store.getState().unseen[hiddenId]).toBe(true);
  });

  it('falls back to the coarser tab-membership check before any render has reported real visibility', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Chat', attachment: { scope: 'chat', id: 'c1' } }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    expect(store.getState().visiblePaneIds).toBeNull(); // App.tsx's effect hasn't run in this test
    actions.applyEvent(paneId, { kind: 'harness.token', data: { text: 'hi' } });

    // Falls back to "is it in the active tab's tree" — true here — rather
    // than treating everything as unseen just because nothing has reported
    // real visibility yet.
    expect(store.getState().unseen[paneId]).toBeUndefined();
  });
});

// Phase 6 item 4 — per-pane run verbosity. Absent (never touched `v`) must
// reproduce today's exact behavior (reasoning + tool calls always shown) —
// that invariant is what every OTHER pane, and every run pane that hasn't
// changed it, still relies on.
describe('per-pane verbosity (Phase 6 item 4)', () => {
  it('defaults to showing reasoning and tool calls, same as before verbosity existed', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'runs', title: 'Run' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.applyEvent(paneId, { kind: 'harness.reasoning_delta', data: { text: 'thinking...' } });
    actions.applyEvent(paneId, { kind: 'harness.tool_start', data: { tool: 'grep' } });

    const items = store.getState().timelines[paneId]?.items ?? [];
    expect(items.some((i) => i.kind === 'thinking')).toBe(true);
    expect(items.some((i) => i.kind === 'tool')).toBe(true);
  });

  it("'minimal' drops both reasoning and tool-start items going forward", () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'runs', title: 'Run' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.setVerbosity(paneId, 'minimal');
    actions.applyEvent(paneId, { kind: 'harness.reasoning_delta', data: { text: 'thinking...' } });
    actions.applyEvent(paneId, { kind: 'harness.tool_start', data: { tool: 'grep' } });

    const items = store.getState().timelines[paneId]?.items ?? [];
    expect(items).toHaveLength(0);
  });

  it("'verbose' is required for reasoning; 'normal' still shows tool calls but not reasoning", () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'runs', title: 'Run' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.setVerbosity(paneId, 'normal');
    actions.applyEvent(paneId, { kind: 'harness.reasoning_delta', data: { text: 'thinking...' } });
    actions.applyEvent(paneId, { kind: 'harness.tool_start', data: { tool: 'grep' } });
    let items = store.getState().timelines[paneId]?.items ?? [];
    expect(items.some((i) => i.kind === 'thinking')).toBe(false);
    expect(items.some((i) => i.kind === 'tool')).toBe(true);

    actions.setVerbosity(paneId, 'verbose');
    actions.applyEvent(paneId, { kind: 'harness.reasoning_delta', data: { text: 'more thinking' } });
    items = store.getState().timelines[paneId]?.items ?? [];
    expect(items.some((i) => i.kind === 'thinking')).toBe(true);
  });

  it('applyEvents (the coalesced path) honors the same per-pane verbosity as applyEvent', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'runs', title: 'Run' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.setVerbosity(paneId, 'minimal');
    actions.applyEvents(paneId, [
      { kind: 'harness.reasoning_delta', data: { text: 'x' } },
      { kind: 'harness.tool_start', data: { tool: 'grep' } },
    ]);
    expect(store.getState().timelines[paneId]?.items ?? []).toHaveLength(0);
  });

  it('is cleaned up on pane close, same as timelines/selection/search', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Sibling' }, 'split-v');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.setVerbosity(paneId, 'minimal');
    expect(store.getState().verbosity[paneId]).toBe('minimal');
    actions.closeActivePane();
    expect(store.getState().verbosity[paneId]).toBeUndefined();
  });
});

// Phase 6 item 5 — global blocked-work/notification queue.
describe('blockedWorkItems + jumpToPane', () => {
  it('is empty when nothing is pending', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'runs', title: 'Run' }, 'tab');
    expect(blockedWorkItems(store.getState().workbench, store.getState().timelines)).toEqual([]);
  });

  it('surfaces a workflow-stage approval gate (`stage_run.awaiting_input`)', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'runs', title: 'Deploy run' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.applyEvent(paneId, {
      kind: 'stage_run.awaiting_input',
      data: { stageRunId: 'sr1', name: 'Approve deploy' },
    });

    const items = blockedWorkItems(store.getState().workbench, store.getState().timelines);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ paneId, gate: 'approval', summary: 'Stage awaiting input: Approve deploy' });
  });

  it('surfaces a chat-scoped plan-review gate (`chat.plan.review_requested`)', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'My chat' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.applyEvent(paneId, {
      kind: 'chat.plan.review_requested',
      data: { interactionId: 'i1', planId: 'p1', title: 'Refactor auth', summary: 'Big change.', actions: [] },
    });

    const items = blockedWorkItems(store.getState().workbench, store.getState().timelines);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ paneId, gate: 'interaction', summary: 'Plan review: Refactor auth' });
  });

  it('clears once the gate resolves (`chat.plan.decided`)', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'My chat' }, 'tab');
    const paneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.applyEvent(paneId, {
      kind: 'chat.plan.review_requested',
      data: { interactionId: 'i1', planId: 'p1', title: 'Refactor auth', summary: 'Big change.', actions: [] },
    });
    actions.applyEvent(paneId, { kind: 'chat.plan.decided', data: { interactionId: 'i1', approved: true } });

    expect(blockedWorkItems(store.getState().workbench, store.getState().timelines)).toEqual([]);
  });

  it('jumpToPane switches to the tab containing the pane and focuses it, even when that tab is not active', () => {
    const store = createTuiStore();
    const actions = store.getState();

    actions.openPane({ kind: 'chats', title: 'Blocked chat' }, 'tab');
    const blockedTabId = store.getState().workbench.activeTabId;
    const blockedPaneId = store.getState().workbench.tabs.at(-1)!.focusedPaneId;

    actions.openPane({ kind: 'runs', title: 'Unrelated run' }, 'tab');
    expect(store.getState().workbench.activeTabId).not.toBe(blockedTabId);

    actions.jumpToPane(blockedPaneId);

    expect(store.getState().workbench.activeTabId).toBe(blockedTabId);
    expect(store.getState().workbench.tabs.find((t) => t.id === blockedTabId)?.focusedPaneId).toBe(blockedPaneId);
  });

  it('jumpToPane is a no-op for an id that does not exist anywhere', () => {
    const store = createTuiStore();
    const actions = store.getState();
    actions.openPane({ kind: 'chats', title: 'Only tab' }, 'tab');
    const before = store.getState().workbench;

    actions.jumpToPane('no-such-pane');

    expect(store.getState().workbench).toBe(before);
  });
});
