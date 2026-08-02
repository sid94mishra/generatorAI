// ────────────────────────────────────────────────────────────────
// IReviewRepository — persistence port for review threads/comments
// ────────────────────────────────────────────────────────────────

import type {
  ListReviewThreadsFilters,
  ReviewComment,
  ReviewThread,
  ReviewThreadStatus,
} from '../types.js';

export interface IReviewRepository {
  createThread(thread: ReviewThread): Promise<void>;
  findThreadById(id: string): Promise<ReviewThread | null>;
  listThreads(filters: ListReviewThreadsFilters): Promise<ReviewThread[]>;
  /** Threads anchored in a specific file — the re-anchoring hot path. */
  findThreadsForFile(
    workspaceId: string,
    repoAlias: string,
    path: string,
  ): Promise<ReviewThread[]>;
  updateThread(
    id: string,
    patch: Partial<
      Pick<
        ReviewThread,
        | 'status'
        | 'startLine'
        | 'endLine'
        | 'headCheckpointId'
        | 'resolvedByCheckpointId'
        | 'submittedMessageId'
        | 'reviewRound'
        | 'path'
      >
    >,
  ): Promise<void>;
  deleteThread(id: string): Promise<void>;
  deleteByWorkspace(workspaceId: string): Promise<void>;

  addComment(comment: ReviewComment): Promise<void>;
  updateComment(id: string, body: string): Promise<void>;
  deleteComment(id: string): Promise<void>;

  /** Bulk status change used when a batch is submitted. */
  markSubmitted(
    threadIds: string[],
    messageId: string | undefined,
    round: number,
    /**
     * Checkpoint that represents "the state when this batch was sent".
     * Everything the agent does afterwards is measured against it, which is
     * how a thread knows whether it was actually addressed.
     */
    headCheckpointId?: string,
  ): Promise<void>;
  countByStatus(workspaceId: string): Promise<Record<ReviewThreadStatus, number>>;
}
