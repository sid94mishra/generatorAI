// ────────────────────────────────────────────────────────────────
// The multiplexer's data model.
//
// The requirement is "invoke multiple concurrent chats or workflows in
// parallel". Shelling out to tmux would make that unusable on Windows and for
// anyone not already a tmux user, so the model lives here and the TUI renders
// it. The GRAMMAR is borrowed from tmux — tabs, splits, zoom, a leader key —
// because that muscle memory is worth inheriting even when the implementation
// is not.
//
// Detach/attach is free for us in a way it is not for tmux: runs execute on
// the server, so detaching is dropping an SSE subscription and attaching is
// reconnecting with `Last-Event-ID`. Nothing has to be kept alive locally.
// ────────────────────────────────────────────────────────────────

import { CliError } from '../errors/CliError.js';

export type PaneKind =
  | 'dashboard'
  | 'chat'
  | 'chats'
  | 'workflow'
  | 'workflows'
  | 'run'
  | 'runs'
  | 'automation'
  | 'automations'
  | 'project'
  | 'projects'
  | 'workspace'
  | 'workspaces'
  | 'agent'
  | 'agents'
  | 'script'
  | 'scripts'
  | 'extension'
  | 'extensions'
  | 'changes'
  | 'inspector'
  | 'terminal'
  | 'browser'
  | 'computer'
  | 'settings'
  /**
   * Phase 8 item 5 — a pane whose rows come from running one registry
   * command, rendered with that command's OWN `output.columns`.
   *
   * The audit asks for "complete extension, agent, skill, prompt, MCP, hook,
   * webhook, provider, connection, device, security, and diagnostics panes".
   * Twelve bespoke panes would be twelve places to keep in step with twelve
   * commands; this is one pane driven by the same `CommandSpec` the binary,
   * the docs, the completions and the palette are all already derived from,
   * so an admin view cannot claim a column the command does not return.
   */
  | 'command';

export interface PaneContent {
  kind: PaneKind;
  /** Entity the pane is bound to, when it is bound to one. */
  entityId?: string;
  title: string;
  /**
   * Scope + id of the SSE subscription this pane owns, if any. `automation`
   * (Phase 6 item 6) is a real server-side scope (`VALID_SCOPES` in
   * `apps/server/src/routes/stream.ts`, mirrored in
   * `packages/db/src/repositories/StreamCursorRepository.ts`'s `StreamScope`)
   * that no client used before this — the transport (`MuxStreamClient`)
   * already takes a bare `scope: string`, so this was purely a client-side
   * type restriction, not a protocol gap.
   */
  attachment?: { scope: 'run' | 'chat' | 'session' | 'global' | 'automation' | 'workspace'; id: string };
  /** Free-form per-pane UI state (scroll offset, filters, selection). */
  state?: Record<string, unknown>;
}

export type SplitDirection = 'horizontal' | 'vertical';

export type PaneNode =
  | { type: 'leaf'; id: string; content: PaneContent }
  | {
      type: 'split';
      id: string;
      direction: SplitDirection;
      /** 0..1 — the fraction taken by `first`. */
      ratio: number;
      first: PaneNode;
      second: PaneNode;
    };

export interface Tab {
  id: string;
  title: string;
  /** Set when the user renamed it; otherwise the title tracks the focused pane. */
  pinnedTitle: boolean;
  root: PaneNode;
  focusedPaneId: string;
  /** Pane temporarily filling the tab, or null. */
  zoomedPaneId: string | null;
}

