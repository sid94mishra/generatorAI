// ────────────────────────────────────────────────────────────────
// DrizzleChatRepository — IChatRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { and, asc, count, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type {
  ChatListActivity,
  ChatListFilter,
  ChatListKeyset,
  ChatListPageQuery,
  ChatListPageResult,
  IChatRepository,
} from '@generatorai/core';
import type {
  Chat,
  ChatChangeStats,
  ChatListSort,
  ChatLocalFolder,
  ChatStatus,
  ChatTurnStatus,
  BackgroundTaskMeta,
  BackgroundTaskStatus,
} from '@generatorai/shared';
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
        lastActivityAt: chat.createdAt,
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

  async getByAgentRef(ref: string): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.agentRef, ref))
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

  async getByWorkspaceId(workspaceId: string): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.workspaceId, workspaceId))
      .orderBy(chats.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  // ── Chat list v2 (G-02) ──────────────────────────────────────

  async listPage(query: ChatListPageQuery): Promise<ChatListPageResult> {
    const { filter, sort, after, limit } = query;
    const key = sortKey(sort);
    const where = filterConditions(filter, true);
    if (after) where.push(keysetCondition(sort, key, after));

    const rows = await this.db
      .select({ row: chats, sortValue: key })
      .from(chats)
      .where(and(...where))
      .orderBy(...sortOrder(sort, key))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const next: ChatListKeyset | null =
      rows.length > limit && last ? { value: last.sortValue, id: last.row.id } : null;

    const grouped = await this.db
      .select({ status: chats.status, n: count() })
      .from(chats)
      .where(and(...filterConditions(filter, false)))
      .groupBy(chats.status);
    const counts = { active: 0, archived: 0 };
    for (const g of grouped) {
      if (g.status === 'active' || g.status === 'archived') counts[g.status] = g.n;
    }
    const total = filter.status ? counts[filter.status] : counts.active + counts.archived;

    return {
      rows: page.map(({ row }) => ({ chat: this.mapRow(row), activity: mapActivity(row) })),
      next,
      total,
      counts,
    };
  }

  async getListActivity(id: string): Promise<ChatListActivity | null> {
    const rows = await this.db.select().from(chats).where(eq(chats.id, id)).limit(1);
    const row = rows[0];
    return row ? mapActivity(row) : null;
  }

  async touchActivity(id: string, at: Date): Promise<void> {
    await this.db
      .update(chats)
      .set({ lastActivityAt: sql`MAX(${chats.lastActivityAt}, ${at.getTime()})` })
      .where(eq(chats.id, id));
  }

  async recordTurnEnd(
    id: string,
    turn: { status: ChatTurnStatus; endedAt: Date; error?: string },
  ): Promise<void> {
    await this.db
      .update(chats)
      .set({
        lastTurnStatus: turn.status,
        lastTurnEndedAt: turn.endedAt,
        lastTurnError: turn.status === 'failed' ? (turn.error ?? null) : null,
        lastActivityAt: sql`MAX(${chats.lastActivityAt}, ${turn.endedAt.getTime()})`,
      })
      .where(eq(chats.id, id));
  }

  async setChangeStats(id: string, stats: ChatChangeStats): Promise<boolean> {
    const result = await this.db
      .update(chats)
      .set({
        changesFiles: stats.files,
        changesAdditions: stats.additions,
        changesDeletions: stats.deletions,
      })
      .where(
        and(
          eq(chats.id, id),
          sql`(${chats.changesFiles} IS NOT ${stats.files} OR ${chats.changesAdditions} IS NOT ${stats.additions} OR ${chats.changesDeletions} IS NOT ${stats.deletions})`,
        ),
      )
      .run();
    return result.changes > 0;
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
      defaultAgentMode: coerceAgentMode(row.defaultAgentMode) ?? DEFAULT_AGENT_MODE,
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

// ── Chat list helpers ──────────────────────────────────────────

type ChatRow = typeof chats.$inferSelect;

/** The value a page is ordered by; returned with each row so the cursor uses SQLite's own collation. */
function sortKey(sort: ChatListSort): SQL<number | string> {
  switch (sort) {
    case 'created':
      return sql<number>`${chats.createdAt}`;
    case 'name':
      return sql<string>`lower(${chats.name})`;
    case 'activity':
    default:
      // The bare column, so the v56 composite indexes (… last_activity_at, id)
      // serve the order with no temp B-tree (P2-R30). It is never NULL:
      // `create` stamps it, v56 backfilled older rows and rejects NULL writes.
      return sql<number>`${chats.lastActivityAt}`;
  }
}

function sortOrder(sort: ChatListSort, key: SQL<number | string>): SQL[] {
  return sort === 'name' ? [asc(key), asc(chats.id)] : [desc(key), desc(chats.id)];
}

/**
 * Rows after the cursor, as a row-value comparison: SQLite turns
 * `(key, id) < (?, ?)` into a range on the composite index, so a cursor page
 * starts at the cursor instead of scanning (and discarding) every earlier row.
 */
function keysetCondition(sort: ChatListSort, key: SQL<number | string>, after: ChatListKeyset): SQL {
  const past = sort === 'name' ? sql`>` : sql`<`;
  return sql`(${key}, ${chats.id}) ${past} (${after.value}, ${after.id})`;
}

/** `!` escapes LIKE's wildcards, so a search for `50%` means the text. */
function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[!%_]/g, (c) => `!${c}`)}%`;
}

function filterConditions(filter: ChatListFilter, withStatus: boolean): SQL[] {
  const where: SQL[] = [];
  if (withStatus && filter.status) where.push(eq(chats.status, filter.status));
  if (!filter.includeWorkers) where.push(isNull(chats.parentChatId));
  if (filter.projectIds?.length) where.push(inArray(chats.projectId, [...filter.projectIds]));
  if (filter.agentRefs?.length) where.push(inArray(chats.agentRef, [...filter.agentRefs]));
  if (filter.tags?.length) {
    const tags = sql.join(filter.tags.map((t) => sql`${t}`), sql`, `);
    where.push(
      sql`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${chats.tags}) THEN ${chats.tags} ELSE '[]' END) AS tag WHERE tag.value IN (${tags}))`,
    );
  }
  const q = filter.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    where.push(
      sql`(lower(${chats.name}) LIKE ${pattern} ESCAPE '!'
        OR lower(COALESCE(${chats.description}, '')) LIKE ${pattern} ESCAPE '!'
        OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${chats.tags}) THEN ${chats.tags} ELSE '[]' END) AS t
                   WHERE lower(t.value) LIKE ${pattern} ESCAPE '!'))`,
    );
  }
  if (filter.state) {
    const { ids, turnStatuses, excludeIds } = filter.state;
    const anyOf: SQL[] = [];
    if (ids.length) anyOf.push(inArray(chats.id, [...ids]));
    if (turnStatuses.length) {
      const ended = [inArray(chats.lastTurnStatus, [...turnStatuses])];
      if (excludeIds.length) ended.push(notInArray(chats.id, [...excludeIds]));
      anyOf.push(and(...ended)!);
    }
    // An empty state filter (e.g. "Running" while nothing runs) matches nothing.
    where.push(anyOf.length ? or(...anyOf)! : sql`0`);
  }
  return where;
}

function mapActivity(row: ChatRow): ChatListActivity {
  const activity: ChatListActivity = {
    lastActivityAt: row.lastActivityAt,
  };
  if (row.lastTurnStatus && row.lastTurnEndedAt) {
    activity.lastTurn = {
      status: row.lastTurnStatus,
      endedAt: row.lastTurnEndedAt,
      ...(row.lastTurnError ? { error: row.lastTurnError } : {}),
    };
  }
  if (row.changesFiles !== null && row.changesAdditions !== null && row.changesDeletions !== null) {
    activity.changes = {
      files: row.changesFiles,
      additions: row.changesAdditions,
      deletions: row.changesDeletions,
    };
  }
  return activity;
}
