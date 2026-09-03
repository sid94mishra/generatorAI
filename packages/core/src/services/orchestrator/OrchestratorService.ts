// ────────────────────────────────────────────────────────────────
// OrchestratorService — background-agent orchestration for Chat
//
// An orchestrator chat spawns background WORKER chats (each a real
// GeneratorAI Chat/Session/Workspace) via tool calls, monitors them,
// collects compact digests, sends follow-ups, and consolidates.
//
// See docs/ORCHESTRATOR_MODE_RESEARCH_AND_PLAN.md.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, TaskBrief, TaskResultDigest, BackgroundTaskStatus } from '@generatorai/shared';
import { TaskResultDigestSchema } from '@generatorai/shared';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { IChatRepository } from '../../domain/ports/IChatRepository.js';
import type { ISessionRepository, IChatMessageRepository } from '../../domain/ports/IRepositories.js';
import type { IAgentHarness, HarnessModel } from '../../domain/ports/IAgentHarness.js';
import type { EventBus } from '../../events/EventBus.js';
import type { ChatManagementService } from '../ChatManagementService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import type { Agent, Chat, HarnessConfig } from '@generatorai/shared';
import { WORKER_SYSTEM_PROMPT, renderBriefMessage } from './prompts.js';

/**
 * Narrow view of AgentService. Structural rather than a direct import so the
 * orchestrator does not participate in the ChatManagementService cycle.
 */
export interface AgentServiceLike {
  listSelectable(projectId?: string): Promise<Agent[]>;
  getByRef(ref: string): Promise<Agent | null>;
}

export interface OrchestratorConfig {
  /** Max total workers a single orchestrator may spawn. */
  maxWorkers: number;
  /** Max review rounds (follow-ups) per worker before it must be accepted. */
  maxReviewRounds: number;
  /** Default worker model when the brief doesn't specify one. */
  defaultWorkerModel?: string;
  /** How long check(wait=true) waits for a worker to reach idle. */
  workerTimeoutMs: number;
  /** Warm-first-then-parallel: gently stagger the first worker so the prompt cache warms. */
  warmFirst: boolean;

  // ── W24 / X-20: Termination conditions (all three must pass for the wave ──
  // to continue — if any trips, the orchestrator stops spawning new workers
  // and delivers what it has, preventing the non-convergence failure mode
  // where orchestrators cycle indefinitely without an explicit stop contract.

  /**
   * Maximum number of spawn waves (rounds) the orchestrator may execute.
   * A "wave" is one call to the spawn tool that kicks off ≥1 workers.
   * When the orchestrator's wave count reaches this limit, it must
   * consolidate results rather than spawn further.
   *
   * Default: 10. Minimum: 1.
   */
  maxWaves: number;

  /**
   * Wall-clock budget for the entire orchestration (ms).
   * When `Date.now() - orchestrationStartedAt >= timeBudgetMs` the
   * orchestrator is told to consolidate immediately regardless of wave count.
   *
   * Default: 30 min. Set to 0 to disable.
   */
  timeBudgetMs: number;

  /**
   * Convergence threshold — fraction (0–1) of the workers in the CURRENT wave
   * that must report convergence for the orchestration to stop and
   * consolidate. Convergence is a claim a worker makes (`converged: true` in
   * its `<TASK_RESULT>` digest, meaning "done, and I expect no further
   * work"), not something finishing a turn implies; a failed or cancelled
   * worker never converges.
   *
   * Default: 1.0 (every worker in the wave must report it). Set to 0 to
   * disable the guard entirely.
   */
  convergenceThreshold: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxWorkers: 12,
  maxReviewRounds: 3,
  defaultWorkerModel: undefined,
  workerTimeoutMs: 5 * 60 * 1000,
  warmFirst: true,
  // W24 / X-20 termination conditions.
  maxWaves: 10,
  timeBudgetMs: 30 * 60 * 1000, // 30 min
  convergenceThreshold: 1.0,
};

/** Result of a spawn call, surfaced to the orchestrator as a tool result. */
export interface SpawnResult {
  ok: boolean;
  taskId?: string;
  taskName?: string;
  status?: BackgroundTaskStatus;
  model?: string;
  error?: string;
}