export interface WorkbenchState {
  tabs: Tab[];
  activeTabId: string;
  /** The tab that was active immediately before this one — tmux's `last-window` semantics. Undefined until the active tab has changed at least once. */
  previousActiveTabId?: string;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function createLeaf(content: PaneContent): PaneNode {
  return { type: 'leaf', id: nextId('pane'), content };
}

export function createTab(content: PaneContent): Tab {
  const root = createLeaf(content);
  return {
    id: nextId('tab'),
    title: content.title,
    pinnedTitle: false,
    root,
    focusedPaneId: root.id,
    zoomedPaneId: null,
  };
}

export function createWorkbench(initial: PaneContent): WorkbenchState {
  const tab = createTab(initial);
  return { tabs: [tab], activeTabId: tab.id };
}

// ── Traversal ─────────────────────────────────────────────────────

export function findPane(node: PaneNode, paneId: string): PaneNode | undefined {
  if (node.id === paneId) return node;
  if (node.type === 'split') {
    return findPane(node.first, paneId) ?? findPane(node.second, paneId);
  }
  return undefined;
}

export function leaves(node: PaneNode): Array<Extract<PaneNode, { type: 'leaf' }>> {
  return node.type === 'leaf' ? [node] : [...leaves(node.first), ...leaves(node.second)];
}

/**
 * The leaf ids ACTUALLY painted on screen for a tab right now — not every
 * leaf in its tree. Two things collapse a split down to fewer panes than
 * `leaves()` would report, and this mirrors both exactly (it has to: it is
 * the ground truth `apps/cli/src/tui/App.tsx`'s `PaneTree`/`renderNode`
 * render from, kept in sync by the caller, not derived independently):
 *
 * - A zoomed tab (`tab.zoomedPaneId`) renders ONLY that one leaf.
 * - Below the `standard` breakpoint (or with the right pane hidden),
 *   `renderNode` collapses a split to whichever side contains the focused
 *   pane, same as `App.tsx`'s copy of this logic.
 *
 * Used to decide whether a pane's tab counts as "on screen" for the unseen-
 * output indicator (`store.ts`) — without this, a background pane hidden by
 * zoom or a narrow terminal was wrongly treated as visible, so new output
 * arriving in it never set the indicator.
 */
export function visibleLeafIds(
  tab: Tab,
  options: { showRight: boolean; breakpoint: string },
): Set<string> {
  if (tab.zoomedPaneId) return new Set([tab.zoomedPaneId]);

  const collapse = !options.showRight || options.breakpoint === 'tiny' || options.breakpoint === 'compact';
  const containsFocus = (n: PaneNode): boolean =>
    n.type === 'leaf' ? n.id === tab.focusedPaneId : containsFocus(n.first) || containsFocus(n.second);

  let node = tab.root;
  while (collapse && node.type === 'split') {
    node = containsFocus(node.first) ? node.first : node.second;
  }
  return new Set(leaves(node).map((leaf) => leaf.id));
}

function mapNode(node: PaneNode, fn: (leaf: PaneNode) => PaneNode): PaneNode {
  if (node.type === 'leaf') return fn(node);
  return { ...node, first: mapNode(node.first, fn), second: mapNode(node.second, fn) };
}

/** Removes a leaf, collapsing its parent split. Returns null if it was the last. */
function removePane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') return node.id === paneId ? null : node;
  const first = removePane(node.first, paneId);
  const second = removePane(node.second, paneId);
  if (first === null) return second;
  if (second === null) return first;
  return { ...node, first, second };
}

// ── Operations ────────────────────────────────────────────────────

export function activeTab(state: WorkbenchState): Tab {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab) throw CliError.internal('Workbench has no active tab.');
  return tab;
}

/**
 * Switches the active tab, recording the outgoing one as `previousActiveTabId`
 * — the state `toggleLastTab` reads. A no-op switch (already active) leaves
 * it untouched, so pressing the last-tab toggle twice pings back to where you
 * started rather than clobbering it with the tab you're already on.
 */
function withActiveTab(state: WorkbenchState, activeTabId: string): WorkbenchState {
  if (activeTabId === state.activeTabId) return state;
  return { ...state, activeTabId, previousActiveTabId: state.activeTabId };
}

export function addTab(state: WorkbenchState, content: PaneContent): WorkbenchState {
  const tab = createTab(content);
  return withActiveTab({ ...state, tabs: [...state.tabs, tab] }, tab.id);
}

export function closeTab(state: WorkbenchState, tabId: string): WorkbenchState {
  const tabs = state.tabs.filter((t) => t.id !== tabId);
  // Never leave the workbench with zero tabs: the renderer would have nothing
  // to draw and every keybinding would target nothing.
  if (tabs.length === 0) return createWorkbench({ kind: 'dashboard', title: 'Dashboard' });

  // The closed tab can no longer be "last" either way — pointing
  // `toggleLastTab` at a tab that no longer exists would make it silently
  // do nothing.
  const previousActiveTabId = state.previousActiveTabId === tabId ? undefined : state.previousActiveTabId;
  if (state.activeTabId !== tabId) return { ...state, tabs, previousActiveTabId };

  // The ACTIVE tab is what's closing — landing on a neighbor is forced by
  // the close, not a real "switch" the user asked for, so it must NOT
  // overwrite `previousActiveTabId` with the tab that just disappeared
  // (which `withActiveTab`'s normal bookkeeping would do).
  const fallbackId = tabs[Math.min(state.tabs.findIndex((t) => t.id === tabId), tabs.length - 1)]?.id ?? tabs[0]!.id;
  return { tabs, activeTabId: fallbackId, previousActiveTabId };
}

