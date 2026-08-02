// ────────────────────────────────────────────────────────────────
// Review API types + hooks (web mirror of @generatorai/review)
// ────────────────────────────────────────────────────────────────

export type ReviewScope = 'chat' | 'run' | 'automation';
export type ReviewSide = 'additions' | 'deletions';
export type ReviewIntent = 'fix' | 'question' | 'note' | 'refactor' | 'test';
export type ReviewAuthor = 'user' | 'agent';
export type ReviewThreadStatus =
  | 'draft'
  | 'pending'
  | 'submitted'
  | 'addressed'
  | 'resolved'
  | 'outdated';

export interface ReviewComment {
  id: string;
  threadId: string;
  author: ReviewAuthor;
  body: string;
  intent?: ReviewIntent;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewThread {
  id: string;
  workspaceId: string;
  scope: ReviewScope;
  scopeId: string;
  repoAlias: string;
  path: string;
  baseCheckpointId: string;
  headCheckpointId: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  anchorText: string;
  anchorHash: string;
  status: ReviewThreadStatus;
  resolvedByCheckpointId?: string;
  submittedMessageId?: string;
  reviewRound: number;
  createdAt: string;
  updatedAt: string;
  comments: ReviewComment[];
}

export interface CreateReviewThreadInput {
  scope: ReviewScope;
  scopeId: string;
  alias?: string;
  path: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  anchorText: string;
  body: string;
  intent?: ReviewIntent;
  baseCheckpointId?: string;
  headCheckpointId?: string;
}

export type ReviewSubmitTarget =
  | { kind: 'chat'; chatId: string }
  | { kind: 'stage_followup'; runId: string; stageId: string }
  | { kind: 'clipboard' };

export interface ReviewSubmitResult {
  prompt: string;
  threadIds: string[];
  reviewRound: number;
  delivered: boolean;
  messageId?: string;
}
