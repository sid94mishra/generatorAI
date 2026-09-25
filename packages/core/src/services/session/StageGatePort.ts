// ────────────────────────────────────────────────────────────────
// StageGatePort — a stage's human gates, on the durable HITL wait (WP-2.6).
//
// Unlike a chat's interactions (which expire on restart because the SDK
// callback cannot survive one), a stage parks on `HitlService.interrupt`:
// the row goes `awaiting_input`, a verdict given after a restart is held for
// the relaunched stage, and the stage-semaphore permit is released while a
// human thinks. Each gate also announces itself with the chat's event shapes
// under `stage.*` (with `stageRunId`), so the stream renders the same cards.
// ────────────────────────────────────────────────────────────────

import { generateId } from '@generatorai/shared';
import type { AgentEvent, AgentQuestionResponse, PlanAction, PlanDecision } from '@generatorai/shared';
import type {
  PermissionRequest,
  PermissionResponse,
  PlanReviewDecision,
  PlanReviewRequest,
  QuestionRequest,
} from '../../domain/ports/IAgentHarness.js';
import type { EventBus } from '../../events/EventBus.js';
import type { RecordPlanArgs, RecordPlanResult } from '../../tools/recordPlanTool.js';
import {
  buildToolPermissionPayload,
  decideToolPermission,
  resolveModeDescriptor,
  resolveTurnPermissionMode,
} from '../agentModePolicy.js';
import type { HitlService, InterruptResolution } from '../HitlService.js';
import type { PlanService } from '../PlanService.js';
import { stampCardSequence, type GatePort } from './gates.js';
import type { TurnContext } from './types.js';

export interface StageGatePortDeps {
  hitl: HitlService;
  eventBus: EventBus;
  planService?: PlanService | undefined;
  /** The run workspace's managed root: plans land in its `plans/` folder. */
  workspaceRoot?: string | undefined;
  /** The provider that runs a conversation, for plan records (never a guess). */
  harnessTypeOf: (conversationId: string | undefined) => string;
  /** The run's permission policy, re-read after an approved plan hands the turn back to auto. */
  readPermissionMode: () => Promise<string | undefined>;
}

function stageIds(turn: TurnContext): { stageRunId: string; workflowRunId: string } {
  if (turn.owner.kind !== 'stage') throw new Error('A stage gate was called for a chat turn');
  return { stageRunId: turn.owner.stageRunId, workflowRunId: turn.owner.workflowRunId };
}

/** A cancel, a superseding gate or the awakeable timeout — not a human verdict. */
function isExpiry(r: InterruptResolution): boolean {
  return r.outcome === 'rejected' && r.value === undefined && /cancel|supersed|timed out|timeout/i.test(r.reason ?? '');
}

export class StageGatePort implements GatePort {
  constructor(private readonly deps: StageGatePortDeps) {}

  private async emit(sessionId: string, kind: string, data: Record<string, unknown>): Promise<void> {
    await this.deps.eventBus.emit(sessionId, { kind, data } as unknown as AgentEvent);
  }

  /** Park on the HITL wait with the stage-semaphore permit released. */
  private async park(turn: TurnContext, data: Record<string, unknown>, prompt: string): Promise<InterruptResolution> {
    const { stageRunId, workflowRunId } = stageIds(turn);
    turn.semaphore?.pause();
    try {
      return await this.deps.hitl.interrupt(stageRunId, workflowRunId, data, { prompt });
    } finally {
      await turn.semaphore?.resume();
    }
  }

  async permission(req: PermissionRequest, turn: TurnContext): Promise<PermissionResponse> {
    const ids = stageIds(turn);
    const mode = turn.permissionMode;
    const verdict = decideToolPermission(mode, req.type);
    if (verdict === 'allow') return { granted: true };
    if (verdict === 'deny') return { granted: false, reason: `Blocked by the run's ${mode} permission mode.` };

    const payload = buildToolPermissionPayload(req, mode);
    const interactionId = generateId();
    turn.interactionIds.push(interactionId);
    stampCardSequence(turn, interactionId);
    await this.emit(turn.sessionId, 'stage.permission.requested', { ...ids, interactionId, turnId: turn.turnId, ...payload });
    const r = await this.park(
      turn,
      {
        kind: 'tool_permission',
        interactionId,
        request: { type: req.type, description: req.description, details: req.details ?? null },
        ...payload,
      },
      `Approve ${req.type}: ${req.description}`,
    );
    const granted = r.outcome === 'approved';
    if (isExpiry(r)) {
      await this.emit(turn.sessionId, 'stage.permission.expired', { ...ids, interactionId, reason: r.reason ?? 'expired' });
    } else {
      await this.emit(turn.sessionId, 'stage.permission.resolved', {
        ...ids,
        interactionId,
        behavior: granted ? 'allow' : 'deny',
        ...(r.reason ? { message: r.reason } : {}),
      });
    }
    return { granted, ...(r.reason ? { reason: r.reason } : {}) };
  }

