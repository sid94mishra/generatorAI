// ────────────────────────────────────────────────────────────────
// createTestEngine — the whole workflow engine, in process, on a fake model.
//
// Boots the SAME service graph the server does (`createCoreServices`, the
// same Drizzle repositories, the same late wiring for result validation and
// workflow hooks) over an in-memory SQLite database migrated with the real
// `migrateDB`, and swaps the provider for `ScriptedFauxHarness`. A test then
// drives runs through `commands`, which mirror what the HTTP routes do today
// (`apps/server/src/routes/workflowRuns.ts`), and reads results back from
// the database with `snapshotRun`.
//
// What is deliberately NOT wired (the server has it; nothing in the
// characterisation suite reaches it, and each would pull in git, a browser
// or the network):
//   - WorkspaceManager / WorktreeService / checkpoints — runs use the
//     legacy directory fallback under `<workDir>/art/runs/<runId>`;
//   - AdmissionController — only the stage Semaphore bounds launches;
//   - BrowserService, agent services (AgentResolver / staging), MCP hub;
//   - the StreamBroker event store — the EventBus commits to the legacy
//     `events` table (its embedded/SDK path), and the testkit captures every
//     event in memory instead.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  createCoreServices,
  FetchHttpClient,
  GitManager,
  ResultValidator,
  SandboxedScriptRunner,
  type CoreServices,
} from '@generatorai/core';
import {
  createDB,
  closeDB,
  migrateDB,
  withTransaction,
  DrizzleSessionRepository,
  DrizzleEventRepository,
  DrizzleChatMessageRepository,
  DrizzleArtifactRepository,
  DrizzleWebhookRepository,
  DrizzleChatRepository,
  DrizzleWorkflowDefinitionRepository,
  DrizzleStageDefinitionRepository,
  DrizzleStageEdgeRepository,
  DrizzleWorkflowRunRepository,
  DrizzleStageRunRepository,
  DrizzleAutomationRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleIdempotencyKeyRepository,
  DrizzleSequenceAllocator,
  DrizzleSessionAllocationRepository,
  DrizzlePlanRepository,
  DrizzleAgentInteractionRepository,
  RegisterRepository,
  EntryRepository,
  type AppDatabase,
} from '@generatorai/db';
import {
  isStageReviewOutcome,
  type ChatMessage,
  type ILogger,
  type StageReviewOutcome,
  type StageRun,
  type WorkflowRun,
} from '@generatorai/shared';
import { RealClock, type TestClock } from './clock.js';
import {
  ScriptBook,
  ScriptedFauxHarness,
  type HarnessCall,
  type ScriptSource,
  type StageKey,
} from './harness.js';
import { toImportJson, type WorkflowSpecJson } from './definitions.js';

// ── Options ─────────────────────────────────────────────────────

/**
 * Service timing, scaled down from production so whole runs take
 * milliseconds. Every knob maps to a setter the services already expose.
 */
export interface TestEngineTiming {
  /** WorkflowRunService reconciler tick (prod 3000). */
  reconcileIntervalMs?: number;
  /** Stage heartbeat period (prod 10000). */
  heartbeatIntervalMs?: number;
  /** Stale after `heartbeatIntervalMs * staleMultiplier` (prod 3). */
  staleMultiplier?: number;
  /** Deadline for a waited prompt turn with no `timeoutMs` (prod 30 min). */
  defaultStageTimeoutMs?: number;
}

/**
 * `stage_runs.heartbeat_at` is stored with ONE-SECOND precision (drizzle
 * `mode: 'timestamp'`), so a stale window under ~1.5 s reaps healthy stages.
 * 200 ms × 10 = 2 s keeps a real margin while still letting a test provoke
 * the reaper (W-02) with a few seconds of backoff.
 */
export const DEFAULT_TIMING: Required<TestEngineTiming> = {
  reconcileIntervalMs: 20,
  heartbeatIntervalMs: 200,
  staleMultiplier: 10,
  defaultStageTimeoutMs: 60_000,
};

