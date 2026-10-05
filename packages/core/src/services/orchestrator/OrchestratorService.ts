// ────────────────────────────────────────────────────────────────
// OrchestratorService — background-agent orchestration for Chat
//
// An orchestrator chat spawns background WORKER chats (each a real
// GeneratorAI Chat/Session/Workspace) via tool calls, monitors them,
// collects compact digests, sends follow-ups, and consolidates.
//
// See docs/ORCHESTRATOR_MODE_RESEARCH_AND_PLAN.md.
// ────────────────────────────────────────────────────────────────

import type {
  AgentEvent,
  TaskBrief,
  TaskResultDigest,
  BackgroundTaskDetail,
  BackgroundTaskStatus,
  BackgroundTaskCancellation,
  BackgroundTaskCancelledBy,
} from '@generatorai/shared';
import { TaskResultDigestSchema } from '@generatorai/shared';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { IChatRepository } from '../../domain/ports/IChatRepository.js';
import type { ISessionRepository, IChatMessageRepository } from '../../domain/ports/IRepositories.js';
import type { IAgentHarness, HarnessModel } from '../../domain/ports/IAgentHarness.js';
import type { EventBus } from '../../events/EventBus.js';
import type { ChatManagementService } from '../ChatManagementService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import type { Agent, AgentOverrides, AgentToolPolicy, Chat, HarnessConfig } from '@generatorai/shared';
import type { TurnPolicy } from '../session/types.js';
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
   * Default: 120 min (D-97: a multi-wave build — foundation, parallel packages, reviews, docs — ran past
   * the old 30 min and every later spawn was refused). Set to 0 to disable.
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
   * Default: 0 — off (D-97). Workers report `converged` only when their brief asks for it (iterative,
   * until-dry loops); with the old default of 1.0 every finished worker of a build wave claimed it and the
   * next, dependent wave was refused ("Convergence threshold met"), so WP2 could never follow WP1. Set
   * `GENERATORAI_ORCH_CONVERGENCE_THRESHOLD` to enable it; `maxWaves` and `timeBudgetMs` remain the
   * runaway guards.
   */
  convergenceThreshold: number;
  /**
   * How long a finished worker keeps its harness runtime before it is torn
   * down, so an immediate review round reuses the warm process. Default 90 s.
   */
  workerReleaseGraceMs?: number;
}

/** See `OrchestratorConfig.workerReleaseGraceMs`. */
const DEFAULT_WORKER_RELEASE_GRACE_MS = 90_000;

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  // Each worker is a chat, and on the default (persistent-session) Claude
  // provider each chat is a ~230 MB CLI process. Twelve workers per parent was
  // 2.8 GB of processes per orchestration, three times the turn permit
  // (the `provider:claude-agent` flow key, default 4) — the extra eight
  // could only ever wait for a permit while holding their memory. Four matches
  // the permit; raise `GENERATORAI_ORCH_MAX_WORKERS` on a machine that has the
  // memory for more.
  maxWorkers: 4,
  maxReviewRounds: 3,
  defaultWorkerModel: undefined,
  workerTimeoutMs: 5 * 60 * 1000,
  warmFirst: true,
  // W24 / X-20 termination conditions.
  maxWaves: 10,
  timeBudgetMs: 120 * 60 * 1000, // 120 min (D-97)
  convergenceThreshold: 0, // off by default (D-97)
};

/** Result of a spawn call, surfaced to the orchestrator as a tool result. */
export interface SpawnResult {
  ok: boolean;
  taskId?: string;
  taskName?: string;
  status?: BackgroundTaskStatus;
  model?: string;
  error?: string;
  /** Something the orchestrator should know about how the spawn was resolved (e.g. the agent's own model won). */
  note?: string;
}

interface TaskRecord {
  taskId: string; // == worker chatId
  taskName: string;
  parentChatId: string;
  parentSessionId: string;
  workerSessionId: string;
  model?: string;
  /** The agent the worker was bound to, with its display name (the Tasks dock shows it). */
  agentRef?: string;
  agentName?: string;
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
  /** Pending teardown of the worker's harness runtime — see `scheduleWorkerRelease`. */
  releaseTimer?: ReturnType<typeof setTimeout>;

  // ── Live progress (chat.background_task.progress) ──────────────────────
  /** Epoch ms the worker's current turn started — the progress event's `startedAt`. */
  startedAt: number;
  /** What the worker is doing right now: a tool name, or 'thinking' / 'writing'. */
  currentStep?: string;
  /** Tool calls observed on this worker since it was spawned. */
  toolCalls: number;
  /**
   * True while this worker holds one slot in `activeByParent`, i.e. the wave
   * is waiting on it. Taken at spawn and at every follow-up, released by the
   * FIRST `harness.idle` of that activation. A worker's stop produces two
   * idles (the provider's and the chat service's); counted twice, one
   * cancelled worker read as the whole wave settling and the orchestrator was
   * re-prompted while its other workers were still running.
   */
  waveSlot: boolean;
  /** Epoch ms of the last emitted progress event (the throttle's clock). */
  lastProgressAt: number;
  /**
   * G-20 — who cancelled this worker and when. Set by the first cancel of an
   * activation (the route, the orchestrator cascade, or Stop in the worker
   * chat); cleared by a follow-up turn.
   */
  cancellation?: BackgroundTaskCancellation;
}

