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
  /** Insert the claim, or answer the row a live claim already holds (`replay: true`). */
  claim(record: IdempotencyClaim): Promise<{ executionId: string; replay: boolean; requestHash: string | null }>;
  /** Point a claim at the real execution once it exists. */
  updateExecutionId(key: string, scope: string, executionId: string): Promise<void>;
  /** Drop a claim whose work failed, so the key can be used again. */
  release(key: string, scope: string): Promise<void>;
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
