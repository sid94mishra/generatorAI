// ────────────────────────────────────────────────────────────────
// TUI state.
//
// A vanilla Zustand store rather than React context: the workbench is driven
// from outside React too (stream callbacks, the companion bridge, signal
// handlers), and `useSyncExternalStore` gives React a consistent view of it
// without those callers having to be inside a component.
//
// The previous TUI polled every list every five seconds and never opened a
// stream. Here the SSE subscriptions are the source of truth for anything
// live, and polling is a slow backstop for entities that have no events.
// ────────────────────────────────────────────────────────────────

import { createStore, type StoreApi } from 'zustand/vanilla';
import { applyLifecycleEvent } from './lifecycle.js';
import { useSyncExternalStore } from 'react';
import type { ValidationIssue } from '@generatorai/workflow-spec';
import {
  addTab,
  allAttachments,
  closePane,
  closeTab,
  createWorkbench,
  cyclePane,
  cycleTab,
  DEFAULT_TIMELINE_RETENTION,
  emptyTimeline,
  mergeHistoryIntoTimeline,
  focusDirectional,
  focusPane,
  moveTab,
  reduceEvent,
  renameTab,
  resizeSplit,
  selectTab,
  serialise,
  deserialise,
  splitPane,
  toggleLastTab,
  toggleZoom,
  updatePane,
  activeTab as selectActiveTab,
  leaves,
  visibleLeafIds,
  type Api,
  epochOr,
  statusTone,
  type CommandSpec,
  type FormField,
  type PaneContent,
  type StreamPort,
  type TimelineState,
  type WorkbenchState,
} from '@generatorai/cli-core';

export type OverlayKind =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'tabs' }
  /** Phase 6 item 5 — global blocked-work/notification queue. See `blockedWorkItems`. */
  | { kind: 'notifications' }
  | { kind: 'confirm'; message: string; danger: boolean; onAnswer: (value: boolean) => void }
  | { kind: 'input'; message: string; initial: string; onSubmit: (value: string) => void }
  | { kind: 'select'; message: string; options: Array<{ value: string; label: string; detail?: string }>; onSelect: (value: string) => void }
  | { kind: 'error'; title: string; message: string; hint?: string }
  /**
   * Phase 7 item 4 — a multi-field form built from a `CommandSpec`'s own
   * args and flags (`cli-core`'s `formFieldsForSpec`). Replaces the chained
   * single-line `input` overlays `runFromPalette` used for required ARGS,
   * and is the first surface in this app that can supply a required FLAG at
   * all — before this the palette refused any such command outright, which
   * covered every workflow-authoring command.
   */
  | {
      kind: 'form';
      title: string;
      description?: string;
      fields: FormField[];
      /** Values keyed by `fieldKey(field)`, already trimmed. */
      onSubmit: (values: Record<string, string>) => void;
      /**
       * Called when the form is dismissed without submitting.
       *
       * Required for a caller that awaits the outcome: `runWithForm` returns
       * a promise, and without this an Escape would leave it pending
       * forever, holding its whole closure alive. One dangling promise per
       * cancelled form is not a crash, which is exactly why it would never
       * have been noticed.
       */
      onCancel?: () => void;
    }
  /**
   * Phase 7 item 6 — validation findings with the stage/edge each belongs
   * to, so Enter can jump the DAG cursor to the element responsible instead
   * of leaving the user to find it from prose.
   */
  | {
      kind: 'validation';
      title: string;
      valid: boolean;
      /** `validateWorkflow` issues: JSON pointer, optional stage key, message, hint. */
      issues: ValidationIssue[];
      /** Called with the stage key of the selected issue. */
      onNavigate: (stageKey: string) => void;
    }
  /**
   * Phase 6 item 4 — a run's stages plus its variables, fetched once when
   * opened (same pattern as the terminal chooser's `select` overlay) rather
   * than plumbed through as live store state: this is a point-in-time
   * inspector, not something that needs to track every subsequent event.
   * `paneId` is carried so the overlay can still pull the run's live
   * step/hook items out of that pane's timeline for whichever stage is
   * highlighted.
   */
  | {
      kind: 'stageDetail';
      runId: string;
      paneId: string;
      stages: Array<{
        id: string;
        name?: string;
        status: string;
        startedAt?: string | number | null;
        completedAt?: string | number | null;
        error?: string | null;
        /** The latest attempt number; retries are the attempts beyond the first. */
        attempts?: number;
      }>;
      variables: Record<string, unknown>;
    };

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  at: number;
}

/** Cached list data, keyed by entity kind. */
export interface DataCache {
  chats: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  automations: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  scripts: Array<Record<string, unknown>>;
  extensions: Array<Record<string, unknown>>;
}

export type DataKey = keyof DataCache;