  async question(req: QuestionRequest, turn: TurnContext): Promise<AgentQuestionResponse> {
    const ids = stageIds(turn);
    const interactionId = generateId();
    turn.interactionIds.push(interactionId);
    stampCardSequence(turn, interactionId);
    await this.emit(turn.sessionId, 'stage.question.asked', {
      ...ids,
      interactionId,
      turnId: turn.turnId,
      questions: req.questions,
    });
    const r = await this.park(
      turn,
      { kind: 'question', interactionId, questions: req.questions },
      'The agent has a question before it continues.',
    );
    if (r.outcome !== 'approved') {
      await this.emit(turn.sessionId, 'stage.question.expired', { ...ids, interactionId, reason: r.reason ?? r.outcome });
      return { answers: {}, freeformResponse: 'The user did not answer; use your best judgement.' };
    }
    const answer = answerOf(r.value);
    await this.emit(turn.sessionId, 'stage.question.answered', {
      ...ids,
      interactionId,
      answers: answer.answers ?? {},
      ...(answer.freeformResponse ? { freeformResponse: answer.freeformResponse } : {}),
    });
    return answer;
  }

  async planReview(req: PlanReviewRequest, turn: TurnContext): Promise<PlanReviewDecision> {
    const ids = stageIds(turn);
    const planService = this.deps.planService;
    let plan: { id: string; revision: number; title: string; fileName: string } | undefined;
    if (planService) {
      // A follow-up plan on the same turn is a REVISION of the same document.
      const lastId = turn.planIds[turn.planIds.length - 1];
      const existing = lastId ? await planService.findById(lastId) : null;
      if (existing && existing.status === 'changes_requested') {
        const added = await planService.addRevision({
          planId: existing.id,
          content: req.planContent,
          summary: req.summary,
          authoredBy: 'agent',
          ...(this.deps.workspaceRoot ? { workspaceRoot: this.deps.workspaceRoot } : {}),
        });
        await planService.setStatus(existing.id, 'awaiting_review');
        plan = { id: existing.id, revision: added?.revision ?? existing.currentRevision, title: existing.title, fileName: existing.fileName };
      } else {
        const created = await planService.createFromGate({
          chatId: ids.stageRunId,
          sessionId: turn.sessionId,
          turnId: turn.turnId,
          stageRunId: ids.stageRunId,
          workflowRunId: ids.workflowRunId,
          summary: req.summary,
          content: req.planContent,
          harnessType: this.deps.harnessTypeOf(undefined),
          availableActions: req.actions,
          ...(req.recommendedAction ? { recommendedAction: req.recommendedAction } : {}),
          ...(this.deps.workspaceRoot ? { workspaceRoot: this.deps.workspaceRoot } : {}),
        });
        plan = { id: created.id, revision: created.currentRevision, title: created.title, fileName: created.fileName };
        turn.planIds.push(created.id);
        stampCardSequence(turn, created.id);
        await this.emit(turn.sessionId, 'stage.plan.created', {
          ...ids,
          planId: created.id,
          revision: created.currentRevision,
          title: created.title,
          fileName: created.fileName,
          summary: req.summary,
          turnId: turn.turnId,
        });
      }
    }
    const interactionId = generateId();
    await this.emit(turn.sessionId, 'stage.plan.review_requested', {
      ...ids,
      interactionId,
      ...(plan ? { planId: plan.id, revision: plan.revision, title: plan.title, fileName: plan.fileName } : {}),
      summary: req.summary,
      actions: req.actions,
      ...(req.recommendedAction ? { recommendedAction: req.recommendedAction } : {}),
    });
    const r = await this.park(
      turn,
      {
        kind: 'plan_review',
        interactionId,
        ...(plan ? { planId: plan.id, revision: plan.revision, title: plan.title } : {}),
        summary: req.summary,
        actions: req.actions,
      },
      `Review the plan: ${req.summary.slice(0, 200)}`,
    );
    const value = (r.value && typeof r.value === 'object' ? r.value : {}) as { action?: PlanAction; feedback?: string };
    const feedback = value.feedback ?? r.reason;
    if (plan && planService) {
      const decision: PlanDecision = {
        approved: r.outcome === 'approved',
        ...(value.action ? { action: value.action } : {}),
        ...(feedback ? { feedback } : {}),
        decidedAt: new Date(),
      };
      const status = r.outcome === 'approved' ? 'approved' : r.outcome === 'changes_requested' ? 'changes_requested' : 'rejected';
      await planService.recordDecision(plan.id, status, decision).catch(() => undefined);
    }
    await this.emit(turn.sessionId, 'stage.plan.decided', {
      ...ids,
      interactionId,
      ...(plan ? { planId: plan.id } : {}),
      approved: r.outcome === 'approved',
      ...(value.action ? { action: value.action } : {}),
      ...(feedback ? { feedback } : {}),
    });
    if (r.outcome === 'approved') {
      return { approved: true, action: value.action ?? req.recommendedAction ?? 'implement_interactive' };
    }
    if (r.outcome === 'changes_requested') {
      return { approved: false, feedback: feedback ?? 'The reviewer requested changes to the plan.' };
    }
    return { approved: false, feedback: isExpiry(r) ? 'The plan review ended without a decision. Stop and wait.' : 'The reviewer declined the plan. Do not implement it.' };
  }

