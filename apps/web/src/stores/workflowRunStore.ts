// ────────────────────────────────────────────────────────────────
// workflowRunStore — Zustand store for runtime workflow run monitoring
//
// Manages per-run state: WorkflowRun metadata, StageRun statuses, the
// focused stage (ONE field for the page, the graph and the event timeline,
// D-20), and SSE event routing for real-time updates.
//
// Two writers own `run`: the SSE effects and the 5 s poll. Every instance
// carries its CAS `version`, so the two merge per instance: the newer one
// wins, and a poll snapshot taken just before a transition never rolls a
// fresher SSE status back (D-21b). The run clock lives in the run header,
// not here (D-24).
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type {
  WorkflowRun,
  WorkflowRunWithStages,
  WorkflowRunStatus,
  StageRun,
  StageRunStatus,
} from '@generatorai/shared';
import { globalSingleton } from '../lib/globalSingleton.js';

// ── Types ──

interface RunMonitorState {
  /** Currently monitored workflow run (full entity with stage runs) */
  run: WorkflowRunWithStages | null;
  /** Map of stageRunId → sessionId for SSE event routing */
  stageSessionMap: Record<string, string>;
  /** The focused stage: the run page, the graph and the event timeline all read and write it (D-20). */
  selectedStageRunId: string | null;
  /** The user picked the focused stage: a stage starting elsewhere no longer moves the focus. */
  focusPinned: boolean;
  /** Whether the run data is loading */
  isLoading: boolean;
  /** Error message if run load failed */
  error: string | null;
}

interface RunMonitorActions {
  /** Load (or merge, per instance by version) a workflow run + stage runs from the API. */
  setRun: (run: WorkflowRunWithStages) => void;
  /** Clear the current run state */
  clearRun: () => void;
  /** The user focuses a stage (page, graph, timeline); pins the focus. */
  selectStageRun: (stageRunId: string | null) => void;
  /** A stage started: focus it unless the user already picked one. */
  suggestStageRun: (stageRunId: string) => void;
  /** Update run status from SSE event */
  updateRunStatus: (status: WorkflowRunStatus, data?: Record<string, unknown>) => void;
  /** Update a stage run from SSE event */
  updateStageRun: (stageRunId: string, updates: Partial<StageRun>) => void;
  /** Update stage run status from SSE event (inserts an instance the store does not know yet). */
  updateStageRunStatus: (stageRunId: string, status: StageRunStatus, data?: Record<string, unknown>) => void;
  /** Register a stage → session mapping for SSE routing */
  registerStageSession: (stageRunId: string, sessionId: string) => void;
  /** Get sessionId for a stage run */
  getSessionId: (stageRunId: string) => string | undefined;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Get the currently selected stage run */
  getSelectedStageRun: () => StageRun | null;
  /** Auto-select a stage: awaiting input, then running, then the first. */
  autoSelectStage: () => void;
}

// ── Initial state ──

const initialState: RunMonitorState = {
  run: null,
  stageSessionMap: {},
  selectedStageRunId: null,
  focusPinned: false,
  isLoading: false,
  error: null,
};

// ── Helpers ──

function isTerminalRunStatus(status: WorkflowRunStatus): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function isTerminalStageStatus(status: StageRunStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'skipped'].includes(status);
}

function sessionMapOf(stageRuns: StageRun[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const sr of stageRuns) if (sr.sessionId) map[sr.id] = sr.sessionId;
  return map;
}

/**
 * Where an instance the stream inserted sits in a loop (P05): its path is
 * `<loop>#<k>/<body>` (an iteration) or `<loop>#wrapup/<body>` (the wrap-up),
 * so it groups under its loop before the next poll brings `scopeId`.
 */
