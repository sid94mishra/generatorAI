// ────────────────────────────────────────────────────────────────
// WorkflowToolHost — what the workflow tools do, for any caller (P06
// WP-6.1; G4 §2.2–2.3). `buildWorkflowToolSet` wraps these methods as tool
// definitions for a chat, an orchestrator chat, a stage or (through the
// server's tool route) an external MCP client; every binding runs this one
// implementation.
//
// The hard limits live HERE, not in the approval prompt: on Claude or Codex
// under bypass the prompt is never consulted (C-5).
//   - the permission ceiling: a run never gets more than its caller's mode
//   - depth ≤ 3 and no recursion (the invocation lineage)
//   - `maxChildRuns` per run tree (default 10) and concurrent runs per chat
//     (default 3)
//   - budget and deadline caps derived from the caller (an orchestrator's
//     episode, a stage's own timeouts)
//   - idempotency from the tool call id: a replayed call answers the same run
//   - scopes: in-process tools act for the chat's creating principal
//   - approvals: an agent answers only a COMPLETION REVIEW, only on a run it
//     started whose invocation delegated approvals to it; tool-permission
//     gates and every other decision need a person
// ────────────────────────────────────────────────────────────────

import type { ChatPrincipal, WorkflowRun } from '@generatorai/shared';
import {
  MAX_INVOCATION_DEPTH,
  riskFlags,
  type InvocationPlan,
  type InvocationRequest,
  type InvocationTrigger,
  type RunDigest,
  type RunPermissionMode,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { IChatRepository } from '../../domain/ports/IChatRepository.js';
import type { IStageRunRepository } from '../../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { IChatWorkflowRunRepository } from '../../domain/ports/IInvocationStores.js';
import type { CommandResult } from '../../services/engine/RunSupervisor.js';
import type { WorkflowApprovalService } from '../../services/WorkflowApprovalService.js';
import type { WorkflowAuthoringService } from '../../services/WorkflowAuthoringService.js';
import type { WorkflowDefinitionService } from '../../services/WorkflowDefinitionService.js';
import type { WorkflowInvocationService } from '../../services/workflow-invocation/WorkflowInvocationService.js';
import { InvocationError, type InvocationContext, type InvocationPrincipal } from '../../services/workflow-invocation/types.js';
import type { WorkspaceMount } from '@generatorai/shared';

/** Who calls the workflow tools. */
export type WorkflowToolCaller =
  | {
      kind: 'chat';
      chatId: string;
      sessionId: string;
      conversationId: string;
      /** An orchestrator chat: trigger `orchestrator`, its episode deadline caps waits and child runs. */
      orchestrator: boolean;
    }
  | { kind: 'stage'; runId: string; stageRunId: string; conversationId: string }
  | {
      kind: 'external';
      principal: InvocationPrincipal;
      via: 'mcp' | 'http';
      clientName?: string | undefined;
      loopback?: boolean | undefined;
    };

/** The turn a tool call belongs to (chats and stages). */
export interface WorkflowToolTurn {
  turnId?: string;
  permissionMode?: string;
}

export interface WorkflowToolLimits {
  /** Nested runs one run tree may start (a root's own `budget.maxChildRuns` wins). */
  maxChildRunsPerRoot: number;
  /** Runs one chat may have going at once. */
  maxConcurrentPerChat: number;
  /** The longest `waitSeconds` a call may block. */
  maxWaitSeconds: number;
}

export const DEFAULT_WORKFLOW_TOOL_LIMITS: WorkflowToolLimits = {
  maxChildRunsPerRoot: 10,
  maxConcurrentPerChat: 3,
  maxWaitSeconds: 600,
};

/** A run a chat started: the bridge records the link and mirrors the run onto the chat (WP-6.2). */
export interface ChatRunLinker {
  link(input: { chatId: string; sessionId: string; runId: string; toolCallId: string | null; workflowId: string; workflowName: string; link: string }): Promise<void>;
}

export interface WorkflowToolHostDeps {
  invocation: WorkflowInvocationService;
  definitions: WorkflowDefinitionService;
  approvals: WorkflowApprovalService;
  authoring?: WorkflowAuthoringService | undefined;
  runs: IWorkflowRunRepository;
  stageRuns: IStageRunRepository;
  chats?: IChatRepository | undefined;
  links?: IChatWorkflowRunRepository | undefined;
  linker?: ChatRunLinker | undefined;
  /** A run command (cancel), with who sent it. */
  command: (runId: string, command: { command: 'cancel' }, opts: { actor?: string }) => Promise<CommandResult>;
  /** An orchestrator chat's episode deadline (epoch ms). */
  orchestratorDeadline?: ((chatId: string) => number | undefined) | undefined;
  /** The chat's mounts, their dirty flags refreshed (`workspace: from_chat_branch`). */
  chatMounts?: ((workspaceId: string) => Promise<WorkspaceMount[]>) | undefined;
  limits?: Partial<WorkflowToolLimits> | undefined;
  /** The web app origin, for links. */
  appUrl?: string | undefined;
  now?: () => number;
}

/** A refusal the tool returns to the model (never thrown past the handler). */
export class WorkflowToolRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WorkflowToolRefusal';
  }
}

