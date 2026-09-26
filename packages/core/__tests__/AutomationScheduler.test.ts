// ────────────────────────────────────────────────────────────────
// Item 38 — DB-backed due-row scheduler.
//
// Replaces the old in-process node-cron timers (one JS timer per schedule
// automation, alive only in the process that registered it) with a single
// periodic tick that claims whatever `automations` rows are due straight
// from the repository via `claimDueSchedules`. These tests drive
// `AutomationService.runSchedulerTick()` directly (rather than waiting on
// the real interval) against an in-memory repo that mirrors the real
// `DrizzleAutomationRepository.claimDueSchedules` semantics: one atomic
// claim stamps a lease, and the lease is released only once this process
// has finished handling the row.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDB, migrateDB, EntryRepository, RegisterRepository } from '@generatorai/db';
import { AutomationService } from '../src/services/AutomationService.js';
import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';
import type {
  IAutomationRepository,
  IAutomationExecutionRepository,
} from '../src/services/AutomationService.js';
import { EventBus } from '../src/events/EventBus.js';
import type { WorkflowRunService } from '../src/services/WorkflowRunService.js';
import type { WorkflowInvocationService } from '../src/services/workflow-invocation/WorkflowInvocationService.js';
import type { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  AutomationTriggerType,
  ILogger,
  PersistedEvent,
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

/** Let every pending microtask (un-awaited `.catch()` chains, background
 *  `runExecution` loops, fire-and-forget event emits) fully drain. None of
 *  these tests exercise real timers (no retries configured), so a single
 *  macrotask hop is enough — microtasks always finish before it runs. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

const AUTOMATION_ID = 'auto-sched-1';

function scheduleAutomation(overrides: Partial<Automation> = {}): Automation {
  const now = new Date();
  return {
    id: AUTOMATION_ID,
    name: 'nightly digest',
    enabled: true,
    triggerType: 'schedule',
    cronExpression: '*/5 * * * *',
    workflowIds: ['wf-1'],
    variables: {},
    maxConcurrency: 1,
    onError: 'continue',
    missedRunPolicy: 'skip',
    overlapPolicy: 'skip',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Automation;
}

/** In-memory automation repo mirroring `DrizzleAutomationRepository`'s
 *  due-row scheduler methods: `claimDueSchedules` is one atomic claim that
 *  stamps a lease, so two calls within `leaseMs` of each other cannot both
 *  claim the same row. `calls` records the order of notable operations so
 *  tests can assert the lease is released only after dispatch. */
class InMemoryAutomationRepo implements IAutomationRepository {
  private store = new Map<string, Automation>();
  private lockedUntil = new Map<string, number>();
  private lockedBy = new Map<string, string>();

  constructor(private readonly calls: string[] = []) {}

  seed(automation: Automation): void {
    this.store.set(automation.id, automation);
  }