const EMPTY_CACHE: DataCache = {
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

export interface TuiState {
  workbench: WorkbenchState;
  overlay: OverlayKind;
  toasts: Toast[];

  data: DataCache;
  loading: Partial<Record<DataKey, boolean>>;
  errors: Partial<Record<DataKey, string>>;
  /** `dataUpdatedAt` per key, so a stale poll cannot overrule newer state. */
  fetchedAt: Partial<Record<DataKey, number>>;

  /** Per-pane conversation/run timelines, keyed by pane id. */
  timelines: Record<string, TimelineState>;
  /** Per-pane list selection, so switching tabs does not lose the cursor. */
  selection: Record<string, number>;
  /** Per-pane search query. */
  search: Record<string, string>;
  /**
   * Panes that received an event while their tab was NOT the active one
   * (Phase 4 item 7 — "unseen output" tab indicator). A pane only ever
   * gets removed from this by actually being rendered (see `Pane` in
   * panes.tsx, which marks itself seen on mount/update) — not by a tab
   * merely becoming active, since a background split within an already-
   * active tab can equally go unseen if it isn't the focused one.
   */
  unseen: Record<string, true>;
  /**
   * The leaf ids `App.tsx` actually painted on its last render — narrower
   * than "every leaf in the active tab's tree" whenever a tab is zoomed or
   * the terminal is too narrow to show a split (see `PaneModel.visibleLeafIds`,
   * whose exact collapse logic this mirrors). `null` until the first render
   * reports it; `isPaneInActiveTab` falls back to the coarser tab-membership
   * check in that window rather than treating nothing as visible.
   */
  visiblePaneIds: Set<string> | null;
  /**
   * Per-pane log verbosity for run panes (Phase 6 item 4) — absent means
   * "use today's existing behavior" (show reasoning and tool calls), so a
   * pane that has never touched this is byte-for-byte unaffected. Keyed by
   * pane id rather than a global setting: two panes open on different runs
   * (or a run reopened later) may reasonably want different noise levels,
   * and there is nowhere server-side this preference could persist anyway.
   */
  verbosity: Record<string, 'minimal' | 'normal' | 'verbose'>;

  connection: { label: string; endpoint: string; state: string; deviceId?: string } | null;
  /** Prompt history for the composer, most recent last. */
  history: string[];

  /** Active theme id. Held here so the picker can change it without a restart. */
  theme: string;
  /** Reasoning blocks are noise once you trust the agent; off is a valid default. */
  showThinking: boolean;

  /** True while the terminal is handed to a child (editor / PTY). */
  suspended: boolean;
}

export interface TuiActions {
  // Workbench
  /**
   * Returns the id of the pane the content actually landed in — the caller's
   * stable handle to it. For `'replace'`, pass `targetPaneId` to target a
   * SPECIFIC pane (e.g. one this same caller created moments ago) rather than
   * "whichever pane is focused right now", which can have changed by the time
   * an async `build()` resolves (a second Enter-press opening another
   * placeholder tab, a tab switch, ...). Omitting it keeps the old
   * current-focus behavior, which every other `'replace'` call site (the
   * `goto.*` keymap actions) genuinely wants.
   */
  openPane(
    content: PaneContent,
    mode?: 'tab' | 'split-v' | 'split-h' | 'replace',
    targetPaneId?: string,
  ): string;
  closeActivePane(): void;
  closeActiveTab(): void;
  focusTab(index: number): void;
  nextTab(): void;
  prevTab(): void;
  /** tmux-style `last-window`: swap to whichever tab was active immediately before this one. */
  lastTab(): void;
  /** Reorders the active tab one position earlier/later. A no-op at either end. */
  moveTab(delta: 1 | -1): void;
  nextPane(): void;
  prevPane(): void;
  /** Real geometric focus movement — see `PaneModel.focusDirectional`. Needs the container size the pane tree actually renders into. */
  focusPaneDirection(direction: 'up' | 'down' | 'left' | 'right', containerWidth: number, containerHeight: number): void;
  /**
   * Switches to whichever tab contains `paneId` (wherever it is, active tab
   * or not — unlike `focusPaneDirection`, which only ever moves within the
   * already-active one), then focuses that exact pane within it. Backs the
   * blocked-work queue (Phase 6 item 5): a pending approval/question can be
   * sitting in a pane on a tab the user is nowhere near.
   */
  jumpToPane(paneId: string): void;
  /** Grows/shrinks the focused pane's share of its immediate parent split. A no-op on a single-pane tab. */
  resizePane(direction: 'grow' | 'shrink'): void;
  zoom(): void;
  rename(title: string): void;
  patchPane(paneId: string, patch: Partial<PaneContent>): void;

  // Overlays
  showOverlay(overlay: OverlayKind): void;
  closeOverlay(): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;

  // Data
  setData(key: DataKey, rows: Array<Record<string, unknown>>): void;
  setLoading(key: DataKey, loading: boolean): void;
  setError(key: DataKey, message: string | null): void;

  // Panes
  setSelection(paneId: string, index: number): void;
  setSearch(paneId: string, query: string): void;
  /** Called by `Pane` (panes.tsx) on every render — clears the "unseen output" tab indicator for a pane that is actually on screen right now. */
  markSeen(paneId: string): void;
  /**
   * `App.tsx` reports exactly which leaves it painted on its last render
   * (via `PaneModel.visibleLeafIds`) — this is what makes the "unseen
   * output" check aware of zoom and narrow-breakpoint split collapsing,
   * which the active tab's tree alone can't tell you.
   */
  setVisiblePaneIds(ids: Set<string>): void;
  /** Sets the run pane's log verbosity going forward — does not retroactively change items already in its timeline. */
  setVerbosity(paneId: string, level: 'minimal' | 'normal' | 'verbose'): void;
  applyEvent(paneId: string, event: { kind: string; data: Record<string, unknown>; sequence?: number }): void;
  /**
   * Same reduction as `applyEvent`, but folds every event into ONE `set()` —
   * used by `StreamReconciler`'s coalescing so a burst of token deltas costs
   * one store update (and one render) instead of one per event.
   */
  applyEvents(paneId: string, events: Array<{ kind: string; data: Record<string, unknown>; sequence?: number }>): void;
  resetTimeline(paneId: string): void;
  /** Replaces a pane's timeline with one built from stored history. */
  seedTimeline(paneId: string, timeline: TimelineState): void;

  setConnection(connection: TuiState['connection']): void;
  pushHistory(prompt: string): void;
  setSuspended(suspended: boolean): void;
  setTheme(theme: string): void;
  toggleThinking(): void;
}

export type TuiStore = TuiState & TuiActions;

let toastSeq = 0;

/**
 * Drops the given keys from a per-pane `Record` (`timelines`/`selection`/
 * `search`). Pane ids come from an ever-incrementing counter and are never
 * reused (`PaneModel.ts`'s `nextId`), so without this every pane ever
 * opened-and-closed in a session leaves a permanent, unreachable entry in
 * all three records for the life of the process.
 */
function omitKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (keys.length === 0) return record;
  const out = { ...record };
  for (const key of keys) delete out[key];
  return out;
}

