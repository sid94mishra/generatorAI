// ────────────────────────────────────────────────────────────────
// P0-b — "automations lose work silently" (P0-41), still reproducible.
//
// The durable iteration machinery (initializeIterations / claimNextIteration)
// existed and worked, but NOTHING called it after a restart:
// `AutomationRecoveryService` only ever FINALISED. A 1000-row batch that died
// at row 40 was marked `completed` with `completedIterations: 40` and the
// other 960 claimed-or-pending slots were never run by anyone — the exact
// defect the mechanism was built to fix, reported as success.
//
// These tests drive the real `AutomationService` and the real
// `AutomationRecoveryService` against a real SQLite durable engine. The first
// one pins the defect (recovery WITHOUT the resume hook), the rest prove the
// fix.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, EntryRepository, RegisterRepository, type AppDatabase } from '@generatorai/db';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  ILogger,
  WorkflowRun,
} from '@generatorai/shared';

import { AutomationService } from '../src/services/AutomationService.js';
import type {
  IAutomationRepository,
  IAutomationExecutionRepository,
} from '../src/services/AutomationService.js';
import { AutomationRecoveryService } from '../src/services/AutomationRecoveryService.js';
import type { IIdempotencyKeyRepository } from '../src/services/AutomationRecoveryService.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import type { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import {
  DurableExecutionEngine,
  type IterationSlotPayload,
} from '../src/services/DurableExecutionEngine.js';
import { EventBus } from '../src/events/EventBus.js';

const AUTOMATION_ID = 'auto-1';
const EXECUTION_ID = 'exec-1';
const TOTAL_ITERATIONS = 10;
/** Iterations the crashed process finished before it died. */
const COMPLETED_BEFORE_CRASH = 4;

function mockLogger(): ILogger {
  return {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    child: () => mockLogger(),
  } as unknown as ILogger;
}

// ── In-memory automation stores ─────────────────────────────────

interface Stores {
  automations: Map<string, Automation>;
  executions: Map<string, AutomationExecution>;
  execRuns: AutomationExecutionRun[];
  workflowRuns: Map<string, WorkflowRun>;
}

