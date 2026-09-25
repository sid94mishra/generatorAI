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
export { safeJsonColumn, setInvalidJsonColumnReporter } from './utils/safeJsonColumn.js';
export type { InvalidJsonColumnReporter } from './utils/safeJsonColumn.js';
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
export { DrizzleEventRepository } from './repositories/EventRepository.js';
export { DrizzleChatMessageRepository } from './repositories/ChatMessageRepository.js';
export { DrizzleArtifactRepository } from './repositories/ArtifactRepository.js';
export { DrizzleWorkspaceFileReviewRepository } from './repositories/WorkspaceFileReviewRepository.js';

// v2 repositories
export { DrizzleChatRepository } from './repositories/ChatRepository.js';
export { DrizzleAgentRepository } from './repositories/AgentRepository.js';
export { SqliteWorkflowDefinitionStore } from './repositories/WorkflowDefinitionStore.js';
export { DrizzleWorkflowRunRepository } from './repositories/WorkflowRunRepository.js';
export { DrizzleStageRunRepository } from './repositories/StageRunRepository.js';

// Engine v2 (P03 WP-3.1): CAS, run-side repositories, RunStore
export { IllegalTransitionError } from './repositories/engineCas.js';
export {
  StageAttemptRepository,
  RunSessionRepository,
  WorkflowTimerRepository,
  WorkflowOutboxRepository,
  SchedulerJournalRepository,
  type StageAttemptRow,
  type RunSessionRow,
  type WorkflowTimerRow,
  type OutboxRow,
  type JournalRow,
} from './repositories/EngineRepositories.js';
export { RunStore, jitteredDelay } from './repositories/RunStore.js';
// Engine v2 (P03 WP-3.5/3.6): turn journal, single-engine lock, scans
export { StageTurnJournal, EngineLockRepository, EngineQueries, createEngineStores } from './repositories/EngineStores.js';

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
  SqliteDeviceScopeRequestRepository,
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
export { DrizzleWorkspaceMountRepository } from './repositories/WorkspaceMountRepository.js';
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

/** True when the handle currently has an open transaction or savepoint. */
export function isInTransaction(db: AppDatabase): boolean {
  return (db as unknown as { session: { client: Database.Database } }).session.client.inTransaction;
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
  const slowMs = Number(process.env['GENERATORAI_SQL_SLOW_MS'] ?? '');
  if (Number.isFinite(slowMs) && slowMs > 0) instrumentSlowStatements(sqlite, slowMs);
  return drizzle(sqlite, { schema });
}

// ── Slow-statement tripwire ─────────────────────────────────────────────────
//
// better-sqlite3 runs on the event loop, so one slow statement is one stall
// for every request. `/api/health` was observed at >10 s under chat load with
// nothing to say which statement. With `GENERATORAI_SQL_SLOW_MS=<n>` every
// prepared statement's `run`/`get`/`all` is timed; anything over the threshold
// is logged once with its SQL and kept in a bounded top list that the health
// route exposes as `db.slowStatements`. Off by default: the wrapper costs a
// `performance.now()` pair per statement.

export interface SlowStatementStat {
  sql: string;
  count: number;
  maxMs: number;
  totalMs: number;
  lastMs: number;
}

const slowStatements = new Map<string, SlowStatementStat>();
const MAX_TRACKED_SLOW_STATEMENTS = 50;

/** Slowest statements seen since boot (empty unless `GENERATORAI_SQL_SLOW_MS` is set). */
export function getSlowStatementStats(limit = 10): SlowStatementStat[] {
  return [...slowStatements.values()].sort((a, b) => b.maxMs - a.maxMs).slice(0, limit);
}

