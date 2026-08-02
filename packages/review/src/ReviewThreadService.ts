// ────────────────────────────────────────────────────────────────
// ReviewThreadService — lifecycle of inline review comments
// ────────────────────────────────────────────────────────────────
//
// Owns the state machine:
//
//   draft/pending ──submit──▶ submitted ──agent edits the anchor──▶ addressed
//        │                        │                                     │
//        └────────── delete ──────┴──────── user resolves ──────────▶ resolved
//                                 │
//                       anchor content gone ──────────────────────▶ outdated
//
// Re-anchoring runs whenever the workspace changes, so numbers stay correct
// without the user ever seeing a comment drift onto unrelated code.

import { randomUUID } from 'node:crypto';
import type { ILogger } from '@generatorai/shared';
import type { IReviewRepository } from './ports/IReviewRepository.js';
import {
  hashAnchor,
  resolveAnchor,
} from './AnchorResolver.js';
import { serializeReviewThreads } from './ReviewPromptSerializer.js';
import type {
  CreateReviewThreadParams,
  ListReviewThreadsFilters,
  ReviewComment,
  ReviewThread,
  SubmitReviewParams,
  SubmitReviewResult,
} from './types.js';

/** Reads file content at a revision — supplied by the host application. */
export interface ReviewContentReader {
  /** Current content of a file, or null when it no longer exists. */
  readCurrent(
    workspaceId: string,
    repoAlias: string,
    path: string,
  ): Promise<string | null>;
  /** Unified patch between the thread's head checkpoint and now. */
  readPatchSince(
    workspaceId: string,
    repoAlias: string,
    path: string,
    fromCheckpointId: string,
  ): Promise<string | null>;
}

export class ReviewThreadService {
  constructor(
    private readonly repository: IReviewRepository,
    private readonly content: ReviewContentReader,
    private readonly logger: ILogger,
  ) {}

  // ── Threads ─────────────────────────────────────────────────

  async createThread(params: CreateReviewThreadParams): Promise<ReviewThread> {
    const now = new Date();
    const threadId = `rt_${randomUUID()}`;
    const comment: ReviewComment = {
      id: `rc_${randomUUID()}`,
      threadId,
      author: params.author ?? 'user',
      body: params.body,
      ...(params.intent ? { intent: params.intent } : {}),
      createdAt: now,
      updatedAt: now,
    };

    const thread: ReviewThread = {
      id: threadId,
      workspaceId: params.workspaceId,
      scope: params.scope,
      scopeId: params.scopeId,
      repoAlias: params.repoAlias ?? '.',
      path: params.path,
      baseCheckpointId: params.baseCheckpointId,
      headCheckpointId: params.headCheckpointId,
      side: params.side,
      startLine: params.startLine,
      endLine: params.endLine,
      anchorText: params.anchorText,
      anchorHash: hashAnchor(params.anchorText),
      // New threads start `pending`: they are part of the current batch but
      // have not been sent. This is what lets the user write several comments
      // and submit them together.
      status: 'pending',
      reviewRound: 0,
      createdAt: now,
      updatedAt: now,
      comments: [comment],
    };

    await this.repository.createThread(thread);
    return thread;
  }

  async listThreads(filters: ListReviewThreadsFilters): Promise<ReviewThread[]> {
    return this.repository.listThreads(filters);
  }

  async getThread(id: string): Promise<ReviewThread | null> {
    return this.repository.findThreadById(id);
  }

