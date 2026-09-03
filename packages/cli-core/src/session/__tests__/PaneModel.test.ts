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
  computeRects,
  focusDirectional,
  resizeSplit,
  moveTab,
  toggleLastTab,
  visibleLeafIds,
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
const workflow = { kind: 'workflow' as const, title: 'deploy', entityId: 'wf-1' };

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

describe('toggleLastTab (Phase 4 item 4 — tmux last-window)', () => {
  it('does nothing when there is no previous tab yet', () => {
    const w = createWorkbench(dash);
    expect(toggleLastTab(w)).toBe(w);
  });

  it('swaps back to the tab that was active before this one', () => {
    let w = addTab(createWorkbench(dash), chat); // now on "chat", previous is dashboard
    const chatTabId = activeTab(w).id;
    const dashTabId = w.tabs[0]!.id;
    w = toggleLastTab(w);
    expect(activeTab(w).id).toBe(dashTabId);
    // Pressing it again pings right back — not a one-way jump.
    w = toggleLastTab(w);
    expect(activeTab(w).id).toBe(chatTabId);
  });

  it('does not point at a tab that has since been closed', () => {
    let w = addTab(createWorkbench(dash), chat);
    w = addTab(w, run); // previous is now "chat", not dashboard
    const chatTabId = w.tabs[1]!.id;
    w = closeTab(w, chatTabId);
    // The "previous" tab no longer exists — toggling must not crash or
    // silently resurrect a reference to it.
    expect(() => toggleLastTab(w)).not.toThrow();
    expect(w.tabs.some((t) => t.id === chatTabId)).toBe(false);
  });
});