function loopPlacement(stageRuns: StageRun[], instancePath: string): Pick<StageRun, 'scopeId' | 'iterationIndex'> {
  const m = /^(.+)#(\d+|wrapup)\/[^/#]+$/.exec(instancePath);
  if (!m) return {};
  const loop = stageRuns.find((sr) => sr.instancePath === m[1]);
  return {
    ...(loop ? { scopeId: loop.id } : {}),
    ...(m[2] !== 'wrapup' ? { iterationIndex: Number(m[2]) } : {}),
  };
}

/**
 * Merge a polled run into the one on screen, per instance by `version`
 * (D-21b): an instance the stream already moved past the snapshot keeps its
 * fresher state; instances the stream inserted and the snapshot predates
 * are kept too.
 */
function mergeRun(local: WorkflowRunWithStages | null, polled: WorkflowRunWithStages): WorkflowRunWithStages {
  if (!local || local.id !== polled.id) return polled;
  const localById = new Map(local.stageRuns.map((sr) => [sr.id, sr]));
  const stageRuns = polled.stageRuns.map((p) => {
    const l = localById.get(p.id);
    return l && (l.version ?? 0) > (p.version ?? 0) ? l : p;
  });
  const polledIds = new Set(polled.stageRuns.map((sr) => sr.id));
  for (const l of local.stageRuns) if (!polledIds.has(l.id)) stageRuns.push(l);
  const runIsOlder = (local.version ?? 0) > (polled.version ?? 0);
  return runIsOlder ? { ...polled, status: local.status, stageRuns } : { ...polled, stageRuns };
}

// ── Store ──

