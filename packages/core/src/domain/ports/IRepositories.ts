// ────────────────────────────────────────────────────────────────
// Repository port interfaces — All 6
// Domain contracts for data persistence
// ────────────────────────────────────────────────────────────────

import type {
  Session,
  SessionStatus,
  SessionOwnerType,
  PersistedEvent,
  ChatMessage,
  Artifact,
} from '@generatorai/shared';

// ── Session Repository ──

export interface ISessionRepository {
  create(session: Session): Promise<Session>;
  getById(id: string): Promise<Session>;
  getAll(): Promise<Session[]>;
  getByStatus(statuses: SessionStatus[]): Promise<Session[]>;
  countByStatus(statuses: SessionStatus[]): Promise<number>;
  /** v2: Get sessions owned by a specific entity */
  getByOwner(ownerType: SessionOwnerType, ownerId: string): Promise<Session[]>;
  update(id: string, updates: Partial<Session>): Promise<Session>;
  updateStatus(id: string, status: SessionStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── Event Repository ──

export interface IEventRepository {
  /** Restore internal counters from DB. Call once on startup. */
  initialize?(): Promise<void>;
  insert(event: Omit<PersistedEvent, 'id'>): Promise<number>;
  getBySessionId(sessionId: string): Promise<PersistedEvent[]>;
  getAfterSequence(sessionId: string, afterSeqId: number): Promise<PersistedEvent[]>;
  getMaxSequencePerSession(): Promise<Array<{ sessionId: string; maxSeq: number }>>;
  /** v2: Get events for a specific workflow run */
  getByWorkflowRunId(workflowRunId: string): Promise<PersistedEvent[]>;
  /** v2: Get events for a specific stage run */
  getByStageRunId(stageRunId: string): Promise<PersistedEvent[]>;
  deleteBySession(sessionId: string): Promise<void>;
  persistGlobal(event: Omit<PersistedEvent, 'id' | 'sessionId' | 'sequenceId'>): Promise<PersistedEvent>;
}

// ── Chat Message Repository ──

export interface IChatMessageRepository {
  create(message: ChatMessage): Promise<ChatMessage>;
  getBySessionId(sessionId: string, limit?: number, offset?: number): Promise<ChatMessage[]>;
  /** Get messages for a session filtered by stageRunId (via metadata) */
  getBySessionAndStageRunId(sessionId: string, stageRunId: string): Promise<ChatMessage[]>;
  /** v2: Get messages for a specific Chat entity */
  getByChatId(chatId: string, limit?: number, offset?: number): Promise<ChatMessage[]>;
  /** v2: Total message count for a Chat entity — used for paginated history. */
  countByChatId(chatId: string): Promise<number>;
  /**
   * The newest message of each of several sessions, in ONE query.
   *
   * The chat catalogue needs a one-line preview per row; asking per chat is
   * N round trips on a list a phone loads on every foreground.
   */
  latestBySessionIds(sessionIds: readonly string[]): Promise<Map<string, ChatMessage>>;
  deleteBySession(sessionId: string): Promise<void>;
  /** Delete specific rows (rewind drops the tail of a chat). */
  deleteByIds(ids: readonly string[]): Promise<void>;
  /** Replace one row's metadata (anchor re-keying after a provider fork). */
  updateMetadata(id: string, metadata: ChatMessage['metadata']): Promise<void>;
}

// ── Artifact Repository ──

export interface IArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;
  upsert(artifact: Artifact): Promise<Artifact>;
  getById(id: string): Promise<Artifact | null>;
  getBySessionId(sessionId: string): Promise<Artifact[]>;
  deleteBySession(sessionId: string): Promise<void>;
}