describe('moveTab', () => {
  it('moves the active tab one position later', () => {
    let w = addTab(addTab(createWorkbench(dash), chat), run);
    w = selectTab(w, w.tabs[0]!.id); // dashboard, at index 0
    const dashId = w.tabs[0]!.id;
    w = moveTab(w, 1);
    expect(w.tabs[1]!.id).toBe(dashId);
    expect(activeTab(w).id).toBe(dashId); // still the active tab, just reordered
  });

  it('is a no-op past either end — reordering does not wrap', () => {
    const w = addTab(createWorkbench(dash), chat); // active tab ("chat") is last
    const before = w.tabs.map((t) => t.id);
    const moved = moveTab(w, 1);
    expect(moved.tabs.map((t) => t.id)).toEqual(before);

    const first = selectTab(w, w.tabs[0]!.id);
    const beforeFirst = first.tabs.map((t) => t.id);
    expect(moveTab(first, -1).tabs.map((t) => t.id)).toEqual(beforeFirst);
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

describe('resizeSplit (Phase 4 item 4)', () => {
  it('is a no-op on a single-pane tab — there is nothing to resize', () => {
    const w = createWorkbench(dash);
    expect(resizeSplit(w, 'grow')).toBe(w);
  });

  it('grows the focused pane when it is `first`, shrinks it when it is `second`', () => {
    // Focus lands on the NEW leaf (`run`), which is `second`.
    const w = splitPane(createWorkbench(dash), 'vertical', run);
    const before = (activeTab(w).root as { ratio: number }).ratio;
    const grown = resizeSplit(w, 'grow');
    const grownRatio = (activeTab(grown).root as { ratio: number }).ratio;
    // `second` growing means `first`'s share (the stored ratio) shrinks.
    expect(grownRatio).toBeLessThan(before);

    const shrunk = resizeSplit(w, 'shrink');
    const shrunkRatio = (activeTab(shrunk).root as { ratio: number }).ratio;
    expect(shrunkRatio).toBeGreaterThan(before);
  });

  it('clamps at the minimum and maximum ratio — resize cannot squeeze a pane to nothing', () => {
    let w = splitPane(createWorkbench(dash), 'vertical', chat); // focus on `chat`, which is `second`
    for (let i = 0; i < 50; i++) w = resizeSplit(w, 'shrink'); // shrinking `second` GROWS ratio toward the ceiling
    const clamped = (activeTab(w).root as { ratio: number }).ratio;
    expect(clamped).toBeLessThanOrEqual(0.85);
    expect(clamped).toBeGreaterThan(0.5);

    let shrunkToFloor = splitPane(createWorkbench(dash), 'vertical', chat);
    for (let i = 0; i < 50; i++) shrunkToFloor = resizeSplit(shrunkToFloor, 'grow');
    const floored = (activeTab(shrunkToFloor).root as { ratio: number }).ratio;
    expect(floored).toBeGreaterThanOrEqual(0.15);
  });

  it('resizes the NEAREST split ancestor of the focused pane, not some outer one', () => {
    let w = splitPane(createWorkbench(dash), 'vertical', chat); // outer split
    w = splitPane(w, 'horizontal', run); // inner split, focus now on `run`
    const outerRatioBefore = (w.tabs[0]!.root as { ratio: number }).ratio;
    const resized = resizeSplit(w, 'grow');
    const outerRatioAfter = (resized.tabs[0]!.root as { ratio: number }).ratio;
    // The OUTER split (still holding the original 50/50 default) must be
    // untouched — only the inner one, immediately around the focused pane.
    expect(outerRatioAfter).toBe(outerRatioBefore);
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

  it('restores content rather than exact geometry when no viewport is known', () => {
    // Without a viewport there is no way to confirm the saved geometry is
    // still safe, so this falls back to flatten-and-resplit-evenly — the
    // ONLY behavior this function had before `version: 2` existed.
    const w = splitPane(createWorkbench(dash), 'horizontal', chat);
    const restored = deserialise(serialise(w));
    expect(activeTab(restored).focusedPaneId).not.toBe(activeTab(w).focusedPaneId);
    expect(findPane(activeTab(restored).root, activeTab(restored).focusedPaneId)).toBeDefined();
  });

  it('restores the REAL split geometry (direction + ratio) when a large-enough viewport is known (Phase 4 item 5)', () => {
    let w = splitPane(createWorkbench(dash), 'horizontal', chat);
    w = resizeSplit(w, 'grow'); // ratio now something other than the default 0.5
    const savedRatio = (activeTab(w).root as { ratio: number }).ratio;

    const restored = deserialise(serialise(w), { columns: 200, rows: 60 });
    const root = activeTab(restored).root;
    expect(root.type).toBe('split');
    if (root.type === 'split') {
      expect(root.direction).toBe('horizontal');
      expect(root.ratio).toBe(savedRatio);
    }
  });

  it('restores which pane was focused, by position, when real geometry is restored', () => {
    let w = splitPane(createWorkbench(dash), 'vertical', chat);
    w = splitPane(w, 'vertical', run); // focus now on the run leaf (3rd leaf overall)
    const restored = deserialise(serialise(w), { columns: 200, rows: 60 });
    const focused = findPane(activeTab(restored).root, activeTab(restored).focusedPaneId);
    expect(focused?.type === 'leaf' ? focused.content.entityId : undefined).toBe('run-1');
  });

  it('falls back to flatten-and-resplit-evenly, per tab, when the saved geometry would violate the minimum pane size in the CURRENT viewport', () => {
    // A lopsided split (most of the width to `first`) that was fine in a
    // wide terminal can leave `second` far under the usable minimum in a
    // narrow one.
    let w = splitPane(createWorkbench(dash), 'vertical', chat);
    for (let i = 0; i < 8; i++) w = resizeSplit(w, 'grow'); // push ratio toward the clamp ceiling

    const restoredWide = deserialise(serialise(w), { columns: 200, rows: 60 });
    const restoredNarrow = deserialise(serialise(w), { columns: 40, rows: 60 });

    // Wide enough: the real (lopsided) split survives.
    expect(restoredWide.tabs[0]!.root.type).toBe('split');
    // Narrow: restoring that same lopsided split would leave one pane under
    // the usable minimum — falls back to an even split instead.
    const narrowRoot = restoredNarrow.tabs[0]!.root;
    if (narrowRoot.type === 'split') expect(narrowRoot.ratio).toBe(0.5);
  });

  it('still restores an old version-1 saved file (backward compatibility)', () => {
    const legacy = {
      version: 1 as const,
      tabs: [{ title: 'work', panes: [chat, run] }],
      activeTabIndex: 0,
    };
    const restored = deserialise(legacy);
    expect(leaves(activeTab(restored).root).map((l) => l.content.entityId)).toEqual(['chat-1', 'run-1']);
    // The original version-1 behavior: focus lands on the LAST pane added.
    expect(activeTab(restored).focusedPaneId).toBe(leaves(activeTab(restored).root).at(-1)!.id);
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

describe('computeRects', () => {
  it('mirrors Split\'s own layout math: horizontal stacks (top/bottom), vertical sits side by side', () => {
    // `Split`'s own doc comment: "horizontal means the divider is horizontal,
    // i.e. the panes stack". Confirmed against packages/tui-kit/src/layout.tsx.
    const stacked = splitPane(createWorkbench(dash), 'horizontal', chat);
    const stackedRects = computeRects(activeTab(stacked).root, { x: 0, y: 0, width: 100, height: 40 });
    const dashId = leaves(activeTab(stacked).root)[0]!.id;
    const chatId = leaves(activeTab(stacked).root)[1]!.id;
    expect(stackedRects.get(dashId)).toEqual({ x: 0, y: 0, width: 100, height: 20 });
    expect(stackedRects.get(chatId)).toEqual({ x: 0, y: 20, width: 100, height: 20 });

    const sideBySide = splitPane(createWorkbench(dash), 'vertical', chat);
    const sideRects = computeRects(activeTab(sideBySide).root, { x: 0, y: 0, width: 100, height: 40 });
    const leftId = leaves(activeTab(sideBySide).root)[0]!.id;
    const rightId = leaves(activeTab(sideBySide).root)[1]!.id;
    expect(sideRects.get(leftId)).toEqual({ x: 0, y: 0, width: 50, height: 40 });
    expect(sideRects.get(rightId)).toEqual({ x: 50, y: 0, width: 50, height: 40 });
  });

  it('clamps an extreme ratio the same way Split does (15%..85%)', () => {
    let w = splitPane(createWorkbench(dash), 'vertical', chat);
    // Force an out-of-range ratio directly — nothing in the public API
    // produces one, but `computeRects` must not trust it blindly, matching
    // `Split`'s own `Math.max(0.15, Math.min(0.85, ratio))` clamp.
    const tab = activeTab(w);
    const clamped = { ...tab, root: { ...tab.root, ratio: 0.02 } as typeof tab.root };
    w = { ...w, tabs: w.tabs.map((t) => (t.id === tab.id ? clamped : t)) };
    const rects = computeRects(activeTab(w).root, { x: 0, y: 0, width: 100, height: 40 });
    const leftId = leaves(activeTab(w).root)[0]!.id;
    expect(rects.get(leftId)?.width).toBe(15); // 0.15 * 100, not 0.02 * 100
  });
});

describe('focusDirectional', () => {
  function twoByTwo() {
    // Column split first (dash | chat-column), then each column split
    // top/bottom — see the test file's comment trail for the exact
    // resulting grid: dash=top-left, run=bottom-left, chat=top-right,
    // workflow=bottom-right.
    let w = createWorkbench(dash);
    const dashId = activeTab(w).focusedPaneId;
    w = splitPane(w, 'vertical', chat); // dash | chat
    const chatId = activeTab(w).focusedPaneId;
    w = focusPane(w, dashId);
    w = splitPane(w, 'horizontal', run); // (dash/run) | chat
    const runId = activeTab(w).focusedPaneId;
    w = focusPane(w, chatId);
    w = splitPane(w, 'horizontal', workflow); // (dash/run) | (chat/workflow)
    const workflowId = activeTab(w).focusedPaneId;
    return { w, dashId, chatId, runId, workflowId };
  }

  it('agrees with reading order for a simple 2-pane horizontal (top/bottom) split', () => {
    const w = splitPane(createWorkbench(dash), 'horizontal', chat);
    const chatId = activeTab(w).focusedPaneId;
    const dashId = leaves(activeTab(w).root).find((l) => l.id !== chatId)!.id;

    const down = focusDirectional(focusPane(w, dashId), 'down', 100, 40);
    expect(activeTab(down).focusedPaneId).toBe(chatId);
    const up = focusDirectional(focusPane(w, chatId), 'up', 100, 40);
    expect(activeTab(up).focusedPaneId).toBe(dashId);
    // Pressing further in the same direction from the end is a no-op, not a wrap.
    expect(activeTab(focusDirectional(down, 'down', 100, 40)).focusedPaneId).toBe(chatId);
  });

  it('agrees with reading order for a simple 2-pane vertical (left/right) split', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const chatId = activeTab(w).focusedPaneId;
    const dashId = leaves(activeTab(w).root).find((l) => l.id !== chatId)!.id;

    const right = focusDirectional(focusPane(w, dashId), 'right', 100, 40);
    expect(activeTab(right).focusedPaneId).toBe(chatId);
    const left = focusDirectional(focusPane(w, chatId), 'left', 100, 40);
    expect(activeTab(left).focusedPaneId).toBe(dashId);
  });

  it('disagrees with reading order in a 2x2 grid — this is the case reading order gets wrong', () => {
    const { w, dashId, chatId, runId, workflowId } = twoByTwo();

    // Reading order (`cyclePane(+1)`) from top-left would land on
    // bottom-left (`run`) — the very next leaf in the tree — not top-right
    // (`chat`), which is what pressing the RIGHT arrow actually means.
    const readingOrderNext = activeTab(cyclePane(focusPane(w, dashId), 1)).focusedPaneId;
    expect(readingOrderNext).toBe(runId);

    const right = focusDirectional(focusPane(w, dashId), 'right', 100, 40);
    expect(activeTab(right).focusedPaneId).toBe(chatId); // NOT runId
    const down = focusDirectional(focusPane(w, dashId), 'down', 100, 40);
    expect(activeTab(down).focusedPaneId).toBe(runId);

    const upFromBottomRight = focusDirectional(focusPane(w, workflowId), 'up', 100, 40);
    expect(activeTab(upFromBottomRight).focusedPaneId).toBe(chatId);
    const leftFromBottomRight = focusDirectional(focusPane(w, workflowId), 'left', 100, 40);
    expect(activeTab(leftFromBottomRight).focusedPaneId).toBe(runId);
  });

  it('is a no-op with a single pane (not a crash, not a self-cycle)', () => {
    const w = createWorkbench(dash);
    const result = focusDirectional(w, 'right', 100, 40);
    expect(result).toBe(w);
  });

  it('falls back to reading order when the container size is degenerate (no usable rectangles)', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const chatId = activeTab(w).focusedPaneId;
    const dashId = leaves(activeTab(w).root).find((l) => l.id !== chatId)!.id;
    // Zero-size container: every rect collapses to zero width/height, so
    // there is nothing meaningfully "to the right" — this must still move
    // focus (via the cyclePane fallback), not silently do nothing.
    const moved = focusDirectional(focusPane(w, dashId), 'right', 0, 0);
    expect(activeTab(moved).focusedPaneId).toBe(chatId);
  });
});

describe('visibleLeafIds (Phase 4 item 7 follow-up — unseen-output indicator zoom/breakpoint fix)', () => {
  it('reports every leaf for an un-zoomed split at a wide breakpoint', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const tab = activeTab(w);
    const ids = visibleLeafIds(tab, { showRight: true, breakpoint: 'wide' });
    expect(ids).toEqual(new Set(leaves(tab.root).map((l) => l.id)));
    expect(ids.size).toBe(2);
  });

  it('reports ONLY the zoomed pane, even though the tree still has both leaves', () => {
    const w = toggleZoom(splitPane(createWorkbench(dash), 'vertical', chat));
    const tab = activeTab(w);
    expect(tab.zoomedPaneId).not.toBeNull();
    const ids = visibleLeafIds(tab, { showRight: true, breakpoint: 'wide' });
    expect(ids).toEqual(new Set([tab.zoomedPaneId]));
  });

  it('collapses to the side containing focus below the standard breakpoint, same as App.tsx renderNode', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const chatId = activeTab(w).focusedPaneId; // splitPane focuses the new pane
    const dashId = leaves(activeTab(w).root).find((l) => l.id !== chatId)!.id;

    const focusedOnChat = activeTab(w);
    expect(visibleLeafIds(focusedOnChat, { showRight: true, breakpoint: 'compact' })).toEqual(new Set([chatId]));
    expect(visibleLeafIds(focusedOnChat, { showRight: true, breakpoint: 'tiny' })).toEqual(new Set([chatId]));

    const focusedOnDash = activeTab(focusPane(w, dashId));
    expect(visibleLeafIds(focusedOnDash, { showRight: true, breakpoint: 'compact' })).toEqual(new Set([dashId]));
  });

  it('collapses to the focused side when the right pane is hidden, regardless of breakpoint', () => {
    const w = splitPane(createWorkbench(dash), 'vertical', chat);
    const chatId = activeTab(w).focusedPaneId;
    const ids = visibleLeafIds(activeTab(w), { showRight: false, breakpoint: 'wide' });
    expect(ids).toEqual(new Set([chatId]));
  });

  it('collapses correctly in a 2x2 grid — only the focused quadrant\'s leaf is visible when collapsed', () => {
    let w = createWorkbench(dash);
    const dashId = activeTab(w).focusedPaneId;
    w = splitPane(w, 'vertical', chat);
    w = focusPane(w, dashId);
    w = splitPane(w, 'horizontal', run);
    const runId = activeTab(w).focusedPaneId;

    // Focused on the bottom-left (`run`) leaf of the left column — collapsing
    // the outer vertical split at a narrow breakpoint must land on run, not
    // on some other leaf still buried in the collapsed-away right column.
    const ids = visibleLeafIds(activeTab(w), { showRight: true, breakpoint: 'tiny' });
    expect(ids).toEqual(new Set([runId]));
  });
});
