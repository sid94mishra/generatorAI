// ────────────────────────────────────────────────────────────────
// WorkflowRunService Tests  (P3.17)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import {
  MockWorkflowRunRepository,
  MockStageRunRepository,
  MockStageDefinitionRepository,
  MockStageEdgeRepository,
  MockWorkflowDefinitionRepository,
} from './MockRepositories.js';
import { EventBus } from '../src/events/EventBus.js';
import { DAGScheduler } from '../src/services/DAGScheduler.js';
import type { StageExecutionService } from '../src/services/StageExecutionService.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { StageDefinition, StageRun, WorkflowRun } from '@generatorai/shared';

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

function makeStageDef(id: string, defId: string, order: number): StageDefinition {
  return {
    id,
    workflowDefinitionId: defId,
    name: `Stage ${id}`,
    order,
    prompts: [{ label: 'P', text: 'go', waitForCompletion: true }],
    variables: {},
    hooks: [],
    createdAt: new Date(),
  };
}

describe('WorkflowRunService', () => {
  let service: WorkflowRunService;
  let runRepo: MockWorkflowRunRepository;
  let stageRunRepo: MockStageRunRepository;
  let stageDefRepo: MockStageDefinitionRepository;
  let defRepo: MockWorkflowDefinitionRepository;
  let edgeRepo: MockStageEdgeRepository;
  let eventBus: EventBus;
  let dagScheduler: DAGScheduler;
  let stageExec: ReturnType<typeof createMockStageExecutionService>;
  let sessionAllocator: ReturnType<typeof createMockSessionAllocator>;

  const DEF_ID = 'def-1';

  beforeEach(async () => {
    runRepo = new MockWorkflowRunRepository();
    stageRunRepo = new MockStageRunRepository();
    stageDefRepo = new MockStageDefinitionRepository();
    defRepo = new MockWorkflowDefinitionRepository();
    edgeRepo = new MockStageEdgeRepository();
    eventBus = new EventBus();
    dagScheduler = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo);
    stageExec = createMockStageExecutionService();
    sessionAllocator = createMockSessionAllocator();

    service = new WorkflowRunService(
      runRepo,
      stageRunRepo,
      stageDefRepo,
      defRepo,
      eventBus,
      dagScheduler,
      stageExec,
      sessionAllocator,
    );

    // Seed a definition with 2 stages (A → B)
    await defRepo.create({
      id: DEF_ID,
      name: 'Test WF',
      version: 1,
      sessionMode: 'per-stage',
      variables: [],
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await stageDefRepo.create(makeStageDef('s-a', DEF_ID, 0));
    await stageDefRepo.create(makeStageDef('s-b', DEF_ID, 1));
    await edgeRepo.create({
      id: 'edge-1',
      workflowDefinitionId: DEF_ID,
      fromStageId: 's-a',
      toStageId: 's-b',
      edgeType: 'on_success',
    });
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
      // s-a is the root stage, so it should be executed
      const callArgs = (stageExec.executeStage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs?.[0]).toBeDefined();
    });

    // ── FEAT-1: adaptive `auto` session mode resolution ──
    it('resolves auto → single for a linear DAG', async () => {
      const AUTO_LINEAR = 'def-auto-linear';
      await defRepo.create({
        id: AUTO_LINEAR, name: 'Auto Linear', version: 1, sessionMode: 'auto',
        variables: [], tags: [], createdAt: new Date(), updatedAt: new Date(),
      });
      await stageDefRepo.create(makeStageDef('al-a', AUTO_LINEAR, 0));
      await stageDefRepo.create(makeStageDef('al-b', AUTO_LINEAR, 1));
      await edgeRepo.create({
        id: 'al-edge-1', workflowDefinitionId: AUTO_LINEAR,
        fromStageId: 'al-a', toStageId: 'al-b', edgeType: 'on_success',
      });

      const run = await service.createRun({ workflowDefinitionId: AUTO_LINEAR });
      expect(run.sessionMode).toBe('auto');
      await service.startRun(run.id);

      const updated = await runRepo.getById(run.id);
      expect(updated.sessionMode).toBe('single');
    });

    it('resolves auto → per-stage for a DAG with parallelism', async () => {
      const AUTO_PARALLEL = 'def-auto-parallel';
      await defRepo.create({
        id: AUTO_PARALLEL, name: 'Auto Parallel', version: 1, sessionMode: 'auto',
        variables: [], tags: [], createdAt: new Date(), updatedAt: new Date(),
      });
      // A → B and A → C : B and C land in the same parallel layer.
      await stageDefRepo.create(makeStageDef('ap-a', AUTO_PARALLEL, 0));
      await stageDefRepo.create(makeStageDef('ap-b', AUTO_PARALLEL, 1));
      await stageDefRepo.create(makeStageDef('ap-c', AUTO_PARALLEL, 2));
      await edgeRepo.create({
        id: 'ap-edge-1', workflowDefinitionId: AUTO_PARALLEL,
        fromStageId: 'ap-a', toStageId: 'ap-b', edgeType: 'on_success',
      });
      await edgeRepo.create({
        id: 'ap-edge-2', workflowDefinitionId: AUTO_PARALLEL,
        fromStageId: 'ap-a', toStageId: 'ap-c', edgeType: 'on_success',
      });

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
      const a = stageRuns.find((s) => s.stageDefinitionId === 's-a')!;
      await stageRunRepo.update(a.id, { status: 'completed', completedAt: new Date() });

      await service.redriveRun(run.id);
      await new Promise((r) => setTimeout(r, 10));

      // Stage B (successor of completed A) should be re-launched.
      expect(stageExec.executeStage).toHaveBeenCalled();
      const launchedIds = (stageExec.executeStage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as StageRun).stageDefinitionId,
      );
      expect(launchedIds).toContain('s-b');

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
      const srA = stageRuns.find((sr) => sr.stageDefinitionId === 's-a')!;
      const srB = stageRuns.find((sr) => sr.stageDefinitionId === 's-b')!;

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

      const srB = stageRuns.find((sr) => sr.stageDefinitionId === 's-b')!;
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
      const srA = stageRuns.find((sr) => sr.stageDefinitionId === 's-a')!;
      const srB = stageRuns.find((sr) => sr.stageDefinitionId === 's-b')!;

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
      await stageDefRepo.create(makeStageDef('s-c', DEF_ID, 2));

      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageDefinitionId === 's-a')!;
      const srC = stageRuns.find((sr) => sr.stageDefinitionId === 's-c')!;

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
      await stageDefRepo.create(makeStageDef('s-r', DEF_ID, 2));
      await edgeRepo.create({
        id: 'edge-r',
        workflowDefinitionId: DEF_ID,
        fromStageId: 's-a',
        toStageId: 's-r',
        edgeType: 'on_failure',
      });

      const run = await service.createRun({ workflowDefinitionId: DEF_ID });
      await runRepo.updateStatus(run.id, 'running');

      const stageRuns = await stageRunRepo.getByRunId(run.id);
      const srA = stageRuns.find((sr) => sr.stageDefinitionId === 's-a')!;
      const srB = stageRuns.find((sr) => sr.stageDefinitionId === 's-b')!;
      const srR = stageRuns.find((sr) => sr.stageDefinitionId === 's-r')!;

      await stageRunRepo.update(srA.id, { status: 'failed', error: 'boom' });
      await stageRunRepo.update(srB.id, { status: 'skipped' });
      await stageRunRepo.update(srR.id, { status: 'completed' });

      await service.onStageFailed(run.id, srA.id, new Error('boom'));

      const updated = await runRepo.getById(run.id);
      expect(updated.status).toBe('completed');
    });
  });
});
