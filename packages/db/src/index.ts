// ────────────────────────────────────────────────────────────────
// @generatorai/db — Database infrastructure (SQLite + Drizzle)
// ────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getMeter } from '@generatorai/shared';
import * as schema from './schema.js';

// ── OTel Metrics ──
const meter = getMeter('db');
const dbQueryCounter = meter.createCounter('db.queries.total', {
  description: 'Total database queries executed',
});
const dbQueryDuration = meter.createHistogram('db.query.duration_ms', {
  description: 'Duration of database queries in milliseconds',
  unit: 'ms',
});

export * from './schema.js';
export { safeJsonColumn } from './utils/safeJsonColumn.js';
export { validateJsonColumn, JsonColumnValidationError } from './utils/validateJsonColumn.js';
export {
  jsonRecord,
  jsonArray,
  stringArray,
  jsonUnknown,
  objectArray,
} from './utils/jsonColumnSchemas.js';
export { EventRetentionService } from './services/EventRetentionService.js';
export type {
  EventRetentionConfig,
  RetentionLogger,
  RetentionSweeper,
} from './services/EventRetentionService.js';
export { DrizzleSessionRepository } from './repositories/SessionRepository.js';
export { PushTokenRepository, MAX_PUSH_FAILURES } from './repositories/PushTokenRepository.js';
export type { PushTokenRecord, PushProvider } from './repositories/PushTokenRepository.js';
export { DrizzleSequenceAllocator } from './repositories/SequenceAllocator.js';
export { DrizzleSessionAllocationRepository } from './repositories/SessionAllocationRepository.js';
export {
  DrizzleStreamCursorRepository,
  StreamAppendInTransactionError,
} from './repositories/StreamCursorRepository.js';
export type { StreamScope, StreamEventRow } from './repositories/StreamCursorRepository.js';
export { DrizzleWorkflowRepository } from './repositories/WorkflowRepository.js';
export { DrizzleEventRepository } from './repositories/EventRepository.js';
export { DrizzleChatMessageRepository } from './repositories/ChatMessageRepository.js';
export { DrizzleArtifactRepository } from './repositories/ArtifactRepository.js';
export { DrizzleWebhookRepository } from './repositories/WebhookRepository.js';

// v2 repositories
export { DrizzleChatRepository } from './repositories/ChatRepository.js';
export { DrizzleAgentRepository } from './repositories/AgentRepository.js';
export { DrizzleWorkflowDefinitionRepository } from './repositories/WorkflowDefinitionRepository.js';
export { DrizzleStageDefinitionRepository } from './repositories/StageDefinitionRepository.js';
export { DrizzleStageEdgeRepository } from './repositories/StageEdgeRepository.js';
export { DrizzleWorkflowRunRepository } from './repositories/WorkflowRunRepository.js';
export { DrizzleStageRunRepository } from './repositories/StageRunRepository.js';

// Automation repositories
export { DrizzleAutomationRepository } from './repositories/AutomationRepository.js';
export { DrizzleAutomationExecutionRepository } from './repositories/AutomationExecutionRepository.js';
export { DrizzleIdempotencyKeyRepository } from './repositories/IdempotencyKeyRepository.js';
export type { IdempotencyKeyRecord } from './repositories/IdempotencyKeyRepository.js';

// Security / auth repositories (migration v24)
export {
  SqliteDeviceRepository,
  SqlitePairingGrantRepository,
  SqliteReplayStore,
  SqliteNonceStore,
  SqliteStreamTicketRepository,
  SqliteServiceAccountRepository,
  SqliteSecurityAuditRepository,
  SqliteRelayRevokeOutboxRepository,
  sqliteHandle,
} from './repositories/AuthRepositories.js';
export { SqliteHarnessInstanceRepository } from './repositories/HarnessInstanceRepository.js';
export type {
  HarnessInstanceRecord,
  PermissionProfile,
} from './repositories/HarnessInstanceRepository.js';
// W34 / P1-42 — durable conversation→harness ownership (migration v33)
export { SqliteConversationOwnershipRepository } from './repositories/ConversationOwnershipRepository.js';
// W34 — durable conversation→provider INSTANCE ownership (migration v40)
export { SqliteConversationInstanceOwnershipRepository } from './repositories/ConversationInstanceOwnershipRepository.js';