export interface TestEngineOptions {
  /** Per-stage model script (see `ScriptSource`). */
  script?: ScriptSource;
  /** Clock for scripted `delayMs` waits. Services still use real time. */
  clock?: TestClock;
  timing?: TestEngineTiming;
  /** Scratch directory for artifacts/workspaces. Default: a fresh temp dir. */
  workDir?: string;
  /** Stage Semaphore width (prod default 8). */
  maxConcurrentStages?: number;
  /** Wire `ResultValidator` like the server does. Default true. */
  resultValidation?: boolean;
}

// ── Captured state ──────────────────────────────────────────────

export interface CapturedEvent {
  seq: number;
  generation: number;
  /** Session id, or `'__global__'`. */
  sessionId: string;
  kind: string;
  data: Record<string, unknown>;
  at: number;
}

export interface LogLine {
  generation: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface StageSnapshot {
  name: string;
  status: StageRun['status'];
  retryCount: number;
  outputText?: string;
  summary?: string;
  error?: string;
  outputData?: Record<string, unknown>;
  interruptData?: unknown;
  sessionId?: string;
  row: StageRun;
  /** Chat messages carrying this stage run's id in their metadata. */
  messages: Array<Pick<ChatMessage, 'role' | 'content'> & { metadata?: Record<string, unknown> }>;
}

export interface RunSnapshot {
  run: WorkflowRun;
  stages: Record<string, StageSnapshot>;
  /** Stage names in creation (definition) order. */
  stageOrder: string[];
  /** Events whose payload names this run, in emission order. */
  events: CapturedEvent[];
  /** Harness calls made for this run's stages. */
  calls: HarnessCall[];
  /** Sessions owned by this run's stage runs. */
  sessions: Array<{ id: string; status: string; ownerId: string | null; closedAt: number | null }>;
}

export interface RunHandle {
  runId: string;
  definitionId: string;
  /** Stage definition ids by name. */
  stageIds: Record<string, string>;
  db: AppDatabase;
  /** Events for this run (live view). */
  readonly events: CapturedEvent[];
  /** Stage run id for a stage name. */
  stageRunId(name: string): string;
  /** Resolve once the run is completed / failed / cancelled. */
  waitForTerminal(timeoutMs?: number): Promise<RunSnapshot>;
  /** Resolve once `predicate(snapshot)` holds. */
  waitFor(predicate: (snap: RunSnapshot) => boolean, timeoutMs?: number, label?: string): Promise<RunSnapshot>;
  /** Resolve once the named stage reaches one of `statuses`. */
  waitForStage(name: string, statuses: StageRun['status'] | StageRun['status'][], timeoutMs?: number): Promise<RunSnapshot>;
  snapshot(): Promise<RunSnapshot>;
}

export interface ApproveBody {
  approved?: boolean;
  outcome?: StageReviewOutcome;
  value?: unknown;
  reason?: string;
  followUpPrompt?: string;
}

/** What the run routes do today, one method per route. */
export interface RunCommands {
  start(runId: string): Promise<void>;
  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  /** `POST /workflow-runs/:id/retry` — returns the NEW run id. */
  retryRun(runId: string): Promise<string>;
  /** `POST /workflow-runs/:runId/stages/:stageId/retry`. */
  retryStage(runId: string, stageRunId: string): Promise<void>;
  /** `POST /workflow-runs/:runId/stages/:stageId/approve`. */
  approve(runId: string, stageRunId: string, body?: ApproveBody): Promise<{ status: number; body: unknown }>;
}

export interface RestartOptions {
  /** Run `StartupRecoveryService.recover()` on the new generation. Default true. */
  recover?: boolean;
  /**
   * Rehydrate `SessionAllocator` BEFORE `recover()`. `recover()` itself
   * re-drives runs (step 2) before it rehydrates the allocator (step 4); a
   * relaunched stage that reaches `allocateSession` first inserts a second
   * `session_allocations` row and fails on its UNIQUE key (W-32). On the
   * live server the relaunch first spends ~2.5 s in the workspace checkpoint
   * capture, so the allocator usually wins; this flag stands in for that
   * latency, which the testkit does not have. Default false (the code's order).
   */
  allocatorFirst?: boolean;
}

export interface TestEngine {
  readonly db: AppDatabase;
  readonly sqlite: Database.Database;
  readonly workDir: string;
  readonly clock: TestClock;
  readonly book: ScriptBook;
  /** Every harness call across generations. */
  readonly calls: HarnessCall[];
  /** Every event across generations. */
  readonly events: CapturedEvent[];
  readonly logs: LogLine[];
  /** Current process generation (0 at boot, +1 per `killAndRestart`). */
  readonly generation: number;
  readonly services: CoreServices;
  readonly harness: ScriptedFauxHarness;
  readonly commands: RunCommands;
  /** Create a definition through the import-json path. */
  importDefinition(spec: WorkflowSpecJson): Promise<{ definitionId: string; stageIds: Record<string, string> }>;
  /**
   * Import `definition` (or reuse `{definitionId}`), create a run with
   * `variables` and start it the way `POST /:id/start` does (fire and
   * forget). Pass `{start: false}` to only create it.
   */
  runWorkflow(
    definition: WorkflowSpecJson | { definitionId: string },
    variables?: Record<string, unknown>,
    opts?: { start?: boolean },
  ): Promise<RunHandle>;
  handle(runId: string): Promise<RunHandle>;
  snapshotRun(runId: string): Promise<RunSnapshot>;
  /**
   * Simulate a crash and a reboot on the same database: the current
   * generation's harness dies (its in-flight turns never settle), its
   * reconciler and heartbeat timers stop, and a fresh service graph is built
   * over the same DB. With `recover` (default) the new generation runs
   * `StartupRecoveryService.recover()` exactly as the server does at boot.
   */
  killAndRestart(opts?: RestartOptions): Promise<void>;
  /** Let pending async work land (a few reconcile ticks). */
  settle(ms?: number): Promise<void>;
  dispose(): Promise<void>;
}

// ── Internals ───────────────────────────────────────────────────

interface Generation {
  n: number;
  services: CoreServices;
  harness: ScriptedFauxHarness;
  unsubscribe: Array<() => void>;
}

const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);

