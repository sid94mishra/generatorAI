// ────────────────────────────────────────────────────────────────
// DrizzleChatMessageRepository — IChatMessageRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and, desc, sql } from 'drizzle-orm';
import type { IChatMessageRepository } from '@generatorai/core';
import type { ChatMessage } from '@generatorai/shared';
import { chatMessages } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonUnknown } from '../utils/jsonColumnSchemas.js';

export class DrizzleChatMessageRepository implements IChatMessageRepository {
  constructor(private db: AppDatabase) {}

  async getBySessionAndStageRunId(sessionId: string, stageRunId: string): Promise<ChatMessage[]> {
    // Filter by sessionId and metadata JSON containing stageRunId
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, sessionId),
          sql`json_extract(${chatMessages.metadata}, '$.stageRunId') = ${stageRunId}`,
        ),
      )
      .orderBy(chatMessages.timestamp, sql`rowid`);
    return rows.map((r) => this.mapRow(r));
  }

  async create(message: ChatMessage): Promise<ChatMessage> {
    await this.db.insert(chatMessages).values({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      attachments: message.attachments ?? null,
      toolName: message.toolName ?? null,
      toolArgs: message.toolArgs ?? null,
      toolResult: message.toolResult ?? null,
      workflowId: message.workflowId ?? null,
      metadata: message.metadata ?? null,
      chatId: message.chatId ?? null,
      timestamp: message.timestamp,
    });
    return message;
  }

  async getBySessionId(
    sessionId: string,
    limit?: number,
    offset?: number,
  ): Promise<ChatMessage[]> {
    let query = this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      // Order by timestamp ASC with rowid as tiebreaker.
      // timestamp uses mode:'timestamp' (epoch seconds), so messages created
      // within the same second get identical values. SQLite's hidden rowid
      // column preserves exact insertion order, guaranteeing that user messages
      // always appear before their assistant replies even when timestamps collide.
      .orderBy(chatMessages.timestamp, sql`rowid`);

    if (limit !== undefined) {
      query = query.limit(limit) as typeof query;
    }
    if (offset !== undefined) {
      query = query.offset(offset) as typeof query;
    }

    const rows = await query;
    return rows.map((r) => this.mapRow(r));
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
  }

  async getByChatId(
    chatId: string,
    limit?: number,
    offset?: number,
  ): Promise<ChatMessage[]> {
    let query = this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(chatMessages.timestamp, sql`rowid`);

    if (limit !== undefined) {
      query = query.limit(limit) as typeof query;
    }
    if (offset !== undefined) {
      query = query.offset(offset) as typeof query;
    }

    const rows = await query;
    return rows.map((r) => this.mapRow(r));
  }

  async countByChatId(chatId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId));
    return Number(rows[0]?.count ?? 0);
  }

  private mapRow(row: typeof chatMessages.$inferSelect): ChatMessage {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as ChatMessage['role'],
      content: row.content,
      attachments: safeJsonColumn(row.attachments, jsonUnknown, { fallback: undefined }) as ChatMessage['attachments'],
      toolName: row.toolName ?? undefined,
      toolArgs: safeJsonColumn(row.toolArgs, jsonUnknown, { fallback: undefined }),
      toolResult: safeJsonColumn(row.toolResult, jsonUnknown, { fallback: undefined }),
      workflowId: row.workflowId ?? undefined,
      metadata: safeJsonColumn(row.metadata, jsonUnknown, { fallback: undefined }) as ChatMessage['metadata'],
      chatId: row.chatId ?? undefined,
      timestamp: row.timestamp,
    };
  }
}
