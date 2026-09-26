// ────────────────────────────────────────────────────────────────
// The engine adapter (P03, P00 review R20): whole runs on the engine of
// `@generatorai/core` — the `RunSupervisor` / `RunActor` / `StageExecutor`
// that `createCoreServices` builds, as the server does — over an in-memory
// database and a scripted fake model.
//
// What is engine-specific, all of it here:
//   - the engine is `services.engine` over `createEngineStores(db)`, with the
//     admission controller as its only concurrency gate; each generation
//     has its own boot id, and a crash leaves the engine lock behind (the
//     next generation waits for it to go stale, as a real restart would);
//   - runs are created by `WorkflowRunService.createRun` (the create path
//     until P04) and started with `startRun`; a run retry is `forkRun`;
//   - operator commands are `RunCommand`s (the commands API);
//   - instances are addressed by `instance_path` (a stage KEY at the top
//     level), snapshots read the v57 tables raw (v2 statuses, attempts,
//     `turn_role`);
//   - conversations resolve to the instance speaking through them via
//     `stage_runs.session_id`; turns are classified by `turn_role`.
// ────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { harnessErrorOf } from '@generatorai/agent-harness-providers';
import {
  AdmissionController,
  InMemoryMcpHub,
  McpCredentialVault,
  RunCommandRefusedError,
  createCoreServices,
  FetchHttpClient,
  GitManager,
  SandboxedScriptRunner,
  WorkspaceManager,
  type CoreServices,
  type InvocationContext,
  type DecideRecord,
  type RunSupervisor,
  type SupervisorTiming,
} from '@generatorai/core';
import {
  DrizzleSessionRepository,
  DrizzleEventRepository,
  DrizzleChatMessageRepository,
  DrizzleArtifactRepository,
  DrizzleChatRepository,
  SqliteWorkflowDefinitionStore,
  DrizzleWorkflowRunRepository,
  DrizzleStageRunRepository,
  DrizzleAutomationRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleIdempotencyKeyRepository,
  DrizzleSequenceAllocator,
  DrizzlePlanRepository,
  DrizzleAgentInteractionRepository,
  DrizzleExecutionWorkspaceRepository,
  DrizzleWorkspaceMountRepository,
  DrizzleWorkspaceArtifactRepository,
  DrizzleWorktreeRepository,
  RegisterRepository,
  EntryRepository,
  createEngineStores,
} from '@generatorai/db';
import type { ChatMessage, ILogger, StageRun, WorkflowRun } from '@generatorai/shared';
import type { RunCommand as SpecRunCommand } from '@generatorai/workflow-spec';
import { ScriptedFauxHarness, classifyPrompt, type StageKey, type TurnKind } from '../harness.js';
import { toGraph } from '../definitions.js';
import type { AdapterContext, AdapterFactory, CommandResult, EngineAdapter, LogLine, RunCommand, RunSnapshot, StageSnapshot } from '../types.js';


/** The testkit starts runs as the local owner through the one invocation path. */
const TESTKIT_INVOCATION: InvocationContext = {
  principal: { kind: 'local', id: 'testkit', scopes: ['exec:agent', 'read:workflows', 'write:workflows', 'admin:settings'] },
  trigger: { kind: 'user', client: 'testkit', principalId: 'testkit' },
  loopback: true,
};
export interface V2AdapterOptions {
  /** Every committed decision batch (replay fixtures, G5 §7.3). */
  onDecide?: (r: DecideRecord) => void;
  /** Supervisor timing (defaults scaled for tests). */
  timing?: Partial<SupervisorTiming>;
}

interface Generation {
  n: number;
  services: CoreServices;
  harness: ScriptedFauxHarness;
  supervisor: RunSupervisor;
  unsubscribe: Array<() => void>;
}

const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);

function captureLogger(logs: LogLine[], generation: number): ILogger {
  const push = (level: LogLine['level']) => (message: string) => {
    logs.push({ generation, level, message: String(message) });
  };
  return { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } as unknown as ILogger;
}

type Row = Record<string, unknown>;
const parse = (v: unknown): unknown => {
  if (typeof v !== 'string') return v ?? undefined;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
};

/** A v2 adapter factory with options (`createV2Adapter` is the default one). */
export function v2Adapter(opts: V2AdapterOptions = {}): AdapterFactory {
  return (ctx) => buildV2Adapter(ctx, opts);
}

export const createV2Adapter: AdapterFactory = (ctx) => buildV2Adapter(ctx, {});

