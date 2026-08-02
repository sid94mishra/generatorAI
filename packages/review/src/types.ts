// ────────────────────────────────────────────────────────────────
// Review types — inline comments anchored to diff lines
// ────────────────────────────────────────────────────────────────
//
// Modelled on GitHub's PR-review grammar, which is the interaction users
// already know:
//
//   select lines → comment → (draft) → submit a batch → threads render
//   inline → agent addresses them → threads mark themselves addressed →
//   resolve.
//
// The critical difference from GitHub: the "reviewer" audience is an agent,
// so a thread is a typed instruction, not just prose.

export type ReviewScope = 'chat' | 'run' | 'automation';

/** Which side of the diff the comment is anchored to. */
export type ReviewSide = 'additions' | 'deletions';

/**
 * draft      — being composed, not yet part of a batch
 * pending    — queued in the current review batch, not sent
 * submitted  — sent to the agent, awaiting a response
 * addressed  — the anchored lines changed after submission
 * resolved   — explicitly closed by the user
 * outdated   — the anchor could no longer be located after a change
 */
export type ReviewThreadStatus =
  | 'draft'
  | 'pending'
  | 'submitted'
  | 'addressed'
  | 'resolved'
  | 'outdated';

/** What the comment is asking the agent to do. Drives the prompt wording. */
export type ReviewIntent = 'fix' | 'question' | 'note' | 'refactor' | 'test';

export type ReviewAuthor = 'user' | 'agent';

export interface ReviewComment {
  id: string;
  threadId: string;
  author: ReviewAuthor;
  body: string;
  intent?: ReviewIntent;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewThread {
  id: string;
  workspaceId: string;
  scope: ReviewScope;
  scopeId: string;
  repoAlias: string;
  path: string;
  /** Diff LHS the comment was written against. */
  baseCheckpointId: string;
  /** Diff RHS the comment was written against. */
  headCheckpointId: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  /** The exact source lines selected — the key to re-anchoring. */
  anchorText: string;
  /** sha256(anchorText), so re-anchoring is an equality check. */
  anchorHash: string;
  status: ReviewThreadStatus;
  resolvedByCheckpointId?: string;
  submittedMessageId?: string;
  reviewRound: number;
  createdAt: Date;
  updatedAt: Date;
  comments: ReviewComment[];
}

export interface CreateReviewThreadParams {
  workspaceId: string;
  scope: ReviewScope;
  scopeId: string;
  repoAlias?: string;
  path: string;
  baseCheckpointId: string;
  headCheckpointId: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  anchorText: string;
  body: string;
  intent?: ReviewIntent;
  author?: ReviewAuthor;
}

export interface ListReviewThreadsFilters {
  workspaceId: string;
  scope?: ReviewScope;
  scopeId?: string;
  path?: string;
  repoAlias?: string;
  statuses?: ReviewThreadStatus[];
  /** Exclude resolved + outdated (default true). */
  openOnly?: boolean;
}

/** Where a submitted review batch should be delivered. */
export type ReviewSubmitTarget =
  | { kind: 'chat'; chatId: string }
  | { kind: 'stage_followup'; runId: string; stageId: string }
  | { kind: 'clipboard' };

export interface SubmitReviewParams {
  workspaceId: string;
  threadIds: string[];
  target: ReviewSubmitTarget;
  /** Extra free-text instruction appended after the structured feedback. */
  note?: string;
}

export interface SubmitReviewResult {
  prompt: string;
  threadIds: string[];
  reviewRound: number;
  delivered: boolean;
  messageId?: string;
}
