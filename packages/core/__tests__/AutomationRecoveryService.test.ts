// ────────────────────────────────────────────────────────────────
// AutomationRecoveryService tests (Track A1)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationRecoveryService } from '../src/services/AutomationRecoveryService.js';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  WorkflowRun,
  WorkflowRunStatus,
  ILogger,
} from '@generatorai/shared';
import type {
  IAutomationRepository,
  IAutomationExecutionRepository,
} from '../src/services/AutomationService.js';
import type { IIdempotencyKeyRepository } from '../src/services/AutomationRecoveryService.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import { EventBus } from '../src/events/EventBus.js';

// ── Minimal in-memory mocks ──

function createAutomationRepo(rows: Automation[]): IAutomationRepository {
  const store = new Map(rows.map((a) => [a.id, a]));
  return {
    create: async (a) => { store.set(a.id, a); return a; },
    getById: async (id) => {
      const row = store.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
    getAll: async () => [...store.values()],
    getEnabled: async () => [...store.values()].filter((a) => a.enabled),
    getByTriggerType: async () => [],
    getByWebhookTokenHash: async () => null,
    getByProjectId: async () => [],
    update: async (id, updates) => {
      const cur = store.get(id);
      if (!cur) throw new Error(`not found: ${id}`);
      const next = { ...cur, ...updates } as Automation;
      store.set(id, next);
      return next;
    },
    delete: async (id) => { store.delete(id); },
    claimDueSchedules: async () => [],
    extendScheduleLease: async () => true,
    releaseScheduleLease: async () => {},
  };
}

interface ExecStore {
  executions: Map<string, AutomationExecution>;
  runs: Map<string, AutomationExecutionRun[]>;
}

function createExecutionRepo(store: ExecStore): IAutomationExecutionRepository {
  return {
    createExecution: async (e) => { store.executions.set(e.id, e); return e; },
    getExecutionById: async (id) => {
      const row = store.executions.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
    getExecutionsByAutomationId: async (autoId) =>
      [...store.executions.values()].filter((e) => e.automationId === autoId),
    updateExecution: async (id, updates) => {
      const cur = store.executions.get(id);
      if (!cur) throw new Error(`not found: ${id}`);
      const next = { ...cur, ...updates } as AutomationExecution;
      store.executions.set(id, next);
      return next;
    },
    deleteExecution: async (id) => { store.executions.delete(id); },
    createExecutionRun: async (r) => {
      const list = store.runs.get(r.executionId) ?? [];
      list.push(r);
      store.runs.set(r.executionId, list);
      return r;
    },
    getExecutionRunsByExecutionId: async (id) => store.runs.get(id) ?? [],
    updateExecutionRun: async (id, updates) => {
      for (const list of store.runs.values()) {
        const idx = list.findIndex((r) => r.id === id);
        if (idx !== -1) {
          const next = { ...list[idx]!, ...updates } as AutomationExecutionRun;
          list[idx] = next;
          return next;
        }
      }
      throw new Error(`not found: ${id}`);
    },
  };
}

function createWorkflowRunRepo(rows: Array<Partial<WorkflowRun> & { id: string; status: WorkflowRunStatus }>): IWorkflowRunRepository {
  const store = new Map(rows.map((r) => [r.id, r]));
  return {
    getById: async (id) => {
      const row = store.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row as WorkflowRun;
    },
  } as unknown as IWorkflowRunRepository;
}

function createIdempotencyRepo(): IIdempotencyKeyRepository {
  return { sweepExpired: async () => 0 };
}

function createLogger(): ILogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => createLogger(),
  } as unknown as ILogger;
}

