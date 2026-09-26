// ────────────────────────────────────────────────────────────────
// ChatWorkflowRunBridge — a run a chat started, seen from the chat (P06
// WP-6.2; G4 §2.4). The chat's workflow tools link the run here
// (`chat_workflow_runs`, v60); from then on the run's own events are
// mirrored onto the chat's session scope:
//
//   chat.workflow_run.linked             the run card appears
//   chat.workflow_run.progress           status / current stage / n of m
//                                        (≤ 1 per 500 ms per run; stage
//                                        transitions are not throttled)
//   chat.workflow_run.awaiting_approval  a decision is parked
//   chat.workflow_run.finalized          after post-processing
//
// When a run finalizes or parks on a decision and the chat is idle, the
// chat gets ONE `[system]` message (the orchestrator's wave-nudge guard:
// never while a turn is streaming). `cards(chatId)` rebuilds the cards
// after a reload or a restart.
// ────────────────────────────────────────────────────────────────

import type { ILogger, PersistedEvent, StageRun } from '@generatorai/shared';
import type { ChatWorkflowRunCard } from '@generatorai/workflow-spec';
import type { IChatRepository } from '../../domain/ports/IChatRepository.js';
import type { IChatWorkflowRunRepository } from '../../domain/ports/IInvocationStores.js';
import type { IStageRunRepository } from '../../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { EventBus } from '../../events/EventBus.js';
import type { WorkflowApprovalService } from '../WorkflowApprovalService.js';
import type { ChatRunLinker } from '../../tools/workflows/WorkflowToolHost.js';

/** How the bridge reaches the chat to nudge it. */
export interface ChatNudgePort {
  /** A turn is streaming (or claimed) in this chat. */
  isTurnActive(chatId: string): boolean;
  sendPrompt(chatId: string, prompt: string): Promise<unknown>;
}

export interface ChatWorkflowRunBridgeDeps {
  eventBus: EventBus;
  links: IChatWorkflowRunRepository;
  runs: IWorkflowRunRepository;
  stageRuns: IStageRunRepository;
  chats: IChatRepository;
  approvals: WorkflowApprovalService;
  nudge?: ChatNudgePort | undefined;
  appUrl?: string | undefined;
  logger?: ILogger | undefined;
  /** Progress throttle per run (default 500 ms). */
  throttleMs?: number;
}


interface Linked {
  chatId: string;
  sessionId: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STAGE_DONE = new Set(['completed', 'skipped', 'failed', 'cancelled']);
const STAGE_TRANSITIONS = new Set([
  'stage_run.running',
  'stage_run.completed',
  'stage_run.failed',
  'stage_run.skipped',
  'stage_run.cancelled',
  'stage_run.retrying',
  'stage_run.paused',
  'stage_run.resumed',
  'stage_run.input_received',
]);
const RUN_STATUS = new Set(['workflow_run.running', 'workflow_run.paused', 'workflow_run.resumed', 'workflow_run.cancelling', 'workflow_run.completed', 'workflow_run.failed', 'workflow_run.cancelled']);
const MAX_CACHE = 5000;

export class ChatWorkflowRunBridge implements ChatRunLinker {
  /** runId → the chat it belongs to (null: not a chat's run). */
  private readonly linked = new Map<string, Linked | null>();
  private readonly lastProgress = new Map<string, number>();
  private readonly pendingProgress = new Map<string, ReturnType<typeof setTimeout>>();
  /** Instances already announced as parked (one message per decision). */
  private readonly announced = new Set<string>();
  private unsubscribe: (() => void) | undefined;
  private readonly throttleMs: number;

