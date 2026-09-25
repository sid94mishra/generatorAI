// ────────────────────────────────────────────────────────────────
// E2E (engine-level): full workflow run lifecycle driven by real
// stage_run.* events — the exact behavior the Web UI and CLI rely on
// (both consume the same WorkflowRunService via the REST API).
//
// Uses a real WorkflowRunService + DAGScheduler + EventBus with mock
// repositories and a *controllable* StageExecutionService that, when a
// stage is dispatched, asynchronously transitions it to its planned
// outcome and emits the corresponding stage_run.completed / .failed
// event — just like the real service. Nothing here manually calls
// onStageCompleted/onStageFailed, so this genuinely exercises the
// event-driven DAG routing (EXEC-2), failure-recovery completion
// semantics (EXEC-5), and skip routing of unreachable branches (EXEC-6).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import {
  MockWorkflowRunRepository,
  MockStageRunRepository,
  MockWorkflowDefinitionStore,
  createFakeWorkspaceManager,
  seedDefinition,
  testGraph,
  type SeedEdge,
} from './MockRepositories.js';
import { EventBus } from '../src/events/EventBus.js';
import { AdmissionController } from '../src/services/AdmissionController.js';
import { DAGScheduler } from '../src/services/DAGScheduler.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';
import type { StageExecutionService } from '../src/services/StageExecutionService.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { StageRun, WorkflowRun } from '@generatorai/shared';

const DEF_ID = 'def-e2e';

type Outcome = 'completed' | 'failed';

describe('E2E: Workflow run lifecycle (event-driven)', () => {
  let service: WorkflowRunService;
  let runRepo: MockWorkflowRunRepository;
  let stageRunRepo: MockStageRunRepository;
  let store: MockWorkflowDefinitionStore;
  let definitions: RunDefinitionReader;
  let eventBus: EventBus;
  let dagScheduler: DAGScheduler;
  let createdRunId: string | undefined;

  /**
   * Build a StageExecutionService stub that drives the DAG: when a stage is
   * dispatched it asynchronously (deferred, to mimic real execution and keep
   * event ordering deterministic) transitions the stage to its planned
   * outcome and emits the matching stage_run.* event.
   */
  function makeDrivingExecutor(plan: Map<string, Outcome>): StageExecutionService {
    const run = async (stageRun: StageRun, runId: string): Promise<void> => {
      await new Promise((r) => setTimeout(r, 5)); // defer so the dispatching handler settles first
      const outcome: Outcome = plan.get(stageRun.stageKey) ?? 'completed';
      if (outcome === 'completed') {
        await stageRunRepo.update(stageRun.id, {
          status: 'completed',
          summary: `${stageRun.name} ok`,
          completedAt: new Date(),
        });
        await eventBus.emitGlobal({
          kind: 'stage_run.completed',
          data: { stageRunId: stageRun.id, workflowRunId: runId, name: stageRun.name },
        });
      } else {
        await stageRunRepo.update(stageRun.id, {
          status: 'failed',
          error: 'planned failure',
          completedAt: new Date(),
        });
        await eventBus.emitGlobal({
          kind: 'stage_run.failed',
          data: { stageRunId: stageRun.id, workflowRunId: runId, error: 'planned failure', name: stageRun.name },
        });
      }
    };
    return {
      executeStage: run,
      retryInSession: run,
      pauseStage: async () => {},
      resumeStage: async () => {},
      cancelStage: async () => {},
    } as unknown as StageExecutionService;
  }

  const noopAllocator = {
    allocateSession: async () => ({ id: 's', name: 's', status: 'active', conversationId: 'c', tags: [], createdAt: new Date(), updatedAt: new Date() }),
    releaseSession: async () => {},
    releaseAll: async () => {},
  } as unknown as SessionAllocator;

  async function seed(stages: string[], edges: SeedEdge[]): Promise<void> {
    await seedDefinition(store, testGraph(stages, edges), DEF_ID);
  }

  async function runToTerminal(plan: Map<string, Outcome>): Promise<WorkflowRun> {
    const stageExec = makeDrivingExecutor(plan);
    service = new WorkflowRunService(
      runRepo,
      stageRunRepo,
      definitions,
      new WorkflowDefinitionService(store, {} as TemplateRegistry),
      eventBus,
      dagScheduler,
      stageExec,
      noopAllocator,
      createFakeWorkspaceManager(),
      new AdmissionController(),
    );
    const run = await service.createRun({ workflowDefinitionId: DEF_ID });
    createdRunId = run.id;
    await service.startRun(run.id);

    // Wait for the event-driven cascade to reach a terminal state.
    const deadline = Date.now() + 4000;
    let current = await runRepo.getById(run.id);
    while (current.status !== 'completed' && current.status !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      current = await runRepo.getById(run.id);
    }
    return current;
  }

  beforeEach(() => {
    stageRunRepo = new MockStageRunRepository();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    store = new MockWorkflowDefinitionStore();
    definitions = new RunDefinitionReader(store);
    eventBus = new EventBus();
    dagScheduler = new DAGScheduler(definitions, stageRunRepo, runRepo);
    createdRunId = undefined;
  });

  afterEach(async () => {
    // Ensure no lingering polling interval / subscription leaks between tests.
    if (createdRunId) {
      try {
        const r = await runRepo.getById(createdRunId);
        if (r.status === 'running' || r.status === 'paused') await service.cancelRun(createdRunId);
      } catch { /* already gone */ }
    }
  });

  it('linear A→B drives to completion purely via events (EXEC-2)', async () => {
    await seed(['a', 'b'], [['a', 'b']]);
    const run = await runToTerminal(new Map());
    expect(run.status).toBe('completed');

    const stageRuns = await stageRunRepo.getByRunId(run.id);
    expect(stageRuns.every((sr) => sr.status === 'completed')).toBe(true);
  });

  it('unhandled failure (on_success successor) → run failed; successor skipped', async () => {
    await seed(['a', 'b'], [['a', 'b']]);
    const run = await runToTerminal(new Map([['a', 'failed']]));
    expect(run.status).toBe('failed');

    const stageRuns = await stageRunRepo.getByRunId(run.id);
    expect(stageRuns.find((s) => s.stageKey === 'a')!.status).toBe('failed');
    expect(stageRuns.find((s) => s.stageKey === 'b')!.status).toBe('skipped');
  });

  it('F1 recovery diamond: failure handled by on_failure branch → run COMPLETED (EXEC-5/6)', async () => {
    // setup → fail (success); fail → recovery (failure); fail → skip_branch (success);
    // recovery → final (completion); skip_branch → final (completion).
    await seed(
      ['setup', 'fail', 'recovery', 'skip_branch', 'final'],
      [
        ['setup', 'fail'],
        ['fail', 'recovery', 'failure'],
        ['fail', 'skip_branch'],
        ['recovery', 'final', 'completion'],
        ['skip_branch', 'final', 'completion'],
      ],
    );

    const run = await runToTerminal(new Map([['fail', 'failed']]));
    expect(run.status).toBe('completed'); // failure recovered

    const stageRuns = await stageRunRepo.getByRunId(run.id);
    const byKey = (k: string) => stageRuns.find((s) => s.stageKey === k)!.status;
    expect(byKey('setup')).toBe('completed');
    expect(byKey('fail')).toBe('failed');
    expect(byKey('recovery')).toBe('completed');
    expect(byKey('skip_branch')).toBe('skipped'); // on_success edge from a failed stage → unreachable
    expect(byKey('final')).toBe('completed'); // reached via on_completion from Recovery
  });
});
