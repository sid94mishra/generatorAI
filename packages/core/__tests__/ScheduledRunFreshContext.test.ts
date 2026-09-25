// ────────────────────────────────────────────────────────────────
// X-21 — "fresh agent with no history for scheduled runs" (W24).
//
// `AutomationService` wrote `triggeredBy` onto the execution row and read it
// in exactly ONE place — the default-dataset fallback. It reached neither
// `createRun`, nor the workspace, nor the harness, so the requirement had no
// mechanism behind it at all.
//
// Since P01 (R-8) caller variables cannot carry engine state at all: the
// trigger is a typed param, and __* / repo_path_* names are refused, so an
// automation can no longer hand every nightly run the same directory.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import {
  MockWorkflowRunRepository,
  MockStageRunRepository,
  MockWorkflowDefinitionStore,
  seedDefinition,
  testGraph,
} from './MockRepositories.js';
import { EventBus } from '../src/events/EventBus.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { RunSupervisor } from '../src/services/engine/RunSupervisor.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';

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
      {} as RunSupervisor, // creating a run does not touch the engine
    );

    await seedDefinition(store, testGraph(['a'], [], { name: 'Nightly' }), DEF_ID);
  });

  it('records the trigger from the typed param and keeps the user inputs', async () => {
    const run = await service.createRun({ workflowDefinitionId: DEF_ID, variables: { topic: 't' }, triggeredBy: 'schedule' });
    const stored = await runRepo.getById(run.id);
    expect(stored.variables?.['topic']).toBe('t');
    expect(stored.trigger).toEqual({ kind: 'automation', via: 'schedule' });
    expect(stored.variables?.['__workingDirectory']).toBeUndefined();
  });

  it('refuses caller variables that would seed an execution context or a codebase path (R-8)', async () => {
    for (const key of ['__workingDirectory', '__triggeredBy', '__stageOverrides', 'repo_path_target']) {
      await expect(
        service.createRun({ workflowDefinitionId: DEF_ID, variables: { [key]: '/elsewhere' } }),
      ).rejects.toThrow(/engine-reserved/);
    }
  });
});