/** Whether two id sets have the same members — used to skip a `set()`/render when `setVisiblePaneIds` is called with an unchanged value (it runs every render). */
function sameIdSet(a: Set<string> | null, b: Set<string>): boolean {
  if (!a) return false;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Whether `paneId` is actually painted on screen right now — the active
 * tab's, and (once `App.tsx` has reported real render output at least once)
 * narrowed to exactly what zoom/breakpoint collapsing left visible, not
 * just "somewhere in the active tab's tree" (see `PaneModel.visibleLeafIds`
 * for why those two are NOT the same thing: a zoomed tab or a narrow
 * terminal renders only one side of a split, and the other leaf — still
 * physically off-screen — must count as invisible for the unseen-output
 * indicator to mean anything).
 */
function isPaneInActiveTab(workbench: WorkbenchState, visiblePaneIds: Set<string> | null, paneId: string): boolean {
  if (visiblePaneIds) return visiblePaneIds.has(paneId);
  // No render has reported real visibility yet (e.g. an event arrives before
  // the first frame) — fall back to the coarser "somewhere in this tab"
  // check rather than treating every pane as invisible in that window.
  return leaves(selectActiveTab(workbench).root).some((leaf) => leaf.id === paneId);
}

/** One pane with a HITL gate currently blocking it — see `blockedWorkItems`. */
export interface BlockedWorkItem {
  paneId: string;
  tabId: string;
  tabTitle: string;
  paneTitle: string;
  kind: PaneContent['kind'];
  /** 'approval' = a workflow stage gate (`pendingApproval`); 'interaction' = a chat-scoped plan/question gate (`pendingInteraction`). */
  gate: 'approval' | 'interaction';
  summary: string;
}

/**
 * Phase 6 item 5 — global blocked-work/notification queue. No design
 * precedent existed anywhere in this codebase (or `apps/web`) for
 * aggregating pending HITL gates across panes/tabs; this is a plain scan
 * over every open pane's timeline rather than a second, separately-tracked
 * copy of "what's blocked" — `pendingApproval`/`pendingInteraction` on
 * `TimelineState` (`runTimeline.ts`) already are that state, so there is
 * nothing else to keep in sync.
 *
 * Deliberately does NOT include background tasks (`chat.background_task.*`)
 * or plain errors — those already surface inline in their own pane's
 * timeline and neither one blocks anything; this queue is specifically
 * "work that is waiting on YOU," not "everything that happened."
 */
export function blockedWorkItems(
  workbench: WorkbenchState,
  timelines: Record<string, TimelineState>,
): BlockedWorkItem[] {
  const items: BlockedWorkItem[] = [];
  for (const tab of workbench.tabs) {
    for (const leaf of leaves(tab.root)) {
      const timeline = timelines[leaf.id];
      if (!timeline) continue;
      if (timeline.pendingApproval) {
        items.push({
          paneId: leaf.id,
          tabId: tab.id,
          tabTitle: tab.title,
          paneTitle: leaf.content.title,
          kind: leaf.content.kind,
          gate: 'approval',
          summary: `Stage awaiting input: ${timeline.pendingApproval.stageName}`,
        });
      }
      if (timeline.pendingInteraction) {
        const pending = timeline.pendingInteraction;
        items.push({
          paneId: leaf.id,
          tabId: tab.id,
          tabTitle: tab.title,
          paneTitle: leaf.content.title,
          kind: leaf.content.kind,
          gate: 'interaction',
          summary:
            pending.kind === 'plan'
              ? `Plan review: ${pending.title}`
              : pending.kind === 'permission'
                ? `Allow ${pending.toolName}?`
                : pending.questions.length === 1
                  ? pending.questions[0]?.question ?? 'Question'
                  : `${pending.questions.length} questions`,
        });
      }
    }
  }
  return items;
}

/**
 * The reducer options every pane's timeline uses — shared so `applyEvent`
 * and `applyEvents` reduce identically.
 *
 * `verbosity` is `undefined` for any pane that has never touched `v`
 * (`run.verbosity`) — that case reproduces the exact options this function
 * always used before per-pane verbosity existed, so a chat pane (which has
 * no verbosity control at all) and a run pane that hasn't changed it are
 * both byte-for-byte unaffected.
 */
function reduceTimelineEvent(
  state: TimelineState,
  event: { kind: string; data: Record<string, unknown>; sequence?: number },
  verbosity?: 'minimal' | 'normal' | 'verbose',
): TimelineState {
  const options = verbosity
    ? {
        showThinking: verbosity === 'verbose',
        showTools: verbosity !== 'minimal',
        minimal: verbosity === 'minimal',
      }
    : { showThinking: true, showTools: true };
  return reduceEvent(state, event, {
    ...options,
    // Bounded so a run producing 200k events cannot exhaust memory in a
    // long-lived TUI. The full history is still on the server. The SAME
    // bound applies to history hydration (`seedTimeline`) — applying it to
    // only one of the two paths is what let a long stored conversation blow
    // straight past it (audit §6.4).
    maxItems: TIMELINE_RETENTION,
  });
}

/** One bound for both the live and the hydrated path. */
const TIMELINE_RETENTION = DEFAULT_TIMELINE_RETENTION;

export function createTuiStore(initial?: {
  workbench?: WorkbenchState;
  history?: string[];
  theme?: string;
}): StoreApi<TuiStore> {
  return createStore<TuiStore>((set, get) => ({
    workbench: initial?.workbench ?? createWorkbench({ kind: 'dashboard', title: 'Dashboard' }),
    overlay: { kind: 'none' },
    toasts: [],
    data: EMPTY_CACHE,
    loading: {},
    errors: {},
    fetchedAt: {},
    timelines: {},
    selection: {},
    search: {},
    unseen: {},
    visiblePaneIds: null,
    verbosity: {},
    connection: null,
    history: initial?.history ?? [],
    theme: initial?.theme ?? 'auto',
    showThinking: true,
    suspended: false,

    openPane(content, mode = 'tab', targetPaneId) {
      let landedId = '';
      set((state) => {
        switch (mode) {
          case 'split-v': {
            const workbench = splitPane(state.workbench, 'vertical', content);
            landedId = selectActiveTab(workbench).focusedPaneId;
            return { workbench };
          }
          case 'split-h': {
            const workbench = splitPane(state.workbench, 'horizontal', content);
            landedId = selectActiveTab(workbench).focusedPaneId;
            return { workbench };
          }
          case 'replace': {
            landedId = targetPaneId ?? selectActiveTab(state.workbench).focusedPaneId;
            // The pane keeps its id but is now showing a DIFFERENT list, so
            // its stored cursor and filter belong to content that is gone.
            // Without this, `g w` then `g c` landed the cursor on whichever
            // row index happened to be selected in Workflows — row 3 of
            // Chats, for no reason the user could see — and the stale filter
            // made the new list look half-empty.
            return {
              workbench: updatePane(state.workbench, landedId, content),
              selection: { ...state.selection, [landedId]: 0 },
              search: omitKeys(state.search, [landedId]),
            };
          }
          default: {
            const workbench = addTab(state.workbench, content);
            landedId = selectActiveTab(workbench).focusedPaneId;
            return { workbench };
          }
        }
      });
      return landedId;
    },

    closeActivePane() {
      set((state) => {
        // Captured before `closePane` runs — it is gone from the tree
        // afterward, and its `timelines`/`selection`/`search` entries would
        // otherwise never be reachable to clean up again.
        const removedId = selectActiveTab(state.workbench).focusedPaneId;
        return {
          workbench: closePane(state.workbench),
          timelines: omitKeys(state.timelines, [removedId]),
          selection: omitKeys(state.selection, [removedId]),
          search: omitKeys(state.search, [removedId]),
          unseen: omitKeys(state.unseen, [removedId]),
          verbosity: omitKeys(state.verbosity, [removedId]),
        };
      });
    },

    closeActiveTab() {
      set((state) => {
        // Closing a tab removes EVERY pane in it, not just the focused one.
        const removedIds = leaves(selectActiveTab(state.workbench).root).map((leaf) => leaf.id);
        return {
          workbench: closeTab(state.workbench, state.workbench.activeTabId),
          timelines: omitKeys(state.timelines, removedIds),
          selection: omitKeys(state.selection, removedIds),
          search: omitKeys(state.search, removedIds),
          unseen: omitKeys(state.unseen, removedIds),
          verbosity: omitKeys(state.verbosity, removedIds),
        };
      });
    },

    focusTab(index) {
      set((state) => {
        const tab = state.workbench.tabs[index];
        return tab ? { workbench: selectTab(state.workbench, tab.id) } : {};
      });
    },

    nextTab() {
      set((state) => ({ workbench: cycleTab(state.workbench, 1) }));
    },
    prevTab() {
      set((state) => ({ workbench: cycleTab(state.workbench, -1) }));
    },
    lastTab() {
      set((state) => ({ workbench: toggleLastTab(state.workbench) }));
    },
    moveTab(delta) {
      set((state) => ({ workbench: moveTab(state.workbench, delta) }));
    },
    nextPane() {
      set((state) => ({ workbench: cyclePane(state.workbench, 1) }));
    },
    prevPane() {
      set((state) => ({ workbench: cyclePane(state.workbench, -1) }));
    },
    focusPaneDirection(direction, containerWidth, containerHeight) {
      set((state) => ({
        workbench: focusDirectional(state.workbench, direction, containerWidth, containerHeight),
      }));
    },
    jumpToPane(paneId) {
      set((state) => {
        const tab = state.workbench.tabs.find((t) => leaves(t.root).some((leaf) => leaf.id === paneId));
        if (!tab) return {};
        // `selectTab` switches which tab is active; `focusPane` only ever
        // looks at the ALREADY-active tab (`activeTab(state)` internally,
        // `PaneModel.ts:313`) — the two must be composed in this order,
        // calling `focusPane` before `paneId`'s tab is active would silently
        // no-op.
        return { workbench: focusPane(selectTab(state.workbench, tab.id), paneId) };
      });
    },
    resizePane(direction) {
      set((state) => ({ workbench: resizeSplit(state.workbench, direction) }));
    },
    zoom() {
      set((state) => ({ workbench: toggleZoom(state.workbench) }));
    },
    rename(title) {
      set((state) => ({ workbench: renameTab(state.workbench, state.workbench.activeTabId, title) }));
    },
    patchPane(paneId, patch) {
      set((state) => ({ workbench: updatePane(state.workbench, paneId, patch) }));
    },

    showOverlay(overlay) {
      set({ overlay });
    },
    closeOverlay() {
      set({ overlay: { kind: 'none' } });
    },

    toast(text, tone = 'info') {
      const toast: Toast = { id: ++toastSeq, text, tone, at: Date.now() };
      set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }));
      // Auto-dismiss so a burst of stage transitions does not bury the UI.
      setTimeout(() => get().dismissToast(toast.id), tone === 'error' ? 8000 : 4000);
    },
    dismissToast(id) {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },

    setData(key, rows) {
      set((state) => ({
        data: { ...state.data, [key]: rows },
        fetchedAt: { ...state.fetchedAt, [key]: Date.now() },
        errors: { ...state.errors, [key]: undefined },
      }));
    },
    setLoading(key, loading) {
      set((state) => ({ loading: { ...state.loading, [key]: loading } }));
    },
    setError(key, message) {
      set((state) => ({
        errors: { ...state.errors, [key]: message ?? undefined },
        loading: { ...state.loading, [key]: false },
      }));
    },

    setSelection(paneId, index) {
      set((state) => ({ selection: { ...state.selection, [paneId]: index } }));
    },
    setSearch(paneId, query) {
      set((state) => ({ search: { ...state.search, [paneId]: query } }));
    },
    markSeen(paneId) {
      // No-op (not just harmless — actually skipped) when there's nothing
      // to clear: `Pane` calls this on every render of a VISIBLE pane, and
      // a `set()` that always returns a new object would notify every
      // subscriber every render, defeating the coalescing work elsewhere
      // in this file for no reason.
      set((state) => (paneId in state.unseen ? { unseen: omitKeys(state.unseen, [paneId]) } : {}));
    },
    setVisiblePaneIds(ids) {
      set((state) => (sameIdSet(state.visiblePaneIds, ids) ? {} : { visiblePaneIds: ids }));
    },
    setVerbosity(paneId, level) {
      set((state) => ({ verbosity: { ...state.verbosity, [paneId]: level } }));
    },

    applyEvent(paneId, event) {
      set((state) => {
        const current = state.timelines[paneId] ?? emptyTimeline();
        const next = reduceTimelineEvent(current, event, state.verbosity[paneId]);
        if (next === current) return {};
        return {
          timelines: { ...state.timelines, [paneId]: next },
          ...(isPaneInActiveTab(state.workbench, state.visiblePaneIds, paneId) ? {} : { unseen: { ...state.unseen, [paneId]: true } }),
        };
      });
    },
    applyEvents(paneId, events) {
      if (events.length === 0) return;
      set((state) => {
        const current = state.timelines[paneId] ?? emptyTimeline();
        const verbosity = state.verbosity[paneId];
        let next = current;
        for (const event of events) next = reduceTimelineEvent(next, event, verbosity);
        if (next === current) return {};
        return {
          timelines: { ...state.timelines, [paneId]: next },
          ...(isPaneInActiveTab(state.workbench, state.visiblePaneIds, paneId) ? {} : { unseen: { ...state.unseen, [paneId]: true } }),
        };
      });
    },
    resetTimeline(paneId) {
      set((state) => ({ timelines: { ...state.timelines, [paneId]: emptyTimeline() } }));
    },

    seedTimeline(paneId, timeline) {
      set((state) => ({
        // Live events may already have arrived while history was in flight;
        // they are newer than anything on disk, so they win the order. The
        // merge also applies the SAME retention bound live reduction uses —
        // before, hydration concatenated unboundedly and re-broke the bound
        // the moment it landed (audit §6.4).
        timelines: {
          ...state.timelines,
          [paneId]: mergeHistoryIntoTimeline(state.timelines[paneId], timeline, {
            maxItems: TIMELINE_RETENTION,
          }),
        },
      }));
    },

    setConnection(connection) {
      set({ connection });
    },
    pushHistory(prompt) {
      set((state) => ({ history: [...state.history, prompt].slice(-200) }));
    },
    setSuspended(suspended) {
      set({ suspended });
    },
    setTheme(theme) {
      set({ theme });
    },
    toggleThinking() {
      set((state) => ({ showThinking: !state.showThinking }));
    },
  }));
}