interface TaskRecord {
  taskId: string; // == worker chatId
  taskName: string;
  parentChatId: string;
  parentSessionId: string;
  workerSessionId: string;
  model?: string;
  status: BackgroundTaskStatus;
  /**
   * W24 — the spawn wave this worker belongs to. Convergence is a property of
   * the CURRENT wave; without this field it was computed over every worker
   * the orchestration had ever spawned, so a converged early wave kept
   * out-voting the wave actually in progress.
   */
  wave: number;
  reviewRounds: number;
  /** Longest assistant text captured this turn (from harness.message_complete). */
  lastAssistantText: string;
  /** Resolves the moment the worker reaches idle after the latest prompt. */
  idlePromise: Promise<void>;
  resolveIdle: () => void;
  /** Resolves when the worker first starts producing output (for warm-first). */
  firstOutput: Promise<void>;
  resolveFirstOutput: () => void;
  unsub?: () => void;
  lastError?: string;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What a worker inherits from the orchestrator that spawned it (G15). */
export interface InheritedWorkerCapabilities {
  harnessConfig: Partial<HarnessConfig>;
  permissionMode?: Chat['permissionMode'];
  defaultAgentMode?: Chat['defaultAgentMode'];
  browserConfig?: Chat['browserConfig'];
}

/**
 * G15 — worker capability inheritance.
 *
 * Before this, `spawnBackgroundAgent` built the worker's `harnessConfig` from
 * scratch with exactly two fields (model and the constant worker prompt) and
 * passed nothing else through. Every capability-bearing field of the parent
 * was dropped: `mcpServers`, `availableTools`, `excludedTools`,
 * `skillDirectories`, `disabledSkills`, `customAgents`, `configDir`,
 * `provider`, `harnessType`, `reasoningEffort`, `contextTier`, `maxTurns`,
 * plus the chat-level `permissionMode`, `defaultAgentMode` and
 * `browserConfig`. With no `agentRef` either, `applyAgentProjection` fell
 * through to `AgentResolver.empty()` — whose groups are
 * `DEFAULT_AGENT_TOOL_POLICY`. So a worker spawned by a deliberately
 * locked-down orchestrator silently ran with **full platform defaults**:
 * file writes, shell and browser all on.
 *
 * Inheritance here is a CEILING, never a grant:
 *   - `excludedTools` is the UNION of the parent's exclusions and the deny
 *     list its resolved agent produced, so a tool the orchestrator was denied
 *     stays denied for the worker even when the worker binds its own agent.
 *   - `availableTools` is inherited whenever the parent declared one — an
 *     allow-list is a restriction, and dropping it widens the worker.
 *   - `permissionMode` is inherited so a worker cannot approve its own tool
 *     calls in an orchestrator that requires prompting.
 *
 * △ `agentRef` is deliberately NOT inherited. The orchestrator's own agent
 * has `role: 'orchestrator'`, which `AgentResolver` translates into
 * `orchestration: true` — handing that to a worker would grant it the
 * background-agent tool set and make recursive spawning reachable, the exact
 * thing `orchestratorMode: false` is there to prevent. The capability CLAMP
 * travels instead, via the concrete allow/deny lists the parent's projection
 * already resolved to.
 */
export function inheritWorkerCapabilities(parent: Chat): InheritedWorkerCapabilities {
  const parentConfig = parent.harnessConfig ?? {};
  const snapshotPolicy = parent.agentSnapshot?.toolPolicy;

  const excluded = new Set<string>([
    ...(parentConfig.excludedTools ?? []),
    ...(snapshotPolicy?.deny ?? []),
  ]);

  const harnessConfig: Partial<HarnessConfig> = {
    ...(parentConfig.mcpServers ? { mcpServers: parentConfig.mcpServers } : {}),
    ...(parentConfig.skillDirectories ? { skillDirectories: parentConfig.skillDirectories } : {}),
    ...(parentConfig.disabledSkills ? { disabledSkills: parentConfig.disabledSkills } : {}),
    ...(parentConfig.customAgents ? { customAgents: parentConfig.customAgents } : {}),
    ...(parentConfig.excludedMcpServerIds
      ? { excludedMcpServerIds: parentConfig.excludedMcpServerIds }
      : {}),
    ...(parentConfig.configDir ? { configDir: parentConfig.configDir } : {}),
    ...(parentConfig.provider ? { provider: parentConfig.provider } : {}),
    ...(parentConfig.harnessType ? { harnessType: parentConfig.harnessType } : {}),
    ...(parentConfig.reasoningEffort ? { reasoningEffort: parentConfig.reasoningEffort } : {}),
    ...(parentConfig.contextTier ? { contextTier: parentConfig.contextTier } : {}),
    ...(parentConfig.maxTurns !== undefined ? { maxTurns: parentConfig.maxTurns } : {}),
    ...(parentConfig.permissionMode ? { permissionMode: parentConfig.permissionMode } : {}),
    ...(excluded.size > 0 ? { excludedTools: [...excluded] } : {}),
    // An allow-list is a restriction. Inherit the parent's when it has one;
    // an agent-derived allow-list only narrows further, so union is wrong here.
    ...(parentConfig.availableTools?.length
      ? { availableTools: parentConfig.availableTools }
      : snapshotPolicy?.allow?.length
        ? { availableTools: snapshotPolicy.allow }
        : {}),
  };

  return {
    harnessConfig,
    ...(parent.permissionMode ? { permissionMode: parent.permissionMode } : {}),
    ...(parent.defaultAgentMode ? { defaultAgentMode: parent.defaultAgentMode } : {}),
    ...(parent.browserConfig ? { browserConfig: parent.browserConfig } : {}),
  };
}

export class OrchestratorService {
  /** taskId → record. */
  private tasks = new Map<string, TaskRecord>();
  /** parentChatId → firstOutput promise of the current wave's leader (warm-first). */
  private waveWarmup = new Map<string, Promise<void>>();
  /** parentChatId → count of workers still running (for per-wave warm-first + cleanup). */
  private activeByParent = new Map<string, number>();
  /** parentChatId → unsubscribe for the parent-session listener (auto-accept on turn end). */
  private parentSubs = new Map<string, () => void>();
  /** parentChatId → parent sessionId (for status emits + subscription). */
  private parentSessions = new Map<string, string>();
  /** Short-lived cache of available models (validation + cost-aware routing). */
  private modelCache?: { at: number; models: HarnessModel[] };
  private static readonly MODEL_CACHE_TTL_MS = 60_000;

  // ── W24 / X-20: Per-orchestration termination tracking ───────────────────
  /**
   * parentChatId → number of waves launched.
   * A wave is counted the moment a new set of workers is spawned.
   * The orchestrator checks this against `config.maxWaves` before
   * allowing a further spawn.
   */
  private waveCount = new Map<string, number>();
  /**
   * parentChatId → epoch ms when the orchestration started.
   * Used to enforce `config.timeBudgetMs`.
   */
  private orchestrationStartedAt = new Map<string, number>();
  /**
   * parentChatIds whose current wave is still open — i.e. at least one worker
   * has been spawned into it and they have not all gone idle yet. Further
   * spawns join that wave rather than starting a new one.
   *
   * W24 fix: this used to be inferred from `waveWarmup`, which is a
   * prompt-cache optimisation that only exists when `config.warmFirst` is on.
   * With `warmFirst: false` there was never a warmup promise, so EVERY
   * individual spawn counted as a fresh wave and `maxWaves` silently became a
   * worker cap N times tighter than configured. Wave identity is a
   * termination concept and must not depend on a caching flag.
   */
  private waveOpen = new Set<string>();

  private chatManagementService!: ChatManagementService;
  private workspaceManager?: WorkspaceManager;
  private agentService?: AgentServiceLike;