/** Chats created before v60 carry no principal: the local owner created them. */
const LOCAL_OWNER: ChatPrincipal = { kind: 'local', id: 'local', scopes: [] };
/** The engine's principal (stage callers): scopes are not the limit, the lineage and ceiling are. */
const ENGINE_PRINCIPAL: InvocationPrincipal = { kind: 'system', id: 'engine', scopes: [] };

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const RUN_MODES = new Set<string>(['plan', 'default', 'acceptEdits', 'bypassPermissions']);

/** The trusted side of one call: who, as what trigger, under which limits. */
interface ResolvedCaller {
  principal: InvocationPrincipal;
  /** `system` principals hold every scope; for the rest these are checked. */
  scopes: ReadonlySet<string> | 'all';
  trigger: InvocationTrigger;
  lineage?: InvocationContext['lineage'];
  ceiling?: RunPermissionMode;
  remainingChildRuns?: number;
  deadlineAt?: number;
  projectId?: string;
  chat?: { id: string; sessionId: string; workspaceId?: string };
  actor: string;
  loopback: boolean;
}

export interface RunToolArgs {
  workflowId: string;
  variables?: Record<string, unknown>;
  codebases?: Array<{ alias: string; baseRef?: string }>;
  stageOverrides?: Array<{ stageKey: string; skip?: boolean; model?: string; variables?: Record<string, unknown> }>;
  model?: string;
  permissionMode?: RunPermissionMode;
  workspace?: 'isolated' | 'from_chat_branch';
  wait?: 'none' | 'until_done' | 'until_approval_or_done';
  waitSeconds?: number;
  approvalDelegate?: 'human' | 'invoker';
  reason: string;
  projectId?: string;
}

export class WorkflowToolHost {
  readonly limits: WorkflowToolLimits;
  private readonly now: () => number;

  constructor(private readonly deps: WorkflowToolHostDeps) {
    this.limits = { ...DEFAULT_WORKFLOW_TOOL_LIMITS, ...(deps.limits ?? {}) };
    this.now = deps.now ?? Date.now;
  }

  get hasAuthoring(): boolean {
    return !!this.deps.authoring;
  }

  get authoring(): WorkflowAuthoringService {
    if (!this.deps.authoring) throw new WorkflowToolRefusal('UNAVAILABLE', 'Workflow authoring is not available in this process');
    return this.deps.authoring;
  }

  // ── caller ───────────────────────────────────────────────────