  constructor(private readonly deps: ChatWorkflowRunBridgeDeps) {
    this.throttleMs = deps.throttleMs ?? 500;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.eventBus.subscribeGlobal((event) => {
      void this.onEvent(event).catch((err: unknown) => this.deps.logger?.warn?.(`[ChatWorkflowRunBridge] ${event.kind}: ${String(err)}`));
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const t of this.pendingProgress.values()) clearTimeout(t);
    this.pendingProgress.clear();
  }

  private link_(run: { id: string; workflowDefinitionId: string }): string {
    return `${this.deps.appUrl ?? ''}/workflows/${run.workflowDefinitionId}/runs/${run.id}`;
  }

  // ── linking ──────────────────────────────────────────────────

  async link(input: { chatId: string; sessionId: string; runId: string; toolCallId: string | null; workflowId: string; workflowName: string; link: string }): Promise<void> {
    await this.deps.links.link({ chatId: input.chatId, runId: input.runId, toolCallId: input.toolCallId, createdAt: new Date() });
    this.remember(input.runId, { chatId: input.chatId, sessionId: input.sessionId });
    const run = await this.deps.runs.getById(input.runId).catch(() => null);
    await this.deps.eventBus.emit(input.sessionId, {
      kind: 'chat.workflow_run.linked',
      data: {
        chatId: input.chatId,
        runId: input.runId,
        workflowId: input.workflowId,
        workflowName: input.workflowName,
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
        status: run?.status ?? 'starting',
        link: input.link,
      },
    });
  }

  private remember(runId: string, v: Linked | null): void {
    if (this.linked.size >= MAX_CACHE) this.linked.clear();
    this.linked.set(runId, v);
  }

  private async linkedChat(runId: string): Promise<Linked | null> {
    if (this.linked.has(runId)) return this.linked.get(runId)!;
    const link = await this.deps.links.chatOf(runId).catch(() => null);
    let v: Linked | null = null;
    if (link) {
      const chat = await this.deps.chats.getById(link.chatId).catch(() => null);
      if (chat) v = { chatId: chat.id, sessionId: chat.sessionId };
    }
    // A run still being invoked is linked right after; do not cache "no" for it yet.
    if (v || !(await this.deps.runs.getById(runId).catch(() => null))?.trigger?.['chatId']) this.remember(runId, v);
    return v;
  }

  // ── events ───────────────────────────────────────────────────

  private async onEvent(event: PersistedEvent): Promise<void> {
    const kind = event.kind;
    if (!kind.startsWith('workflow_run.') && !kind.startsWith('stage_run.')) return;
    const runId = (event.data as { workflowRunId?: unknown } | undefined)?.workflowRunId;
    if (typeof runId !== 'string') return;
    const chat = await this.linkedChat(runId);
    if (!chat) return;

    if (kind === 'workflow_run.finalized') {
      this.clearThrottle(runId);
      await this.progress(runId, chat);
      await this.finalized(runId, chat);
      return;
    }
    if (kind === 'stage_run.awaiting_input' || kind === 'stage_run.waiting') {
      await this.progress(runId, chat);
      await this.awaiting(runId, chat, String((event.data as { stageRunId?: unknown }).stageRunId ?? ''));
      return;
    }
    if (STAGE_TRANSITIONS.has(kind)) {
      this.clearThrottle(runId);
      await this.progress(runId, chat);
      return;
    }
    if (RUN_STATUS.has(kind)) this.throttledProgress(runId, chat);
  }

  private clearThrottle(runId: string): void {
    const t = this.pendingProgress.get(runId);
    if (t) clearTimeout(t);
    this.pendingProgress.delete(runId);
  }

  /** At most one progress event per `throttleMs` per run; the last one always goes out. */
  private throttledProgress(runId: string, chat: Linked): void {
    const since = Date.now() - (this.lastProgress.get(runId) ?? 0);
    if (since >= this.throttleMs) {
      void this.progress(runId, chat).catch(() => undefined);
      return;
    }
    if (this.pendingProgress.has(runId)) return;
    const t = setTimeout(() => {
      this.pendingProgress.delete(runId);
      void this.progress(runId, chat).catch(() => undefined);
    }, this.throttleMs - since);
    t.unref?.();
    this.pendingProgress.set(runId, t);
  }

  private async progress(runId: string, chat: Linked): Promise<void> {
    this.lastProgress.set(runId, Date.now());
    const run = await this.deps.runs.getById(runId);
    const stages = await this.deps.stageRuns.getByRunId(runId);
    const summary = stageSummary(stages);
    await this.deps.eventBus.emit(chat.sessionId, {
      kind: 'chat.workflow_run.progress',
      data: { chatId: chat.chatId, runId, status: run.status, ...(summary.current ? { currentStage: summary.current } : {}), stagesDone: summary.done, stagesTotal: summary.total },
    });
  }

  private async awaiting(runId: string, chat: Linked, stageRunId: string): Promise<void> {
    const run = await this.deps.runs.getById(runId);
    const pending = await this.deps.approvals.listPending(runId);
    const d = pending.find((p) => p.instanceId === stageRunId) ?? pending[0];
    if (!d) return;
    const key = `${runId}:${d.instanceId}:${d.version}`;
    if (this.announced.has(key)) return;
    this.announced.add(key);
    const answerableByAgent = run.systemVars?.approvalDelegate === 'invoker' && d.runId === runId && d.kind === 'stage_completion_review';
    const link = this.link_(run);
    await this.deps.eventBus.emit(chat.sessionId, {
      kind: 'chat.workflow_run.awaiting_approval',
      data: { chatId: chat.chatId, runId, instanceId: d.instanceId, stageKey: d.stageKey, stageName: d.name, decision: d.kind, answerableByAgent, link },
    });
    await this.nudge(
      chat.chatId,
      answerableByAgent
        ? `[system] Workflow run "${run.name}" (${runId}) is waiting for a completion review of stage "${d.name}" that you may answer: call check_workflow_run, then respond_workflow_approval.`
        : `[system] Workflow run "${run.name}" (${runId}) is waiting for a person to answer a ${d.kind.replace(/_/g, ' ')} on stage "${d.name}". Tell the user; they answer it on the run page: ${link}`,
    );
  }

  private async finalized(runId: string, chat: Linked): Promise<void> {
    const run = await this.deps.runs.getById(runId);
    if (!TERMINAL.has(run.status)) return;
    const stages = await this.deps.stageRuns.getByRunId(runId);
    const last = [...stages].filter((s) => s.summary).sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0)).at(-1);
    const prUrl = (run.systemVars?.postProcessing ?? [])
      .map((p) => /https?:\/\/\S+\/pull\/\d+/.exec(p.output ?? '')?.[0])
      .find((u): u is string => !!u);
    const link = this.link_(run);
    await this.deps.eventBus.emit(chat.sessionId, {
      kind: 'chat.workflow_run.finalized',
      data: {
        chatId: chat.chatId,
        runId,
        status: run.status as 'completed' | 'failed' | 'cancelled',
        ...(last?.summary ? { summary: last.summary.slice(0, 600) } : run.error ? { summary: run.error.slice(0, 600) } : {}),
        ...(prUrl ? { prUrl } : {}),
        link,
      },
    });
    this.lastProgress.delete(runId);
    await this.nudge(chat.chatId, `[system] Workflow run "${run.name}" (${runId}) finished: ${run.status}. Call check_workflow_run for the details.`);
  }

