import { describe, expect, it } from 'vitest';
import type { Api, PaneContent, WorkbenchState } from '@generatorai/cli-core';
import { leaves } from '@generatorai/cli-core';
import { createTuiStore } from '../store.js';
import { openEntity, type Opener } from '../open.js';

function findPaneContent(workbench: WorkbenchState, paneId: string): PaneContent | undefined {
  for (const tab of workbench.tabs) {
    for (const leaf of leaves(tab.root)) {
      if (leaf.id === paneId) return leaf.content;
    }
  }
  return undefined;
}

/** Deferred promise, so the test controls exactly when `build()` resolves. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('openEntity — stable pane handle, no focus race', () => {
  it("targets the pane it created, not whatever is focused when build() resolves later", async () => {
    const store = createTuiStore();
    const actions = store.getState();
    const open = (
      content: PaneContent,
      mode?: 'tab' | 'split-v' | 'split-h' | 'replace',
      targetPaneId?: string,
    ): string => actions.openPane(content, mode, targetPaneId);

    const gate = deferred<PaneContent>();
    const openerA: Opener = {
      kind: 'chat',
      build: () => gate.promise,
    };

    // Start opening row A. This synchronously creates A's placeholder pane
    // and returns from `open()` — but `openEntity`'s own promise is still
    // in flight, waiting on `gate.promise`.
    const entityAPromise = openEntity({
      opener: openerA,
      row: { id: 'a1', name: 'Row A' },
      api: {} as Api,
      open,
      actions,
    });

    // Before A's build() resolves, something else changes focus — the exact
    // race the fix targets: a second Enter-press opening another tab (using
    // `actions.openPane` directly, exactly like a second `openEntity` call's
    // own placeholder-open would).
    actions.openPane({ kind: 'chats', title: 'Row B placeholder' }, 'tab');
    const tabsAfterB = store.getState().workbench.tabs;
    expect(tabsAfterB).toHaveLength(3); // dashboard + A's placeholder + B's placeholder
    const paneIdB = tabsAfterB.at(-1)!.focusedPaneId;

    // NOW A's build() resolves — well after focus moved to B's tab.
    gate.resolve({ kind: 'chat', entityId: 'a1', title: 'A resolved' });
    await entityAPromise;

    const finalWorkbench = store.getState().workbench;
    // A's own placeholder pane (the SECOND tab, created before B's) must
    // have received A's resolved content.
    const aTab = finalWorkbench.tabs[1]!;
    expect(aTab.root.type).toBe('leaf');
    expect((aTab.root as { type: 'leaf'; content: PaneContent }).content.title).toBe('A resolved');

    // B's placeholder must be UNTOUCHED — A's content must not have leaked
    // onto "whatever was focused" instead of its own pane.
    const bContent = findPaneContent(finalWorkbench, paneIdB);
    expect(bContent?.title).toBe('Row B placeholder');
  });

  it('seeds history onto the pane it created, even if focus moved away before the pane resolved', async () => {
    const store = createTuiStore();
    const actions = store.getState();
    const open = (
      content: PaneContent,
      mode?: 'tab' | 'split-v' | 'split-h' | 'replace',
      targetPaneId?: string,
    ): string => actions.openPane(content, mode, targetPaneId);

    const opener: Opener = {
      kind: 'chat',
      async build() {
        return { kind: 'chat', entityId: 'c1', title: 'Chat' };
      },
      async history() {
        return { items: [{ id: 'm1', kind: 'user', text: 'hi', complete: true, at: Date.now() }], streamingItemId: null, currentStage: null, lastSequence: 0 };
      },
    };

    await openEntity({ opener, row: { id: 'c1', name: 'Chat' }, api: {} as Api, open, actions });

    // Change focus AFTER openEntity settles but before its detached
    // `history()` promise (chained, not awaited by openEntity itself) has a
    // chance to run its microtasks.
    actions.openPane({ kind: 'chats', title: 'Elsewhere' }, 'tab');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const chatPaneId = store.getState().workbench.tabs[1]!.root.type === 'leaf'
      ? store.getState().workbench.tabs[1]!.root.id
      : undefined;
    expect(chatPaneId).toBeDefined();
    expect(store.getState().timelines[chatPaneId!]?.items).toHaveLength(1);
  });
});
