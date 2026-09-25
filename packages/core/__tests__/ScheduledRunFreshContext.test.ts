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
  MockWorkflowDefinitionStore,
  createFakeWorkspaceManager,
  seedDefinition,
  testGraph,
} from './MockRepositories.js';
import { EventBus } from '../src/events/EventBus.js';
import { AdmissionController } from '../src/services/AdmissionController.js';
import { DAGScheduler } from '../src/services/DAGScheduler.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';
import type { StageExecutionService } from '../src/services/StageExecutionService.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';

const DEF_ID = 'def-1';

describe('X-21 — a scheduled run starts from a clean execution context', () => {
  let service: WorkflowRunService;
  let runRepo: MockWorkflowRunRepository;

  beforeEach(async () => {
    const stageRunRepo = new MockStageRunRepository();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    const store = new MockWorkflowDefinitionStore();
    const definitions = new RunDefinitionReader(store);

    service = new WorkflowRunService(
      runRepo,
      stageRunRepo,
      definitions,
      new WorkflowDefinitionService(store, {} as TemplateRegistry),
      new EventBus(),
      new DAGScheduler(definitions, stageRunRepo, runRepo),
      { executeStage: vi.fn(async () => {}) } as unknown as StageExecutionService,
      { releaseAll: vi.fn(async () => {}) } as unknown as SessionAllocator,
      createFakeWorkspaceManager(),
      new AdmissionController(),
    );

    await seedDefinition(store, testGraph(['a'], [], { name: 'Nightly' }), DEF_ID);
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
