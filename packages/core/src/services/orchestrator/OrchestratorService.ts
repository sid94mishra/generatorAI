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
import { WORKER_SYSTEM_PROMPT, renderBriefMessage } from './prompts.js';

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
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxWorkers: 12,
  maxReviewRounds: 3,
  defaultWorkerModel: undefined,
  workerTimeoutMs: 5 * 60 * 1000,
  warmFirst: true,
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

  private chatManagementService!: ChatManagementService;
  private workspaceManager?: WorkspaceManager;

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

  getConfig(): OrchestratorConfig {
    return this.config;
  }

  // ── Spawn ────────────────────────────────────────────────────

  async spawnBackgroundAgent(parentChatId: string, brief: TaskBrief): Promise<SpawnResult> {
    if (!this.chatManagementService) {
      return { ok: false, error: 'Orchestrator not initialized' };
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
        harnessConfig: {
          ...(workerModel ? { model: workerModel } : {}),
          systemMessage: { mode: 'append', content: WORKER_SYSTEM_PROMPT },
        },
      });
    } catch (err) {
      return { ok: false, error: `Failed to create worker: ${err instanceof Error ? err.message : String(err)}` };
    }

    const workerSession = await this.sessionRepo.getById(worker.sessionId);

    const record: TaskRecord = {
      taskId: worker.id,
      taskName: brief.taskName,
      parentChatId,
      parentSessionId: parent.sessionId,
      workerSessionId: worker.sessionId,
      model: workerModel,
      status: 'running',
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
    const briefMessage = renderBriefMessage(brief);
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
      case 'harness.idle': {
        record.resolveFirstOutput();
        const hasDigest = /<TASK_RESULT>/i.test(record.lastAssistantText);
        record.status = record.lastError && !record.lastAssistantText ? 'failed' : 'needs_review';
        record.resolveIdle();
        // Wave bookkeeping: decrement active count; when the parent's wave is
        // fully idle, reset warm-first so the NEXT wave re-primes.
        const remaining = (this.activeByParent.get(record.parentChatId) ?? 1) - 1;
        if (remaining <= 0) {
          this.activeByParent.delete(record.parentChatId);
          this.waveWarmup.delete(record.parentChatId);
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
          artifactDir: `tasks/${t.taskName}`,
        }));
      const state = { orchestratorChatId: parentChatId, updatedAt: new Date().toISOString(), tasks };
      await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // Non-fatal — the scratchpad is an optimization, not a correctness dep.
    }
  }
}
