// ────────────────────────────────────────────────────────────────
// The v2 engine's run-side repositories (P03 WP-3.1, G5 §6.2): attempts,
// run sessions, durable timers, the outbox and the scheduler journal.
//
// Synchronous (better-sqlite3) so `RunStore.apply` composes them inside
// one transaction; each also stands alone for the executor, the
// TimerService and the OutboxDispatcher (P03 WP-3.5/3.6). Timestamps are
// epoch milliseconds.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  attemptId,
  type AttemptMode,
  type AttemptStatus,
  type ClassifiedError,
  type IRunEventStore,
  type RunEventDeliveryOutcome,
  type RunEventRecord,
  type TimerKind,
  type Usage,
} from '@generatorai/core';
import { canonicalJson } from '@generatorai/workflow-spec';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';
import { json } from './engineCas.js';

type Row = Record<string, unknown>;

function parse<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  try {
    return JSON.parse(v as string) as T;
  } catch {
    return null;
  }
}

/** Add usage fields (turns, cost, tokens). */
export function addUsage(a: Usage, b: Usage): Usage {
  const out: Usage = { ...a };
  for (const k of ['turns', 'costUsd', 'inputTokens', 'outputTokens'] as const) {
    if (b[k] !== undefined) out[k] = (out[k] ?? 0) + b[k]!;
  }
  return out;
}

abstract class SyncRepository {
  protected readonly sqlite: BetterSqlite3.Database;
  constructor(db: AppDatabase | BetterSqlite3.Database) {
    this.sqlite = 'prepare' in db ? (db as BetterSqlite3.Database) : sqliteHandle(db as AppDatabase);
  }
}

// ── workflow_run_events (P05 §4.3) ───────────────────────────────

export class RunEventRepository extends SyncRepository implements IRunEventStore {
  deliver(e: { runId: string; eventKey: string; idempotencyKey: string; data: unknown; now: number }): { outcome: RunEventDeliveryOutcome; id: string } {
    const data = e.data === undefined ? null : e.data;
    const id = randomUUID();
    const inserted = this.sqlite
      .prepare(
        `INSERT INTO workflow_run_events (id, run_id, event_key, idempotency_key, data, received_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, event_key, idempotency_key) DO NOTHING`,
      )
      .run(id, e.runId, e.eventKey, e.idempotencyKey, JSON.stringify(data), e.now).changes;
    if (inserted > 0) return { outcome: 'inserted', id };
    const existing = this.sqlite
      .prepare(`SELECT id, data FROM workflow_run_events WHERE run_id = ? AND event_key = ? AND idempotency_key = ?`)
      .get(e.runId, e.eventKey, e.idempotencyKey) as Row;
    const same = canonicalJson(parse<unknown>(existing['data']) ?? null) === canonicalJson(data);
    return { outcome: same ? 'replayed' : 'conflict', id: existing['id'] as string };
  }

  listPending(runId: string): RunEventRecord[] {
    return (
      this.sqlite
        .prepare(
          `SELECT * FROM workflow_run_events WHERE run_id = ? AND consumed_by_stage_run_id IS NULL ORDER BY received_at, id`,
        )
        .all(runId) as Row[]
    ).map((r) => ({
      id: r['id'] as string,
      eventKey: r['event_key'] as string,
      idempotencyKey: r['idempotency_key'] as string,
      data: parse<unknown>(r['data']),
      receivedAt: r['received_at'] as number,
    }));
  }

  /** The CAS of `consume_event` (inside `RunStore.apply`'s transaction). */
  consume(runId: string, eventId: string, stageRunId: string): boolean {
    return (
      this.sqlite
        .prepare(`UPDATE workflow_run_events SET consumed_by_stage_run_id = ? WHERE id = ? AND run_id = ? AND consumed_by_stage_run_id IS NULL`)
        .run(stageRunId, eventId, runId).changes > 0
    );
  }
}

// ── stage_attempts ───────────────────────────────────────────────

