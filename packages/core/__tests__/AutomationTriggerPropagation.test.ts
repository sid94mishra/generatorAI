// ────────────────────────────────────────────────────────────────
// X-21, first half — `triggeredBy` has to REACH the run.
//
// Before this pass `AutomationTriggerType` had exactly one behavioural reader
// in the whole repository (`AutomationService.ts`'s default-dataset fallback).
// It was written onto the execution row and stopped there: `runSingleWorkflow`
// had no trigger argument, `createRun` had no field for it, and nothing
// downstream could tell a nightly cron run from a button press. Since P04 the
// trigger is the invocation's server-derived context (`{kind: 'automation',
// via}`), never a variable.
//
// The second half — what a scheduled run then does differently — is pinned in
// `ScheduledRunFreshContext.test.ts` against the real invocation.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDB, migrateDB, EntryRepository, RegisterRepository } from '@generatorai/db';
import { AutomationService } from '../src/services/AutomationService.js';
import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';
import { EventBus } from '../src/events/EventBus.js';
import type { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import type { WorkflowInvocationService } from '../src/services/workflow-invocation/WorkflowInvocationService.js';
import type { InvocationContext } from '../src/services/workflow-invocation/types.js';
import type { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { IAutomationRepository, IAutomationExecutionRepository } from '../src/services/AutomationService.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  ILogger,
  WorkflowRun,
} from '@generatorai/shared';

/** Automation iterations are durable slots (P01 WP-1.3) — back them with a real engine. */
function makeEngine(): DurableExecutionEngine {
  const db = createDB(':memory:');
  migrateDB(db);
  const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;
  return new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), quiet);
}

function mockLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
}

const AUTOMATION_ID = 'auto-1';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: AUTOMATION_ID,
    name: 'nightly digest',
    enabled: true,
    triggerType: 'manual',
    workflowIds: ['wf-1'],
    variables: {},
    maxConcurrency: 1,
    onError: 'continue',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Automation;
}

describe('X-21 — the trigger reaches the workflow run', () => {
  let service: AutomationService;
  let created: Array<{ variables: Record<string, unknown>; trigger: unknown }>;

  beforeEach(() => {
    created = [];
    const automations = new Map<string, Automation>([
      [AUTOMATION_ID, automation({ triggerType: 'webhook', webhookToken: 'tok' } as Partial<Automation>)],
    ]);
    const executions = new Map<string, AutomationExecution>();
    const runs = new Map<string, WorkflowRun>();
    let counter = 0;

    const automationRepo = {
      getById: async (id: string) => automations.get(id)!,
      getByWebhookTokenHash: async () => [...automations.values()][0]!,
      update: async (id: string, u: Partial<Automation>) => {
        const next = { ...automations.get(id)!, ...u } as Automation;
        automations.set(id, next);
        return next;
      },
    } as unknown as IAutomationRepository;

    const executionRepo = {
      createExecution: async (e: AutomationExecution) => { executions.set(e.id, e); return e; },
      openExecution: async (e: AutomationExecution) => { executions.set(e.id, e); },
      getExecutionById: async (id: string) => executions.get(id)!,
      updateExecution: async (id: string, u: Partial<AutomationExecution>) => {
        const next = { ...executions.get(id)!, ...u } as AutomationExecution;
        executions.set(id, next);
        return next;
      },
      createExecutionRun: async (r: AutomationExecutionRun) => r,
      updateExecutionRun: async (_id: string, u: Partial<AutomationExecutionRun>) => u as AutomationExecutionRun,
      getExecutionRunsByExecutionId: async () => [],
    } as unknown as IAutomationExecutionRepository;

    const invocation = {
      invoke: async (req: { target: { workflowDefinitionId: string }; variables?: Record<string, unknown> }, ctx: InvocationContext) => {
        counter += 1;
        created.push({ variables: req.variables ?? {}, trigger: ctx.trigger });
        const run = { id: `run-${counter}`, workflowDefinitionId: req.target.workflowDefinitionId, status: 'completed', variables: req.variables ?? {} } as unknown as WorkflowRun;
        runs.set(run.id, run);
        return { runId: run.id };
      },
      waitFor: async (runId: string) => ({ ...runs.get(runId)!, waited: 'finalized' }),
    } as unknown as Pick<WorkflowInvocationService, 'invoke' | 'waitFor'>;

    service = new AutomationService(
      automationRepo,
      executionRepo,
      { command: async () => ({ ok: true }) } as unknown as WorkflowRunService,
      invocation,
      { getById: async (id: string) => runs.get(id)! } as unknown as IWorkflowRunRepository,
      {} as unknown as WorkflowDefinitionService,
      new EventBus(),
      mockLogger(),
      makeEngine(),
    );
  });

  it('invokes the run a manual trigger creates with an automation trigger', async () => {
    await service.triggerManual(AUTOMATION_ID);

    // The execution runs in the background (durable slot claim first).
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.trigger).toMatchObject({ kind: 'automation', automationId: AUTOMATION_ID, via: 'manual', iterationIndex: 0 });
    expect(Object.keys(created[0]!.variables).filter((k) => k.startsWith('__'))).toEqual([]);
  });

  it('invokes the run a webhook trigger creates with an automation trigger', async () => {
    await service.triggerWebhook('tok', { topic: 'x' });

    // The execution runs in the background (durable slot claim first).
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.trigger).toMatchObject({ kind: 'automation', via: 'webhook' });
    // Without a data schema the payload is recorded on the execution, not
    // spread into run variables (the legacy extraction is gone, P01 WP-1.4).
    expect(created[0]!.variables['topic']).toBeUndefined();
  });
});
