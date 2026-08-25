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
import { useSyncExternalStore } from 'react';
import {
  addTab,
  allAttachments,
  closePane,
  closeTab,
  createWorkbench,
  cyclePane,
  cycleTab,
  emptyTimeline,
  focusPane,
  reduceEvent,
  renameTab,
  selectTab,
  serialise,
  deserialise,
  splitPane,
  toggleZoom,
  updatePane,
  activeTab as selectActiveTab,
  leaves,
  type Api,
  type CommandSpec,
  type PaneContent,
  type StreamPort,
  type TimelineState,
  type WorkbenchState,
} from '@generatorai/cli-core';

export type OverlayKind =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'confirm'; message: string; danger: boolean; onAnswer: (value: boolean) => void }
  | { kind: 'input'; message: string; initial: string; onSubmit: (value: string) => void }
  | { kind: 'select'; message: string; options: Array<{ value: string; label: string; detail?: string }>; onSelect: (value: string) => void }
  | { kind: 'error'; title: string; message: string; hint?: string };

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
  openPane(content: PaneContent, mode?: 'tab' | 'split-v' | 'split-h' | 'replace'): void;
  closeActivePane(): void;
  closeActiveTab(): void;
  focusTab(index: number): void;
  nextTab(): void;
  prevTab(): void;
  nextPane(): void;
  prevPane(): void;
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
  applyEvent(paneId: string, event: { kind: string; data: Record<string, unknown>; sequence?: number }): void;
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
    connection: null,
    history: initial?.history ?? [],
    theme: initial?.theme ?? 'auto',
    showThinking: true,
    suspended: false,

    openPane(content, mode = 'tab') {
      set((state) => {
        switch (mode) {
          case 'split-v':
            return { workbench: splitPane(state.workbench, 'vertical', content) };
          case 'split-h':
            return { workbench: splitPane(state.workbench, 'horizontal', content) };
          case 'replace': {
            const tab = selectActiveTab(state.workbench);
            return { workbench: updatePane(state.workbench, tab.focusedPaneId, content) };
          }
          default:
            return { workbench: addTab(state.workbench, content) };
        }
      });
    },

    closeActivePane() {
      set((state) => ({ workbench: closePane(state.workbench) }));
    },

    closeActiveTab() {
      set((state) => ({ workbench: closeTab(state.workbench, state.workbench.activeTabId) }));
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
    nextPane() {
      set((state) => ({ workbench: cyclePane(state.workbench, 1) }));
    },
    prevPane() {
      set((state) => ({ workbench: cyclePane(state.workbench, -1) }));
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

    applyEvent(paneId, event) {
      set((state) => {
        const current = state.timelines[paneId] ?? emptyTimeline();
        const next = reduceEvent(current, event, {
          showThinking: true,
          showTools: true,
          // Bounded so a run producing 200k events cannot exhaust memory in a
          // long-lived TUI. The full history is still on the server.
          maxItems: 2000,
        });
        return next === current ? {} : { timelines: { ...state.timelines, [paneId]: next } };
      });
    },
    resetTimeline(paneId) {
      set((state) => ({ timelines: { ...state.timelines, [paneId]: emptyTimeline() } }));
    },

    seedTimeline(paneId, timeline) {
      set((state) => {
        const current = state.timelines[paneId];
        // Live events may already have arrived while history was in flight.
        // They are newer than anything on disk, so they win.
        if (current && current.items.length > 0) {
          return {
            timelines: {
              ...state.timelines,
              [paneId]: { ...current, items: [...timeline.items, ...current.items] },
            },
          };
        }
        return { timelines: { ...state.timelines, [paneId]: timeline } };
      });
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
 * W48 / STR-04 — stream connection deduplication (done).
 * `createCliClient` wraps the raw StreamPort with `SharedStreamPort`, which
 * shares a single underlying SSE connection for any (scope, id) pair that more
 * than one pane subscribes to. Duplicate connections when the user opens the
 * same chat/run in multiple panes are now eliminated.
 *
 * TODO(mux-stream-cli-full): one connection for ALL scopes — requires adopting
 * the POST-based mux subscription protocol from apps/web/src/platform/muxStream.ts.
 * See packages/cli-core/src/client/SharedStreamPort.ts for the current step.
 */
export class StreamReconciler {
  private readonly active = new Map<string, { key: string; dispose: () => void }>();

  constructor(
    private readonly store: StoreApi<TuiStore>,
    private readonly stream: StreamPort,
  ) {}

  start(): () => void {
    const unsubscribe = this.store.subscribe(() => this.reconcile());
    this.reconcile();
    return () => {
      unsubscribe();
      this.disposeAll();
    };
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
        (event) => this.store.getState().applyEvent(attachment.paneId, event),
        {
          onReconnecting: (attempt) => {
            if (attempt === 3) {
              this.store.getState().toast('Reconnecting to the event stream…', 'warning');
            }
          },
        },
      );
      this.active.set(attachment.paneId, { key, dispose });
    }
  }

  private disposeAll(): void {
    for (const entry of this.active.values()) entry.dispose();
    this.active.clear();
  }
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

// ── Data loading ──────────────────────────────────────────────────

const LOADERS: Record<DataKey, (api: Api) => Promise<Array<Record<string, unknown>>>> = {
  chats: async (api) => (await api.chats.list({ limit: 200 })) as never,
  workflows: async (api) => (await api.definitions.list()) as never,
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
      return ['chats', 'runs', 'workflows', 'automations'];
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

export { serialise as serialiseWorkbench, deserialise as deserialiseWorkbench, leaves as paneLeaves, selectActiveTab };
export type { CommandSpec };
