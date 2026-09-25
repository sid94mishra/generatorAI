// ────────────────────────────────────────────────────────────────
// WorkflowRunService Tests  (P3.17)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import {
  MockWorkflowRunRepository,
  MockStageRunRepository,
  MockWorkflowDefinitionStore,
  createFakeWorkspaceManager,
  seedDefinition,
  testGraph,
  type SeedEdge,
  type SeedStage,
} from './MockRepositories.js';
import { EventBus } from '../src/events/EventBus.js';
import { AdmissionController } from '../src/services/AdmissionController.js';
import { DAGScheduler } from '../src/services/DAGScheduler.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';
import type { StageExecutionService } from '../src/services/StageExecutionService.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { StageRun } from '@generatorai/shared';

// ── Helpers ──

function createMockStageExecutionService(): StageExecutionService {
  return {
    executeStage: vi.fn(async () => {}),
    pauseStage: vi.fn(async () => {}),
    resumeStage: vi.fn(async () => {}),
    cancelStage: vi.fn(async () => {}),
  } as unknown as StageExecutionService;
}

function createMockSessionAllocator(): SessionAllocator {
  return {
    allocateSession: vi.fn(async () => ({
      id: 'ses-1',
      name: 'Mock',
      status: 'running' as const,
      conversationId: 'conv-1',
      tags: [],
      requiresCodebase: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    releaseSession: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  } as unknown as SessionAllocator;
}

describe('WorkflowRunService', () => {
  let service: WorkflowRunService;
  let runRepo: MockWorkflowRunRepository;
  let stageRunRepo: MockStageRunRepository;
  let store: MockWorkflowDefinitionStore;
  let definitions: RunDefinitionReader;
  let definitionService: WorkflowDefinitionService;
  let eventBus: EventBus;
  let dagScheduler: DAGScheduler;
  let stageExec: ReturnType<typeof createMockStageExecutionService>;
  let sessionAllocator: ReturnType<typeof createMockSessionAllocator>;

  const DEF_ID = 'def-1';

  /** Seed another published definition; returns its id. */
  async function seed(id: string, stages: SeedStage[], edges: SeedEdge[] = []): Promise<string> {
    await seedDefinition(store, testGraph(stages, edges), id);
    return id;
  }

  function makeService(dag: DAGScheduler): WorkflowRunService {
    return new WorkflowRunService(
      runRepo,
      stageRunRepo,
      definitions,
      definitionService,
      eventBus,
      dag,
      stageExec,
      sessionAllocator,
      createFakeWorkspaceManager(),
      new AdmissionController(),
    );
  }

  beforeEach(async () => {
    stageRunRepo = new MockStageRunRepository();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    store = new MockWorkflowDefinitionStore();
    definitions = new RunDefinitionReader(store);
    definitionService = new WorkflowDefinitionService(store, {} as TemplateRegistry);
    eventBus = new EventBus();
    dagScheduler = new DAGScheduler(definitions, stageRunRepo, runRepo);
    stageExec = createMockStageExecutionService();
    sessionAllocator = createMockSessionAllocator();

    service = makeService(dagScheduler);

    // A definition with 2 stages (a → b)
    await seed(DEF_ID, ['a', 'b'], [['a', 'b']]);
  });

  // ── createRun ──

  describe('createRun', () => {
    it('should create a workflow run in "created" state', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      expect(run.status).toBe('created');
      expect(run.workflowDefinitionId).toBe(DEF_ID);
    });

    it('should create stage run records for each stage', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      expect(stageRuns.length).toBe(2);
      expect(stageRuns.every((sr) => sr.status === 'pending')).toBe(true);
    });

    it('should pass through variables', async () => {
      const run = await service.createRun({
        workflowDefinitionId: DEF_ID,
        variables: { key: 'value' },
      });
      expect(run.variables).toEqual({ key: 'value' });
    });
  });

  // ── startRun ──

  describe('startRun', () => {
    it('should transition run to running status', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await service.startRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('running');
      expect(updated.startedAt).toBeDefined();
    });

    it('should execute root stages', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await service.startRun(run.id);

      // Give async executeStage a tick to be called
      await new Promise((r) => setTimeout(r, 10));

      expect(stageExec.executeStage).toHaveBeenCalled();
      // a is the root stage, so it should be executed
      const callArgs = (stageExec.executeStage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs?.[0]).toBeDefined();
    });

    // ── FEAT-1: adaptive `auto` session mode resolution ──
    it('resolves auto → single for a linear DAG', async () => {
      const AUTO_LINEAR = await seed('def-auto-linear', ['a', 'b'], [['a', 'b']]);

      const run = await service.createRun({ workflowDefinitionId: AUTO_LINEAR });
      expect(run.sessionMode).toBe('auto');
      await service.startRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.sessionMode).toBe('single');
    });

    it('resolves auto → per-stage for a DAG with parallelism', async () => {
      // a → b and a → c : b and c land in the same parallel layer.
      const AUTO_PARALLEL = await seed('def-auto-parallel', ['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]);

      const run = await service.createRun({ workflowDefinitionId: AUTO_PARALLEL });
      await service.startRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.sessionMode).toBe('per-stage');
    });
  });

  // ── redriveRun (DUR-06 crash recovery) ──

  describe('redriveRun (crash recovery re-drive)', () => {
    it('re-launches ready pending stages of an interrupted running run', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      // Simulate a crash mid-run: run is 'running', stage A completed, B pending.
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const a = stageRuns.find((s) => s.stageKey === 'a')!;
      await stageRunRepo.update(a.id, { status: 'completed', completedAt: new Date() });

      await service.redriveRun(run.id);
      await new Promise((r) => setTimeout(r, 10));

      // Stage B (successor of completed A) should be re-launched.
      expect(stageExec.executeStage).toHaveBeenCalled();
      const launchedIds = (stageExec.executeStage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as StageRun).stageKey,
      );
      expect(launchedIds).toContain('b');

      service.shutdown(); // clear polling interval
    });

    it('finalizes a run whose DAG was already complete at crash time', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      for (const sr of stageRuns) {
        await stageRunRepo.update(sr.id, { status: 'completed', completedAt: new Date() });
      }

      await service.redriveRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('completed');
      service.shutdown();
    });

    it('does not re-launch already-completed stages (pre-seeds de-dup)', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      for (const sr of stageRuns) {
        await stageRunRepo.update(sr.id, { status: 'completed', completedAt: new Date() });
      }

      await service.redriveRun(run.id);
      await new Promise((r) => setTimeout(r, 10));

      expect(stageExec.executeStage).not.toHaveBeenCalled();
      service.shutdown();
    });

    it('no-ops on a non-running run', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID }); // 'created'
      await service.redriveRun(run.id);
      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('created');
      expect(stageExec.executeStage).not.toHaveBeenCalled();
    });
  });

  // ── claimForExecution (DUR-06 launch dedup) ──

  describe('claimForExecution (launch-side de-dup)', () => {
    it('only the first claim of a pending stage wins', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const a = stageRuns[0]!;
      const first = await stageRunRepo.claimForExecution(a.id);
      const second = await stageRunRepo.claimForExecution(a.id);
      expect(first).toBe(true);
      expect(second).toBe(false);
      const after = await stageRunRepo.getById(a.id);
      expect(after.status).toBe('queued');
    });
  });

  // ── pauseRun ──

  describe('pauseRun', () => {
    it('should pause a running workflow and cascade to stages', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      // Manually set to running
      await runRepo.updateStatus(run.id, 'running');
      // Create a running stage
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      if (stageRuns[0]) {
        await stageRunRepo.updateStatus(stageRuns[0].id, 'running');
      }

      await service.pauseRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('paused');
      expect(stageExec.pauseStage).toHaveBeenCalled();
    });

    it('should no-op if run is not running', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      // run is in 'created' state
      await service.pauseRun(run.id);
      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('created');
    });
  });

  // ── resumeRun ──

  describe('resumeRun', () => {
    it('should resume a paused workflow', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'paused');

      // Create paused stage runs
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      if (stageRuns[0]) {
        await stageRunRepo.updateStatus(stageRuns[0].id, 'paused');
      }

      await service.resumeRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('running');
    });

    it('should no-op if run is not paused', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      await service.resumeRun(run.id);
      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('running');
    });
  });

  // ── cancelRun ──

  describe('cancelRun', () => {
    it('should cancel a running workflow and all active stages', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      await service.cancelRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('cancelled');
      expect(updated.completedAt).toBeDefined();
    });

    it('should cascade cancel to pending/running/queued stages', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      await service.cancelRun(run.id);

      // cancelStage should be called for each non-terminal stage
      expect(stageExec.cancelStage).toHaveBeenCalled();
    });

    it('should release all sessions', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');
      await service.cancelRun(run.id);
      expect(sessionAllocator.releaseAll).toHaveBeenCalledWith(run.id);
    });
  });

  // ── deleteRun ──

  describe('deleteRun', () => {
    it('should delete a completed run and its stage runs', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'completed');

      await service.deleteRun(run.id);

      await expect(runRepo.getById(run.id)).rejects.toThrow();
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      expect(stageRuns.length).toBe(0);
    });

    it('should cancel before deleting a running run', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      await service.deleteRun(run.id);

      expect(sessionAllocator.releaseAll).toHaveBeenCalled();
      await expect(runRepo.getById(run.id)).rejects.toThrow();
    });
  });

  // ── onStageCompleted ──

  describe('onStageCompleted', () => {
    it('should schedule next stages when predecessors complete', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      const srB = stageRuns.find((sr) => sr.stageKey === 'b')!;

      // Mark A as completed
      await stageRunRepo.update(srA.id, { status: 'completed' });

      await service.onStageCompleted(run.id, srA.id);

      // Give the fire-and-forget promise a tick
      await new Promise((r) => setTimeout(r, 10));

      // Stage B should now be executed
      expect(stageExec.executeStage).toHaveBeenCalled();
    });

    it('should complete the run when DAG is fully done', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      for (const sr of stageRuns) {
        await stageRunRepo.update(sr.id, { status: 'completed' });
      }

      const srB = stageRuns.find((sr) => sr.stageKey === 'b')!;
      await service.onStageCompleted(run.id, srB.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
    });
  });

  // ── onStageFailed ──

  describe('onStageFailed', () => {
    it('should mark the run as failed when DAG is complete with failures', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      const srB = stageRuns.find((sr) => sr.stageKey === 'b')!;

      // Both stages done, but one failed
      await stageRunRepo.update(srA.id, { status: 'failed', error: 'boom' });
      await stageRunRepo.update(srB.id, { status: 'skipped' });

      await service.onStageFailed(run.id, srA.id, new Error('boom'));

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('failed');
    });

    it('should not fail the run while an independent stage is still in progress', async () => {
      // Add an independent third stage C (no edges) so the DAG is genuinely
      // incomplete after A fails. NOTE: with A → B (on_success), failing A
      // makes B *unreachable*, so B is correctly skipped and would otherwise
      // complete the DAG — see the "marked failed" test above. C, having no
      // dependency on A, stays in progress and keeps the run running.
      const DEF_C = await seed('def-with-c', ['a', 'b', 'c'], [['a', 'b']]);

      const run = await service.createRun({ workflowDefinitionId: DEF_C });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      const srC = stageRuns.find((sr) => sr.stageKey === 'c')!;

      await stageRunRepo.update(srA.id, { status: 'failed', error: 'fail' });
      await stageRunRepo.update(srC.id, { status: 'running' }); // still in progress

      await service.onStageFailed(run.id, srA.id, new Error('fail'));

      const updated = await runRepo.getById(run.id);
      // Run should still be running since C is not terminal (DAG incomplete).
      expect(updated.status).toBe('running');
    });

    it('completes the run when a failure is handled by an on_failure recovery (EXEC-5)', async () => {
      // A → B (on_success) and A → R (on_failure). A fails: B is unreachable
      // (skipped), R is the recovery branch and completes. The run should end
      // COMPLETED (the failure was handled), not failed.
      const DEF_R = await seed('def-with-r', ['a', 'b', 'r'], [['a', 'b'], ['a', 'r', 'failure']]);

      const run = await service.createRun({ workflowDefinitionId: DEF_R });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      const srB = stageRuns.find((sr) => sr.stageKey === 'b')!;
      const srR = stageRuns.find((sr) => sr.stageKey === 'r')!;

      await stageRunRepo.update(srA.id, { status: 'failed', error: 'boom' });
      await stageRunRepo.update(srB.id, { status: 'skipped' });
      await stageRunRepo.update(srR.id, { status: 'completed' });

      await service.onStageFailed(run.id, srA.id, new Error('boom'));

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('completed');
    });
  });

  // ── Result validation gating ──

  describe('result validation only applies to stages that actually ran', () => {
    /**
     * A stage skipped by a run-time override routes through `onStageCompleted`
     * to advance the DAG. Validating it there evaluated the stage's rules
     * against an empty output: they failed, the failure triggered a retry, and
     * the retry EXECUTED the stage the operator had explicitly asked to skip —
     * which then failed the whole run.
     */
    it('does not validate a stage whose status is skipped', async () => {
      const validateStageResult = vi.fn(async () => ({ passed: true, failures: [] as string[] }));
      service.setResultValidator({ validateStageResult } as never);

      const DEF_RULES = await seed('def-rules', [
        { key: 'a', output: { rules: [{ type: 'contains', value: 'MARKER', message: 'needs MARKER' }] } },
        'b',
      ], [['a', 'b']]);

      const run = await service.createRun({ workflowDefinitionId: DEF_RULES });
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      await stageRunRepo.update(srA.id, { status: 'skipped' });

      await service.onStageCompleted(run.id, srA.id);

      expect(validateStageResult).not.toHaveBeenCalled();
      const after = await stageRunRepo.getById(srA.id);
      expect(after.status).toBe('skipped');
      expect(after.retryCount).toBe(0);
    });

    it('still validates a stage that completed normally', async () => {
      const validateStageResult = vi.fn(async () => ({ passed: true, failures: [] as string[] }));
      service.setResultValidator({ validateStageResult } as never);

      const DEF_RULES = await seed('def-rules', [
        { key: 'a', output: { rules: [{ type: 'contains', value: 'MARKER', message: 'needs MARKER' }] } },
        'b',
      ], [['a', 'b']]);

      const run = await service.createRun({ workflowDefinitionId: DEF_RULES });
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      await stageRunRepo.update(srA.id, { status: 'completed' });

      await service.onStageCompleted(run.id, srA.id);

      expect(validateStageResult).toHaveBeenCalledTimes(1);
    });
  });

  // ── WS-D1: stale-heartbeat reaper ──

  describe('stale-heartbeat reaper', () => {
    it('fails a running stage via the reconciler once its heartbeat goes stale', async () => {
      // A generous 3s stale window (still far shorter than the 60s-old beat
      // below) so the "fresh" counterpart test isn't flaky against normal
      // test-runner scheduling overhead between setting the timestamp and
      // the reconciler's first tick.
      service.setHeartbeatPolicy({ heartbeatIntervalMs: 1_000, staleMultiplier: 3, reconcileIntervalMs: 15 });

      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      // A "running" stage whose last beat is far older than the 3s stale
      // window (heartbeatIntervalMs 1000 * staleMultiplier 3).
      await stageRunRepo.update(srA.id, {
        status: 'running',
        heartbeatAt: new Date(Date.now() - 60_000),
      });

      // redriveRun registers the run with the process-wide reconciler; the
      // reconciler itself ticks on a real setInterval, so wait past a few
      // real ticks for it to observe the stale beat.
      await service.redriveRun(run.id);
      await new Promise((r) => setTimeout(r, 100));

      const after = await stageRunRepo.getById(srA.id);
      expect(after.status).toBe('failed');
      expect(after.error).toContain('heartbeat stale');

      service.shutdown();
    });

    it('leaves a fresh (non-stale) running stage alone', async () => {
      service.setHeartbeatPolicy({ heartbeatIntervalMs: 1_000, staleMultiplier: 3, reconcileIntervalMs: 15 });

      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      await stageRunRepo.update(srA.id, { status: 'running', heartbeatAt: new Date() });

      await service.redriveRun(run.id);
      await new Promise((r) => setTimeout(r, 100));

      const after = await stageRunRepo.getById(srA.id);
      expect(after.status).toBe('running');

      service.shutdown();
    });
  });

  // ── WS-D1: operator skip overrides honoured on failure branches ──

  describe('operator skip overrides on failure branches', () => {
    it('honours a run-time skip override for a stage reached via on_failure', async () => {
      const RECOVERY_DEF = await seed('def-recovery-skip', ['a', 'recover'], [['a', 'recover', 'failure']]);

      const run = await service.createRun({
        workflowDefinitionId: RECOVERY_DEF,
        variables: { __stageOverrides: [{ stageKey: 'recover', skip: true }] },
      });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      await stageRunRepo.update(srA.id, { status: 'failed', error: 'boom' });

      await service.onStageFailed(run.id, srA.id, new Error('boom'));
      await new Promise((r) => setTimeout(r, 10));

      const srRecover = (await stageRunRepo.getByRunId(run.id)).find(
        (sr) => sr.stageKey === 'recover',
      )!;
      expect(srRecover.status).toBe('skipped');
      expect(srRecover.error).toContain('run-time stage override');

      // The override must have PREVENTED the launch outright, not merely
      // raced one that already fired.
      const launchedIds = (stageExec.executeStage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as StageRun).stageKey,
      );
      expect(launchedIds).not.toContain('recover');
    });
  });

  // ── W23/X-24: retryRun gets a fresh workspace + inherits predecessor outputs ──

  describe('retryRun', () => {
    it('preserves deliberate skips when retrying a different failed stage', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      const stages = await stageRunRepo.getByRunId(run.id);
      await stageRunRepo.update(stages.find((s) => s.stageKey === 'a')!.id, {
        status: 'skipped', error: 'Skipped by runtime override',
      });
      await stageRunRepo.update(stages.find((s) => s.stageKey === 'b')!.id, { status: 'failed' });
      await runRepo.updateStatus(run.id, 'failed');
      const retried = await service.retryRun(run.id);
      const fresh = await stageRunRepo.getByRunId(retried.id);
      expect(fresh.find((s) => s.stageKey === 'a')!.status).toBe('skipped');
    });

    it('re-evaluates successors skipped because a failed predecessor made them unreachable', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      const stages = await stageRunRepo.getByRunId(run.id);
      await stageRunRepo.update(stages.find((s) => s.stageKey === 'a')!.id, { status: 'failed' });
      await stageRunRepo.update(stages.find((s) => s.stageKey === 'b')!.id, {
        status: 'skipped', error: 'Skipped — no incoming edge or run condition was satisfied',
      });
      await runRepo.updateStatus(run.id, 'failed');
      const retried = await service.retryRun(run.id);
      const fresh = await stageRunRepo.getByRunId(retried.id);
      expect(fresh.map((s) => s.status)).toEqual(['pending', 'pending']);
      await service.startRun(retried.id);
      const predecessor = fresh.find((s) => s.stageKey === 'a')!;
      await stageRunRepo.update(predecessor.id, { status: 'completed' });
      await service.onStageCompleted(retried.id, predecessor.id);
      expect(vi.mocked(stageExec.executeStage).mock.calls.some((c) => c[0].stageKey === 'b')).toBe(true);
    });

    it('gives the retry a fresh working directory and inherits predecessor outputs', async () => {
      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      // Simulate the ancestor having actually executed: dirty execution
      // context on the run, plus a completed stage A with real output.
      await runRepo.update(run.id, {
        variables: {
          ...run.variables,
          __workingDirectory: '/ancestor/dirty/workspace',
          __artifactsDirectory: '/ancestor/dirty/artifacts',
          __workspaceId: 'ws-ancestor',
          topic: 'keep-me',
        },
      });
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      const srB = stageRuns.find((sr) => sr.stageKey === 'b')!;
      await stageRunRepo.update(srA.id, {
        status: 'completed',
        summary: 'A summary',
        outputText: 'A output text',
        outputData: { key: 'value' },
        completedAt: new Date(),
      });
      await stageRunRepo.update(srB.id, { status: 'failed', error: 'boom', completedAt: new Date() });
      await runRepo.updateStatus(run.id, 'failed');

      const retried = await service.retryRun(run.id);

      // Fresh workspace: the dirty ancestor directories must NOT carry over
      // (startRun's workspace-creation branch triggers only when absent).
      expect(retried.variables?.['__workingDirectory']).toBeUndefined();
      expect(retried.variables?.['__artifactsDirectory']).toBeUndefined();
      expect(retried.variables?.['__workspaceId']).toBeUndefined();
      // Ordinary variables DO carry over.
      expect(retried.variables?.['topic']).toBe('keep-me');
      expect(retried.ancestorRunId).toBe(run.id);

      // Predecessor OUTPUTS, not just status, are inherited.
      const newStageRuns = await stageRunRepo.getByRunId(retried.id);
      const newA = newStageRuns.find((sr) => sr.stageKey === 'a')!;
      const newB = newStageRuns.find((sr) => sr.stageKey === 'b')!;
      expect(newA.status).toBe('completed');
      expect(newA.summary).toBe('A summary');
      expect(newA.outputText).toBe('A output text');
      expect(newA.outputData).toEqual({ key: 'value' });
      // The stage that actually failed starts fresh, not copied.
      expect(newB.status).toBe('pending');
    });
  });

  // ── WS-D1: definition snapshot pins an in-flight run's DAG ──

  describe('definition version pinning', () => {
    it('does not let a mid-run definition edit change the running DAG', async () => {
      const pinnedService = makeService(new DAGScheduler(definitions, stageRunRepo, runRepo));

      const run = await pinnedService.createRun({ workflowDefinitionId: DEF_ID });
      await pinnedService.startRun(run.id);
      await new Promise((r) => setTimeout(r, 10));

      // Edit and publish the definition WHILE the run is in flight: wire a
      // brand-new successor stage c after b.
      const record = await definitionService.get(DEF_ID);
      await definitionService.saveGraph(DEF_ID, testGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]), record.revision, { canEditCommands: false });
      await definitionService.publish(DEF_ID);
      expect((await definitionService.get(DEF_ID)).currentVersionId).not.toBe(run.definitionVersionId);

      // Complete the run's two ORIGINAL stages.
      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageKey === 'a')!;
      const srB = stageRuns.find((sr) => sr.stageKey === 'b')!;
      await stageRunRepo.update(srA.id, { status: 'completed' });
      await pinnedService.onStageCompleted(run.id, srA.id);
      await new Promise((r) => setTimeout(r, 10));
      await stageRunRepo.update(srB.id, { status: 'completed' });
      await pinnedService.onStageCompleted(run.id, srB.id);
      await new Promise((r) => setTimeout(r, 10));

      // The run must finish WITHOUT ever launching the newly-added c —
      // proving the DAG it executed against was frozen at start time.
      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('completed');
      const launchedIds = (stageExec.executeStage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as StageRun).stageKey,
      );
      expect(launchedIds).not.toContain('c');

      pinnedService.shutdown();
    });
  });
});