export interface StageAttemptRow {
  id: string;
  stageRunId: string;
  attemptNo: number;
  mode: AttemptMode;
  epoch: number;
  status: AttemptStatus;
  sessionId: string | null;
  repairCount: number;
  structuredOutput: unknown;
  agentSnapshot: unknown;
  judge: unknown;
  error: string | null;
  errorClass: string | null;
  errorCode: string | null;
  errorDetails: unknown;
  overrides: unknown;
  checkpointBeforeId: string | null;
  usage: Usage;
  startedAt: number;
  endedAt: number | null;
}

function mapAttempt(r: Row): StageAttemptRow {
  return {
    id: r['id'] as string,
    stageRunId: r['stage_run_id'] as string,
    attemptNo: r['attempt_no'] as number,
    mode: r['mode'] as AttemptMode,
    epoch: r['epoch'] as number,
    status: r['status'] as AttemptStatus,
    sessionId: (r['session_id'] as string | null) ?? null,
    repairCount: r['repair_count'] as number,
    structuredOutput: parse(r['structured_output']),
    agentSnapshot: parse(r['agent_snapshot']),
    judge: parse(r['judge']),
    error: (r['error'] as string | null) ?? null,
    errorClass: (r['error_class'] as string | null) ?? null,
    errorCode: (r['error_code'] as string | null) ?? null,
    errorDetails: parse(r['error_details']),
    overrides: parse(r['overrides']),
    checkpointBeforeId: (r['checkpoint_before_id'] as string | null) ?? null,
    usage: parse<Usage>(r['usage']) ?? {},
    startedAt: r['started_at'] as number,
    endedAt: (r['ended_at'] as number | null) ?? null,
  };
}

export class StageAttemptRepository extends SyncRepository {
  /** Insert a live (`running`) attempt; its id is deterministic. Returns false when it already exists. */
  create(a: { stageRunId: string; attemptNo: number; mode: AttemptMode; epoch: number; overrides?: unknown; now: number }): boolean {
    return (
      this.sqlite
        .prepare(
          `INSERT INTO stage_attempts (id, stage_run_id, attempt_no, mode, epoch, status, overrides, started_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?) ON CONFLICT DO NOTHING`,
        )
        .run(attemptId(a.stageRunId, a.attemptNo), a.stageRunId, a.attemptNo, a.mode, a.epoch, json(a.overrides), a.now).changes > 0
    );
  }

  /** CAS `running → status`. False when the attempt is not live. */
  settle(stageRunId: string, attemptNo: number, status: Exclude<AttemptStatus, 'running'>, opts: { error?: ClassifiedError; now: number }): boolean {
    const e = opts.error;
    return (
      this.sqlite
        .prepare(
          `UPDATE stage_attempts SET status = ?, ended_at = ?, error = ?, error_class = ?, error_code = ?, error_details = ?
            WHERE stage_run_id = ? AND attempt_no = ? AND status = 'running'`,
        )
        .run(status, opts.now, e?.message ?? null, e?.class ?? null, e?.code ?? null, json(e?.details), stageRunId, attemptNo).changes > 0
    );
  }

