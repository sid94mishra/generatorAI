// ────────────────────────────────────────────────────────────────
// IPlanRepository / IAgentInteractionRepository — persistence ports (PLN-01)
// ────────────────────────────────────────────────────────────────

import type {
  AgentInteraction,
  AgentInteractionKind,
  AgentInteractionStatus,
  PlanAction,
  PlanComment,
  PlanCommentAnchor,
  PlanDecision,
  PlanDocument,
  PlanRevision,
  PlanStatus,
} from '@generatorai/shared';

export interface CreatePlanParams {
  id: string;
  chatId: string;
  sessionId: string;
  turnId: string;
  title: string;
  fileName: string;
  harnessType: string;
  availableActions: PlanAction[];
  recommendedAction?: PlanAction;
  content: string;
  summary: string;
  /** Defaults to `awaiting_review`. `recorded` for non-blocking captures. */
  status?: PlanStatus;
  /** Set when the plan belongs to a workflow stage rather than a chat turn. */
  stageRunId?: string;
  workflowRunId?: string;
}

export interface AddPlanRevisionParams {
  planId: string;
  content: string;
  summary: string;
  authoredBy: 'agent' | 'user';
  /**
   * Optimistic concurrency. When supplied, the write only lands if the plan is
   * still at this revision — otherwise two browser tabs silently clobber each
   * other's edits.
   */
  expectedRevision?: number;
}

export interface IPlanRepository {
  create(params: CreatePlanParams): Promise<PlanDocument>;
  findById(planId: string): Promise<PlanDocument | null>;
  listByChat(chatId: string): Promise<PlanDocument[]>;
  /**
   * Appends a revision and bumps `current_revision`.
   * Returns `null` when `expectedRevision` no longer matches (409 upstream).
   */
  addRevision(params: AddPlanRevisionParams): Promise<PlanRevision | null>;
  getRevision(planId: string, revision: number): Promise<PlanRevision | null>;
  updateStatus(planId: string, status: PlanStatus): Promise<void>;
  setDecision(planId: string, status: PlanStatus, decision: PlanDecision): Promise<void>;
  setFilePath(planId: string, filePath: string): Promise<void>;
  /** Marks every other non-terminal plan in the chat as superseded. */
  supersedeOthers(chatId: string, keepPlanId: string): Promise<void>;
  addComment(params: {
    id: string;
    planId: string;
    revision: number;
    body: string;
    anchor?: PlanCommentAnchor;
  }): Promise<PlanComment>;
  listComments(planId: string): Promise<PlanComment[]>;
  resolveComment(commentId: string, resolved: boolean): Promise<void>;
  deleteByChat(chatId: string): Promise<void>;
}

export interface CreateInteractionParams {
  id: string;
  scopeKind: 'chat' | 'stage_run';
  scopeId: string;
  chatId?: string;
  sessionId?: string;
  turnId?: string;
  kind: AgentInteractionKind;
  payload: unknown;
  expiresAt?: Date;
}

export interface IAgentInteractionRepository {
  create(params: CreateInteractionParams): Promise<AgentInteraction>;
  findById(id: string): Promise<AgentInteraction | null>;
  listPendingByChat(chatId: string): Promise<AgentInteraction[]>;
  listPendingByScope(scopeKind: 'chat' | 'stage_run', scopeId: string): Promise<AgentInteraction[]>;
  /**
   * Conditional transition `pending → <status>`.
   *
   * Returns `false` when the row was already resolved, which is what makes
   * "only one approver wins" enforceable and lets the API answer 409.
   */
  resolve(id: string, status: AgentInteractionStatus, resolution: unknown): Promise<boolean>;
  /** Bulk-cancels every pending gate for a turn (chat cancel path). */
  cancelForTurn(chatId: string, turnId: string, reason: string): Promise<string[]>;
  /** Bulk-cancels every pending gate for a chat. */
  cancelForChat(chatId: string, reason: string): Promise<string[]>;
  /** Expires pending chat gates older than `olderThan`. Returns their ids. */
  expireStale(olderThan: Date): Promise<string[]>;
  /** Expires every pending CHAT gate — used on boot (callbacks cannot survive). */
  expireAllPendingChatGates(reason: string): Promise<string[]>;
}