  constructor(
    private chatRepo: IChatRepository,
    private sessionRepo: ISessionRepository,
    private messageRepo: IChatMessageRepository,
    private harness: IAgentHarness,
    private eventBus: EventBus,
    private config: OrchestratorConfig = DEFAULT_ORCHESTRATOR_CONFIG,
  ) {}

  /** Late-bind ChatManagementService to break the constructor cycle. */
  setChatManagementService(svc: ChatManagementService): void {
    this.chatManagementService = svc;
  }

  /** Late-bind WorkspaceManager (for the shared-workspace scratchpad). */
  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm;
  }

  /** Late-bind AgentService so workers can be driven by a custom agent. */
  setAgentService(svc: AgentServiceLike): void {
    this.agentService = svc;
  }

  /**
   * Agents this orchestrator may assign to a worker. When the orchestrator is
   * itself agent-driven and declares a team, the list is restricted to it.
   */
  async listAssignableAgents(
    parentChatId: string,
  ): Promise<Array<{ ref: string; name: string; description: string }>> {
    if (!this.agentService) return [];
    const parent = await this.chatRepo.getById(parentChatId).catch(() => null);
    const selectable = await this.agentService.listSelectable(parent?.projectId);
    const team = parent?.agentRef
      ? (await this.agentService.getByRef(parent.agentRef))?.orchestration?.teamAgentRefs ?? []
      : [];
    const pool = team.length > 0
      ? selectable.filter((a) => team.includes(a.ref))
      : selectable.filter((a) => a.role !== 'orchestrator');
    return pool.map((a) => ({ ref: a.ref, name: a.name, description: a.description }));
  }

  getConfig(): OrchestratorConfig {
    return this.config;
  }

  // ── Spawn ────────────────────────────────────────────────────