export function selectTab(state: WorkbenchState, tabId: string): WorkbenchState {
  return state.tabs.some((t) => t.id === tabId) ? withActiveTab(state, tabId) : state;
}

export function cycleTab(state: WorkbenchState, delta: 1 | -1): WorkbenchState {
  const index = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const next = (index + delta + state.tabs.length) % state.tabs.length;
  return withActiveTab(state, state.tabs[next]!.id);
}

/**
 * tmux's `last-window`: swap to whichever tab was active immediately before
 * this one. Pressing it again swaps right back — `withActiveTab` records the
 * OUTGOING tab every time, so two presses are a no-op round trip, not a
 * one-way jump.
 */
export function toggleLastTab(state: WorkbenchState): WorkbenchState {
  const target = state.previousActiveTabId;
  if (!target || !state.tabs.some((t) => t.id === target)) return state;
  return withActiveTab(state, target);
}

/** Moves the active tab one position earlier/later. A no-op at either end — reordering does not wrap, unlike `cycleTab`'s focus movement. */
export function moveTab(state: WorkbenchState, delta: 1 | -1): WorkbenchState {
  const index = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const next = index + delta;
  if (next < 0 || next >= state.tabs.length) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(index, 1);
  tabs.splice(next, 0, moved!);
  return { ...state, tabs };
}

export function renameTab(state: WorkbenchState, tabId: string, title: string): WorkbenchState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title, pinnedTitle: true } : t)),
  };
}

export function splitPane(
  state: WorkbenchState,
  direction: SplitDirection,
  content: PaneContent,
): WorkbenchState {
  const tab = activeTab(state);
  const newLeaf = createLeaf(content);
  const root = mapNode(tab.root, (leaf) =>
    leaf.id === tab.focusedPaneId
      ? { type: 'split', id: nextId('split'), direction, ratio: 0.5, first: leaf, second: newLeaf }
      : leaf,
  );
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === tab.id ? { ...t, root, focusedPaneId: newLeaf.id, zoomedPaneId: null } : t,
    ),
  };
}

export function closePane(state: WorkbenchState, paneId?: string): WorkbenchState {
  const tab = activeTab(state);
  const target = paneId ?? tab.focusedPaneId;
  const root = removePane(tab.root, target);
  if (root === null) return closeTab(state, tab.id);

  const remaining = leaves(root);
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === tab.id
        ? {
            ...t,
            root,
            focusedPaneId: remaining[0]?.id ?? t.focusedPaneId,
            zoomedPaneId: t.zoomedPaneId === target ? null : t.zoomedPaneId,
          }
        : t,
    ),
  };
}

export function focusPane(state: WorkbenchState, paneId: string): WorkbenchState {
  const tab = activeTab(state);
  if (!findPane(tab.root, paneId)) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, focusedPaneId: paneId } : t)),
  };
}

/**
 * Moves focus in reading order rather than geometrically.
 *
 * Kept as the fallback for `focusDirectional` (no rectangles yet, or only
 * one leaf in the tab) — reading order is predictable and is what a
 * two-pane layout, the overwhelmingly common case, makes indistinguishable
 * from geometric anyway.
 */
export function cyclePane(state: WorkbenchState, delta: 1 | -1): WorkbenchState {
  const tab = activeTab(state);
  const all = leaves(tab.root);
  const index = all.findIndex((l) => l.id === tab.focusedPaneId);
  const next = (index + delta + all.length) % all.length;
  return focusPane(state, all[next]!.id);
}

// ── Geometric focus ─────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The split percentage `Split` (`packages/tui-kit/src/layout.tsx`) actually
 * renders, clamped the same way. Kept as one constant so a future change to
 * either side can't silently drift the other into computing a rectangle
 * that doesn't match what is actually on screen.
 */
const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;