  /** Columns the executor records while the attempt runs. */
  update(
    stageRunId: string,
    attemptNo: number,
    patch: { sessionId?: string | null; structuredOutput?: unknown; agentSnapshot?: unknown; judge?: unknown; checkpointBeforeId?: string | null },
  ): boolean {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.sessionId !== undefined) {
      sets.push('session_id = ?');
      args.push(patch.sessionId);
    }
    if (patch.structuredOutput !== undefined) {
      sets.push('structured_output = ?');
      args.push(json(patch.structuredOutput));
    }
    if (patch.agentSnapshot !== undefined) {
      sets.push('agent_snapshot = ?');
      args.push(json(patch.agentSnapshot));
    }
    if (patch.judge !== undefined) {
      sets.push('judge = ?');
      args.push(json(patch.judge));
    }
    if (patch.checkpointBeforeId !== undefined) {
      sets.push('checkpoint_before_id = ?');
      args.push(patch.checkpointBeforeId);
    }
    if (sets.length === 0) return false;
    return (
      this.sqlite.prepare(`UPDATE stage_attempts SET ${sets.join(', ')} WHERE stage_run_id = ? AND attempt_no = ?`).run(...args, stageRunId, attemptNo)
        .changes > 0
    );
  }

  /** Count one repair turn of a live attempt; returns the new count, or null when not live. */
  incrementRepair(stageRunId: string, attemptNo: number): number | null {
    const r = this.sqlite
      .prepare(
        `UPDATE stage_attempts SET repair_count = repair_count + 1
          WHERE stage_run_id = ? AND attempt_no = ? AND status = 'running' RETURNING repair_count`,
      )
      .get(stageRunId, attemptNo) as { repair_count: number } | undefined;
    return r ? r.repair_count : null;
  }

  addUsage(stageRunId: string, attemptNo: number, usage: Usage): void {
    const r = this.sqlite.prepare(`SELECT usage FROM stage_attempts WHERE stage_run_id = ? AND attempt_no = ?`).get(stageRunId, attemptNo) as Row | undefined;
    if (!r) return;
    this.sqlite
      .prepare(`UPDATE stage_attempts SET usage = ? WHERE stage_run_id = ? AND attempt_no = ?`)
      .run(JSON.stringify(addUsage(parse<Usage>(r['usage']) ?? {}, usage)), stageRunId, attemptNo);
  }

  get(stageRunId: string, attemptNo: number): StageAttemptRow | null {
    const r = this.sqlite.prepare(`SELECT * FROM stage_attempts WHERE stage_run_id = ? AND attempt_no = ?`).get(stageRunId, attemptNo) as Row | undefined;
    return r ? mapAttempt(r) : null;
  }

  listByStageRun(stageRunId: string): StageAttemptRow[] {
    return (this.sqlite.prepare(`SELECT * FROM stage_attempts WHERE stage_run_id = ? ORDER BY attempt_no`).all(stageRunId) as Row[]).map(mapAttempt);
  }

  /** Live attempts of a run (recovery resolves them, G5 §3.10). */
  listLiveByRun(workflowRunId: string): StageAttemptRow[] {
    return (
      this.sqlite
        .prepare(
          `SELECT a.* FROM stage_attempts a JOIN stage_runs s ON s.id = a.stage_run_id
            WHERE s.workflow_run_id = ? AND a.status = 'running' ORDER BY s.instance_path, a.attempt_no`,
        )
        .all(workflowRunId) as Row[]
    ).map(mapAttempt);
  }
}

// ── run_sessions ─────────────────────────────────────────────────

export interface RunSessionRow {
  id: string;
  workflowRunId: string;
  sessionKey: string;
  sessionId: string;
  ownerScopeId: string | null;
  configHash: string;
  status: 'active' | 'released';
  createdAt: number;
  releasedAt: number | null;
}

function mapRunSession(r: Row): RunSessionRow {
  return {
    id: r['id'] as string,
    workflowRunId: r['workflow_run_id'] as string,
    sessionKey: r['session_key'] as string,
    sessionId: r['session_id'] as string,
    ownerScopeId: (r['owner_scope_id'] as string | null) ?? null,
    configHash: r['config_hash'] as string,
    status: r['status'] as 'active' | 'released',
    createdAt: r['created_at'] as number,
    releasedAt: (r['released_at'] as number | null) ?? null,
  };
}

export class RunSessionRepository extends SyncRepository {
  /** Bind a session key of the run to a conversation (a rebind replaces it and re-activates the key). */
  upsert(s: { id: string; workflowRunId: string; sessionKey: string; sessionId: string; ownerScopeId?: string | null; configHash: string; now: number }): RunSessionRow {
    const r = this.sqlite
      .prepare(
        `INSERT INTO run_sessions (id, workflow_run_id, session_key, session_id, owner_scope_id, config_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
         ON CONFLICT (workflow_run_id, session_key) DO UPDATE SET
           session_id = excluded.session_id, owner_scope_id = excluded.owner_scope_id,
           config_hash = excluded.config_hash, status = 'active', released_at = NULL
         RETURNING *`,
      )
      .get(s.id, s.workflowRunId, s.sessionKey, s.sessionId, s.ownerScopeId ?? null, s.configHash, s.now) as Row;
    return mapRunSession(r);
  }

