// ────────────────────────────────────────────────────────────────
// Repository port interfaces — All 6
// Domain contracts for data persistence
// ────────────────────────────────────────────────────────────────

import type {
  Session,
  SessionStatus,
  SessionOwnerType,
  Workflow,
  WorkflowStatus,
  PersistedEvent,
  ChatMessage,
  Artifact,
  WebhookRegistration,
  WebhookDelivery,
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

// ── Workflow Repository ──

export interface IWorkflowRepository {
  create(workflow: Workflow): Promise<Workflow>;
  getById(id: string): Promise<Workflow>;
  getBySessionId(sessionId: string): Promise<Workflow[]>;
  updateStatus(id: string, status: WorkflowStatus): Promise<void>;
  update(id: string, updates: Partial<Workflow>): Promise<Workflow>;
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
  deleteBySession(sessionId: string): Promise<void>;
}

// ── Artifact Repository ──

export interface IArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;
  upsert(artifact: Artifact): Promise<Artifact>;
  getById(id: string): Promise<Artifact | null>;
  getBySessionId(sessionId: string): Promise<Artifact[]>;
  deleteBySession(sessionId: string): Promise<void>;
}

// ── Webhook Repository ──

export interface IWebhookRepository {
  getActiveRegistrations(source: string, eventType: string): Promise<WebhookRegistration[]>;
  getRegistration(id: string): Promise<WebhookRegistration | null>;
  getAllRegistrations(): Promise<WebhookRegistration[]>;
  createRegistration(reg: WebhookRegistration): Promise<WebhookRegistration>;
  deleteRegistration(id: string): Promise<void>;
  logDelivery(delivery: WebhookDelivery): Promise<void>;
  getDeliveryById(deliveryId: string): Promise<WebhookDelivery | null>;
  updateDeliveryStatus(deliveryId: string, status: string): Promise<void>;
  updateDelivery(deliveryId: string, updates: Partial<WebhookDelivery>): Promise<void>;
}