  private async resolve(caller: WorkflowToolCaller, turn: WorkflowToolTurn | undefined, toolCallId: string | undefined): Promise<ResolvedCaller> {
    if (caller.kind === 'external') {
      const trigger: InvocationTrigger = {
        kind: 'external_agent',
        via: caller.via,
        principalId: caller.principal.id,
        ...(caller.clientName ? { clientName: caller.clientName } : {}),
      };
      return {
        principal: caller.principal,
        scopes: caller.principal.kind === 'system' ? 'all' : new Set(caller.principal.scopes),
        trigger,
        actor: `agent:${caller.via}:${caller.principal.id}`,
        loopback: caller.loopback === true,
      };
    }

    if (caller.kind === 'chat') {
      const chat = this.deps.chats ? await this.deps.chats.getById(caller.chatId).catch(() => null) : null;
      if (chat?.parentChatId) throw new WorkflowToolRefusal('FORBIDDEN', 'Orchestrator workers cannot start workflows');
      const p = chat?.createdByPrincipal ?? LOCAL_OWNER;
      const principal: InvocationPrincipal = { kind: p.kind, id: p.id, scopes: p.scopes };
      const mode = turn?.permissionMode ?? chat?.permissionMode;
      const deadlineAt = caller.orchestrator ? this.deps.orchestratorDeadline?.(caller.chatId) : undefined;
      const trigger: InvocationTrigger = caller.orchestrator
        ? { kind: 'orchestrator', chatId: caller.chatId, ...(toolCallId ? { toolCallId } : {}) }
        : { kind: 'chat', chatId: caller.chatId, ...(turn?.turnId ? { turnId: turn.turnId } : {}), ...(toolCallId ? { toolCallId } : {}) };
      return {
        principal,
        // The local owner (and pre-v60 chats) hold every scope.
        scopes: p.kind === 'local' || p.kind === 'system' ? 'all' : new Set(p.scopes),
        trigger,
        ...(mode && RUN_MODES.has(mode) ? { ceiling: mode as RunPermissionMode } : {}),
        ...(deadlineAt !== undefined ? { deadlineAt } : {}),
        ...(chat?.projectId ? { projectId: chat.projectId } : {}),
        chat: { id: caller.chatId, sessionId: caller.sessionId, ...(chat?.workspaceId ? { workspaceId: chat.workspaceId } : {}) },
        actor: `agent:chat:${caller.chatId}`,
        loopback: true,
      };
    }

    // A stage: the lineage of its run, its mode as the ceiling, its timeouts as the deadline.
    const run = await this.deps.runs.getById(caller.runId);
    const stage = await this.deps.stageRuns.getById(caller.stageRunId).catch(() => null);
    const rootRunId = run.rootRunId ?? run.id;
    const root = rootRunId === run.id ? run : await this.deps.runs.getById(rootRunId).catch(() => run);
    const cap = Number((root.budget as { maxChildRuns?: unknown } | undefined)?.maxChildRuns ?? this.limits.maxChildRunsPerRoot);
    const used = await this.deps.runs.countDescendantsOfRoot(rootRunId);
    const deadlineAt = await this.stageDeadline(run, stage);
    const ceiling = (run.effectivePermissionMode ?? run.permissionMode ?? 'default') as RunPermissionMode;
    return {
      principal: ENGINE_PRINCIPAL,
      scopes: 'all',
      trigger: { kind: 'stage', runId: run.id, stageRunId: caller.stageRunId, ...(toolCallId ? { toolCallId } : {}) },
      lineage: {
        rootRunId,
        parentRunId: run.id,
        parentStageRunId: caller.stageRunId,
        depth: run.depth ?? 0,
        ancestryDefinitionIds: await this.ancestry(run),
      },
      ceiling,
      remainingChildRuns: Math.max(0, cap - used),
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
      ...(run.projectId ? { projectId: run.projectId } : {}),
      actor: `agent:stage:${caller.stageRunId}`,
      loopback: true,
    };
  }

  /** What is left of a stage's own time: its attempt budget from the attempt start, capped by the run's deadline. */
  private async stageDeadline(run: WorkflowRun, stage: { startedAt?: Date | undefined; stageKey: string } | null): Promise<number | undefined> {
    const deadlines: number[] = [];
    const wall = Number((run.budget as { maxWallClockMs?: unknown } | undefined)?.maxWallClockMs);
    if (Number.isFinite(wall) && run.startedAt) deadlines.push(run.startedAt.getTime() + wall);
    if (stage?.startedAt) {
      try {
        const graph = await this.definitionGraphOf(run);
        const spec = graph.stages.find((s) => s.key === stage.stageKey);
        const t = spec && spec.kind === 'agent' ? spec.timeouts : undefined;
        const ms = t?.attemptMs ?? t?.totalMs;
        if (ms) deadlines.push(stage.startedAt.getTime() + ms);
      } catch {
        /* no graph: the run's own deadline stands */
      }
    }
    return deadlines.length > 0 ? Math.min(...deadlines) : undefined;
  }

  private async definitionGraphOf(run: WorkflowRun): Promise<WorkflowGraph> {
    const v = await this.deps.definitions.getVersion(run.workflowDefinitionId, run.definitionVersionId);
    return v.graph;
  }

  private async ancestry(run: WorkflowRun): Promise<string[]> {
    const out = [run.workflowDefinitionId];
    let parentId = run.parentRunId;
    for (let i = 0; parentId && i <= MAX_INVOCATION_DEPTH; i++) {
      const parent = await this.deps.runs.getById(parentId).catch(() => null);
      if (!parent) break;
      out.push(parent.workflowDefinitionId);
      parentId = parent.parentRunId;
    }
    return out;
  }

  private need(c: ResolvedCaller, scope: string, why: string): void {
    if (c.scopes === 'all' || c.scopes.has(scope)) return;
    throw new WorkflowToolRefusal('FORBIDDEN_SCOPE', `${why} needs the ${scope} scope, which the principal this agent acts for does not hold`);
  }

  // ── visibility ───────────────────────────────────────────────

