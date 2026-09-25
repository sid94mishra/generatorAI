// ────────────────────────────────────────────────────────────────
// DrizzleChatMessageRepository — IChatMessageRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and, desc, inArray, sql } from 'drizzle-orm';
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
      metadata: message.metadata ?? null,
      chatId: message.chatId ?? null,
      // Only an assistant turn can be cut short; a partial row written by an
      // older caller that did not say so is still incomplete.
      complete: message.complete ?? message.metadata?.partial !== true,
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

  async updateMetadata(id: string, metadata: ChatMessage['metadata']): Promise<void> {
    await this.db.update(chatMessages).set({ metadata: metadata ?? null }).where(eq(chatMessages.id, id));
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    // SQLite caps bound parameters; chunk so a long rewind cannot exceed it.
    for (let i = 0; i < ids.length; i += 500) {
      await this.db.delete(chatMessages).where(inArray(chatMessages.id, [...ids.slice(i, i + 500)]));
    }
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

  /**
   * Newest message per session, in one statement.
   *
   * `rowid` breaks ties: two messages of the same turn routinely share a
   * second-resolution `timestamp`, and ordering by time alone returned the
   * user's prompt as the "latest" instead of the answer to it.
   */
  async latestBySessionIds(sessionIds: readonly string[]): Promise<Map<string, ChatMessage>> {
    const out = new Map<string, ChatMessage>();
    if (sessionIds.length === 0) return out;
    // SQLite caps a statement at 999 bound parameters.
    for (let i = 0; i < sessionIds.length; i += 500) {
      const slice = sessionIds.slice(i, i + 500);
      const rows = await this.db
        .select()
        .from(chatMessages)
        .where(inArray(chatMessages.sessionId, [...slice]))
        .orderBy(desc(chatMessages.timestamp), desc(sql`rowid`));
      for (const row of rows) {
        if (!out.has(row.sessionId)) out.set(row.sessionId, this.mapRow(row));
      }
    }
    return out;
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
      metadata: safeJsonColumn(row.metadata, jsonUnknown, { fallback: undefined }) as ChatMessage['metadata'],
      chatId: row.chatId ?? undefined,
      ...(row.role === 'assistant' ? { complete: row.complete } : {}),
      timestamp: row.timestamp,
    };
  }
}