// Project & Codebase Management repositories
export { DrizzleProjectRepository } from './repositories/ProjectRepository.js';
export { DrizzleProjectCodebaseRepository } from './repositories/ProjectCodebaseRepository.js';
export { DrizzleProjectConfigRepository } from './repositories/ProjectConfigRepository.js';
export { DrizzleWorktreeRepository } from './repositories/WorktreeRepository.js';
export { DrizzleSystemConfigRepository } from './repositories/SystemConfigRepository.js';

// Workspace Management repositories
export { DrizzleExecutionWorkspaceRepository } from './repositories/ExecutionWorkspaceRepository.js';
export { DrizzleWorkspaceWorktreeRepository } from './repositories/WorkspaceWorktreeRepository.js';
export { DrizzleCheckpointRepository } from './repositories/CheckpointRepository.js';
export { DrizzleReviewRepository } from './repositories/ReviewRepository.js';
export { DrizzlePlanRepository } from './repositories/PlanRepository.js';
export { DrizzleAgentInteractionRepository } from './repositories/AgentInteractionRepository.js';
export { DrizzleWorkspaceArtifactRepository } from './repositories/WorkspaceArtifactRepository.js';
export { DrizzleComputerUseRepository } from './repositories/ComputerUseRepository.js';
export type { ComputerUseGrantRow } from './repositories/ComputerUseRepository.js';

// Widgets & Extensions
export { DrizzleWidgetInstanceRepository } from './repositories/WidgetInstanceRepository.js';
export type { IWidgetInstanceRepository } from './repositories/WidgetInstanceRepository.js';

// W47 / W22 — Durable execution engine storage (migration v36–v38)
export { RegisterRepository } from './repositories/RegisterRepository.js';
export type { RegisterEntry } from './repositories/RegisterRepository.js';
export { EntryRepository } from './repositories/EntryRepository.js';
export type { EntryRecord, EntryKind, EntryScope, ArtifactRecord } from './repositories/EntryRepository.js';



export type AppDatabase = ReturnType<typeof createSqliteDB>;

// ── Database driver seam (DB-01) ──
// SQLite is the only wired driver today, but every call site goes through this
// one config switch so adding libsql/Postgres later is a driver change, not a
// code change. See PORTABILITY.md for the (small, isolated) SQLite-only SQL
// that must be addressed when a non-SQLite driver is wired.

export type DatabaseDriver = 'sqlite' | 'libsql' | 'postgres';

export interface DatabaseConfig {
  driver: DatabaseDriver;
  /** sqlite: file path (or ':memory:'); libsql/postgres: connection URL. */
  url: string;
}

/**
 * Normalize a database input into a {@link DatabaseConfig}. Accepts a plain
 * string for backward-compat + ergonomics, inferring the driver from the URL
 * scheme:
 *   - `postgres://…` / `postgresql://…` → `{ driver: 'postgres' }`
 *   - `libsql://…`                      → `{ driver: 'libsql' }`
 *   - anything else (a file path / ':memory:') → `{ driver: 'sqlite' }`
 *
 * This is the single seam: callers pass a string today; switching providers
 * later is a config change, not a code change.
 */
export function resolveDatabaseConfig(input: string | DatabaseConfig): DatabaseConfig {
  if (typeof input !== 'string') return input;
  const lower = input.toLowerCase();
  if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) {
    return { driver: 'postgres', url: input };
  }
  if (lower.startsWith('libsql://')) {
    return { driver: 'libsql', url: input };
  }
  return { driver: 'sqlite', url: input };
}

/**
 * Default deadline for a transaction. Past this the transaction is rolled
 * back so a runaway `fn` cannot indefinitely hold the SQLite write lock.
 * Tune via `DB_TRANSACTION_TIMEOUT_MS` env var.
 */
const DEFAULT_TX_TIMEOUT_MS = 10_000;

/**
 * Per-database serialization queue for `withTransaction`. better-sqlite3
 * exposes a single connection, so two concurrent `BEGIN`s collide with
 * "cannot start a transaction within a transaction". Every caller queues
 * behind the previous tail here, guaranteeing at most one open transaction
 * per DB handle at a time. Non-transactional reads/writes are unaffected.
 */