const useWorkflowRunStoreImpl = create<RunMonitorState & RunMonitorActions>((set, get) => ({
  ...initialState,

  setRun: (incoming) => {
    const run = mergeRun(get().run, incoming);
    set({
      run,
      stageSessionMap: sessionMapOf(run.stageRuns),
      isLoading: false,
      error: null,
    });
    const state = get();
    if (!state.selectedStageRunId || !run.stageRuns.some((sr) => sr.id === state.selectedStageRunId)) {
      state.autoSelectStage();
    }
  },

  clearRun: () => set({ ...initialState }),

  selectStageRun: (stageRunId) => set({ selectedStageRunId: stageRunId, focusPinned: stageRunId !== null }),

  suggestStageRun: (stageRunId) => {
    if (get().focusPinned) return;
    set({ selectedStageRunId: stageRunId });
  },

  updateRunStatus: (status, data) => {
    const { run } = get();
    if (!run) return;

    const updates: Partial<WorkflowRun> = { status, updatedAt: new Date() };
    if (status === 'running' && !run.startedAt) {
      updates.startedAt = new Date();
    }
    if (isTerminalRunStatus(status) && !run.completedAt) {
      updates.completedAt = new Date();
    }
    if (data?.['error']) {
      updates.error = data['error'] as string;
    }
    set({ run: { ...run, ...updates } });
  },

  updateStageRun: (stageRunId, updates) => {
    const { run } = get();
    if (!run) return;

    const stageRuns = run.stageRuns.map((sr) =>
      sr.id === stageRunId ? { ...sr, ...updates } : sr,
    );

    // Update session map if sessionId changed
    const stageSessionMap = { ...get().stageSessionMap };
    const updatedStage = stageRuns.find((sr) => sr.id === stageRunId);
    if (updatedStage?.sessionId) {
      stageSessionMap[stageRunId] = updatedStage.sessionId;
    }

    set({
      run: { ...run, stageRuns },
      stageSessionMap,
    });
  },

  updateStageRunStatus: (stageRunId, status, data) => {
    const { run } = get();
    if (!run) return;
    // Events for another run's instances (the global bus) are not ours.
    const eventRunId = data?.['workflowRunId'];
    if (typeof eventRunId === 'string' && eventRunId !== run.id) return;

    const now = new Date();
    const version = typeof data?.['version'] === 'number' ? (data['version'] as number) : undefined;
    const apply = (sr: StageRun): StageRun => {
      const updates: Partial<StageRun> = { status };
      if (version !== undefined) updates.version = version;
      if (status === 'running' && !sr.startedAt) {
        updates.startedAt = now;
      }
      if (isTerminalStageStatus(status) && !sr.completedAt) {
        updates.completedAt = now;
      }
      if (data?.['error']) {
        updates.error = data['error'] as string;
      }
      if (data?.['sessionId']) {
        updates.sessionId = data['sessionId'] as string;
      }
      // D-19: the gate's request arrives WITH the status, so its controls
      // render now rather than on the next poll; leaving the gate clears it.
      if (status === 'awaiting_input') {
        if (data?.['interruptData'] !== undefined) updates.interruptData = data['interruptData'];
      } else if (sr.interruptData !== undefined) {
        updates.interruptData = undefined;
      }
      // A loop's state rides along when the event carries it (P05).
      const loopState = data?.['loopState'];
      if (loopState && typeof loopState === 'object') updates.loopState = loopState as StageRun['loopState'];
      return { ...sr, ...updates };
    };

    let found = false;
    const stageRuns: StageRun[] = [];
    for (const sr of run.stageRuns) {
      if (sr.id !== stageRunId) {
        stageRuns.push(sr);
        continue;
      }
      found = true;
      // A status older than what the store already shows (a late event) is dropped.
      stageRuns.push(version !== undefined && version < (sr.version ?? 0) ? sr : apply(sr));
    }
    // An instance the store has not seen (a retry's, an iteration's): insert
    // it from the event instead of waiting for the next poll.
    const stageKey = data?.['stageKey'];
    if (!found && typeof stageKey === 'string') {
      const instancePath = typeof data?.['instancePath'] === 'string' ? (data['instancePath'] as string) : stageKey;
      stageRuns.push(
        apply({
          id: stageRunId,
          workflowRunId: run.id,
          stageKey,
          instancePath,
          kind: typeof data?.['kind'] === 'string' ? (data['kind'] as string) : 'agent',
          name: typeof data?.['name'] === 'string' ? (data['name'] as string) : stageKey,
          status,
          currentAttempt: 0,
          version: version ?? 0,
          createdAt: now,
          ...loopPlacement(run.stageRuns, instancePath),
        } as StageRun),
      );
    }

    // Update session mapping
    const stageSessionMap = { ...get().stageSessionMap };
    const updatedStage = stageRuns.find((sr) => sr.id === stageRunId);
    if (updatedStage?.sessionId) {
      stageSessionMap[stageRunId] = updatedStage.sessionId;
    }

    set({
      run: { ...run, stageRuns },
      stageSessionMap,
    });
  },

  registerStageSession: (stageRunId, sessionId) => {
    set((state) => ({
      stageSessionMap: { ...state.stageSessionMap, [stageRunId]: sessionId },
    }));
  },

  getSessionId: (stageRunId) => get().stageSessionMap[stageRunId],

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error, isLoading: false }),

  getSelectedStageRun: () => {
    const { run, selectedStageRunId } = get();
    if (!run || !selectedStageRunId) return null;
    return run.stageRuns.find((sr) => sr.id === selectedStageRunId) ?? null;
  },

  autoSelectStage: () => {
    const { run } = get();
    if (!run || run.stageRuns.length === 0) return;

    // Priority: the stage waiting on the user, then running, ready, pending, …
    const priority: StageRunStatus[] = ['awaiting_input', 'running', 'ready', 'pending', 'completed', 'failed'];
    for (const status of priority) {
      const found = run.stageRuns.find((sr) => sr.status === status);
      if (found) {
        set({ selectedStageRunId: found.id });
        return;
      }
    }
    // Fallback to first
    const first = run.stageRuns[0];
    if (first) set({ selectedStageRunId: first.id });
  },
}));


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useWorkflowRunStore = globalSingleton('web.workflowRunStore', () => useWorkflowRunStoreImpl);