function baseAutomation(id: string): Automation {
  return {
    id,
    name: id,
    enabled: true,
    triggerType: 'manual',
    workflowIds: ['wf-1'],
    inputMode: 'single',
    variables: {},
    maxConcurrency: 1,
    onError: 'continue',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function baseExecution(id: string, automationId: string, status: AutomationExecution['status'] = 'running'): AutomationExecution {
  return {
    id,
    automationId,
    status,
    triggeredBy: 'manual',
    totalIterations: 0,
    completedIterations: 0,
    failedIterations: 0,
    createdAt: new Date(),
  };
}

function baseExecRun(
  id: string,
  executionId: string,
  workflowRunId: string,
  status: AutomationExecutionRun['status'] = 'running',
): AutomationExecutionRun {
  return {
    id,
    executionId,
    workflowRunId,
    workflowDefinitionId: 'wf-1',
    iterationIndex: 0,
    status,
    createdAt: new Date(),
  };
}

describe('AutomationRecoveryService (Track A1)', () => {
  let execStore: ExecStore;

  beforeEach(() => {
    execStore = { executions: new Map(), runs: new Map() };
  });

  it('marks a running execution with no children as failed', async () => {
    const auto = baseAutomation('a1');
    const exec = baseExecution('e1', 'a1', 'running');
    execStore.executions.set('e1', exec);
    const service = new AutomationRecoveryService(
      createAutomationRepo([auto]),
      createExecutionRepo(execStore),
      createWorkflowRunRepo([]),
      new EventBus({ store: async () => 0 } as never, createLogger(), { allocate: async () => 1 } as never),
      createIdempotencyRepo(),
      createLogger(),
    );
    const result = await service.recoverOnBoot();
    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(1);
    expect(execStore.executions.get('e1')?.status).toBe('failed');
    expect(execStore.executions.get('e1')?.error).toMatch(/interrupted/);
  });

  it('resolves a running execution with all child runs completed', async () => {
    const auto = baseAutomation('a1');
    const exec = baseExecution('e1', 'a1', 'running');
    execStore.executions.set('e1', exec);
    execStore.runs.set('e1', [
      baseExecRun('r1', 'e1', 'wfr-1', 'running'),
      baseExecRun('r2', 'e1', 'wfr-2', 'running'),
    ]);
    const service = new AutomationRecoveryService(
      createAutomationRepo([auto]),
      createExecutionRepo(execStore),
      createWorkflowRunRepo([
        { id: 'wfr-1', status: 'completed' },
        { id: 'wfr-2', status: 'completed' },
      ]),
      new EventBus({ store: async () => 0 } as never, createLogger(), { allocate: async () => 1 } as never),
      createIdempotencyRepo(),
      createLogger(),
    );
    const result = await service.recoverOnBoot();
    expect(result.recovered).toBe(1);
    const finalExec = execStore.executions.get('e1')!;
    expect(finalExec.status).toBe('completed');
    expect(finalExec.completedIterations).toBe(2);
  });

  it('marks execution failed when a child failed and none completed', async () => {
    const auto = baseAutomation('a1');
    execStore.executions.set('e1', baseExecution('e1', 'a1', 'running'));
    execStore.runs.set('e1', [baseExecRun('r1', 'e1', 'wfr-1', 'running')]);
    const service = new AutomationRecoveryService(
      createAutomationRepo([auto]),
      createExecutionRepo(execStore),
      createWorkflowRunRepo([{ id: 'wfr-1', status: 'failed' }]),
      new EventBus({ store: async () => 0 } as never, createLogger(), { allocate: async () => 1 } as never),
      createIdempotencyRepo(),
      createLogger(),
    );
    const result = await service.recoverOnBoot();
    expect(result.recovered).toBe(1);
    expect(execStore.executions.get('e1')?.status).toBe('failed');
    expect(execStore.executions.get('e1')?.failedIterations).toBe(1);
  });

  it('leaves executions with active children in running state', async () => {
    const auto = baseAutomation('a1');
    execStore.executions.set('e1', baseExecution('e1', 'a1', 'running'));
    execStore.runs.set('e1', [baseExecRun('r1', 'e1', 'wfr-1', 'running')]);
    const service = new AutomationRecoveryService(
      createAutomationRepo([auto]),
      createExecutionRepo(execStore),
      createWorkflowRunRepo([{ id: 'wfr-1', status: 'running' }]),
      new EventBus({ store: async () => 0 } as never, createLogger(), { allocate: async () => 1 } as never),
      createIdempotencyRepo(),
      createLogger(),
    );
    const result = await service.recoverOnBoot();
    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(0);
    expect(execStore.executions.get('e1')?.status).toBe('running');
  });

  it('marks execution cancelled when only cancellations are seen', async () => {
    const auto = baseAutomation('a1');
    execStore.executions.set('e1', baseExecution('e1', 'a1', 'running'));
    execStore.runs.set('e1', [
      baseExecRun('r1', 'e1', 'wfr-1', 'cancelled'),
      baseExecRun('r2', 'e1', 'wfr-2', 'cancelled'),
    ]);
    const service = new AutomationRecoveryService(
      createAutomationRepo([auto]),
      createExecutionRepo(execStore),
      createWorkflowRunRepo([
        { id: 'wfr-1', status: 'cancelled' },
        { id: 'wfr-2', status: 'cancelled' },
      ]),
      new EventBus({ store: async () => 0 } as never, createLogger(), { allocate: async () => 1 } as never),
      createIdempotencyRepo(),
      createLogger(),
    );
    await service.recoverOnBoot();
    expect(execStore.executions.get('e1')?.status).toBe('cancelled');
  });

  it('idempotency sweeper starts/stops without leaks', () => {
    const service = new AutomationRecoveryService(
      createAutomationRepo([]),
      createExecutionRepo(execStore),
      createWorkflowRunRepo([]),
      new EventBus({ store: async () => 0 } as never, createLogger(), { allocate: async () => 1 } as never),
      createIdempotencyRepo(),
      createLogger(),
    );
    service.startIdempotencySweeper(500);
    // Idempotent — calling again is a no-op.
    service.startIdempotencySweeper(500);
    service.stopIdempotencySweeper();
    service.stopIdempotencySweeper();
  });
});
