// ────────────────────────────────────────────────────────────────
// DrizzleReviewRepository — IReviewRepository impl
// ────────────────────────────────────────────────────────────────

import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { IReviewRepository } from '@generatorai/review';
import type {
  ListReviewThreadsFilters,
  ReviewComment,
  ReviewThread,
  ReviewThreadStatus,
} from '@generatorai/review';
import { StorageError } from '@generatorai/shared';
import { reviewComments, reviewThreads } from '../schema.js';
import type { AppDatabase } from '../index.js';

const CLOSED_STATUSES: ReviewThreadStatus[] = ['resolved', 'outdated'];

export class DrizzleReviewRepository implements IReviewRepository {
  constructor(private db: AppDatabase) {}

  async createThread(thread: ReviewThread): Promise<void> {
    try {
      await this.db.insert(reviewThreads).values({
        id: thread.id,
        workspaceId: thread.workspaceId,
        scope: thread.scope,
        scopeId: thread.scopeId,
        repoAlias: thread.repoAlias,
        path: thread.path,
        baseCheckpointId: thread.baseCheckpointId,
        headCheckpointId: thread.headCheckpointId,
        side: thread.side,
        startLine: thread.startLine,
        endLine: thread.endLine,
        anchorText: thread.anchorText,
        anchorHash: thread.anchorHash,
        status: thread.status,
        resolvedByCheckpointId: thread.resolvedByCheckpointId ?? null,
        submittedMessageId: thread.submittedMessageId ?? null,
        reviewRound: thread.reviewRound,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      });
      for (const comment of thread.comments) {
        await this.addComment(comment);
      }
    } catch (err) {
      throw new StorageError(
        `Failed to create review thread: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findThreadById(id: string): Promise<ReviewThread | null> {
    const rows = await this.db
      .select()
      .from(reviewThreads)
      .where(eq(reviewThreads.id, id))
      .limit(1);
    if (!rows[0]) return null;
    return this.hydrate([rows[0]]).then((t) => t[0] ?? null);
  }

  async listThreads(filters: ListReviewThreadsFilters): Promise<ReviewThread[]> {
    const conditions = [eq(reviewThreads.workspaceId, filters.workspaceId)];
    if (filters.scope) conditions.push(eq(reviewThreads.scope, filters.scope));
    if (filters.scopeId) conditions.push(eq(reviewThreads.scopeId, filters.scopeId));
    if (filters.path) conditions.push(eq(reviewThreads.path, filters.path));
    if (filters.repoAlias) conditions.push(eq(reviewThreads.repoAlias, filters.repoAlias));
    if (filters.statuses?.length) {
      conditions.push(inArray(reviewThreads.status, filters.statuses));
    } else if (filters.openOnly !== false) {
      conditions.push(notInArray(reviewThreads.status, CLOSED_STATUSES));
    }

    const rows = await this.db
      .select()
      .from(reviewThreads)
      .where(and(...conditions))
      .orderBy(asc(reviewThreads.path), asc(reviewThreads.startLine));

    return this.hydrate(rows);
  }

  async findThreadsForFile(
    workspaceId: string,
    repoAlias: string,
    path: string,
  ): Promise<ReviewThread[]> {
    const rows = await this.db
      .select()
      .from(reviewThreads)
      .where(
        and(
          eq(reviewThreads.workspaceId, workspaceId),
          eq(reviewThreads.repoAlias, repoAlias),
          eq(reviewThreads.path, path),
        ),
      )
      .orderBy(asc(reviewThreads.startLine));
    return this.hydrate(rows);
  }

  async updateThread(
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
  ): Promise<void> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) values['status'] = patch.status;
    if (patch.startLine !== undefined) values['startLine'] = patch.startLine;
    if (patch.endLine !== undefined) values['endLine'] = patch.endLine;
    if (patch.headCheckpointId !== undefined) {
      values['headCheckpointId'] = patch.headCheckpointId;
    }
    if (patch.resolvedByCheckpointId !== undefined) {
      values['resolvedByCheckpointId'] = patch.resolvedByCheckpointId;
    }
    if (patch.submittedMessageId !== undefined) {
      values['submittedMessageId'] = patch.submittedMessageId;
    }
    if (patch.reviewRound !== undefined) values['reviewRound'] = patch.reviewRound;
    if (patch.path !== undefined) values['path'] = patch.path;

    await this.db.update(reviewThreads).set(values).where(eq(reviewThreads.id, id));
  }

  async deleteThread(id: string): Promise<void> {
    // Comments cascade via the FK.
    await this.db.delete(reviewThreads).where(eq(reviewThreads.id, id));
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    const rows = await this.db
      .select({ id: reviewThreads.id })
      .from(reviewThreads)
      .where(eq(reviewThreads.workspaceId, workspaceId));
    if (rows.length > 0) {
      await this.db.delete(reviewComments).where(
        inArray(
          reviewComments.threadId,
          rows.map((r) => r.id),
        ),
      );
    }
    await this.db.delete(reviewThreads).where(eq(reviewThreads.workspaceId, workspaceId));
  }

  async addComment(comment: ReviewComment): Promise<void> {
    await this.db.insert(reviewComments).values({
      id: comment.id,
      threadId: comment.threadId,
      author: comment.author,
      body: comment.body,
      intent: comment.intent ?? null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    });
  }

  async updateComment(id: string, body: string): Promise<void> {
    await this.db
      .update(reviewComments)
      .set({ body, updatedAt: new Date() })
      .where(eq(reviewComments.id, id));
  }

  async deleteComment(id: string): Promise<void> {
    await this.db.delete(reviewComments).where(eq(reviewComments.id, id));
  }

  async markSubmitted(
    threadIds: string[],
    messageId: string | undefined,
    round: number,
    headCheckpointId?: string,
  ): Promise<void> {
    if (threadIds.length === 0) return;
    await this.db
      .update(reviewThreads)
      .set({
        status: 'submitted',
        submittedMessageId: messageId ?? null,
        reviewRound: round,
        // Re-anchoring measures "did the agent address this?" from here, so
        // it must be the state at submission time.
        ...(headCheckpointId ? { headCheckpointId } : {}),
        updatedAt: new Date(),
      })
      .where(inArray(reviewThreads.id, threadIds));
  }

  async countByStatus(workspaceId: string): Promise<Record<ReviewThreadStatus, number>> {
    const rows = await this.db
      .select({ status: reviewThreads.status })
      .from(reviewThreads)
      .where(eq(reviewThreads.workspaceId, workspaceId));

    const counts: Record<ReviewThreadStatus, number> = {
      draft: 0,
      pending: 0,
      submitted: 0,
      addressed: 0,
      resolved: 0,
      outdated: 0,
    };
    for (const row of rows) counts[row.status] += 1;
    return counts;
  }

  /** Attach each thread's comments in one extra query. */
  private async hydrate(
    rows: Array<typeof reviewThreads.$inferSelect>,
  ): Promise<ReviewThread[]> {
    if (rows.length === 0) return [];
    const commentRows = await this.db
      .select()
      .from(reviewComments)
      .where(
        inArray(
          reviewComments.threadId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(reviewComments.createdAt));

    const byThread = new Map<string, ReviewComment[]>();
    for (const c of commentRows) {
      const list = byThread.get(c.threadId) ?? [];
      list.push({
        id: c.id,
        threadId: c.threadId,
        author: c.author,
        body: c.body,
        ...(c.intent ? { intent: c.intent } : {}),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
      byThread.set(c.threadId, list);
    }

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      scope: row.scope,
      scopeId: row.scopeId,
      repoAlias: row.repoAlias,
      path: row.path,
      baseCheckpointId: row.baseCheckpointId,
      headCheckpointId: row.headCheckpointId,
      side: row.side,
      startLine: row.startLine,
      endLine: row.endLine,
      anchorText: row.anchorText,
      anchorHash: row.anchorHash,
      status: row.status,
      ...(row.resolvedByCheckpointId
        ? { resolvedByCheckpointId: row.resolvedByCheckpointId }
        : {}),
      ...(row.submittedMessageId ? { submittedMessageId: row.submittedMessageId } : {}),
      reviewRound: row.reviewRound,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      comments: byThread.get(row.id) ?? [],
    }));
  }
}