const txQueues = new WeakMap<AppDatabase, Promise<unknown>>();

/**
 * Thrown when a transaction exceeds its deadline.
 *
 * A distinct type because the caller's correct response differs from an
 * ordinary failure: the work may be partially applied outside the transaction,
 * so retrying blindly can double-write.
 */
export class TransactionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `withTransaction: fn exceeded ${timeoutMs}ms deadline and was rolled back. ` +
        'Do not await network or filesystem I/O inside a transaction.',
    );
    this.name = 'TransactionTimeoutError';
  }
}

/** True when the handle currently has an open transaction or savepoint. */
export function isInTransaction(db: AppDatabase): boolean {
  return (db as unknown as { session: { client: Database.Database } }).session.client.inTransaction;
}

/**
 * Run `fn` inside a SQLite transaction. All DB writes `fn` performs are
 * committed atomically on success and rolled back on any throw.
 *
 * **Important constraint.** better-sqlite3 is synchronous, but Drizzle's
 * API is promise-returning. `fn` may be async, but anything it awaits must
 * only be DB work on the same `db` handle. Do NOT await network or
 * filesystem I/O inside — the transaction stays open until the promise
 * resolves, holding the SQLite write lock against every other writer.
 *
 * To backstop the "oops I awaited a fetch" footgun, the wrapper enforces
 * an overall deadline (default 10 s, override via `DB_TRANSACTION_TIMEOUT_MS`).
 * If `fn` hasn't resolved in time, the transaction is rolled back and the
 * caller sees a `TransactionTimeoutError`. `fn` itself is not aborted — no
 * AbortSignal is plumbed through most call sites today — so see P1-5 below for
 * what the queue does about that.
 *
 * Concurrent callers are serialized behind an in-process queue keyed by
 * the `db` handle — nested `BEGIN`s aren't legal on a single sqlite
 * connection.
 */