function automation(): Automation {
  return {
    id: AUTOMATION_ID,
    name: 'batch',
    enabled: true,
    triggerType: 'manual',
    workflowIds: ['wf-1'],
    dataSchema: { version: 1, format: 'json_array', fields: [{ name: 'row', type: 'string' }] },
    iterationMode: { kind: 'each_row' },
    defaultDataset: {
      format: 'json_array',
      data: JSON.stringify(Array.from({ length: TOTAL_ITERATIONS }, (_, i) => ({ row: `row-${i}` }))),
    },
    variables: {},
    maxConcurrency: 1,
    onError: 'continue',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function automationRepo(stores: Stores): IAutomationRepository {
  return {
    create: async (a) => { stores.automations.set(a.id, a); return a; },
    getById: async (id) => {
      const row = stores.automations.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
    getAll: async () => [...stores.automations.values()],
    getEnabled: async () => [...stores.automations.values()],
    getByTriggerType: async () => [],
    getByWebhookTokenHash: async () => null,
    getByProjectId: async () => [],
    update: async (id, updates) => {
      const next = { ...stores.automations.get(id)!, ...updates } as Automation;
      stores.automations.set(id, next);
      return next;
    },
    delete: async (id) => { stores.automations.delete(id); },
    claimDueSchedules: async () => [],
    extendScheduleLease: async () => true,
    releaseScheduleLease: async () => {},
  };
}

function executionRepo(stores: Stores): IAutomationExecutionRepository {
  return {
    createExecution: async (e) => { stores.executions.set(e.id, e); return e; },
    getExecutionById: async (id) => {
      const row = stores.executions.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
    getExecutionsByAutomationId: async (autoId) =>
      [...stores.executions.values()].filter((e) => e.automationId === autoId),
    updateExecution: async (id, updates) => {
      const next = { ...stores.executions.get(id)!, ...updates } as AutomationExecution;
      stores.executions.set(id, next);
      return next;
    },
    deleteExecution: async (id) => { stores.executions.delete(id); },
    createExecutionRun: async (r) => { stores.execRuns.push(r); return r; },
    getExecutionRunsByExecutionId: async (id) => stores.execRuns.filter((r) => r.executionId === id),
    updateExecutionRun: async (id, updates) => {
      const idx = stores.execRuns.findIndex((r) => r.id === id);
      stores.execRuns[idx] = { ...stores.execRuns[idx]!, ...updates } as AutomationExecutionRun;
      return stores.execRuns[idx]!;
    },
  };
}

function workflowRunRepo(stores: Stores): IWorkflowRunRepository {
  return {
    getById: async (id: string) => {
      const row = stores.workflowRuns.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
  } as unknown as IWorkflowRunRepository;
}

/** Every workflow run this fake creates completes immediately. */
function workflowRunService(stores: Stores): WorkflowRunService {
  let counter = 0;
  return {
    createRun: async (params: { workflowDefinitionId: string; variables?: Record<string, unknown> }) => {
      counter += 1;
      const run = {
        id: `run-${counter}`,
        workflowDefinitionId: params.workflowDefinitionId,
        status: 'completed',
        variables: params.variables ?? {},
      } as unknown as WorkflowRun;
      stores.workflowRuns.set(run.id, run);
      return run;
    },
    startRun: async () => {},
  } as unknown as WorkflowRunService;
}

function idempotencyRepo(): IIdempotencyKeyRepository {
  return { sweepExpired: async () => 0 };
}

// ── Fixture ─────────────────────────────────────────────────────

let dir: string;
let db: AppDatabase;
let entryRepo: EntryRepository;
let engine: DurableExecutionEngine;
let stores: Stores;
let service: AutomationService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-automation-resume-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  entryRepo = new EntryRepository(db);
  engine = new DurableExecutionEngine(new RegisterRepository(db), entryRepo, mockLogger());

  stores = {
    automations: new Map([[AUTOMATION_ID, automation()]]),
    executions: new Map(),
    execRuns: [],
    workflowRuns: new Map(),
  };

  service = new AutomationService(
    automationRepo(stores),
    executionRepo(stores),
    workflowRunService(stores),
    workflowRunRepo(stores),
    {} as unknown as WorkflowDefinitionService,
    new EventBus(),
    mockLogger(),
    engine,
  );
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

/**
 * Reproduce a batch that died mid-flight: slots for all 10 iterations exist,
 * 0..3 finished, 4 was claimed by the process that died (so its lease is
 * dangling), and 5..9 were never touched.
 */
function simulateCrashedBatch(): void {
  stores.executions.set(EXECUTION_ID, {
    id: EXECUTION_ID,
    automationId: AUTOMATION_ID,
    status: 'running',
    triggeredBy: 'manual',
    totalIterations: TOTAL_ITERATIONS,
    completedIterations: COMPLETED_BEFORE_CRASH,
    failedIterations: 0,
    createdAt: new Date(),
  });

  engine.initializeIterations(
    EXECUTION_ID,
    Array.from({ length: TOTAL_ITERATIONS }, (_, i) => ({
      index: i,
      variables: { row: `row-${i}` },
      label: `row-${i}`,
    })),
  );

  for (let i = 0; i < COMPLETED_BEFORE_CRASH; i += 1) {
    const claimed = engine.claimNextIteration(EXECUTION_ID)!;
    engine.completeIteration(claimed.id, 'completed');
    // The finished iterations left settled execution-run rows behind.
    const runId = `pre-crash-run-${i}`;
    stores.workflowRuns.set(runId, { id: runId, status: 'completed' } as unknown as WorkflowRun);
    stores.execRuns.push({
      id: `pre-crash-exec-run-${i}`,
      executionId: EXECUTION_ID,
      workflowRunId: runId,
      workflowDefinitionId: 'wf-1',
      iterationIndex: i,
      status: 'completed',
      createdAt: new Date(),
    });
  }

  // Iteration 4 was in flight when the process died: claimed, never completed.
  engine.claimNextIteration(EXECUTION_ID);
}

function slotStatuses(): IterationSlotPayload['status'][] {
  return entryRepo
    .listClaimedIterations('automation_execution', EXECUTION_ID)
    .map((e) => (e.payload as IterationSlotPayload).status);
}

describe('P0-b — an interrupted automation batch resumes instead of reporting success', () => {
  it('DEFECT: with no resume hook, recovery finalises the batch as completed and abandons 6 iterations', async () => {
    simulateCrashedBatch();

    const recovery = new AutomationRecoveryService(
      automationRepo(stores),
      executionRepo(stores),
      workflowRunRepo(stores),
      new EventBus(),
      idempotencyRepo(),
      mockLogger(),
      // no onResumeExecution — the pre-fix wiring
    );
    await recovery.recoverOnBoot();

    const exec = stores.executions.get(EXECUTION_ID)!;
    expect(exec.status).toBe('completed');
    expect(exec.completedIterations).toBe(COMPLETED_BEFORE_CRASH);
    // 6 iterations of real work, reported as a success and never run.
    expect(engine.countPendingIterations(EXECUTION_ID)).toBe(5);
  });

  it('resumes the batch, runs every remaining iteration, and only then finalises', async () => {
    simulateCrashedBatch();

    let completion: Promise<void> = Promise.resolve();
    const recovery = new AutomationRecoveryService(
      automationRepo(stores),
      executionRepo(stores),
      workflowRunRepo(stores),
      new EventBus(),
      idempotencyRepo(),
      mockLogger(),
      async (executionId, opts) => {
        const outcome = await service.resumeExecution(executionId, opts);
        completion = outcome.completion;
        return outcome;
      },
    );

    const { recovered } = await recovery.recoverOnBoot();
    await completion;

    // Not "recovered" in the finalise-it sense — it was handed back to the
    // service to actually run.
    expect(recovered).toBe(0);

    const exec = stores.executions.get(EXECUTION_ID)!;
    expect(exec.status).toBe('completed');
    expect(exec.completedIterations).toBe(TOTAL_ITERATIONS);
    expect(engine.countPendingIterations(EXECUTION_ID)).toBe(0);
    expect(slotStatuses()).toEqual(Array(TOTAL_ITERATIONS).fill('completed'));
  });

  it('re-drives the abandoned iteration and the untouched ones, with their REAL indexes', async () => {
    simulateCrashedBatch();

    let completion: Promise<void> = Promise.resolve();
    const recovery = new AutomationRecoveryService(
      automationRepo(stores),
      executionRepo(stores),
      workflowRunRepo(stores),
      new EventBus(),
      idempotencyRepo(),
      mockLogger(),
      async (executionId, opts) => {
        const outcome = await service.resumeExecution(executionId, opts);
        completion = outcome.completion;
        return outcome;
      },
    );
    await recovery.recoverOnBoot();
    await completion;

    const resumedIndexes = stores.execRuns
      .filter((r) => !r.id.startsWith('pre-crash-'))
      .map((r) => r.iterationIndex);

    // 4 is the iteration whose lease was dangling; 5..9 were never claimed.
    // The pre-fix loop derived this from an in-memory batch counter, which
    // after a resume restarts at 0 — so recovered rows were labelled with a
    // completely different iteration's index.
    expect(resumedIndexes).toEqual([4, 5, 6, 7, 8, 9]);

    // And the variables travel with the slot, not the counter.
    const first = stores.execRuns.find((r) => r.iterationIndex === 4 && !r.id.startsWith('pre-crash-'))!;
    expect(first.iterationVariables).toMatchObject({ row: 'row-4' });
  });

  it('leaves an iteration whose workflow run is still live claimed, so it is not run twice', async () => {
    simulateCrashedBatch();
    // Iteration 4's workflow run survived the restart and is being driven
    // by the workflow engine's recovery.
    stores.workflowRuns.set('live-run', { id: 'live-run', status: 'running' } as unknown as WorkflowRun);
    stores.execRuns.push({
      id: 'live-exec-run',
      executionId: EXECUTION_ID,
      workflowRunId: 'live-run',
      workflowDefinitionId: 'wf-1',
      iterationIndex: 4,
      status: 'running',
      createdAt: new Date(),
    });

    let completion: Promise<void> = Promise.resolve();
    const recovery = new AutomationRecoveryService(
      automationRepo(stores),
      executionRepo(stores),
      workflowRunRepo(stores),
      new EventBus(),
      idempotencyRepo(),
      mockLogger(),
      async (executionId, opts) => {
        const outcome = await service.resumeExecution(executionId, opts);
        completion = outcome.completion;
        return outcome;
      },
    );
    await recovery.recoverOnBoot();
    await completion;

    const resumedIndexes = stores.execRuns
      .filter((r) => !r.id.startsWith('pre-crash-') && r.id !== 'live-exec-run')
      .map((r) => r.iterationIndex);
    expect(resumedIndexes).toEqual([5, 6, 7, 8, 9]);
  });

  it('finalises normally when nothing is left to claim', async () => {
    simulateCrashedBatch();
    // Drain every remaining slot so the resume hook has nothing to do.
    for (;;) {
      const claimed = engine.claimNextIteration(EXECUTION_ID);
      if (!claimed) break;
      engine.completeIteration(claimed.id, 'completed');
    }
    engine.reclaimExpiredIterations(EXECUTION_ID, { leaseMs: 0 });
    for (;;) {
      const claimed = engine.claimNextIteration(EXECUTION_ID);
      if (!claimed) break;
      engine.completeIteration(claimed.id, 'completed');
    }

    const recovery = new AutomationRecoveryService(
      automationRepo(stores),
      executionRepo(stores),
      workflowRunRepo(stores),
      new EventBus(),
      idempotencyRepo(),
      mockLogger(),
      async (executionId, opts) => service.resumeExecution(executionId, opts),
    );
    const { recovered } = await recovery.recoverOnBoot();

    expect(recovered).toBe(1);
    expect(stores.executions.get(EXECUTION_ID)!.status).toBe('completed');
  });
});