/** The attribution fields an event / list row carries while a task is cancelled. */
function cancellationFields(
  status: BackgroundTaskStatus,
  cancellation: BackgroundTaskCancellation | undefined,
): Partial<BackgroundTaskCancellation> {
  return status === 'cancelled' && cancellation ? { ...cancellation } : {};
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A tool call's arguments for the task detail: strings clipped, at most 2 KB of JSON. */
function clipArgs(args: unknown): unknown {
  try {
    const json = JSON.stringify(args);
    if (json === undefined || json.length <= 2048) return args;
    return { summary: `${json.slice(0, 2047)}…` };
  } catch {
    return undefined;
  }
}

/** The sections of a brief rendered by `renderTaskBrief` (`renderBriefMessage`, prompts.ts). */
export function parseBrief(text: string): NonNullable<BackgroundTaskDetail['brief']> {
  const section = (title: RegExp): string | undefined => {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => title.test(l));
    if (start < 0) return undefined;
    const body: string[] = [];
    for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]!); i += 1) body.push(lines[i]!);
    const out = body.join('\n').trim();
    return out || undefined;
  };
  const objective = section(/^## Objective\b/);
  const context = section(/^## Context\b/);
  const boundaries = section(/^## Out of scope\b/);
  return {
    text,
    ...(objective ? { objective } : {}),
    ...(context ? { context } : {}),
    ...(boundaries ? { boundaries } : {}),
  };
}

/**
 * Minimum gap between two `chat.background_task.progress` events for the SAME
 * worker. A worker streaming tokens produces hundreds of events a second and
 * every one of them would cross the parent's SSE connection and re-render the
 * orchestrator's transcript; the transcript only needs to say what the worker
 * is on right now. A final, unthrottled emit rides on `harness.idle` so the
 * last state is never the one the throttle swallowed.
 */
const PROGRESS_THROTTLE_MS = 500;

/** How much of a worker's assistant text rides on a progress event. */
const PROGRESS_TEXT_TAIL = 240;

/** What a worker inherits from the orchestrator that spawned it (G15). */
export interface InheritedWorkerCapabilities {
  harnessConfig: Partial<HarnessConfig>;
  /**
   * The clamp as resolver input (C-15): the parent's built-in denials as
   * `extraDeny` (the resolver turns them into `excludedBuiltinTools`, which
   * Copilot enforces on built-ins, unlike `excludedTools`), every group the
   * parent had off, and the workflow groups off (workers never fan out).
   */
  agentOverrides: AgentOverrides;
  permissionMode?: Chat['permissionMode'];
  defaultAgentMode?: Chat['defaultAgentMode'];
  browserConfig?: Chat['browserConfig'];
  /**
   * PD-5 — the parent's computer-use decision, which the worker is composed
   * and judged under: a chat's `switch`, a stage's `opted_in` or `off`.
   */
  computerUse: TurnPolicy['computerUse'];
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
  return inheritWorkerCapabilitiesFrom({
    harnessConfig: parent.harnessConfig ?? {},
    ...(parent.agentSnapshot?.toolPolicy ? { toolPolicy: parent.agentSnapshot.toolPolicy } : {}),
    ...(parent.agentOverrides ? { agentOverrides: parent.agentOverrides } : {}),
    ...(parent.permissionMode ? { permissionMode: parent.permissionMode } : {}),
    ...(parent.defaultAgentMode ? { defaultAgentMode: parent.defaultAgentMode } : {}),
    ...(parent.browserConfig ? { browserConfig: parent.browserConfig } : {}),
    computerUse: 'switch',
  });
}

/**
 * The same ceiling for any parent — a chat, or a stage whose agent is an
 * orchestrator (the composer builds the stage's view of these fields from its
 * session spec and resolved projection).
 */
export function inheritWorkerCapabilitiesFrom(parent: {
  harnessConfig: Partial<HarnessConfig>;
  toolPolicy?: { allow: string[]; deny: string[]; groups?: AgentToolPolicy };
  /** The parent's own capability delta (a chat's `agentOverrides`). */
  agentOverrides?: AgentOverrides;
  permissionMode?: Chat['permissionMode'];
  defaultAgentMode?: Chat['defaultAgentMode'];
  browserConfig?: Chat['browserConfig'];
  computerUse: TurnPolicy['computerUse'];
}): InheritedWorkerCapabilities {
  const parentConfig = parent.harnessConfig;
  const snapshotPolicy = parent.toolPolicy;

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

  // C-15 — the same clamp as resolver input, so it lands in the worker's
  // `excludedBuiltinTools` on every provider.
  const extraDeny = [...new Set([...(snapshotPolicy?.deny ?? []), ...(parent.agentOverrides?.extraDeny ?? [])])];
  const off: Partial<AgentToolPolicy> = {};
  for (const [group, on] of Object.entries({ ...(snapshotPolicy?.groups ?? {}), ...(parent.agentOverrides?.tools ?? {}) })) {
    if (on === false) off[group as keyof AgentToolPolicy] = false;
  }
  const agentOverrides: AgentOverrides = {
    ...(extraDeny.length > 0 ? { extraDeny } : {}),
    tools: { ...off, workflows: false, workflowAuthoring: false },
  };

  return {
    harnessConfig,
    agentOverrides,
    ...(parent.permissionMode ? { permissionMode: parent.permissionMode } : {}),
    ...(parent.defaultAgentMode ? { defaultAgentMode: parent.defaultAgentMode } : {}),
    ...(parent.browserConfig ? { browserConfig: parent.browserConfig } : {}),
    computerUse: parent.computerUse,
  };
}

/**
 * A workflow stage whose bound agent is an orchestrator (T6). Registered by
 * the session composer when it binds the orchestrator tool set to the stage,
 * so the stage can spawn workers exactly like an orchestrator chat. Workers
 * stay chats; their `parentChatId` is the stage run id.
 */
export interface StageOrchestratorParent {
  stageRunId: string;
  workflowRunId: string;
  sessionId: string;
  workspaceId?: string;
  projectId?: string;
  model?: string;
  agentRef?: string;
  inherited: InheritedWorkerCapabilities;
}

/** What spawning needs to know about a parent, whichever kind it is. */
interface ParentView {
  kind: 'chat' | 'stage';
  id: string;
  sessionId: string;
  projectId?: string;
  model?: string;
  workspaceId?: string;
  codebaseIds?: string[];
  gitRepositories?: Chat['gitRepositories'];
  agentRef?: string;
  inherited: InheritedWorkerCapabilities;
}

export class OrchestratorService {
  /** Stage run id → a stage acting as an orchestrator (see `registerStageParent`). */
  private stageParents = new Map<string, StageOrchestratorParent>();
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
  /**
   * parentChatIds whose orchestrator has gone idle since its last wave — the
   * user's request was answered, so the NEXT spawn belongs to a new request.
   *
   * Without this the termination arbiter judged a new user turn by the
   * previous turn's wave: its workers had (rightly) reported `converged`, so
   * every later `spawn_background_agent` on the chat was refused with
   * "convergence threshold met" and the orchestrator either did the work
   * itself or re-used stale workers. Measured live (2026-09-13): the second
   * delegation on an orchestrator chat could not start a single worker. The
   * time budget and wave cap are per request for the same reason — an
   * orchestrator chat is a conversation, not one 30-minute job.
   */
  private episodeEnded = new Set<string>();
  /**
   * parentChatIds whose running workers were just stopped BY the platform
   * (the orchestrator was stopped, rewound, archived or deleted). Their
   * settling would otherwise read as "the wave finished" and re-prompt the
   * orchestrator to consolidate — restarting a chat the user just stopped.
   */
  private suppressNudge = new Set<string>();

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
  ): Promise<Array<{ ref: string; name: string; description: string; model?: string }>> {
    if (!this.agentService) return [];
    const parent = await this.parentView(parentChatId).catch(() => null);
    const selectable = await this.agentService.listSelectable(parent?.projectId);
    const team = parent?.agentRef
      ? (await this.agentService.getByRef(parent.agentRef))?.orchestration?.teamAgentRefs ?? []
      : [];
    const pool = team.length > 0
      ? selectable.filter((a) => team.includes(a.ref))
      : selectable.filter((a) => a.role !== 'orchestrator');
    return pool.map((a) => ({
      ref: a.ref,
      name: a.name,
      description: a.description,
      ...(a.runtime?.model ? { model: a.runtime.model } : {}),
    }));
  }

  getConfig(): OrchestratorConfig {
    return this.config;
  }

  /** A stage whose agent is an orchestrator can now spawn workers (T6). */
  registerStageParent(parent: StageOrchestratorParent): void {
    this.stageParents.set(parent.stageRunId, parent);
  }

  /**
   * When an orchestrator's current episode runs out of time (P06 WP-6.3):
   * the workflow tools cap `waitSeconds` and a child run's `maxDurationMs`
   * with it. Before the first wave (or after an episode ended) a new
   * episode would start now.
   */
  episodeDeadline(parentChatId: string): number | undefined {
    if (this.config.timeBudgetMs <= 0) return undefined;
    const startedAt = this.episodeEnded.has(parentChatId) ? undefined : this.orchestrationStartedAt.get(parentChatId);
    return (startedAt ?? Date.now()) + this.config.timeBudgetMs;
  }

  /** The stage's session is gone; its workers keep their records. */
  unregisterStageParent(stageRunId: string): void {
    this.stageParents.delete(stageRunId);
  }

  /**
   * PD-5 — the computer-use decision a worker of `parentId` runs under: a
   * registered stage's own, a chat's deployment switch, and none for a parent
   * that is gone (a stage whose session ended, or not yet re-bound after a
   * restart). Read at every compose and turn of the worker (review R5).
   */
  async workerComputerUse(parentId: string): Promise<TurnPolicy['computerUse']> {
    const stage = this.stageParents.get(parentId);
    if (stage) return stage.inherited.computerUse;
    const chat = await this.chatRepo.getById(parentId).catch(() => null);
    return chat ? 'switch' : 'off';
  }

  /** The parent a worker is spawned for: a registered stage, else a chat. */
  private async parentView(parentId: string): Promise<ParentView> {
    const stage = this.stageParents.get(parentId);
    if (stage) {
      return {
        kind: 'stage',
        id: stage.stageRunId,
        sessionId: stage.sessionId,
        ...(stage.projectId ? { projectId: stage.projectId } : {}),
        ...(stage.model ? { model: stage.model } : {}),
        ...(stage.workspaceId ? { workspaceId: stage.workspaceId } : {}),
        ...(stage.agentRef ? { agentRef: stage.agentRef } : {}),
        inherited: stage.inherited,
      };
    }
    const chat = await this.chatRepo.getById(parentId);
    return {
      kind: 'chat',
      id: chat.id,
      sessionId: chat.sessionId,
      ...(chat.projectId ? { projectId: chat.projectId } : {}),
      ...(chat.model ? { model: chat.model } : {}),
      ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      ...(chat.codebaseIds ? { codebaseIds: chat.codebaseIds } : {}),
      ...(chat.gitRepositories ? { gitRepositories: chat.gitRepositories } : {}),
      ...(chat.agentRef ? { agentRef: chat.agentRef } : {}),
      inherited: inheritWorkerCapabilities(chat),
    };
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

    // Enforce max CONCURRENT workers per orchestrator. Finished workers stay
    // on the record (the panel lists them, their digests are re-readable) but
    // they hold no slot: counting them made the cap a lifetime quota, so an
    // orchestrator chat's fourth request could not start a worker at all.
    // A worker holds a slot while it WORKS (spawned/running). One waiting in
    // `needs_review` has finished its turn; its result is a digest to read,
    // not a process to keep.
    const isActive = (st: string | undefined): boolean => st === 'spawned' || st === 'running';
    const active = new Set<string>();
    for (const r of this.tasks.values()) {
      if (r.parentChatId === parentChatId && isActive(r.status)) active.add(r.taskId);
    }
    // Rows the DB still holds as active from before a restart count too.
    const existing = await this.chatRepo.listBackgroundTasks(parentChatId).catch(() => []);
    for (const c of existing) {
      if (isActive(c.backgroundTask?.status)) active.add(c.id);
    }
    const parent = await this.parentView(parentChatId);
    // The orchestrator agent's own settings (agent editor ▸ Team): they were saved and never read.
    const lead = parent.agentRef && this.agentService ? await this.agentService.getByRef(parent.agentRef).catch(() => null) : null;
    const maxWorkers = lead?.orchestration?.maxWorkers ?? this.config.maxWorkers;
    if (active.size >= maxWorkers) {
      return {
        ok: false,
        error: `Worker limit reached (${maxWorkers}). Wait for running workers (check_background_agents) before spawning more.`,
      };
    }

    // A worker agent must be one this orchestrator is allowed to spawn.
    let workerAgentRef: string | undefined;
    let workerAgentName: string | undefined;
    let workerAgentModel: string | undefined;
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
      workerAgentName = hit.name;
      workerAgentModel = hit.model;
    }

    // Resolve + validate the worker model. When the orchestrator doesn't pick
    // one, this defaults to a CHEAPER tier (not the orchestrator's own model)
    // so background work doesn't silently run on an expensive model.
    // A bound agent that names its model runs on it: the person chose it for that agent ("Frontend Dev runs on
    // Codex"), and the orchestrator's habit of passing `model` on every spawn silently moved it to its own pick.
    let workerModel = workerAgentModel ?? (await this.resolveWorkerModel(brief.model, parent.model, lead?.orchestration?.defaultWorkerModel));
    const modelNote =
      workerAgentModel && brief.model && brief.model !== workerAgentModel
        ? `${workerAgentName ?? 'The agent'} runs on its own model "${workerAgentModel}"; the requested "${brief.model}" was not used.`
        : undefined;
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
    // G15 — a worker must never be able to do something its orchestrator
    // could not. Computed before `createChat` so the clamp is part of the
    // creation, not a correction applied afterwards.
    const inherited = parent.inherited;
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
        // G15 — capability inheritance (see `inheritWorkerCapabilities`),
        // the built-in clamp through the resolver (C-15).
        agentOverrides: inherited.agentOverrides,
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
      this.suppressNudge.delete(parentChatId);
      if (this.episodeEnded.delete(parentChatId)) {
        // A new request: the wave count and the clock start over.
        this.waveCount.set(parentChatId, 0);
        this.orchestrationStartedAt.set(parentChatId, Date.now());
      }
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
      ...(workerAgentRef ? { agentRef: workerAgentRef } : {}),
      ...(workerAgentName ? { agentName: workerAgentName } : {}),
      status: 'running',
      wave: this.waveCount.get(parentChatId) ?? 1,
      reviewRounds: 0,
      lastAssistantText: '',
      startedAt: Date.now(),
      toolCalls: 0,
      lastProgressAt: 0,
      idlePromise: Promise.resolve(),
      resolveIdle: () => {},
      firstOutput: Promise.resolve(),
      resolveFirstOutput: () => {},
      unsub: undefined,
      waveSlot: false,
    };
    this.armIdle(record);
    this.tasks.set(record.taskId, record);
    record.waveSlot = true;
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

    return { ok: true, taskId: record.taskId, taskName: record.taskName, status: 'running', model: workerModel, ...(modelNote ? { note: modelNote } : {}) };
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
    record.lastError = undefined;
    record.cancellation = undefined;
    // Back in the wave: its settlement waits on this turn too.
    if (!record.waveSlot) {
      record.waveSlot = true;
      this.activeByParent.set(record.parentChatId, (this.activeByParent.get(record.parentChatId) ?? 0) + 1);
    }
    // A follow-up is a new turn: its progress starts from now, not from the
    // spawn, or the row would report an elapsed time spanning the idle gap.
    record.startedAt = Date.now();
    record.currentStep = undefined;
    record.lastProgressAt = 0;
    // A follow-up within the grace window keeps the worker's process; the
    // release is re-armed when this turn goes idle.
    if (record.releaseTimer) {
      clearTimeout(record.releaseTimer);
      record.releaseTimer = undefined;
    }
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
      // No live record (the server restarted since): the digest is still in the worker chat's messages.
      const chat = await this.chatRepo.getById(taskId).catch(() => null);
      if (chat?.backgroundTask) {
        const persisted = { taskId, status: chat.backgroundTask.status, lastAssistantText: '' } as TaskRecord;
        return { ...(await this.buildDigest(persisted)), taskId, taskName: chat.backgroundTask.taskName };
      }
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

  /**
   * D-89 — the task detail beyond the digest: the brief, the orchestrator's
   * review rounds and the worker's latest steps, read from the worker chat's
   * persisted messages (durable across restarts, unlike the task record).
   * Null when `taskId` is not a worker of `parentChatId`.
   */
  async getBackgroundTaskDetail(parentChatId: string, taskId: string): Promise<BackgroundTaskDetail | null> {
    const chat = await this.chatRepo.getById(taskId).catch(() => null);
    if (!chat || chat.parentChatId !== parentChatId) return null;
    const total = await this.messageRepo.countByChatId(taskId).catch(() => 0);
    const WINDOW = 200;
    const [first] = total > 0 ? await this.messageRepo.getByChatId(taskId, 1, 0) : [];
    const recent = total > 0 ? await this.messageRepo.getByChatId(taskId, WINDOW, Math.max(0, total - WINDOW)) : [];
    const messages = first && recent[0]?.id !== first.id ? [first, ...recent] : recent;

    const briefMessage = messages.find((m) => m.role === 'user');
    const followUps = messages.filter((m) => m.role === 'user' && m !== briefMessage);
    const rounds = followUps.map((m, i) => ({
      round: i + 1,
      at: new Date(m.timestamp).toISOString(),
      request: m.content.length > 4000 ? `${m.content.slice(0, 3999)}…` : m.content,
    }));

    const lastSteps: BackgroundTaskDetail['lastSteps'] = [];
    for (let i = messages.length - 1; i >= 0 && lastSteps.length < 8; i -= 1) {
      const m = messages[i]!;
      if (m.role !== 'assistant') continue;
      const calls = m.metadata?.toolCalls ?? [];
      for (let j = calls.length - 1; j >= 0 && lastSteps.length < 8; j -= 1) {
        const c = calls[j]!;
        lastSteps.unshift({
          id: c.id,
          tool: c.tool,
          ...(c.args !== undefined ? { args: clipArgs(c.args) } : {}),
          status: c.status,
          ...(c.success !== undefined ? { success: c.success } : {}),
          ...(c.fileOp
            ? { fileOp: { kind: c.fileOp.kind, filePath: c.fileOp.filePath, additions: c.fileOp.additions, deletions: c.fileOp.deletions } }
            : {}),
          at: new Date(m.timestamp).toISOString(),
        });
      }
    }

    const record = this.tasks.get(taskId);
    const status: BackgroundTaskStatus = record?.status ?? chat.backgroundTask?.status ?? 'spawned';
    const outcome: BackgroundTaskDetail['outcome'] =
      status === 'completed'
        ? 'accepted'
        : status === 'needs_review'
          ? 'in_review'
          : status === 'failed' || status === 'cancelled'
            ? status
            : rounds.length > 0
              ? 'reworking'
              : 'running';
    const model = record?.model ?? chat.model;
    return {
      taskId,
      taskName: record?.taskName ?? chat.backgroundTask?.taskName ?? chat.name,
      status,
      ...(model ? { model } : {}),
      brief: briefMessage ? parseBrief(briefMessage.content) : null,
      rounds,
      reviewRounds: rounds.length,
      maxReviewRounds: this.config.maxReviewRounds,
      outcome,
      lastSteps,
    };
  }

  async listBackgroundAgents(
    parentChatId: string,
  ): Promise<
    Array<{
      taskId: string;
      taskName: string;
      status: BackgroundTaskStatus;
      model?: string;
      agentRef?: string;
      agentName?: string;
      reviewRounds: number;
      cancelledBy?: BackgroundTaskCancelledBy;
      cancelledAt?: number;
    }>
  > {
    // Prefer in-memory records; fall back to DB for durability across restarts.
    const mem = [...this.tasks.values()].filter((t) => t.parentChatId === parentChatId);
    if (mem.length > 0) {
      return mem.map((t) => ({
        taskId: t.taskId,
        taskName: t.taskName,
        status: t.status,
        model: t.model,
        ...(t.agentRef ? { agentRef: t.agentRef } : {}),
        ...(t.agentName ? { agentName: t.agentName } : {}),
        reviewRounds: t.reviewRounds,
        ...cancellationFields(t.status, t.cancellation),
      }));
    }
    const rows = await this.chatRepo.listBackgroundTasks(parentChatId).catch(() => []);
    return Promise.all(rows.map(async (c) => {
      let status: BackgroundTaskStatus = c.backgroundTask?.status ?? 'spawned';
      // A worker the DB still calls running has no record in this process, so
      // nothing is driving it: its turn died with the previous server process
      // (background turns are fire-and-forget and are not resumed on boot).
      // Left as "running" it spun in the panel forever and blocked the
      // concurrency cap. Say what happened instead.
      if (status === 'running' || status === 'spawned') {
        status = 'failed';
        await this.chatRepo.updateBackgroundTaskStatus(c.id, 'failed').catch(() => undefined);
        void this.emitToParent(this.parentSessions.get(parentChatId) ?? '', {
          kind: 'chat.background_task.failed',
          data: { chatId: parentChatId, parentChatId, taskId: c.id, taskName: c.backgroundTask?.taskName ?? c.name, error: 'Interrupted by a server restart' },
        });
      }
      return {
        taskId: c.id,
        taskName: c.backgroundTask?.taskName ?? c.name,
        status,
        model: c.model,
        ...(c.agentRef ? { agentRef: c.agentRef } : {}),
        ...(c.agentSnapshot?.driving?.name ? { agentName: c.agentSnapshot.driving.name } : {}),
        reviewRounds: 0,
        ...(status === 'cancelled' && c.backgroundTask?.cancelledBy && c.backgroundTask.cancelledAt !== undefined
          ? { cancelledBy: c.backgroundTask.cancelledBy, cancelledAt: c.backgroundTask.cancelledAt }
          : {}),
      };
    }));
  }

  /**
   * Stop every worker still running under an orchestrator — the user pressed
   * Stop on the orchestrator (or rewound past the turn that spawned them), so
   * nobody will read what they produce. Claude Code and Codex end their
   * sub-agents on interrupt for the same reason; leaving ours running kept
   * burning tokens on files the orchestrator would never verify.
   */
  async cancelWorkersForParent(parentChatId: string, reason = 'orchestrator stopped'): Promise<string[]> {
    const cancelled: string[] = [];
    this.suppressNudge.add(parentChatId);
    for (const record of this.tasks.values()) {
      if (record.parentChatId !== parentChatId) continue;
      if (record.status !== 'running' && record.status !== 'spawned') continue;
      record.lastError = `cancelled:${reason}`;
      await this.cancelBackgroundAgent(record.taskId, 'orchestrator');
      cancelled.push(record.taskId);
    }
    return cancelled;
  }

  /**
   * Cancel a running worker (abort its turn), attributed to `by` (G-20):
   * `user` for the Tasks panel's Cancel, `orchestrator` for the cascade when
   * the orchestrator chat stops. The attribution is recorded BEFORE the turn
   * is aborted, so the `harness.cancelled` / `harness.idle` the abort produces
   * keep it instead of reading as a Stop inside the worker chat. Returns the
   * attribution, or null for an unknown task.
   */
  async cancelBackgroundAgent(
    taskId: string,
    by: BackgroundTaskCancelledBy = 'user',
  ): Promise<BackgroundTaskCancellation | null> {
    const record = this.tasks.get(taskId);
    // Read before the abort: its `harness.idle` may settle the record first.
    const alreadyCancelled = record?.status === 'cancelled';
    const cancellation: BackgroundTaskCancellation = record?.cancellation ?? { cancelledBy: by, cancelledAt: Date.now() };
    if (record) {
      record.cancellation = cancellation;
      // So the idle this abort produces settles as `cancelled` even when the
      // provider sends no `harness.cancelled` first.
      if (!record.lastError?.startsWith('cancelled:')) record.lastError = `cancelled:${by}`;
    }
    try {
      await this.chatManagementService.cancelTurn(taskId);
    } catch {
      // Non-fatal.
    }
    if (!record) {
      const chat = await this.chatRepo.getById(taskId).catch(() => null);
      if (!chat?.backgroundTask) return null;
      const prior = chat.backgroundTask;
      if (prior.status === 'cancelled' && prior.cancelledBy && prior.cancelledAt !== undefined) {
        return { cancelledBy: prior.cancelledBy, cancelledAt: prior.cancelledAt };
      }
      await this.chatRepo.updateBackgroundTaskStatus(taskId, 'cancelled', cancellation).catch(() => {});
      return cancellation;
    }
    const changed = !alreadyCancelled;
    record.status = 'cancelled';
    record.resolveIdle();
    await this.chatRepo.updateBackgroundTaskStatus(taskId, 'cancelled', cancellation).catch(() => {});
    if (changed) {
      await this.emitToParent(record.parentSessionId, {
        kind: 'chat.background_task.status',
        data: {
          chatId: record.parentChatId,
          parentChatId: record.parentChatId,
          taskId,
          taskName: record.taskName,
          status: 'cancelled',
          ...cancellation,
        },
      });
    }
    return cancellation;
  }

  /**
   * Re-invoke an idle orchestrator once its whole wave has settled.
   * No-op when the parent is mid-turn (the completion events already reached
   * its live stream) or when the chat is gone/archived.
   */
  private async nudgeParentAfterWave(parentChatId: string): Promise<void> {
    if (this.suppressNudge.has(parentChatId)) return;
    // A stage parent collects its digests through check_* within its own
    // turn; the stage conversation cannot be prompted from here (P03b posts
    // the nudge as a stage conversation message).
    if (this.stageParents.has(parentChatId)) return;
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
    // The previous request is over; nothing about it may block this one.
    if (this.episodeEnded.has(parentChatId)) return { shouldStop: false };
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

  /**
   * Emit `chat.background_task.progress` for one worker on the PARENT chat
   * scope — the same path `chat.background_task.status` takes, so the parent's
   * transcript and the Background Tasks panel see it on one connection.
   *
   * Throttled to at most one event per `PROGRESS_THROTTLE_MS` per worker
   * (`force` bypasses it for the final emit on idle). Silently no-ops when the
   * worker is not in a live wave.
   */
  private emitWorkerProgress(record: TaskRecord, force = false): void {
    const now = Date.now();
    if (!force && now - record.lastProgressAt < PROGRESS_THROTTLE_MS) return;
    record.lastProgressAt = now;
    void this.emitToParent(record.parentSessionId, {
      kind: 'chat.background_task.progress',
      data: {
        chatId: record.parentChatId,
        parentChatId: record.parentChatId,
        taskId: record.taskId,
        taskName: record.taskName,
        status: record.status,
        ...(record.currentStep ? { currentStep: record.currentStep } : {}),
        ...(record.lastAssistantText
          ? { lastText: record.lastAssistantText.slice(-PROGRESS_TEXT_TAIL) }
          : {}),
        toolCalls: record.toolCalls,
        startedAt: record.startedAt,
      },
    });
  }

  private onWorkerEvent(record: TaskRecord, event: { kind: string; data?: unknown }): void {
    const data = event.data as Record<string, unknown> | undefined;
    switch (event.kind) {
      case 'harness.token':
        record.resolveFirstOutput();
        record.currentStep = 'writing';
        this.emitWorkerProgress(record);
        break;
      case 'harness.reasoning_delta':
        record.resolveFirstOutput();
        record.currentStep = 'thinking';
        this.emitWorkerProgress(record);
        break;
      case 'harness.tool_start': {
        record.resolveFirstOutput();
        record.toolCalls += 1;
        const tool = (data?.['tool'] as string) || 'tool';
        record.currentStep = tool;
        // A tool call is the single most informative thing a worker does, so
        // it is never swallowed by the throttle — the row would otherwise sit
        // on a stale "writing" for the length of a long build.
        this.emitWorkerProgress(record, true);
        break;
      }
      case 'harness.message_complete': {
        const content = (data?.['content'] as string) ?? '';
        if (content.length > record.lastAssistantText.length) {
          record.lastAssistantText = content;
        }
        this.emitWorkerProgress(record);
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
        // G-20: nothing attributed it first (the route and the cascade do), so
        // this is Stop pressed inside the worker chat — the user's.
        record.cancellation ??= { cancelledBy: 'user', cancelledAt: Date.now() };
        break;
      case 'harness.idle': {
        // A second idle for the same activation (a stop emits one from the
        // provider and one from the chat service) has nothing left to settle.
        if (!record.waveSlot) break;
        record.waveSlot = false;
        record.resolveFirstOutput();
        const hasDigest = TASK_RESULT_OPEN.test(record.lastAssistantText);
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
        // One last, unthrottled progress event so the worker's row settles on
        // what it actually ended on rather than on whatever the throttle let
        // through last.
        record.currentStep = undefined;
        this.emitWorkerProgress(record, true);
        void this.chatRepo
          .updateBackgroundTaskStatus(
            record.taskId,
            finalStatus,
            finalStatus === 'cancelled' ? record.cancellation : undefined,
          )
          .catch(() => {});
        this.scheduleWorkerRelease(record);
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
            ...cancellationFields(finalStatus, record.cancellation),
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
        // A stopped turn leaves an empty assistant row; the answer is the last
        // one that actually says something.
        if (msgs[i]!.role === 'assistant' && msgs[i]!.content.trim()) {
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
    const body = taskResultBody(text);
    if (!body) return null;
    let raw = body;
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
  private async resolveWorkerModel(
    briefModel: string | undefined,
    parentModel: string | undefined,
    leadDefault?: string | undefined,
  ): Promise<string | undefined> {
    if (briefModel) return briefModel;
    if (leadDefault) return leadDefault;
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
    // The orchestrator answered; whatever it spawns next is a new request.
    // The persisted wave state goes too: it exists so a restart MID-request
    // keeps the request's budget, and a request that has been answered has no
    // budget left to keep — read back after a restart it refused every later
    // spawn with "time budget exhausted" once the chat was half an hour old.
    if (!this.waveOpen.has(parentChatId)) {
      this.episodeEnded.add(parentChatId);
      void this.chatRepo.clearOrchestratorWaveState(parentChatId).catch(() => undefined);
    }
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

  /**
   * Tear down a finished worker's harness runtime.
   *
   * A worker is a single-purpose chat; once it has gone idle its CLI process
   * (~230 MB on the persistent-session Claude provider) has nothing left to
   * do. Nothing released it: the idle sweep was the only reclaim path, and
   * the process outlived the orchestration by the whole idle window. The
   * worker's transcript is in the database, so the parent's digests and the
   * user's "open this worker" both keep working — `ChatManagementService`
   * resumes a non-live conversation from the persisted session on the next
   * prompt.
   *
   * A short grace window keeps the process for a review round
   * (`sendToBackgroundAgent`) that follows immediately, which is the common
   * shape of a review loop; the timer is cleared there.
   */
  private scheduleWorkerRelease(record: TaskRecord): void {
    if (record.releaseTimer) clearTimeout(record.releaseTimer);
    const timer = setTimeout(() => {
      record.releaseTimer = undefined;
      if (record.status === 'running') return;
      void (async () => {
        const session = await this.sessionRepo.getById(record.workerSessionId);
        const conversationId = session?.conversationId;
        if (!conversationId || !this.harness.hasLiveConversation(conversationId)) return;
        await this.harness.destroyConversation(conversationId);
      })().catch(() => {
        /* best effort — the idle sweep is the backstop */
      });
    }, this.config.workerReleaseGraceMs ?? DEFAULT_WORKER_RELEASE_GRACE_MS);
    timer.unref?.();
    record.releaseTimer = timer;
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
      const parent = await this.parentView(parentChatId);
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

/** `<TASK_RESULT>`, tolerating the stray spaces models emit ("< TASK_RESULT>"). */
const TASK_RESULT_OPEN = /<\s*TASK_RESULT\s*>/i;

/**
 * The text inside a worker's `<TASK_RESULT>` block, or null. Tolerates whitespace inside the tags and a missing
 * closing tag at the end of the message — a reviewer's digest arrived as "< TASK_RESULT>{…}" and the orchestrator
 * got the raw JSON as an unstructured summary.
 */
export function taskResultBody(text: string): string | null {
  const m = /<\s*TASK_RESULT\s*>\s*([\s\S]*?)\s*(?:<\s*\/\s*TASK_RESULT\s*>|$)/i.exec(text);
  const body = m?.[1]?.trim();
  return body ? body : null;
}
