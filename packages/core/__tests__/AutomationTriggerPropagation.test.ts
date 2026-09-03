// ────────────────────────────────────────────────────────────────
// X-21, first half — `triggeredBy` has to REACH the run.
//
// Before this pass `AutomationTriggerType` had exactly one behavioural reader
// in the whole repository (`AutomationService.ts`'s default-dataset fallback).
// It was written onto the execution row and stopped there: `runSingleWorkflow`
// had no trigger argument, `createRun` had no field for it, and nothing
// downstream could tell a nightly cron run from a button press.
//
// The second half — what a scheduled run then does differently — is pinned in
// `ScheduledRunFreshContext.test.ts` against the real `WorkflowRunService`.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationService } from '../src/services/AutomationService.js';
import { EventBus } from '../src/events/EventBus.js';
import type { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import type { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { IAutomationRepository } from '../src/domain/ports/IAutomationRepository.js';
import type { IAutomationExecutionRepository } from '../src/domain/ports/IAutomationExecutionRepository.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  ILogger,
  WorkflowRun,
} from '@generatorai/shared';

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
    inputMode: 'single',
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
  let createdRunVariables: Array<Record<string, unknown>>;

  beforeEach(() => {
    createdRunVariables = [];
    const automations = new Map<string, Automation>([
      [AUTOMATION_ID, automation({ triggerType: 'webhook', webhookToken: 'tok' } as Partial<Automation>)],
    ]);
    const executions = new Map<string, AutomationExecution>();
    const runs = new Map<string, WorkflowRun>();
    let counter = 0;

    const automationRepo = {
      getById: async (id: string) => automations.get(id)!,
      getByWebhookToken: async () => [...automations.values()][0]!,
      update: async (id: string, u: Partial<Automation>) => {
        const next = { ...automations.get(id)!, ...u } as Automation;
        automations.set(id, next);
        return next;
      },
    } as unknown as IAutomationRepository;

    const executionRepo = {
      createExecution: async (e: AutomationExecution) => { executions.set(e.id, e); return e; },
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

    const workflowRunService = {
      createRun: async (params: { workflowDefinitionId: string; variables?: Record<string, unknown> }) => {
        counter += 1;
        createdRunVariables.push(params.variables ?? {});
        const run = {
          id: `run-${counter}`,
          workflowDefinitionId: params.workflowDefinitionId,
          status: 'completed',
          variables: params.variables ?? {},
        } as unknown as WorkflowRun;
        runs.set(run.id, run);
        return run;
      },
      startRun: async () => {},
    } as unknown as WorkflowRunService;

    service = new AutomationService(
      automationRepo,
      executionRepo,
      workflowRunService,
      { getById: async (id: string) => runs.get(id)! } as unknown as IWorkflowRunRepository,
      {} as unknown as WorkflowDefinitionService,
      new EventBus(),
      mockLogger(),
    );
  });

  it('stamps __triggeredBy on the run a manual trigger creates', async () => {
    await service.triggerManual(AUTOMATION_ID);

    expect(createdRunVariables).toHaveLength(1);
    expect(createdRunVariables[0]!['__triggeredBy']).toBe('manual');
  });

  it('stamps __triggeredBy on the run a webhook trigger creates', async () => {
    await service.triggerWebhook('tok', { topic: 'x' });

    expect(createdRunVariables).toHaveLength(1);
    // The trigger travels alongside the payload-derived variables, not
    // instead of them.
    expect(createdRunVariables[0]!['__triggeredBy']).toBe('webhook');
    expect(createdRunVariables[0]!['topic']).toBe('x');
  });
});
