// ────────────────────────────────────────────────────────────────
// DrizzleChatRepository — IChatRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IChatRepository } from '@generatorai/core';
import type { Chat, ChatLocalFolder, ChatStatus, BackgroundTaskMeta, BackgroundTaskStatus } from '@generatorai/shared';
import { NotFoundError, StorageError, DEFAULT_AGENT_MODE, coerceAgentMode } from '@generatorai/shared';
import { chats } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord, objectArray, stringArray } from '../utils/jsonColumnSchemas.js';

export class DrizzleChatRepository implements IChatRepository {
  constructor(private db: AppDatabase) {}

  async create(chat: Chat): Promise<Chat> {
    try {
      // DB-03 — symmetric write-side validation: if a service hands us a
      // malformed JSON column value, fail the write loudly rather than
      // silently persisting corruption that `safeJsonColumn` will later
      // paper over on read.
      validateJsonColumn(chat.harnessConfig, jsonRecord, { column: 'harnessConfig', table: 'chats' });
      validateJsonColumn(chat.tags, stringArray, { column: 'tags', table: 'chats' });

      await this.db.insert(chats).values({
        id: chat.id,
        name: chat.name,
        description: chat.description ?? null,
        sessionId: chat.sessionId,
        model: chat.model ?? null,
        harnessConfig: chat.harnessConfig ?? null,
        codebaseIds: chat.codebaseIds ?? null,
        repoUrl: null,
        repoBranch: null,
        workspacePath: null,
        gitRepositories: chat.gitRepositories ?? null,
        workspaceId: chat.workspaceId ?? null,
        tags: chat.tags,
        status: chat.status,
        projectId: chat.projectId ?? null,
        orchestratorMode: chat.orchestratorMode ?? false,
        parentChatId: chat.parentChatId ?? null,
        backgroundTaskName: chat.backgroundTask?.taskName ?? null,
        backgroundTaskIndex: chat.backgroundTask?.taskIndex ?? null,
        backgroundTaskStatus: chat.backgroundTask?.status ?? null,
        defaultAgentMode: chat.defaultAgentMode ?? DEFAULT_AGENT_MODE,
        permissionMode: chat.permissionMode ?? 'bypassPermissions',
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      });
      return chat;
    } catch (err) {
      throw new StorageError(
        `Failed to create chat: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<Chat> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.id, id))
      .limit(1);
    const row = rows[0];
    // BUGFIX: NotFoundError maps to HTTP 404 in the error middleware; the old
    // `StorageError` mapped to 500 and broke API ergonomics for GET on a
    // deleted/non-existent chat.
    if (!row) throw new NotFoundError('Chat', id);
    return this.mapRow(row);
  }

  async getAll(): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .orderBy(chats.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByProjectId(projectId: string): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.projectId, projectId))
      .orderBy(chats.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByStatus(status: ChatStatus): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.status, status));
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<Chat>): Promise<Chat> {
    // DB-03 — validate only the JSON fields that are actually being changed.
    if (updates.harnessConfig !== undefined) {
      validateJsonColumn(updates.harnessConfig, jsonRecord, { column: 'harnessConfig', table: 'chats' });
    }
    if (updates.tags !== undefined) {
      validateJsonColumn(updates.tags, stringArray, { column: 'tags', table: 'chats' });
    }

    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.model !== undefined) values['model'] = updates.model;
    if (updates.harnessConfig !== undefined) values['harnessConfig'] = updates.harnessConfig;
    if (updates.tags !== undefined) values['tags'] = updates.tags;
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.projectId !== undefined) values['projectId'] = updates.projectId;
    if (updates.defaultAgentMode !== undefined) values['defaultAgentMode'] = updates.defaultAgentMode;
    if (updates.permissionMode !== undefined) values['permissionMode'] = updates.permissionMode;
    values['updatedAt'] = new Date();

    await this.db.update(chats).set(values).where(eq(chats.id, id));
    return this.getById(id);
  }

  async updateStatus(id: string, status: ChatStatus): Promise<void> {
    await this.db
      .update(chats)
      .set({ status, updatedAt: new Date() })
      .where(eq(chats.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(chats).where(eq(chats.id, id));
  }

  /** List all WORKER chats spawned by a given orchestrator chat. */
  async listBackgroundTasks(parentChatId: string): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.parentChatId, parentChatId))
      .orderBy(chats.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  /** Update just the background-task status of a worker chat. */
  async updateBackgroundTaskStatus(id: string, status: BackgroundTaskStatus): Promise<void> {
    await this.db
      .update(chats)
      .set({ backgroundTaskStatus: status, updatedAt: new Date() })
      .where(eq(chats.id, id));
  }

  private mapRow(row: typeof chats.$inferSelect): Chat {
    const backgroundTask: BackgroundTaskMeta | undefined =
      row.parentChatId
        ? {
            orchestratorChatId: row.parentChatId,
            taskName: row.backgroundTaskName ?? row.name,
            taskIndex: row.backgroundTaskIndex ?? undefined,
            status: (row.backgroundTaskStatus as BackgroundTaskStatus | null) ?? 'spawned',
          }
        : undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      sessionId: row.sessionId,
      model: row.model ?? undefined,
      harnessConfig: safeJsonColumn(row.harnessConfig, jsonRecord, { fallback: undefined }),
      codebaseIds: safeJsonColumn(row.codebaseIds, stringArray, { fallback: undefined }) as string[] | undefined,
      createWorktree: undefined,
      workspaceId: row.workspaceId ?? undefined,
      gitRepositories: safeJsonColumn(row.gitRepositories, objectArray, { fallback: undefined }) as ChatLocalFolder[] | undefined,
      tags: safeJsonColumn(row.tags, stringArray, { fallback: [] }) ?? [],
      status: row.status as ChatStatus,
      projectId: row.projectId ?? undefined,
      orchestratorMode: row.orchestratorMode ?? undefined,
      parentChatId: row.parentChatId ?? undefined,
      backgroundTask,
      defaultAgentMode: coerceAgentMode(row.defaultAgentMode) ?? DEFAULT_AGENT_MODE,
      permissionMode: (row.permissionMode as Chat['permissionMode']) ?? 'bypassPermissions',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
