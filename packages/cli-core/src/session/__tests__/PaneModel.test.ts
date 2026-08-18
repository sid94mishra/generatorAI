import { describe, it, expect } from 'vitest';
import {
  createWorkbench,
  addTab,
  closeTab,
  selectTab,
  cycleTab,
  renameTab,
  splitPane,
  closePane,
  focusPane,
  cyclePane,
  toggleZoom,
  updatePane,
  activeTab,
  leaves,
  findPane,
  allAttachments,
  serialise,
  deserialise,
} from '../PaneModel.js';

const dash = { kind: 'dashboard' as const, title: 'Dashboard' };
const chat = {
  kind: 'chat' as const,
  title: 'auth-refactor',
  entityId: 'chat-1',
  attachment: { scope: 'chat' as const, id: 'chat-1' },
};
const run = {
  kind: 'run' as const,
  title: 'nightly',
  entityId: 'run-1',
  attachment: { scope: 'run' as const, id: 'run-1' },
};

describe('workbench tabs', () => {
  it('starts with one tab holding one leaf', () => {
    const w = createWorkbench(dash);
    expect(w.tabs.length).toBe(1);
    expect(leaves(activeTab(w).root).length).toBe(1);
  });

  it('adds a tab and focuses it', () => {
    const w = addTab(createWorkbench(dash), chat);
    expect(w.tabs.length).toBe(2);
    expect(activeTab(w).title).toBe('auth-refactor');
  });

  it('never closes the last tab', () => {
    const w = createWorkbench(dash);
    expect(closeTab(w, w.tabs[0]!.id).tabs.length).toBe(1);
  });

  it('moves focus to a surviving tab when the active one closes', () => {
    let w = addTab(createWorkbench(dash), chat);
    const closing = activeTab(w).id;
    w = closeTab(w, closing);
    expect(w.tabs.length).toBe(1);
    expect(w.tabs.some((t) => t.id === closing)).toBe(false);
    expect(activeTab(w)).toBeDefined();
  });

  it('cycles tabs and wraps at both ends', () => {
    let w = addTab(addTab(createWorkbench(dash), chat), run);
    w = selectTab(w, w.tabs[0]!.id);
    expect(activeTab(cycleTab(w, -1)).id).toBe(w.tabs[2]!.id);
    w = selectTab(w, w.tabs[2]!.id);
    expect(activeTab(cycleTab(w, 1)).id).toBe(w.tabs[0]!.id);
  });

  it('renames a tab', () => {
    const w = createWorkbench(dash);
    expect(activeTab(renameTab(w, w.tabs[0]!.id, 'renamed')).title).toBe('renamed');
  });
});

describe('splits', () => {
  it('splits the focused pane into two leaves', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    expect(leaves(activeTab(w).root).length).toBe(2);
  });

  it('focuses the newly created pane', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const focused = findPane(activeTab(w).root, activeTab(w).focusedPaneId);
    expect(focused && focused.type === 'leaf' && focused.content.entityId).toBe('chat-1');
  });

  it('collapses the parent split when one side closes', () => {
    let w = splitPane(createWorkbench(dash), 'horizontal', chat);
    w = closePane(w);
    const root = activeTab(w).root;
    expect(root.type).toBe('leaf');
    expect(leaves(root).length).toBe(1);
  });

  it('never closes the last pane in a tab', () => {
    const w = closePane(createWorkbench(dash));
    expect(leaves(activeTab(w).root).length).toBe(1);
  });

  it('supports nested splits', () => {
    let w = splitPane(createWorkbench(dash), 'vertical', chat);
    w = splitPane(w, 'horizontal', run);
    expect(leaves(activeTab(w).root).length).toBe(3);
  });

  it('cycles focus across every leaf', () => {
    let w = splitPane(createWorkbench(dash), 'vertical', chat);
    w = splitPane(w, 'horizontal', run);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      seen.add(activeTab(w).focusedPaneId);
      w = cyclePane(w, 1);
    }
    expect(seen.size).toBe(3);
  });

  it('focuses a pane by id', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const target = leaves(activeTab(w).root)[0]!;
    expect(activeTab(focusPane(w, target.id)).focusedPaneId).toBe(target.id);
  });
});

describe('zoom', () => {
  it('toggles on and off', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const zoomed = toggleZoom(w);
    expect(activeTab(zoomed).zoomedPaneId).toBe(activeTab(w).focusedPaneId);
    expect(activeTab(toggleZoom(zoomed)).zoomedPaneId).toBeNull();
  });
});

describe('pane content', () => {
  it('updates a pane in place', () => {
    const w = createWorkbench(dash);
    const paneId = activeTab(w).focusedPaneId;
    const next = updatePane(w, paneId, { title: 'Overview' });
    const pane = findPane(activeTab(next).root, paneId);
    expect(pane && pane.type === 'leaf' && pane.content.title).toBe('Overview');
  });

  it('lists every attachment across all tabs for subscription bookkeeping', () => {
    let w = addTab(createWorkbench(dash), chat);
    w = splitPane(w, 'vertical', run);
    const attachments = allAttachments(w);
    expect(attachments.map((a) => a.id)).toContain('chat-1');
    expect(attachments.map((a) => a.id)).toContain('run-1');
    expect(attachments.map((a) => a.scope)).toContain('run');
  });

  it('omits panes that own no subscription', () => {
    // The dashboard has no attachment; counting it would leak an SSE slot.
    expect(allAttachments(createWorkbench(dash))).toEqual([]);
  });
});

describe('persistence', () => {
  it('round-trips tab content, titles and pane count', () => {
    let w = addTab(createWorkbench(dash), chat);
    w = splitPane(w, 'vertical', run);
    w = renameTab(w, activeTab(w).id, 'work');

    const restored = deserialise(serialise(w));
    expect(restored.tabs.length).toBe(w.tabs.length);
    expect(activeTab(restored).title).toBe('work');
    expect(leaves(activeTab(restored).root).length).toBe(2);
    expect(leaves(activeTab(restored).root).map((l) => l.content.entityId)).toEqual([
      'chat-1',
      'run-1',
    ]);
  });

  it('restores content rather than exact geometry', () => {
    // Geometry is rebuilt on purpose: replaying saved pixel ratios into a
    // resized terminal produces two-column panes.
    const w = splitPane(createWorkbench(dash), 'horizontal', chat);
    const restored = deserialise(serialise(w));
    expect(activeTab(restored).focusedPaneId).not.toBe(activeTab(w).focusedPaneId);
    expect(findPane(activeTab(restored).root, activeTab(restored).focusedPaneId)).toBeDefined();
  });

  it('keeps attachments so restored panes resubscribe', () => {
    const restored = deserialise(serialise(addTab(createWorkbench(dash), chat)));
    expect(allAttachments(restored).map((a) => a.id)).toContain('chat-1');
  });

  it('survives a JSON encode/decode cycle', () => {
    const w = splitPane(createWorkbench(dash), 'horizontal', chat);
    const restored = deserialise(JSON.parse(JSON.stringify(serialise(w))));
    expect(leaves(activeTab(restored).root).length).toBe(2);
  });

  it('falls back to a fresh workbench on an unknown schema version', () => {
    const restored = deserialise({ version: 9, tabs: [], activeTabIndex: 0 } as never);
    expect(restored.tabs.length).toBe(1);
  });
});
