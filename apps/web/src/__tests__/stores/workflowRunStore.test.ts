// ────────────────────────────────────────────────────────────────
// workflowRunStore tests — Run monitoring state management
// Status updates, stage tracking, timeline events, duration timer
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import type {
  WorkflowRunWithStages,
  StageRun,
  WorkflowRunStatus,
  StageRunStatus,
} from '@generatorai/shared';

// ── Helpers ──

function makeStageRun(overrides: Partial<StageRun> = {}): StageRun {
  return {
    id: `sr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    workflowRunId: 'run-1',
    stageDefinitionId: 'sd-1',
    name: 'Stage 1',
    status: 'pending',
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    createdAt: new Date(),
    ...overrides,
  } as StageRun;
}

function makeRun(overrides: Partial<WorkflowRunWithStages> = {}): WorkflowRunWithStages {
  return {
    id: 'run-1',
    workflowDefinitionId: 'def-1',
    name: 'Test Run',
    status: 'created',
    sessionMode: 'auto',
    variables: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    stageRuns: [
      makeStageRun({ id: 'sr-1', name: 'Build', sessionId: 'sess-1' }),
      makeStageRun({ id: 'sr-2', name: 'Test', status: 'pending' }),
      makeStageRun({ id: 'sr-3', name: 'Deploy', status: 'pending' }),
    ],
    ...overrides,
  };
}

describe('workflowRunStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkflowRunStore.getState().clearRun();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ══════════════════════════════════════════
  // setRun
  // ══════════════════════════════════════════
  describe('setRun', () => {
    it('loads run and builds stageSessionMap', () => {
      const run = makeRun();
      useWorkflowRunStore.getState().setRun(run);

      const state = useWorkflowRunStore.getState();
      expect(state.run).toBeTruthy();
      expect(state.run!.id).toBe('run-1');
      expect(state.stageSessionMap['sr-1']).toBe('sess-1');
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('auto-selects first stage run', () => {
      const run = makeRun();
      useWorkflowRunStore.getState().setRun(run);

      const state = useWorkflowRunStore.getState();
      expect(state.selectedStageRunId).toBeTruthy();
    });

    it('computes elapsed time', () => {
      const now = new Date();
      const run = makeRun({
        status: 'running',
        startedAt: new Date(now.getTime() - 5000),
      });
      useWorkflowRunStore.getState().setRun(run);

      const state = useWorkflowRunStore.getState();
      expect(state.elapsedMs).toBeGreaterThanOrEqual(4500);
    });
  });

  // ══════════════════════════════════════════
  // clearRun
  // ══════════════════════════════════════════
  describe('clearRun', () => {
    it('resets all state', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().clearRun();

      const state = useWorkflowRunStore.getState();
      expect(state.run).toBeNull();
      expect(state.stageSessionMap).toEqual({});
      expect(state.selectedStageRunId).toBeNull();
      expect(state.timelineEvents).toEqual([]);
      expect(state.elapsedMs).toBe(0);
    });
  });

  // ══════════════════════════════════════════
  // updateRunStatus
  // ══════════════════════════════════════════
  describe('updateRunStatus', () => {
    it('updates run status', () => {
      useWorkflowRunStore.getState().setRun(makeRun({ status: 'created' }));
      useWorkflowRunStore.getState().updateRunStatus('running');

      expect(useWorkflowRunStore.getState().run!.status).toBe('running');
    });

    it('sets startedAt on running', () => {
      useWorkflowRunStore.getState().setRun(makeRun({ status: 'created' }));
      useWorkflowRunStore.getState().updateRunStatus('running');

      expect(useWorkflowRunStore.getState().run!.startedAt).toBeTruthy();
    });

    it('sets completedAt on terminal status', () => {
      useWorkflowRunStore.getState().setRun(makeRun({ status: 'running', startedAt: new Date() }));
      useWorkflowRunStore.getState().updateRunStatus('completed');

      expect(useWorkflowRunStore.getState().run!.completedAt).toBeTruthy();
    });

    it('stores error from data', () => {
      useWorkflowRunStore.getState().setRun(makeRun({ status: 'running', startedAt: new Date() }));
      useWorkflowRunStore.getState().updateRunStatus('failed', { error: 'Build failed' });

      expect(useWorkflowRunStore.getState().run!.error).toBe('Build failed');
    });

    it('is no-op when no run loaded', () => {
      useWorkflowRunStore.getState().updateRunStatus('running');
      expect(useWorkflowRunStore.getState().run).toBeNull();
    });
  });

  // ══════════════════════════════════════════
  // updateStageRunStatus
  // ══════════════════════════════════════════
  describe('updateStageRunStatus', () => {
    it('updates a stage run status', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRunStatus('sr-1', 'running');

      const stage = useWorkflowRunStore.getState().run!.stageRuns.find((s) => s.id === 'sr-1');
      expect(stage!.status).toBe('running');
    });

    it('sets startedAt on running', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRunStatus('sr-2', 'running');

      const stage = useWorkflowRunStore.getState().run!.stageRuns.find((s) => s.id === 'sr-2');
      expect(stage!.startedAt).toBeTruthy();
    });

    it('sets completedAt on terminal status', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRunStatus('sr-1', 'running');
      useWorkflowRunStore.getState().updateStageRunStatus('sr-1', 'completed');

      const stage = useWorkflowRunStore.getState().run!.stageRuns.find((s) => s.id === 'sr-1');
      expect(stage!.completedAt).toBeTruthy();
    });

    it('registers sessionId from event data', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRunStatus('sr-2', 'running', { sessionId: 'sess-new' });

      const state = useWorkflowRunStore.getState();
      expect(state.stageSessionMap['sr-2']).toBe('sess-new');
    });

    it('stores error on failure', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRunStatus('sr-1', 'failed', { error: 'OOM' });

      const stage = useWorkflowRunStore.getState().run!.stageRuns.find((s) => s.id === 'sr-1');
      expect(stage!.error).toBe('OOM');
    });

    it('updates currentStep', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRunStatus('sr-1', 'running', { currentStep: 2 });

      const stage = useWorkflowRunStore.getState().run!.stageRuns.find((s) => s.id === 'sr-1');
      expect(stage!.currentStep).toBe(2);
    });
  });

  // ══════════════════════════════════════════
  // updateStageRun
  // ══════════════════════════════════════════
  describe('updateStageRun', () => {
    it('applies partial updates to a stage run', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRun('sr-1', { name: 'Renamed', retryCount: 2 });

      const stage = useWorkflowRunStore.getState().run!.stageRuns.find((s) => s.id === 'sr-1');
      expect(stage!.name).toBe('Renamed');
      expect(stage!.retryCount).toBe(2);
    });

    it('updates sessionId in stageSessionMap', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().updateStageRun('sr-2', { sessionId: 'sess-x' });

      expect(useWorkflowRunStore.getState().stageSessionMap['sr-2']).toBe('sess-x');
    });
  });

  // ══════════════════════════════════════════
  // registerStageSession / getSessionId
  // ══════════════════════════════════════════
  describe('registerStageSession / getSessionId', () => {
    it('registers and retrieves session mappings', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().registerStageSession('sr-3', 'sess-99');

      expect(useWorkflowRunStore.getState().getSessionId('sr-3')).toBe('sess-99');
    });

    it('returns undefined for unregistered stage', () => {
      useWorkflowRunStore.getState().setRun(makeRun());

      expect(useWorkflowRunStore.getState().getSessionId('nonexistent')).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════
  // selectStageRun / getSelectedStageRun
  // ══════════════════════════════════════════
  describe('selectStageRun / getSelectedStageRun', () => {
    it('selects a stage run by id', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().selectStageRun('sr-2');

      expect(useWorkflowRunStore.getState().selectedStageRunId).toBe('sr-2');
    });

    it('getSelectedStageRun returns the selected stage', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().selectStageRun('sr-2');

      const selected = useWorkflowRunStore.getState().getSelectedStageRun();
      expect(selected).toBeTruthy();
      expect(selected!.id).toBe('sr-2');
      expect(selected!.name).toBe('Test');
    });

    it('getSelectedStageRun returns null when nothing selected', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().selectStageRun(null);

      expect(useWorkflowRunStore.getState().getSelectedStageRun()).toBeNull();
    });
  });

  // ══════════════════════════════════════════
  // autoSelectStage
  // ══════════════════════════════════════════
  describe('autoSelectStage', () => {
    it('selects the first running stage', () => {
      const run = makeRun({
        stageRuns: [
          makeStageRun({ id: 'sr-a', name: 'A', status: 'completed' }),
          makeStageRun({ id: 'sr-b', name: 'B', status: 'running' }),
          makeStageRun({ id: 'sr-c', name: 'C', status: 'pending' }),
        ],
      });
      // Clear any prior selection
      useWorkflowRunStore.setState({ selectedStageRunId: null });
      useWorkflowRunStore.getState().setRun(run);

      expect(useWorkflowRunStore.getState().selectedStageRunId).toBe('sr-b');
    });

    it('falls back to first queued when none running', () => {
      const run = makeRun({
        stageRuns: [
          makeStageRun({ id: 'sr-a', name: 'A', status: 'completed' }),
          makeStageRun({ id: 'sr-b', name: 'B', status: 'queued' }),
        ],
      });
      useWorkflowRunStore.setState({ selectedStageRunId: null });
      useWorkflowRunStore.getState().setRun(run);

      expect(useWorkflowRunStore.getState().selectedStageRunId).toBe('sr-b');
    });

    it('falls back to first stage when all completed', () => {
      const run = makeRun({
        stageRuns: [
          makeStageRun({ id: 'sr-a', name: 'A', status: 'completed' }),
          makeStageRun({ id: 'sr-b', name: 'B', status: 'completed' }),
        ],
      });
      useWorkflowRunStore.setState({ selectedStageRunId: null });
      useWorkflowRunStore.getState().setRun(run);

      expect(useWorkflowRunStore.getState().selectedStageRunId).toBe('sr-a');
    });
  });

  // ══════════════════════════════════════════
  // Timeline events
  // ══════════════════════════════════════════
  describe('addTimelineEvent', () => {
    it('appends timeline events with generated id', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().addTimelineEvent({
        timestamp: new Date(),
        type: 'run',
        runId: 'run-1',
        status: 'running',
        message: 'Run started',
      });

      const events = useWorkflowRunStore.getState().timelineEvents;
      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBeTruthy();
      expect(events[0]!.message).toBe('Run started');
      expect(events[0]!.type).toBe('run');
    });

    it('accumulates multiple events', () => {
      useWorkflowRunStore.getState().setRun(makeRun());
      useWorkflowRunStore.getState().addTimelineEvent({
        timestamp: new Date(),
        type: 'run',
        runId: 'run-1',
        status: 'running',
        message: 'Event 1',
      });
      useWorkflowRunStore.getState().addTimelineEvent({
        timestamp: new Date(),
        type: 'stage',
        runId: 'run-1',
        stageRunId: 'sr-1',
        stageName: 'Build',
        status: 'running',
        message: 'Event 2',
      });

      expect(useWorkflowRunStore.getState().timelineEvents).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════
  // Loading / Error state
  // ══════════════════════════════════════════
  describe('setLoading / setError', () => {
    it('sets loading state', () => {
      useWorkflowRunStore.getState().setLoading(true);
      expect(useWorkflowRunStore.getState().isLoading).toBe(true);

      useWorkflowRunStore.getState().setLoading(false);
      expect(useWorkflowRunStore.getState().isLoading).toBe(false);
    });

    it('sets error and clears loading', () => {
      useWorkflowRunStore.getState().setLoading(true);
      useWorkflowRunStore.getState().setError('Something broke');

      const state = useWorkflowRunStore.getState();
      expect(state.error).toBe('Something broke');
      expect(state.isLoading).toBe(false);
    });
  });

  // ══════════════════════════════════════════
  // Duration timer
  // ══════════════════════════════════════════
  describe('startDurationTimer / stopDurationTimer', () => {
    it('starts and updates elapsed', () => {
      const run = makeRun({
        status: 'running',
        startedAt: new Date(Date.now() - 10_000),
      });
      useWorkflowRunStore.getState().setRun(run);

      // Timer should have started since status is 'running'
      const ref = useWorkflowRunStore.getState().durationTimerRef;
      expect(ref).toBeTruthy();

      // Advance and check elapsed increases
      vi.advanceTimersByTime(2000);
      expect(useWorkflowRunStore.getState().elapsedMs).toBeGreaterThan(10_000);
    });

    it('stops timer on terminal status', () => {
      const run = makeRun({
        status: 'running',
        startedAt: new Date(Date.now() - 5000),
      });
      useWorkflowRunStore.getState().setRun(run);

      // Running — timer should be active
      expect(useWorkflowRunStore.getState().durationTimerRef).toBeTruthy();

      // Complete the run
      useWorkflowRunStore.getState().updateRunStatus('completed');

      expect(useWorkflowRunStore.getState().durationTimerRef).toBeNull();
    });

    it('does not start timer on terminal status', () => {
      const run = makeRun({
        status: 'completed',
        startedAt: new Date(Date.now() - 30_000),
        completedAt: new Date(Date.now() - 1000),
      });
      useWorkflowRunStore.getState().setRun(run);

      expect(useWorkflowRunStore.getState().durationTimerRef).toBeNull();
    });
  });
});