  async spawnBackgroundAgent(parentChatId: string, brief: TaskBrief): Promise<SpawnResult> {
    if (!this.chatManagementService) {
      return { ok: false, error: 'Orchestrator not initialized' };
    }

    // ── W24 / X-20: the arbiter ───────────────────────────────────────────
    // One decision point evaluating all three independent termination
    // conditions together (time budget, wave cap, convergence) — see
    // `evaluateTermination` below.
    const verdict = await this.evaluateTermination(parentChatId);
    if (verdict.shouldStop) {
      return { ok: false, error: verdict.reason };
    }

    // Enforce max workers per orchestrator.
    const existing = await this.chatRepo.listBackgroundTasks(parentChatId).catch(() => []);
    if (existing.length >= this.config.maxWorkers) {
      return {
        ok: false,
        error: `Worker limit reached (${this.config.maxWorkers}). Consolidate existing results instead of spawning more.`,
      };
    }

    const parent = await this.chatRepo.getById(parentChatId);

    // Resolve + validate the worker model. When the orchestrator doesn't pick
    // one, this defaults to a CHEAPER tier (not the orchestrator's own model)
    // so background work doesn't silently run on an expensive model.
    let workerModel = await this.resolveWorkerModel(brief.model, parent.model);
    if (workerModel) {
      const ids = await this.getModelIds();
      if (ids && ids.size > 0 && !ids.has(workerModel)) {
        const fallback = this.config.defaultWorkerModel ?? parent.model;
        return {
          ok: false,
          error:
            `Model "${workerModel}" is not available for the active provider. ` +
            `Call list_models to see valid ids. ` +
            (fallback ? `Retry without "model" to use "${fallback}", or pick a valid one.` : `Retry without "model".`),
        };
      }
    }

    const taskIndex = existing.length;

    // A worker agent must be one this orchestrator is allowed to spawn.
    let workerAgentRef: string | undefined;
    if (brief.agentRef) {
      const assignable = await this.listAssignableAgents(parentChatId);
      const hit = assignable.find((a) => a.ref === brief.agentRef);
      if (!hit) {
        return {
          ok: false,
          error:
            `Agent "${brief.agentRef}" is not assignable from this orchestrator. ` +
            `Call list_available_agents to see valid refs, or omit agentRef.`,
        };
      }
      workerAgentRef = hit.ref;
    }

    // Warm-first: if a wave leader for this parent is still priming, wait
    // (bounded) for it to start producing before spawning more, so the shared
    // tools+system prefix is cached first. The wave resets once all workers
    // for this parent go idle (see onWorkerEvent).
    if (this.config.warmFirst) {
      const warm = this.waveWarmup.get(parentChatId);
      if (warm) {
        await Promise.race([warm, delay(3000)]);
      }
    }

    // Create the worker chat. The WORKER_SYSTEM_PROMPT is a CONSTANT (byte-
    // identical across workers → shared prompt cache). The per-task brief is
    // delivered as the first USER message, never here. By default the worker
    // SHARES the orchestrator's workspace so its file changes are visible to
    // the orchestrator (sharedWorkspace defaults to true).
    const useShared = brief.sharedWorkspace !== false;
    const sharedWorkspaceId = useShared ? parent.workspaceId : undefined;
    // G15 — a worker must never be able to do something its orchestrator
    // could not. Computed before `createChat` so the clamp is part of the
    // creation, not a correction applied afterwards.
    const inherited = inheritWorkerCapabilities(parent);
    let worker;
    try {
      worker = await this.chatManagementService.createChat({
        name: `⚙ ${brief.taskName}`,
        model: workerModel,
        parentChatId,
        backgroundTask: {
          orchestratorChatId: parentChatId,
          taskName: brief.taskName,
          taskIndex,
          status: 'spawned',
        },
        projectId: parent.projectId,
        codebaseIds: parent.codebaseIds,
        createWorktree: false,
        // Reuse the orchestrator's workspace when sharing (skips workspace +
        // worktree creation in createChat).
        ...(sharedWorkspaceId ? { workspaceId: sharedWorkspaceId } : {}),
        // Explicitly NOT an orchestrator — workers must never get the
        // background-agent tool set (no recursive spawning in v1). The
        // `parentChatId` guard in createChat also enforces this.
        orchestratorMode: false,
        // Without this a worker sharing the orchestrator's workspace falls back
        // to the managed execution directory and writes where the orchestrator
        // never looks — which reads as "the worker did nothing".
        ...(parent.gitRepositories?.length ? { gitRepositories: parent.gitRepositories } : {}),
        // The agent instructions are appended AFTER the constant worker prompt, so
        // the shared cache prefix survives for workers that share an agent.
        ...(workerAgentRef ? { agentRef: workerAgentRef } : {}),
        // G15 — capability inheritance (see `inheritWorkerCapabilities`).
        ...(inherited.permissionMode ? { permissionMode: inherited.permissionMode } : {}),
        ...(inherited.defaultAgentMode ? { defaultAgentMode: inherited.defaultAgentMode } : {}),
        ...(inherited.browserConfig ? { browserConfig: inherited.browserConfig } : {}),
        harnessConfig: {
          // The inherited config goes UNDER the worker's own two fields: the
          // model and the constant worker prompt are worker-specific and must
          // win, everything else is the orchestrator's environment.
          ...inherited.harnessConfig,
          ...(workerModel ? { model: workerModel } : {}),
          systemMessage: { mode: 'append', content: WORKER_SYSTEM_PROMPT },
        },
      });
    } catch (err) {
      return { ok: false, error: `Failed to create worker: ${err instanceof Error ? err.message : String(err)}` };
    }

    const workerSession = await this.sessionRepo.getById(worker.sessionId);

    // W24: count a wave the first time a worker is spawned into it. The wave
    // stays open until every worker in it goes idle (see onWorkerEvent), so
    // the rest of a parallel spawn round joins this wave instead of each
    // consuming one of `maxWaves`.
    if (!this.waveOpen.has(parentChatId)) {
      this.waveOpen.add(parentChatId);
      const nextWaveCount = (this.waveCount.get(parentChatId) ?? 0) + 1;
      this.waveCount.set(parentChatId, nextWaveCount);
      // Persist immediately (not just on dispose) so a restart mid-orchestration
      // resumes at the correct wave count rather than re-opening the budget.
      const startedAt = this.orchestrationStartedAt.get(parentChatId) ?? Date.now();
      void this.chatRepo
        .setOrchestratorWaveState(parentChatId, { waveCount: nextWaveCount, startedAt })
        .catch(() => undefined);
    }

    const record: TaskRecord = {
      taskId: worker.id,
      taskName: brief.taskName,
      parentChatId,
      parentSessionId: parent.sessionId,
      workerSessionId: worker.sessionId,
      model: workerModel,
      status: 'running',
      wave: this.waveCount.get(parentChatId) ?? 1,
      reviewRounds: 0,
      lastAssistantText: '',
      idlePromise: Promise.resolve(),
      resolveIdle: () => {},
      firstOutput: Promise.resolve(),
      resolveFirstOutput: () => {},
      unsub: undefined,
    };
    this.armIdle(record);
    this.tasks.set(record.taskId, record);
    this.activeByParent.set(parentChatId, (this.activeByParent.get(parentChatId) ?? 0) + 1);

    // Track the wave leader's warmup (the first running worker of this wave).
    if (this.config.warmFirst && !this.waveWarmup.has(parentChatId)) {
      this.waveWarmup.set(parentChatId, record.firstOutput);
    }

    // Subscribe to the worker's event stream to detect first-output + idle.
    record.unsub = this.eventBus.subscribe(
      record.workerSessionId,
      (event) => this.onWorkerEvent(record, event),
      `orchestrator:${record.taskId}`,
    );

    // Subscribe once to the PARENT orchestrator session. When the orchestrator's
    // own turn ends (harness.idle) — i.e. it has finished reading digests and
    // consolidating — any worker still sitting in `needs_review` (not sent a
    // follow-up) is implicitly ACCEPTED, so we flip it to `completed`.
    this.parentSessions.set(parentChatId, record.parentSessionId);
    if (!this.parentSubs.has(parentChatId)) {
      const unsub = this.eventBus.subscribe(
        record.parentSessionId,
        (event) => this.onParentEvent(parentChatId, event),
        `orchestrator-parent:${parentChatId}`,
      );
      this.parentSubs.set(parentChatId, unsub);
    }

    // Persist + announce.
    await this.chatRepo.updateBackgroundTaskStatus(record.taskId, 'running').catch(() => {});
    await this.emitToParent(record.parentSessionId, {
      kind: 'chat.background_task.spawned',
      data: {
        chatId: parentChatId,
        parentChatId,
        taskId: record.taskId,
        taskName: record.taskName,
        model: workerModel,
        taskIndex,
      },
    });
    void this.writeScratchpad(parentChatId);

    // Kick off the worker turn (fire-and-forget streaming — do NOT await the
    // full turn here; the orchestrator collects results with check_*).
    // Scratch goes to the MANAGED root so worker notes never litter the
    // user's repository, which is where the code deliverables land.
    let taskDir: string | undefined;
    if (this.workspaceManager && parent.workspaceId) {
      const ws = await this.workspaceManager.getExecutionWorkspace(parent.workspaceId).catch(() => null);
      if (ws) taskDir = path.join(ws.rootPath, 'tasks', brief.taskName);
    }
    const briefMessage = renderBriefMessage(brief, taskDir);
    this.chatManagementService.sendPrompt(record.taskId, briefMessage).catch((err) => {
      record.status = 'failed';
      record.lastError = err instanceof Error ? err.message : String(err);
      record.resolveIdle();
      void this.chatRepo.updateBackgroundTaskStatus(record.taskId, 'failed').catch(() => {});
    });

    return { ok: true, taskId: record.taskId, taskName: record.taskName, status: 'running', model: workerModel };
  }

  // ── Follow-up ────────────────────────────────────────────────