  get(workflowRunId: string, sessionKey: string): RunSessionRow | null {
    const r = this.sqlite.prepare(`SELECT * FROM run_sessions WHERE workflow_run_id = ? AND session_key = ?`).get(workflowRunId, sessionKey) as Row | undefined;
    return r ? mapRunSession(r) : null;
  }

  release(workflowRunId: string, sessionKey: string, now: number): boolean {
    return (
      this.sqlite
        .prepare(`UPDATE run_sessions SET status = 'released', released_at = ? WHERE workflow_run_id = ? AND session_key = ? AND status = 'active'`)
        .run(now, workflowRunId, sessionKey).changes > 0
    );
  }

  listActive(workflowRunId: string): RunSessionRow[] {
    return (
      this.sqlite.prepare(`SELECT * FROM run_sessions WHERE workflow_run_id = ? AND status = 'active' ORDER BY session_key`).all(workflowRunId) as Row[]
    ).map(mapRunSession);
  }
}

// ── workflow_timers ──────────────────────────────────────────────

export interface WorkflowTimerRow {
  id: string;
  workflowRunId: string;
  stageRunId: string | null;
  kind: TimerKind;
  fireAt: number;
  firedAt: number | null;
  cancelledAt: number | null;
  payload: unknown;
}

function mapTimer(r: Row): WorkflowTimerRow {
  return {
    id: r['id'] as string,
    workflowRunId: r['workflow_run_id'] as string,
    stageRunId: (r['stage_run_id'] as string | null) ?? null,
    kind: r['kind'] as TimerKind,
    fireAt: r['fire_at'] as number,
    firedAt: (r['fired_at'] as number | null) ?? null,
    cancelledAt: (r['cancelled_at'] as number | null) ?? null,
    payload: parse(r['payload']),
  };
}

