// ────────────────────────────────────────────────────────────────
// Ports of the invocation path (P04 WP-4.2/4.3): the idempotency-key store
// behind `IdempotencyService` and the pre-start upload store.
// `@generatorai/db` implements both.
// ────────────────────────────────────────────────────────────────

export interface IdempotencyClaim {
  key: string;
  scope: string;
  executionId: string;
  createdAt: Date;
  expiresAt: Date;
  requestHash?: string | null;
}

export interface IIdempotencyKeyStore {
  /** Insert the claim, or answer the row a live claim already holds (`replay: true`, with when it was claimed). */
  claim(record: IdempotencyClaim): Promise<{ executionId: string; replay: boolean; requestHash: string | null; createdAt?: Date }>;
  /** Point a claim at the real execution once it exists. */
  updateExecutionId(key: string, scope: string, executionId: string): Promise<void>;
  /** Drop a claim whose work failed, so the key can be used again; `createdBefore` drops it only when it is that old. */
  release(key: string, scope: string, opts?: { createdBefore?: Date }): Promise<void>;
  sweepExpired(): Promise<number>;
}

export type InvocationUploadCategory = 'skills' | 'agents' | 'prompts';

export interface InvocationUploadRecord {
  id: string;
  category: InvocationUploadCategory;
  /** The file name as uploaded (sanitised). */
  name: string;
  /** Where the staged file lives. */
  path: string;
  sizeBytes: number;
  principalId: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedByRunId: string | null;
}

export interface IInvocationUploadRepository {
  create(record: InvocationUploadRecord): Promise<void>;
  get(id: string): Promise<InvocationUploadRecord | null>;
  /** Claim the upload for a run; false when another run took it first. */
  markConsumed(id: string, runId: string): Promise<boolean>;
  /** Unconsumed uploads past their expiry (the sweeper deletes their files, then the rows). */
  listExpired(now: Date): Promise<InvocationUploadRecord[]>;
  delete(id: string): Promise<void>;
}

/** A run a chat started through its workflow tools (`chat_workflow_runs`, v60; P06 WP-6.2). */
export interface ChatWorkflowRunLink {
  chatId: string;
  runId: string;
  toolCallId: string | null;
  createdAt: Date;
}

export interface IChatWorkflowRunRepository {
  /** Record the link; a replayed tool call (same chat and run) is a no-op. */
  link(record: ChatWorkflowRunLink): Promise<void>;
  /** The chat's runs, oldest first. */
  listByChat(chatId: string): Promise<ChatWorkflowRunLink[]>;
  /** The chat that started a run, when a chat did. */
  chatOf(runId: string): Promise<ChatWorkflowRunLink | null>;
}