  async sendToBackgroundAgent(taskId: string, followup: string): Promise<{ ok: boolean; error?: string }> {
    const record = this.tasks.get(taskId);
    if (!record) return { ok: false, error: `Unknown task ${taskId}` };
    if (record.reviewRounds >= this.config.maxReviewRounds) {
      return {
        ok: false,
        error: `Review-round limit reached (${this.config.maxReviewRounds}) for "${record.taskName}". Accept the result and consolidate.`,
      };
    }
    record.reviewRounds += 1;
    record.status = 'running';
    record.lastAssistantText = '';
    this.armIdle(record);
    await this.chatRepo.updateBackgroundTaskStatus(taskId, 'running').catch(() => {});
    await this.emitToParent(record.parentSessionId, {
      kind: 'chat.background_task.status',
      data: { chatId: record.parentChatId, parentChatId: record.parentChatId, taskId, taskName: record.taskName, status: 'running' },
    });
    try {
      await this.chatManagementService.sendPrompt(taskId, followup);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Check / list ─────────────────────────────────────────────

  async checkBackgroundAgent(taskId: string, opts: { wait?: boolean } = {}): Promise<TaskResultDigest & { taskId: string; taskName: string }> {
    const record = this.tasks.get(taskId);
    if (!record) {
      return { taskId, taskName: taskId, status: 'failed', summary: `Unknown task ${taskId}`, keyFindings: [], artifacts: [], risks: [], openQuestions: [] };
    }
    if (opts.wait && record.status === 'running') {
      await Promise.race([record.idlePromise, delay(this.config.workerTimeoutMs)]);
    }
    return { ...(await this.buildDigest(record)), taskId: record.taskId, taskName: record.taskName };
  }

  async checkBackgroundAgents(
    parentChatId: string,
    opts: { wait?: boolean } = {},
  ): Promise<Array<TaskResultDigest & { taskId: string; taskName: string; model?: string }>> {
    const records = [...this.tasks.values()].filter((t) => t.parentChatId === parentChatId);
    if (opts.wait) {
      const running = records.filter((r) => r.status === 'running');
      if (running.length > 0) {
        await Promise.race([
          Promise.all(running.map((r) => r.idlePromise)),
          delay(this.config.workerTimeoutMs),
        ]);
      }
    }
    const out: Array<TaskResultDigest & { taskId: string; taskName: string; model?: string }> = [];
    for (const r of records) {
      out.push({ ...(await this.buildDigest(r)), taskId: r.taskId, taskName: r.taskName, model: r.model });
    }
    return out;
  }

  async listBackgroundAgents(
    parentChatId: string,
  ): Promise<Array<{ taskId: string; taskName: string; status: BackgroundTaskStatus; model?: string; reviewRounds: number }>> {
    // Prefer in-memory records; fall back to DB for durability across restarts.
    const mem = [...this.tasks.values()].filter((t) => t.parentChatId === parentChatId);
    if (mem.length > 0) {
      return mem.map((t) => ({ taskId: t.taskId, taskName: t.taskName, status: t.status, model: t.model, reviewRounds: t.reviewRounds }));
    }
    const rows = await this.chatRepo.listBackgroundTasks(parentChatId).catch(() => []);
    return rows.map((c) => ({
      taskId: c.id,
      taskName: c.backgroundTask?.taskName ?? c.name,
      status: c.backgroundTask?.status ?? 'spawned',
      model: c.model,
      reviewRounds: 0,
    }));
  }

  /** Cancel a running worker (abort its turn). */
  async cancelBackgroundAgent(taskId: string): Promise<void> {
    const record = this.tasks.get(taskId);
    try {
      await this.chatManagementService.cancelTurn(taskId);
    } catch {
      // Non-fatal.
    }
    if (record) {
      record.status = 'cancelled';
      record.resolveIdle();
      await this.chatRepo.updateBackgroundTaskStatus(taskId, 'cancelled').catch(() => {});
    }
  }

  /**
   * Re-invoke an idle orchestrator once its whole wave has settled.
   * No-op when the parent is mid-turn (the completion events already reached
   * its live stream) or when the chat is gone/archived.
   */
  private async nudgeParentAfterWave(parentChatId: string): Promise<void> {
    try {
      const streaming = this.chatManagementService.getStreamingChatIds?.() ?? [];
      if (streaming.includes(parentChatId)) return;
      await this.chatManagementService.sendPrompt(
        parentChatId,
        '[system] Every background agent in the current wave has finished. ' +
          'Call check_background_agents to collect their results, then consolidate ' +
          'and deliver the final answer (or spawn a follow-up wave if something is missing).',
      );
    } catch (err) {
      console.warn(
        `[Orchestrator] wave-complete nudge failed for ${parentChatId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── W24 / X-20: Termination — the arbiter ────────────────────────────────

  /**
   * The arbiter. A single decision point that evaluates all three
   * independent termination conditions TOGETHER — time budget, wave cap,
   * convergence — replacing what used to be sequential `if` checks inline
   * in `spawnBackgroundAgent` with no single place that reasoned about
   * them as one policy. Called once per spawn attempt, before any worker
   * is actually created.
   */
  private async evaluateTermination(
    parentChatId: string,
  ): Promise<{ shouldStop: true; reason: string } | { shouldStop: false }> {
    const { startedAt } = await this.getOrInitWaveState(parentChatId);

    // 1. Time budget — wall-clock limit on the whole orchestration.
    if (this.config.timeBudgetMs > 0 && Date.now() - startedAt >= this.config.timeBudgetMs) {
      return {
        shouldStop: true,
        reason:
          `Time budget exhausted (${Math.floor(this.config.timeBudgetMs / 60000)} min). ` +
          `Consolidate results from the workers that have completed so far.`,
      };
    }

    // 2. Wave cap — maximum number of spawn rounds.
    const waves = this.waveCount.get(parentChatId) ?? 0;
    if (waves >= this.config.maxWaves) {
      return {
        shouldStop: true,
        reason:
          `Wave limit reached (${this.config.maxWaves} spawn rounds). ` +
          `No more workers may be started. Consolidate existing results.`,
      };
    }

    // 3. Convergence — over the CURRENT wave only, and only on an explicit
    // `converged: true` from the worker's digest.
    //
    // Two fixes here, both structural. (a) The population was every worker
    // this orchestrator had ever spawned, so an early wave that converged
    // permanently out-voted the wave in progress. It is now the current wave,
    // which is what the config field has always claimed to measure. (b) The
    // old rule also counted any worker whose digest merely PARSED as
    // `completed` — which `buildDigest` returns for every worker that is not
    // running or failed, cancelled ones included. Under the shipped default
    // of 1.0 that made the guard fire as soon as wave 1 stopped running, so a
    // second wave was unreachable and `maxWaves` / `timeBudgetMs` were dead
    // config that no orchestration could ever reach. Convergence is now
    // something a worker claims (see the `converged` field in
    // `TaskResultDigestSchema` and the worker system prompt), which is the
    // only signal that actually means "no new findings, stop".
    //
    // Only meaningful once at least one worker exists in the wave — an empty
    // wave can't be converged, and gating the first spawn on it would
    // deadlock every orchestration before it starts.
    if (this.config.convergenceThreshold > 0) {
      const currentWave = this.waveCount.get(parentChatId) ?? 0;
      const records = [...this.tasks.values()].filter(
        (t) => t.parentChatId === parentChatId && t.wave === currentWave,
      );
      if (records.length > 0) {
        let convergedCount = 0;
        for (const r of records) {
          if (await this.hasConverged(r)) convergedCount += 1;
        }
        const fraction = convergedCount / records.length;
        if (fraction >= this.config.convergenceThreshold) {
          return {
            shouldStop: true,
            reason:
              `Convergence threshold met (${convergedCount}/${records.length} workers in wave ` +
              `${currentWave} converged, ≥ ${Math.round(this.config.convergenceThreshold * 100)}% required). ` +
              `Consolidate results instead of spawning more.`,
          };
        }
      }
    }

    return { shouldStop: false };
  }

  /**
   * Has this worker reported convergence?
   *
   * A worker that is still running has not finished deciding. A `failed` or
   * `cancelled` worker produced no verdict at all — counting it as converged
   * (which the old digest-status rule did, because `buildDigest` reports
   * `completed` for anything not running or failed) let a cancelled wave
   * terminate the whole orchestration.
   */
  private async hasConverged(record: TaskRecord): Promise<boolean> {
    if (record.status === 'running' || record.status === 'failed' || record.status === 'cancelled') {
      return false;
    }
    const digest = await this.buildDigest(record);
    return digest.converged === true;
  }

  /**
   * W24 fix — resolves this parent's wave-tracking state, rehydrating from
   * the durable columns on the orchestrator's own chat row (migration v41)
   * on first access in THIS process (e.g. after a restart) instead of
   * silently restarting the wave count and time budget from zero — the
   * opposite of the plan's requirement, and previously the only behaviour
   * `disposeForParent`'s in-memory-only Maps could produce. A truly fresh
   * orchestration (no prior row) initializes and persists immediately so
   * the very next process to touch this parent finds it too.
   */
  private async getOrInitWaveState(parentChatId: string): Promise<{ waveCount: number; startedAt: number }> {
    const cachedStartedAt = this.orchestrationStartedAt.get(parentChatId);
    if (cachedStartedAt !== undefined) {
      return { waveCount: this.waveCount.get(parentChatId) ?? 0, startedAt: cachedStartedAt };
    }

    const persisted = await this.chatRepo.getOrchestratorWaveState(parentChatId).catch(() => null);
    if (persisted) {
      this.orchestrationStartedAt.set(parentChatId, persisted.startedAt);
      this.waveCount.set(parentChatId, persisted.waveCount);
      return persisted;
    }

    const fresh = { waveCount: 0, startedAt: Date.now() };
    this.orchestrationStartedAt.set(parentChatId, fresh.startedAt);
    this.waveCount.set(parentChatId, fresh.waveCount);
    await this.chatRepo.setOrchestratorWaveState(parentChatId, fresh).catch(() => undefined);
    return fresh;
  }

  // ── Internals ────────────────────────────────────────────────

  private armIdle(record: TaskRecord): void {
    let resolveIdle: () => void = () => {};
    const idlePromise = new Promise<void>((res) => {
      resolveIdle = res;
    });
    record.idlePromise = idlePromise;
    record.resolveIdle = resolveIdle;

    let resolveFirst: () => void = () => {};
    const firstOutput = new Promise<void>((res) => {
      resolveFirst = res;
    });
    record.firstOutput = firstOutput;
    record.resolveFirstOutput = resolveFirst;
  }

  private onWorkerEvent(record: TaskRecord, event: { kind: string; data?: unknown }): void {
    const data = event.data as Record<string, unknown> | undefined;
    switch (event.kind) {
      case 'harness.token':
      case 'harness.reasoning_delta':
      case 'harness.tool_start':
        record.resolveFirstOutput();
        break;
      case 'harness.message_complete': {
        const content = (data?.['content'] as string) ?? '';
        if (content.length > record.lastAssistantText.length) {
          record.lastAssistantText = content;
        }
        break;
      }
      case 'harness.error':
        record.lastError = (data?.['message'] as string) ?? 'error';
        break;
      // W13 / Finding-5: user-initiated Stop must be tracked so harness.idle
      // records the task as 'cancelled', not 'needs_review'. Without this case,
      // a cancelled subagent turn falls through to the default branch and
      // lastError stays undefined — the orchestrator treats it as success and
      // may continue the DAG into stages that depend on the cancelled output.
      case 'harness.cancelled':
        record.lastError = `cancelled:${(data?.['reason'] as string) ?? 'user_abort'}`;
        break;
      case 'harness.idle': {
        record.resolveFirstOutput();
        const hasDigest = /<TASK_RESULT>/i.test(record.lastAssistantText);
        // F4 fix: the original condition `record.lastError && !record.lastAssistantText`
        // incorrectly yielded 'needs_review' for cancelled workers that produced partial
        // output before the cancellation — lastAssistantText was non-empty, so the
        // condition was false even though lastError was set to 'cancelled:*'.
        // Correct logic: any lastError forces a non-success status. Cancellations
        // (prefix 'cancelled:') become 'cancelled'; other errors become 'failed'.
        let idleStatus: BackgroundTaskStatus;
        if (record.lastError) {
          idleStatus = record.lastError.startsWith('cancelled:') ? 'cancelled' : 'failed';
        } else {
          idleStatus = 'needs_review';
        }
        record.status = idleStatus;
        record.resolveIdle();
        // Wave bookkeeping: decrement active count; when the parent's wave is
        // fully idle, reset warm-first so the NEXT wave re-primes.
        const remaining = (this.activeByParent.get(record.parentChatId) ?? 1) - 1;
        if (remaining <= 0) {
          this.activeByParent.delete(record.parentChatId);
          this.waveWarmup.delete(record.parentChatId);
          // W24: the wave is over — the next spawn opens a new one. Tracked
          // separately from waveWarmup so wave counting works identically
          // with `warmFirst` off.
          this.waveOpen.delete(record.parentChatId);
          // The wave finished AFTER the orchestrator went idle — nudge it.
          //
          // The intended loop is `check_background_agents(wait: true)`, but
          // its wait is bounded: on a long wave the orchestrator's turn ends
          // with "still running", and nothing on a per-turn runtime survives
          // to check again (observed live 2026-09-01: the model fell back to
          // the SDK's ScheduleWakeup, which died with the CLI process, and
          // two completed research agents sat unconsolidated forever). The
          // platform is the only durable party, so it re-prompts the parent
          // when the last worker settles. Deferred a tick so the terminal
          // status write above lands first; a parent mid-turn gets the
          // completion event on its stream instead and the prompt is skipped.
          setTimeout(() => {
            void this.nudgeParentAfterWave(record.parentChatId);
          }, 2_000);
        } else {
          this.activeByParent.set(record.parentChatId, remaining);
        }
        const finalStatus: BackgroundTaskStatus = record.status;
        void this.chatRepo.updateBackgroundTaskStatus(record.taskId, finalStatus).catch(() => {});
        void this.writeScratchpad(record.parentChatId);
        void this.emitToParent(record.parentSessionId, {
          kind: 'chat.background_task.completed',
          data: {
            chatId: record.parentChatId,
            parentChatId: record.parentChatId,
            taskId: record.taskId,
            taskName: record.taskName,
            status: finalStatus,
            summary: hasDigest ? undefined : this.truncate(record.lastAssistantText, 200),
          },
        });
        break;
      }
    }
  }

  private async buildDigest(record: TaskRecord): Promise<TaskResultDigest> {
    // Gather candidate final text from the live capture AND the persisted
    // latest assistant message (covers the idle-before-persist race + restarts).
    // Prefer whichever yields a structured <TASK_RESULT> digest.
    const candidates: string[] = [];
    if (record.lastAssistantText) candidates.push(record.lastAssistantText);
    try {
      const msgs = await this.messageRepo.getByChatId(record.taskId, 50, 0);
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]!.role === 'assistant') {
          candidates.push(msgs[i]!.content);
          break;
        }
      }
    } catch {
      // ignore
    }

    for (const text of candidates) {
      const parsed = this.parseDigest(text);
      if (parsed) return parsed;
    }

    // No structured digest → synthesize a minimal one from the longest candidate.
    const text = candidates.sort((a, b) => b.length - a.length)[0] ?? '';
    const status: TaskResultDigest['status'] =
      record.status === 'failed' ? 'failed' : record.status === 'running' ? 'partial' : 'completed';
    return {
      status,
      summary: text ? this.truncate(text, 1200) : record.lastError ? `Error: ${record.lastError}` : 'No output produced yet.',
      keyFindings: [],
      artifacts: [],
      risks: [],
      openQuestions: [],
    };
  }

  private parseDigest(text: string): TaskResultDigest | null {
    if (!text) return null;
    const m = text.match(/<TASK_RESULT>\s*([\s\S]*?)\s*<\/TASK_RESULT>/i);
    if (!m || !m[1]) return null;
    let raw = m[1].trim();
    // Tolerate a fenced ```json block inside the tag.
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence && fence[1]) raw = fence[1].trim();
    try {
      const obj = JSON.parse(raw);
      const result = TaskResultDigestSchema.safeParse(obj);
      if (result.success) return result.data;
      // Structured tag present but shape invalid — surface for debugging.
      console.warn('[Orchestrator] TASK_RESULT failed schema validation:', result.error.issues.slice(0, 3));
    } catch (err) {
      console.warn('[Orchestrator] TASK_RESULT JSON parse failed:', err instanceof Error ? err.message : String(err));
    }
    return null;
  }

  private truncate(s: string, n: number): string {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** Cached model list for per-spawn validation + routing. Returns [] on failure. */
  private async getModelsCached(): Promise<HarnessModel[]> {
    const now = Date.now();
    if (this.modelCache && now - this.modelCache.at < OrchestratorService.MODEL_CACHE_TTL_MS) {
      return this.modelCache.models;
    }
    try {
      const models = await this.harness.getModels();
      this.modelCache = { at: now, models };
      return models;
    } catch {
      return [];
    }
  }

  /** Cached model-id lookup for per-spawn validation. Returns null on failure. */
  private async getModelIds(): Promise<Set<string> | null> {
    const models = await this.getModelsCached();
    return models.length > 0 ? new Set(models.map((m) => m.id)) : null;
  }

  /**
   * Trimmed model roster the orchestrator sees via the `list_models` tool so it
   * can route workers to cheaper tiers. `priceTier` is a coarse, provider-agnostic
   * cost hint derived from category / priceCategory / billingMultiplier.
   */
  async listAvailableModels(): Promise<Array<{ id: string; name: string; priceTier: string; category?: string }>> {
    const models = await this.getModelsCached();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      priceTier: this.priceTier(m),
      ...(m.category ? { category: m.category } : {}),
    }));
  }

  /** Coarse cost bucket: 'low' | 'medium' | 'high'. */
  private priceTier(m: HarnessModel): 'low' | 'medium' | 'high' {
    const pc = (m.priceCategory ?? '').toLowerCase();
    if (pc === 'low') return 'low';
    if (pc === 'high' || pc === 'very_high') return 'high';
    if (pc === 'medium') return 'medium';
    if (typeof m.billingMultiplier === 'number') {
      if (m.billingMultiplier <= 1) return 'low';
      if (m.billingMultiplier >= 5) return 'high';
      return 'medium';
    }
    if (m.category === 'lightweight') return 'low';
    if (m.category === 'powerful') return 'high';
    return 'medium';
  }

  /**
   * Resolve the model a worker should run on. Precedence:
   *   1. brief.model (orchestrator's explicit choice)
   *   2. configured GENERATORAI_ORCH_DEFAULT_WORKER_MODEL
   *   3. AUTO: cheapest capable model that is NOT the top 'high' tier — so
   *      workers don't silently inherit the (often expensive) orchestrator model.
   *   4. parent.model (last-resort safety net)
   * Returns undefined when nothing resolves (harness will use its own default).
   */
  private async resolveWorkerModel(briefModel: string | undefined, parentModel: string | undefined): Promise<string | undefined> {
    if (briefModel) return briefModel;
    if (this.config.defaultWorkerModel) return this.config.defaultWorkerModel;
    const models = await this.getModelsCached();
    if (models.length > 0) {
      const rank = (m: HarnessModel): number => ({ low: 0, medium: 1, high: 2 }[this.priceTier(m)]);
      // Prefer a 'medium'-tier model (avoid the absolute-weakest for real
      // subtasks); otherwise the cheapest non-'high'; otherwise cheapest overall.
      const nonHigh = models.filter((m) => this.priceTier(m) !== 'high');
      const pool = nonHigh.length > 0 ? nonHigh : models;
      const preferMedium = pool.filter((m) => this.priceTier(m) === 'medium');
      const chosen = (preferMedium.length > 0 ? preferMedium : [...pool].sort((a, b) => rank(a) - rank(b)))[0];
      if (chosen) return chosen.id;
    }
    return parentModel;
  }

  /** Dispose all in-memory records + subscriptions for a parent (call on archive). */
  disposeForParent(parentChatId: string): void {
    for (const [taskId, record] of this.tasks) {
      if (record.parentChatId === parentChatId) {
        try { record.unsub?.(); } catch { /* ignore */ }
        this.tasks.delete(taskId);
      }
    }
    const psub = this.parentSubs.get(parentChatId);
    if (psub) { try { psub(); } catch { /* ignore */ } this.parentSubs.delete(parentChatId); }
    this.parentSessions.delete(parentChatId);
    this.activeByParent.delete(parentChatId);
    this.waveWarmup.delete(parentChatId);
    this.waveOpen.delete(parentChatId);
    // W24: Clean up termination-tracking state so a restarted orchestration
    // on the same chat starts fresh. This is the ARCHIVE path specifically —
    // unlike a server restart (which now rehydrates via `getOrInitWaveState`
    // against the durable columns, see above), archiving a chat is a
    // deliberate, terminal action, so the persisted wave state is cleared
    // too rather than left to linger on a dead orchestrator's row.
    this.waveCount.delete(parentChatId);
    this.orchestrationStartedAt.delete(parentChatId);
    void this.chatRepo.clearOrchestratorWaveState(parentChatId).catch(() => undefined);
  }

  /**
   * Parent orchestrator turn ended. Any worker still in `needs_review` (the
   * orchestrator read its digest and did NOT send a follow-up) is implicitly
   * accepted → mark it `completed` so the UI reflects that review is done.
   */
  private onParentEvent(parentChatId: string, event: { kind: string }): void {
    if (event.kind !== 'harness.idle') return;
    let changed = false;
    for (const record of this.tasks.values()) {
      if (record.parentChatId === parentChatId && record.status === 'needs_review') {
        record.status = 'completed';
        changed = true;
        void this.chatRepo.updateBackgroundTaskStatus(record.taskId, 'completed').catch(() => {});
        void this.emitToParent(record.parentSessionId, {
          kind: 'chat.background_task.status',
          data: {
            chatId: parentChatId,
            parentChatId,
            taskId: record.taskId,
            taskName: record.taskName,
            status: 'completed',
          },
        });
      }
    }
    if (changed) void this.writeScratchpad(parentChatId);
  }

  private async emitToParent(parentSessionId: string, event: AgentEvent): Promise<void> {
    try {
      await this.eventBus.emit(parentSessionId, event);
    } catch {
      // Non-fatal.
    }
  }

  /**
   * Shared scratchpad — write a deterministic `orchestrator/state.json` into the
   * parent (shared) workspace so the task tree + statuses survive context
   * truncation and are visible to the orchestrator and every worker (which now
   * share the same filesystem). Best-effort; never throws.
   */
  private async writeScratchpad(parentChatId: string): Promise<void> {
    if (!this.workspaceManager) return;
    try {
      const parent = await this.chatRepo.getById(parentChatId);
      if (!parent.workspaceId) return;
      const ws = await this.workspaceManager.getExecutionWorkspace(parent.workspaceId);
      if (!ws) return;
      const dir = path.join(ws.rootPath, 'orchestrator');
      await fs.mkdir(dir, { recursive: true });
      const tasks = [...this.tasks.values()]
        .filter((t) => t.parentChatId === parentChatId)
        .map((t) => ({
          taskId: t.taskId,
          taskName: t.taskName,
          model: t.model,
          status: t.status,
          reviewRounds: t.reviewRounds,
          artifactDir: path.join(ws.rootPath, 'tasks', t.taskName),
        }));
      const state = { orchestratorChatId: parentChatId, updatedAt: new Date().toISOString(), tasks };
      await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // Non-fatal — the scratchpad is an optimization, not a correctness dep.
    }
  }
}
