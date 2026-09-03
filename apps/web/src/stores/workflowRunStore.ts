// ────────────────────────────────────────────────────────────────
// workflowRunStore — Zustand store for runtime workflow run monitoring
//
// Manages per-run state: WorkflowRun metadata, StageRun statuses,
// stage streaming states, selected stage for detail view, and
// SSE event routing for real-time updates.
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

export interface RunTimelineEvent {
  id: string;
  timestamp: Date;
  type: 'run' | 'stage';
  runId: string;
  stageRunId?: string;
  stageName?: string;
  status: WorkflowRunStatus | StageRunStatus;
  message: string;
  data?: Record<string, unknown>;
}

export interface AwaitingInputInfo {
  stageRunId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

interface RunMonitorState {
  /** Currently monitored workflow run (full entity with stage runs) */
  run: WorkflowRunWithStages | null;
  /** Map of stageRunId → sessionId for SSE event routing */
  stageSessionMap: Record<string, string>;
  /** ID of the currently selected stage for detail view */
  selectedStageRunId: string | null;
  /** Run timeline events for display */
  timelineEvents: RunTimelineEvent[];
  /** Whether the run data is loading */
  isLoading: boolean;
  /** Error message if run load failed */
  error: string | null;
  /** Duration timer interval reference */
  durationTimerRef: ReturnType<typeof setInterval> | null;
  /** Current elapsed time in ms for active runs (updated by timer) */
  elapsedMs: number;
  /** Stages currently awaiting human input (HITL) */
  awaitingInputStages: AwaitingInputInfo[];
}

interface RunMonitorActions {
  /** Load a workflow run + stage runs from API response */
  setRun: (run: WorkflowRunWithStages) => void;
  /** Clear the current run state */
  clearRun: () => void;
  /** Select a stage run for detail view */
  selectStageRun: (stageRunId: string | null) => void;
  /** Update run status from SSE event */
  updateRunStatus: (status: WorkflowRunStatus, data?: Record<string, unknown>) => void;
  /** Update a stage run from SSE event */
  updateStageRun: (stageRunId: string, updates: Partial<StageRun>) => void;
  /** Update stage run status from SSE event */
  updateStageRunStatus: (stageRunId: string, status: StageRunStatus, data?: Record<string, unknown>) => void;
  /** Register a stage → session mapping for SSE routing */
  registerStageSession: (stageRunId: string, sessionId: string) => void;
  /** Get sessionId for a stage run */
  getSessionId: (stageRunId: string) => string | undefined;
  /** Add a timeline event */
  addTimelineEvent: (event: Omit<RunTimelineEvent, 'id'>) => void;
  /** Start the duration timer */
  startDurationTimer: () => void;
  /** Stop the duration timer */
  stopDurationTimer: () => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Get the currently selected stage run */
  getSelectedStageRun: () => StageRun | null;
  /** Auto-select the first running or first stage */
  autoSelectStage: () => void;
  /** Mark a stage as awaiting human input */
  setAwaitingInput: (stageRunId: string, data: Record<string, unknown>) => void;
  /** Clear awaiting input for a stage (when input received) */
  clearAwaitingInput: (stageRunId: string) => void;
}

// ── Initial state ──

const initialState: RunMonitorState = {
  run: null,
  stageSessionMap: {},
  selectedStageRunId: null,
  timelineEvents: [],
  isLoading: false,
  error: null,
  durationTimerRef: null,
  elapsedMs: 0,
  awaitingInputStages: [],
};

// ── Helpers ──

let timelineEventCounter = 0;

function generateEventId(): string {
  timelineEventCounter++;
  return `evt-${Date.now()}-${timelineEventCounter}`;
}

function isTerminalRunStatus(status: WorkflowRunStatus): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function isTerminalStageStatus(status: StageRunStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'skipped'].includes(status);
}

function computeElapsed(run: WorkflowRun | null): number {
  if (!run) return 0;
  const start = run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime();
  if (run.completedAt) {
    return new Date(run.completedAt).getTime() - start;
  }
  if (isTerminalRunStatus(run.status)) {
    return new Date(run.updatedAt).getTime() - start;
  }
  return Date.now() - start;
}

// ── Store ──

const useWorkflowRunStoreImpl = create<RunMonitorState & RunMonitorActions>((set, get) => ({
  ...initialState,

  setRun: (run) => {
    // Build stage → session map from stage runs
    const stageSessionMap: Record<string, string> = {};
    for (const sr of run.stageRuns) {
      if (sr.sessionId) {
        stageSessionMap[sr.id] = sr.sessionId;
      }
    }

    set({
      run,
      stageSessionMap,
      elapsedMs: computeElapsed(run),
      isLoading: false,
      error: null,
    });

    // Auto-select first running stage or first stage
    const state = get();
    if (!state.selectedStageRunId) {
      state.autoSelectStage();
    }

    // Start or stop duration timer based on run status
    if (!isTerminalRunStatus(run.status) && run.status !== 'created') {
      state.startDurationTimer();
    } else {
      state.stopDurationTimer();
    }
  },

  clearRun: () => {
    const { durationTimerRef } = get();
    if (durationTimerRef) clearInterval(durationTimerRef);
    set({
      ...initialState,
    });
  },

  selectStageRun: (stageRunId) => set({ selectedStageRunId: stageRunId }),

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

    set({
      run: { ...run, ...updates },
      elapsedMs: computeElapsed({ ...run, ...updates }),
    });

    // Stop timer on terminal statuses
    if (isTerminalRunStatus(status)) {
      get().stopDurationTimer();
    }
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

    const now = new Date();
    const stageRuns = run.stageRuns.map((sr) => {
      if (sr.id !== stageRunId) return sr;
      const updates: Partial<StageRun> = { status };
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
      if (data?.['currentStep'] !== undefined) {
        updates.currentStep = data['currentStep'] as number;
      }
      return { ...sr, ...updates };
    });

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

  addTimelineEvent: (event) => {
    const id = generateEventId();
    set((state) => ({
      timelineEvents: [...state.timelineEvents, { ...event, id }],
    }));
  },

  startDurationTimer: () => {
    const { durationTimerRef, run } = get();
    if (durationTimerRef) return; // Already running
    const timer = setInterval(() => {
      const currentRun = get().run;
      if (currentRun && !isTerminalRunStatus(currentRun.status)) {
        set({ elapsedMs: computeElapsed(currentRun) });
      }
    }, 1000);
    set({ durationTimerRef: timer, elapsedMs: computeElapsed(run) });
  },

  stopDurationTimer: () => {
    const { durationTimerRef, run } = get();
    if (durationTimerRef) {
      clearInterval(durationTimerRef);
      set({ durationTimerRef: null, elapsedMs: computeElapsed(run) });
    }
  },

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

    // Priority: first running, then first queued, then first pending, then first
    const priority: StageRunStatus[] = ['running', 'queued', 'pending', 'completed', 'failed'];
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

  setAwaitingInput: (stageRunId, data) => {
    set((state) => {
      // Don't add duplicates
      if (state.awaitingInputStages.some((s) => s.stageRunId === stageRunId)) return state;
      return {
        awaitingInputStages: [
          ...state.awaitingInputStages,
          { stageRunId, timestamp: new Date(), data },
        ],
      };
    });
  },

  clearAwaitingInput: (stageRunId) => {
    set((state) => ({
      awaitingInputStages: state.awaitingInputStages.filter((s) => s.stageRunId !== stageRunId),
    }));
  },
}));


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useWorkflowRunStore = globalSingleton('web.workflowRunStore', () => useWorkflowRunStoreImpl);