export async function withTransaction<T>(
  db: AppDatabase,
  fn: () => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  const timeoutMs =
    options?.timeoutMs ??
    (process.env['DB_TRANSACTION_TIMEOUT_MS']
      ? Number(process.env['DB_TRANSACTION_TIMEOUT_MS'])
      : DEFAULT_TX_TIMEOUT_MS);

  /**
   * Resolves when `fn` has genuinely settled, whether or not we timed out.
   *
   * P1-5 — this is the whole fix. Previously a timeout rejected the caller and
   * released the queue slot immediately, while `fn` kept running and kept
   * issuing statements on the same connection. The next queued transaction then
   * opened its `BEGIN` underneath the zombie, and every statement the zombie
   * still had to run was silently absorbed into a stranger's transaction —
   * committed or rolled back with work it knew nothing about. Holding the slot
   * until `fn` settles costs a slow caller its own latency and nobody else's
   * correctness.
   */
  let settled: Promise<unknown> = Promise.resolve();

  const runTx = async (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TransactionTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    sqlite.exec('BEGIN');
    try {
      const work = fn();
      settled = work.catch(() => undefined);
      const result = await Promise.race([work, timeoutPromise]);
      sqlite.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      // Deliberately NOT awaiting `settled` here. The caller learns about the
      // timeout immediately — making it wait for the very function that already
      // blew its deadline would turn a bounded failure into an unbounded one.
      // It is the QUEUE that must wait, and it does: the tail below chains on
      // `settled`, so the next transaction cannot begin underneath the zombie.
      // Statements the zombie still issues auto-commit individually, which is
      // bad but bounded, and far better than landing in a stranger's
      // transaction.
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // Chain onto any in-flight transaction on the same handle. We keep the
  // queue by mapping the current tail to the next; failures don't poison
  // the chain (the `.catch(() => {})` swallows so callers still get their
  // real error via the returned promise).
  const prev = txQueues.get(db) ?? Promise.resolve();
  const next = prev.then(runTx, runTx);
  txQueues.set(
    db,
    next.then(
      () => settled,
      () => settled,
    ).catch(() => {}),
  );
  return next;
}

/**
 * P0-1 — better-sqlite3 rebuilds the full SQL text with every parameter
 * inlined before it can call `verbose`. At ~12.8 statements per streamed
 * token that was 1k-4k transient allocations per token feeding metrics that
 * are discarded unless OTel is on. The callback is not passed at all when
 * telemetry is off, so the driver skips the expansion entirely.
 */
function buildVerboseHook(): ((message?: unknown) => void) | undefined {
  if (process.env['OTEL_ENABLED'] !== 'true') return undefined;
  return (message?: unknown) => {
    const sql = typeof message === 'string' ? message : '';
    const start = performance.now();
    // The verbose callback fires BEFORE execution, so we record counts only.
    // Operation type is inferred from the first SQL keyword.
    const op = sql.trimStart().split(/\s/)[0]?.toUpperCase() ?? 'UNKNOWN';
    dbQueryCounter.add(1, { operation: op });
    // Use queueMicrotask so duration metric fires after the sync query completes.
    queueMicrotask(() => {
      dbQueryDuration.record(performance.now() - start, { operation: op });
    });
  };
}

/**
 * Bytes of the database file to memory-map. P1-6 — `mmap_size` defaults to 0,
 * so every page read is a `pread` syscall. 256 MB covers the hot index pages
 * of a multi-gigabyte file without reserving the whole thing.
 */
const DEFAULT_MMAP_BYTES = 256 * 1024 * 1024;

/** Construct the better-sqlite3-backed Drizzle instance (the only wired driver). */
function createSqliteDB(dbPath: string) {
  const verbose = buildVerboseHook();
  const sqlite = new Database(dbPath, verbose ? { verbose } : {});
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const mmapBytes = Number(process.env['DB_MMAP_BYTES'] ?? DEFAULT_MMAP_BYTES);
  if (Number.isFinite(mmapBytes) && mmapBytes > 0) {
    sqlite.pragma(`mmap_size = ${Math.floor(mmapBytes)}`);
  }
  return drizzle(sqlite, { schema });
}

/**
 * Create the application database handle. Accepts a SQLite file path (string,
 * the default + back-compat form) or an explicit {@link DatabaseConfig}.
 *
 * Only the `sqlite` driver is wired today; `libsql` / `postgres` are recognized
 * by the seam and throw an actionable error so the door stays open without a
 * dependency or a rewrite. The return type stays the SQLite Drizzle instance
 * (`AppDatabase`); when another driver is wired it becomes a union.
 */
export function createDB(input: string | DatabaseConfig): AppDatabase {
  const config = resolveDatabaseConfig(input);
  switch (config.driver) {
    case 'sqlite':
      return createSqliteDB(config.url);
    case 'libsql':
    case 'postgres':
      throw new Error(
        `Database driver "${config.driver}" is recognized but not yet wired. ` +
        `GeneratorAI ships with SQLite today; the config seam is in place so a ` +
        `${config.driver} adapter can be added without touching call sites. ` +
        `Use a SQLite file path (or driver:'sqlite') for now. See packages/db/PORTABILITY.md.`,
      );
    default: {
      // Exhaustiveness guard — a new DatabaseDriver value must be handled here.
      const _exhaustive: never = config.driver;
      throw new Error(`Unknown database driver: ${String(_exhaustive)}`);
    }
  }
}

/** Close the underlying SQLite database connection */
export function closeDB(db: AppDatabase): void {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  sqlite.close();
}

export { migrateDB } from './migrations/index.js';

// ── Repository Factory ──
// Instantiate all repositories from a single DB handle.
// Used by the SDK facade to collapse 25+ constructor calls into one.
import { DrizzleSessionRepository } from './repositories/SessionRepository.js';
import { DrizzleSequenceAllocator } from './repositories/SequenceAllocator.js';
import { DrizzleSessionAllocationRepository } from './repositories/SessionAllocationRepository.js';
import { DrizzleStreamCursorRepository } from './repositories/StreamCursorRepository.js';
import { DrizzleWorkflowRepository } from './repositories/WorkflowRepository.js';
import { DrizzleEventRepository } from './repositories/EventRepository.js';
import { DrizzleChatMessageRepository } from './repositories/ChatMessageRepository.js';
import { DrizzleArtifactRepository } from './repositories/ArtifactRepository.js';
import { DrizzleWebhookRepository } from './repositories/WebhookRepository.js';
import { DrizzleChatRepository } from './repositories/ChatRepository.js';
import { DrizzleAgentRepository } from './repositories/AgentRepository.js';
import { DrizzleWorkflowDefinitionRepository } from './repositories/WorkflowDefinitionRepository.js';
import { DrizzleStageDefinitionRepository } from './repositories/StageDefinitionRepository.js';
import { DrizzleStageEdgeRepository } from './repositories/StageEdgeRepository.js';
import { DrizzleWorkflowRunRepository } from './repositories/WorkflowRunRepository.js';
import { DrizzleStageRunRepository } from './repositories/StageRunRepository.js';
import { DrizzleAutomationRepository } from './repositories/AutomationRepository.js';
import { DrizzleAutomationExecutionRepository } from './repositories/AutomationExecutionRepository.js';
import { DrizzleIdempotencyKeyRepository } from './repositories/IdempotencyKeyRepository.js';
import { DrizzleProjectRepository } from './repositories/ProjectRepository.js';
import { DrizzleProjectCodebaseRepository } from './repositories/ProjectCodebaseRepository.js';
import { DrizzleProjectConfigRepository } from './repositories/ProjectConfigRepository.js';
import { DrizzleWorktreeRepository } from './repositories/WorktreeRepository.js';
import { DrizzleSystemConfigRepository } from './repositories/SystemConfigRepository.js';
import { DrizzleExecutionWorkspaceRepository } from './repositories/ExecutionWorkspaceRepository.js';
import { DrizzleWorkspaceWorktreeRepository } from './repositories/WorkspaceWorktreeRepository.js';
import { DrizzleWorkspaceArtifactRepository } from './repositories/WorkspaceArtifactRepository.js';
import { DrizzleCheckpointRepository } from './repositories/CheckpointRepository.js';
import { DrizzleReviewRepository } from './repositories/ReviewRepository.js';
import { DrizzlePlanRepository } from './repositories/PlanRepository.js';
import { DrizzleAgentInteractionRepository } from './repositories/AgentInteractionRepository.js';

export function createAllRepositories(db: AppDatabase) {
  return {
    sessionRepo: new DrizzleSessionRepository(db),
    workflowRepo: new DrizzleWorkflowRepository(db),
    eventRepo: new DrizzleEventRepository(db),
    chatMessageRepo: new DrizzleChatMessageRepository(db),
    artifactRepo: new DrizzleArtifactRepository(db),
    webhookRepo: new DrizzleWebhookRepository(db),
    chatEntityRepo: new DrizzleChatRepository(db),
    agentRepo: new DrizzleAgentRepository(db),
    workflowDefinitionRepo: new DrizzleWorkflowDefinitionRepository(db),
    stageDefinitionRepo: new DrizzleStageDefinitionRepository(db),
    stageEdgeRepo: new DrizzleStageEdgeRepository(db),
    workflowRunRepo: new DrizzleWorkflowRunRepository(db),
    stageRunRepo: new DrizzleStageRunRepository(db),
    automationRepo: new DrizzleAutomationRepository(db),
    automationExecutionRepo: new DrizzleAutomationExecutionRepository(db),
    idempotencyKeyRepo: new DrizzleIdempotencyKeyRepository(db),
    projectRepo: new DrizzleProjectRepository(db),
    projectCodebaseRepo: new DrizzleProjectCodebaseRepository(db),
    projectConfigRepo: new DrizzleProjectConfigRepository(db),
    worktreeRepo: new DrizzleWorktreeRepository(db),
    systemConfigRepo: new DrizzleSystemConfigRepository(db),
    executionWorkspaceRepo: new DrizzleExecutionWorkspaceRepository(db),
    workspaceWorktreeRepo: new DrizzleWorkspaceWorktreeRepository(db),
    workspaceArtifactRepo: new DrizzleWorkspaceArtifactRepository(db),
    checkpointRepo: new DrizzleCheckpointRepository(db),
    reviewRepo: new DrizzleReviewRepository(db),
    planRepo: new DrizzlePlanRepository(db),
    agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    sequenceAllocator: new DrizzleSequenceAllocator(db),
    sessionAllocationRepo: new DrizzleSessionAllocationRepository(db),
    streamCursorRepo: new DrizzleStreamCursorRepository(db),
  };
}

export type AllRepositories = ReturnType<typeof createAllRepositories>;