function recordSlow(sql: string, ms: number, thresholdMs: number): void {
  const key = sql.replace(/\s+/g, ' ').trim().slice(0, 240);
  const existing = slowStatements.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += ms;
    existing.lastMs = ms;
    if (ms > existing.maxMs) existing.maxMs = ms;
    return;
  }
  if (slowStatements.size >= MAX_TRACKED_SLOW_STATEMENTS) {
    // Evict the least severe so a new, worse statement is never lost.
    let victim: string | undefined;
    let victimMax = Number.POSITIVE_INFINITY;
    for (const [k, v] of slowStatements) if (v.maxMs < victimMax) { victimMax = v.maxMs; victim = k; }
    if (victim && victimMax < ms) slowStatements.delete(victim); else return;
  }
  slowStatements.set(key, { sql: key, count: 1, maxMs: ms, totalMs: ms, lastMs: ms });
  console.warn(`[db] slow statement ${ms.toFixed(1)}ms (threshold ${thresholdMs}ms): ${key}`);
}

function instrumentSlowStatements(sqlite: Database.Database, thresholdMs: number): void {
  const originalPrepare = sqlite.prepare.bind(sqlite);
  const timed = <T extends (...args: unknown[]) => unknown>(sql: string, fn: T): T =>
    ((...args: unknown[]) => {
      const start = performance.now();
      try {
        return fn(...args);
      } finally {
        const ms = performance.now() - start;
        if (ms >= thresholdMs) recordSlow(sql, ms, thresholdMs);
      }
    }) as T;
  (sqlite as { prepare: typeof sqlite.prepare }).prepare = ((sql: string) => {
    const stmt = originalPrepare(sql);
    stmt.run = timed(sql, stmt.run.bind(stmt));
    stmt.get = timed(sql, stmt.get.bind(stmt));
    stmt.all = timed(sql, stmt.all.bind(stmt));
    return stmt;
  }) as typeof sqlite.prepare;
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
import { DrizzleEventRepository } from './repositories/EventRepository.js';
import { DrizzleChatMessageRepository } from './repositories/ChatMessageRepository.js';
import { DrizzleArtifactRepository } from './repositories/ArtifactRepository.js';
import { DrizzleChatRepository } from './repositories/ChatRepository.js';
import { DrizzleAgentRepository } from './repositories/AgentRepository.js';
import { SqliteWorkflowDefinitionStore } from './repositories/WorkflowDefinitionStore.js';
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
import { DrizzleWorkspaceMountRepository } from './repositories/WorkspaceMountRepository.js';
import { DrizzleWorkspaceArtifactRepository } from './repositories/WorkspaceArtifactRepository.js';
import { DrizzleCheckpointRepository } from './repositories/CheckpointRepository.js';
import { DrizzleReviewRepository } from './repositories/ReviewRepository.js';
import { DrizzlePlanRepository } from './repositories/PlanRepository.js';
import { DrizzleAgentInteractionRepository } from './repositories/AgentInteractionRepository.js';
import { RegisterRepository } from './repositories/RegisterRepository.js';
import { EntryRepository } from './repositories/EntryRepository.js';

export function createAllRepositories(db: AppDatabase) {
  return {
    sessionRepo: new DrizzleSessionRepository(db),
    eventRepo: new DrizzleEventRepository(db),
    chatMessageRepo: new DrizzleChatMessageRepository(db),
    artifactRepo: new DrizzleArtifactRepository(db),
    chatEntityRepo: new DrizzleChatRepository(db),
    agentRepo: new DrizzleAgentRepository(db),
    workflowDefinitionStore: new SqliteWorkflowDefinitionStore(db),
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
    workspaceMountRepo: new DrizzleWorkspaceMountRepository(db),
    workspaceArtifactRepo: new DrizzleWorkspaceArtifactRepository(db),
    checkpointRepo: new DrizzleCheckpointRepository(db),
    reviewRepo: new DrizzleReviewRepository(db),
    planRepo: new DrizzlePlanRepository(db),
    agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    sequenceAllocator: new DrizzleSequenceAllocator(db),
    sessionAllocationRepo: new DrizzleSessionAllocationRepository(db),
    streamCursorRepo: new DrizzleStreamCursorRepository(db),
    // W22 / W47 — durable execution engine storage.
    registerRepo: new RegisterRepository(db),
    entryRepo: new EntryRepository(db),
  };
}

export type AllRepositories = ReturnType<typeof createAllRepositories>;
