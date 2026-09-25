// ────────────────────────────────────────────────────────────────
// The v1 engine adapter — everything the testkit knows about TODAY's
// workflow engine (WorkflowRunService + StageExecutionService + friends),
// kept in one file so PHASE-03 can put a v2 adapter beside it and delete this
// one with the engine it describes (P00 review R20).
//
// Boots the SAME service graph the server does (`createCoreServices`, the
// same Drizzle repositories, the same late wiring for result validation and
// workflow hooks) and swaps the provider for `ScriptedFauxHarness`.
// v1-specific knowledge, all of it here:
//   - commands mirror the HTTP routes (`apps/server/src/routes/workflowRuns.ts`),
//     including the approve route's verdict mapping and the stage-retry route;
//   - snapshots read the v1 tables (`stage_runs`, sessions, `chat_messages`
//     tagged with `metadata.stageRunId`); an instance's path is its stage name;
//   - a crash clears `StageExecutionService`'s private heartbeat timers;
//   - conversations are resolved to stage runs through `sessions`, falling
//     back to the `stage-<stageRunId>-<ts>` id SessionAllocator mints;
//   - turns are classified from the persisted user message's metadata flags
//     (`isContextMessage`, `isSummaryPrompt`, …) and only then by prompt text.
//
// `createCoreServices` requires the workspace manager, the admission
// controller, the source-control flow and the sandbox choice (P01 WP-1.3), so
// the testkit wires a real WorkspaceManager (workspaces under `<workDir>/ws`),
// a real AdmissionController, no sandbox, and a source-control flow that
// refuses (nothing in the characterisation suite post-processes).
// What is deliberately NOT wired (the server has it; nothing in the
// characterisation suite reaches it, and each would pull in a browser or the
// network): WorktreeService / checkpoints, BrowserService, agent services, MCP
// hub, and the StreamBroker event store (the EventBus commits to the legacy
// `events` table; the testkit captures every event in memory).
// ────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import {
  AdmissionController,
  InMemoryMcpHub,
  McpCredentialVault,
  createCoreServices,
  FetchHttpClient,
  GitManager,
  ResultValidator,
  SandboxedScriptRunner,
  WorkspaceManager,
  type CoreServices,
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
  DrizzleSessionAllocationRepository,
  DrizzlePlanRepository,
  DrizzleAgentInteractionRepository,
  DrizzleExecutionWorkspaceRepository,
  DrizzleWorkspaceMountRepository,
  DrizzleWorkspaceArtifactRepository,
  DrizzleWorktreeRepository,
  RegisterRepository,
  EntryRepository,
} from '@generatorai/db';
import { isStageReviewOutcome, type ChatMessage, type ILogger, type StageReviewOutcome } from '@generatorai/shared';
import { ScriptedFauxHarness, classifyPrompt, type StageKey, type TurnKind } from '../harness.js';
import { toGraph } from '../definitions.js';
import type {
  AdapterContext,
  ApproveBody,
  CommandResult,
  EngineAdapter,
  LogLine,
  RunCommand,
  RunSnapshot,
  StageSnapshot,
} from '../types.js';

interface Generation {
  n: number;
  services: CoreServices;
  harness: ScriptedFauxHarness;
  unsubscribe: Array<() => void>;
}

const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);

function captureLogger(logs: LogLine[], generation: number): ILogger {
  const push = (level: LogLine['level']) => (message: string) => {
    logs.push({ generation, level, message: String(message) });
  };
  return { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } as unknown as ILogger;
}

/** Metadata flags StageExecutionService puts on the user message of each internal turn. */
function kindFromMetadata(meta: Record<string, unknown>, prompt: string): TurnKind | undefined {
  if (typeof meta['turnRole'] === 'string') return meta['turnRole'] as TurnKind; // P03 `turn_role`
  if (meta['isSummaryPrompt'] === true) return 'summary';
  if (meta['isOutputRetry'] === true) return 'output_retry';
  if (meta['isValidationFeedback'] === true) return 'validation_feedback';
  if (meta['isApprovalFeedback'] === true || meta['isFollowUpPrompt'] === true || meta['isHookContext'] === true) {
    return 'follow_up';
  }
  // The restart recap is flagged as context too; its text tells them apart.
  if (meta['isContextMessage'] === true) return prompt.startsWith('This stage was interrupted by a restart') ? 'recap' : 'context';
  if (typeof meta['stageRunId'] === 'string') {
    return prompt.startsWith('Continue from where you left off') ? 'continuation' : 'prompt';
  }
  return undefined;
}

