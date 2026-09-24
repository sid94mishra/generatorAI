// ────────────────────────────────────────────────────────────────
// DrizzleChatRepository — IChatRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { count, eq } from 'drizzle-orm';
import type { IChatRepository } from '@generatorai/core';
import type { Chat, ChatLocalFolder, ChatStatus, BackgroundTaskMeta, BackgroundTaskStatus } from '@generatorai/shared';
import { NotFoundError, StorageError, DEFAULT_AGENT_MODE, isAgentMode } from '@generatorai/shared';
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
      validateJsonColumn(chat.sourceControl, jsonRecord, { column: 'sourceControl', table: 'chats' });
      validateJsonColumn(chat.agentOverrides, jsonRecord, { column: 'agentOverrides', table: 'chats' });
      validateJsonColumn(chat.agentSnapshot, jsonRecord, { column: 'agentSnapshot', table: 'chats' });

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
        sources: chat.sources ?? null,
        sourceControl: chat.sourceControl ?? null,
        primarySource: chat.primarySource ?? null,
        workspaceId: chat.workspaceId ?? null,
        tags: chat.tags,
        status: chat.status,
        projectId: chat.projectId ?? null,
        orchestratorMode: chat.orchestratorMode ?? false,
        parentChatId: chat.parentChatId ?? null,
        forkedFromChatId: chat.forkedFromChatId ?? null,
        forkedAtTurnId: chat.forkedAtTurnId ?? null,
        conversationSeed: chat.conversationSeed ?? null,
        backgroundTaskName: chat.backgroundTask?.taskName ?? null,
        backgroundTaskIndex: chat.backgroundTask?.taskIndex ?? null,
        backgroundTaskStatus: chat.backgroundTask?.status ?? null,
        defaultAgentMode: chat.defaultAgentMode ?? DEFAULT_AGENT_MODE,
        permissionMode: chat.permissionMode ?? 'bypassPermissions',
        agentRef: chat.agentRef ?? null,
        agentId: chat.agentId ?? null,
        agentVersion: chat.agentVersion ?? null,
        agentOverrides: chat.agentOverrides ?? null,
        agentSnapshot: chat.agentSnapshot ?? null,
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

  async countByStatus(status: ChatStatus): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(chats)
      .where(eq(chats.status, status));
    return row?.value ?? 0;
  }

  async update(id: string, updates: Partial<Chat>): Promise<Chat> {
    // DB-03 — validate only the JSON fields that are actually being changed.
    if (updates.harnessConfig !== undefined) {
      validateJsonColumn(updates.harnessConfig, jsonRecord, { column: 'harnessConfig', table: 'chats' });
    }
    if (updates.tags !== undefined) {
      validateJsonColumn(updates.tags, stringArray, { column: 'tags', table: 'chats' });
    }
    if (updates.sourceControl !== undefined) {
      validateJsonColumn(updates.sourceControl, jsonRecord, { column: 'sourceControl', table: 'chats' });
    }
    if (updates.agentOverrides !== undefined) {
      validateJsonColumn(updates.agentOverrides, jsonRecord, { column: 'agentOverrides', table: 'chats' });
    }
    if (updates.agentSnapshot !== undefined) {
      validateJsonColumn(updates.agentSnapshot, jsonRecord, { column: 'agentSnapshot', table: 'chats' });
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
    // Binding an agent is a run-time act, so unlike codebaseIds these stay mutable.
    if (updates.agentRef !== undefined) values['agentRef'] = updates.agentRef ?? null;
    if (updates.agentId !== undefined) values['agentId'] = updates.agentId ?? null;
    if (updates.agentVersion !== undefined) values['agentVersion'] = updates.agentVersion ?? null;
    if (updates.agentOverrides !== undefined) values['agentOverrides'] = updates.agentOverrides ?? null;
    if (updates.agentSnapshot !== undefined) values['agentSnapshot'] = updates.agentSnapshot ?? null;
    if (updates.orchestratorMode !== undefined) values['orchestratorMode'] = updates.orchestratorMode;
    // The mount plan is editable on an idle chat (PUT /chats/:id/sources).
    if (updates.sources !== undefined) values['sources'] = updates.sources ?? null;
    if (updates.primarySource !== undefined) values['primarySource'] = updates.primarySource ?? null;
    if (updates.conversationSeed !== undefined) values['conversationSeed'] = updates.conversationSeed ?? null;
    // Agent-native source control is togglable for the life of the chat.
    if (updates.sourceControl !== undefined) values['sourceControl'] = updates.sourceControl ?? null;
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

  /**
   * W24 fix — durable orchestrator termination state (migration v41).
   * Read directly off the orchestrator chat's own row rather than through
   * the full `Chat` mapping — this is narrow, orchestrator-internal state,
   * not a domain field every `Chat` consumer needs to reason about.
   */
  async getOrchestratorWaveState(
    chatId: string,
  ): Promise<{ waveCount: number; startedAt: number } | null> {
    const rows = await this.db
      .select({
        orchestratorWaveCount: chats.orchestratorWaveCount,
        orchestratorStartedAt: chats.orchestratorStartedAt,
      })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    const row = rows[0];
    if (!row || row.orchestratorStartedAt == null) return null;
    return {
      waveCount: row.orchestratorWaveCount ?? 0,
      startedAt: row.orchestratorStartedAt,
    };
  }

  /** Persist the orchestrator's wave count + start time (see above). */
  async setOrchestratorWaveState(
    chatId: string,
    state: { waveCount: number; startedAt: number },
  ): Promise<void> {
    await this.db
      .update(chats)
      .set({
        orchestratorWaveCount: state.waveCount,
        orchestratorStartedAt: state.startedAt,
      })
      .where(eq(chats.id, chatId));
  }

  /** Clear the orchestrator's wave state back to "never started" (called on archive). */
  async clearOrchestratorWaveState(chatId: string): Promise<void> {
    await this.db
      .update(chats)
      .set({ orchestratorWaveCount: null, orchestratorStartedAt: null })
      .where(eq(chats.id, chatId));
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
      sources: safeJsonColumn(row.sources, objectArray, { fallback: undefined }) as Chat['sources'],
      primarySource: row.primarySource ?? undefined,
      sourceControl: safeJsonColumn(row.sourceControl, jsonRecord, { fallback: undefined }) as Chat['sourceControl'],
      tags: safeJsonColumn(row.tags, stringArray, { fallback: [] }) ?? [],
      status: row.status as ChatStatus,
      projectId: row.projectId ?? undefined,
      orchestratorMode: row.orchestratorMode ?? undefined,
      parentChatId: row.parentChatId ?? undefined,
      forkedFromChatId: row.forkedFromChatId ?? undefined,
      forkedAtTurnId: row.forkedAtTurnId ?? undefined,
      conversationSeed: row.conversationSeed ?? undefined,
      backgroundTask,
      defaultAgentMode: isAgentMode(row.defaultAgentMode) ? row.defaultAgentMode : DEFAULT_AGENT_MODE,
      permissionMode: (row.permissionMode as Chat['permissionMode']) ?? 'bypassPermissions',
      agentRef: row.agentRef ?? undefined,
      agentId: row.agentId ?? undefined,
      agentVersion: row.agentVersion ?? undefined,
      agentOverrides: safeJsonColumn(row.agentOverrides, jsonRecord, { fallback: undefined }) as Chat['agentOverrides'],
      agentSnapshot: safeJsonColumn(row.agentSnapshot, jsonRecord, { fallback: undefined }) as Chat['agentSnapshot'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