  async addComment(
    threadId: string,
    body: string,
    intent?: ReviewComment['intent'],
    author: ReviewComment['author'] = 'user',
  ): Promise<ReviewComment> {
    const now = new Date();
    const comment: ReviewComment = {
      id: `rc_${randomUUID()}`,
      threadId,
      author,
      body,
      ...(intent ? { intent } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.addComment(comment);
    // Replying re-opens a resolved/addressed thread — the user is asking for
    // more work on it.
    const thread = await this.repository.findThreadById(threadId);
    if (thread && (thread.status === 'resolved' || thread.status === 'addressed')) {
      await this.repository.updateThread(threadId, { status: 'pending' });
    }
    return comment;
  }

  async setStatus(threadId: string, status: ReviewThread['status']): Promise<void> {
    await this.repository.updateThread(threadId, { status });
  }

  /**
   * Rewrite a comment's body.
   *
   * Only ever the user's own wording: an agent comment is a record of what
   * was actually said, so rewriting it would make the transcript lie. The
   * caller (the route) enforces that.
   */
  async updateComment(commentId: string, body: string): Promise<void> {
    await this.repository.updateComment(commentId, body);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.repository.deleteThread(threadId);
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.repository.deleteComment(commentId);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.repository.deleteByWorkspace(workspaceId);
  }

  // ── Submission ──────────────────────────────────────────────

  /**
   * Serialise a batch of threads into an agent instruction and mark them
   * submitted. Delivery itself is the caller's job (chat prompt vs. stage
   * follow-up), so this stays transport-agnostic.
   */
  async buildSubmission(params: SubmitReviewParams): Promise<SubmitReviewResult> {
    const threads: ReviewThread[] = [];
    for (const id of params.threadIds) {
      const thread = await this.repository.findThreadById(id);
      if (thread) threads.push(thread);
    }
    if (threads.length === 0) {
      return { prompt: '', threadIds: [], reviewRound: 0, delivered: false };
    }

    const round = Math.max(...threads.map((t) => t.reviewRound)) + 1;
    const prompt = serializeReviewThreads(threads, {
      ...(params.note ? { note: params.note } : {}),
      round,
      workspaceId: params.workspaceId,
    });

    return {
      prompt,
      threadIds: threads.map((t) => t.id),
      reviewRound: round,
      delivered: false,
    };
  }

  /**
   * Record that a batch was delivered to the agent.
   *
   * `headCheckpointId` MUST be the checkpoint representing the workspace at
   * submission time. Every later "was this addressed?" question is answered
   * by diffing from it, so passing the thread's original head (or nothing)
   * would compare against the start of the session and mark every thread
   * addressed immediately.
   */
  async markSubmitted(
    threadIds: string[],
    round: number,
    messageId?: string,
    headCheckpointId?: string,
  ): Promise<void> {
    await this.repository.markSubmitted(threadIds, messageId, round, headCheckpointId);
  }

  // ── Re-anchoring ────────────────────────────────────────────

  /**
   * Recompute anchors for every open thread in the given files after the
   * workspace changed. Called from the `workspace.changed` handler.
   *
   * Also flips submitted threads to `addressed` when the agent's edit
   * overlapped their anchor — that is the signal that closes the
   * comment → fix → verify loop.
   */
  async reanchorFiles(
    workspaceId: string,
    files: Array<{ repoAlias: string; path: string }>,
    checkpointId?: string,
  ): Promise<{ updated: number; outdated: number; addressed: number }> {
    let updated = 0;
    let outdated = 0;
    let addressed = 0;

    for (const file of files) {
      let threads: ReviewThread[];
      try {
        threads = await this.repository.findThreadsForFile(
          workspaceId,
          file.repoAlias,
          file.path,
        );
      } catch (err) {
        this.logger.warn(`[Review] Failed to load threads for ${file.path}: ${err}`);
        continue;
      }

      const open = threads.filter(
        (t) => t.status !== 'resolved' && t.status !== 'outdated',
      );
      if (open.length === 0) continue;

      const current = await this.content.readCurrent(
        workspaceId,
        file.repoAlias,
        file.path,
      );

      for (const thread of open) {
        // "What changed since this thread last synced." For a submitted
        // thread that is exactly the agent's response to the review, because
        // `markSubmitted` re-anchored it to the submission-time checkpoint.
        const patch = thread.headCheckpointId
          ? await this.content
              .readPatchSince(
                workspaceId,
                file.repoAlias,
                file.path,
                thread.headCheckpointId,
              )
              .catch(() => null)
          : null;

        const outcome = resolveAnchor(
          {
            startLine: thread.startLine,
            endLine: thread.endLine,
            anchorHash: thread.anchorHash,
          },
          current,
          patch ?? undefined,
        );

        if (outcome.kind === 'outdated') {
          // The anchored text is gone. For a SUBMITTED thread that is the
          // strongest possible "addressed" signal — the agent rewrote exactly
          // what we complained about. Requires a patch, so we know the change
          // happened after submission rather than before it.
          if (thread.status === 'submitted' && patch) {
            await this.repository.updateThread(thread.id, {
              status: 'addressed',
              ...(checkpointId ? { resolvedByCheckpointId: checkpointId } : {}),
            });
            addressed++;
          } else {
            await this.repository.updateThread(thread.id, { status: 'outdated' });
            outdated++;
          }
          continue;
        }

        const moved =
          outcome.startLine !== thread.startLine || outcome.endLine !== thread.endLine;

        // A submitted thread is addressed once the agent has edited the file
        // it is anchored in, at any line.
        //
        // Overlap with the anchored range specifically is deliberately NOT
        // the test. A comment on a function signature is normally answered by
        // changing the function BODY, so requiring the anchored line itself
        // to change leaves such threads stuck on "awaiting agent" forever
        // even though the feedback was acted on. The patch is measured from
        // the submission-time checkpoint, so any change in it is by
        // construction part of the agent's response to this review round.
        const touched = thread.status === 'submitted' && !!patch;

        if (moved || touched) {
          await this.repository.updateThread(thread.id, {
            ...(moved ? { startLine: outcome.startLine, endLine: outcome.endLine } : {}),
            ...(touched
              ? {
                  status: 'addressed' as const,
                  ...(checkpointId ? { resolvedByCheckpointId: checkpointId } : {}),
                }
              : {}),
          });
          if (touched) addressed++;
          else updated++;
        }
      }
    }

    return { updated, outdated, addressed };
  }
}