function captureLogger(logs: LogLine[], generation: () => number): ILogger {
  const push = (level: LogLine['level']) => (message: string) => {
    logs.push({ generation: generation(), level, message: String(message) });
  };
  return {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  } as unknown as ILogger;
}

function rawSqlite(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

export async function createTestEngine(opts: TestEngineOptions = {}): Promise<TestEngine> {
  const timing = { ...DEFAULT_TIMING, ...(opts.timing ?? {}) };
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), 'gai-wftk-'));
  const ownsWorkDir = !opts.workDir;
  const clock = opts.clock ?? new RealClock();
  const book = new ScriptBook(opts.script);
  const calls: HarnessCall[] = [];
  const events: CapturedEvent[] = [];
  const logs: LogLine[] = [];
  let eventSeq = 0;

  const db = createDB(':memory:');
  migrateDB(db);
  const sqlite = rawSqlite(db);

  const stageByConversation = sqlite.prepare(`
    SELECT sr.id AS id, sr.name AS name, sr.workflow_run_id AS runId
      FROM sessions s JOIN stage_runs sr ON sr.session_id = s.id
     WHERE s.conversation_id = ?
     ORDER BY CASE sr.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'awaiting_input' THEN 2 ELSE 3 END,
              COALESCE(sr.started_at, 0) DESC
     LIMIT 1`);
  const stageById = sqlite.prepare(
    `SELECT id, name, workflow_run_id AS runId FROM stage_runs WHERE id = ?`,
  );

  /** The stage run speaking through a conversation right now. */
  const resolveStage = (conversationId: string): StageKey => {
    let row = stageByConversation.get(conversationId) as { id: string; name: string; runId: string } | undefined;
    if (!row) {
      // Allocation creates the conversation before the stage row points at
      // its session; the id is embedded in `stage-<stageRunId>-<ts>`.
      const m = /^stage-(.+)-\d+$/.exec(conversationId);
      if (m) row = stageById.get(m[1]) as typeof row;
    }
    return row
      ? { stageName: row.name, stageRunId: row.id, workflowRunId: row.runId, conversationId }
      : { stageName: conversationId, stageRunId: conversationId, workflowRunId: '', conversationId };
  };

  let current!: Generation;

  const boot = (n: number): Generation => {
    const logger = captureLogger(logs, () => n);
    const harness = new ScriptedFauxHarness({ book, resolveStage, clock, calls, generation: n });
    const scriptRunner = new SandboxedScriptRunner(logger);
    const gitManager = new GitManager(scriptRunner, logger, { workspacesDir: join(workDir, 'ws') });

    const chatMessageRepo = new DrizzleChatMessageRepository(db);
    const stageRunRepo = new DrizzleStageRunRepository(db);
    const services = createCoreServices({
      logger,
      harness,
      scriptRunner,
      httpClient: new FetchHttpClient(),
      gitManager,
      sequenceAllocator: new DrizzleSequenceAllocator(db),
      sessionRepo: new DrizzleSessionRepository(db),
      eventRepo: new DrizzleEventRepository(db),
      chatMessageRepo,
      artifactRepo: new DrizzleArtifactRepository(db),
      webhookRepo: new DrizzleWebhookRepository(db),
      chatEntityRepo: new DrizzleChatRepository(db),
      workflowDefinitionRepo: new DrizzleWorkflowDefinitionRepository(db),
      stageDefinitionRepo: new DrizzleStageDefinitionRepository(db),
      stageEdgeRepo: new DrizzleStageEdgeRepository(db),
      workflowRunRepo: new DrizzleWorkflowRunRepository(db),
      stageRunRepo,
      automationRepo: new DrizzleAutomationRepository(db),
      automationExecutionRepo: new DrizzleAutomationExecutionRepository(db),
      idempotencyKeyRepo: new DrizzleIdempotencyKeyRepository(db),
      registerRepo: new RegisterRepository(db),
      entryRepo: new EntryRepository(db),
      sessionAllocationRepo: new DrizzleSessionAllocationRepository(db),
      config: {
        artifactsDir: join(workDir, 'art'),
        maxConcurrentSessions: 100,
        ...(opts.maxConcurrentStages !== undefined ? { maxConcurrentStages: opts.maxConcurrentStages } : {}),
        webhooks: {},
      },
      withTransaction: (fn) => withTransaction(db, fn),
      chatExtensions: {},
      planRepo: new DrizzlePlanRepository(db),
      agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    });

    // Late wiring the server's composition root does for workflows.
    const { workflowRunService, stageExecutionService, hookExecutor, eventBus } = services;
    workflowRunService.setHookExecutor(hookExecutor);
    if (opts.resultValidation !== false) {
      workflowRunService.setResultValidator(
        new ResultValidator(chatMessageRepo, stageRunRepo, eventBus, logger, scriptRunner),
      );
    }
    workflowRunService.setHeartbeatPolicy({
      heartbeatIntervalMs: timing.heartbeatIntervalMs,
      staleMultiplier: timing.staleMultiplier,
      reconcileIntervalMs: timing.reconcileIntervalMs,
    });
    stageExecutionService.setHeartbeatIntervalMs(timing.heartbeatIntervalMs);
    stageExecutionService.setDefaultStageTimeoutMs(timing.defaultStageTimeoutMs);

    const record = (e: { sessionId: string; kind: string; data: unknown }): void => {
      events.push({
        seq: ++eventSeq,
        generation: n,
        sessionId: e.sessionId,
        kind: e.kind,
        data: (e.data ?? {}) as Record<string, unknown>,
        at: Date.now(),
      });
    };
    const unsubscribe = [eventBus.subscribeAll(record, 'workflow-testkit'), eventBus.subscribeGlobal(record)];
    return { n, services, harness, unsubscribe };
  };

  /** Stop everything a generation owns that would otherwise keep running. */
  const halt = (gen: Generation): void => {
    gen.harness.kill();
    gen.services.workflowRunService.shutdown();
    // Heartbeat timers belong to executor frames that never reach their
    // `finally` once the harness is dead; a real crash takes them with the
    // process, so do the same here.
    const beats = (gen.services.stageExecutionService as unknown as {
      activeHeartbeats?: Map<string, ReturnType<typeof setInterval>>;
    }).activeHeartbeats;
    if (beats) {
      for (const t of beats.values()) clearInterval(t);
      beats.clear();
    }
    gen.services.agentInteractionService?.dispose();
    gen.services.automationService.shutdown();
    for (const off of gen.unsubscribe) off();
  };

  current = boot(0);

  const snapshotRun = async (runId: string): Promise<RunSnapshot> => {
    const { services } = current;
    const run = await new DrizzleWorkflowRunRepository(db).getById(runId);
    const stageRows = await new DrizzleStageRunRepository(db).getByRunId(runId);
    // Definition order (`stage_definitions.order`), not creation time: the
    // rows of one run share a created_at second.
    const orderRows = sqlite
      .prepare(`SELECT id, "order" AS o FROM stage_definitions WHERE workflow_definition_id = ?`)
      .all(run.workflowDefinitionId) as Array<{ id: string; o: number }>;
    const orderOf = new Map(orderRows.map((r) => [r.id, r.o]));
    stageRows.sort(
      (a, b) =>
        (orderOf.get(a.stageDefinitionId) ?? 0) - (orderOf.get(b.stageDefinitionId) ?? 0) || a.name.localeCompare(b.name),
    );
    const stageIdSet = new Set(stageRows.map((s) => s.id));
    const msgRows = sqlite
      .prepare(
        `SELECT m.role, m.content, m.metadata FROM chat_messages m
           JOIN sessions s ON s.id = m.session_id
          WHERE s.owner_type = 'stage_run' AND s.owner_id IN (SELECT id FROM stage_runs WHERE workflow_run_id = ?)
          ORDER BY m.timestamp, m.rowid`,
      )
      .all(runId) as Array<{ role: string; content: string; metadata: string | null }>;
    const byStage = new Map<string, StageSnapshot['messages']>();
    for (const m of msgRows) {
      const metadata = m.metadata ? (JSON.parse(m.metadata) as Record<string, unknown>) : undefined;
      const sid = typeof metadata?.['stageRunId'] === 'string' ? (metadata['stageRunId'] as string) : '';
      if (!stageIdSet.has(sid)) continue;
      const list = byStage.get(sid) ?? [];
      list.push({ role: m.role as ChatMessage['role'], content: m.content, ...(metadata ? { metadata } : {}) });
      byStage.set(sid, list);
    }
    const sessions = sqlite
      .prepare(
        `SELECT id, status, owner_id AS ownerId, closed_at AS closedAt FROM sessions
          WHERE owner_type = 'stage_run' AND owner_id IN (SELECT id FROM stage_runs WHERE workflow_run_id = ?)
          ORDER BY created_at, id`,
      )
      .all(runId) as RunSnapshot['sessions'];
    void services;

    const stages: Record<string, StageSnapshot> = {};
    for (const sr of stageRows) {
      stages[sr.name] = {
        name: sr.name,
        status: sr.status,
        retryCount: sr.retryCount,
        ...(sr.outputText !== undefined && sr.outputText !== null ? { outputText: sr.outputText } : {}),
        ...(sr.summary !== undefined && sr.summary !== null ? { summary: sr.summary } : {}),
        ...(sr.error ? { error: sr.error } : {}),
        ...(sr.outputData ? { outputData: sr.outputData } : {}),
        ...(sr.interruptData !== undefined && sr.interruptData !== null ? { interruptData: sr.interruptData } : {}),
        ...(sr.sessionId ? { sessionId: sr.sessionId } : {}),
        row: sr,
        messages: byStage.get(sr.id) ?? [],
      };
    }
    return {
      run,
      stages,
      stageOrder: stageRows.map((s) => s.name),
      events: events.filter((e) => e.data['workflowRunId'] === runId),
      calls: calls.filter((c) => stageIdSet.has(c.stageRunId)),
      sessions,
    };
  };

  const poll = async (
    runId: string,
    predicate: (s: RunSnapshot) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<RunSnapshot> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snap = await snapshotRun(runId);
      if (predicate(snap)) return snap;
      if (Date.now() > deadline) {
        const stages = snap.stageOrder.map((n) => `${n}=${snap.stages[n]!.status}`).join(' ');
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}; run=${snap.run.status} ${stages}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  const makeHandle = async (runId: string): Promise<RunHandle> => {
    const run = await new DrizzleWorkflowRunRepository(db).getById(runId);
    const stageIds: Record<string, string> = {};
    for (const s of await new DrizzleStageDefinitionRepository(db).getByDefinitionId(run.workflowDefinitionId)) {
      stageIds[s.name] = s.id;
    }
    return {
      runId,
      definitionId: run.workflowDefinitionId,
      stageIds,
      db,
      get events() {
        return events.filter((e) => e.data['workflowRunId'] === runId);
      },
      stageRunId(name: string): string {
        const row = sqlite
          .prepare(`SELECT id FROM stage_runs WHERE workflow_run_id = ? AND name = ? ORDER BY created_at LIMIT 1`)
          .get(runId, name) as { id: string } | undefined;
        if (!row) throw new Error(`run ${runId} has no stage named "${name}"`);
        return row.id;
      },
      waitForTerminal: (timeoutMs = 15_000) =>
        poll(runId, (s) => TERMINAL_RUN.has(s.run.status), timeoutMs, 'a terminal run status'),
      waitFor: (predicate, timeoutMs = 15_000, label = 'predicate') => poll(runId, predicate, timeoutMs, label),
      waitForStage: (name, statuses, timeoutMs = 15_000) => {
        const want = Array.isArray(statuses) ? statuses : [statuses];
        return poll(
          runId,
          (s) => !!s.stages[name] && want.includes(s.stages[name]!.status),
          timeoutMs,
          `stage ${name} in [${want.join(', ')}]`,
        );
      },
      snapshot: () => snapshotRun(runId),
    };
  };

  const importDefinition: TestEngine['importDefinition'] = async (spec) => {
    const doc = toImportJson(spec);
    const def = await current.services.workflowDefinitionService.importFromJSON(doc);
    const stageIds: Record<string, string> = {};
    for (const s of def.stages) stageIds[s.name] = s.id;
    return { definitionId: def.id, stageIds };
  };

  const commands: RunCommands = {
    async start(runId) {
      // `POST /:id/start` answers 202 and lets the run go.
      current.services.workflowRunService.startRun(runId).catch((err: unknown) => {
        logs.push({ generation: current.n, level: 'error', message: `startRun failed: ${String(err)}` });
      });
    },
    pause: (runId) => current.services.workflowRunService.pauseRun(runId),
    resume: (runId) => current.services.workflowRunService.resumeRun(runId),
    cancel: (runId) => current.services.workflowRunService.cancelRun(runId),
    async retryRun(runId) {
      const retried = await current.services.workflowRunService.retryRun(runId);
      current.services.workflowRunService.startRun(retried.id).catch(() => undefined);
      return retried.id;
    },
    async retryStage(runId, stageRunId) {
      const stageRunRepo = new DrizzleStageRunRepository(db);
      const run = await new DrizzleWorkflowRunRepository(db).getById(runId);
      await stageRunRepo.resetForRetry(stageRunId);
      await stageRunRepo.incrementRetryCount(stageRunId);
      const stageRun = await stageRunRepo.getById(stageRunId);
      const { stageExecutionService, workflowRunService } = current.services;
      stageExecutionService
        .executeStage(stageRun, runId, run.sessionMode)
        .then(() => workflowRunService.onStageCompleted(runId, stageRunId))
        .catch((err) => workflowRunService.onStageFailed(runId, stageRunId, err));
    },
    async approve(runId, stageRunId, body = {}) {
      const { hitlService, stageExecutionService } = current.services;
      const outcome: StageReviewOutcome = isStageReviewOutcome(body.outcome)
        ? body.outcome
        : body.approved === false
          ? 'changes_requested'
          : 'approved';
      const approved = outcome === 'approved';
      const followUpPrompt =
        typeof body.followUpPrompt === 'string' && body.followUpPrompt.trim().length > 0
          ? body.followUpPrompt.trim()
          : undefined;
      let isCompletionReview = false;
      try {
        const row = (await hitlService.listPending(runId)).find((r) => r.id === stageRunId);
        isCompletionReview =
          (row?.interruptData as { kind?: unknown } | undefined)?.kind === 'stage_completion_review';
      } catch {
        /* same fallthrough as the route */
      }
      if (!isCompletionReview && approved && followUpPrompt) stageExecutionService.markFollowUpPending(stageRunId);
      const result = await hitlService.resume(stageRunId, runId, {
        approved,
        outcome,
        value: followUpPrompt ? { followUpPrompt } : body.value,
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      });
      if (!result.ok) {
        return {
          status: 409,
          body: { error: { code: 'STAGE_NOT_AWAITING_INPUT', message: result.reason ?? 'Stage was not awaiting_input' } },
        };
      }
      if (!isCompletionReview && approved && followUpPrompt) {
        void stageExecutionService.sendStageFollowUp(stageRunId, runId, followUpPrompt).catch(() => undefined);
      }
      return { status: 202, body: { stageId: stageRunId, outcome, approved, followUp: !!followUpPrompt } };
    },
  };

  const engine: TestEngine = {
    db,
    sqlite,
    workDir,
    clock,
    book,
    calls,
    events,
    logs,
    get generation() {
      return current.n;
    },
    get services() {
      return current.services;
    },
    get harness() {
      return current.harness;
    },
    commands,
    importDefinition,
    async runWorkflow(definition, variables = {}, runOpts = {}) {
      const definitionId =
        'definitionId' in definition && typeof definition.definitionId === 'string'
          ? definition.definitionId
          : (await importDefinition(definition as WorkflowSpecJson)).definitionId;
      const run = await current.services.workflowRunService.createRun({ workflowDefinitionId: definitionId, variables });
      if (runOpts.start !== false) await commands.start(run.id);
      return makeHandle(run.id);
    },
    handle: makeHandle,
    snapshotRun,
    async killAndRestart(restartOpts = {}) {
      halt(current);
      current = boot(current.n + 1);
      if (restartOpts.allocatorFirst) await current.services.sessionAllocator.rehydrate();
      if (restartOpts.recover !== false) await current.services.recoveryService.recover();
    },
    async settle(ms = timing.reconcileIntervalMs * 5) {
      await new Promise((r) => setTimeout(r, ms));
    },
    async dispose() {
      halt(current);
      await current.services.eventBus.flush().catch(() => undefined);
      try {
        closeDB(db);
      } catch {
        /* already closed */
      }
      if (ownsWorkDir) {
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* Windows handle release race; the vitest teardown sweeps gai-* dirs */
        }
      }
    },
  };
  return engine;
}