  /** Whether the caller started this run (the run itself, not a descendant). */
  private async startedBy(c: ResolvedCaller, run: WorkflowRun): Promise<boolean> {
    const t = (run.trigger ?? {}) as Record<string, unknown>;
    if (c.chat) {
      if ((t['kind'] === 'chat' || t['kind'] === 'orchestrator') && t['chatId'] === c.chat.id) return true;
      const link = await this.deps.links?.chatOf(run.id);
      return link?.chatId === c.chat.id;
    }
    if (c.trigger.kind === 'stage') return t['kind'] === 'stage' && t['stageRunId'] === c.trigger.stageRunId;
    if (c.trigger.kind === 'external_agent') return t['principalId'] === c.principal.id;
    return false;
  }

  /** Runs in the caller's lineage (it started the run or one of its ancestors), or started by the same principal. */
  private async visible(c: ResolvedCaller, run: WorkflowRun): Promise<boolean> {
    let cur: WorkflowRun | null = run;
    for (let i = 0; cur && i <= MAX_INVOCATION_DEPTH; i++) {
      if (await this.startedBy(c, cur)) return true;
      if (c.trigger.kind === 'stage' && cur.parentRunId === c.trigger.runId) return true;
      cur = cur.parentRunId ? await this.deps.runs.getById(cur.parentRunId).catch(() => null) : null;
    }
    const t = (run.trigger ?? {}) as Record<string, unknown>;
    return c.principal.kind !== 'system' && c.principal.id !== 'local' && t['principalId'] === c.principal.id;
  }

  private async runFor(c: ResolvedCaller, runId: string, need: 'visible' | 'started'): Promise<WorkflowRun> {
    const run = await this.deps.runs.getById(runId).catch(() => null);
    if (!run) throw new WorkflowToolRefusal('NOT_FOUND', `No run ${runId}`);
    const ok = need === 'started' ? await this.startedBy(c, run) : await this.visible(c, run);
    if (!ok) {
      throw new WorkflowToolRefusal(
        'FORBIDDEN',
        need === 'started' ? `Run ${runId} was not started by you; only the runs you started can be changed here` : `Run ${runId} is not in your lineage`,
      );
    }
    return run;
  }

  link(run: Pick<WorkflowRun, 'id' | 'workflowDefinitionId'>): string {
    return `${this.deps.appUrl ?? ''}/workflows/${run.workflowDefinitionId}/runs/${run.id}`;
  }

  // ── list / describe ──────────────────────────────────────────