/**
 * The live reconciler, for the diagnostics pane (open question #6).
 *
 * Module-level rather than threaded through props for the same reason the
 * store itself is: the reconciler is created in `launch.tsx`, outside React,
 * and exactly one exists per process. A component that wants its counters
 * should not have to be handed them through five layers that do not care.
 */
let activeReconciler: StreamReconciler | null = null;

export function setReconciler(reconciler: StreamReconciler | null): void {
  activeReconciler = reconciler;
}

/** `null` before the reconciler starts (and in tests that never start one). */
export function streamStats(): StreamStats | null {
  return activeReconciler?.stats() ?? null;
}

// ── React bindings ────────────────────────────────────────────────

let globalStore: StoreApi<TuiStore> | null = null;

export function setStore(store: StoreApi<TuiStore>): void {
  globalStore = store;
}

export function getStore(): StoreApi<TuiStore> {
  if (!globalStore) throw new Error('TUI store has not been created.');
  return globalStore;
}

export function useTui<T>(selector: (state: TuiStore) => T): T {
  const store = getStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useActions(): TuiActions {
  return getStore().getState();
}

// ── Stream reconciliation ─────────────────────────────────────────

/**
 * Keeps SSE subscriptions in step with what the workbench has open.
 *
 * Panes come and go as the user opens tabs and splits; subscribing inside a
 * component would open a socket per mount and leak one per unmount that
 * raced a re-render. Reconciling from the pane tree means the set of live
 * sockets is a pure function of what is on screen.
 *
 * W48 / STR-04, then Phase 3 items 1/2 (mux-stream-cli-full, done).
 * `createCliClient` hands this class a `MuxStreamClient` as its `StreamPort` —
 * one real HTTP connection multiplexing every subscribed scope for the whole
 * client, not one per `(scope, id)` pair. `SharedStreamPort` (the intermediate
 * step, which only deduped identical `(scope, id)` pairs on top of N separate
 * connections) is retired from this path; see
 * `packages/client-core/src/stream/MuxStreamClient.ts` for the real thing,
 * ported from the same protocol `apps/web/src/platform/muxStream.ts` already
 * uses against the live server.
 */
export class StreamReconciler {
  private readonly active = new Map<string, { key: string; dispose: () => void }>();
  /**
   * Phase 3 item 5 — coalescing. A fast-streaming turn can emit hundreds of
   * `harness.token` deltas a second; applying each straight to `applyEvent`
   * (one `set()`, one store notification, one render) turned every one of
   * them into its own render pass. Buffering per pane and flushing once per
   * microtask tick collapses a whole burst into one `applyEvents()` call —
   * same events, same order, one render instead of hundreds.
   */
  private readonly pending = new Map<string, Array<{ kind: string; data: Record<string, unknown>; sequence?: number }>>();
  private flushScheduled = false;
  /** Pending deferred flush for panes the user cannot currently see (open question #5). */
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Open question #6 — stream health counters, read by `system doctor` and the diagnostics view. */
  private readonly metrics = {
    received: 0,
    applied: 0,
    flushes: 0,
    hiddenFlushes: 0,
    reconnects: 0,
    queueDepthPeak: 0,
  };

  /**
   * The one global-scope subscription (open question #4).
   *
   * Not per pane: `scope=global` carries entity LIFECYCLE events for the
   * whole server, and every list pane wants the same stream. One
   * subscription for the process, opened alongside the first pane and
   * closed with the last.
   */
  private globalDispose: (() => void) | null = null;
  /** Set when a lifecycle event asked for a cache refetch — drained by the owner. */
  private readonly staleKeys = new Set<DataKey>();
  private onStale: ((keys: DataKey[]) => void) | null = null;

  constructor(
    private readonly store: StoreApi<TuiStore>,
    private readonly stream: StreamPort,
  ) {}

  /**
   * `onStale` is how a creation event reaches the data loader: this class
   * owns no `Api`, and giving it one would make the piece that decides WHICH
   * sockets are open also responsible for fetching, which is what kept pane
   * subscriptions honest in the first place.
   */
  start(options: { onStale?: (keys: DataKey[]) => void } = {}): () => void {
    this.onStale = options.onStale ?? null;
    const unsubscribe = this.store.subscribe(() => this.reconcile());
    this.reconcile();
    this.subscribeGlobal();
    return () => {
      unsubscribe();
      this.globalDispose?.();
      this.globalDispose = null;
      this.onStale = null;
      this.disposeAll();
    };
  }

  /**
   * Applies entity lifecycle events to the list caches, so a list stops
   * being wrong until the next poll tick (`applyLifecycleEvent` explains why
   * some events patch and others ask for a refetch).
   *
   * Polling is deliberately left running underneath: it is now repair for a
   * missed reconnect rather than the primary path, which is exactly the
   * relationship the audit's Phase 3 item 4 asks for.
   */
  private subscribeGlobal(): void {
    if (this.globalDispose) return;
    this.globalDispose = this.stream.subscribe('global', 'all', (event) => {
      const state = this.store.getState();
      const outcome = applyLifecycleEvent(state.data, event);
      if (outcome.patch) state.setData(outcome.patch.key, outcome.patch.rows);
      if (outcome.refetch) {
        // Coalesced onto one microtask: creating three chats in a burst is
        // one refetch, not three.
        this.staleKeys.add(outcome.refetch);
        queueMicrotask(() => {
          if (this.staleKeys.size === 0) return;
          const keys = [...this.staleKeys];
          this.staleKeys.clear();
          this.onStale?.(keys);
        });
      }
    });
  }

  private reconcile(): void {
    const wanted = allAttachments(this.store.getState().workbench);
    const wantedKeys = new Set(wanted.map((a) => `${a.paneId}:${a.scope}:${a.id}`));

    for (const [paneId, entry] of this.active) {
      if (!wantedKeys.has(entry.key)) {
        entry.dispose();
        this.active.delete(paneId);
      }
    }

    for (const attachment of wanted) {
      const key = `${attachment.paneId}:${attachment.scope}:${attachment.id}`;
      if (this.active.get(attachment.paneId)?.key === key) continue;

      this.active.get(attachment.paneId)?.dispose();

      const dispose = this.stream.subscribe(
        attachment.scope,
        attachment.id,
        (event) => this.enqueue(attachment.paneId, event),
        {
          onReconnecting: (attempt) => {
            this.metrics.reconnects += 1;
            if (attempt === 3) {
              this.store.getState().toast('Reconnecting to the event stream…', 'warning');
            }
          },
        },
      );
      this.active.set(attachment.paneId, { key, dispose });
    }

    // A pane that just became visible must not wait on the hidden-pane
    // timer to show what already arrived for it. `reconcile()` runs on every
    // store update, and `setVisiblePaneIds` is a store update — so this is
    // where a visibility change turns into an immediate flush.
    if (this.pending.size > 0 && !this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private enqueue(
    paneId: string,
    event: { kind: string; data: Record<string, unknown>; sequence?: number },
  ): void {
    this.metrics.received += 1;
    const queue = this.pending.get(paneId);
    if (queue) queue.push(event);
    else this.pending.set(paneId, [event]);
    this.metrics.queueDepthPeak = Math.max(this.metrics.queueDepthPeak, this.queueDepth());

    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  /**
   * Open question #5 — hidden-pane priority.
   *
   * A pane the user cannot see still RECEIVES every event: pausing its
   * subscription would silently lose messages it is expected to have on
   * switching back, and the audit's own wording ("hidden-tab priority") is
   * about cost, not about dropping data.
   *
   * What changes is when its events are APPLIED. A visible pane flushes on
   * the next microtask, as before. A hidden one is held until a short timer
   * fires, so a background chat streaming at full rate costs one store
   * update (and one reconciliation pass over the whole workbench) every
   * `HIDDEN_FLUSH_MS` instead of one per microtask — while every event still
   * arrives, in order, before the user can look at it.
   *
   * The moment a pane becomes visible its buffer is flushed immediately by
   * the next `reconcile()`; nothing waits on the timer to be seen.
   */
  private isPaneVisible(paneId: string): boolean {
    const state = this.store.getState();
    if (state.visiblePaneIds) return state.visiblePaneIds.has(paneId);
    // No render has reported real visibility yet — treat everything as
    // visible rather than delaying the first paint of a fresh session.
    return true;
  }

  private flush(): void {
    this.flushScheduled = false;
    let deferred = false;

    for (const [paneId, events] of [...this.pending]) {
      // The pane may have closed between the event arriving and this flush
      // running — `reconcile()` disposes the subscription synchronously on
      // close, but anything already buffered here survives until this tick.
      // Applying it now would resurrect `timelines[paneId]` right after the
      // teardown fix (item 7) just deleted it.
      if (!this.active.has(paneId)) {
        this.pending.delete(paneId);
        continue;
      }
      if (!this.isPaneVisible(paneId)) {
        deferred = true;
        continue;
      }
      this.pending.delete(paneId);
      this.metrics.applied += events.length;
      this.metrics.flushes += 1;
      this.store.getState().applyEvents(paneId, events);
    }

    if (deferred && this.hiddenTimer === null) {
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        this.flushHidden();
      }, HIDDEN_FLUSH_MS);
      // A background flush must never hold the process open on its own.
      this.hiddenTimer.unref?.();
    }
  }

  /** Applies whatever the visible-pane flush deliberately left behind. */
  private flushHidden(): void {
    for (const [paneId, events] of [...this.pending]) {
      if (!this.active.has(paneId)) {
        this.pending.delete(paneId);
        continue;
      }
      this.pending.delete(paneId);
      this.metrics.applied += events.length;
      this.metrics.flushes += 1;
      this.metrics.hiddenFlushes += 1;
      this.store.getState().applyEvents(paneId, events);
    }
  }

  private queueDepth(): number {
    let depth = 0;
    for (const queue of this.pending.values()) depth += queue.length;
    return depth;
  }

  /**
   * Open question #6 — stream health, for `system doctor` and the
   * diagnostics view.
   *
   * Counters rather than a metrics pipeline: `apps/cli` has no OTel wiring
   * (unlike `apps/server`), and inventing one for a single-process TUI would
   * be infrastructure nobody reads. These are the four numbers that actually
   * answer "is the stream healthy?" — how much arrived, how much was
   * applied, how deep the queue ever got, and how many reconnects happened.
   */
  stats(): StreamStats {
    return {
      ...this.metrics,
      subscriptions: this.active.size,
      queueDepth: this.queueDepth(),
      globalAttached: this.globalDispose !== null,
    };
  }

  private disposeAll(): void {
    for (const entry of this.active.values()) entry.dispose();
    this.active.clear();
    if (this.hiddenTimer !== null) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    // Anything already buffered belongs to a subscription that no longer
    // exists — applying it after the fact would resurrect a closed pane's
    // timeline (or one that never gets read again). Not flushing here is
    // the entire point of clearing it, not an oversight.
    this.pending.clear();
  }
}

/**
 * How long a hidden pane's events wait before being applied.
 *
 * Long enough that a background chat streaming flat out costs a handful of
 * store updates a second rather than hundreds; short enough that switching
 * to that tab never waits on it (the switch flushes immediately anyway).
 */
const HIDDEN_FLUSH_MS = 250;

export interface StreamStats {
  /** Events handed to the reconciler by the transport. */
  received: number;
  /** Events actually folded into a timeline. */
  applied: number;
  /** Store updates performed — the expensive unit, since each re-runs reconciliation. */
  flushes: number;
  /** How many of those were the deferred hidden-pane path. */
  hiddenFlushes: number;
  /** Reconnect attempts observed across all subscriptions. */
  reconnects: number;
  /** Deepest the pending buffer has ever been. */
  queueDepthPeak: number;
  /** Pending right now. */
  queueDepth: number;
  /** Live per-pane subscriptions. */
  subscriptions: number;
  /** Whether the global lifecycle subscription is attached. */
  globalAttached: boolean;
}

/**
 * Shared empty result for selectors that have nothing to return.
 *
 * `useSyncExternalStore` compares snapshots by reference, so a selector that
 * builds a fresh `[]` each call reports a change on every render and spins
 * until React throws "Maximum update depth exceeded".
 */
export const NO_ROWS: Record<string, unknown>[] = Object.freeze(
  [] as Record<string, unknown>[],
) as Record<string, unknown>[];

// ── Dashboard rows ────────────────────────────────────────────────

/** How many recent runs the dashboard offers as jump targets. */
export const DASHBOARD_RECENT_RUNS = 12;

/**
 * The sections the dashboard can jump to, and the cache each one counts.
 *
 * Only caches `dataKeysFor('dashboard')` actually loads may appear here: a
 * section whose count is structurally always zero is a lie, which is exactly
 * what the old hard-coded `Projects` stat was.
 */
export const DASHBOARD_SECTIONS: ReadonlyArray<{
  kind: PaneContent['kind'];
  title: string;
  key: DataKey;
}> = [
  { kind: 'chats', title: 'Chats', key: 'chats' },
  { kind: 'workflows', title: 'Workflows', key: 'workflows' },
  { kind: 'runs', title: 'Runs', key: 'runs' },
  { kind: 'automations', title: 'Automations', key: 'automations' },
  { kind: 'projects', title: 'Projects', key: 'projects' },
];

/** A dashboard row: either a section to jump to, or a run to open. */
export interface DashboardRow extends Record<string, unknown> {
  /** Which half of the pane the row belongs to. */
  dashboardRow: 'section' | 'run';
}

/**
 * Every selectable row on the dashboard, sections first, then recent runs.
 *
 * The home pane used to render its recent runs with `selectedIndex={-1}` and
 * size its cursor against `paneListRows`' fallback — which, for the
 * `dashboard` kind, resolved to `dataKeysFor('dashboard')[0]`, i.e. the CHATS
 * cache. So the arrow keys moved a cursor over an invisible list of chats,
 * nothing on screen ever changed, and Enter found no `OPENERS['dashboard']`
 * and returned silently. The first screen of the app had no working
 * navigation at all while its own status bar advertised "⏎ open".
 *
 * Both the cursor and the renderer read THIS function, so the two can no
 * longer disagree about how many rows exist. It is deliberately independent
 * of the pane's height: sizing the cursor against a height-derived slice is
 * how the changes pane once made the bottom of a long diff unreachable.
 */
const dashboardRowCache = new WeakMap<DataCache, DashboardRow[]>();

export function dashboardRows(data: DataCache): DashboardRow[] {
  // Memoised on the cache OBJECT, for the same reason `NO_ROWS` is a frozen
  // singleton: this feeds a `useSyncExternalStore` selector, and a selector
  // that builds a fresh array per call reports a change on every render and
  // spins until React throws "Maximum update depth exceeded". The store
  // replaces `data` wholesale whenever a list is refetched, so identity is
  // an exact staleness check, and a WeakMap keeps no entry alive after that.
  const cached = dashboardRowCache.get(data);
  if (cached) return cached;
  const rows = buildDashboardRows(data);
  dashboardRowCache.set(data, rows);
  return rows;
}

function buildDashboardRows(data: DataCache): DashboardRow[] {
  const sections = DASHBOARD_SECTIONS.map((section) => ({
    dashboardRow: 'section' as const,
    id: `section:${section.kind}`,
    kind: section.kind,
    title: section.title,
    count: data[section.key].length,
    active:
      section.key === 'chats'
        ? data.chats.filter((c) => String(c['status']) === 'active').length
        : section.key === 'runs'
          ? data.runs.filter((r) => statusTone(String(r['status'])) === 'running').length
          : undefined,
  }));

  const runs = [...data.runs]
    .sort((a, b) => epochOr(b['createdAt'] as string) - epochOr(a['createdAt'] as string))
    .slice(0, DASHBOARD_RECENT_RUNS)
    .map((run) => ({ ...run, dashboardRow: 'run' as const }));

  return [...sections, ...runs];
}

// ── Data loading ──────────────────────────────────────────────────

const LOADERS: Record<DataKey, (api: Api) => Promise<Array<Record<string, unknown>>>> = {
  chats: async (api) => (await api.chats.list({ limit: 200 })) as never,
  workflows: async (api) => (await api.definitions.list({ limit: 200 })).items as never,
  runs: async (api) => (await api.runs.list({ limit: 200 })) as never,
  automations: async (api) => (await api.automations.list()) as never,
  projects: async (api) => (await api.projects.list()) as never,
  workspaces: async (api) => (await api.workspaces.list({ limit: 200 })) as never,
  agents: async (api) => (await api.agents.list()) as never,
  scripts: async (api) => (await api.scripts.list()) as never,
  extensions: async (api) => (await api.extensions.list()) as never,
};

/** Which caches a pane kind needs. */
export function dataKeysFor(kind: PaneContent['kind']): DataKey[] {
  switch (kind) {
    case 'dashboard':
      // `projects` is here because the dashboard COUNTS it. It was omitted
      // while the pane still rendered a `Projects` stat, so that number read
      // 0 on an install with fifty projects — a counter that is always zero
      // is worse than no counter at all.
      return ['chats', 'runs', 'workflows', 'automations', 'projects'];
    case 'chats':
      return ['chats'];
    // A chat pane loads more than itself: `@` mentions address agents and
    // projects, and an empty cache makes the menu look broken.
    case 'chat':
      return ['chats', 'agents', 'projects'];
    case 'workflows':
    case 'workflow':
      return ['workflows'];
    case 'runs':
    case 'run':
      return ['runs', 'workflows'];
    case 'automations':
    case 'automation':
      return ['automations'];
    case 'projects':
    case 'project':
      return ['projects'];
    case 'workspaces':
    case 'workspace':
    case 'changes':
      return ['workspaces'];
    case 'agents':
    case 'agent':
      return ['agents'];
    case 'scripts':
    case 'script':
      return ['scripts'];
    case 'extensions':
    case 'extension':
      return ['extensions'];
    default:
      return [];
  }
}

export async function loadData(
  store: StoreApi<TuiStore>,
  api: Api,
  keys: DataKey[],
): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      const state = store.getState();
      // Skip a refetch that would just re-render the same rows; the SSE
      // stream is what keeps live entities current.
      if (state.loading[key]) return;
      state.setLoading(key, true);
      try {
        const rows = await LOADERS[key](api);
        // Defence in depth. A route that answers with an envelope instead of
        // an array used to throw inside render — which unmounts the whole
        // workbench, not just the one pane that asked. One endpoint changing
        // shape must never be able to blank the entire UI.
        if (!Array.isArray(rows)) {
          store
            .getState()
            .setError(key, `Expected a list from the server, got ${typeof rows}.`);
          store.getState().setData(key, []);
          return;
        }
        store.getState().setData(key, rows);
      } catch (error) {
        store.getState().setError(key, error instanceof Error ? error.message : String(error));
      } finally {
        store.getState().setLoading(key, false);
      }
    }),
  );
}

export { serialise as serialiseWorkbench, deserialise as deserialiseWorkbench, leaves as paneLeaves, selectActiveTab, visibleLeafIds };
export type { CommandSpec };
