// ────────────────────────────────────────────────────────────────
// The rest of the v2 engine's stores (P03 WP-3.5/3.6): the executor's turn
// journal, the single-engine lock and the supervisor's scans, plus
// `createEngineStores(db)`, which builds every port `@generatorai/core`'s
// engine needs over one database.
//
// The turn journal keeps one `registers` row per operation (scope
// `stage_run`, key `turn/<opId>`). A turn is settled only when its row says
// so, and the settlement is written in the SAME transaction as the turn's
// assistant message (`complete = 1`), so "settled" always has its message
// and a message never makes a turn settled (RV-10).
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import type {
  EngineLockRecord,
  EngineStores,
  ExpiredLease,
  IEngineLockStore,
  IEngineQueries,
  ITurnJournal,
  JournalMessage,
  SettledTurn,
  TurnJournalEntry,
  TurnReplayPolicy,
  TurnRole,
} from '@generatorai/core';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';
import { claimRunOwnership, getInstanceRow, getRunRow, markStageProgress, renewRunOwnership, renewStageLease, runTransition, stageTransition } from './engineCas.js';
import {
  RunSessionRepository,
  SchedulerJournalRepository,
  StageAttemptRepository,
  WorkflowOutboxRepository,
  WorkflowTimerRepository,
} from './EngineRepositories.js';
import { RunStore } from './RunStore.js';

type Row = Record<string, unknown>;

const handle = (db: AppDatabase | BetterSqlite3.Database): BetterSqlite3.Database =>
  'prepare' in db ? (db as BetterSqlite3.Database) : sqliteHandle(db as AppDatabase);

const TURN_KEY = 'turn/';

// ── Turn journal ─────────────────────────────────────────────────

export class StageTurnJournal implements ITurnJournal {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase | BetterSqlite3.Database) {
    this.sqlite = handle(db);
  }

  private write(stageRunId: string, opId: string, entry: TurnJournalEntry, now: number): void {
    this.sqlite
      .prepare(
        `INSERT INTO registers (scope, scope_id, key, value, version, written_at) VALUES ('stage_run', ?, ?, ?, 0, ?)
         ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = excluded.value, version = version + 1, written_at = excluded.written_at`,
      )
      .run(stageRunId, TURN_KEY + opId, JSON.stringify(entry), now);
  }

  private insertMessage(m: JournalMessage, now: number): void {
    this.sqlite
      .prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, metadata, complete, turn_role, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      // `timestamp` is epoch seconds (drizzle `mode: 'timestamp'`), rowid breaks ties.
      .run(m.id, m.sessionId, m.role, m.content, JSON.stringify(m.metadata), m.complete ? 1 : 0, m.turnRole, Math.floor(now / 1000));
  }

  get(stageRunId: string, opId: string): TurnJournalEntry | null {
    const r = this.sqlite
      .prepare(`SELECT value FROM registers WHERE scope = 'stage_run' AND scope_id = ? AND key = ?`)
      .get(stageRunId, TURN_KEY + opId) as { value: string } | undefined;
    if (!r) return null;
    try {
      return JSON.parse(r.value) as TurnJournalEntry;
    } catch {
      return null;
    }
  }

  intent(stageRunId: string, opId: string, e: { role: TurnRole; policy: TurnReplayPolicy; now: number; message?: JournalMessage }): void {
    this.sqlite.transaction(() => {
      this.write(stageRunId, opId, { state: 'intent', role: e.role, policy: e.policy, at: e.now }, e.now);
      if (e.message) this.insertMessage(e.message, e.now);
    })();
  }

  settle(stageRunId: string, opId: string, turn: SettledTurn, e: { now: number; message?: JournalMessage }): void {
    this.sqlite.transaction(() => {
      if (e.message) this.insertMessage({ ...e.message, complete: true }, e.now);
      this.write(stageRunId, opId, { state: 'settled', turn, at: e.now }, e.now);
    })();
  }

  recordPartial(message: JournalMessage, now: number): void {
    this.insertMessage({ ...message, complete: false }, now);
  }

  discard(stageRunId: string, opId: string): void {
    this.sqlite.prepare(`DELETE FROM registers WHERE scope = 'stage_run' AND scope_id = ? AND key = ?`).run(stageRunId, TURN_KEY + opId);
  }

  inFlight(stageRunId: string, prefix: string): Array<{ opId: string; role: TurnRole; policy: TurnReplayPolicy }> {
    const full = TURN_KEY + prefix;
    const rows = this.sqlite
      .prepare(`SELECT key, value FROM registers WHERE scope = 'stage_run' AND scope_id = ? AND substr(key, 1, ?) = ? ORDER BY written_at, key`)
      .all(stageRunId, full.length, full) as Array<{ key: string; value: string }>;
    const out: Array<{ opId: string; role: TurnRole; policy: TurnReplayPolicy }> = [];
    for (const r of rows) {
      try {
        const v = JSON.parse(r.value) as TurnJournalEntry;
        if (v.state === 'intent') out.push({ opId: r.key.slice(TURN_KEY.length), role: v.role, policy: v.policy });
      } catch {
        /* a torn row is not a settled turn */
      }
    }
    return out;
  }

  release(stageRunId: string): void {
    this.sqlite.prepare(`DELETE FROM registers WHERE scope = 'stage_run' AND scope_id = ? AND substr(key, 1, ?) = ?`).run(stageRunId, TURN_KEY.length, TURN_KEY);
  }
}

