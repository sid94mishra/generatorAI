// ────────────────────────────────────────────────────────────────
// DrizzlePlanRepository — IPlanRepository impl (PLN-01)
// ────────────────────────────────────────────────────────────────

import { and, asc, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import type {
  AddPlanRevisionParams,
  CreatePlanParams,
  IPlanRepository,
} from '@generatorai/core';
import type {
  PlanAction,
  PlanComment,
  PlanCommentAnchor,
  PlanDecision,
  PlanDocument,
  PlanRevision,
  PlanStatus,
} from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { planComments, planDocuments, planRevisions } from '../schema.js';
import type { AppDatabase } from '../index.js';

/** Plan states that a newer plan is allowed to supersede. */
const SUPERSEDABLE: PlanStatus[] = ['drafting', 'awaiting_review', 'changes_requested'];

export class DrizzlePlanRepository implements IPlanRepository {
  constructor(private db: AppDatabase) {}

  async create(params: CreatePlanParams): Promise<PlanDocument> {
    const now = new Date();
    try {
      await this.db.insert(planDocuments).values({
        id: params.id,
        chatId: params.chatId,
        sessionId: params.sessionId,
        turnId: params.turnId,
        title: params.title,
        fileName: params.fileName,
        status: params.status ?? 'awaiting_review',
        currentRevision: 1,
        harnessType: params.harnessType,
        availableActions: params.availableActions,
        recommendedAction: params.recommendedAction ?? null,
        stageRunId: params.stageRunId ?? null,
        workflowRunId: params.workflowRunId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await this.db.insert(planRevisions).values({
        id: `${params.id}-r1`,
        planId: params.id,
        revision: 1,
        content: params.content,
        summary: params.summary,
        authoredBy: 'agent',
        createdAt: now,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create plan: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
    const created = await this.findById(params.id);
    if (!created) throw new StorageError(`Plan ${params.id} vanished immediately after insert`);
    return created;
  }

  async findById(planId: string): Promise<PlanDocument | null> {
    const rows = await this.db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.id, planId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [revisions, comments] = await Promise.all([
      this.listRevisions(planId),
      this.listComments(planId),
    ]);
    return this.mapRow(row, revisions, comments);
  }

  async listByChat(chatId: string): Promise<PlanDocument[]> {
    const rows = await this.db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.chatId, chatId))
      .orderBy(desc(planDocuments.createdAt));
    return Promise.all(
      rows.map(async (row) => {
        const [revisions, comments] = await Promise.all([
          this.listRevisions(row.id),
          this.listComments(row.id),
        ]);
        return this.mapRow(row, revisions, comments);
      }),
    );
  }

  async addRevision(params: AddPlanRevisionParams): Promise<PlanRevision | null> {
    const now = new Date();
    // Optimistic concurrency: the bump only lands while the plan is still at
    // the revision the caller read. Two tabs editing the same plan therefore
    // produce one winner and one 409 instead of a silent overwrite.
    const bump = await this.db
      .update(planDocuments)
      .set({ currentRevision: sql`${planDocuments.currentRevision} + 1`, updatedAt: now })
      .where(
        params.expectedRevision !== undefined
          ? and(
              eq(planDocuments.id, params.planId),
              eq(planDocuments.currentRevision, params.expectedRevision),
            )
          : eq(planDocuments.id, params.planId),
      )
      .returning({ revision: planDocuments.currentRevision });

    const nextRevision = bump[0]?.revision;
    if (nextRevision === undefined) return null;

    const revision: PlanRevision = {
      revision: nextRevision,
      content: params.content,
      summary: params.summary,
      authoredBy: params.authoredBy,
      createdAt: now,
    };
    await this.db.insert(planRevisions).values({
      id: `${params.planId}-r${nextRevision}`,
      planId: params.planId,
      revision: nextRevision,
      content: params.content,
      summary: params.summary,
      authoredBy: params.authoredBy,
      createdAt: now,
    });
    return revision;
  }

  async getRevision(planId: string, revision: number): Promise<PlanRevision | null> {
    const rows = await this.db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.planId, planId), eq(planRevisions.revision, revision)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      revision: row.revision,
      content: row.content,
      summary: row.summary,
      authoredBy: row.authoredBy,
      createdAt: row.createdAt,
    };
  }

  async updateStatus(planId: string, status: PlanStatus): Promise<void> {
    await this.db
      .update(planDocuments)
      .set({ status, updatedAt: new Date() })
      .where(eq(planDocuments.id, planId));
  }

  async setDecision(planId: string, status: PlanStatus, decision: PlanDecision): Promise<void> {
    await this.db
      .update(planDocuments)
      .set({ status, decision, updatedAt: new Date() })
      .where(eq(planDocuments.id, planId));
  }

  async setFilePath(planId: string, filePath: string): Promise<void> {
    await this.db
      .update(planDocuments)
      .set({ filePath, updatedAt: new Date() })
      .where(eq(planDocuments.id, planId));
  }

  async supersedeOthers(chatId: string, keepPlanId: string): Promise<void> {
    await this.db
      .update(planDocuments)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(
        and(
          eq(planDocuments.chatId, chatId),
          ne(planDocuments.id, keepPlanId),
          // Only in-flight plans are superseded; approved/rejected history is
          // immutable so the transcript keeps telling the truth.
          notInArray(
            planDocuments.status,
            (['approved', 'rejected', 'superseded', 'expired'] as PlanStatus[]),
          ),
        ),
      );
    void SUPERSEDABLE;
  }

  async addComment(params: {
    id: string;
    planId: string;
    revision: number;
    body: string;
    anchor?: PlanCommentAnchor;
  }): Promise<PlanComment> {
    const now = new Date();
    await this.db.insert(planComments).values({
      id: params.id,
      planId: params.planId,
      revision: params.revision,
      anchorStartLine: params.anchor?.startLine ?? null,
      anchorEndLine: params.anchor?.endLine ?? null,
      anchorText: params.anchor?.quotedText ?? null,
      anchorHash: params.anchor?.contentHash ?? null,
      body: params.body,
      resolved: false,
      createdAt: now,
    });
    return {
      id: params.id,
      planId: params.planId,
      revision: params.revision,
      ...(params.anchor ? { anchor: params.anchor } : {}),
      body: params.body,
      resolved: false,
      createdAt: now,
    };
  }

  async listComments(planId: string): Promise<PlanComment[]> {
    const rows = await this.db
      .select()
      .from(planComments)
      .where(eq(planComments.planId, planId))
      .orderBy(asc(planComments.createdAt));
    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      revision: row.revision,
      ...(row.anchorStartLine !== null && row.anchorEndLine !== null
        ? {
            anchor: {
              startLine: row.anchorStartLine,
              endLine: row.anchorEndLine,
              quotedText: row.anchorText ?? '',
              contentHash: row.anchorHash ?? '',
            },
          }
        : {}),
      body: row.body,
      resolved: row.resolved,
      createdAt: row.createdAt,
    }));
  }

  async resolveComment(commentId: string, resolved: boolean): Promise<void> {
    await this.db.update(planComments).set({ resolved }).where(eq(planComments.id, commentId));
  }

  async deleteByChat(chatId: string): Promise<void> {
    // plan_revisions / plan_comments cascade on plan_documents.
    await this.db.delete(planDocuments).where(eq(planDocuments.chatId, chatId));
  }

  private async listRevisions(planId: string): Promise<PlanRevision[]> {
    const rows = await this.db
      .select()
      .from(planRevisions)
      .where(eq(planRevisions.planId, planId))
      .orderBy(asc(planRevisions.revision));
    return rows.map((row) => ({
      revision: row.revision,
      content: row.content,
      summary: row.summary,
      authoredBy: row.authoredBy,
      createdAt: row.createdAt,
    }));
  }

  private mapRow(
    row: typeof planDocuments.$inferSelect,
    revisions: PlanRevision[],
    comments: PlanComment[],
  ): PlanDocument {
    return {
      id: row.id,
      chatId: row.chatId,
      sessionId: row.sessionId,
      turnId: row.turnId,
      title: row.title,
      fileName: row.fileName,
      ...(row.filePath ? { filePath: row.filePath } : {}),
      status: row.status,
      currentRevision: row.currentRevision,
      revisions,
      harnessType: row.harnessType,
      availableActions: (row.availableActions ?? []) as PlanAction[],
      ...(row.recommendedAction
        ? { recommendedAction: row.recommendedAction as PlanAction }
        : {}),
      ...(row.decision ? { decision: row.decision as PlanDecision } : {}),
      ...(row.stageRunId ? { stageRunId: row.stageRunId } : {}),
      ...(row.workflowRunId ? { workflowRunId: row.workflowRunId } : {}),
      comments,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
