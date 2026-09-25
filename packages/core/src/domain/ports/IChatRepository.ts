// ────────────────────────────────────────────────────────────────
// IChatRepository — Port for Chat entity persistence
// ────────────────────────────────────────────────────────────────

import type {
  Chat,
  ChatChangeStats,
  ChatListSort,
  ChatStatus,
  ChatTurnStatus,
  BackgroundTaskStatus,
} from '@generatorai/shared';

/** The list row's summary columns (G-02). */
export interface ChatListActivity {
  lastActivityAt: Date;
  lastTurn?: { status: ChatTurnStatus; endedAt: Date; error?: string };
  changes?: ChatChangeStats;
}

export interface ChatListRow {
  chat: Chat;
  activity: ChatListActivity;
}

/**
 * The `state` filter, resolved: a row matches when its id is in `ids` (the
 * live Needs you / Running chats from the attention feed) OR its last turn
 * ended in one of `turnStatuses` and its id is not in `excludeIds` (a chat
 * that is live again is not "Done" any more).
 */
export interface ChatListStateFilter {
  ids: readonly string[];
  turnStatuses: readonly ChatTurnStatus[];
  excludeIds: readonly string[];
}

export interface ChatListFilter {
  status?: ChatStatus;
  projectIds?: readonly string[];
  agentRefs?: readonly string[];
  /** Any of these tags. */
  tags?: readonly string[];
  /** Case-insensitive substring of the name, the description or a tag. */
  q?: string;
  state?: ChatListStateFilter;
  /** Include orchestrator worker chats (default false). */
  includeWorkers?: boolean;
}

/** Keyset position: the sort value of the last row seen, plus its id. */
export interface ChatListKeyset {
  value: number | string;
  id: string;
}

export interface ChatListPageQuery {
  filter: ChatListFilter;
  sort: ChatListSort;
  after?: ChatListKeyset;
  limit: number;
}

export interface ChatListPageResult {
  rows: ChatListRow[];
  /** Keyset of the last row when more rows follow, else null. */
  next: ChatListKeyset | null;
  /** Rows matching the whole filter. */
  total: number;
  /** Rows matching the filter without `status`, per lifecycle status. */
  counts: { active: number; archived: number };
}

export interface IChatRepository {
  create(chat: Chat): Promise<Chat>;
  getById(id: string): Promise<Chat>;
  getAll(): Promise<Chat[]>;
  getByStatus(status: ChatStatus): Promise<Chat[]>;
  /** `COUNT(*)` of chats in `status` — for health/dashboard tiles that only need the number. */
  countByStatus(status: ChatStatus): Promise<number>;
  getByProjectId(projectId: string): Promise<Chat[]>;
  /** Every chat whose workspace is `workspaceId` (an orchestrator's workers share it). */
  getByWorkspaceId(workspaceId: string): Promise<Chat[]>;
  update(id: string, updates: Partial<Chat>): Promise<Chat>;
  updateStatus(id: string, status: ChatStatus): Promise<void>;
  delete(id: string): Promise<void>;
  /** List all WORKER chats spawned by a given orchestrator chat. */
  listBackgroundTasks(parentChatId: string): Promise<Chat[]>;
  /** Update just the background-task status of a worker chat. */
  updateBackgroundTaskStatus(id: string, status: BackgroundTaskStatus): Promise<void>;
  /**
   * W24 fix — durable orchestrator termination state. Returns `null` when
   * the orchestrator chat has never recorded a wave (fresh orchestration).
   */
  getOrchestratorWaveState(chatId: string): Promise<{ waveCount: number; startedAt: number } | null>;
  /** Persist the orchestrator's wave count + start time (see above). */
  setOrchestratorWaveState(chatId: string, state: { waveCount: number; startedAt: number }): Promise<void>;
  /** Clear the orchestrator's wave state back to "never started" (called on archive). */
  clearOrchestratorWaveState(chatId: string): Promise<void>;

  // ── Chat list v2 (G-02) ──

  /** One keyset page of chats with their summary columns, plus total and segment counts. */
  listPage(query: ChatListPageQuery): Promise<ChatListPageResult>;
  /** The summary columns of one chat, or null when it does not exist. */
  getListActivity(id: string): Promise<ChatListActivity | null>;
  /** A turn started (or something else happened worth sorting by). Never moves backwards. */
  touchActivity(id: string, at: Date): Promise<void>;
  /** A turn ended: records its outcome and moves the activity time. */
  recordTurnEnd(id: string, turn: { status: ChatTurnStatus; endedAt: Date; error?: string }): Promise<void>;
  /** Store the net change stats. Returns false when they were already these values. */
  setChangeStats(id: string, stats: ChatChangeStats): Promise<boolean>;
}