export function createV1Adapter(ctx: AdapterContext): EngineAdapter {
  const { db, sqlite, workDir, clock, book, calls, events, logs, timing } = ctx;
  let eventSeq = 0;

  const stageByConversation = sqlite.prepare(`
    SELECT sr.id AS id, sr.name AS name, sr.workflow_run_id AS runId
      FROM sessions s JOIN stage_runs sr ON sr.session_id = s.id
     WHERE s.conversation_id = ?
     ORDER BY CASE sr.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'awaiting_input' THEN 2 ELSE 3 END,
              COALESCE(sr.started_at, 0) DESC
     LIMIT 1`);
  const stageById = sqlite.prepare(`SELECT id, name, workflow_run_id AS runId FROM stage_runs WHERE id = ?`);
  const lastUserMessage = sqlite.prepare(`
    SELECT m.metadata FROM chat_messages m JOIN sessions s ON s.id = m.session_id
     WHERE s.conversation_id = ? AND m.role = 'user' AND m.content = ?
     ORDER BY m.rowid DESC LIMIT 1`);

  const resolveStage = (conversationId: string): StageKey => {
    let row = stageByConversation.get(conversationId) as { id: string; name: string; runId: string } | undefined;
    if (!row) {
      // Allocation creates the conversation before the stage row points at
      // its session; SessionAllocator embeds the id in `stage-<stageRunId>-<ts>`.
      const m = /^stage-(.+)-\d+$/.exec(conversationId);
      if (m) row = stageById.get(m[1]) as typeof row;
    }
    return row
      ? { stageName: row.name, stageRunId: row.id, workflowRunId: row.runId, conversationId }
      : { stageName: conversationId, stageRunId: conversationId, workflowRunId: '', conversationId };
  };

  const classifyTurn = (conversationId: string, prompt: string): TurnKind => {
    const row = lastUserMessage.get(conversationId, prompt) as { metadata: string | null } | undefined;
    if (row?.metadata) {
      const kind = kindFromMetadata(JSON.parse(row.metadata) as Record<string, unknown>, prompt);
      if (kind) return kind;
    }
    // Recap and a few paths persist nothing first: fall back to the text.
    return classifyPrompt(prompt);
  };

  const boot = (n: number): Generation => {
    const logger = captureLogger(logs, n);
    const harness = new ScriptedFauxHarness({ book, resolveStage, classify: classifyTurn, clock, calls, generation: n });
    const scriptRunner = new SandboxedScriptRunner(logger);
    const gitManager = new GitManager(scriptRunner, logger, { workspacesDir: join(workDir, 'ws') });
    const chatMessageRepo = new DrizzleChatMessageRepository(db);
    const stageRunRepo = new DrizzleStageRunRepository(db);
    const workspaceManager = new WorkspaceManager(
      new DrizzleExecutionWorkspaceRepository(db),
      new DrizzleWorkspaceMountRepository(db),
      new DrizzleWorkspaceArtifactRepository(db),
      { workspacesDir: join(workDir, 'ws'), defaultGitEnabled: false },
      logger,
      gitManager,
      new DrizzleWorktreeRepository(db),
    );
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
      chatEntityRepo: new DrizzleChatRepository(db),
      workflowDefinitionStore: new SqliteWorkflowDefinitionStore(db),
      workflowRunRepo: new DrizzleWorkflowRunRepository(db),
      stageRunRepo,
      automationRepo: new DrizzleAutomationRepository(db),
      automationExecutionRepo: new DrizzleAutomationExecutionRepository(db),
      idempotencyKeyRepo: new DrizzleIdempotencyKeyRepository(db),
      registerRepo: new RegisterRepository(db),
      entryRepo: new EntryRepository(db),
      sessionAllocationRepo: new DrizzleSessionAllocationRepository(db),
      sandbox: null,
      workspaceManager,
      admissionController: new AdmissionController(),
      scmFlow: {
        run: async () => {
          throw new Error('testkit: source-control post-processing is not wired');
        },
      },
      config: {
        artifactsDir: join(workDir, 'art'),
        ...(ctx.maxConcurrentStages !== undefined ? { maxConcurrentStages: ctx.maxConcurrentStages } : {}),
      },
      chatExtensions: ctx.secrets ? { mcpHub: secretsHub(ctx.secrets) } : {},
      planRepo: new DrizzlePlanRepository(db),
      agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    });

    // Late wiring the server's composition root does for workflows.
    const { workflowRunService, stageExecutionService, hookExecutor, eventBus } = services;
    workflowRunService.setHookExecutor(hookExecutor);
    if (ctx.resultValidation) {
      workflowRunService.setResultValidator(new ResultValidator(chatMessageRepo, stageRunRepo, eventBus, logger, scriptRunner));
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
    // process, so do the same here (v1 keeps them in a private map).
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

  let current = boot(0);

  const snapshot = async (runId: string): Promise<RunSnapshot> => {
    const run = await new DrizzleWorkflowRunRepository(db).getById(runId);
    const stageRows = await new DrizzleStageRunRepository(db).getByRunId(runId);
    // The pinned graph's stage order, not creation time: the rows of one run
    // share a created_at second.
    const graph = await current.services.runDefinitionReader.get(run.definitionVersionId);
    const orderOf = new Map(graph.stages.map((st, i) => [st.key, i]));
    stageRows.sort((a, b) => (orderOf.get(a.stageKey) ?? 0) - (orderOf.get(b.stageKey) ?? 0) || a.name.localeCompare(b.name));
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

    const stages: Record<string, StageSnapshot> = {};
    for (const sr of stageRows) {
      // v1 has no scopes: an instance's path is its stage name.
      const instancePath = sr.name;
      stages[instancePath] = {
        instancePath,
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
      instanceOrder: stageRows.map((s) => s.name),
      events: events.filter((e) => e.data['workflowRunId'] === runId),
      calls: calls.filter((c) => stageIdSet.has(c.stageRunId)),
      sessions,
    };
  };

  /** `POST /:runId/stages/:stageId/approve`, as the route does it today. */
  const approve = async (runId: string, stageRunId: string, body: ApproveBody = {}): Promise<CommandResult> => {
    const { hitlService, stageExecutionService } = current.services;
    if (!isStageReviewOutcome(body.outcome)) {
      return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'outcome is required' } } };
    }
    const outcome: StageReviewOutcome = body.outcome;
    const approved = outcome === 'approved';
    const followUpPrompt =
      typeof body.followUpPrompt === 'string' && body.followUpPrompt.trim().length > 0 ? body.followUpPrompt.trim() : undefined;
    let isCompletionReview = false;
    try {
      const row = (await hitlService.listPending(runId)).find((r) => r.id === stageRunId);
      isCompletionReview = (row?.interruptData as { kind?: unknown } | undefined)?.kind === 'stage_completion_review';
    } catch {
      /* same fallthrough as the route */
    }
    if (!isCompletionReview && approved && followUpPrompt) stageExecutionService.markFollowUpPending(stageRunId);
    const result = await hitlService.resume(stageRunId, runId, {
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
    return { status: 202, body: { stageId: stageRunId, outcome, followUp: !!followUpPrompt } };
  };

  const startFireAndForget = (runId: string): void => {
    // `POST /:id/start` answers 202 and lets the run go.
    current.services.workflowRunService.startRun(runId).catch((err: unknown) => {
      logs.push({ generation: current.n, level: 'error', message: `startRun failed: ${String(err)}` });
    });
  };

  const command = async (runId: string, cmd: RunCommand): Promise<CommandResult> => {
    const wrs = current.services.workflowRunService;
    switch (cmd.type) {
      case 'start':
        startFireAndForget(runId);
        return { status: 202 };
      case 'pause':
        await wrs.pauseRun(runId);
        return { status: 200 };
      case 'resume':
        await wrs.resumeRun(runId);
        return { status: 200 };
      case 'cancel':
        await wrs.cancelRun(runId);
        return { status: 200 };
      case 'retry-run': {
        // Throws like the service does (the route turns it into HTTP 502).
        const retried = await wrs.retryRun(runId);
        startFireAndForget(retried.id);
        return { status: 202, runId: retried.id };
      }
      case 'retry-stage': {
        const stageRunRepo = new DrizzleStageRunRepository(db);
        const run = await new DrizzleWorkflowRunRepository(db).getById(runId);
        await stageRunRepo.resetForRetry(cmd.stageRunId);
        await stageRunRepo.incrementRetryCount(cmd.stageRunId);
        const stageRun = await stageRunRepo.getById(cmd.stageRunId);
        const { stageExecutionService } = current.services;
        stageExecutionService
          .executeStage(stageRun, runId, run.sessionMode)
          .then(() => wrs.onStageCompleted(runId, cmd.stageRunId))
          .catch((err) => wrs.onStageFailed(runId, cmd.stageRunId, err));
        return { status: 202 };
      }
      case 'approve':
        return approve(runId, cmd.stageRunId, cmd.body);
      case 'interrupt': {
        // Fire-and-forget, as the old route did: interrupt() returns the
        // resolution promise a stage body would await.
        const { hitlService } = current.services;
        void hitlService
          .interrupt(cmd.stageRunId, runId, cmd.data ?? { type: 'manual', source: 'testkit' }, cmd.prompt ? { prompt: cmd.prompt } : undefined)
          .catch(() => undefined);
        return { status: 202 };
      }
    }
  };

  return {
    name: 'v1',
    get generation() {
      return current.n;
    },
    get services() {
      return current.services;
    },
    get harness() {
      return current.harness;
    },
    resolveStage,
    classifyTurn,
    async importDefinition(spec) {
      // The one materializer; published so a plain run can start it.
      const def = await current.services.workflowDefinitionService.createFromSpec(toGraph(spec), {
        canEditCommands: true,
        status: 'published',
      });
      const stageIds: Record<string, string> = {};
      for (const s of def.graph.stages) stageIds[s.name] = s.key;
      return { definitionId: def.id, stageIds };
    },
    async startRun(definitionId, variables, opts = {}) {
      const run = await current.services.workflowRunService.createRun({
        workflowDefinitionId: definitionId,
        variables,
        ...(opts.testRun ? { testRun: true } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      });
      if (opts.start !== false) startFireAndForget(run.id);
      return run.id;
    },
    command,
    snapshot,
    isTerminal: (snap) => TERMINAL_RUN.has(snap.run.status),
    async stageIds(runId) {
      const run = await new DrizzleWorkflowRunRepository(db).getById(runId);
      const ids: Record<string, string> = {};
      for (const s of (await current.services.runDefinitionReader.get(run.definitionVersionId)).stages) ids[s.name] = s.key;
      return ids;
    },
    instanceId(runId, instancePath) {
      const row = sqlite
        .prepare(`SELECT id FROM stage_runs WHERE workflow_run_id = ? AND name = ? ORDER BY created_at LIMIT 1`)
        .get(runId, instancePath) as { id: string } | undefined;
      if (!row) throw new Error(`run ${runId} has no instance "${instancePath}"`);
      return row.id;
    },
    async killAndRestart(opts = {}) {
      halt(current);
      current = boot(current.n + 1);
      if (opts.allocatorFirst) await current.services.sessionAllocator.rehydrate();
      if (opts.recover !== false) await current.services.recoveryService.recover();
    },
    async dispose() {
      halt(current);
      await current.services.eventBus.flush().catch(() => undefined);
    },
  };
}

/**
 * The server's MCP hub + credential vault over an in-memory secret store
 * (`namespace/name` → value). Structural: the testkit does not depend on
 * the secrets package, and the vault only reads.
 */
function secretsHub(secrets: Record<string, string>): InMemoryMcpHub {
  const store = {
    get: async (namespace: string, name: string) => {
      const v = secrets[`${namespace}/${name}`];
      return v === undefined ? null : new TextEncoder().encode(v);
    },
  } as unknown as ConstructorParameters<typeof McpCredentialVault>[0];
  return new InMemoryMcpHub({ vault: new McpCredentialVault(store) });
}