  async list(args: { query?: string; projectId?: string; tag?: string; limit?: number }, opts: { includeDrafts: boolean }): Promise<unknown> {
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 50);
    const page = await this.deps.definitions.list({
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.query ? { q: args.query } : {}),
      ...(opts.includeDrafts ? {} : { status: 'published' as const }),
      limit: 200,
    });
    const items = page.items.filter((d) => !args.tag || d.tags.includes(args.tag)).slice(0, limit);
    const out = [];
    for (const d of items) {
      const graph = await this.graphOf(d.id).catch(() => null);
      out.push({
        id: d.id,
        name: d.name,
        ...(d.description ? { description: d.description } : {}),
        status: d.status,
        ...(d.agentAuthored ? { agentAuthored: true } : {}),
        projectId: d.projectId,
        tags: d.tags,
        stageCount: d.stageCount,
        ...(graph
          ? {
              variables: graph.workflow.variables.map((v) => ({ name: v.name, type: v.type, required: v.required && v.defaultValue === undefined })),
              requiresCodebase: graph.workflow.lifecycle.requiresCodebase,
              postProcessing: postProcessingOf(graph),
            }
          : {}),
      });
    }
    return { count: out.length, workflows: out };
  }

  /** The graph a run would use: the current published version, else the working draft. */
  private async graphOf(id: string): Promise<WorkflowGraph> {
    const record = await this.deps.definitions.get(id);
    if (record.currentVersionId) {
      try {
        return (await this.deps.definitions.getVersion(id, record.currentVersionId)).graph;
      } catch {
        /* fall back to the working graph */
      }
    }
    return record.graph;
  }

  async describe(workflowId: string): Promise<unknown> {
    const record = await this.deps.definitions.get(workflowId).catch(() => null);
    if (!record) throw new WorkflowToolRefusal('NOT_FOUND', `No workflow ${workflowId}; call list_workflows`);
    const graph = await this.graphOf(workflowId);
    const wf = graph.workflow;
    const validation = await this.deps.definitions.validate(graph, { definitionId: workflowId }).catch(() => null);
    return {
      id: record.id,
      name: wf.name,
      ...(wf.description ? { description: wf.description } : {}),
      status: record.status,
      ...(record.authoredBy ? { authoredBy: record.authoredBy } : {}),
      variables: wf.variables.map((v) => ({
        name: v.name,
        type: v.type,
        required: v.required,
        ...(v.defaultValue !== undefined ? { default: v.defaultValue } : {}),
        ...(v.options?.length ? { options: v.options } : {}),
        ...(v.description ? { description: v.description } : {}),
      })),
      stages: graph.stages.map((s) => ({
        key: s.key,
        name: s.name,
        kind: s.kind,
        ...(s.parentKey ? { parent: s.parentKey } : {}),
        ...(s.kind === 'agent' && s.session?.agentRef ? { agent: s.session.agentRef } : {}),
        ...(s.kind === 'agent' && (s.session?.model ?? wf.session.model) ? { model: s.session?.model ?? wf.session.model } : {}),
        ...(s.kind === 'agent' && s.approval ? { approval: true } : {}),
        ...(s.guard ? { guard: s.guard } : {}),
      })),
      edges: graph.edges.map((e) => ({ from: e.from, to: e.to, on: e.on, ...(e.when ? { when: e.when } : {}) })),
      codebases: { aliases: wf.lifecycle.codebaseAliases, required: wf.lifecycle.requiresCodebase, worktrees: wf.lifecycle.useWorktree },
      postProcessing: postProcessingOf(graph),
      permissionMode: wf.session.permissionMode ?? null,
      risks: riskFlags(graph),
      warnings: (validation?.issues ?? []).filter((i) => i.severity === 'warning').map((i) => i.message),
      ...(wf.outputs ? { outputs: Object.keys(wf.outputs) } : {}),
    };
  }

  // ── run ──────────────────────────────────────────────────────

  async run(caller: WorkflowToolCaller, args: RunToolArgs, call: { toolCallId?: string | undefined; turn?: WorkflowToolTurn | undefined }): Promise<unknown> {
    if (typeof args.reason !== 'string' || !args.reason.trim()) throw new WorkflowToolRefusal('VALIDATION_ERROR', 'reason is required: one line saying why you start this run');
    const c = await this.resolve(caller, call.turn, call.toolCallId);
    this.need(c, 'exec:agent', 'Starting a workflow run');
    const record = await this.deps.definitions.get(args.workflowId).catch(() => null);
    if (!record) throw new WorkflowToolRefusal('NOT_FOUND', `No workflow ${args.workflowId}; call list_workflows`);
    if (record.status !== 'published') {
      throw new WorkflowToolRefusal('DRAFT_NOT_RUNNABLE', `Workflow "${record.graph.workflow.name}" is a draft: a person must publish it before it can run`, {
        reviewLink: this.deps.authoring?.reviewLink(record.id),
      });
    }

    // Per-chat concurrency (a replayed call is not a new run).
    if (c.chat && this.deps.links) {
      const linked = await this.deps.links.listByChat(c.chat.id);
      const replay = call.toolCallId ? linked.some((l) => l.toolCallId === call.toolCallId) : false;
      if (!replay) {
        let active = 0;
        for (const l of linked) {
          const r = await this.deps.runs.getById(l.runId).catch(() => null);
          if (r && !TERMINAL.has(r.status)) active += 1;
        }
        if (active >= this.limits.maxConcurrentPerChat) {
          throw new WorkflowToolRefusal('CONCURRENCY_LIMIT', `This chat already has ${active} workflow runs going (at most ${this.limits.maxConcurrentPerChat}); wait for one with check_workflow_run`);
        }
      }
    }

    // The workspace (G4 §2.6): isolated worktrees, or cut from the chat's branches.
    let codebases = args.codebases?.map((cb) => ({ alias: cb.alias, mode: 'worktree' as const, ...(cb.baseRef ? { baseRef: cb.baseRef } : {}) }));
    let parentWorkspaceId: string | undefined;
    if (args.workspace === 'from_chat_branch') {
      if (!c.chat?.workspaceId || !this.deps.chatMounts) throw new WorkflowToolRefusal('VALIDATION_ERROR', 'workspace "from_chat_branch" needs a chat with a workspace');
      const mounts = await this.deps.chatMounts(c.chat.workspaceId);
      const branches = mounts.filter((m) => m.originKind === 'codebase' && m.git?.isRepo && m.git.branch);
      if (branches.length === 0) throw new WorkflowToolRefusal('VALIDATION_ERROR', 'The chat has no project codebase on a branch; use workspace "isolated"');
      const dirty = branches.filter((m) => m.hasUncommittedChanges);
      if (dirty.length > 0) {
        throw new WorkflowToolRefusal('CHAT_DIRTY', `The chat has uncommitted changes in ${dirty.map((m) => m.alias).join(', ')}: commit them (or ask the user to) before starting a run from the chat branch`);
      }
      const byAlias = new Map(branches.map((m) => [m.alias, m.git!.branch!]));
      codebases = (codebases ?? branches.map((m) => ({ alias: m.alias, mode: 'worktree' as const }))).map((cb) =>
        byAlias.has(cb.alias) ? { ...cb, baseRef: byAlias.get(cb.alias)! } : cb,
      );
      parentWorkspaceId = c.chat.workspaceId;
    }

    // Budget: a child never outlives its caller.
    const remainingMs = c.deadlineAt !== undefined ? c.deadlineAt - this.now() : undefined;
    if (remainingMs !== undefined && remainingMs < 10_000) {
      throw new WorkflowToolRefusal('BUDGET_EXHAUSTED', 'Too little of your time budget is left to start a workflow run');
    }
    const projectId = args.projectId ?? record.graph.workflow.projectId ?? c.projectId;
    const request: InvocationRequest = {
      target: { kind: 'definition', workflowDefinitionId: args.workflowId },
      variables: args.variables ?? {},
      ...(projectId ? { projectId } : {}),
      ...(codebases ? { codebases } : {}),
      ...(args.stageOverrides?.length ? { stageOverrides: args.stageOverrides } : {}),
      ...(args.model || args.permissionMode
        ? { overrides: { ...(args.model ? { model: args.model } : {}), ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}) } }
        : {}),
      ...(remainingMs !== undefined ? { budget: { maxDurationMs: Math.min(86_400_000, Math.floor(remainingMs)) } } : {}),
    } as InvocationRequest;
    const ctx: InvocationContext = {
      principal: c.principal,
      trigger: c.trigger,
      ...(c.lineage ? { lineage: c.lineage } : {}),
      ...(c.ceiling ? { callerPermissionCeiling: c.ceiling } : {}),
      ...(c.remainingChildRuns !== undefined ? { budget: { remainingChildRuns: c.remainingChildRuns } } : {}),
      loopback: c.loopback,
      approvalDelegate: args.approvalDelegate === 'invoker' ? 'invoker' : 'human',
      ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
      // External callers bring their own key (MCP `idempotencyKey`).
      ...(caller.kind === 'external' && call.toolCallId ? { idempotencyKey: call.toolCallId } : {}),
    };
    const result = await this.deps.invocation.invoke(request, ctx);
    if (c.chat) {
      await this.deps.linker
        ?.link({
          chatId: c.chat.id,
          sessionId: c.chat.sessionId,
          runId: result.runId,
          toolCallId: call.toolCallId ?? null,
          workflowId: result.workflowDefinitionId,
          workflowName: result.plan.workflowName,
          link: result.links.app,
        })
        .catch(() => undefined);
    }
    const out: Record<string, unknown> = {
      runId: result.runId,
      status: result.status,
      link: result.links.app,
      replayed: result.replayed,
      plan: compactPlan(result.plan),
    };
    if (args.wait && args.wait !== 'none') {
      const digest = await this.wait(result.runId, args.wait === 'until_approval_or_done', args.waitSeconds, c.deadlineAt);
      out['status'] = digest.status;
      out['digest'] = compactDigest(digest);
      if (!digest.finalized) out['hint'] = 'The run is still going: call check_workflow_run with wait to follow it';
    }
    return out;
  }

  private wait(runId: string, stopOnApproval: boolean, waitSeconds: number | undefined, deadlineAt: number | undefined): Promise<RunDigest> {
    let ms = Math.min(Math.max(waitSeconds ?? 60, 0), this.limits.maxWaitSeconds) * 1000;
    if (deadlineAt !== undefined) ms = Math.max(0, Math.min(ms, deadlineAt - this.now()));
    return this.deps.invocation.waitFor(runId, { timeoutMs: ms, stopOnApproval });
  }

  // ── check / respond / cancel ─────────────────────────────────

  async check(caller: WorkflowToolCaller, args: { runId: string; wait?: boolean; waitSeconds?: number }, call: { turn?: WorkflowToolTurn | undefined }): Promise<unknown> {
    const c = await this.resolve(caller, call.turn, undefined);
    const run = await this.runFor(c, args.runId, 'visible');
    const digest = args.wait ? await this.wait(run.id, true, args.waitSeconds, c.deadlineAt) : await this.deps.invocation.digest(run.id);
    const pending = await this.deps.approvals.listPending(run.id).catch(() => []);
    const delegated = run.systemVars?.approvalDelegate === 'invoker' && (await this.startedBy(c, run));
    return {
      ...compactDigest(digest),
      link: this.link(run),
      pendingApprovals: pending.map((d) => ({
        runId: d.runId,
        instanceId: d.instanceId,
        stageKey: d.stageKey,
        stageName: d.name,
        kind: d.kind,
        answerableByYou: delegated && d.runId === run.id && d.kind === 'stage_completion_review',
      })),
      ...(run.systemVars?.artifactsDirectory ? { artifactsDirectory: run.systemVars.artifactsDirectory } : {}),
    };
  }

  async respond(
    caller: WorkflowToolCaller,
    args: { runId: string; instanceId: string; outcome: 'approved' | 'changes_requested' | 'rejected'; feedback?: string; reason: string },
    call: { turn?: WorkflowToolTurn | undefined },
  ): Promise<unknown> {
    const c = await this.resolve(caller, call.turn, undefined);
    this.need(c, 'exec:agent', 'Answering a run decision');
    const run = await this.runFor(c, args.runId, 'started');
    const link = this.link(run);
    const decision = (await this.deps.approvals.listPending(run.id)).find((d) => d.instanceId === args.instanceId);
    if (!decision) throw new WorkflowToolRefusal('NOT_FOUND', `Run ${run.id} is not waiting on instance ${args.instanceId}; call check_workflow_run`);
    if (decision.kind !== 'stage_completion_review' || decision.runId !== run.id) {
      return { ok: false, error: 'needs a human', detail: `A ${decision.kind} decision is answered by a person on the run page`, link };
    }
    if (run.systemVars?.approvalDelegate !== 'invoker') {
      return { ok: false, error: 'needs a human', detail: 'This run did not delegate its approvals to you (approvalDelegate "invoker")', link };
    }
    const r = await this.deps.approvals.respond(
      run.id,
      args.instanceId,
      { outcome: args.outcome, ...(args.feedback ? { feedback: args.feedback } : {}) },
      { actor: `${c.actor} (${args.reason.slice(0, 200)})` },
    );
    return r.ok ? { ok: true, outcome: args.outcome } : { ok: false, error: r.message ?? r.code ?? 'refused', link };
  }

  async cancel(caller: WorkflowToolCaller, args: { runId: string; reason: string }, call: { turn?: WorkflowToolTurn | undefined }): Promise<unknown> {
    const c = await this.resolve(caller, call.turn, undefined);
    this.need(c, 'exec:agent', 'Cancelling a run');
    const run = await this.runFor(c, args.runId, 'started');
    if (TERMINAL.has(run.status)) return { ok: true, status: run.status };
    const r = await this.deps.command(run.id, { command: 'cancel' }, { actor: `${c.actor} (${String(args.reason ?? '').slice(0, 200)})` });
    return r.ok ? { ok: true, status: 'cancelling' } : { ok: false, error: r.message ?? 'refused' };
  }

  // ── authoring ────────────────────────────────────────────────

  async createDraft(
    caller: WorkflowToolCaller,
    args: { graph: unknown; projectId?: string; replacesWorkflowId?: string },
    call: { turn?: WorkflowToolTurn | undefined },
  ): Promise<unknown> {
    const c = await this.resolve(caller, call.turn, undefined);
    this.need(c, 'write:workflows', 'Creating a workflow draft');
    const authoredBy =
      caller.kind === 'external'
        ? { kind: 'external_agent' as const, via: caller.via, principalId: caller.principal.id, ...(caller.clientName ? { clientName: caller.clientName } : {}) }
        : caller.kind === 'chat'
          ? { kind: caller.orchestrator ? ('orchestrator' as const) : ('chat' as const), chatId: caller.chatId, principalId: c.principal.id }
          : { kind: 'stage' as const, runId: caller.runId, stageRunId: caller.stageRunId };
    const projectId = args.projectId ?? c.projectId;
    return this.authoring.createDraft(args.graph, {
      authoredBy: { ...authoredBy, ...(args.replacesWorkflowId ? { replacesWorkflowId: args.replacesWorkflowId } : {}) },
      ...(projectId ? { projectId } : {}),
      canEditCommands: canEditCommands(caller, c),
    });
  }

  async plan(
    caller: WorkflowToolCaller,
    args: { graph?: unknown; workflowId?: string; variables?: Record<string, unknown>; stageOverrides?: unknown[] },
    call: { turn?: WorkflowToolTurn | undefined },
  ): Promise<unknown> {
    const c = await this.resolve(caller, call.turn, undefined);
    const r = await this.authoring.plan(
      { ...args, ...(c.projectId ? { projectId: c.projectId } : {}) },
      {
        principal: c.principal,
        trigger: c.trigger,
        ...(c.lineage ? { lineage: c.lineage } : {}),
        ...(c.ceiling ? { callerPermissionCeiling: c.ceiling } : {}),
        loopback: c.loopback,
      },
    );
    return { ...r, plan: compactPlan(r.plan) };
  }

  async validate(caller: WorkflowToolCaller, args: { graph: unknown; schemaHash?: string }, call: { turn?: WorkflowToolTurn | undefined }): Promise<unknown> {
    const c = await this.resolve(caller, call.turn, undefined);
    const r = await this.authoring.validate(args.graph, { canEditCommands: canEditCommands(caller, c) });
    return {
      ...r,
      ...(args.schemaHash && r.schema.hash && args.schemaHash !== r.schema.hash
        ? { schemaDrift: `Your skill was generated for schema ${args.schemaHash}; this server validates against ${r.schema.hash}. Read get_workflow_authoring_guide("schema") for the current fields.` }
        : {}),
    };
  }
}