/**
 * Computes every leaf's on-screen rectangle without ever rendering
 * anything — `Split`'s own layout is a pure, deterministic function of
 * (direction, ratio, container size): the first child gets a fixed
 * percentage of one axis, the second gets the rest via `flexGrow`. Mirroring
 * that math here means geometric focus works from the very first render (no
 * "wait for a real Ink layout pass" step, which a Yoga-measurement-based
 * approach would need) and is exercisable in a plain unit test with no
 * renderer at all — measuring the real thing would need Ink's
 * `measureElement`, which only reports width/height, not position, and
 * would require walking the Yoga node's parent chain (an internal API even
 * `measureElement` itself only half-exposes) to recover absolute
 * coordinates. Any off-by-a-cell disagreement with the real renderer's
 * rounding does not matter here: nearest-neighbor selection only cares
 * about which SIDE and roughly how far, not the exact cell.
 */
export function computeRects(node: PaneNode, rect: Rect): Map<string, Rect> {
  if (node.type === 'leaf') return new Map([[node.id, rect]]);

  const ratio = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, node.ratio));
  const out = new Map<string, Rect>();
  if (node.direction === 'horizontal') {
    // "horizontal" means the DIVIDER is horizontal — panes stack vertically.
    const firstHeight = Math.round(rect.height * ratio);
    for (const [id, r] of computeRects(node.first, { ...rect, height: firstHeight })) out.set(id, r);
    for (const [id, r] of computeRects(node.second, {
      ...rect,
      y: rect.y + firstHeight,
      height: rect.height - firstHeight,
    })) {
      out.set(id, r);
    }
  } else {
    const firstWidth = Math.round(rect.width * ratio);
    for (const [id, r] of computeRects(node.first, { ...rect, width: firstWidth })) out.set(id, r);
    for (const [id, r] of computeRects(node.second, {
      ...rect,
      x: rect.x + firstWidth,
      width: rect.width - firstWidth,
    })) {
      out.set(id, r);
    }
  }
  return out;
}

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Picks the nearest leaf in the given direction, by center point: filters to
 * panes actually on that side, then ranks by primary-axis distance first,
 * breaking ties (and preferring small cross-axis offset) with a weighted
 * combination — the standard tmux/vim/editor window-navigation heuristic.
 */
function nearestInDirection(
  from: Rect,
  candidates: Array<{ id: string; rect: Rect }>,
  direction: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  const origin = center(from);
  const onSide = candidates.filter(({ rect }) => {
    const c = center(rect);
    switch (direction) {
      case 'left':
        return c.x < origin.x;
      case 'right':
        return c.x > origin.x;
      case 'up':
        return c.y < origin.y;
      case 'down':
        return c.y > origin.y;
    }
  });
  if (onSide.length === 0) return undefined;

  let best: { id: string; score: number } | undefined;
  for (const { id, rect } of onSide) {
    const c = center(rect);
    const primary = direction === 'left' || direction === 'right' ? Math.abs(c.x - origin.x) : Math.abs(c.y - origin.y);
    const cross = direction === 'left' || direction === 'right' ? Math.abs(c.y - origin.y) : Math.abs(c.x - origin.x);
    // Cross-axis misalignment costs more per cell than primary-axis distance:
    // a pane directly across the divider should win over one that is
    // technically closer but mostly offset to the side.
    const score = primary + cross * 2;
    if (!best || score < best.score) best = { id, score };
  }
  return best?.id;
}

/**
 * Real geometric focus movement.
 *
 * Two different "nothing to do" cases, handled differently on purpose:
 *   - No rectangle data at all (a single leaf, or `containerWidth`/
 *     `containerHeight` not known yet — defensive; `computeRects` reads the
 *     SAME tree this does, so a mismatch should not happen, but must degrade
 *     rather than throw) falls back to `cyclePane`'s reading-order move, so
 *     the keys still do SOMETHING before the first real layout.
 *   - Rectangles exist but nothing is actually positioned in the pressed
 *     direction (already at the leftmost pane and pressing left) is a
 *     no-op — matching tmux/vim window navigation, which does not wrap
 *     around or substitute some other pane for "there is nothing there".
 */
