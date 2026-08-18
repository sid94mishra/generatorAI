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
  | 'settings';

export interface PaneContent {
  kind: PaneKind;
  /** Entity the pane is bound to, when it is bound to one. */
  entityId?: string;
  title: string;
  /** Scope + id of the SSE subscription this pane owns, if any. */
  attachment?: { scope: 'run' | 'chat' | 'session' | 'global'; id: string };
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

export function addTab(state: WorkbenchState, content: PaneContent): WorkbenchState {
  const tab = createTab(content);
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

export function closeTab(state: WorkbenchState, tabId: string): WorkbenchState {
  const tabs = state.tabs.filter((t) => t.id !== tabId);
  // Never leave the workbench with zero tabs: the renderer would have nothing
  // to draw and every keybinding would target nothing.
  if (tabs.length === 0) return createWorkbench({ kind: 'dashboard', title: 'Dashboard' });
  return {
    tabs,
    activeTabId:
      state.activeTabId === tabId
        ? (tabs[Math.min(state.tabs.findIndex((t) => t.id === tabId), tabs.length - 1)]?.id ?? tabs[0]!.id)
        : state.activeTabId,
  };
}

export function selectTab(state: WorkbenchState, tabId: string): WorkbenchState {
  return state.tabs.some((t) => t.id === tabId) ? { ...state, activeTabId: tabId } : state;
}

export function cycleTab(state: WorkbenchState, delta: 1 | -1): WorkbenchState {
  const index = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const next = (index + delta + state.tabs.length) % state.tabs.length;
  return { ...state, activeTabId: state.tabs[next]!.id };
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
 * Geometric movement needs rendered rectangles, which the model does not
 * have; reading order is predictable and is what a two-pane layout — the
 * overwhelmingly common case — makes indistinguishable from geometric anyway.
 */
export function cyclePane(state: WorkbenchState, delta: 1 | -1): WorkbenchState {
  const tab = activeTab(state);
  const all = leaves(tab.root);
  const index = all.findIndex((l) => l.id === tab.focusedPaneId);
  const next = (index + delta + all.length) % all.length;
  return focusPane(state, all[next]!.id);
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
  scope: 'run' | 'chat' | 'session' | 'global';
  id: string;
}> {
  const out: Array<{ paneId: string; scope: 'run' | 'chat' | 'session' | 'global'; id: string }> = [];
  for (const tab of state.tabs) {
    for (const leaf of leaves(tab.root)) {
      const attachment = leaf.content.attachment;
      if (attachment) out.push({ paneId: leaf.id, ...attachment });
    }
  }
  return out;
}

// ── Persistence ───────────────────────────────────────────────────

export interface SerialisedWorkbench {
  version: 1;
  tabs: Array<{ title: string; panes: PaneContent[] }>;
  activeTabIndex: number;
}

/**
 * Flattens the layout for storage.
 *
 * The split tree is deliberately NOT persisted: restoring an exact geometry
 * into a terminal that has since been resized produces panes two columns
 * wide. Restoring the CONTENT and re-splitting evenly is the behaviour people
 * actually want from "reopen what I had".
 */
export function serialise(state: WorkbenchState): SerialisedWorkbench {
  return {
    version: 1,
    tabs: state.tabs.map((tab) => ({
      title: tab.title,
      panes: leaves(tab.root).map((leaf) => leaf.content),
    })),
    activeTabIndex: Math.max(
      0,
      state.tabs.findIndex((t) => t.id === state.activeTabId),
    ),
  };
}

export function deserialise(data: SerialisedWorkbench): WorkbenchState {
  if (data.version !== 1 || !data.tabs.length) {
    return createWorkbench({ kind: 'dashboard', title: 'Dashboard' });
  }

  const tabs = data.tabs.map((saved) => {
    const [first, ...rest] = saved.panes;
    const tab = createTab(first ?? { kind: 'dashboard', title: 'Dashboard' });
    tab.title = saved.title;
    tab.pinnedTitle = true;
    let state: WorkbenchState = { tabs: [tab], activeTabId: tab.id };
    for (const pane of rest) state = splitPane(state, 'vertical', pane);
    return state.tabs[0]!;
  });

  return {
    tabs,
    activeTabId: tabs[Math.min(data.activeTabIndex, tabs.length - 1)]!.id,
  };
}