// ── shaping ──────────────────────────────────────────────────────

/**
 * Whether the caller may write command-bearing fields (`admin:settings`,
 * W-34). A stage agent never may: what it drafts runs only after a person
 * with that right reviews it.
 */
function canEditCommands(caller: WorkflowToolCaller, c: ResolvedCaller): boolean {
  if (caller.kind === 'stage') return false;
  return c.scopes === 'all' || c.scopes.has('admin:settings');
}

function postProcessingOf(graph: WorkflowGraph): string[] {
  const pp = graph.workflow.lifecycle.postProcessing;
  const out: string[] = [];
  if (pp.autoCommit) out.push('autoCommit');
  if (pp.autoPush) out.push('autoPush');
  if (pp.autoCreatePR) out.push('autoCreatePR');
  for (const s of pp.steps) out.push(`${s.config.type}:${s.name}`);
  return out;
}


export function compactPlan(plan: InvocationPlan): Record<string, unknown> {
  return {
    workflowName: plan.workflowName,
    stages: plan.stages.map((s) => ({
      key: s.key,
      kind: s.kind,
      ...(s.parentKey ? { parent: s.parentKey } : {}),
      ...(s.skipped ? { skipped: s.skipReason ?? true } : {}),
      ...(s.model ? { model: s.model } : {}),
      ...(s.agentRef ? { agent: s.agentRef } : {}),
      ...(s.approvalRequired ? { approval: true } : {}),
    })),
    codebases: plan.codebases,
    postProcessing: plan.postProcessing,
    permissionMode: plan.permissionMode,
    ...(plan.risks.length ? { risks: plan.risks.map((r) => r.message) } : {}),
    ...(plan.warnings.length ? { warnings: plan.warnings.map((w) => w.message) } : {}),
    lineage: plan.lineage,
  };
}