// ── engine_lock ──────────────────────────────────────────────────

export class EngineLockRepository implements IEngineLockStore {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase | BetterSqlite3.Database) {
    this.sqlite = handle(db);
  }

  acquire(ownerId: string, bootId: string, now: number, staleMs: number): boolean {
    return (
      this.sqlite
        .prepare(
          `INSERT INTO engine_lock (id, owner_id, boot_id, heartbeat_at) VALUES (1, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET owner_id = excluded.owner_id, boot_id = excluded.boot_id, heartbeat_at = excluded.heartbeat_at
            WHERE engine_lock.boot_id IS NULL OR engine_lock.heartbeat_at IS NULL
               OR engine_lock.heartbeat_at < ? OR engine_lock.boot_id = excluded.boot_id`,
        )
        .run(ownerId, bootId, now, now - staleMs).changes > 0
    );
  }

  renew(bootId: string, now: number): boolean {
    return this.sqlite.prepare(`UPDATE engine_lock SET heartbeat_at = ? WHERE id = 1 AND boot_id = ?`).run(now, bootId).changes > 0;
  }

  release(bootId: string): void {
    this.sqlite.prepare(`UPDATE engine_lock SET owner_id = NULL, boot_id = NULL, heartbeat_at = NULL WHERE id = 1 AND boot_id = ?`).run(bootId);
  }

  get(): EngineLockRecord | null {
    const r = this.sqlite.prepare(`SELECT owner_id, boot_id, heartbeat_at FROM engine_lock WHERE id = 1`).get() as Row | undefined;
    return r
      ? {
          ownerId: (r['owner_id'] as string | null) ?? null,
          bootId: (r['boot_id'] as string | null) ?? null,
          heartbeatAt: (r['heartbeat_at'] as number | null) ?? null,
        }
      : null;
  }
}

// ── scans ────────────────────────────────────────────────────────

export class EngineQueries implements IEngineQueries {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase | BetterSqlite3.Database) {
    this.sqlite = handle(db);
  }

  listLiveRunIds(): string[] {
    return (
      this.sqlite
        .prepare(`SELECT id FROM workflow_runs WHERE status NOT IN ('created', 'completed', 'failed', 'cancelled') ORDER BY created_at, id`)
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
  }

  listExpiredLeases(ownerId: string, now: number): ExpiredLease[] {
    return (
      this.sqlite
        .prepare(
          `SELECT s.id, s.workflow_run_id, s.lease_owner FROM stage_runs s JOIN workflow_runs r ON r.id = s.workflow_run_id
            WHERE s.status IN ('starting', 'running', 'validating') AND s.lease_expires_at < ? AND r.owner_id = ?
            ORDER BY s.workflow_run_id, s.instance_path`,
        )
        .all(now, ownerId) as Row[]
    ).map((r) => ({
      stageRunId: r['id'] as string,
      workflowRunId: r['workflow_run_id'] as string,
      leaseOwner: (r['lease_owner'] as string | null) ?? null,
    }));
  }
}

/** Every store of the v2 engine over one database (the ports of `@generatorai/core`). */
export function createEngineStores(db: AppDatabase | BetterSqlite3.Database): EngineStores {
  const sqlite = handle(db);
  return {
    runStore: new RunStore(sqlite),
    stages: {
      transition: (id, from, to, opts) => stageTransition(sqlite, id, from, to, opts),
      renewLease: (id, owner, ttlMs, now) => renewStageLease(sqlite, id, owner, ttlMs, now),
      markProgress: (id, owner, at) => markStageProgress(sqlite, id, owner, at),
      getInstance: (id) => getInstanceRow(sqlite, id),
    },
    runs: {
      transition: (id, from, to, opts) => runTransition(sqlite, id, from, to, opts),
      claimOwnership: (id, ownerId, ttlMs, now, opts) => claimRunOwnership(sqlite, id, ownerId, ttlMs, now, opts),
      renewOwnership: (id, ownerId, epoch, ttlMs, now) => renewRunOwnership(sqlite, id, ownerId, epoch, ttlMs, now),
      getRunRow: (id) => getRunRow(sqlite, id),
    },
    attempts: new StageAttemptRepository(sqlite),
    runSessions: new RunSessionRepository(sqlite),
    timers: new WorkflowTimerRepository(sqlite),
    outbox: new WorkflowOutboxRepository(sqlite),
    journal: new SchedulerJournalRepository(sqlite),
    turns: new StageTurnJournal(sqlite),
    lock: new EngineLockRepository(sqlite),
    queries: new EngineQueries(sqlite),
  };
}
