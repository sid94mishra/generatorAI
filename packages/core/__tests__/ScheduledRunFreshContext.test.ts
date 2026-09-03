// ────────────────────────────────────────────────────────────────
// X-21 — "fresh agent with no history for scheduled runs" (W24).
//
// `AutomationService` wrote `triggeredBy` onto the execution row and read it
// in exactly ONE place — the default-dataset fallback. It reached neither
// `createRun`, nor the workspace, nor the harness, so the requirement had no
// mechanism behind it at all.
//
// Sessions and conversations were already per-run, so the surviving leak was
// the EXECUTION CONTEXT: `startRun` skips workspace creation entirely when
// `__workingDirectory` + `__artifactsDirectory` are pre-seeded, and an
// automation whose variables carry those keys hands every nightly run the same
// directory — the same scratchpad, the same half-finished files.
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
import type { StageDefinition } from '@generatorai/shared';

const DEF_ID = 'def-1';

function makeStageDef(id: string, order: number): StageDefinition {
  return {
    id,
    workflowDefinitionId: DEF_ID,
    name: `Stage ${id}`,
    order,
    prompts: [{ label: 'P', text: 'go', waitForCompletion: true }],
    variables: {},
    hooks: [],
    createdAt: new Date(),
  };
}

describe('X-21 — a scheduled run starts from a clean execution context', () => {
  let service: WorkflowRunService;
  let runRepo: MockWorkflowRunRepository;

  beforeEach(async () => {
    runRepo = new MockWorkflowRunRepository();
    const stageRunRepo = new MockStageRunRepository();
    const stageDefRepo = new MockStageDefinitionRepository();
    const defRepo = new MockWorkflowDefinitionRepository();
    const edgeRepo = new MockStageEdgeRepository();

    service = new WorkflowRunService(
      runRepo,
      stageRunRepo,
      stageDefRepo,
      defRepo,
      new EventBus(),
      new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo),
      { executeStage: vi.fn(async () => {}) } as unknown as StageExecutionService,
      { releaseAll: vi.fn(async () => {}) } as unknown as SessionAllocator,
    );

    await defRepo.create({
      id: DEF_ID,
      name: 'Nightly',
      version: 1,
      sessionMode: 'per-stage',
      variables: [],
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await stageDefRepo.create(makeStageDef('s-a', 0));
  });

  /** The execution context an earlier run of the same automation left behind. */
  const INHERITED = {
    __workingDirectory: '/ws/executions/previous-run',
    __artifactsDirectory: '/ws/executions/previous-run/artifacts',
    __workspaceId: 'ws-previous',
  };

  it('drops an inherited workspace so the run provisions a fresh one', async () => {
    const run = await service.createRun({
      workflowDefinitionId: DEF_ID,
      variables: { ...INHERITED, __triggeredBy: 'schedule', topic: 'weekly digest' },
    });

    const stored = await runRepo.getById(run.id);
    expect(stored.variables?.['__workingDirectory']).toBeUndefined();
    expect(stored.variables?.['__artifactsDirectory']).toBeUndefined();
    expect(stored.variables?.['__workspaceId']).toBeUndefined();
    // Only the execution context is dropped — the automation's real inputs
    // are what the run is FOR and must survive untouched.
    expect(stored.variables?.['topic']).toBe('weekly digest');
  });

  it('CONTROL: a manual run keeps a pinned working directory', async () => {
    const run = await service.createRun({
      workflowDefinitionId: DEF_ID,
      variables: { ...INHERITED, __triggeredBy: 'manual' },
    });

    // A human who typed a directory meant it.
    const stored = await runRepo.getById(run.id);
    expect(stored.variables?.['__workingDirectory']).toBe('/ws/executions/previous-run');
  });

  it('CONTROL: a run with no trigger marker is unaffected', async () => {
    const run = await service.createRun({
      workflowDefinitionId: DEF_ID,
      variables: { ...INHERITED },
    });

    const stored = await runRepo.getById(run.id);
    expect(stored.variables?.['__workspaceId']).toBe('ws-previous');
  });

  it('is a no-op for a scheduled run that carries no inherited context', async () => {
    const run = await service.createRun({
      workflowDefinitionId: DEF_ID,
      variables: { __triggeredBy: 'schedule', topic: 't' },
    });

    const stored = await runRepo.getById(run.id);
    expect(stored.variables?.['topic']).toBe('t');
    expect(stored.variables?.['__triggeredBy']).toBe('schedule');
  });
});