export function focusDirectional(
  state: WorkbenchState,
  direction: 'up' | 'down' | 'left' | 'right',
  containerWidth: number,
  containerHeight: number,
): WorkbenchState {
  const tab = activeTab(state);
  const all = leaves(tab.root);
  if (all.length <= 1) return state;

  // A zero (or negative) container size means the real terminal size is not
  // known yet (very first render, before Ink reports one) — every rectangle
  // would degenerate to the same point, which carries no direction at all.
  // That's "no usable rect data", the same fallback case as a missing rect,
  // not "nothing happens to be positioned that way".
  if (containerWidth <= 0 || containerHeight <= 0) {
    return cyclePane(state, direction === 'left' || direction === 'up' ? -1 : 1);
  }

  const rects = computeRects(tab.root, { x: 0, y: 0, width: containerWidth, height: containerHeight });
  const focusedRect = rects.get(tab.focusedPaneId);
  if (!focusedRect) return cyclePane(state, direction === 'left' || direction === 'up' ? -1 : 1);

  const candidates = all
    .filter((leaf) => leaf.id !== tab.focusedPaneId)
    .map((leaf) => ({ id: leaf.id, rect: rects.get(leaf.id) }))
    .filter((c): c is { id: string; rect: Rect } => c.rect !== undefined);
  if (candidates.length === 0) return cyclePane(state, direction === 'left' || direction === 'up' ? -1 : 1);

  const target = nearestInDirection(focusedRect, candidates, direction);
  return target ? focusPane(state, target) : state;
}

// ── Resize ────────────────────────────────────────────────────────

/** Nudge, per keypress — small enough that a resize feels incremental, large enough that one press is visible. */
const RESIZE_STEP = 0.05;

/**
 * The nearest split ancestor of a leaf, and which side it's on — resize
 * always adjusts the split immediately around the focused pane (tmux's own
 * `resize-pane` behavior), not some outer split further up the tree.
 */
function findNearestSplit(
  node: PaneNode,
  leafId: string,
): { splitId: string; side: 'first' | 'second' } | undefined {
  if (node.type === 'leaf') return undefined;
  if (leaves(node.first).some((l) => l.id === leafId)) {
    return (node.first.type === 'split' ? findNearestSplit(node.first, leafId) : undefined) ?? {
      splitId: node.id,
      side: 'first',
    };
  }
  if (leaves(node.second).some((l) => l.id === leafId)) {
    return (node.second.type === 'split' ? findNearestSplit(node.second, leafId) : undefined) ?? {
      splitId: node.id,
      side: 'second',
    };
  }
  return undefined;
}

function setSplitRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, first: setSplitRatio(node.first, splitId, ratio), second: setSplitRatio(node.second, splitId, ratio) };
}

/**
 * Grows or shrinks the focused pane's share of its immediate parent split,
 * clamped to the same range `Split` (`packages/tui-kit/src/layout.tsx`) and
 * `computeRects` already clamp to — a pane cannot be resized down to an
 * unusably thin sliver.
 *
 * A single leaf (no split at all) is a no-op: there is nothing to resize.
 */
export function resizeSplit(state: WorkbenchState, direction: 'grow' | 'shrink'): WorkbenchState {
  const tab = activeTab(state);
  const found = findNearestSplit(tab.root, tab.focusedPaneId);
  if (!found) return state;
  const splitNode = findPane(tab.root, found.splitId);
  if (!splitNode || splitNode.type !== 'split') return state;

  // Ratio is `first`'s share. Growing the focused pane means increasing its
  // OWN share, which is `+step` when it sits in `first` and `-step` when it
  // sits in `second` (since `second`'s share is `1 - ratio`).
  const sign = found.side === 'first' ? 1 : -1;
  const magnitude = direction === 'grow' ? RESIZE_STEP : -RESIZE_STEP;
  const nextRatio = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, splitNode.ratio + sign * magnitude));
  if (nextRatio === splitNode.ratio) return state;

  const root = setSplitRatio(tab.root, found.splitId, nextRatio);
  return { ...state, tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)) };
}

export function toggleZoom(state: WorkbenchState): WorkbenchState {
  const tab = activeTab(state);
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === tab.id
        ? { ...t, zoomedPaneId: t.zoomedPaneId ? null : t.focusedPaneId }
        : t,
    ),
  };
}