  async create(a: Automation): Promise<Automation> {
    this.store.set(a.id, a);
    return a;
  }
  async getById(id: string): Promise<Automation> {
    const row = this.store.get(id);
    if (!row) throw new Error(`automation ${id} not found`);
    return row;
  }
  async getAll(): Promise<Automation[]> {
    return [...this.store.values()];
  }
  async getEnabled(): Promise<Automation[]> {
    return [...this.store.values()].filter((a) => a.enabled);
  }
  async getByTriggerType(triggerType: AutomationTriggerType): Promise<Automation[]> {
    return [...this.store.values()].filter((a) => a.triggerType === triggerType);
  }
  async getByWebhookTokenHash(): Promise<Automation | null> {
    return null;
  }
  async getByProjectId(): Promise<Automation[]> {
    return [];
  }
  async update(id: string, updates: Partial<Automation>): Promise<Automation> {
    const cur = this.store.get(id);
    if (!cur) throw new Error(`automation ${id} not found`);
    this.calls.push('nextRunAt' in updates ? 'update-nextRunAt' : 'update-other');
    const next = { ...cur, ...updates } as Automation;
    this.store.set(id, next);
    return next;
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async claimDueSchedules(now: Date, processId: string, leaseMs: number): Promise<Automation[]> {
    this.calls.push('claim');
    const claimed: Automation[] = [];
    for (const a of this.store.values()) {
      if (a.triggerType !== 'schedule' || !a.enabled) continue;
      if (!a.nextRunAt || a.nextRunAt.getTime() > now.getTime()) continue;
      const until = this.lockedUntil.get(a.id);
      if (until !== undefined && until >= now.getTime()) continue; // held by another process
      this.lockedUntil.set(a.id, now.getTime() + leaseMs);
      this.lockedBy.set(a.id, processId);
      claimed.push(a);
    }
    return claimed;
  }
  async extendScheduleLease(id: string, processId: string, leaseMs: number): Promise<boolean> {
    if (this.lockedBy.get(id) !== processId) return false;
    this.lockedUntil.set(id, Date.now() + leaseMs);
    return true;
  }
  async releaseScheduleLease(id: string, processId: string): Promise<void> {
    this.calls.push('release');
    if (this.lockedBy.get(id) === processId) {
      this.lockedUntil.delete(id);
      this.lockedBy.delete(id);
    }
  }
}

function makeExecutionRepo(calls: string[] = []): {
  repo: IAutomationExecutionRepository;
  executions: Map<string, AutomationExecution>;
} {
  const executions = new Map<string, AutomationExecution>();
  const execRuns = new Map<string, AutomationExecutionRun>();
  const repo: IAutomationExecutionRepository = {
    createExecution: async (e) => {
      calls.push('execution-created');
      executions.set(e.id, { ...e });
      return { ...e };
    },
    openExecution: async (e) => {
      calls.push('execution-created');
      executions.set(e.id, { ...e });
    },
    getExecutionById: async (id) => {
      const e = executions.get(id);
      if (!e) throw new Error(`execution ${id} not found`);
      return { ...e };
    },
    getExecutionsByAutomationId: async (automationId) =>
      [...executions.values()].filter((e) => e.automationId === automationId).map((e) => ({ ...e })),
    updateExecution: async (id, updates) => {
      const cur = executions.get(id);
      if (!cur) throw new Error(`execution ${id} not found`);
      const next = { ...cur, ...updates } as AutomationExecution;
      executions.set(id, next);
      return { ...next };
    },
    deleteExecution: async (id) => {
      executions.delete(id);
    },
    createExecutionRun: async (r) => {
      execRuns.set(r.id, { ...r });
      return { ...r };
    },
    getExecutionRunsByExecutionId: async (executionId) =>
      [...execRuns.values()].filter((r) => r.executionId === executionId),
    updateExecutionRun: async (id, updates) => {
      const cur = execRuns.get(id);
      if (!cur) throw new Error(`execRun ${id} not found`);
      const next = { ...cur, ...updates } as AutomationExecutionRun;
      execRuns.set(id, next);
      return next;
    },
  };
  return { repo, executions };
}

/** Every workflow run "completes" (or fails) synchronously in `createRun`
 *  — mirrors the pattern in AutomationTriggerPropagation.test.ts, so
 *  `waitForRunCompletion`'s fast-path (checking current status) resolves
 *  without needing a real event round-trip. */
function makeWorkflowHarness(
  outcomeFor: (variables: Record<string, unknown>, defId: string) => 'completed' | 'failed' = () => 'completed',
): {
  workflowRunService: WorkflowRunService;
  workflowRunRepo: IWorkflowRunRepository;
  createLog: Array<{ defId: string; variables: Record<string, unknown> }>;
} {
  const workflowRuns = new Map<string, WorkflowRun>();
  const createLog: Array<{ defId: string; variables: Record<string, unknown> }> = [];
  let counter = 0;

  const workflowRunService = {
    createRun: async (params: { workflowDefinitionId: string; variables?: Record<string, unknown> }) => {
      counter += 1;
      const id = `run-${counter}`;
      const variables = params.variables ?? {};
      const status = outcomeFor(variables, params.workflowDefinitionId);
      const run = {
        id,
        workflowDefinitionId: params.workflowDefinitionId,
        status,
        variables,
      } as unknown as WorkflowRun;
      workflowRuns.set(id, run);
      createLog.push({ defId: params.workflowDefinitionId, variables });
      return run;
    },
    startRun: async () => {},
    command: async () => ({ ok: true }),
  } as unknown as WorkflowRunService;

  const workflowRunRepo = {
    getById: async (id: string) => {
      const run = workflowRuns.get(id);
      if (!run) throw new Error(`workflow run ${id} not found`);
      return run;
    },
  } as unknown as IWorkflowRunRepository;

  return { workflowRunService, workflowRunRepo, createLog };
}


/** The invocation over the fake run service (P04: an automation starts every run through `invoke`, then `waitFor`). */
function invocationOver(runs: WorkflowRunService, repo: IWorkflowRunRepository): Pick<WorkflowInvocationService, 'invoke' | 'waitFor'> {
  return {
    invoke: async (req: { target: { workflowDefinitionId?: string }; variables?: Record<string, unknown> }) => {
      const run = await (runs as unknown as { createRun: (p: unknown) => Promise<{ id: string }> }).createRun({
        workflowDefinitionId: req.target.workflowDefinitionId,
        variables: req.variables ?? {},
      });
      await runs.startRun(run.id);
      return { runId: run.id };
    },
    waitFor: async (runId: string) => ({ ...(await repo.getById(runId)), waited: 'finalized' }),
  } as unknown as Pick<WorkflowInvocationService, 'invoke' | 'waitFor'>;
}

interface Harness {
  service: AutomationService;
  automationRepo: InMemoryAutomationRepo;
  executionRepo: ReturnType<typeof makeExecutionRepo>['repo'];
  executions: Map<string, AutomationExecution>;
  events: PersistedEvent[];
  calls: string[];
  createLog: Array<{ defId: string; variables: Record<string, unknown> }>;
}

function setup(outcomeFor?: (variables: Record<string, unknown>, defId: string) => 'completed' | 'failed'): Harness {
  const calls: string[] = [];
  const automationRepo = new InMemoryAutomationRepo(calls);
  const { repo: executionRepo, executions } = makeExecutionRepo(calls);
  const { workflowRunService, workflowRunRepo, createLog } = makeWorkflowHarness(outcomeFor);
  const eventBus = new EventBus();
  const events: PersistedEvent[] = [];
  eventBus.subscribeGlobal((event) => {
    events.push(event);
  });

  const service = new AutomationService(
    automationRepo,
    executionRepo,
    workflowRunService,
    invocationOver(workflowRunService, workflowRunRepo),
    workflowRunRepo,
    {} as unknown as WorkflowDefinitionService,
    eventBus,
    mockLogger(),
    makeEngine(),
    undefined, // artifactsDir
    // Item 38 — huge interval: these tests drive `runSchedulerTick()`
    // directly rather than waiting on the real setInterval.
    { pollIntervalMs: 1_000_000, leaseMs: 60_000 },
  );

  return { service, automationRepo, executionRepo, executions, events, calls, createLog };
}

describe('Item 38 — DB-backed due-row scheduler', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('claims a due schedule row and runs it', async () => {
    h.automationRepo.seed(scheduleAutomation({ nextRunAt: new Date(Date.now() - 1_000) }));

    await h.service.runSchedulerTick();
    await flush();

    expect(h.calls[0]).toBe('claim');
    expect(h.createLog).toHaveLength(1);
    expect(h.createLog[0]!.defId).toBe('wf-1');
    const exec = [...h.executions.values()].find((e) => e.automationId === AUTOMATION_ID);
    expect(exec).toBeDefined();
    expect(exec!.status).toBe('completed');
  });

  it('releases the lease only after the run is dispatched, not at the start', async () => {
    h.automationRepo.seed(scheduleAutomation({ nextRunAt: new Date(Date.now() - 1_000) }));

    await h.service.runSchedulerTick();
    await flush();

    const releaseIdx = h.calls.indexOf('release');
    const executionCreatedIdx = h.calls.indexOf('execution-created');
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(executionCreatedIdx).toBeGreaterThan(-1);
    // The lease must still be held while the execution row is opened —
    // release is the LAST thing that happens for this row's tick.
    expect(releaseIdx).toBe(h.calls.length - 1);
    expect(executionCreatedIdx).toBeLessThan(releaseIdx);
    expect(h.calls[0]).toBe('claim');
  });

  it('recomputes nextRunAt after a run', async () => {
    const original = new Date(Date.now() - 1_000);
    h.automationRepo.seed(scheduleAutomation({ nextRunAt: original }));

    await h.service.runSchedulerTick();
    await flush();

    const updated = await h.automationRepo.getById(AUTOMATION_ID);
    expect(updated.nextRunAt).toBeDefined();
    expect(updated.nextRunAt!.getTime()).toBeGreaterThan(original.getTime());
    expect(h.calls).toContain('update-nextRunAt');
  });

  it('missed-run policy "skip" does not run but recomputes forward and warns', async () => {
    // 20 minutes late against a 5-minute cron — several slots were missed
    // while "the server was down".
    const scheduledFor = new Date(Date.now() - 20 * 60 * 1000);
    h.automationRepo.seed(scheduleAutomation({ nextRunAt: scheduledFor, missedRunPolicy: 'skip' }));

    await h.service.runSchedulerTick();
    await flush();

    expect(h.createLog).toHaveLength(0); // nothing was actually run
    const updated = await h.automationRepo.getById(AUTOMATION_ID);
    expect(updated.nextRunAt).toBeDefined();
    expect(updated.nextRunAt!.getTime()).toBeGreaterThan(scheduledFor.getTime());

    const skipped = h.events.find((e) => e.kind === 'automation.schedule_skipped');
    expect(skipped).toBeDefined();
    const data = skipped!.data as { reason: string; missedCount?: number };
    expect(data.reason).toBe('missed');
    expect(data.missedCount).toBeGreaterThan(0);
  });

  it('overlap policy "skip" does not start a second run while one is active', async () => {
    // Due, but only just — no cron slots were missed, so this exercises
    // the overlap path in isolation from the missed-run path.
    h.automationRepo.seed(scheduleAutomation({ nextRunAt: new Date(Date.now() - 1_000), overlapPolicy: 'skip' }));
    await h.executionRepo.createExecution({
      id: 'exec-already-running',
      automationId: AUTOMATION_ID,
      status: 'running',
      triggeredBy: 'schedule',
      totalIterations: 1,
      completedIterations: 0,
      failedIterations: 0,
      createdAt: new Date(),
    } as AutomationExecution);
    h.calls.length = 0; // ignore the seed write above

    await h.service.runSchedulerTick();
    await flush();

    expect(h.createLog).toHaveLength(0); // no second run was dispatched

    const skipped = h.events.find((e) => e.kind === 'automation.schedule_skipped');
    expect(skipped).toBeDefined();
    expect((skipped!.data as { reason: string }).reason).toBe('overlap');
  });

  it('three-way status: mixed iteration outcomes settle as "partial", not "completed"', async () => {
    const mixed = setup((variables) => (variables['row'] === 'a' ? 'completed' : 'failed'));
    mixed.automationRepo.seed({
      id: 'auto-mixed',
      name: 'batch',
      enabled: true,
      triggerType: 'manual',
      workflowIds: ['wf-1'],
      dataSchema: { version: 1, format: 'json_array', fields: [{ name: 'row', type: 'string' }] },
      iterationMode: { kind: 'each_row' },
      defaultDataset: {
        format: 'json_array',
        data: JSON.stringify([{ row: 'a' }, { row: 'b' }]),
      },
      variables: {},
      maxConcurrency: 1,
      onError: 'continue',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Automation);

    const execution = await mixed.service.triggerManual('auto-mixed');
    await flush();

    const final = await mixed.executionRepo.getExecutionById(execution.id);
    expect(final.status).toBe('partial');
    expect(final.completedIterations).toBe(1);
    expect(final.failedIterations).toBe(1);

    const partialEvent = mixed.events.find((e) => e.kind === 'automation_execution.partial');
    expect(partialEvent).toBeDefined();
    const data = partialEvent!.data as { completedRuns: number; failedRuns: number };
    expect(data.completedRuns).toBe(1);
    expect(data.failedRuns).toBe(1);

    // Never emitted as a plain "completed" — that would silence the alert.
    expect(mixed.events.some((e) => e.kind === 'automation_execution.completed')).toBe(false);
  });
});
