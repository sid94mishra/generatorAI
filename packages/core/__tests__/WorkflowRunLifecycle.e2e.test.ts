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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type { StageDefinition, StageEdge, StageRun, WorkflowRun } from '@generatorai/shared';

const DEF_ID = 'def-e2e';

type Outcome = 'completed' | 'failed';

function makeStageDef(id: string, order: number): StageDefinition {
  return {
    id,
    workflowDefinitionId: DEF_ID,
    name: id,
    order,
    prompts: [{ label: 'P', text: 'go', waitForCompletion: true }],
    variables: {},
    hooks: [],
    createdAt: new Date(),
  };
}

function makeEdge(from: string, to: string, edgeType: StageEdge['edgeType']): StageEdge {
  return { id: `e-${from}-${to}`, workflowDefinitionId: DEF_ID, fromStageId: from, toStageId: to, edgeType };
}

describe('E2E: Workflow run lifecycle (event-driven)', () => {
  let service: WorkflowRunService;
  let runRepo: MockWorkflowRunRepository;
  let stageRunRepo: MockStageRunRepository;
  let stageDefRepo: MockStageDefinitionRepository;
  let defRepo: MockWorkflowDefinitionRepository;
  let edgeRepo: MockStageEdgeRepository;
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
      const outcome: Outcome = plan.get(stageRun.stageDefinitionId) ?? 'completed';
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

  async function seed(stages: StageDefinition[], edges: StageEdge[]): Promise<void> {
    await defRepo.create({
      id: DEF_ID,
      name: 'E2E WF',
      version: 1,
      sessionMode: 'per-stage',
      variables: [],
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const s of stages) await stageDefRepo.create(s);
    for (const e of edges) await edgeRepo.create(e);
  }

  async function runToTerminal(plan: Map<string, Outcome>): Promise<WorkflowRun> {
    const stageExec = makeDrivingExecutor(plan);
    service = new WorkflowRunService(
      runRepo, stageRunRepo, stageDefRepo, defRepo, eventBus, dagScheduler,
      stageExec, noopAllocator, join(tmpdir(), `genai-e2e-${Date.now()}`),
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
    runRepo = new MockWorkflowRunRepository();
    stageRunRepo = new MockStageRunRepository();
    stageDefRepo = new MockStageDefinitionRepository();
    defRepo = new MockWorkflowDefinitionRepository();
    edgeRepo = new MockStageEdgeRepository();
    eventBus = new EventBus();
    dagScheduler = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo);
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
    await seed(
      [makeStageDef('A', 0), makeStageDef('B', 1)],
      [makeEdge('A', 'B', 'on_success')],
    );
    const run = await runToTerminal(new Map());
    expect(run.status).toBe('completed');

    const stageRuns = await stageRunRepo.getByRunId(run.id);
    expect(stageRuns.every((sr) => sr.status === 'completed')).toBe(true);
  });

  it('unhandled failure (on_success successor) → run failed; successor skipped', async () => {
    await seed(
      [makeStageDef('A', 0), makeStageDef('B', 1)],
      [makeEdge('A', 'B', 'on_success')],
    );
    const run = await runToTerminal(new Map([['A', 'failed']]));
    expect(run.status).toBe('failed');

    const stageRuns = await stageRunRepo.getByRunId(run.id);
    expect(stageRuns.find((s) => s.stageDefinitionId === 'A')!.status).toBe('failed');
    expect(stageRuns.find((s) => s.stageDefinitionId === 'B')!.status).toBe('skipped');
  });

  it('F1 recovery diamond: failure handled by on_failure branch → run COMPLETED (EXEC-5/6)', async () => {
    // Setup → Fail (on_success); Fail → Recovery (on_failure); Fail → SkipBranch (on_success);
    // Recovery → Final (on_completion); SkipBranch → Final (on_completion).
    await seed(
      [
        makeStageDef('Setup', 0),
        makeStageDef('Fail', 1),
        makeStageDef('Recovery', 2),
        makeStageDef('SkipBranch', 2),
        makeStageDef('Final', 3),
      ],
      [
        makeEdge('Setup', 'Fail', 'on_success'),
        makeEdge('Fail', 'Recovery', 'on_failure'),
        makeEdge('Fail', 'SkipBranch', 'on_success'),
        makeEdge('Recovery', 'Final', 'on_completion'),
        makeEdge('SkipBranch', 'Final', 'on_completion'),
      ],
    );

    const run = await runToTerminal(new Map([['Fail', 'failed']]));
    expect(run.status).toBe('completed'); // failure recovered

    const stageRuns = await stageRunRepo.getByRunId(run.id);
    const byDef = (d: string) => stageRuns.find((s) => s.stageDefinitionId === d)!.status;
    expect(byDef('Setup')).toBe('completed');
    expect(byDef('Fail')).toBe('failed');
    expect(byDef('Recovery')).toBe('completed');
    expect(byDef('SkipBranch')).toBe('skipped'); // on_success edge from a failed stage → unreachable
    expect(byDef('Final')).toBe('completed'); // reached via on_completion from Recovery
  });
});
