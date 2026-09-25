// ────────────────────────────────────────────────────────────────
// GatePort, TurnContextRegistry and the agent tool-policy wrapper (WP-2.6).
//
// A session's human gates (tool permission, clarifying question, plan
// review, plan filing) are owner-specific: a chat opens durable-but-expiring
// interactions, a stage parks on the durable HITL wait. The provider callbacks
// are the same for both owners and are installed once per conversation; they
// look up the turn IN FLIGHT in the registry, keyed by conversation id, so a
// gate is always filed against the owner of the current turn (the chat
// pattern — a per-closure stage id misfiled gates on shared conversations).
// ────────────────────────────────────────────────────────────────

import type { AgentQuestionResponse, AgentToolPolicy } from '@generatorai/shared';
import type {
  PermissionRequest,
  PermissionResponse,
  PlanReviewDecision,
  PlanReviewRequest,
  QuestionRequest,
} from '../../domain/ports/IAgentHarness.js';
import type { RecordPlanArgs, RecordPlanResult } from '../../tools/recordPlanTool.js';
import type { TurnContext } from './types.js';

/** The owner-specific human gates of a session. */
export interface GatePort {
  permission(req: PermissionRequest, turn: TurnContext): Promise<PermissionResponse>;
  question?(req: QuestionRequest, turn: TurnContext): Promise<AgentQuestionResponse>;
  planReview?(req: PlanReviewRequest, turn: TurnContext): Promise<PlanReviewDecision>;
  recordPlan?(args: RecordPlanArgs, turn: TurnContext): Promise<RecordPlanResult | null>;
}

/** The turn in flight on each conversation. */
export class TurnContextRegistry {
  private readonly byConversation = new Map<string, TurnContext>();

  set(conversationId: string, ctx: TurnContext): void {
    this.byConversation.set(conversationId, ctx);
  }

  get(conversationId: string): TurnContext | undefined {
    return this.byConversation.get(conversationId);
  }

  delete(conversationId: string): void {
    this.byConversation.delete(conversationId);
  }

  /** Hand out the next ordinal of the turn in flight (tool calls, segments, cards share it). */
  takeSequence(conversationId: string): number | undefined {
    const ctx = this.byConversation.get(conversationId);
    if (!ctx) return undefined;
    const seq = ctx.nextSequence;
    ctx.nextSequence += 1;
    return seq;
  }
}

/** Record where a plan/question card falls in the turn's ordered items. */
export function stampCardSequence(ctx: TurnContext, cardId: string): void {
  if (ctx.cardSequence.has(cardId)) return;
  ctx.cardSequence.set(cardId, ctx.nextSequence);
  ctx.nextSequence += 1;
}

/** What a request asks for, when the bound agent's tool groups refuse it. */
function deniedByAgent(request: PermissionRequest, groups: AgentToolPolicy): string | null {
  if (request.type === 'file_write' && !groups.fileWrite) return 'write files';
  if (request.type === 'file_read' && !groups.fileRead) return 'read files';
  if (request.type === 'shell_exec' && !groups.shell) return 'run shell commands';
  if (request.type === 'network' && !groups.web) return 'access the network';
  return null;
}

/**
 * The bound agent's tool groups, enforced where every gated tool call
 * passes (W-53). Telling the provider about the deny list is advisory — a
 * live run showed Copilot calling `create` and `powershell` with both
 * exclusion lists set — so the permission gate refuses first, for chats as
 * well as stages, and no permission mode can override it.
 */
export function withAgentToolPolicy(gate: GatePort, groups: AgentToolPolicy): GatePort {
  return {
    permission: async (req, turn) => {
      const denied = deniedByAgent(req, groups);
      if (denied) return { granted: false, reason: `The bound agent is not allowed to ${denied}.` };
      return gate.permission(req, turn);
    },
    ...(gate.question ? { question: gate.question.bind(gate) } : {}),
    ...(gate.planReview ? { planReview: gate.planReview.bind(gate) } : {}),
    ...(gate.recordPlan ? { recordPlan: gate.recordPlan.bind(gate) } : {}),
  };
}