export function updatePane(
  state: WorkbenchState,
  paneId: string,
  patch: Partial<PaneContent>,
): WorkbenchState {
  // Searched across every tab, not just the active one. A detail fetch that
  // resolves after the user has switched tabs must still reach its pane;
  // scoping this to the active tab left the placeholder on screen forever.
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (!leaves(tab.root).some((leaf) => leaf.id === paneId)) return tab;
      const root = mapNode(tab.root, (leaf) =>
        leaf.id === paneId && leaf.type === 'leaf'
          ? { ...leaf, content: { ...leaf.content, ...patch } }
          : leaf,
      );
      const title =
        !tab.pinnedTitle && paneId === tab.focusedPaneId && patch.title ? patch.title : tab.title;
      return { ...tab, root, title };
    }),
  };
}

/** Every live attachment across every tab — used to reconcile subscriptions. */
export function allAttachments(state: WorkbenchState): Array<{
  paneId: string;
  scope: 'run' | 'chat' | 'session' | 'global' | 'automation' | 'workspace';
  id: string;
}> {
  const out: Array<{
    paneId: string;
    scope: 'run' | 'chat' | 'session' | 'global' | 'automation' | 'workspace';
    id: string;
  }> = [];
  for (const tab of state.tabs) {
    for (const leaf of leaves(tab.root)) {
      const attachment = leaf.content.attachment;
      if (attachment) out.push({ paneId: leaf.id, ...attachment });
    }
  }
  return out;
}

// ── Persistence ───────────────────────────────────────────────────

/** The original shape — flattened content, no geometry. Still read on restore for anyone with an old saved-layout file on disk. */
export interface SerialisedWorkbenchV1 {
  version: 1;
  tabs: Array<{ title: string; panes: PaneContent[] }>;
  activeTabIndex: number;
}

/** Mirrors `PaneNode` minus the runtime-only `id` — a fresh one is minted on restore, same as every other pane-creation path in this file. */
export type SerialisedPaneNode =
  | { type: 'leaf'; content: PaneContent }
  | {
      type: 'split';
      direction: SplitDirection;
      ratio: number;
      first: SerialisedPaneNode;
      second: SerialisedPaneNode;
    };

/** Persists the real split tree — direction and ratio per split, not just the flattened content `version: 1` kept. */
export interface SerialisedWorkbenchV2 {
  version: 2;
  tabs: Array<{
    title: string;
    root: SerialisedPaneNode;
    /** Index into this tab's `leaves()` traversal order — pane ids are minted fresh on every restore, so they cannot identify which leaf was focused. */
    focusedLeafIndex: number;
  }>;
  activeTabIndex: number;
}

export type SerialisedWorkbench = SerialisedWorkbenchV1 | SerialisedWorkbenchV2;

function serialiseNode(node: PaneNode): SerialisedPaneNode {
  if (node.type === 'leaf') return { type: 'leaf', content: node.content };
  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    first: serialiseNode(node.first),
    second: serialiseNode(node.second),
  };
}

/**
 * Persists the real layout, not just its content.
 *
 * `version: 1` deliberately dropped the split tree: restoring an exact
 * geometry into a terminal that had since been resized could leave a pane a
 * few columns wide, and there was no way to tell at restore time whether
 * that would happen. `deserialise` below is what actually decides that now
 * — PER TAB, against the real terminal size at hand — so the real tree can
 * be kept here and safely discarded only where it would actually cause a
 * problem, instead of always discarding it just in case.
 */
export function serialise(state: WorkbenchState): SerialisedWorkbench {
  return {
    version: 2,
    tabs: state.tabs.map((tab) => {
      const tabLeaves = leaves(tab.root);
      return {
        title: tab.title,
        root: serialiseNode(tab.root),
        focusedLeafIndex: Math.max(0, tabLeaves.findIndex((l) => l.id === tab.focusedPaneId)),
      };
    }),
    activeTabIndex: Math.max(
      0,
      state.tabs.findIndex((t) => t.id === state.activeTabId),
    ),
  };
}

/** Minimum usable pane size — the same reasoning `launch.tsx`'s whole-workbench 60x12 floor uses, scaled down to one pane's own share of the screen. */
const MIN_PANE_WIDTH = 30;
const MIN_PANE_HEIGHT = 6;

/**
 * True if restoring `node`'s real geometry into a `width`x`height`
 * container would leave any pane under the minimum usable size. Mirrors
 * `computeRects`'s own layout math (same rounding, same ratio clamp) so
 * this asks the exact question the real renderer will face, not an
 * approximation of it.
 */