/** The digest an agent reads: stage summaries at most 600 characters, never a transcript. */
export function compactDigest(d: RunDigest): Record<string, unknown> {
  const cut = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
  return {
    runId: d.runId,
    name: d.name,
    status: d.status,
    ...(d.statusReason ? { statusReason: d.statusReason } : {}),
    finalized: d.finalized,
    ...(d.error ? { error: cut(d.error, 600) } : {}),
    stages: d.stages.map((s) => ({
      key: s.key,
      ...(s.instancePath !== s.key ? { instancePath: s.instancePath } : {}),
      status: s.status,
      ...(s.summary ? { summary: cut(s.summary, 600) } : {}),
      ...(s.error ? { error: cut(s.error, 600) } : {}),
    })),
    postProcessing: d.postProcessing.map((p) => ({ step: p.step, success: p.success, ...(p.output ? { output: cut(p.output, 600) } : {}), ...(p.error ? { error: cut(p.error, 600) } : {}) })),
    ...(d.waited ? { waited: d.waited } : {}),
  };
}

/** An error as the model sees it: one code, a message, the issues behind it. */
export function toolError(err: unknown): Record<string, unknown> {
  if (err instanceof WorkflowToolRefusal) return { ok: false, code: err.code, error: err.message, ...err.extra };
  if (err instanceof InvocationError) {
    return { ok: false, code: err.code, error: err.message, ...(err.issues.length ? { issues: err.issues.slice(0, 20) } : {}) };
  }
  const code = (err as { code?: unknown } | null)?.code;
  return { ok: false, ...(typeof code === 'string' ? { code } : {}), error: err instanceof Error ? err.message : String(err) };
}
