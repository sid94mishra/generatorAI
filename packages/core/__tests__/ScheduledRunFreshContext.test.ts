// ────────────────────────────────────────────────────────────────
// X-21 — "fresh agent with no history for scheduled runs" (W24).
//
// `AutomationService` wrote `triggeredBy` onto the execution row and read it
// in exactly ONE place — the default-dataset fallback. It reached neither
// `createRun`, nor the workspace, nor the harness, so the requirement had no
// mechanism behind it at all.
//
// Since P01 (R-8) caller variables cannot carry engine state at all, and
// since P04 the trigger is the invocation's trusted context and the run's
// system values live in `system_vars`: __* / repo_path_* names are refused,
// so an automation can no longer hand every nightly run the same directory.
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
import { WorkflowInvocationService } from '../src/services/workflow-invocation/WorkflowInvocationService.js';
import type { InvocationContext } from '../src/services/workflow-invocation/types.js';

const SCHEDULE: InvocationContext = {
  principal: { kind: 'system', id: 'automation:a-1', scopes: [] },
  trigger: { kind: 'automation', automationId: 'a-1', executionId: 'e-1', via: 'schedule', iterationIndex: 0 },
};

const DEF_ID = '6f2e1b3c-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('X-21 — a scheduled run starts from a clean execution context', () => {
  let service: WorkflowInvocationService;
  let runRepo: MockWorkflowRunRepository;

  beforeEach(async () => {
    const stageRunRepo = new MockStageRunRepository();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    const store = new MockWorkflowDefinitionStore();
    const definitions = new RunDefinitionReader(store);

    const definitionService = new WorkflowDefinitionService(store, {} as TemplateRegistry);
    const eventBus = new EventBus();
    const runs = new WorkflowRunService(
      runRepo,
      stageRunRepo,
      definitions,
      definitionService,
      eventBus,
      // The engine accepts the start; nothing executes here.
      { startRun: async () => ({ ok: true }) } as unknown as RunSupervisor,
    );
    service = new WorkflowInvocationService({
      runs,
      runRepo,
      stageRuns: stageRunRepo,
      definitions: definitionService,
      versions: definitions,
      eventBus,
    });

    await seedDefinition(store, testGraph(['a'], [], { name: 'Nightly' }), DEF_ID);
  });

  it('records the trigger from the trusted context and keeps the user inputs', async () => {
    const { runId } = await service.invoke({ target: { kind: 'definition', workflowDefinitionId: DEF_ID }, variables: { topic: 't' } }, SCHEDULE);
    const stored = await runRepo.getById(runId);
    expect(stored.variables?.['topic']).toBe('t');
    expect(stored.trigger).toEqual(SCHEDULE.trigger);
    expect(Object.keys(stored.variables ?? {}).filter((k) => k.startsWith('__'))).toEqual([]);
  });

  it('refuses caller variables that would seed an execution context or a codebase path (R-8)', async () => {
    for (const key of ['__workingDirectory', '__triggeredBy', '__stageOverrides', 'repo_path_target']) {
      await expect(
        service.invoke({ target: { kind: 'definition', workflowDefinitionId: DEF_ID }, variables: { [key]: '/elsewhere' } }, SCHEDULE),
      ).rejects.toThrow(/engine-reserved/i);
    }
  });
});
