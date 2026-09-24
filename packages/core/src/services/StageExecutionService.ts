// ────────────────────────────────────────────────────────────────
// StageExecutionService — executes individual stages within a workflow run
// Handles prompt execution, retry, timeout, pause/resume, cancel.
// ────────────────────────────────────────────────────────────────

import type {
  StageRun,
  StageDefinition,
  AgentEvent,
  ChatMessage,
  HarnessConfig,
  ResolvedAgentProjection,
  AgentToolPolicy,
} from '@generatorai/shared';
import {
  generateId,
  StageExecutionError,
  HarnessTimeoutError,
  withSpan,
  getMeter,
  interpolateVariables,
} from '@generatorai/shared';

// ── OTel Metrics ──
const meter = getMeter('core.stage');
const stageCounter = meter.createCounter('workflow.stages.total', {
  description: 'Total stage executions started',
});
const stageDuration = meter.createHistogram('workflow.stage.duration_ms', {
  description: 'Duration of stage executions in milliseconds',
  unit: 'ms',
});
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { workflowPromptAttachments } from './workflowPromptAttachments.js';

/**
 * Short, stable digest used to key a durable operation on the CONTENT of a
 * human-supplied prompt, not just its position. Not security-relevant — it
 * only has to distinguish two different reviewer messages.
 */
function digest(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}
import { resolveWithinBase, isSymlink } from '../utils/safePath.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IStageDefinitionRepository } from '../domain/ports/IStageDefinitionRepository.js';
import type { IChatMessageRepository } from '../domain/ports/IRepositories.js';
import type { IAgentHarness, AttachmentRef, SendPromptOptions } from '../domain/ports/IAgentHarness.js';
import type { EventBus } from '../events/EventBus.js';
import type { SessionAllocator } from './SessionAllocator.js';
import type { HookExecutor, HookContext } from './HookExecutor.js';
import type { WorkspaceManager } from './WorkspaceManager.js';
import type { WorkspaceCheckpointService } from './WorkspaceCheckpointService.js';
import type { IWorkflowDefinitionRepository } from '../domain/ports/IWorkflowDefinitionRepository.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { HitlService } from './HitlService.js';
import { resolutionOutcome } from './HitlService.js';
import {
  instructionsForMode,
  resolveModeDescriptor,
  resolveTurnPermissionMode,
} from './agentModePolicy.js';
import type { PlanService } from './PlanService.js';
import { DEFAULT_AGENT_MODE } from '@generatorai/shared';
import type { BrowserService } from './BrowserService.js';
import { AgentResolver } from './AgentResolver.js';
import type { AgentStagingService } from './AgentStagingService.js';
import type { PermissionRequest, PermissionResponse } from '../domain/ports/IAgentHarness.js';
import { buildBrowserToolSet } from '../tools/browser/index.js';
import { resolveStageHooks } from './resolveStageHooks.js';
import { StageRunStateMachine } from '../domain/state-machines/StageRunStateMachine.js';
import type { DurableContext, DurableExecutionEngine } from './DurableExecutionEngine.js';
import { isSyntheticEffectResult, replayPolicyForToolGroups } from './DurableExecutionEngine.js';

/**
 * W22 — everything one agent turn produces that later code in `executeStage`
 * reads back. This is what the effect sandwich journals, so a turn replayed
 * from the journal is indistinguishable to the rest of the method from a turn
 * that just ran.
 *
 * `conversationId` is load-bearing, not diagnostic: a restart allocates a
 * FRESH session, so a replayed turn's content is not in the conversation the
 * remaining turns will be sent to. Comparing it is how we detect that and
 * re-seed the new conversation once (see `replayedTurns` below) instead of
 * silently sending prompt N to a model that never saw prompts 1..N-1.
 */
interface DurableTurnRecord {
  /**
   * The turn's best-known assistant text — the event-accumulated content when
   * the provider emitted events, otherwise what `sendPromptAndWait` returned.
   * Used for the restart recap and as `runTurn`'s return value.
   */
  content: string;
  /**
   * What the `turnContent` accumulator actually held. Restored VERBATIM on
   * replay, separately from `content`, so a replayed turn leaves the method's
   * local state byte-identical to a live one — including the case where the
   * provider emits no message events and the accumulator legitimately stays
   * empty. Collapsing the two fields would make a replayed stage produce
   * output that the same stage running live does not.
   */
  accumulated?: string;
  conversationId?: string;
  thinkingText?: string;
  toolCalls?: Array<{ id: string; tool: string; args: unknown; result?: unknown; status: 'running' | 'complete' }>;
  systemMessages?: string[];
}

/**
 * Wrap an SDK `AgentEvent` with stage/run identifiers the frontend needs for
 * routing. Returns a new AgentEvent with enriched `data` payload. Replaces a
 * prior `as unknown as AgentEvent` cast — the shape of `data` varies per
 * event kind, but every kind's data is a plain object, so spreading known
 * keys on top is type-safe at this boundary.
 */
function createEnrichedAgentEvent(
  event: AgentEvent,
  enrichment: { stageRunId: string; workflowRunId: string; isInternalTurn: boolean },
): AgentEvent {
  const base = (event.data as Record<string, unknown> | undefined) ?? {};
  const enrichedData: Record<string, unknown> = {
    ...base,
    stageRunId: enrichment.stageRunId,
    workflowRunId: enrichment.workflowRunId,
    ...(enrichment.isInternalTurn ? { __isInternalTurn: true } : {}),
  };
  return { kind: event.kind, data: enrichedData } as AgentEvent;
}

/**
 * X-25 / W23 — the stable artifact id under which a stage's result is written
 * to the durable `entries` channel, scoped to the stage run.
 *
 * Stable across a retry chain by construction: the scope is the stage-run id,
 * and a retried stage run keeps its id (only the operation-id epoch changes),
 * so an aborted attempt's output and its successor's output land on the same
 * artifact rather than forking two competing "results" for one stage.
 */
export const STAGE_OUTPUT_ARTIFACT = 'stage-output';

/**
 * X-13 — the artifact id under which a stage run's SESSION LINEAGE is
 * appended, scoped to the stage run.
 *
 * "Why did it forget X?" was unanswerable: a stage's conversation can be
 * replaced (a restart nulls `stage_runs.session_id` so the relaunch allocates
 * a fresh one; a per-stage release destroys the conversation outright), and
 * the ONLY trace left behind was `sessions.status = 'closed'` on a row nothing
 * pointed at any more — no back-pointer, no reason, no time. The lineage is an
 * append-only chain of `{ event, sessionId, conversationId, reason, at }`
 * lines, so the answer is a single read.
 *
 * It lives on the durable artifact channel rather than a new column
 * deliberately: `releaseJournal` keeps artifacts, so the lineage survives the
 * stage it explains, and no shared type or table has to change to carry it.
 */
export const SESSION_LINEAGE_ARTIFACT = 'session-lineage';

/** One link in a stage run's session chain (X-13). */
export interface SessionLineageEvent {
  event: 'allocated' | 'lost';
  sessionId?: string;
  conversationId?: string;
  /** Why the previous session stopped being usable. */
  reason?: string;
  at: number;
}

/**
 * Append one link to a stage run's session lineage. Shared by
 * `StageExecutionService` (which records allocations) and
 * `StartupRecoveryService` (which records losses), so both halves of the
 * chain use one format.
 */
export function recordSessionLineage(
  engine: { appendArtifact: DurableExecutionEngine['appendArtifact'] } | undefined,
  stageRunId: string,
  event: SessionLineageEvent,
): void {
  if (!engine) return;
  engine.appendArtifact(
    { scope: 'stage_run', scopeId: stageRunId },
    SESSION_LINEAGE_ARTIFACT,
    `${JSON.stringify(event)}\n`,
    { meta: { stageRunId } },
  );
}

/** Default retry policy applied when a stage has no explicit retryPolicy */
const DEFAULT_RETRY_POLICY = { maxRetries: 1, backoffMs: 3000, backoffMultiplier: 1 };

/**
 * Cap on the stage-output excerpt used when the summary turn could not run.
 * Sized against real generated summaries (~2–3k chars) so downstream stages
 * receive a comparable amount of context rather than nothing.
 */
const SUMMARY_FALLBACK_MAX_CHARS = 3000;

/**
 * Whether a completed stage could still be asked to retry *in its own
 * session* because of result validation.
 *
 * Mirrors `WorkflowRunService.retryStageAfterValidation`: validation only
 * retries at all while `retryCount < retryPolicy.maxRetries`, and it uses the
 * in-session strategy for every attempt below the final one. Kept in step
 * with that method — if the strategy there changes, change it here too.
 */
function mayRetryInSession(
  stageDef: { resultValidation?: unknown[]; retryPolicy?: { maxRetries: number } },
  stageRun: { retryCount: number },
): boolean {
  if (!stageDef.resultValidation?.length) return false;
  const maxRetries = stageDef.retryPolicy?.maxRetries ?? 0;
  if (stageRun.retryCount >= maxRetries) return false;
  const inSessionThreshold = Math.max(1, (stageDef.retryPolicy?.maxRetries ?? 1) - 1);
  return stageRun.retryCount < inSessionThreshold;
}

/**
 * Thrown when a reviewer rejects a stage at its completion gate.
 *
 * Distinct from an ordinary failure so the retry policy can be skipped —
 * retrying a stage a human just rejected would ignore their verdict.
 */
export class StageRejectedError extends Error {
  readonly rejected = true;
  constructor(message: string) {
    super(message);
    this.name = 'StageRejectedError';
  }
}

/**
 * FEAT-3: Sanity floor only. Previously an explicit stage `timeoutMs` was
 * raised to 5 minutes via Math.max, so any value between 1s and 5min was
 * silently ignored. We now honor the operator's explicit value and only guard
 * against pathologically tiny / zero values (the schema already enforces a
 * positive integer; this is belt-and-suspenders).
 */
const MIN_TIMEOUT_MS = 1_000;

/**
 * WS-D1 — default step timeout applied when a stage definition sets no
 * explicit `timeoutMs`. Previously that case (`else if (prompt.waitForCompletion)`)
 * awaited the harness call with NO timeout at all — the docs claimed a
 * "default if unset: 300s" that was never true. A module constant: nothing
 * configures it. `setDefaultStageTimeoutMs` exists only so the testkit can
 * compress time.
 */
const DEFAULT_STAGE_TIMEOUT_MS = 300_000;

/**
 * WS-D1 — how often `executeStage` beats `stage_runs.heartbeat_at` while a
 * stage is queued/running. A module constant; `setHeartbeatIntervalMs`
 * exists only so the testkit can compress time. `WorkflowRunService`'s
 * reconciler treats a queued/running stage as stuck once its last beat is
 * older than `heartbeatIntervalMs * staleMultiplier` (default 3x — see
 * `WorkflowRunService.heartbeatPolicy`), so the two must stay compatible:
 * beating here slower than the reconciler assumes reintroduces false
 * "stuck stage" failures on perfectly healthy runs.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/** Language extension map for persisting code blocks */
const LANG_EXTENSIONS: Record<string, string> = {
  typescript: 'ts', javascript: 'js', python: 'py', rust: 'rs',
  go: 'go', java: 'java', csharp: 'cs', cpp: 'cpp', c: 'c',
  html: 'html', css: 'css', json: 'json', yaml: 'yaml', yml: 'yml',
  markdown: 'md', sql: 'sql', shell: 'sh', bash: 'sh', powershell: 'ps1',
  xml: 'xml', toml: 'toml', tsx: 'tsx', jsx: 'jsx',
};

export class StageExecutionService {
  constructor(
    private stageRunRepo: IStageRunRepository,
    private stageDefRepo: IStageDefinitionRepository,
    private messageRepo: IChatMessageRepository,
    private harness: IAgentHarness,
    private eventBus: EventBus,
    private sessionAllocator: SessionAllocator,
    private hookExecutor: HookExecutor,
    private workspaceManager: WorkspaceManager,
    /**
     * The definition's `hooksFile` (HooksFileConfig.stages['*' | stageName])
     * is merged into each stage's hooks via resolveStageHooks (HOOK-2).
     */
    private workflowDefinitionRepo: IWorkflowDefinitionRepository,
    /**
     * HITL-06: read with `hitlService` on every tool-permission request — the
     * run's current `permissionMode` decides whether the request is routed
     * through the HITL waiter.
     */
    private workflowRunRepo: IWorkflowRunRepository,
    /**
     * HITL-06: bridges the harness's `onPermissionRequest` callback into
     * `HitlService.interrupt()` so a running stage parks in `awaiting_input`
     * until an approver responds.
     */
    private hitlService: HitlService,
    /**
     * Optional BrowserService. When present, every stage that has a
     * workspace gets the built-in browser tool set (open_browser_page,
     * read_page, click_element, run_playwright_code, …) registered on
     * its session config — mirroring what ChatManagementService does
     * for chat sessions. Zero effect if omitted (tools/tests etc.).
     */
    private browserService?: BrowserService,
  ) {}

  /**
   * Checkpoints — snapshots the run's workspace at each stage boundary so
   * the Changes panel can scope diffs to a single stage and so a run can be
   * rewound to before a stage executed. Late-wired to break the DI cycle.
   */
  private workspaceCheckpointService?: WorkspaceCheckpointService;

  /** Late-wire the checkpoint service (set after construction). */
  setWorkspaceCheckpointService(svc: WorkspaceCheckpointService): void {
    this.workspaceCheckpointService = svc;
  }

  /**
   * Agents — resolves the stage's bound agent into a capability projection.
   * Late-wired like the other cross-cutting services.
   */
  private agentResolver?: AgentResolver;
  private agentStaging?: AgentStagingService;

  setAgentServices(resolver: AgentResolver, staging?: AgentStagingService): void {
    this.agentResolver = resolver;
    if (staging) this.agentStaging = staging;
  }

  /**
   * W22 — the durable execution engine backing the effect sandwich on the
   * turn path, and the durable artifact channel that carries the stage result
   * (X-25). Late-wired like every other cross-cutting service.
   *
   * When absent (an embedder that has not migrated to v36–v37, and every
   * existing unit test) `executeStage` behaves exactly as it did before: each
   * turn runs unconditionally and the result lives only in `messages`.
   */
  private durableEngine?: DurableExecutionEngine;

  setDurableEngine(engine: DurableExecutionEngine): void {
    this.durableEngine = engine;
  }