function violatesMinimumPaneSize(node: SerialisedPaneNode, width: number, height: number): boolean {
  if (node.type === 'leaf') return width < MIN_PANE_WIDTH || height < MIN_PANE_HEIGHT;
  const ratio = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, node.ratio));
  if (node.direction === 'horizontal') {
    const firstHeight = Math.round(height * ratio);
    return (
      violatesMinimumPaneSize(node.first, width, firstHeight) ||
      violatesMinimumPaneSize(node.second, width, height - firstHeight)
    );
  }
  const firstWidth = Math.round(width * ratio);
  return (
    violatesMinimumPaneSize(node.first, firstWidth, height) ||
    violatesMinimumPaneSize(node.second, width - firstWidth, height)
  );
}

function buildNode(node: SerialisedPaneNode): PaneNode {
  if (node.type === 'leaf') return createLeaf(node.content);
  return {
    type: 'split',
    id: nextId('split'),
    direction: node.direction,
    ratio: node.ratio,
    first: buildNode(node.first),
    second: buildNode(node.second),
  };
}

/** Flattens a saved tree to its content list, in the same left-to-right order `leaves()` walks it — the shared fallback for both `version: 1` and a `version: 2` tree that fails the minimum-size check. */
function flattenContent(node: SerialisedPaneNode): PaneContent[] {
  return node.type === 'leaf' ? [node.content] : [...flattenContent(node.first), ...flattenContent(node.second)];
}

/** The original `version: 1` restore path: flatten, then re-split evenly and vertically, landing focus on the leaf at `focusedIndex` (in insertion order, which matches `leaves()` order for a chain built this way). */
function restoreFlat(title: string, panes: PaneContent[], focusedIndex: number): Tab {
  const [first, ...rest] = panes;
  const tab = createTab(first ?? { kind: 'dashboard', title: 'Dashboard' });
  tab.title = title;
  tab.pinnedTitle = true;
  let state: WorkbenchState = { tabs: [tab], activeTabId: tab.id };
  for (const pane of rest) state = splitPane(state, 'vertical', pane);
  const restored = state.tabs[0]!;
  const restoredLeaves = leaves(restored.root);
  const focusedPaneId = restoredLeaves[Math.min(Math.max(0, focusedIndex), restoredLeaves.length - 1)]?.id;
  return focusedPaneId ? { ...restored, focusedPaneId } : restored;
}

/**
 * `viewport` is the CURRENT terminal size, not necessarily the one the
 * layout was saved from. Omitting it (or a `version: 1` file, which never
 * had geometry to restore in the first place) always takes the safe
 * flatten-and-resplit-evenly path — matching this function's own behavior
 * before this had a `version: 2` to restore at all.
 */
export function deserialise(
  data: SerialisedWorkbench,
  viewport?: { columns: number; rows: number },
): WorkbenchState {
  if (!data.tabs.length) return createWorkbench({ kind: 'dashboard', title: 'Dashboard' });

  if (data.version === 1) {
    const tabs = data.tabs.map((saved) => restoreFlat(saved.title, saved.panes, saved.panes.length - 1));
    return { tabs, activeTabId: tabs[Math.min(data.activeTabIndex, tabs.length - 1)]!.id };
  }

  const tabs = data.tabs.map((saved) => {
    // Responsive restore constraint (item 5's own wording): a saved exact
    // geometry that would leave any pane under the minimum usable size in
    // the CURRENT terminal falls back to the old flatten-and-resplit-evenly
    // behavior for THIS tab specifically, rather than restoring an
    // unusably cramped exact layout. No known viewport yet is the same
    // "can't confirm it's safe" case.
    if (!viewport || violatesMinimumPaneSize(saved.root, viewport.columns, viewport.rows)) {
      return restoreFlat(saved.title, flattenContent(saved.root), saved.focusedLeafIndex);
    }
    const root = buildNode(saved.root);
    const restoredLeaves = leaves(root);
    const focusedPaneId =
      restoredLeaves[Math.min(Math.max(0, saved.focusedLeafIndex), restoredLeaves.length - 1)]?.id ?? root.id;
    return { id: nextId('tab'), title: saved.title, pinnedTitle: true, root, focusedPaneId, zoomedPaneId: null };
  });

  return { tabs, activeTabId: tabs[Math.min(data.activeTabIndex, tabs.length - 1)]!.id };
}
