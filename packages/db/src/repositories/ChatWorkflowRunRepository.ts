// ────────────────────────────────────────────────────────────────
// DrizzleChatWorkflowRunRepository — the runs a chat started through its
// workflow tools (`chat_workflow_runs`, v60; P06 WP-6.2). The chat's run
// cards and the per-chat concurrency cap read it.
// ────────────────────────────────────────────────────────────────

import { asc, eq } from 'drizzle-orm';
import type { ChatWorkflowRunLink, IChatWorkflowRunRepository } from '@generatorai/core';
import { chatWorkflowRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleChatWorkflowRunRepository implements IChatWorkflowRunRepository {
  constructor(private db: AppDatabase) {}

  async link(record: ChatWorkflowRunLink): Promise<void> {
    await this.db.insert(chatWorkflowRuns).values({ ...record }).onConflictDoNothing();
  }

  async listByChat(chatId: string): Promise<ChatWorkflowRunLink[]> {
    const rows = await this.db.select().from(chatWorkflowRuns).where(eq(chatWorkflowRuns.chatId, chatId)).orderBy(asc(chatWorkflowRuns.createdAt));
    return rows.map((r) => ({ ...r, toolCallId: r.toolCallId ?? null }));
  }

  async chatOf(runId: string): Promise<ChatWorkflowRunLink | null> {
    const row = (await this.db.select().from(chatWorkflowRuns).where(eq(chatWorkflowRuns.runId, runId)).limit(1))[0];
    return row ? { ...row, toolCallId: row.toolCallId ?? null } : null;
  }
}