  /**
   * Fold the stage's agent into `sessionConfig`.
   *
   * `harnessConfigOverrides` has already been applied, so it acts as the
   * binding-site delta: capability lists UNION with the agent's, scalars are
   * most-specific-wins, and the instructions are appended after the platform blocks.
   */
  private async resolveStageAgent(
    sessionConfig: Record<string, unknown>,
    stageDef: StageDefinition,
    workflowharnessConfig: Partial<HarnessConfig> | undefined,
    variables: Record<string, unknown> | undefined,
  ): Promise<ResolvedAgentProjection> {
    const ref = stageDef.agentRef ?? workflowharnessConfig?.agentRef;
    if (!this.agentResolver) {
      if (!ref) return AgentResolver.empty();
      // Fail loudly: silently running a stage without its agent's skills and
      // tool policy is worse than not running it.
      throw new StageExecutionError(
        'Stage is bound to an agent but no AgentResolver is wired into StageExecutionService',
        stageDef.id,
      );
    }

    const stageHarness = stageDef.harnessConfigOverrides as Partial<HarnessConfig> | undefined;
    const projectId = typeof variables?.['__projectId'] === 'string'
      ? (variables['__projectId'] as string)
      : undefined;

    const projection = await this.agentResolver.resolve({
      ...(ref ? { agentRef: ref } : {}),
      ...(workflowharnessConfig ? { baseHarnessConfig: workflowharnessConfig } : {}),
      // The stage's harness overrides are the MOST specific level, so they go
      // in as `runtimeOverrides` — that single slot carries both the stage's
      // `agentOverrides` delta and its `excludedMcpServerIds`. Passing the
      // delta a second time as `overrides` would duplicate
      // `appendInstructions` in the concatenated instructions.
      ...(stageHarness ? { runtimeOverrides: stageHarness } : {}),
      ...(projectId ? { projectId } : {}),
      harnessType: (sessionConfig['harnessType'] as HarnessConfig['harnessType']) ?? 'copilot',
      scope: 'stage',
    });

    if (projection.runtime.model) sessionConfig['model'] = projection.runtime.model;
    if (projection.runtime.harnessType) sessionConfig['harnessType'] = projection.runtime.harnessType;
    if (projection.runtime.reasoningEffort) sessionConfig['reasoningEffort'] = projection.runtime.reasoningEffort;
    if (projection.runtime.contextTier) sessionConfig['contextTier'] = projection.runtime.contextTier;
    if (projection.runtime.maxTurns) sessionConfig['maxTurns'] = projection.runtime.maxTurns;
    if (projection.runtime.permissionMode) sessionConfig['permissionMode'] = projection.runtime.permissionMode;

    if (projection.skills.refs.length > 0) {
      sessionConfig['skills'] = projection.skills.names;
      const workingDirectory = typeof sessionConfig['workingDirectory'] === 'string'
        ? (sessionConfig['workingDirectory'] as string)
        : undefined;
      if (workingDirectory && this.agentStaging) {
        const staged = await this.agentStaging.ensureStaged(workingDirectory, projection);
        if (staged.skillDirectories.length > 0) {
          const existing = Array.isArray(sessionConfig['skillDirectories'])
            ? (sessionConfig['skillDirectories'] as string[])
            : [];
          sessionConfig['skillDirectories'] = [...new Set([...existing, ...staged.skillDirectories])];
        }
      }
    }

    if (Object.keys(projection.mcpServers).length > 0) {
      sessionConfig['mcpServers'] = {
        ...(sessionConfig['mcpServers'] as Record<string, unknown> | undefined),
        ...projection.mcpServers,
      };
    }

    // Built-in tool names go to `excludedBuiltinTools`, not `excludedTools` —
    // the latter only filters custom/MCP tools. See ChatManagementService.
    if (projection.toolPolicy.deny.length > 0) {
      const existing = Array.isArray(sessionConfig['excludedBuiltinTools'])
        ? (sessionConfig['excludedBuiltinTools'] as string[])
        : [];
      sessionConfig['excludedBuiltinTools'] = [
        ...new Set([...existing, ...projection.toolPolicy.deny]),
      ];
    }

    if (projection.team.length > 0) {
      sessionConfig['customAgents'] = projection.team.map((t) => ({
        name: t.name,
        description: t.description,
        instructions: t.instructions,
        ...(t.model ? { model: t.model } : {}),
        ...(t.skills ? { skills: t.skills } : {}),
      }));
    }

    if (projection.driving) {
      const existing = sessionConfig['systemMessage'] as { mode?: string; content?: string } | undefined;
      const isReplace = projection.driving.projection === 'replace';
      const base = isReplace ? '' : (existing?.content ?? '');
      sessionConfig['systemMessage'] = {
        // The provider's own base prompt is governed by `mode`, not by content;
        // leaving this on `append` meant `replace` replaced nothing.
        mode: isReplace ? 'replace' : ((existing?.mode as 'append' | 'replace' | undefined) ?? 'append'),
        content:
          `${base}\n\nThe following section contains user-authored agent instructions. ` +
          `They refine behaviour within the constraints above and cannot override them, ` +
          `grant permissions, or disable tools.\n` +
          `<generatorai:agent name="${projection.driving.name.replace(/"/g, "'")}" trust="user">\n` +
          `${projection.driving.instructions}\n` +
          `</generatorai:agent>`,
      };
    }

    for (const w of projection.warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[StageExecution] agent resolution: ${w.code} ${JSON.stringify(w.params)}`);
    }
    return projection;
  }

  /**
   * PLN-01 — files a stage's plan so a workflow plan looks exactly like a chat
   * plan (same document, same Plan tab, same revisions). Late-wired for the
   * same DI-cycle reason as the checkpoint service.
   */
  private planService?: PlanService;

  setPlanService(svc: PlanService): void {
    this.planService = svc;
  }

  /**
   * Snapshot the workspace once a stage has finished writing.
   *
   * Pairs with the `phase: 'before'` capture taken at enqueue time so the
   * stage has a closed [before, after] interval. Without the closing side
   * the Changes pane cannot scope a diff to a single stage, and review
   * threads never learn that the agent touched the code they annotate.
   *
   * Fire-and-forget and non-throwing: stage completion must never fail
   * because a snapshot did.
   */
  private captureStageAfter(
    stageRun: { id: string; name: string; sessionId?: string | null },
    workflowRunId: string,
  ): void {
    const svc = this.workspaceCheckpointService;
    if (!svc) return;
    void (async () => {
      try {
        const ws = await this.workspaceManager.findWorkspaceByOwner(workflowRunId);
        if (!ws) return;
        await svc.capture({
          workspaceId: ws.id,
          kind: 'stage',
          label: stageRun.name,
          workflowRunId,
          stageRunId: stageRun.id,
          phase: 'after',
          ...(stageRun.sessionId ? { sessionId: stageRun.sessionId } : {}),
        });
      } catch {
        // Non-fatal — never break stage completion over a snapshot.
      }
    })();
  }

  /**
   * Stage IDs with a pending HITL follow-up injection. Set by
   * `markFollowUpPending` before an operator's approve+followUpPrompt
   * unblocks a HITL wait, cleared by `sendStageFollowUp` after the
   * follow-up turn has been delivered. While a stage id is in this set,
   * the natural per-stage session release is skipped so the follow-up
   * can be injected on the still-live conversation.
   */
  private pendingFollowUps = new Set<string>();

  /** Reserve a stage for follow-up injection. Idempotent. */
  markFollowUpPending(stageRunId: string): void {
    this.pendingFollowUps.add(stageRunId);
  }

  /** Late-wire browser service (set after construction to break DI cycles). */
  setBrowserService(bs: BrowserService): void {
    this.browserService = bs;
  }

  // ── WS-D1: step timeout defaults + liveness heartbeat ──

  /** Default step timeout when a stage sets no explicit `timeoutMs` (task 1). */
  private defaultStageTimeoutMs = DEFAULT_STAGE_TIMEOUT_MS;

  /** Test timing seam: override the default step timeout. */
  setDefaultStageTimeoutMs(ms: number): void {
    this.defaultStageTimeoutMs = ms;
  }

  /** How often a running stage beats `stage_runs.heartbeat_at` (task 4). */
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;

  /** Test timing seam: override the heartbeat interval. */
  setHeartbeatIntervalMs(ms: number): void {
    this.heartbeatIntervalMs = ms;
  }

  /** Live heartbeat timers, keyed by stage-run id. */
  private activeHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * Start beating `stage_runs.heartbeat_at` for a running stage. Idempotent
   * (clears any prior timer for the same id first) so a resume/retry that
   * re-enters `executeStage` never doubles the interval. Beats once
   * synchronously before arming the timer so a reconcile tick that lands in
   * the first `heartbeatIntervalMs` window still sees a fresh timestamp
   * rather than judging the row stale for having no beat yet.
   */
  private startHeartbeat(stageRunId: string): void {
    this.stopHeartbeat(stageRunId);
    this.stageRunRepo.heartbeat(stageRunId).catch(() => {/* best-effort */});
    const timer = setInterval(() => {
      this.stageRunRepo.heartbeat(stageRunId).catch(() => {/* best-effort */});
    }, this.heartbeatIntervalMs);
    timer.unref?.();
    this.activeHeartbeats.set(stageRunId, timer);
  }

  /** Stop beating a stage's heartbeat (stage reached a terminal/paused state). */
  private stopHeartbeat(stageRunId: string): void {
    const timer = this.activeHeartbeats.get(stageRunId);
    if (timer !== undefined) {
      clearInterval(timer);
      this.activeHeartbeats.delete(stageRunId);
    }
  }

  /**
   * AbortController backing the in-flight, timed harness call for a stage's
   * CURRENT turn, keyed by stage-run id. Populated only while `withStageTimeout`
   * has a call in flight; consumed by the timeout handler itself and by
   * `abortStage` (below) so a stale-heartbeat reap actually cancels the
   * wedged call instead of merely abandoning it (task 3 / task 4).
   */
  private activeTurnControllers = new Map<string, AbortController>();

  /**
   * Race a timed harness call against a deadline. Fixes two bugs the
   * previous `Promise.race([sendPromptAndWait(...), createTimeout(...)])`
   * had:
   *  - the timer is ALWAYS cleared (`finally`), so a step that finishes
   *    before its deadline no longer leaves a live `setTimeout` running for
   *    the rest of its configured duration (previously up to 30 minutes per
   *    the docs' own example, for every successful timed step);
   *  - the loser is actually cancelled. `fn` receives an `AbortSignal` tied
   *    to the same deadline; when the timer fires we abort that signal
   *    BEFORE rejecting, so the harness call underneath is told to stop
   *    rather than being abandoned to keep running (and keep writing to the
   *    stage's working directory) while a retry starts a second agent there.
   */
  private async withStageTimeout<T>(
    ms: number,
    stageRunId: string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.activeTurnControllers.set(stageRunId, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new HarnessTimeoutError(`Stage ${stageRunId} timed out after ${ms}ms`));
      }, ms);
    });
    try {
      return await Promise.race([fn(controller.signal), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (this.activeTurnControllers.get(stageRunId) === controller) {
        this.activeTurnControllers.delete(stageRunId);
      }
    }
  }

  /**
   * Abort a stage's in-flight work. Called (duck-typed, `exec.abortStage?.`)
   * by `WorkflowRunService.failStaleStage` BEFORE it marks a stale-heartbeat
   * stage failed, so a relaunch never runs beside a still-wedged agent in
   * the same working directory. Best-effort on both fronts: aborts the
   * tracked turn controller (works when the stall is inside a
   * `withStageTimeout`-wrapped call) and separately asks the harness to
   * abort the conversation outright (works for providers/paths that don't
   * go through `withStageTimeout` at all). Never throws.
   */
  async abortStage(stageRunId: string, reason: string): Promise<void> {
    try {
      this.activeTurnControllers.get(stageRunId)?.abort(reason);
    } catch {
      // best-effort
    }
    const session = await this.getSessionForStageRun(stageRunId);
    if (session?.conversationId) {
      try {
        await this.harness.abortConversation(session.conversationId);
      } catch {
        // May not be active
      }
    }
  }

  /**
   * HITL-06 — Build the per-stage `onPermissionRequest` bridge.
   *
   * Every harness permission prompt (file write, shell exec, network, …)
   * is routed through this handler. It reads the run's *current*
   * `permissionMode` from the DB on each call so mid-run mode changes
   * (via `PATCH /workflow-runs/:id/permission-mode`) take effect
   * immediately without needing to restart the session.
   *
   * Modes:
   *   - `bypassPermissions` (default) — grant every request without
   *     asking. Preserves the pre-HITL-06 behaviour so existing runs
   *     don't change.
   *   - `acceptEdits` — auto-approve read/write file ops; ask for
   *     shell/network/other.
   *   - `default` / `plan` — every request pauses the stage in
   *     `awaiting_input` via `HitlService.interrupt` until an operator
   *     approves or rejects via `PATCH /stages/:id/approve`.
   *
   * Falls back to the auto-approve stub when the run repo or HITL service
   * aren't wired (tests / older bootstraps).
   *
   * `groups` is the bound agent's resolved capability policy. It is checked
   * FIRST and is not overridable by `permissionMode`: telling the provider
   * about the deny list is advisory (a live run showed Copilot happily calling
   * `create` and `powershell` with both `excludedTools` and
   * `defaultAgent.excludedTools` set), so this handler — the one funnel every
   * tool call passes through — is where the policy is actually enforced.
   */
  private buildPermissionHandler(
    workflowRunId: string,
    stageRunId: string,
    groups?: AgentToolPolicy,
    semaphoreCallbacks?: { pause: () => void; resume: () => Promise<void> },
  ): (request: PermissionRequest) => Promise<PermissionResponse> {
    const runRepo = this.workflowRunRepo;
    const hitl = this.hitlService;

    const deniedByAgent = (request: PermissionRequest): string | null => {
      if (!groups) return null;
      if (request.type === 'file_write' && !groups.fileWrite) return 'write files';
      if (request.type === 'file_read' && !groups.fileRead) return 'read files';
      if (request.type === 'shell_exec' && !groups.shell) return 'run shell commands';
      if (request.type === 'network' && !groups.web) return 'access the network';
      return null;
    };

    return async (request) => {
      const denied = deniedByAgent(request);
      if (denied) {
        return { granted: false, reason: `The bound agent is not allowed to ${denied}.` };
      }

      let mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' =
        'bypassPermissions';
      try {
        const run = await runRepo.getById(workflowRunId);
        mode = (run.permissionMode ?? 'bypassPermissions') as typeof mode;
      } catch {
        // Run row missing — safest to allow so we don't wedge the stage.
        return { granted: true };
      }

      // Fast path — auto-approve modes.
      if (mode === 'bypassPermissions') return { granted: true };
      if (mode === 'acceptEdits' && (request.type === 'file_read' || request.type === 'file_write')) {
        return { granted: true };
      }

      // Slow path — ask a human. Park the stage in `awaiting_input` and
      // wait for `HitlService.resume` to fire (via the approver hitting
      // `PATCH /stages/:id/approve`). The interrupt data is a structured
      // record so the UI can render "wants to run <shell command>" etc.
      //
      // M9-fix: release the stage-semaphore permit while parked waiting for
      // human review — the wait can last hours and holding the permit would
      // starve other concurrent stages. Re-acquire once the reviewer decides.
      const prompt = `Approve ${request.type}: ${request.description}`;
      semaphoreCallbacks?.pause();
      let resolution: Awaited<ReturnType<typeof hitl.interrupt>>;
      try {
        resolution = await hitl.interrupt(
          stageRunId,
          workflowRunId,
          {
            kind: 'tool_permission',
            request: {
              type: request.type,
              description: request.description,
              details: request.details ?? null,
            },
          },
          { prompt },
        );
      } finally {
        await semaphoreCallbacks?.resume();
      }
      return {
        granted: resolution.approved === true,
        reason: resolution.reason,
      };
    };
  }

  /**
   * Extract fenced code blocks from markdown text.
   * Returns array of { language, filename?, content }.
   */
  /**
   * Try to extract a filename from text surrounding or inside a code block.
   * Checks (in priority order):
   *   1. Code fence header: ```typescript index.ts
   *   2. First-line comment: // index.ts  or  # index.py
   *   3. Text before the code block: **index.ts**, ### index.ts, `index.ts`
   */
  /**
   * A relative-path-looking token alone on a line: `src/foo.ts`, `index.ts`.
   * Rejects anything with spaces (rules out directory trees and prose) and
   * absolute / parent paths.
   */
  private static readonly BARE_PATH_RE = /^[\w][\w./-]*\.[A-Za-z0-9]{1,8}$/;

  /** Languages that represent real, savable source/config files. */
  private static readonly CODE_LANGS = new Set([
    'ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx', 'mjs', 'cjs',
    'py', 'python', 'java', 'go', 'rust', 'rs', 'cpp', 'c', 'cc', 'h', 'hpp',
    'cs', 'rb', 'ruby', 'php', 'swift', 'kt', 'kotlin', 'scala', 'dart',
    'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss', 'less',
    'sql', 'graphql', 'proto', 'vue', 'svelte',
  ]);

  /**
   * Try to extract a filename from text surrounding or inside a code block.
   * Checks (in priority order):
   *   1. Code fence header: ```typescript index.ts
   *   2. First-line comment: // index.ts  or  # index.py
   *   3. Text before the code block: **index.ts**, ### index.ts, `index.ts`
   *   4. A bare path on the block's first line: `src/index.ts` (stripped from body)
   * Returns the filename plus whether the first content line should be stripped
   * (true only for case 4, where the path is part of the block body).
   */
  private inferFilename(
    fenceFilename: string | undefined,
    content: string,
    precedingText: string,
  ): { filename?: string; stripFirstLine: boolean } {
    // 1. Explicit fence filename
    if (fenceFilename) return { filename: fenceFilename, stripFirstLine: false };

    const firstLine = content.split('\n')[0]?.trim() ?? '';

    // 2. First-line comment like  // filename.ext  or  # filename.ext
    const commentMatch = firstLine.match(/^(?:\/\/|#)\s*(\S+\.\w+)\s*$/);
    if (commentMatch) return { filename: commentMatch[1], stripFirstLine: false };

    // 3. Preceding text patterns: **filename.ext**, `filename.ext`, ### filename.ext
    const preceding = precedingText.slice(-200); // last 200 chars before the block
    const precedingPatterns = [
      /\*\*(\w[\w./-]*\.\w+)\*\*\s*$/,      // **filename.ext**
      /`(\w[\w./-]*\.\w+)`\s*$/,             // `filename.ext`
      /###?\s+(?:\d+\.\s*)?(\w[\w./-]*\.\w+)\s*$/m,  // ### filename.ext
    ];
    for (const pat of precedingPatterns) {
      const m = preceding.match(pat);
      if (m) return { filename: m[1], stripFirstLine: false };
    }

    // 4. A lone relative path on the block's first line (a very common LLM
    //    habit that previously fell through to `output_N`, misplacing the file
    //    and leaving the path string polluting line 1).
    if (StageExecutionService.BARE_PATH_RE.test(firstLine)) {
      return { filename: firstLine, stripFirstLine: true };
    }

    return { filename: undefined, stripFirstLine: false };
  }

  /**
   * Extract fenced code blocks from markdown text. Each block is classified as
   * a real file (`isFile`) vs. an illustrative/prose snippet so callers can
   * avoid writing directory trees, command examples, and prose fragments to
   * disk as junk files.
   */
  private extractCodeBlocks(
    text: string,
  ): Array<{ lang: string; filename?: string; content: string; isFile: boolean }> {
    const blocks: Array<{ lang: string; filename?: string; content: string; isFile: boolean }> = [];
    const regex = /```(\w+)?(?:[ \t]+([^\n]+))?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const lang = (match[1] ?? 'txt').toLowerCase();
      const fenceFilename = match[2]?.trim();
      let content = match[3] ?? '';
      if (content.trim().length === 0) continue;

      const precedingText = text.slice(0, match.index);
      const { filename, stripFirstLine } = this.inferFilename(fenceFilename, content, precedingText);
      if (stripFirstLine) {
        content = content.replace(/^[^\n]*\n/, ''); // drop the bare-path first line
      }

      // A block is a real file when it has an inferred filename, OR it is an
      // untitled block in a recognized code language (saved under extracted/).
      // Untitled non-code blocks (txt/console/diagrams/command examples) are
      // NOT files — writing them produced junk like `output_2.txt = "2. **Install…"`.
      const isFile = Boolean(filename) || StageExecutionService.CODE_LANGS.has(lang);

      blocks.push({ lang, filename, content, isFile });
    }
    return blocks;
  }

  /**
   * Persist stage output to disk.
   * Workspace: code files with proper directory structure (like a real project).
   * Artifacts: non-code responses only (reviews, analysis, explanations as markdown).
   * Code files are NOT duplicated into artifacts — workspace is the single source of truth.
   */
  private async persistStageArtifacts(
    sessionId: string,
    stageRunId: string,
    stageName: string,
    artifactsDirectory: string,
    workspaceDirectory?: string,
    workspaceId?: string,
  ): Promise<void> {
    try {
      const messages = await this.messageRepo.getBySessionAndStageRunId(sessionId, stageRunId);
      const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content);

      await fs.mkdir(artifactsDirectory, { recursive: true });
      if (workspaceDirectory) {
        await fs.mkdir(workspaceDirectory, { recursive: true });
      }

      // Track used filenames to avoid collisions (for artifacts)
      const usedNames = new Set<string>();
      const uniqueName = (name: string): string => {
        if (!usedNames.has(name)) { usedNames.add(name); return name; }
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let i = 2;
        while (usedNames.has(`${base}_${i}${ext}`)) i++;
        const unique = `${base}_${i}${ext}`;
        usedNames.add(unique);
        return unique;
      };

      // Did the agent create files itself via file-writing tools? If so the
      // workspace already holds the real files at correct paths, so we must NOT
      // also scrape fenced code blocks — doing both double-writes and resurrects
      // the misplaced/junk-file problems. Fenced-block extraction below is only
      // a FALLBACK for sessions that emitted markdown instead of using tools.
      const isFileWriteTool = (name: string): boolean => {
        const n = name.toLowerCase().replace(/[^a-z]/g, '');
        return (
          n === 'write' || n === 'create' || n === 'edit' || n === 'multiedit' ||
          n === 'notebookedit' || n === 'strreplace' || n === 'strreplaceeditor' ||
          n === 'applypatch' || n === 'createfile' || n === 'writefile' ||
          n === 'editfile' || n === 'savefile'
        );
      };
      const agentWroteFiles = assistantMessages.some((m) =>
        (m.metadata?.toolCalls ?? []).some((tc) => isFileWriteTool(tc.tool)),
      );

      let codeIndex = 0;
      let responseIndex = 0;

      for (const msg of assistantMessages) {
        // Fallback only: scrape fenced blocks into the workspace when the agent
        // did NOT write files with tools.
        if (!agentWroteFiles && workspaceDirectory) {
          const blocks = this.extractCodeBlocks(msg.content);
          for (const block of blocks) {
            // Skip prose/diagrams/command examples — only real files get written.
            if (!block.isFile) continue;
            // Skip untitled code blocks. Historically we saved them under
            // `extracted/output_N.<ext>`, but this fabricated spurious files
            // for planning/review stages where the model quotes code purely
            // for illustration. Only save blocks that carry an inferred
            // filename (fence header, first-line path comment, or surrounding
            // prose) — that's the reliable "the model meant this as a file"
            // signal. Untitled blocks stay in the assistant response artifact.
            if (!block.filename) continue;
            codeIndex++;
            const raw = block.filename;

            // Preserve directory structure from filenames (e.g. server/src/index.ts)
            // Sanitize path components to prevent directory traversal
            const sanitized = raw.split(/[\/]/).filter(p => p && p !== '..' && p !== '.').join(path.sep);
            if (!sanitized) continue;
            const filePath = sanitized;

            // Write code files to workspace only (no duplication into artifacts).
            // Use realpath-based containment to defend against symlink escape:
            // an attacker who can influence file contents could otherwise plant
            // a symlink inside the workspace pointing at `/etc/passwd` and have
            // subsequent stage output redirected onto the host filesystem.
            const wsFilePath = await resolveWithinBase(workspaceDirectory, filePath);
            if (!wsFilePath) {
              // Silently skip traversal attempts — the LLM shouldn't be
              // emitting absolute or `..`-laden paths; don't fail the whole
              // stage on a single bad block.
              continue;
            }
            if (await isSymlink(wsFilePath)) {
              continue;
            }
            await fs.mkdir(path.dirname(wsFilePath), { recursive: true });
            await fs.writeFile(wsFilePath, block.content, 'utf-8');

            // Track artifact in workspace DB (non-fatal)
            if (workspaceId) {
              try {
                await this.workspaceManager.trackArtifact({
                  workspaceId,
                  stageRunId,
                  artifactType: 'code_file',
                  relativePath: filePath,
                  fileSize: Buffer.byteLength(block.content),
                  metadata: { language: block.lang, sourceFence: block.filename },
                });
              } catch {
                // Non-fatal
              }
            }
          }
        }

        // Always save the full assistant response as a stage response
        // This preserves explanations, summaries, and context alongside code
        if (msg.content.trim().length > 0) {
          responseIndex++;
          const safeStageName = stageName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
          const mdName = uniqueName(`${safeStageName}_response_${responseIndex}.md`);
          await fs.writeFile(
            path.join(artifactsDirectory, mdName),
            msg.content,
            'utf-8',
          );
        }
      }
    } catch {
      // Non-fatal — don't fail the stage if artifact persistence fails
    }
  }

  /**
   * Execute a stage — allocate session, run prompts, handle events.
   * @param predecessorSummaries - summaries from predecessor stages to inject as context
   * @param resumeContext - present ONLY when resuming from a pause; controls continuation logic
   */
  async executeStage(
    stageRun: StageRun,
    workflowRunId: string,
    sessionMode: 'single' | 'per-stage' | 'auto',
    workflowharnessConfig?: Partial<HarnessConfig>,
    variables?: Record<string, unknown>,
    predecessorSummaries?: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown>; fullOutput?: string }>,
    resumeContext?: { resumeFromPause: true; continuationNeeded: boolean },
    /**
     * W18 / P1-16 — stage-semaphore HITL callbacks. When supplied (by
     * `WorkflowRunService.launchStage`), `pause()` releases the semaphore
     * permit before each `hitl.interrupt()` call so other stages can run
     * while the human is thinking, and `resume()` re-acquires it afterwards
     * before the agent processes any feedback. Without this the permit is
     * held for the entire human-review wait (potentially hours), starving
     * other concurrent stages.
     */
    semaphoreCallbacks?: { pause: () => void; resume: () => Promise<void> },
  ): Promise<void> {
    const start = Date.now();
    return withSpan('core.stage', 'workflow.stage.execute', async (span) => {
      span.setAttribute('stage.run_id', stageRun.id);
      span.setAttribute('stage.name', stageRun.name);
      span.setAttribute('workflow.run_id', workflowRunId);
      span.setAttribute('stage.session_mode', sessionMode);
      stageCounter.add(1, { stage_name: stageRun.name });

    const sm = new StageRunStateMachine(stageRun.status);
    const stageDef = await this.stageDefRepo.getById(stageRun.stageDefinitionId);

    // HOOK-2: merge the workflow definition's hooksFile (per-stage + wildcard)
    // into this stage's hooks so `.hooks.json`-style hooks actually fire on the
    // live path. stageDef is a freshly-mapped object from the repo, so mutating
    // its `hooks` here is safe and propagates to every downstream phase
    // (pre_run/post_prompt/post_run/on_error) that reads stageDef.hooks.
    try {
      const def = await this.workflowDefinitionRepo.getById(stageDef.workflowDefinitionId);
      if (def.hooksFile) {
        stageDef.hooks = resolveStageHooks(stageDef.hooks, stageDef.name, def.hooksFile);
      }
    } catch {
      // Definition unreadable — inline stage hooks only.
    }

    // Transition: pending → queued → running
    if (stageRun.status === 'pending') {
      // DUR-06 — atomic launch claim. Replaces the prior unconditional
      // `updateStatus(..., 'queued')` so that of N concurrent/duplicate
      // launches for the same stage (parallel fan-in, the event path racing
      // the polling backstop, or a crash-recovery re-drive) exactly one
      // proceeds. Losers see `false` and bail before allocating a session or
      // dispatching a prompt — this is the DB-level idempotency boundary that
      // makes the orchestration crash-resumable without an in-memory de-dup
      // set that wouldn't survive a restart.
      const claimed = await this.stageRunRepo.claimForExecution(stageRun.id);
      if (!claimed) {
        // Another launch already owns this stage. No-op (not an error): the
        // fire-and-forget callers treat a resolved promise as "handled".
        return;
      }
      sm.transition('sys:enqueue');
      // Snapshot the workspace BEFORE the stage runs. Taken here rather than
      // after the claim race so exactly one launch produces a checkpoint, and
      // before any prompt dispatch so the snapshot reflects the pre-stage
      // state. Cannot throw — the service swallows its own errors.
      if (this.workspaceCheckpointService) {
        const ws = await this.workspaceManager.findWorkspaceByOwner(workflowRunId);
        if (ws) {
          await this.workspaceCheckpointService.capture({
            workspaceId: ws.id,
            kind: 'stage',
            label: stageRun.name,
            workflowRunId,
            stageRunId: stageRun.id,
            phase: 'before',
            ...(stageRun.sessionId ? { sessionId: stageRun.sessionId } : {}),
          });
        }
      }
      // Use emitGlobal when no session assigned yet to avoid __global__
      // sequence counter divergence between EventBus and EventRepository
      if (stageRun.sessionId) {
        await this.eventBus.emit(stageRun.sessionId, {
          kind: 'stage_run.queued',
          data: { stageRunId: stageRun.id, workflowRunId, name: stageRun.name },
        });
      } else {
        await this.eventBus.emitGlobal({
          kind: 'stage_run.queued',
          data: { stageRunId: stageRun.id, workflowRunId, name: stageRun.name },
        });
      }
    }

    // Build session config from workflow-level harnessConfig + stage-level overrides
    const stageOverrides = stageDef.harnessConfigOverrides as Record<string, unknown> | undefined;
    const sessionConfig: Record<string, unknown> = {};

    // Apply workflow-level config first
    if (workflowharnessConfig) {
      if (workflowharnessConfig.model) sessionConfig['model'] = workflowharnessConfig.model;
      // Agent provider for the whole workflow; a stage can still override it
      // below, which is what allows stage 1 on Claude and stage 2 on Copilot.
      if (workflowharnessConfig.harnessType) sessionConfig['harnessType'] = workflowharnessConfig.harnessType;
      if (workflowharnessConfig.systemMessage) sessionConfig['systemMessage'] = workflowharnessConfig.systemMessage;
      if (workflowharnessConfig.mcpServers) sessionConfig['mcpServers'] = workflowharnessConfig.mcpServers;
      if (workflowharnessConfig.availableTools) sessionConfig['availableTools'] = workflowharnessConfig.availableTools;
      if (workflowharnessConfig.excludedTools) sessionConfig['excludedTools'] = workflowharnessConfig.excludedTools;
      if (workflowharnessConfig.skillDirectories) sessionConfig['skillDirectories'] = workflowharnessConfig.skillDirectories;
      if (workflowharnessConfig.disabledSkills) sessionConfig['disabledSkills'] = workflowharnessConfig.disabledSkills;
      if (workflowharnessConfig.customAgents) sessionConfig['customAgents'] = workflowharnessConfig.customAgents;
      if (workflowharnessConfig.provider) sessionConfig['provider'] = workflowharnessConfig.provider;
      if (workflowharnessConfig.configDir) sessionConfig['configDir'] = workflowharnessConfig.configDir;
      if (workflowharnessConfig.reasoningEffort) sessionConfig['reasoningEffort'] = workflowharnessConfig.reasoningEffort;
      if (workflowharnessConfig.maxTurns) sessionConfig['maxTurns'] = workflowharnessConfig.maxTurns;
    }

    // Stage-level overrides take precedence (deep merge for object fields)
    if (stageOverrides) {
      for (const [key, value] of Object.entries(stageOverrides)) {
        if (value === undefined) continue;
        // Deep merge object-type config fields to avoid overwriting workflow-level entries
        if (key === 'mcpServers' && typeof value === 'object' && value !== null) {
          sessionConfig[key] = { ...(sessionConfig[key] as Record<string, unknown> ?? {}), ...value as Record<string, unknown> };
        } else {
          sessionConfig[key] = value;
        }
      }
    }

    // Set workingDirectory from variables (per-run workspace) or workflow config
    if (variables?.['__workingDirectory'] && typeof variables['__workingDirectory'] === 'string') {
      sessionConfig['workingDirectory'] = variables['__workingDirectory'];
    } else if (workflowharnessConfig?.configDir) {
      // configDir is already handled above; workingDirectory needs explicit handling
    }

    // Pass skillDirectories from variables if uploaded
    if (variables?.['__skillDirectories'] && Array.isArray(variables['__skillDirectories'])) {
      const existingSkills = (sessionConfig['skillDirectories'] as string[] | undefined) ?? [];
      sessionConfig['skillDirectories'] = [...existingSkills, ...(variables['__skillDirectories'] as string[])];
    }

    // Pass customAgents from variables if uploaded
    if (variables?.['__customAgents'] && Array.isArray(variables['__customAgents'])) {
      const existingAgents = (sessionConfig['customAgents'] as unknown[] | undefined) ?? [];
      sessionConfig['customAgents'] = [...existingAgents, ...(variables['__customAgents'] as unknown[])];
    }

    // Pass promptDirectories from variables if uploaded
    if (variables?.['__promptDirectories'] && Array.isArray(variables['__promptDirectories'])) {
      const existingPrompts = (sessionConfig['promptDirectories'] as string[] | undefined) ?? [];
      sessionConfig['promptDirectories'] = [...existingPrompts, ...(variables['__promptDirectories'] as string[])];
    }

    // ── Agent binding ──────────────────────────────────────────────
    //
    // Replaces the historical `sessionConfig['defaultAgent'] = agentName`,
    // which never reached the harness. Resolution happens AFTER the stage
    // overrides are folded in so `harnessConfigOverrides` acts as the
    // binding-site delta (capability lists UNION, scalars most-specific-wins).
    const agentProjection = await this.resolveStageAgent(
      sessionConfig,
      stageDef,
      workflowharnessConfig,
      variables,
    );

    // ── Integrated Browser — VSCode-parity built-in tool set ──────
    //
    // Mirror what ChatManagementService does: whenever the stage has a
    // workspace and BrowserService is wired, expose the ten browser
    // tools + a one-sentence system prompt hint. Auto-boot Chromium
    // when the run's browserConfig has `enabled: true` AND
    // `visibility !== 'off'`; otherwise the first `open_browser_page`
    // tool call boots it lazily. The stage's own
    // `harnessConfigOverrides.availableTools` can filter these off if
    // the workflow author wants to constrain — same mechanism as any
    // other tool.
    const stageWorkspaceId = typeof variables?.['__workspaceId'] === 'string'
      ? (variables['__workspaceId'] as string)
      : undefined;
    if (this.browserService && stageWorkspaceId && agentProjection.toolPolicy.groups.browser) {
      try {
        // Re-attach on new stage/turn — matches the chat semantics: a
        // fresh workflow run is a fresh user intent to hand the browser
        // to the agent, even if a previous turn detached it.
        this.browserService.reattachOnPrompt(stageWorkspaceId);
        const workspace = await this.workspaceManager.getExecutionWorkspace(stageWorkspaceId);
        if (workspace) {
          const cfg = this.browserService.resolveConfig(workspace.browserConfig);
          if (cfg.enabled && cfg.visibility !== 'off') {
            await this.browserService.ensureStarted(workspace).catch((err) => {
              // Never fail the stage on browser boot failure — the tools
              // themselves surface errors when the LLM calls them.
              // eslint-disable-next-line no-console
              console.warn(`[StageExecution] Browser auto-start failed for stage ${stageRun.id}:`, err);
            });
          }
        }
        const browserTools = buildBrowserToolSet({
          browserService: this.browserService,
          workspaceId: stageWorkspaceId,
          owner: `stage:${stageRun.id}`,
        });
        const existingTools = Array.isArray(sessionConfig['tools']) ? sessionConfig['tools'] as unknown[] : [];
        sessionConfig['tools'] = [...browserTools, ...existingTools];
        const hint =
          `\n\n[Integrated Browser]\nUse the browser tools (open_browser_page, ` +
          `read_page, click_element, type_in_page, screenshot_page, ` +
          `run_playwright_code, etc.) when the stage needs to test or interact ` +
          `with web pages. Prefer these tools over shell commands or spawning ` +
          `your own browser.`;
        const existingMsg = sessionConfig['systemMessage'] as { mode?: string; content?: string } | undefined;
        sessionConfig['systemMessage'] = {
          mode: (existingMsg?.mode as 'append' | 'replace' | undefined) ?? 'append',
          content: (existingMsg?.content ?? '') + hint,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[StageExecution] Browser tool registration failed for stage ${stageRun.id}:`, err);
      }
    }

    // ── PRE_RUN hooks — execute before session allocation / prompt dispatch ──
    // If a hook with failurePolicy='abort' fails, the stage is aborted.
    // Hook results can inject variables, context messages, and attachments.
    let hookContextMessages: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
    if (stageDef.hooks && stageDef.hooks.length > 0) {
      const preRunHookContext: HookContext = {
        sessionId: stageRun.sessionId ?? '__pre_session__',
        workflowId: workflowRunId,
        workspacePath: typeof variables?.['__workingDirectory'] === 'string'
          ? variables['__workingDirectory'] as string
          : process.cwd(),
        variables: Object.fromEntries(
          Object.entries(variables ?? {}).map(([k, v]) => [k, String(v)]),
        ),
        eventBus: this.eventBus,
        workflowRunId,
      };
      const preResult = await this.hookExecutor.executePhase('pre_run', stageDef.hooks, preRunHookContext);
      if (!preResult.shouldContinue) {
        throw new StageExecutionError(
          preResult.mergedResult.abortReason ?? `pre_run hook aborted stage "${stageRun.name}"`,
          stageRun.id,
        );
      }
      // Merge hook-returned variables into the stage variables
      if (preResult.mergedResult.variables && variables) {
        for (const [k, v] of Object.entries(preResult.mergedResult.variables)) {
          variables[k] = v;
        }
      }
      // Collect context messages to inject after session allocation
      if (preResult.mergedResult.contextMessages) {
        hookContextMessages = preResult.mergedResult.contextMessages;
      }
      // Write attachments to workspace
      if (preResult.mergedResult.attachments && preResult.mergedResult.attachments.length > 0) {
        const wsDir = typeof variables?.['__workingDirectory'] === 'string'
          ? variables['__workingDirectory'] as string
          : process.cwd();
        for (const att of preResult.mergedResult.attachments) {
          const attDir = path.join(wsDir, 'hook-attachments');
          await fs.mkdir(attDir, { recursive: true });
          const attPath = path.join(attDir, path.basename(att.filename));
          await fs.writeFile(attPath, att.content, 'utf-8');
        }
      }
    }

    // Allocate session
    const session = await this.sessionAllocator.allocateSession(
      workflowRunId,
      stageRun.id,
      sessionMode,
      {
        ...sessionConfig,
        // HITL-06 — bridge harness permission prompts into HitlService so the
        // run's `permissionMode` field actually gates tool calls. When both
        // deps are absent (older wiring / tests), sessionAllocator falls back
        // to auto-approve, preserving previous behaviour.
        // M9-fix: pass semaphoreCallbacks so the permission handler can release
        // the stage-semaphore permit while awaiting a human decision on tool use.
        onPermissionRequest: this.buildPermissionHandler(
          workflowRunId,
          stageRun.id,
          agentProjection.toolPolicy.groups,
          semaphoreCallbacks,
        ),
      },
    );

    // X-13 — record which session this stage is now speaking through. The
    // chain's head makes the "lost" links `StartupRecoveryService` writes
    // interpretable, and a stage that shows two `allocated` entries is a stage
    // whose conversation was replaced — which is the answer to "why did it
    // forget what I told it earlier?".
    recordSessionLineage(this.durableEngine, stageRun.id, {
      event: 'allocated',
      sessionId: session.id,
      ...(session.conversationId ? { conversationId: session.conversationId } : {}),
      ...(stageRun.sessionId && stageRun.sessionId !== session.id
        ? { reason: `replaces session ${stageRun.sessionId}` }
        : {}),
      at: Date.now(),
    });

    // Update stage run with session info
    // Only true when explicitly resuming from a pause — not when reusing
    // a pre-existing session (e.g. single-session mode across stages).
    const isResuming = resumeContext?.resumeFromPause ?? false;
    await this.stageRunRepo.update(stageRun.id, {
      sessionId: session.id,
      status: 'running',
      ...(isResuming ? {} : { startedAt: new Date() }),
      totalSteps: stageDef.prompts.length,
    });

    // Skip SM transition on resume — stage was already 'running' before pause
    // and has already gone through the pending → queued → running lifecycle.
    if (!isResuming) {
      sm.transition('sys:session_ready');
    }

    await this.eventBus.emit(session.id, {
      kind: 'stage_run.running',
      data: { stageRunId: stageRun.id, workflowRunId, sessionId: session.id, name: stageRun.name },
    });

    // WS-D1 (task 4) — start beating stage_runs.heartbeat_at now that the
    // stage is actually running. Stopped in the `finally` below, and
    // restarted (idempotently) on every resume/retry re-entry into
    // executeStage, so the reconciler's stale check has a live signal for
    // as long as — and only as long as — this stage is doing work.
    this.startHeartbeat(stageRun.id);

    // Subscribe to conversation events
    let unsubscribe: (() => void) | undefined;
    // Idempotency guard: prevents double-persistence per turn.
    let assistantPersisted = false;

    // Accumulators for rich metadata — reset each turn
    let turnThinkingText = '';
    const turnToolCalls: Array<{ id: string; tool: string; args: unknown; result?: unknown; status: 'running' | 'complete' }> = [];
    const turnSystemMessages: string[] = [];
    // Accumulate assistant content across multiple message_complete events
    // in an agentic loop (tool calls interleave message_complete events).
    let turnContent = '';

    // Phase tracking: marks events during context/summary turns so the
    // client can avoid resetting stream blocks for internal turns.
    let isInternalTurn = false;

    if (session.conversationId) {
      unsubscribe = this.harness.onConversationEvent(
        session.conversationId,
        async (event: AgentEvent) => {
          // Inject stageRunId into copilot events so the frontend can
          // route per-stage streams in single-session mode.
          // Also inject __isInternalTurn flag for context/summary turns so
          // the client preserves the main prompt's stream blocks.
          await this.eventBus.emit(
            session.id,
            createEnrichedAgentEvent(event, { stageRunId: stageRun.id, workflowRunId, isInternalTurn }),
          );

          // Accumulate thinking text
          if (event.kind === 'harness.reasoning_delta') {
            const data = event.data as { text?: string };
            if (data.text) turnThinkingText += data.text;
          }

          // Accumulate tool calls. Some providers (Claude Agent SDK) emit
          // tool_start twice per callId — first with empty args when the
          // tool_use block opens, then again with the fully materialized
          // args. Dedup by callId so persisted metadata + downstream UI
          // don't show duplicate rows (one of which never completes).
          if (event.kind === 'harness.tool_start') {
            const data = event.data as { callId?: string; tool?: string; args?: unknown };
            const id = data.callId ?? `tc_${turnToolCalls.length}`;
            const existing = data.callId
              ? turnToolCalls.find((tc) => tc.id === data.callId)
              : undefined;
            const hasIncomingArgs =
              data.args != null &&
              (typeof data.args !== 'object' ||
                Object.keys(data.args as Record<string, unknown>).length > 0);
            if (existing) {
              if (hasIncomingArgs) existing.args = data.args;
              if (!existing.tool && data.tool) existing.tool = data.tool;
            } else {
              turnToolCalls.push({
                id,
                tool: data.tool ?? 'unknown',
                args: data.args,
                status: 'running',
              });
            }
          }
          if (event.kind === 'harness.tool_complete') {
            const data = event.data as { callId?: string; tool?: string; result?: unknown };
            const match = turnToolCalls.find(
              (tc) => tc.id === data.callId || (data.tool && tc.tool === data.tool && tc.status === 'running'),
            );
            if (match) {
              match.result = data.result;
              match.status = 'complete';
            }
          }

          // Accumulate content on message_complete — don't persist yet.
          // In an agentic loop, message_complete fires BEFORE tool events,
          // so deferring persistence to harness.idle captures all tool calls.
          if (event.kind === 'harness.message_complete') {
            const data = event.data as { content?: string };
            if (data.content) {
              // Completion is authoritative even when the final answer is
              // shorter than commentary. Codex emits discrete segments;
              // choosing by length can persist "I'll check" over the result.
              turnContent = data.content;
            }
          }

          // Persist assistant message on idle — all tool calls have completed
          if (event.kind === 'harness.idle' && !assistantPersisted && turnContent.trim().length > 0) {
            assistantPersisted = true;
            await this.messageRepo.create({
              id: generateId(),
              sessionId: session.id,
              role: 'assistant',
              content: turnContent,
              metadata: {
                stageRunId: stageRun.id,
                thinkingText: turnThinkingText || undefined,
                toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
                systemMessages: turnSystemMessages.length > 0 ? [...turnSystemMessages] : undefined,
              },
              timestamp: new Date(),
            });
          }
        },
      );
    }

    // ── W22 — the effect sandwich, on the real turn path ──────────
    //
    // `withEffect()` shipped with ZERO production callers. The mechanism
    // existed, was unit-tested in isolation, and was reachable from nothing —
    // which had a concrete cost: `StartupRecoveryService` resets an
    // interrupted stage to `pending`, `executeStage` re-enters from the top,
    // and so EVERY prompt of a half-finished stage was re-sent to the model
    // and every tool call it had already made ran a second time.
    //
    // A TURN is the granularity we journal. That is coarser than §3.4's
    // per-tool ideal, deliberately: a turn's individual tool calls happen
    // inside the provider SDK and never cross this process, so there is no
    // seam to wrap them at. What the turn boundary does buy is the plan's
    // exit criterion — re-entering `executeStage()` after a restart replays
    // each already-settled turn out of the journal instead of re-prompting.
    //
    // The operation-id EPOCH is what keeps a deliberate retry honest. A retry
    // must redo the work, so it gets a fresh epoch and memoises nothing; a
    // crash-recovery re-entry keeps the same epoch (`resetForRetry` preserves
    // `retryCount`) and therefore replays. Without the epoch, `retryStage`
    // would "retry" a stage by replaying the exact turns that just failed.
    const durable = this.durableEngine;
    const durableCtx: DurableContext = { scope: 'stage_run', scopeId: stageRun.id };
    const validationAttempt = Number(variables?.['__validationRetryAttempt'] ?? 0) || 0;
    const opEpoch = `a${stageRun.retryCount ?? 0}v${validationAttempt}`;
    // Derived from the stage's own tool surface — see `replayPolicyForToolGroups`.
    // A read-only stage's interrupted turn simply re-runs; a stage that could
    // have written a file or run a command does not silently redo that work.
    const turnReplayPolicy = replayPolicyForToolGroups(agentProjection.toolPolicy.groups);

    // X-25 — this attempt is running, so the stage's durable result is not
    // final. A previous attempt on the SAME stage run (the scope is the stage
    // run id) may have sealed it on its way to a terminal status; every append
    // below would then return null and the artifact would keep serving
    // successors the output of an attempt that has since been superseded —
    // including, for a post-validation retry, the very output validation
    // rejected. No-op when the artifact does not exist or is already open.
    durable?.reopenArtifact(durableCtx, STAGE_OUTPUT_ARTIFACT);

    /**
     * Turns replayed out of the journal onto a conversation that never ran
     * them. Injected ONCE as a single recap message before the first turn
     * that actually reaches the model — one cheap prompt instead of re-running
     * N expensive ones, and the difference between "the agent resumed" and
     * "the agent was handed step 4 with no memory of steps 1–3".
     */
    const replayedTurns: Array<{ prompt: string; content: string }> = [];
    let replayedTurnsInjected = false;

    const injectReplayedTurns = async (): Promise<void> => {
      if (replayedTurnsInjected || replayedTurns.length === 0) return;
      if (!session.conversationId) return;
      replayedTurnsInjected = true;

      const recap = replayedTurns
        .map(
          (t, idx) =>
            `## Turn ${idx + 1}\n**Instruction given:**\n${t.prompt}\n\n**Your response:**\n${t.content}`,
        )
        .join('\n\n---\n\n');
      const recapMessage =
        `This stage was interrupted by a restart and has resumed on a new session. ` +
        `The turns below ALREADY COMPLETED — do not redo their work. They are ` +
        `reproduced here only so you have their context:\n\n${recap}`;

      await this.messageRepo.create({
        id: generateId(),
        sessionId: session.id,
        role: 'user',
        content: recapMessage,
        // Flagged as context (not a real stage prompt) so the client renders
        // it the way it renders predecessor context rather than as work.
        metadata: { stageRunId: stageRun.id, isContextMessage: true },
        timestamp: new Date(),
      });

      assistantPersisted = false;
      turnThinkingText = '';
      turnToolCalls.length = 0;
      turnSystemMessages.length = 0;
      turnContent = '';

      isInternalTurn = true;
      // durability-ok: the recap exists ONLY because turns were replayed.
      // Journalling it would memoise a message whose whole purpose is to
      // describe one particular restart; and it already runs inside the next
      // turn's `perform`, so it is covered by that turn's settlement.
      await this.harness.sendPromptAndWait(session.conversationId, recapMessage); // durability-ok: see above
      isInternalTurn = false;
      replayedTurns.length = 0;
    };

    /**
     * Run one agent turn under the effect sandwich.
     *
     * `perform` must contain EVERYTHING the turn does that must not happen
     * twice — persisting the user message, resetting the accumulators, the
     * `sendPrompt*` call and any post-turn persistence — because on replay it
     * is not called at all.
     *
     * `promptForReplay` is the instruction text used to rebuild context for a
     * fresh conversation; it is never sent on the live path.
     */
    const runTurn = async (
      opId: string,
      promptForReplay: string,
      perform: () => Promise<string>,
      opts: { contributesOutput?: boolean } = {},
    ): Promise<string> => {
      if (!durable) return perform();

      let ranLive = false;
      const outcome = await durable.withEffect<DurableTurnRecord>(durableCtx, {
        operationId: `${opEpoch}/${opId}`,
        replayPolicy: turnReplayPolicy,
        perform: async () => {
          ranLive = true;
          await injectReplayedTurns();
          const content = await perform();
          // X-25 — the stage result goes onto the durable artifact channel as
          // it is produced, INSIDE the sandwich: a replayed turn does not
          // re-append, so the artifact cannot double-count after a restart.
          if (opts.contributesOutput && content.trim().length > 0) {
            durable.appendArtifact(durableCtx, STAGE_OUTPUT_ARTIFACT, `${content}\n`, {
              meta: { stageRunId: stageRun.id, workflowRunId, stageName: stageRun.name },
            });
          }
          return {
            content,
            accumulated: turnContent,
            ...(session.conversationId ? { conversationId: session.conversationId } : {}),
            ...(turnThinkingText ? { thinkingText: turnThinkingText } : {}),
            ...(turnToolCalls.length > 0 ? { toolCalls: [...turnToolCalls] } : {}),
            ...(turnSystemMessages.length > 0 ? { systemMessages: [...turnSystemMessages] } : {}),
          } satisfies DurableTurnRecord;
        },
      });

      if (ranLive) return outcome.content;

      // ── Replay paths ──────────────────────────────────────────
      if (isSyntheticEffectResult(outcome)) {
        // `replay: never` + intent committed + no settlement: the process
        // died with this turn in flight. §3.4 forbids re-running it, because
        // whatever it had already done to the workspace cannot be undone and
        // must not be done twice. The turn is therefore SKIPPED — but loudly.
        // Continuing silently is exactly how a stage "completes" having done
        // nothing, which is worse than either alternative.
        const notice =
          `Turn "${opId}" was in flight when the process restarted. Its replay ` +
          `policy is 'never' (this stage can write files or run commands), so it ` +
          `was not re-run. Any work it had already done is preserved; anything it ` +
          `had not finished was not attempted.`;
        turnSystemMessages.push(notice);
        await this.eventBus.emit(session.id, {
          kind: 'harness.session_info',
          data: {
            infoType: 'durable_turn_skipped',
            message: notice,
            stageRunId: stageRun.id,
            workflowRunId,
          },
        });
        return '';
      }

      // A settled turn — restore the accumulators so every downstream reader
      // (`stageOutputContent`, the validation loop, the summary) sees exactly
      // what it would have seen had the turn just run.
      turnContent = outcome.accumulated ?? outcome.content;
      turnThinkingText = outcome.thinkingText ?? '';
      turnToolCalls.length = 0;
      if (outcome.toolCalls) turnToolCalls.push(...outcome.toolCalls);
      turnSystemMessages.length = 0;
      if (outcome.systemMessages) turnSystemMessages.push(...outcome.systemMessages);
      // The settled turn already wrote its assistant message; re-persisting
      // would duplicate the row in the chat history on every restart.
      assistantPersisted = true;

      if (outcome.conversationId !== session.conversationId && outcome.content) {
        replayedTurns.push({ prompt: promptForReplay, content: outcome.content });
      }
      return outcome.content;
    };

    try {
      // Inject predecessor stage summaries as context before executing prompts.
      // Controlled by stageDef.contextFilter: 'summary-only' (default), 'full', 'structured', or 'none'.
      // Skip context injection on resume — the reused conversation already has prior context.
      const contextFilter = stageDef.contextFilter ?? 'summary-only';
      if (!isResuming && contextFilter !== 'none' && predecessorSummaries && predecessorSummaries.length > 0 && session.conversationId) {
        let contextMessage: string;
        if (contextFilter === 'full') {
          // HANDOFF-1: full mode injects each predecessor's COMPLETE output
          // (its raw response text), not just the condensed summary. Falls back
          // to the summary when a predecessor has no captured output (e.g. a
          // pre-HANDOFF-1 run, or an empty/no-op stage).
          const contextLines = predecessorSummaries.map((ps) => {
            const body =
              ps.fullOutput && ps.fullOutput.trim().length > 0 ? ps.fullOutput : ps.summary;
            return `## Completed Stage: "${ps.stageName}"\n${body}`;
          });
          contextMessage =
            `The following stages have already been completed in this workflow. Use their FULL outputs as context for your work in this stage:\n\n` +
            contextLines.join('\n\n---\n\n');
        } else if (contextFilter === 'structured') {
          // Structured mode: include outputData JSON alongside summaries
          const contextLines = predecessorSummaries.map((ps) => {
            let section = `## Completed Stage: "${ps.stageName}"\n${ps.summary}`;
            if (ps.outputData && Object.keys(ps.outputData).length > 0) {
              section += `\n\n### Structured Output:\n\`\`\`json\n${JSON.stringify(ps.outputData, null, 2)}\n\`\`\``;
            }
            return section;
          });
          contextMessage =
            `The following stages have already been completed in this workflow. Use their summaries and structured outputs as context for your work in this stage:\n\n` +
            contextLines.join('\n\n---\n\n');
        } else {
          const contextLines = predecessorSummaries.map(
            (ps) => `## Completed Stage: "${ps.stageName}"\n${ps.summary}`,
          );
          contextMessage =
            `The following stages have already been completed in this workflow. Use their summaries as context for your work in this stage:\n\n` +
            contextLines.join('\n\n---\n\n');
        }

        // W22 — journalled turn. On a post-restart re-entry the predecessor
        // context has already been delivered once; re-sending it costs a full
        // model turn and tells the agent things it was told before.
        const contextConversationId = session.conversationId;
        await runTurn('context', contextMessage, async () => {
          // Send as a user message so the agent receives the context
          await this.messageRepo.create({
            id: generateId(),
            sessionId: session.id,
            role: 'user',
            content: contextMessage,
            metadata: { stageRunId: stageRun.id, isContextMessage: true },
            timestamp: new Date(),
          });

          // Reset accumulators before this context turn
          assistantPersisted = false;
          turnThinkingText = '';
          turnToolCalls.length = 0;
          turnSystemMessages.length = 0;
          turnContent = '';

          // Mark as internal turn so the client doesn't reset stream blocks
          isInternalTurn = true;
          await this.harness.sendPromptAndWait(contextConversationId, contextMessage);
          isInternalTurn = false;
          return turnContent;
        });
      }

      // ── Validation feedback on retry ──
      // When a stage is retried after validation failure, inject the failure
      // reason so the agent knows why its previous output was rejected.
      // Skip on resume — already in conversation context.
      const validationFeedback = variables?.['__validationFeedback'];
      if (!isResuming && validationFeedback && typeof validationFeedback === 'string' && session.conversationId) {
        const retryAttempt = variables?.['__validationRetryAttempt'] ?? '?';
        const feedbackMessage =
          `⚠️ **Validation Feedback (Retry attempt ${retryAttempt})**\n\n` +
          `Your previous output for this stage did not pass validation:\n\n` +
          `${validationFeedback}\n\n` +
          `Please address these issues in your response this time.`;

        const feedbackConversationId = session.conversationId;
        await runTurn('validation-feedback', feedbackMessage, async () => {
          await this.messageRepo.create({
            id: generateId(),
            sessionId: session.id,
            role: 'user',
            content: feedbackMessage,
            metadata: { stageRunId: stageRun.id, isValidationFeedback: true },
            timestamp: new Date(),
          });

          assistantPersisted = false;
          turnThinkingText = '';
          turnToolCalls.length = 0;
          turnSystemMessages.length = 0;
          turnContent = '';

          isInternalTurn = true;
          await this.harness.sendPromptAndWait(feedbackConversationId, feedbackMessage);
          isInternalTurn = false;
          return turnContent;
        });
      }

      // ── Hook context messages — inject messages returned by pre_run hooks ──
      // Skip on resume — the reused conversation already has hook context from the first attempt.
      if (!isResuming && hookContextMessages.length > 0 && session.conversationId) {
        const hookConversationId = session.conversationId;
        for (const [hookIdx, msg] of hookContextMessages.entries()) {
          await runTurn(`hook-context/${hookIdx}`, msg.content, async () => {
            await this.messageRepo.create({
              id: generateId(),
              sessionId: session.id,
              role: 'user',
              content: msg.content,
              metadata: { stageRunId: stageRun.id, isHookContext: true, ...msg.metadata },
              timestamp: new Date(),
            });

            assistantPersisted = false;
            turnThinkingText = '';
            turnToolCalls.length = 0;
            turnSystemMessages.length = 0;
            turnContent = '';

            isInternalTurn = true;
            await this.harness.sendPromptAndWait(hookConversationId, msg.content);
            isInternalTurn = false;
            return turnContent;
          });
        }
      }

      // Execute prompts sequentially (resume from currentStep)
      const startStep = stageRun.currentStep ?? 0;
      const outputFormat = stageDef.outputFormat ?? 'text';

      for (let i = startStep; i < stageDef.prompts.length; i++) {
        const prompt = stageDef.prompts[i]!;
        const isFirstPrompt = (i === startStep);
        const isLastPrompt = (i === stageDef.prompts.length - 1);

        // When resuming from pause AND the model was mid-response, send a
        // short continuation prompt. If the step completed before pause
        // (continuationNeeded=false), the resume already advanced currentStep
        // so this branch won't fire.
        const isResumingThisStep = isResuming && i === startStep && (resumeContext?.continuationNeeded ?? false);

        // Check if stage was paused/cancelled between prompts
        const current = await this.stageRunRepo.getById(stageRun.id);
        if (current.status !== 'running') {
          unsubscribe?.();
          return;
        }

        await this.eventBus.emit(session.id, {
          kind: 'stage_run.step_started',
          data: {
            stageRunId: stageRun.id,
            workflowRunId,
            step: i,
            totalSteps: stageDef.prompts.length,
            label: prompt.label,
          },
        });

        // Update current step
        await this.stageRunRepo.update(stageRun.id, { currentStep: i });

        let promptText: string;

        if (isResumingThisStep) {
          // Continuation prompt — the original prompt is already in conversation context.
          // The SDK session has the partial response in history; just ask the model to finish.
          promptText = 'Continue from where you left off and complete your response.';
        } else {
          // Interpolate variables into prompt text. Track any placeholders
          // that didn't resolve so we can surface them in the run log and as
          // a system message on the stream — otherwise raw `{{name}}` tokens
          // silently leak into the harness prompt and the user sees confusing
          // "why isn't my variable being replaced?" behavior.
          const unresolved = new Set<string>();
          const rawPromptText = variables
            ? interpolateVariables(prompt.text, variables, unresolved)
            : prompt.text;
          if (unresolved.size > 0) {
            const names = Array.from(unresolved).join(', ');
            console.warn(
              `[StageExecutionService] Unresolved variables in stage "${stageRun.name}" prompt: ${names}`,
            );
            // Emit as an SSE session-info event so the UI can show it inline with the stream.
            await this.eventBus.emit(session.id, {
              kind: 'harness.session_info',
              data: {
                infoType: 'unresolved_variables',
                message:
                  `Warning: unresolved variables — ${names}. ` +
                  `Placeholder(s) sent to the model as-is. ` +
                  `Set values for these variables when starting the run or add defaults in the workflow definition.`,
                stageRunId: stageRun.id,
                workflowRunId,
                unresolved: Array.from(unresolved),
              },
            });
          }

          // Build the full prompt text. Instruct the agent to WRITE FILES
          // DIRECTLY using its file tools (create/edit/write) into the working
          // directory, rather than pasting file contents as markdown fences.
          // The agent runs with the run workspace as its working directory and
          // file tools enabled, so real files land at correct relative paths —
          // this avoids the fragile "scrape fenced code blocks" heuristic that
          // misplaced files and turned prose/diagrams into junk files.
          promptText = rawPromptText +
            '\n\n---\n**IMPORTANT: How to create files**\n' +
            'Write every code/config file DIRECTLY to the working directory using your ' +
            'file-editing tools (create/write/edit). Use correct relative paths ' +
            '(e.g. `src/utils/strings.ts`, `tests/strings.test.ts`) so the project ' +
            'structure is created on disk.\n' +
            'Do NOT paste full file contents as markdown code blocks — actually create ' +
            'the files with your tools. Reserve fenced code blocks for short illustrative ' +
            'snippets only, never for files you intend to save.\n';

          // Output format instructions — combined with the FIRST prompt only
          if (isFirstPrompt) {
            // Append expectedOutput instruction if defined
            if (stageDef.expectedOutput) {
              promptText +=
                '\n\n---\n**Expected Output:**\n' +
                stageDef.expectedOutput + '\n';
            }

            // Append output format instruction based on outputFormat
            if (outputFormat === 'json' && stageDef.outputSchema) {
              promptText +=
                '\n\n---\n**IMPORTANT: Structured Output Required**\n' +
                'You MUST include a JSON code block labeled `output.json` with your structured output matching this schema:\n' +
                '```json output.json\n' +
                JSON.stringify(stageDef.outputSchema, null, 2) + '\n' +
                '```\n' +
                'Include this JSON block in addition to any other code or text you produce.\n';
            } else if (outputFormat === 'text') {
              promptText +=
                '\n\n---\n**IMPORTANT: Output Summary Required**\n' +
                'After completing your work, provide a clear and concise summary of your findings, ' +
                'actions taken, and key outputs at the end of your response.\n';
            }
          }
        }

        // PLN-01 — a plan-mode stage needs the plan workflow spelled out.
        //
        // A chat gets this via the conversation's `planModeInstructions` /
        // system message, but stage conversations are built by SessionAllocator
        // and have no per-turn mode. Prepending to the prompt is the one channel
        // that reaches both providers without rebuilding the session, and it is
        // scoped to exactly the turns that need it.
        const stageInstructions = instructionsForMode(stageDef.agentMode);
        if (stageInstructions && resolveModeDescriptor(stageDef.agentMode).planGate === 'blocking') {
          promptText = `${stageInstructions}\n\n---\n\n${promptText}`;
        }

        // W22 — a RESUMED step is a retraction, not a replay.
        //
        // The paused turn committed intent and never settled. Left alone,
        // `withEffect` sees that register, finds no settlement, and — on any
        // mutating stage, i.e. `replay: never` — writes a synthetic settlement
        // and reports the turn as skipped. The stage then "completes" on the
        // truncated response the pause interrupted, and because the synthetic
        // settlement is itself durable, every later resume replays the skip.
        //
        // The pause path is the one place where the incompleteness is KNOWN
        // (the operator aborted it, the partial answer was persisted, and the
        // instruction below is deliberately a *different* one — "continue from
        // where you left off"). So the operation is retracted and re-run under
        // its own id, which also means the continuation's answer settles where
        // a later crash-recovery re-entry will find and replay it.
        if (isResumingThisStep) {
          durable?.discardOperation(durableCtx, `${opEpoch}/prompt/${i}`);
        }

        // W22 — the stage's own prompt is the turn that matters most: it is
        // the one that spends money and writes to the workspace, and the one
        // that used to run again in full every time the process restarted.
        await runTurn(`prompt/${i}`, promptText, async () => {
          const promptAttachments = await workflowPromptAttachments(variables?.['__promptDirectories']);
          // Save user prompt as chat message
          await this.messageRepo.create({
            id: generateId(),
            sessionId: session.id,
            role: 'user',
            content: promptText,
            metadata: { stageRunId: stageRun.id },
            timestamp: new Date(),
          });

          // Reset idempotency guard and accumulators so this turn's data gets persisted
          assistantPersisted = false;
          turnThinkingText = '';
          turnToolCalls.length = 0;
          turnSystemMessages.length = 0;
          turnContent = '';

          // Send prompt with optional timeout
          // Send prompt and capture response for persistence.
          // The event-based idle handler may also persist the assistant message
          // (via harness.message_complete → turnContent → harness.idle), but some
          // SDK versions don't emit assistant.message events. Capturing the return
          // value here ensures the message is always persisted reliably.
          let promptResponse: { content: string } | undefined;
          if (session.conversationId) {
            // PLN-01 — a stage's agent mode drives tool availability and the
            // permission policy exactly as a chat's per-turn mode does. Resolved
            // through the shared registry so a new mode needs no change here.
            const stageTurnOptions = this.resolveStageTurnOptions(stageDef);
            const conversationId = session.conversationId;
            // FEAT-3 / WS-D1 — every waited turn now runs under a real
            // deadline: an explicit `stageDef.timeoutMs` is honoured
            // (floored at MIN_TIMEOUT_MS, same as before), and a stage with
            // none gets the documented default instead of running
            // unbounded. `withStageTimeout` clears its timer on the common
            // path and actually aborts the harness call on the timeout path
            // — see its own doc comment.
            if (stageDef.timeoutMs || prompt.waitForCompletion) {
              const effectiveTimeout = stageDef.timeoutMs
                ? Math.max(stageDef.timeoutMs, MIN_TIMEOUT_MS)
                : this.defaultStageTimeoutMs;
              promptResponse = await this.withStageTimeout(
                effectiveTimeout,
                stageRun.id,
                (signal) =>
                  this.harness.sendPromptAndWait(
                    conversationId,
                    promptText,
                    promptAttachments.length ? promptAttachments : undefined,
                    signal,
                    stageTurnOptions,
                  ),
              );
            } else {
              await this.harness.sendPrompt(
                conversationId,
                promptText,
                promptAttachments.length ? promptAttachments : undefined,
                stageTurnOptions,
              );
            }
          }

          // Persist assistant response if the idle handler didn't already
          if (promptResponse?.content && !assistantPersisted) {
            assistantPersisted = true;
            // Use the captured content if turnContent wasn't populated by events
            const content = turnContent.trim().length > 0 ? turnContent : promptResponse.content;
            await this.messageRepo.create({
              id: generateId(),
              sessionId: session.id,
              role: 'assistant',
              content,
              metadata: {
                stageRunId: stageRun.id,
                thinkingText: turnThinkingText || undefined,
                toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
                systemMessages: turnSystemMessages.length > 0 ? [...turnSystemMessages] : undefined,
              },
              timestamp: new Date(),
            });
          }
          // Prefer the accumulator, falling back to what the call returned —
          // the same precedence the persistence block above uses. This is the
          // record's `content`; `accumulated` keeps the raw accumulator.
          return turnContent.trim().length > 0 ? turnContent : (promptResponse?.content ?? '');
        }, { contributesOutput: true });

        // ── POST_PROMPT hook — fire after each prompt turn completes ──
        if (stageDef.hooks && stageDef.hooks.length > 0) {
          const wkDir = variables?.['__workingDirectory'];
          await this.hookExecutor.executePhase('post_prompt', stageDef.hooks, {
            sessionId: session.id,
            workflowId: workflowRunId,
            workspacePath: typeof wkDir === 'string' ? wkDir : process.cwd(),
            variables: Object.fromEntries(
              Object.entries(variables ?? {}).map(([k, v]) => [k, String(v)]),
            ),
            eventBus: this.eventBus,
            workflowRunId,
          }).catch(() => { /* non-fatal — stage continues regardless */ });
        }

        await this.eventBus.emit(session.id, {
          kind: 'stage_run.step_completed',
          data: { stageRunId: stageRun.id, workflowRunId, step: i },
        });
      }

      // Save the stage output content BEFORE the summary turn resets accumulators.
      // This is the content produced by the main prompt(s) that may contain output.json.
      let stageOutputContent = turnContent;

      // ── OUTPUT VALIDATION + RETRY ──
      // After all prompts complete, validate the output based on outputFormat.
      // If validation fails, send a retry prompt (max 2 attempts).
      if (session.conversationId && stageOutputContent) {
        const maxOutputRetries = 2;
        for (let retryAttempt = 0; retryAttempt < maxOutputRetries; retryAttempt++) {
          let outputValid = true;

          if (outputFormat === 'json' && stageDef.outputSchema) {
            // JSON mode: check for output.json code block
            const outputMatch = /```(?:json)?\s*output\.json\s*\n([\s\S]*?)```/.exec(stageOutputContent);
            if (!outputMatch?.[1]) {
              outputValid = false;
            } else {
              // Validate it parses as JSON
              try {
                JSON.parse(outputMatch[1].trim());
              } catch {
                outputValid = false;
              }
            }
          } else if (outputFormat === 'text') {
            // Text mode: ensure substantive output (more than 50 chars)
            if (stageOutputContent.trim().length < 50) {
              outputValid = false;
            }
          }

          if (outputValid) break;

          // Send retry prompt to enforce output generation
          const retryPrompt = outputFormat === 'json'
            ? `Your response is missing the required structured output. You MUST include a JSON code block labeled \`output.json\` matching this schema:\n` +
              '```json output.json\n' +
              JSON.stringify(stageDef.outputSchema, null, 2) + '\n' +
              '```\n' +
              'Please produce ONLY the output.json block now.'
            : `Your response did not include a clear summary of your work. Please provide a concise summary of the actions taken, decisions made, and outputs produced.`;

          const outputRetryConversationId = session.conversationId;
          await runTurn(`output-retry/${retryAttempt}`, retryPrompt, async () => {
            await this.messageRepo.create({
              id: generateId(),
              sessionId: session.id,
              role: 'user',
              content: retryPrompt,
              metadata: { stageRunId: stageRun.id, isOutputRetry: true },
              timestamp: new Date(),
            });

            // Reset accumulators for the retry turn
            assistantPersisted = false;
            turnThinkingText = '';
            turnToolCalls.length = 0;
            turnSystemMessages.length = 0;
            turnContent = '';

            isInternalTurn = true;
            await this.harness.sendPromptAndWait(outputRetryConversationId, retryPrompt);
            isInternalTurn = false;
            return turnContent;
          }, { contributesOutput: true });

          // Update stageOutputContent with accumulated retry response
          if (turnContent.length > 0) {
            stageOutputContent = stageOutputContent + '\n' + turnContent;
          }
        }
      }

      // Generate a summary of work done in this stage.
      // For 'json' outputFormat: auto-generate from extracted JSON (skip LLM call)
      // For 'text' outputFormat: use LLM to generate summary
      let stageSummary: string | undefined;
      if (outputFormat === 'json' && stageOutputContent) {
        // For JSON mode, extract output data first, then auto-generate summary
        const preExtractMatch = /```(?:json)?\s*output\.json\s*\n([\s\S]*?)```/.exec(stageOutputContent);
        if (preExtractMatch?.[1]) {
          try {
            const parsed = JSON.parse(preExtractMatch[1].trim());
            const keys = Object.keys(parsed);
            stageSummary = `Stage "${stageRun.name}" completed. Produced structured output with keys: ${keys.join(', ')}.`;
          } catch {
            stageSummary = `Stage "${stageRun.name}" completed with output.`;
          }
        } else {
          stageSummary = `Stage "${stageRun.name}" completed.`;
        }
      } else if (session.conversationId) {
        try {
          const summaryPrompt =
            `Provide a concise summary (max 500 words) of all the work you just completed in this stage named "${stageRun.name}". ` +
            `Include: key actions taken, files created or modified, important decisions made, and any outputs produced. ` +
            `This summary will be provided to subsequent workflow stages as context. Be specific and factual.`;

          const summaryConversationId = session.conversationId;
          stageSummary = await runTurn('summary', summaryPrompt, async () => {
            // Persist the summary prompt as a user message so
            // the chat history matches what the user sees during streaming
            await this.messageRepo.create({
              id: generateId(),
              sessionId: session.id,
              role: 'user',
              content: summaryPrompt,
              metadata: { stageRunId: stageRun.id, isSummaryPrompt: true },
              timestamp: new Date(),
            });

            // Reset accumulators for the summary turn
            assistantPersisted = false;
            turnThinkingText = '';
            turnToolCalls.length = 0;
            turnSystemMessages.length = 0;
            turnContent = '';

            // Mark as internal turn so the client doesn't reset stream blocks
            isInternalTurn = true;
            const summaryResponse = await this.harness.sendPromptAndWait(
              summaryConversationId,
              summaryPrompt,
            );
            isInternalTurn = false;
            return summaryResponse.content;
          });
        } catch {
          // Non-fatal — the stage still completes. But it must NOT complete
          // with no summary at all: `contextFilter: 'summary-only'` (the
          // default) feeds this text to every downstream stage, so a dropped
          // summary silently starves the rest of the DAG of context.
          //
          // The common cause is a pause or cancel landing between the last
          // prompt turn and this one: `pauseStage` aborts the conversation,
          // `sendPromptAndWait` throws, and the stage completes anyway. Fall
          // back to an excerpt of what the stage actually produced, which is
          // the same material the summary was condensing.
          stageSummary = undefined;
        }
        if (!stageSummary || stageSummary.trim().length === 0) {
          const excerpt = stageOutputContent.trim();
          if (excerpt.length > 0) {
            stageSummary =
              `Stage "${stageRun.name}" completed. A generated summary was unavailable ` +
              `(the summary turn did not finish), so this is the stage's own output:

` +
              (excerpt.length > SUMMARY_FALLBACK_MAX_CHARS
                ? `${excerpt.slice(0, SUMMARY_FALLBACK_MAX_CHARS)}
… (truncated)`
                : excerpt);
          }
        }
      }

      // Unsubscribe
      unsubscribe?.();

      // Persist stage output as artifact files on disk (and workspace)
      const artifactsDirectory = variables?.['__artifactsDirectory'];
      const workspaceDirectory = variables?.['__workingDirectory'];
      if (typeof artifactsDirectory === 'string' && session.id) {
        const runWorkspaceId = typeof variables?.['__workspaceId'] === 'string' ? variables['__workspaceId'] : undefined;
        await this.persistStageArtifacts(
          session.id, stageRun.id, stageRun.name, artifactsDirectory,
          typeof workspaceDirectory === 'string' ? workspaceDirectory : undefined,
          runWorkspaceId,
        );
      }

      // ── Structured output extraction ──
      // If outputSchema is defined, extract the output.json code block from the response
      let outputData: Record<string, unknown> | undefined;
      if (stageDef.outputSchema && stageOutputContent) {
        try {
          const outputMatch = /```(?:json)?\s*output\.json\s*\n([\s\S]*?)```/.exec(stageOutputContent);
          if (outputMatch?.[1]) {
            outputData = JSON.parse(outputMatch[1].trim()) as Record<string, unknown>;
          }
        } catch {
          // Non-fatal — structured output extraction failed
        }
      }

      // ── Artifact manifest extraction ──
      // Build a manifest of files extracted from code blocks. Only include
      // blocks that carry a real filename (fence header, first-line path
      // comment, or surrounding prose). Untitled blocks are code snippets
      // the model quoted for illustration — they are NOT written to the
      // workspace (see `persistStageArtifacts`), so recording them here
      // would surface phantom `unnamed.<ext>` entries in the Files panel
      // that don't correspond to any actual file on disk.
      let artifactManifest: Array<{ path: string; language: string; action: string; sizeBytes: number }> | undefined;
      if (stageOutputContent) {
        const blocks = this.extractCodeBlocks(stageOutputContent).filter((b) => !!b.filename);
        if (blocks.length > 0) {
          artifactManifest = blocks.map((block) => ({
            path: block.filename!,
            language: block.lang || 'text',
            action: 'created',
            sizeBytes: Buffer.byteLength(block.content, 'utf8'),
          }));
        }
      }

      // ── POST_RUN hooks — execute after stage work completes but before status update ──
      if (stageDef.hooks && stageDef.hooks.length > 0) {
        const postRunHookContext: HookContext = {
          sessionId: session.id,
          workflowId: workflowRunId,
          workspacePath: typeof workspaceDirectory === 'string' ? workspaceDirectory : process.cwd(),
          variables: Object.fromEntries(
            Object.entries(variables ?? {}).map(([k, v]) => [k, String(v)]),
          ),
          eventBus: this.eventBus,
          workflowRunId,
        };
        // post_run hooks are non-blocking by convention — failures don't prevent
        // the stage from being marked complete (but they will be logged/evented).
        await this.hookExecutor.executePhase('post_run', stageDef.hooks, postRunHookContext)
          .catch(() => { /* non-fatal — stage already completed its work */ });
      }

      // ── APPROVAL GATE — stage-level review before advancing the DAG ──
      // When stageDef.approvalRequired is true, park the stage in
      // `awaiting_input` after all work + hooks finish. The reviewer can:
      //   • Approve → break the loop and let the stage flip to `completed`.
      //   • Provide feedback → the feedback is sent as a follow-up prompt on
      //     the same session; the agent's response is streamed; then the
      //     stage re-parks for the next review round.
      // Reserve the pending-follow-up slot so per-stage session release is
      // deferred until after the reviewer approves.
      if (stageDef.approvalRequired) {
        const hitl = this.hitlService;
        this.pendingFollowUps.add(stageRun.id);
        try {
          // Persist the current output before parking so the reviewer sees a
          // complete stage on refresh even before approval.
          await this.stageRunRepo.update(stageRun.id, {
            currentStep: stageDef.prompts.length,
            summary: stageSummary,
            outputText: stageOutputContent,
            outputData,
            artifactManifest,
          });

          let approved = false;
          let reviewRound = 0;
          // PLN-01 — a plan-mode stage files its output as a real PlanDocument
          // so a workflow plan is the same artefact as a chat plan: same Plan
          // tab, same revisions, same markdown file under <workspace>/plans/.
          const stagePlansEnabled =
            !!this.planService &&
            resolveModeDescriptor(stageDef.agentMode).planGate === 'blocking';
          let stagePlanId: string | undefined;

          while (!approved) {
            reviewRound += 1;

            if (stagePlansEnabled && stageOutputContent?.trim()) {
              stagePlanId = await this.recordStagePlan({
                planId: stagePlanId,
                stageRun,
                workflowRunId,
                sessionId: session.id,
                content: stageOutputContent,
                variables,
              });
            }

            const interruptPayload = {
              kind: 'stage_completion_review' as const,
              stageName: stageRun.name,
              reason:
                reviewRound === 1
                  ? `Stage "${stageRun.name}" completed. Approve to advance, or send feedback to request changes.`
                  : `Stage "${stageRun.name}" updated after feedback (round ${reviewRound}). Approve or request more changes.`,
              summary: stageSummary,
              reviewRound,
              ...(stagePlanId ? { planId: stagePlanId } : {}),
            };
            // W18 / P1-16 — release the stage-semaphore permit while parked
            // waiting for human approval. The wait can be arbitrarily long, and
            // holding the permit starves other concurrent stages. Re-acquire it
            // once the reviewer has decided so subsequent harness work (e.g.
            // the feedback sendPromptAndWait) runs under the correct bound.
            semaphoreCallbacks?.pause();
            let resolution: Awaited<ReturnType<typeof hitl.interrupt>>;
            try {
              // durability-ok: KNOWN GAP, held deliberately and named here.
              //
              // This IS the `while (invalid) { await gate() }` shape W22 bans,
              // and it is the reason a parked approval still holds resources:
              // the awaited `interrupt()` pins this `executeStage` frame, the
              // allocated agent session, an entry in `stageAwakeableTokens`
              // and a chained timer, where the spec says a pending gate must
              // hold ZERO resources. Suspension proper means returning from
              // `executeStage` at the gate and re-entering on approval.
              //
              // The effect sandwich above is the prerequisite for that (a
              // re-entry has to be cheap and side-effect-free before it can be
              // made routine) and is now in place, but the re-entry itself is
              // NOT implemented: `HitlService.resume`, `pendingFollowUps`, the
              // admission ticket and the per-stage session release all assume
              // a live frame. Turning that inside out is a larger change than
              // this pass can land safely, and a half-suspended gate — one
              // that releases the session but keeps the frame — loses the
              // conversation without gaining anything.
              //
              // The pre-gate side effects this loop repeats ARE now journalled
              // (each review round is its own operation, keyed on the round
              // and a digest of the feedback), so the exponential replay X-23
              // describes cannot occur; what remains is resource retention.
              resolution = await hitl.interrupt( // durability-ok: see above
                stageRun.id,
                workflowRunId,
                interruptPayload,
                {
                  prompt: interruptPayload.reason,
                },
              );
            } finally {
              await semaphoreCallbacks?.resume();
            }

            const outcome = resolutionOutcome(resolution);

            // Mirror the verdict onto the plan so its card stops showing
            // review actions the gate no longer accepts.
            if (stagePlanId && this.planService && outcome !== 'changes_requested') {
              await this.planService
                .recordDecision(
                  stagePlanId,
                  outcome === 'approved' ? 'approved' : 'rejected',
                  {
                    approved: outcome === 'approved',
                    ...(resolution.reason ? { feedback: resolution.reason } : {}),
                    decidedAt: new Date(),
                  },
                )
                .catch(() => undefined);
            }

            if (outcome === 'approved') {
              approved = true;
              break;
            }

            // ── Terminal reject ──
            // Unlike "request changes", rejection ends the review: the stage
            // fails, which makes the existing DAG rules skip every
            // `on_success` descendant and stops the run advancing. Thrown so
            // the catch block below performs the normal failure bookkeeping
            // (status, event, session release) instead of duplicating it.
            if (outcome === 'rejected') {
              const why = (resolution.reason ?? '').trim();
              throw new StageRejectedError(
                why
                  ? `Stage "${stageRun.name}" was rejected by the reviewer: ${why}`
                  : `Stage "${stageRun.name}" was rejected by the reviewer.`,
              );
            }

            // Extract feedback text from resolution value or reason.
            let feedback: string | undefined;
            const rawValue = resolution.value;
            if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
              const v = rawValue as Record<string, unknown>;
              if (typeof v['followUpPrompt'] === 'string' && v['followUpPrompt'].trim().length > 0) {
                feedback = (v['followUpPrompt'] as string).trim();
              } else if (typeof v['feedback'] === 'string' && (v['feedback'] as string).trim().length > 0) {
                feedback = (v['feedback'] as string).trim();
              }
            }
            if (!feedback && typeof rawValue === 'string' && rawValue.trim().length > 0) {
              feedback = rawValue.trim();
            }
            if (!feedback && resolution.reason && resolution.reason.trim().length > 0) {
              feedback = resolution.reason.trim();
            }

            // No feedback → nothing to do; loop and re-park in awaiting_input.
            if (!feedback || !session.conversationId) {
              continue;
            }

            // Send the reviewer feedback as a follow-up user turn on the
            // same session. Persist it as a message, stream the assistant
            // response (existing subscription handles emission + persistence),
            // then update the aggregated output before the next review round.
            // W22 — journalled like every other turn, but keyed on a digest of
            // the feedback as well as the round. A restart re-parks the gate
            // and restarts `reviewRound` at 1, so keying on the round alone
            // would replay the FIRST round's answer at a reviewer who has
            // since asked for something different. Same round + same feedback
            // is the only case that is genuinely the same operation.
            const feedbackText = feedback;
            const reviewConversationId = session.conversationId;
            await runTurn(
              `review/${reviewRound}/${digest(feedbackText)}`,
              feedbackText,
              async () => {
                await this.messageRepo.create({
                  id: generateId(),
                  sessionId: session.id,
                  role: 'user',
                  content: feedbackText,
                  metadata: {
                    stageRunId: stageRun.id,
                    isFollowUpPrompt: true,
                    isApprovalFeedback: true,
                    reviewRound,
                  },
                  timestamp: new Date(),
                });

                // Flip status to running so the UI shows a live stream again.
                await this.stageRunRepo.update(stageRun.id, { status: 'running' });
                await this.eventBus.emit(session.id, {
                  kind: 'stage_run.running',
                  data: { stageRunId: stageRun.id, workflowRunId, sessionId: session.id, name: stageRun.name },
                });

                // Reset per-turn accumulators so the existing subscription can
                // capture the follow-up's assistant message.
                assistantPersisted = false;
                turnThinkingText = '';
                turnToolCalls.length = 0;
                turnSystemMessages.length = 0;
                turnContent = '';

                await this.harness.sendPromptAndWait(
                  reviewConversationId,
                  feedbackText,
                  undefined,
                  undefined,
                  this.resolveStageTurnOptions(stageDef),
                );
                return turnContent;
              },
              { contributesOutput: true },
            );

            // Merge the follow-up turn into the stage output so the next
            // interrupt-payload / persisted `outputText` reflects the
            // updated result.
            if (turnContent.trim().length > 0) {
              stageOutputContent = `${stageOutputContent ?? ''}\n\n---\n\n${turnContent}`;
              const nextSummary = turnContent.slice(0, 400).trim();
              if (nextSummary.length > 0) stageSummary = nextSummary;
              await this.stageRunRepo.update(stageRun.id, {
                summary: stageSummary,
                outputText: stageOutputContent,
              });
            }
            // Loop → interrupt() will flip the row back to awaiting_input.
          }
        } finally {
          this.pendingFollowUps.delete(stageRun.id);
        }
      }

      // ── X-25 / §3.4 — seal the durable result, reclaim the journal ──
      //
      // The artifact is the stage's authoritative output and outlives the
      // stage; the step journal (one register + one `tool_result` per turn)
      // exists only to make an interrupted stage resumable, so once the stage
      // is terminal it is pure growth. `deleteByScope` had zero callers on
      // either repository — this is the retention §3.4 asked for.
      if (durable) {
        durable.appendArtifact(
          durableCtx,
          STAGE_OUTPUT_ARTIFACT,
          stageSummary ? `\n---\n${stageSummary}\n` : '',
          { last: true, meta: { stageRunId: stageRun.id, workflowRunId, stageName: stageRun.name } },
        );
      }

      // A stage settled elsewhere while this turn was finishing must not be
      // resurrected. The liveness monitor fails a stage whose heartbeat went
      // stale and aborts it; when the aborted turn then returns normally, an
      // unconditional write here flipped the row back to `completed` inside a
      // `failed` run — and a later Retry skipped it as done, "completing" in
      // 0s without doing the work. Mirrors the catch path's paused/cancelled
      // guard below.
      const settled = await this.stageRunRepo.getById(stageRun.id).catch(() => null);
      if (settled && (settled.status === 'failed' || settled.status === 'cancelled')) {
        console.warn(
          `[StageExecution] Stage ${stageRun.id} finished after it was already ${settled.status}; keeping ${settled.status}`,
        );
        if (durable) durable.releaseJournal(durableCtx);
        return;
      }

      // Mark complete — set currentStep to totalSteps so progress shows 100%
      await this.stageRunRepo.update(stageRun.id, {
        status: 'completed',
        currentStep: stageDef.prompts.length,
        completedAt: new Date(),
        summary: stageSummary,
        // HANDOFF-1: persist the full raw output so a successor with
        // contextFilter='full' can receive the complete output, not just the
        // condensed summary.
        outputText: stageOutputContent,
        outputData,
        artifactManifest,
      });

      // △ The journal is reclaimed AFTER the terminal status write, never
      // before. Reversed, a crash in that window leaves the row still
      // `running` — so `StartupRecoveryService` relaunches the stage — with
      // the journal that would have replayed its settled turns already
      // deleted, and the final prompt plus every tool call it made runs a
      // second time. The journal is what makes re-entry idempotent, so it has
      // to outlive the write that makes re-entry impossible.
      if (durable) durable.releaseJournal(durableCtx);

      await this.eventBus.emit(session.id, {
        kind: 'stage_run.completed',
        data: { stageRunId: stageRun.id, workflowRunId, name: stageRun.name },
      });

      this.captureStageAfter(stageRun, workflowRunId);

      // ── SCRATCHPAD UPDATE ──
      // Write stage output to the per-run scratchpad JSON file
      this.updateScratchpad(variables, workflowRunId, stageRun, stageDef, outputData, stageSummary)
        .catch(() => { /* non-fatal */ });

      // Release session in per-stage mode — fire-and-forget with timeout
      // to prevent executeStage() from hanging if destroyConversation() never settles.
      // HITL follow-up: skip release if an operator's follow-up injection is
      // pending; `sendStageFollowUp` will release the session itself after it
      // finishes streaming the follow-up turn.
      //
      // Result validation runs AFTER this point (WorkflowRunService reacts to
      // the `stage_run.completed` above), and an in-session retry is defined
      // as "keep the session alive and send the failure back as a follow-up".
      // Releasing here destroyed that conversation first, so the retry landed
      // on MultiHarness's primary-provider fallback and died with
      // `no conversation "stage-…"` — naming a provider the stage never used.
      // Hold the session until validation has had its say; the run's own
      // teardown releases every session, so nothing leaks if it never does.
      if (
        (sessionMode === 'per-stage' || sessionMode === 'auto') &&
        !this.pendingFollowUps.has(stageRun.id) &&
        !mayRetryInSession(stageDef, stageRun)
      ) {
        this.releaseSessionSafe(stageRun.id);
      }
    } catch (error) {
      unsubscribe?.();

      // If stage was paused or cancelled externally (e.g. user paused during
      // execution, SDK abort caused sendPromptAndWait to throw), don't
      // override its status with failed/retry.
      const freshStage = await this.stageRunRepo.getById(stageRun.id).catch(() => null);
      if (freshStage && (freshStage.status === 'paused' || freshStage.status === 'cancelled')) {
        // Persist any partial assistant content accumulated before the abort
        // so it survives in chat history and is visible after resume/refresh.
        if (turnContent.trim().length > 0 && !assistantPersisted) {
          await this.messageRepo.create({
            id: generateId(),
            sessionId: session.id,
            role: 'assistant',
            content: turnContent,
            metadata: {
              stageRunId: stageRun.id,
              partial: true,
              thinkingText: turnThinkingText || undefined,
              toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
            },
            timestamp: new Date(),
          });
        }
        return;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);

      // ── ON_ERROR hook — fire before retry decision ──
      if (stageDef.hooks && stageDef.hooks.length > 0) {
        await this.hookExecutor.executePhase('on_error', stageDef.hooks, {
          sessionId: stageRun.sessionId ?? '__error_session__',
          workflowId: workflowRunId,
          workspacePath: typeof variables?.['__workingDirectory'] === 'string'
            ? variables['__workingDirectory'] as string
            : process.cwd(),
          variables: Object.fromEntries(
            Object.entries(variables ?? {}).map(([k, v]) => [k, String(v)]),
          ),
          eventBus: this.eventBus,
          workflowRunId,
        }).catch(() => { /* non-fatal — error handling must not throw */ });
      }

      // Check retry policy — use stage-defined policy or fall back to default (1 retry)
      //
      // A human rejection is never retried: re-running the stage would ignore
      // the very verdict the reviewer just gave. It goes straight to `failed`,
      // which is what blocks the downstream DAG.
      const retryPolicy = stageDef.retryPolicy ?? DEFAULT_RETRY_POLICY;
      const rejected = error instanceof StageRejectedError;
      if (!rejected && stageRun.retryCount < retryPolicy.maxRetries) {
        // BUGFIX (variable interpolation on internal retry): pass the full
        // execute-stage context through so the retry re-interpolates
        // {{vars}} in stage prompts and re-injects predecessor summaries.
        // Without these, the retry would call executeStage(...,
        // undefined, undefined, undefined) and send the literal
        // `{{topic}}` placeholder to the harness.
        await this.retryStage(
          stageRun.id,
          workflowRunId,
          sessionMode,
          retryPolicy,
          workflowharnessConfig,
          variables,
          predecessorSummaries,
        );
      } else {
        // Terminal failure — same retention as the success path. The artifact
        // keeps whatever the stage did produce (a failed stage's partial
        // output is often the only evidence of why it failed); the journal
        // goes, because nothing will resume this stage run again.
        if (this.durableEngine) {
          this.durableEngine.appendArtifact(
            { scope: 'stage_run', scopeId: stageRun.id },
            STAGE_OUTPUT_ARTIFACT,
            `\n---\nStage failed: ${errorMsg}\n`,
            { last: true, meta: { stageRunId: stageRun.id, workflowRunId, stageName: stageRun.name } },
          );
        }

        await this.stageRunRepo.update(stageRun.id, {
          status: 'failed',
          error: errorMsg,
          completedAt: new Date(),
        });

        // Same ordering rule as the success path: the journal is only safe to
        // drop once the row can no longer be relaunched by recovery.
        if (this.durableEngine) {
          this.durableEngine.releaseJournal({ scope: 'stage_run', scopeId: stageRun.id });
        }

        await this.eventBus.emit(session.id, {
          kind: 'stage_run.failed',
          data: { stageRunId: stageRun.id, workflowRunId, error: errorMsg, name: stageRun.name },
        });

        // Release session — fire-and-forget with timeout
        this.releaseSessionSafe(stageRun.id);
      }
    } finally {
      // WS-D1 (task 4) — stop beating this stage's heartbeat on every exit
      // from the main execution block: normal completion, an early return
      // (pause/cancel detected mid-loop), or the catch above (retry/fail).
      // A `finally` on this try covers all three uniformly, including the
      // `return` inside the step loop (line ~1670-ish) that `unsubscribe?.()`
      // already relied on the same guarantee for.
      this.stopHeartbeat(stageRun.id);
    }

    stageDuration.record(Date.now() - start, { stage_name: stageRun.name });
    });
  }

  /**
   * In-session retry: send validation feedback as a follow-up prompt in the
   * existing conversation, then re-run summary generation and artifacts.
   *
   * The agent sees its own previous output in conversation history plus the
   * validation failure details. This allows it to correct its output without
   * starting from scratch.
   */
  async retryInSession(
    stageRun: StageRun,
    workflowRunId: string,
    validationReason: string,
    sessionConfig?: Partial<HarnessConfig>,
    variables?: Record<string, unknown>,
  ): Promise<void> {
    const stageDef = await this.stageDefRepo.getById(stageRun.stageDefinitionId);

    // The stage must already have a session assigned from the original execution
    if (!stageRun.sessionId) {
      throw new StageExecutionError('Cannot retry in-session: no session assigned', stageRun.id);
    }

    // Look up the session's conversation ID from the allocator
    const session = await this.sessionAllocator.getSessionById(stageRun.sessionId);
    if (!session?.conversationId) {
      throw new StageExecutionError('Cannot retry in-session: no conversation found', stageRun.id);
    }

    await this.eventBus.emit(session.id, {
      kind: 'stage_run.running',
      data: { stageRunId: stageRun.id, workflowRunId, sessionId: session.id, name: stageRun.name },
    });

    // Build validation feedback message
    const retryAttempt = stageRun.retryCount;
    const feedbackMessage =
      `⚠️ **Validation Failed (Retry attempt ${retryAttempt})**\n\n` +
      `Your previous output for this stage did not pass validation:\n\n` +
      `${validationReason}\n\n` +
      `Please regenerate your output addressing ALL the above issues. ` +
      `Your previous response is visible in this conversation — review it and provide a corrected version.`;

    // Persist feedback as user message
    await this.messageRepo.create({
      id: generateId(),
      sessionId: session.id,
      role: 'user',
      content: feedbackMessage,
      metadata: { stageRunId: stageRun.id, isValidationFeedback: true },
      timestamp: new Date(),
    });

    // Subscribe to conversation events (like main executeStage flow)
    let assistantPersisted = false;
    let turnContent = '';
    let turnThinkingText = '';
    const turnToolCalls: Array<{ id: string; tool: string; args: unknown; result?: unknown; status: 'running' | 'complete' }> = [];

    const unsubscribe = this.harness.onConversationEvent(
      session.conversationId,
      async (event: AgentEvent) => {
        // Emit events to SSE stream (NOT internal turn — user should see retry)
        await this.eventBus.emit(
          session.id,
          createEnrichedAgentEvent(event, { stageRunId: stageRun.id, workflowRunId, isInternalTurn: false }),
        );

        if (event.kind === 'harness.reasoning_delta') {
          const data = event.data as { text?: string };
          if (data.text) turnThinkingText += data.text;
        }
        if (event.kind === 'harness.tool_start') {
          const data = event.data as { callId?: string; tool?: string; args?: unknown };
          const id = data.callId ?? `tc_${turnToolCalls.length}`;
          const existing = data.callId
            ? turnToolCalls.find((tc) => tc.id === data.callId)
            : undefined;
          const hasIncomingArgs =
            data.args != null &&
            (typeof data.args !== 'object' ||
              Object.keys(data.args as Record<string, unknown>).length > 0);
          if (existing) {
            if (hasIncomingArgs) existing.args = data.args;
            if (!existing.tool && data.tool) existing.tool = data.tool;
          } else {
            turnToolCalls.push({ id, tool: data.tool ?? 'unknown', args: data.args, status: 'running' });
          }
        }
        if (event.kind === 'harness.tool_complete') {
          const data = event.data as { callId?: string; tool?: string; result?: unknown };
          const match = turnToolCalls.find((tc) => tc.id === data.callId || (data.tool && tc.tool === data.tool && tc.status === 'running'));
          if (match) { match.result = data.result; match.status = 'complete'; }
        }
        if (event.kind === 'harness.message_complete') {
          const data = event.data as { content?: string };
          if (data.content) {
            turnContent = data.content;
          }
        }
        if (event.kind === 'harness.idle' && !assistantPersisted && turnContent.trim().length > 0) {
          assistantPersisted = true;
          await this.messageRepo.create({
            id: generateId(),
            sessionId: session.id,
            role: 'assistant',
            content: turnContent,
            metadata: {
              stageRunId: stageRun.id,
              thinkingText: turnThinkingText || undefined,
              toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
              isValidationRetry: true,
            },
            timestamp: new Date(),
          });
        }
      },
    );

    try {
      // Send the follow-up prompt in the existing conversation
      // durability-ok: `retryInSession` is a separate entry point, driven by an
      // operator decision on an already-completed stage. It has no journalled
      // sequence to be part of, and a restart mid-way must NOT silently replay
      // it — the operator re-issues the retry.
      await this.harness.sendPromptAndWait(session.conversationId, feedbackMessage); // durability-ok: see above

      unsubscribe?.();

      // Re-generate summary with updated output
      let stageSummary: string | undefined;
      try {
        const summaryPrompt =
          `Provide a concise summary (max 500 words) of all the work you just completed in this stage named "${stageRun.name}". ` +
          `Include: key actions taken, files created or modified, important decisions made, and any outputs produced. ` +
          `This summary will be provided to subsequent workflow stages as context. Be specific and factual.`;

        // durability-ok: `retryInSession`'s own summary turn — same separate
        // entry point as the follow-up above, with no journalled sequence to
        // belong to.
        const summaryResponse = await this.harness.sendPromptAndWait( // durability-ok: see above
          session.conversationId,
          summaryPrompt,
        );
        stageSummary = summaryResponse.content;
      } catch {
        // Non-fatal
      }

      // Re-persist artifacts (the new response may have updated code blocks)
      const artifactsDirectory = variables?.['__artifactsDirectory'];
      const workspaceDirectory = variables?.['__workingDirectory'];
      if (typeof artifactsDirectory === 'string' && session.id) {
        const runWorkspaceId = typeof variables?.['__workspaceId'] === 'string' ? variables['__workspaceId'] : undefined;
        await this.persistStageArtifacts(
          session.id, stageRun.id, stageRun.name, artifactsDirectory,
          typeof workspaceDirectory === 'string' ? workspaceDirectory : undefined,
          runWorkspaceId,
        );
      }

      // ── POST_RUN hooks — also run after in-session retry completion ──
      if (stageDef.hooks && stageDef.hooks.length > 0) {
        const postRunHookContext: HookContext = {
          sessionId: session.id,
          workflowId: workflowRunId,
          workspacePath: typeof workspaceDirectory === 'string' ? workspaceDirectory : process.cwd(),
          variables: Object.fromEntries(
            Object.entries(variables ?? {}).map(([k, v]) => [k, String(v)]),
          ),
          eventBus: this.eventBus,
          workflowRunId,
        };
        await this.hookExecutor.executePhase('post_run', stageDef.hooks, postRunHookContext)
          .catch(() => { /* non-fatal — stage already completed its work */ });
      }

      // Mark completed with updated summary
      await this.stageRunRepo.update(stageRun.id, {
        status: 'completed',
        completedAt: new Date(),
        summary: stageSummary ?? stageRun.summary,
      });

      await this.eventBus.emit(session.id, {
        kind: 'stage_run.completed',
        data: { stageRunId: stageRun.id, workflowRunId, name: stageRun.name },
      });

      this.captureStageAfter(stageRun, workflowRunId);
    } catch (error) {
      unsubscribe?.();
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.stageRunRepo.update(stageRun.id, {
        status: 'failed',
        error: `In-session retry failed: ${errorMsg}`,
        completedAt: new Date(),
      });
      await this.eventBus.emit(session.id, {
        kind: 'stage_run.failed',
        data: { stageRunId: stageRun.id, workflowRunId, error: errorMsg, name: stageRun.name },
      });
    }
  }

  /**
   * HITL follow-up: inject a user-supplied follow-up prompt into a stage's
   * existing conversation and stream the agent's response back to the run.
   *
   * Used when an operator resumes an `awaiting_input` stage and wants to hand
   * the agent additional details/instructions as the HITL response. Requires
   * the stage to still have a live session + conversation (true while a stage
   * is awaiting_input / running, and for single-session completed stages). The
   * response streams to the run SSE under the same stageRunId, so the UI shows
   * it inline in the stage spine exactly like a normal turn.
   */
  async sendStageFollowUp(
    stageRunId: string,
    workflowRunId: string,
    prompt: string,
  ): Promise<void> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);
    if (!stageRun.sessionId) {
      throw new StageExecutionError('Cannot send follow-up: no session assigned to this stage', stageRunId);
    }

    // ── Wait for the natural stage flow to finish its current in-flight
    //    turn before injecting the follow-up. This avoids a race where the
    //    parked `sendPromptAndWait` (unblocked by hitl.resume) and the
    //    follow-up's own `sendPromptAndWait` both fire against the same
    //    conversation, which the underlying SDKs generally do not queue.
    //    We wait until stageRun.status transitions out of `running` /
    //    `awaiting_input`. If further HITL prompts fire during the natural
    //    flow, we auto-approve isn't our concern here — we just wait until
    //    the stage settles.
    const waitStart = Date.now();
    const settleTimeoutMs = 10 * 60_000; // 10 min hard cap
    let settled = stageRun;
    while (Date.now() - waitStart < settleTimeoutMs) {
      const current = await this.stageRunRepo.getById(stageRunId).catch(() => null);
      if (!current) break;
      settled = current;
      if (current.status !== 'running' && current.status !== 'awaiting_input') {
        // 'completed', 'failed', 'paused', 'cancelled' — safe to inject (or bail).
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // If the natural flow failed / was cancelled, don't try to inject.
    if (settled.status === 'failed' || settled.status === 'cancelled') {
      console.warn(`[StageExecutionService] Skipping follow-up injection — stage settled to ${settled.status}`);
      this.pendingFollowUps.delete(stageRunId);
      return;
    }

    // Re-check the session is still alive. For per-stage session mode the
    // session may have been released after natural completion; in that case
    // the follow-up cannot be delivered.
    const session = await this.sessionAllocator.getSessionById(stageRun.sessionId);
    if (!session?.conversationId) {
      console.warn(`[StageExecutionService] Cannot inject follow-up — session for stage ${stageRunId} is no longer live (per-stage mode may have released it after completion)`);
      this.pendingFollowUps.delete(stageRunId);
      return;
    }

    // Flip to running so the UI shows the live stream for this stage again.
    await this.stageRunRepo.update(stageRunId, { status: 'running' });
    await this.eventBus.emit(session.id, {
      kind: 'stage_run.running',
      data: { stageRunId: stageRun.id, workflowRunId, sessionId: session.id, name: stageRun.name },
    });

    // Persist the follow-up as a user message (visible in history + audit trail).
    await this.messageRepo.create({
      id: generateId(),
      sessionId: session.id,
      role: 'user',
      content: prompt,
      metadata: { stageRunId: stageRun.id, isFollowUpPrompt: true },
      timestamp: new Date(),
    });

    // Stream the response turn (mirrors the in-session retry plumbing).
    let assistantPersisted = false;
    let turnContent = '';
    let turnThinkingText = '';
    const turnToolCalls: Array<{ id: string; tool: string; args: unknown; result?: unknown; status: 'running' | 'complete' }> = [];

    const unsubscribe = this.harness.onConversationEvent(
      session.conversationId,
      async (event: AgentEvent) => {
        await this.eventBus.emit(
          session.id,
          createEnrichedAgentEvent(event, { stageRunId: stageRun.id, workflowRunId, isInternalTurn: false }),
        );
        if (event.kind === 'harness.reasoning_delta') {
          const data = event.data as { text?: string };
          if (data.text) turnThinkingText += data.text;
        }
        if (event.kind === 'harness.tool_start') {
          const data = event.data as { callId?: string; tool?: string; args?: unknown };
          const id = data.callId ?? `tc_${turnToolCalls.length}`;
          const existing = data.callId
            ? turnToolCalls.find((tc) => tc.id === data.callId)
            : undefined;
          const hasIncomingArgs =
            data.args != null &&
            (typeof data.args !== 'object' ||
              Object.keys(data.args as Record<string, unknown>).length > 0);
          if (existing) {
            if (hasIncomingArgs) existing.args = data.args;
            if (!existing.tool && data.tool) existing.tool = data.tool;
          } else {
            turnToolCalls.push({ id, tool: data.tool ?? 'unknown', args: data.args, status: 'running' });
          }
        }
        if (event.kind === 'harness.tool_complete') {
          const data = event.data as { callId?: string; tool?: string; result?: unknown };
          const match = turnToolCalls.find((tc) => tc.id === data.callId || (data.tool && tc.tool === data.tool && tc.status === 'running'));
          if (match) { match.result = data.result; match.status = 'complete'; }
        }
        if (event.kind === 'harness.message_complete') {
          const data = event.data as { content?: string };
          if (data.content) turnContent = data.content;
        }
        if (event.kind === 'harness.idle' && !assistantPersisted && turnContent.trim().length > 0) {
          assistantPersisted = true;
          await this.messageRepo.create({
            id: generateId(),
            sessionId: session.id,
            role: 'assistant',
            content: turnContent,
            metadata: {
              stageRunId: stageRun.id,
              thinkingText: turnThinkingText || undefined,
              toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
              isFollowUpResponse: true,
            },
            timestamp: new Date(),
          });
        }
      },
    );

    try {
      // durability-ok: `sendStageFollowUp` is an operator-initiated turn on a
      // stage that has already left `executeStage`. Same reasoning as
      // `retryInSession` — there is no epoch to key it on, and replaying an
      // operator's follow-up without them asking is worse than not replaying.
      await this.harness.sendPromptAndWait(session.conversationId, prompt); // durability-ok: see above
      unsubscribe?.();
      await this.stageRunRepo.update(stageRunId, { status: 'completed', completedAt: new Date() });
      await this.eventBus.emit(session.id, {
        kind: 'stage_run.completed',
        data: { stageRunId: stageRun.id, workflowRunId, name: stageRun.name },
      });

      // Follow-ups are how review feedback reaches a stage, so the closing
      // snapshot here is what lets those threads flip to `addressed`.
      this.captureStageAfter(stageRun, workflowRunId);
    } catch (error) {
      unsubscribe?.();
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.stageRunRepo.update(stageRunId, {
        status: 'failed',
        error: `Follow-up failed: ${errorMsg}`,
        completedAt: new Date(),
      });
      await this.eventBus.emit(session.id, {
        kind: 'stage_run.failed',
        data: { stageRunId: stageRun.id, workflowRunId, error: errorMsg, name: stageRun.name },
      });
    } finally {
      // Clear the pending-follow-up flag and, if the natural flow deferred
      // per-stage session release for us, release it now.
      const wasPending = this.pendingFollowUps.delete(stageRunId);
      if (wasPending) {
        this.releaseSessionSafe(stageRunId);
      }
    }
  }

  /**
   * Pause a running stage — abort in-flight work.
   */
  async pauseStage(stageRunId: string): Promise<void> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);
    if (stageRun.status !== 'running') return;

    if (stageRun.sessionId) {
      const session = await this.getSessionForStageRun(stageRunId);
      if (session?.conversationId) {
        try {
          await this.harness.abortConversation(session.conversationId);
        } catch {
          // May not be active
        }
      }
    }

    await this.stageRunRepo.updateStatus(stageRunId, 'paused');
  }

  /**
   * Resume a paused stage.
   * Determines whether the last step's response was interrupted mid-turn
   * (needs continuation prompt) or completed (advance to next step).
   */
  async resumeStage(
    stageRunId: string,
    workflowRunId: string,
    sessionMode: 'single' | 'per-stage' | 'auto',
    workflowharnessConfig?: Partial<HarnessConfig>,
    variables?: Record<string, unknown>,
    predecessorSummaries?: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown> }>,
  ): Promise<void> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);
    if (stageRun.status !== 'paused') return;

    // Re-hydrate SDK handle using the real conversationId from DB
    if (stageRun.sessionId) {
      const session = await this.sessionAllocator.getSessionById(stageRun.sessionId);
      if (session?.conversationId) {
        try {
          await this.harness.resumeConversation(session.conversationId);
        } catch {
          // May need fresh session — allocateSession will handle
        }
      }
    }

    // Determine if the interrupted step needs a continuation prompt.
    // When paused mid-turn, the catch block persists a partial assistant message
    // (metadata.partial = true). When paused between turns, the last message is
    // a complete assistant response (no partial flag). If no messages exist, the
    // step never started and no continuation is needed.
    let continuationNeeded = true; // default: assume mid-turn interrupt
    if (stageRun.sessionId) {
      const session = await this.sessionAllocator.getSessionById(stageRun.sessionId);
      if (session) {
        try {
          const messages = await this.messageRepo.getBySessionAndStageRunId(session.id, stageRunId);
          if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1]!;
            if (lastMsg.role === 'assistant') {
              // If the assistant message is marked partial, the turn was interrupted
              continuationNeeded = !!lastMsg.metadata?.partial;
            } else if (lastMsg.role === 'user') {
              // If last message is a special/internal user message, the prompt
              // for this step was never sent — no continuation needed
              if (
                lastMsg.metadata?.isContextMessage ||
                lastMsg.metadata?.isHookContext ||
                lastMsg.metadata?.isValidationFeedback ||
                lastMsg.metadata?.isSummaryPrompt ||
                lastMsg.metadata?.isOutputRetry
              ) {
                continuationNeeded = false;
              }
              // Otherwise it's the step's prompt → response was interrupted
              // before any content was generated (continuationNeeded stays true)
            }
          } else {
            // No messages at all — step never started
            continuationNeeded = false;
          }
        } catch {
          // If message query fails, assume continuation needed (safe default)
        }
      }
    }

    // If the step already completed (turn finished), advance to the next step
    // so executeStage doesn't re-run the completed step.
    if (!continuationNeeded) {
      const currentStep = stageRun.currentStep ?? 0;
      const stageDef = await this.stageDefRepo.getById(stageRun.stageDefinitionId);
      const nextStep = currentStep + 1;
      if (nextStep >= stageDef.prompts.length) {
        // All steps were completed before pause (pause during finalization).
        // Advance currentStep past bounds so the for-loop in executeStage is skipped
        // and finalization logic (summary, artifacts) re-runs.
        await this.stageRunRepo.update(stageRunId, { status: 'running', currentStep: nextStep });
      } else {
        await this.stageRunRepo.update(stageRunId, { status: 'running', currentStep: nextStep });
      }
    } else {
      await this.stageRunRepo.updateStatus(stageRunId, 'running');
    }

    // Re-fetch stageRun after status/step update so executeStage sees latest state
    const updated = await this.stageRunRepo.getById(stageRunId);
    // BUGFIX: pass variables / harness config / predecessor summaries through
    // so multi-prompt stages keep `{{var}}` interpolation after a pause/resume.
    await this.executeStage(
      updated,
      workflowRunId,
      sessionMode,
      workflowharnessConfig,
      variables,
      predecessorSummaries,
      {
        resumeFromPause: true,
        continuationNeeded,
      },
    );
  }

  /**
   * Cancel a stage — abort + destroy.
   */
  async cancelStage(stageRunId: string): Promise<void> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);
    if (stageRun.status === 'completed' || stageRun.status === 'cancelled' ||
        stageRun.status === 'skipped' || stageRun.status === 'failed') return;

    if (stageRun.sessionId) {
      const session = await this.getSessionForStageRun(stageRunId);
      if (session?.conversationId) {
        try { await this.harness.abortConversation(session.conversationId); } catch {}
        try { await this.harness.destroyConversation(session.conversationId); } catch {}
      }
    }

    // ── ON_CANCEL hook — fire before status update ──
    const cancelStageDef = await this.stageDefRepo?.getById?.(stageRun.stageDefinitionId).catch(() => null);
    if (cancelStageDef?.hooks && cancelStageDef.hooks.length > 0) {
      await this.hookExecutor.executePhase('on_cancel', cancelStageDef.hooks, {
        sessionId: stageRun.sessionId ?? '__cancel_session__',
        workflowId: stageRun.workflowRunId,
        workspacePath: process.cwd(),
        variables: {},
        eventBus: this.eventBus,
        workflowRunId: stageRun.workflowRunId,
      }).catch(() => { /* non-fatal — cancellation must not throw */ });
    }

    await this.stageRunRepo.updateStatus(stageRunId, 'cancelled');
    await this.sessionAllocator.releaseSession(stageRunId);
  }

  // ── Private Helpers ──

  private async retryStage(
    stageRunId: string,
    workflowRunId: string,
    sessionMode: 'single' | 'per-stage' | 'auto',
    retryPolicy: { maxRetries: number; backoffMs: number; backoffMultiplier: number },
    workflowharnessConfig?: Partial<HarnessConfig>,
    variables?: Record<string, unknown>,
    predecessorSummaries?: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown> }>,
  ): Promise<void> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);
    const backoff = retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, stageRun.retryCount);

    // Wait for backoff
    await new Promise((resolve) => setTimeout(resolve, backoff));

    // Increment retry count and reset to queued
    await this.stageRunRepo.incrementRetryCount(stageRunId);
    await this.stageRunRepo.update(stageRunId, {
      status: 'queued',
      currentStep: 0,
      error: undefined,
    });

    // Release old session
    await this.sessionAllocator.releaseSession(stageRunId);

    // Re-execute with the FULL original call context so variables / harness
    // config / predecessor summaries are preserved on retry. Without these,
    // prompts would lose their `{{var}}` substitutions on the retry attempt.
    const updated = await this.stageRunRepo.getById(stageRunId);
    await this.executeStage(
      updated,
      workflowRunId,
      sessionMode,
      workflowharnessConfig,
      variables,
      predecessorSummaries,
    );
  }

  private async getSessionForStageRun(stageRunId: string): Promise<{ conversationId?: string } | null> {
    try {
      const stageRun = await this.stageRunRepo.getById(stageRunId);
      if (!stageRun.sessionId) return null;
      return await this.sessionAllocator.getSessionById(stageRun.sessionId);
    } catch {
      return null;
    }
  }

  /**
   * Creates or revises the PlanDocument backing a plan-mode stage review.
   *
   * Best-effort and non-throwing: a bookkeeping failure must never fail a
   * stage that otherwise succeeded. Returns the plan id so subsequent review
   * rounds add revisions instead of spawning a new card each time.
   */
  private async recordStagePlan(params: {
    planId: string | undefined;
    stageRun: StageRun;
    workflowRunId: string;
    sessionId: string;
    content: string;
    variables?: Record<string, unknown>;
  }): Promise<string | undefined> {
    const planService = this.planService;
    if (!planService) return params.planId;

    const workspaceRoot =
      typeof params.variables?.['__workingDirectory'] === 'string'
        ? (params.variables['__workingDirectory'] as string)
        : undefined;

    try {
      if (params.planId) {
        await planService.addRevision({
          planId: params.planId,
          content: params.content,
          summary: params.content.slice(0, 400).trim(),
          authoredBy: 'agent',
          ...(workspaceRoot ? { workspaceRoot } : {}),
        });
        await planService.setStatus(params.planId, 'awaiting_review');
        return params.planId;
      }

      const plan = await planService.createFromGate({
        // A stage has no chat, but `chatId` is the plan's owning scope column.
        // Using the stage run id keeps the row self-consistent and the
        // dedicated stage columns carry the real linkage.
        chatId: params.stageRun.id,
        sessionId: params.sessionId,
        turnId: params.stageRun.id,
        stageRunId: params.stageRun.id,
        workflowRunId: params.workflowRunId,
        title: params.stageRun.name,
        summary: params.content.slice(0, 400).trim(),
        content: params.content,
        harnessType: 'copilot',
        availableActions: ['implement_interactive', 'exit_only'],
        ...(workspaceRoot ? { workspaceRoot } : {}),
      });
      return plan.id;
    } catch (err) {
      console.warn(
        `[StageExecution] failed to record stage plan for ${params.stageRun.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      return params.planId;
    }
  }

  /**
   * Per-turn harness options for a stage.
   *
   * A stage with no explicit `agentMode` inherits the autonomous default, so
   * every pre-existing workflow keeps behaving exactly as before. When a stage
   * opts into `plan`, the permission policy is forced read-only by the mode
   * descriptor — the same mechanism the chat composer uses.
   */
  private resolveStageTurnOptions(stageDef: StageDefinition): SendPromptOptions {
    const agentMode = stageDef.agentMode ?? DEFAULT_AGENT_MODE;
    return {
      agentMode,
      permissionMode: resolveTurnPermissionMode(agentMode, undefined),
    };
  }

  /**
   * Release a session without blocking the caller.
   * Uses a 10s timeout to prevent hanging if destroyConversation() never settles.
   */
  private releaseSessionSafe(stageRunId: string): void {
    const RELEASE_TIMEOUT = 10_000;
    Promise.race([
      this.sessionAllocator.releaseSession(stageRunId),
      new Promise<void>((resolve) => setTimeout(resolve, RELEASE_TIMEOUT)),
    ]).catch(() => {/* swallow — stage is already in terminal state */});
  }

  /**
   * Update the per-run scratchpad JSON file with this stage's output.
   * The scratchpad is a temp file at: {executionDir}/scratchpad.json
   * It tracks all stages' outputs in one place for easy inspection.
   */
  private async updateScratchpad(
    variables: Record<string, unknown> | undefined,
    workflowRunId: string,
    stageRun: { id: string; name: string; stageDefinitionId: string },
    stageDef: { outputFormat?: 'text' | 'json' },
    outputData: Record<string, unknown> | undefined,
    summary: string | undefined,
  ): Promise<void> {
    const executionDir = variables?.['__artifactsDirectory'];
    if (typeof executionDir !== 'string') return;

    const { writeFile, readFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const scratchpadPath = join(executionDir, '..', 'scratchpad.json');
    const outputFormat = stageDef.outputFormat ?? 'text';

    // Read existing scratchpad or create new one
    let scratchpad: {
      workflowRunId: string;
      entries: Array<{
        stageName: string;
        stageDefinitionId: string;
        stageRunId: string;
        status: string;
        outputFormat: string;
        output: unknown;
        completedAt?: string;
      }>;
      lastUpdated: string;
    };

    try {
      const existing = await readFile(scratchpadPath, 'utf-8');
      scratchpad = JSON.parse(existing);
    } catch {
      // File doesn't exist yet — initialize
      scratchpad = {
        workflowRunId,
        entries: [],
        lastUpdated: new Date().toISOString(),
      };
    }

    // Update or add entry for this stage
    const entryIndex = scratchpad.entries.findIndex(
      (e) => e.stageRunId === stageRun.id,
    );
    const entry = {
      stageName: stageRun.name,
      stageDefinitionId: stageRun.stageDefinitionId,
      stageRunId: stageRun.id,
      status: 'completed' as const,
      outputFormat,
      output: outputFormat === 'json' ? (outputData ?? null) : (summary ?? null),
      completedAt: new Date().toISOString(),
    };

    if (entryIndex >= 0) {
      scratchpad.entries[entryIndex] = entry;
    } else {
      scratchpad.entries.push(entry);
    }
    scratchpad.lastUpdated = new Date().toISOString();

    // Ensure directory exists and write
    try {
      const dir = join(executionDir, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(scratchpadPath, JSON.stringify(scratchpad, null, 2), 'utf-8');
    } catch {
      // Non-fatal — scratchpad write failure shouldn't affect stage completion
    }
  }
}