export class WorkflowTimerRepository extends SyncRepository {
  /** Arm a timer; a live timer of the same run, instance and kind is cancelled first. */
  arm(t: { id: string; workflowRunId: string; stageRunId: string | null; kind: TimerKind; fireAt: number; payload?: unknown; now: number }): void {
    this.cancel({ workflowRunId: t.workflowRunId, kind: t.kind, stageRunId: t.stageRunId }, t.now);
    this.sqlite
      .prepare(`INSERT INTO workflow_timers (id, workflow_run_id, stage_run_id, kind, fire_at, payload) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(t.id, t.workflowRunId, t.stageRunId, t.kind, t.fireAt, json(t.payload));
  }

  /**
   * Cancel live timers of a run: one kind or all; `stageRunId` null means
   * run-level timers, undefined means any instance and the run.
   */
  cancel(f: { workflowRunId: string; kind?: TimerKind; stageRunId?: string | null }, now: number): number {
    const where = ['workflow_run_id = ?', 'fired_at IS NULL', 'cancelled_at IS NULL'];
    const args: unknown[] = [f.workflowRunId];
    if (f.kind !== undefined) {
      where.push('kind = ?');
      args.push(f.kind);
    }
    if (f.stageRunId === null) where.push('stage_run_id IS NULL');
    else if (f.stageRunId !== undefined) {
      where.push('stage_run_id = ?');
      args.push(f.stageRunId);
    }
    return this.sqlite.prepare(`UPDATE workflow_timers SET cancelled_at = ? WHERE ${where.join(' AND ')}`).run(now, ...args).changes;
  }

  /** CAS: mark fired once. Only the caller that gets true posts `timer_fired`. */
  fire(id: string, now: number): boolean {
    return this.sqlite.prepare(`UPDATE workflow_timers SET fired_at = ? WHERE id = ? AND fired_at IS NULL AND cancelled_at IS NULL`).run(now, id).changes > 0;
  }

  get(id: string): WorkflowTimerRow | null {
    const r = this.sqlite.prepare(`SELECT * FROM workflow_timers WHERE id = ?`).get(id) as Row | undefined;
    return r ? mapTimer(r) : null;
  }

  /** Live timers, due first; all runs, or one run. */
  listLive(workflowRunId?: string): WorkflowTimerRow[] {
    const sql = `SELECT * FROM workflow_timers WHERE fired_at IS NULL AND cancelled_at IS NULL ${workflowRunId ? 'AND workflow_run_id = ?' : ''} ORDER BY fire_at, id`;
    return (this.sqlite.prepare(sql).all(...(workflowRunId ? [workflowRunId] : [])) as Row[]).map(mapTimer);
  }

  listDue(now: number, limit = 100): WorkflowTimerRow[] {
    return (
      this.sqlite
        .prepare(`SELECT * FROM workflow_timers WHERE fired_at IS NULL AND cancelled_at IS NULL AND fire_at <= ? ORDER BY fire_at, id LIMIT ?`)
        .all(now, limit) as Row[]
    ).map(mapTimer);
  }
}

// ── workflow_outbox ──────────────────────────────────────────────

export interface OutboxRow {
  workflowRunId: string;
  runSeq: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
  dispatchedAt: number | null;
}

function mapOutbox(r: Row): OutboxRow {
  return {
    workflowRunId: r['workflow_run_id'] as string,
    runSeq: r['run_seq'] as number,
    kind: r['kind'] as string,
    payload: parse<Record<string, unknown>>(r['payload']) ?? {},
    createdAt: r['created_at'] as number,
    dispatchedAt: (r['dispatched_at'] as number | null) ?? null,
  };
}

export class WorkflowOutboxRepository extends SyncRepository {
  /** Insert at an explicit sequence (RunStore allocates it from `workflow_runs.run_seq`). */
  insert(workflowRunId: string, runSeq: number, kind: string, payload: Record<string, unknown>, now: number): void {
    this.sqlite
      .prepare(`INSERT INTO workflow_outbox (workflow_run_id, run_seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(workflowRunId, runSeq, kind, JSON.stringify(payload), now);
  }

  /** Undispatched rows in `(run, run_seq)` order. */
  listPending(limit = 500, workflowRunId?: string): OutboxRow[] {
    const sql = `SELECT * FROM workflow_outbox WHERE dispatched_at IS NULL ${workflowRunId ? 'AND workflow_run_id = ?' : ''} ORDER BY workflow_run_id, run_seq LIMIT ?`;
    return (this.sqlite.prepare(sql).all(...(workflowRunId ? [workflowRunId, limit] : [limit])) as Row[]).map(mapOutbox);
  }

  /** Idempotent by `(run, run_seq)`: a redelivery after a crash marks nothing twice. */
  markDispatched(workflowRunId: string, runSeq: number, now: number): boolean {
    return (
      this.sqlite
        .prepare(`UPDATE workflow_outbox SET dispatched_at = ? WHERE workflow_run_id = ? AND run_seq = ? AND dispatched_at IS NULL`)
        .run(now, workflowRunId, runSeq).changes > 0
    );
  }
}

// ── scheduler_journal ────────────────────────────────────────────

export interface JournalRow {
  workflowRunId: string;
  seq: number;
  message: unknown;
  decisions: unknown[];
  stateHash: string;
  at: number;
}

export class SchedulerJournalRepository extends SyncRepository {
  /** Append the next row of the run; returns its sequence. */
  append(workflowRunId: string, message: unknown, decisions: unknown[], stateHash: string, now: number): number {
    const r = this.sqlite
      .prepare(
        `INSERT INTO scheduler_journal (workflow_run_id, seq, message, decisions, state_hash, at)
         VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM scheduler_journal WHERE workflow_run_id = ?), ?, ?, ?, ?)
         RETURNING seq`,
      )
      .get(workflowRunId, workflowRunId, JSON.stringify(message), JSON.stringify(decisions), stateHash, now) as { seq: number };
    return r.seq;
  }

  list(workflowRunId: string): JournalRow[] {
    return (this.sqlite.prepare(`SELECT * FROM scheduler_journal WHERE workflow_run_id = ? ORDER BY seq`).all(workflowRunId) as Row[]).map((r) => ({
      workflowRunId: r['workflow_run_id'] as string,
      seq: r['seq'] as number,
      message: parse(r['message']),
      decisions: parse<unknown[]>(r['decisions']) ?? [],
      stateHash: r['state_hash'] as string,
      at: r['at'] as number,
    }));
  }
}