function buildV2Adapter(ctx: AdapterContext, opts: V2AdapterOptions): EngineAdapter {
  const { db, sqlite, workDir, clock, book, calls, events, logs } = ctx;
  const timing: SupervisorTiming = {
    lockStaleMs: ctx.timing.lockStaleMs,
    lockRenewMs: ctx.timing.lockRenewMs,
    ownershipTtlMs: ctx.timing.ownershipTtlMs,
    reaperEveryMs: ctx.timing.reaperEveryMs,
    ...(opts.timing ?? {}),
  };
  let eventSeq = 0;

  const byConversation = sqlite.prepare(`
    SELECT sr.id AS id, sr.name AS name, sr.workflow_run_id AS runId
      FROM sessions s JOIN stage_runs sr ON sr.session_id = s.id
     WHERE s.conversation_id = ?
     ORDER BY CASE WHEN sr.status IN ('starting', 'running', 'validating', 'awaiting_input') THEN 0 ELSE 1 END, sr.updated_at DESC
     LIMIT 1`);
  const byId = sqlite.prepare(`SELECT id, name, workflow_run_id AS runId FROM stage_runs WHERE id = ?`);
  const turnRoleOf = sqlite.prepare(`
    SELECT m.turn_role AS role FROM chat_messages m JOIN sessions s ON s.id = m.session_id
     WHERE s.conversation_id = ? AND m.role = 'user' AND m.content = ?
     ORDER BY m.rowid DESC LIMIT 1`);

  const resolveStage = (conversationId: string): StageKey => {
    let row = byConversation.get(conversationId) as { id: string; name: string; runId: string } | undefined;
    if (!row) {
      // The first turn can race the `starting → running` write that records the session.
      const m = /^stage-(.+)-\d+$/.exec(conversationId);
      if (m) row = byId.get(m[1]) as typeof row;
    }
    return row
      ? { stageName: row.name, stageRunId: row.id, workflowRunId: row.runId, conversationId }
      : { stageName: conversationId, stageRunId: conversationId, workflowRunId: '', conversationId };
  };

  const classifyTurn = (conversationId: string, prompt: string): TurnKind => {
    const row = turnRoleOf.get(conversationId, prompt) as { role: string | null } | undefined;
    switch (row?.role) {
      case 'prompt':
        return prompt.startsWith('The previous request for this step was interrupted') ? 'continuation' : 'prompt';
      case 'repair':
        return 'repair';
      case 'summary':
        return 'summary';
      case 'approval_feedback':
        return 'approval_feedback';
      case 'context':
        return 'context';
      default:
        return classifyPrompt(prompt);
    }
  };

  const boot = (n: number): Generation => {
    const logger = captureLogger(logs, n);
    const harness = new ScriptedFauxHarness({ book, resolveStage, classify: classifyTurn, clock, calls, generation: n });
    const scriptRunner = new SandboxedScriptRunner(logger);
    const gitManager = new GitManager(scriptRunner, logger, { workspacesDir: join(workDir, 'ws') });
    const sessionRepo = new DrizzleSessionRepository(db);
    const workflowRunRepo = new DrizzleWorkflowRunRepository(db);
    const workspaceManager = new WorkspaceManager(
      new DrizzleExecutionWorkspaceRepository(db),
      new DrizzleWorkspaceMountRepository(db),
      new DrizzleWorkspaceArtifactRepository(db),
      { workspacesDir: join(workDir, 'ws'), defaultGitEnabled: false },
      logger,
      gitManager,
      new DrizzleWorktreeRepository(db),
    );
    const admission = new AdmissionController(ctx.maxConcurrentStages !== undefined ? { flowLimits: { global: ctx.maxConcurrentStages } } : {});
    const services = createCoreServices({
      logger,
      harness,
      scriptRunner,
      httpClient: new FetchHttpClient(),
      gitManager,
      sequenceAllocator: new DrizzleSequenceAllocator(db),
      sessionRepo,
      eventRepo: new DrizzleEventRepository(db),
      chatMessageRepo: new DrizzleChatMessageRepository(db),
      artifactRepo: new DrizzleArtifactRepository(db),
      chatEntityRepo: new DrizzleChatRepository(db),
      workflowDefinitionStore: new SqliteWorkflowDefinitionStore(db),
      workflowRunRepo,
      stageRunRepo: new DrizzleStageRunRepository(db),
      automationRepo: new DrizzleAutomationRepository(db),
      automationExecutionRepo: new DrizzleAutomationExecutionRepository(db),
      idempotencyKeyRepo: new DrizzleIdempotencyKeyRepository(db),
      registerRepo: new RegisterRepository(db),
      entryRepo: new EntryRepository(db),
      engineStores: createEngineStores(db),
      toHarnessError: harnessErrorOf,
      engineOwnerLabel: `testkit-gen-${n}`,
      engineTiming: timing,
      ...(opts.onDecide ? { engineOnDecide: opts.onDecide } : {}),
      workspaceManager,
      admissionController: admission,
      scmFlow: {
        run: async () => {
          throw new Error('testkit: source-control post-processing is not wired');
        },
      },
      config: { artifactsDir: join(workDir, 'art') },
      chatExtensions: ctx.secrets ? { mcpHub: secretsHub(ctx.secrets) } : {},
      planRepo: new DrizzlePlanRepository(db),
      agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    });

    const supervisor = services.engine;

    const record = (e: { sessionId: string; kind: string; data: unknown }): void => {
      events.push({ seq: ++eventSeq, generation: n, sessionId: e.sessionId, kind: e.kind, data: (e.data ?? {}) as Record<string, unknown>, at: Date.now() });
    };
    const unsubscribe = [services.eventBus.subscribeAll(record, 'workflow-testkit'), services.eventBus.subscribeGlobal(record)];
    return { n, services, harness, supervisor, unsubscribe };
  };

  /** A crash: the harness dies (in-flight turns never settle), timers stop, the lock stays behind. */
  const halt = async (gen: Generation): Promise<void> => {
    gen.harness.kill();
    gen.supervisor.executor.kill();
    await gen.supervisor.stop({ releaseLock: false });
    gen.services.agentInteractionService?.dispose();
    gen.services.automationService.shutdown();
    for (const off of gen.unsubscribe) off();
  };

  let current = boot(0);
  let started: Promise<void> = current.supervisor.start();

  const stageRows = (runId: string): Row[] =>
    sqlite.prepare(`SELECT * FROM stage_runs WHERE workflow_run_id = ? ORDER BY instance_path`).all(runId) as Row[];

  const snapshot = async (runId: string): Promise<RunSnapshot> => {
    await started;
    const r = sqlite.prepare(`SELECT id, definition_version_id FROM workflow_runs WHERE id = ?`).get(runId) as Row | undefined;
    if (!r) throw new Error(`no run ${runId}`);
    const run: WorkflowRun = await new DrizzleWorkflowRunRepository(db).getById(runId);
    const graph = await current.services.runDefinitionReader.get(r['definition_version_id'] as string);
    const order = new Map(graph.stages.map((s, i) => [s.key, i]));
    const rows = stageRows(runId).sort(
      (a, b) => (order.get(a['stage_key'] as string) ?? 0) - (order.get(b['stage_key'] as string) ?? 0) || String(a['instance_path']).localeCompare(String(b['instance_path'])),
    );
    const ids = new Set(rows.map((s) => s['id'] as string));
    const msgRows = sqlite
      .prepare(
        `SELECT m.role, m.content, m.metadata, m.turn_role, m.complete FROM chat_messages m JOIN sessions s ON s.id = m.session_id
          WHERE s.owner_type = 'stage_run' AND s.owner_id IN (SELECT id FROM stage_runs WHERE workflow_run_id = ?)
          ORDER BY m.rowid`,
      )
      .all(runId) as Row[];
    const byStage = new Map<string, StageSnapshot['messages']>();
    for (const m of msgRows) {
      const metadata = parse(m['metadata']) as Record<string, unknown> | undefined;
      const sid = typeof metadata?.['stageRunId'] === 'string' ? (metadata['stageRunId'] as string) : '';
      if (!ids.has(sid)) continue;
      const list = byStage.get(sid) ?? [];
      list.push({
        role: m['role'] as ChatMessage['role'],
        content: m['content'] as string,
        ...(metadata ? { metadata } : {}),
        ...(m['turn_role'] ? { turnRole: m['turn_role'] as string } : {}),
        complete: m['complete'] === 1,
      });
      byStage.set(sid, list);
    }
    const attemptsOf = sqlite.prepare(
      `SELECT attempt_no, mode, status, error_code, repair_count, session_id FROM stage_attempts WHERE stage_run_id = ? ORDER BY attempt_no`,
    );
    const stages: Record<string, StageSnapshot> = {};
    for (const s of rows) {
      const id = s['id'] as string;
      const attempts = (attemptsOf.all(id) as Row[]).map((a) => ({
        attemptNo: a['attempt_no'] as number,
        mode: a['mode'] as string,
        status: a['status'] as string,
        errorCode: (a['error_code'] as string | null) ?? null,
        repairCount: a['repair_count'] as number,
        sessionId: (a['session_id'] as string | null) ?? null,
      }));
      const outputData = parse(s['output_data']);
      const path = s['instance_path'] as string;
      stages[path] = {
        instancePath: path,
        name: s['name'] as string,
        status: s['status'] as StageRun['status'],
        retryCount: attempts.filter((a) => a.status === 'failed' || a.status === 'interrupted').length,
        ...(s['output_text'] !== null && s['output_text'] !== undefined ? { outputText: s['output_text'] as string } : {}),
        ...(s['summary'] ? { summary: s['summary'] as string } : {}),
        ...(s['error'] ? { error: s['error'] as string } : {}),
        ...(outputData !== undefined && outputData !== null ? { outputData: outputData as Record<string, unknown> } : {}),
        ...(s['interrupt_data'] ? { interruptData: parse(s['interrupt_data']) } : {}),
        ...(s['session_id'] ? { sessionId: s['session_id'] as string } : {}),
        row: { ...s, status: s['status'] } as unknown as StageRun,
        messages: byStage.get(id) ?? [],
        attempts,
        statusReason: (s['status_reason'] as string | null) ?? null,
      };
    }
    const sessions = sqlite
      .prepare(
        `SELECT id, status, owner_id AS ownerId, closed_at AS closedAt FROM sessions
          WHERE owner_type = 'stage_run' AND owner_id IN (SELECT id FROM stage_runs WHERE workflow_run_id = ?)
          ORDER BY created_at, id`,
      )
      .all(runId) as RunSnapshot['sessions'];
    return {
      run,
      stages,
      instanceOrder: rows.map((s) => s['instance_path'] as string),
      events: events.filter((e) => e.data['workflowRunId'] === runId),
      calls: calls.filter((c) => ids.has(c.stageRunId)),
      sessions,
    };
  };

  /** The commands API's answer (`POST /workflow-runs/:id/commands`). */
  const toHttp = (r: Awaited<ReturnType<RunSupervisor['command']>>): CommandResult => {
    if (r.ok) return { status: 202 };
    return { status: new RunCommandRefusedError(r).httpStatus, body: { error: { code: r.code, message: r.message } } };
  };

  const command = async (runId: string, cmd: RunCommand): Promise<CommandResult> => {
    await started;
    const sup = current.supervisor;
    const send = async (c: SpecRunCommand) => toHttp(await sup.command(runId, c));
    switch (cmd.type) {
      case 'start':
        try {
          await current.services.workflowRunService.startRun(runId);
          return { status: 202 };
        } catch (err) {
          return errorResult(err);
        }
      case 'pause':
        return send({ command: 'pause', mode: 'interrupt' });
      case 'resume':
        return send({ command: 'resume' });
      case 'cancel':
        return send({ command: 'cancel' });
      case 'retry-stage':
        return send({ command: 'retry', instanceId: cmd.stageRunId, mode: 'resume' });
      case 'approve': {
        const b = cmd.body ?? {};
        const outcome = b.outcome;
        if (outcome !== 'approved' && outcome !== 'rejected' && outcome !== 'changes_requested') {
          return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'outcome is required' } } };
        }
        const feedback = b.reason;
        const data = b.value && typeof b.value === 'object' && !Array.isArray(b.value) ? (b.value as Record<string, unknown>) : undefined;
        return send({ command: 'approve', instanceId: cmd.stageRunId, outcome, ...(feedback ? { feedback } : {}), ...(data ? { data } : {}) });
      }
      case 'command':
        return send(cmd.command as unknown as SpecRunCommand);
      case 'retry-run':
        try {
          // A re-run is an invocation with a fork target (P04).
          const req = cmd.request ?? {};
          const result = await current.services.workflowInvocationService.invoke(
            {
              target: {
                kind: 'fork',
                sourceRunId: runId,
                ...(req.rerunFrom ? { rerunFrom: req.rerunFrom } : {}),
                definition: req.definition ?? 'pinned',
                workspace: req.workspace ?? 'fresh',
              },
              variables: req.variablesOverride ?? {},
              ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
            },
            TESTKIT_INVOCATION,
          );
          return { status: 202, body: result, runId: result.runId };
        } catch (err) {
          return errorResult(err);
        }
    }
  };

  /** A thrown refusal in HTTP terms (the server's error middleware). */
  const errorResult = (err: unknown): CommandResult => {
    const e = err as { httpStatus?: number; category?: string; code?: string; message?: string };
    const status =
      typeof e.httpStatus === 'number' ? e.httpStatus : e.category === 'state' ? 409 : e.category === 'validation' ? 400 : e.category === 'not_found' ? 404 : 500;
    return { status, body: { error: { code: e.code ?? 'ERROR', message: e.message ?? String(err) } } };
  };

  return {
    name: 'v2',
    get generation() {
      return current.n;
    },
    get services() {
      return current.services;
    },
    get harness() {
      return current.harness;
    },
    /** The current generation's engine. */
    get supervisor() {
      return current.supervisor;
    },
    resolveStage,
    classifyTurn,
    async importDefinition(spec) {
      await started;
      const def = await current.services.workflowDefinitionService.createFromSpec(toGraph(spec), { canEditCommands: true, status: 'published' });
      const stageIds: Record<string, string> = {};
      for (const s of def.graph.stages) stageIds[s.name] = s.key;
      return { definitionId: def.id, stageIds };
    },
    async startRun(definitionId, variables, runOpts = {}) {
      await started;
      const { workflowInvocationService, workflowRunService, workflowDefinitionService } = current.services;
      if (runOpts.start !== false) {
        // THE way a run starts (P04).
        const result = await workflowInvocationService.invoke(
          {
            target: { kind: 'definition', workflowDefinitionId: definitionId, ...(runOpts.testRun ? { testRun: true } : {}) },
            variables,
            ...(runOpts.permissionMode ? { overrides: { permissionMode: runOpts.permissionMode } } : {}),
          },
          TESTKIT_INVOCATION,
        );
        return result.runId;
      }
      // A created run a scenario starts later with the `start` command.
      const run = await workflowRunService.createRun({
        workflowDefinitionId: definitionId,
        definitionVersionId: await workflowDefinitionService.resolveVersionForRun(definitionId, { testRun: runOpts.testRun === true }),
        variables,
        trigger: TESTKIT_INVOCATION.trigger,
        ...(runOpts.permissionMode ? { permissionMode: runOpts.permissionMode } : {}),
      });
      return run.id;
    },
    command,
    snapshot,
    isTerminal: (snap) => TERMINAL_RUN.has(snap.run.status),
    async stageIds(runId) {
      const r = sqlite.prepare(`SELECT definition_version_id AS v FROM workflow_runs WHERE id = ?`).get(runId) as { v: string };
      const ids: Record<string, string> = {};
      for (const s of (await current.services.runDefinitionReader.get(r.v)).stages) ids[s.name] = s.key;
      return ids;
    },
    instanceId(runId, instancePath) {
      const row = sqlite.prepare(`SELECT id FROM stage_runs WHERE workflow_run_id = ? AND (instance_path = ? OR name = ?) ORDER BY instance_path LIMIT 1`).get(runId, instancePath, instancePath) as
        | { id: string }
        | undefined;
      if (!row) throw new Error(`run ${runId} has no instance "${instancePath}"`);
      return row.id;
    },
    async killAndRestart(restart = {}) {
      await started;
      await halt(current);
      // The dead process's lock heartbeat must go stale before a new engine may take it.
      await new Promise((r) => setTimeout(r, timing.lockStaleMs + 60));
      current = boot(current.n + 1);
      started = restart.recover === false ? Promise.resolve() : current.supervisor.start();
      await started;
    },
    async dispose() {
      await started.catch(() => undefined);
      await halt(current);
      await current.services.eventBus.flush().catch(() => undefined);
    },
  } as EngineAdapter & { readonly supervisor: RunSupervisor };
}

/** The server's MCP hub + credential vault over an in-memory secret store. */
function secretsHub(secrets: Record<string, string>): InMemoryMcpHub {
  const store = {
    get: async (namespace: string, name: string) => {
      const v = secrets[`${namespace}/${name}`];
      return v === undefined ? null : new TextEncoder().encode(v);
    },
  } as unknown as ConstructorParameters<typeof McpCredentialVault>[0];
  return new InMemoryMcpHub({ vault: new McpCredentialVault(store) });
}