  /**
   * `record_plan` for a stage (T7): files the plan in autonomous turns; in
   * plan mode it is the review gate (providers with no native plan tool).
   */
  async recordPlan(args: RecordPlanArgs, turn: TurnContext): Promise<RecordPlanResult | null> {
    const descriptor = resolveModeDescriptor(turn.agentMode);
    if (descriptor.planGate === 'blocking') {
      const decision = await this.planReview(
        { summary: args.title, planContent: args.content, actions: ['implement_interactive', 'exit_only'], recommendedAction: 'implement_interactive' },
        turn,
      );
      const planId = turn.planIds[turn.planIds.length - 1] ?? '';
      const feedback = decision.feedback?.trim();
      if (!decision.approved) return { planId, fileName: '', review: { decision: 'changes_requested', ...(feedback ? { feedback } : {}) } };
      if (decision.action === 'exit_only') return { planId, fileName: '', review: { decision: 'dismissed' } };
      // Approved: the rest of this turn is implementation.
      turn.agentMode = 'auto';
      turn.permissionMode = resolveTurnPermissionMode('auto', (await this.deps.readPermissionMode()) as never);
      return { planId, fileName: '', review: { decision: 'approved' } };
    }
    if (descriptor.planGate !== 'non_blocking' || !this.deps.planService) return null;
    try {
      const ids = stageIds(turn);
      const plan = await this.deps.planService.createFromGate({
        chatId: ids.stageRunId,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        stageRunId: ids.stageRunId,
        workflowRunId: ids.workflowRunId,
        title: args.title,
        summary: args.title,
        content: args.content,
        harnessType: this.deps.harnessTypeOf(undefined),
        availableActions: [],
        status: 'recorded',
        ...(this.deps.workspaceRoot ? { workspaceRoot: this.deps.workspaceRoot } : {}),
      });
      turn.planIds.push(plan.id);
      stampCardSequence(turn, plan.id);
      await this.emit(turn.sessionId, 'stage.plan.created', {
        ...ids,
        planId: plan.id,
        revision: plan.currentRevision,
        title: plan.title,
        fileName: plan.fileName,
        summary: args.title,
        status: 'recorded',
        turnId: turn.turnId,
      });
      return { planId: plan.id, fileName: plan.fileName };
    } catch (err) {
      console.warn(`[StageGatePort] record_plan failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

/** A question gate's answer as the approve route delivers it (`value`). */
function answerOf(value: unknown): AgentQuestionResponse {
  if (typeof value === 'string') return { answers: {}, freeformResponse: value };
  if (value && typeof value === 'object') {
    const v = value as { answers?: unknown; freeformResponse?: unknown; followUpPrompt?: unknown };
    const answers = v.answers && typeof v.answers === 'object' ? (v.answers as Record<string, string[]>) : {};
    const free =
      typeof v.freeformResponse === 'string' ? v.freeformResponse : typeof v.followUpPrompt === 'string' ? v.followUpPrompt : undefined;
    return { answers, ...(free ? { freeformResponse: free } : {}) };
  }
  return { answers: {} };
}