  /** One `[system]` message to an idle chat (never while a turn streams). */
  private async nudge(chatId: string, text: string): Promise<void> {
    const port = this.deps.nudge;
    if (!port || port.isTurnActive(chatId)) return;
    const chat = await this.deps.chats.getById(chatId).catch(() => null);
    if (!chat || chat.status === 'archived') return;
    await port.sendPrompt(chatId, text).catch((err: unknown) => this.deps.logger?.warn?.(`[ChatWorkflowRunBridge] nudge of ${chatId} failed: ${String(err)}`));
  }

  // ── cards ────────────────────────────────────────────────────

  /** The chat's run cards (a reload, a restart, another device). */
  async cards(chatId: string): Promise<ChatWorkflowRunCard[]> {
    const out: ChatWorkflowRunCard[] = [];
    for (const l of await this.deps.links.listByChat(chatId)) {
      const run = await this.deps.runs.getById(l.runId).catch(() => null);
      if (!run) continue;
      const stages = await this.deps.stageRuns.getByRunId(run.id);
      const summary = stageSummary(stages);
      const pending = TERMINAL.has(run.status) ? [] : await this.deps.approvals.listPending(run.id).catch(() => []);
      const delegated = run.systemVars?.approvalDelegate === 'invoker';
      out.push({
        runId: run.id,
        workflowId: run.workflowDefinitionId,
        workflowName: run.name,
        toolCallId: l.toolCallId,
        status: run.status,
        ...(summary.current ? { currentStage: summary.current } : {}),
        stagesDone: summary.done,
        stagesTotal: summary.total,
        pendingApprovals: pending.map((d) => ({
          instanceId: d.instanceId,
          stageKey: d.stageKey,
          stageName: d.name,
          decision: d.kind,
          answerableByAgent: delegated && d.runId === run.id && d.kind === 'stage_completion_review',
        })),
        link: this.link_(run),
        createdAt: l.createdAt.toISOString(),
      });
    }
    return out;
  }
}

/** n of m top-level stages done, and the one running (or last changed). */
function stageSummary(stages: StageRun[]): { done: number; total: number; current?: string } {
  const top = stages.filter((s) => !s.instancePath.includes('/') && !s.instancePath.includes('#'));
  const running = top.find((s) => s.status === 'running' || s.status === 'awaiting_input' || s.status === 'waiting');
  const latest = [...top].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))[0];
  const current = running?.name ?? latest?.name;
  return { done: top.filter((s) => STAGE_DONE.has(s.status)).length, total: top.length, ...(current ? { current } : {}) };
}
