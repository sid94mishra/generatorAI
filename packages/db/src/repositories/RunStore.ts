// ────────────────────────────────────────────────────────────────
// RunStore — load a run's scheduling state and apply a decision batch
// (P03 WP-3.1, G5 §5.5, RV-27).
//
// `apply(runId, ownerEpoch, decisions, ctx)` runs ONE synchronous
// better-sqlite3 transaction (`BEGIN IMMEDIATE`; never the async helper
// that kept a raw BEGIN open across awaits). Inside it:
//   - the run is fenced first: `UPDATE workflow_runs … WHERE id = ? AND
//     owner_epoch = ?`; 0 rows means another process owns the run now and
//     the batch aborts with `fenced`. Every later statement that touches the
//     run carries the same `owner_epoch` predicate, and every instance
//     statement is limited to the run;
//   - the decisions are applied in the order `decide()` emitted them (the
//     G5 §5.5 order: attempts, the instance's own CAS, successors, new
//     instances, timers, usage roll-ups, the run CAS, outbox rows);
//   - any CAS that matches no row (an executor-owned write raced the
//     actor) aborts the whole batch with `conflict`: nothing is written,
//     and the actor re-reads and re-decides;
//   - the scheduler journal row closes the batch.
// Effects (launch, abort, deliver_input, prepare, finalize) are returned for
// dispatch after the commit, never performed here.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import {
  EFFECT_DECISIONS,
  type ApplyContext,
  type ApplyResult,
  type ArmedTimer,
  type AttemptStatus,
  type Decision,
  type InstanceState,
  type IRunStore,
  type ContainerState,
  type LoopIterationRecord,
  type LoopState,
  type RunRecord,
  type RunState,
  type SkipReason,
  type Usage,
} from '@generatorai/core';
import type { StageRunState, WorkflowRunState } from '@generatorai/workflow-spec';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';
import { runPatchSets, runTransition, stagePatchSets, stageTransition } from './engineCas.js';
import {
  addUsage,
  RunEventRepository,
  SchedulerJournalRepository,
  StageAttemptRepository,
  WorkflowOutboxRepository,
  WorkflowTimerRepository,
} from './EngineRepositories.js';

type Row = Record<string, unknown>;

class ApplyAbort extends Error {
  constructor(
    readonly reason: 'fenced' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

function parse<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(v as string) as T;
  } catch {
    return fallback;
  }
}

/** Triggers that mean a person is waiting on the run (PD-2: every other trigger is unattended). */
const ATTENDED_TRIGGERS = new Set(['user', 'chat', 'fork']);

/** Concrete delay for a base delay and a jitter mode (G5 §3.2). */
export function jitteredDelay(baseMs: number, jitter: 'full' | 'equal' | 'none' | undefined, random: () => number): number {
  if (jitter === 'full') return Math.floor(random() * baseMs);
  if (jitter === 'equal') return Math.floor(baseMs / 2 + random() * (baseMs / 2));
  return baseMs;
}

export class RunStore implements IRunStore {
  private readonly sqlite: BetterSqlite3.Database;
  private readonly attempts: StageAttemptRepository;
  private readonly timers: WorkflowTimerRepository;
  private readonly outbox: WorkflowOutboxRepository;
  private readonly journal: SchedulerJournalRepository;
  private readonly events: RunEventRepository;

  constructor(db: AppDatabase | BetterSqlite3.Database) {
    this.sqlite = 'prepare' in db ? (db as BetterSqlite3.Database) : sqliteHandle(db as AppDatabase);
    this.attempts = new StageAttemptRepository(this.sqlite);
    this.timers = new WorkflowTimerRepository(this.sqlite);
    this.outbox = new WorkflowOutboxRepository(this.sqlite);
    this.journal = new SchedulerJournalRepository(this.sqlite);
    this.events = new RunEventRepository(this.sqlite);
  }

  // ── load ─────────────────────────────────────────────────────

  loadRunState(runId: string): RunState | null {
    const r = this.sqlite.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(runId) as Row | undefined;
    if (!r) return null;
    const systemVars = parse<Record<string, unknown>>(r['system_vars'], {});
    const trigger = parse<{ kind?: string } | null>(r['trigger'], null);
    const run: RunRecord = {
      id: r['id'] as string,
      name: r['name'] as string,
      status: r['status'] as WorkflowRunState,
      statusReason: (r['status_reason'] as string | null) ?? null,
      outcome: (r['outcome'] as RunRecord['outcome']) ?? null,
      version: r['version'] as number,
      variables: parse<Record<string, unknown>>(r['variables'], {}),
      codebases: (systemVars['codebases'] as RunRecord['codebases'] | undefined) ?? {},
      usage: parse<Usage>(r['usage'], {}),
      budget: parse<RunRecord['budget']>(r['budget'], null),
      unattended: !!trigger?.kind && !ATTENDED_TRIGGERS.has(trigger.kind),
      startedAt: (r['started_at'] as number | null) ?? null,
      skipKeys: parse<Array<{ stageKey?: string; skip?: boolean }> | null>(r['stage_overrides'], null)
        ?.filter((o) => o.skip === true && typeof o.stageKey === 'string')
        .map((o) => o.stageKey!) ?? [],
    };
    const rows = this.sqlite
      .prepare(
        `SELECT s.*,
                a.status AS attempt_status,
                (SELECT COUNT(*) FROM stage_attempts f WHERE f.stage_run_id = s.id AND f.status IN ('failed', 'interrupted')) AS failed_attempts,
                (SELECT MIN(f.started_at) FROM stage_attempts f WHERE f.stage_run_id = s.id) AS first_started_at
           FROM stage_runs s
           LEFT JOIN stage_attempts a ON a.stage_run_id = s.id AND a.attempt_no = s.current_attempt
          WHERE s.workflow_run_id = ?
          ORDER BY s.instance_path`,
      )
      .all(runId) as Row[];
    const instances: InstanceState[] = rows.map((s) => {
      const data = parse<unknown>(s['output_data'], null);
      // One container-state column: a loop's LoopState, a map's or a sub-workflow's state.
      const kind = s['kind'] as string;
      const state = parse<unknown>(s['loop_state'], null);
      return {
        id: s['id'] as string,
        stageKey: s['stage_key'] as string,
        instancePath: s['instance_path'] as string,
        scopeId: (s['scope_id'] as string | null) ?? null,
        status: s['status'] as StageRunState,
        statusReason: (s['status_reason'] as string | null) ?? null,
        version: s['version'] as number,
        currentAttempt: s['current_attempt'] as number,
        attemptStatus: (s['attempt_status'] as AttemptStatus | null) ?? null,
        failedAttempts: s['failed_attempts'] as number,
        skipReason: (s['skip_reason'] as SkipReason | null) ?? null,
        skipCauseId: (s['skip_cause_id'] as string | null) ?? null,
        gateAs: (s['gate_as'] as InstanceState['gateAs']) ?? null,
        output: data ?? (s['output_text'] as string | null) ?? null,
        summary: (s['summary'] as string | null) ?? null,
        interruptData: parse<unknown>(s['interrupt_data'], null),
        errorCode: (s['error_code'] as string | null) ?? null,
        usage: parse<Usage>(s['usage'], {}),
        leaseOwner: (s['lease_owner'] as string | null) ?? null,
        error: (s['error'] as string | null) ?? null,
        iterationIndex: (s['iteration_index'] as number | null) ?? null,
        itemIndex: (s['item_index'] as number | null) ?? null,
        itemKey: (s['item_key'] as string | null) ?? null,
        loopState: kind === 'loop' ? (state as LoopState | null) : null,
        containerState: kind === 'map' || kind === 'subworkflow' ? (state as ContainerState | null) : null,
        startedAt: (s['first_started_at'] as number | null) ?? null,
        completedAt: (s['completed_at'] as number | null) ?? null,
      };
    });
    const iterations: LoopIterationRecord[] = (
      this.sqlite
        .prepare(
          `SELECT li.* FROM loop_iterations li JOIN stage_runs s ON s.id = li.stage_run_id
            WHERE s.workflow_run_id = ? ORDER BY li.stage_run_id, li.k`,
        )
        .all(runId) as Row[]
    ).map((r) => ({
      stageRunId: r['stage_run_id'] as string,
      k: r['k'] as number,
      carry: parse<Record<string, unknown>>(r['carry'], {}),
      exitValues: parse<Record<string, boolean | null>>(r['exit_values'], {}),
      streaks: parse<number[]>(r['streaks'], []),
      signals: parse<LoopIterationRecord['signals']>(r['signals'], null),
      score: (r['score'] as number | null) ?? null,
      checkpointTurnId: (r['checkpoint_turn_id'] as string | null) ?? null,
      usage: parse<Usage>(r['usage'], {}),
      outcome: ((r['outcome'] as string | null) ?? 'completed') as LoopIterationRecord['outcome'],
      startedAt: (r['started_at'] as number | null) ?? null,
      endedAt: (r['ended_at'] as number | null) ?? null,
    }));
    return { run, instances, iterations, events: this.events.listPending(runId) };
  }

  // ── apply ────────────────────────────────────────────────────

  apply(runId: string, ownerEpoch: number, decisions: readonly Decision[], ctx: ApplyContext): ApplyResult {
    const { now } = ctx;
    const random = ctx.random ?? Math.random;
    const effects: Decision[] = [];
    const timers: ArmedTimer[] = [];
    const outbox: number[] = [];
    let journalSeq: number | null = null;
    const sql = this.sqlite;

    const fencedRun = (sets: string[], args: unknown[], what: string) => {
      const changed = sql
        .prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ? AND owner_epoch = ?`)
        .run(...args, runId, ownerEpoch).changes;
      if (changed === 0) throw new ApplyAbort('fenced', `${what}: run ${runId} is not owned at epoch ${ownerEpoch}`);
    };

    const tx = sql.transaction(() => {
      // Fence first: this also takes the write lock for the whole batch.
      fencedRun(['owner_epoch = owner_epoch'], [], 'fence');

      for (const d of decisions) {
        switch (d.t) {
          case 'transition': {
            const r = stageTransition(sql, d.id, d.from, d.to, {
              ...(d.expectedVersion !== undefined ? { expectedVersion: d.expectedVersion } : {}),
              ...(d.patch ? { patch: d.patch } : {}),
              // Actor-owned transitions never enter starting/running for an agent.
              ...(d.to === 'starting' || d.to === 'running' ? { lease: 'none' as const } : {}),
              runId,
              now,
            });
            if (!r.ok) throw new ApplyAbort('conflict', `instance ${d.id}: ${r.current?.status ?? 'missing'} is not in [${d.from.join(', ')}]`);
            break;
          }
          case 'create_instances': {
            const ins = sql.prepare(
              `INSERT INTO stage_runs (id, workflow_run_id, stage_key, kind, name, instance_path, scope_id, iteration_index, item_index, item_key, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING`,
            );
            for (const row of d.rows) {
              ins.run(row.id, runId, row.stageKey, row.kind, row.name, row.instancePath, row.scopeId, row.iterationIndex ?? null, row.itemIndex ?? null, row.itemKey ?? null, now, now);
            }
            break;
          }
          case 'create_attempt': {
            const bumped = sql
              .prepare(
                `UPDATE stage_runs SET current_attempt = ?, version = version + 1, updated_at = ?
                  WHERE id = ? AND workflow_run_id = ? AND current_attempt = ? RETURNING epoch`,
              )
              .get(d.attemptNo, now, d.stageRunId, runId, d.attemptNo - 1) as { epoch: number } | undefined;
            if (!bumped) throw new ApplyAbort('conflict', `instance ${d.stageRunId}: attempt ${d.attemptNo} is not next`);
            this.attempts.create({ stageRunId: d.stageRunId, attemptNo: d.attemptNo, mode: d.mode, epoch: bumped.epoch, overrides: d.overrides, now });
            break;
          }
          case 'settle_attempt': {
            const ok = this.attempts.settle(d.stageRunId, d.attemptNo, d.status, { ...(d.error ? { error: d.error } : {}), now });
            if (!ok) throw new ApplyAbort('conflict', `attempt ${d.stageRunId}#${d.attemptNo} is not live`);
            break;
          }
          case 'timer': {
            const fireAt = now + Math.max(d.minDelayMs ?? 0, jitteredDelay(d.baseDelayMs, d.jitter, random));
            this.timers.arm({ id: d.id, workflowRunId: runId, stageRunId: d.stageRunId, kind: d.kind, fireAt, now });
            timers.push({ id: d.id, workflowRunId: runId, stageRunId: d.stageRunId, kind: d.kind, fireAt });
            break;
          }
          case 'cancel_timer':
            this.timers.cancel(
              { workflowRunId: runId, ...(d.kind !== undefined ? { kind: d.kind } : {}), ...(d.stageRunId !== undefined ? { stageRunId: d.stageRunId } : {}) },
              now,
            );
            break;
          case 'run_transition': {
            const r = runTransition(sql, runId, d.from, d.to, {
              ...(d.expectedVersion !== undefined ? { expectedVersion: d.expectedVersion } : {}),
              ...(d.patch ? { patch: d.patch } : {}),
              ownerEpoch,
              now,
            });
            if (!r.ok) throw new ApplyAbort(r.current && r.current.ownerEpoch !== ownerEpoch ? 'fenced' : 'conflict', `run ${runId}: ${r.current?.status ?? 'missing'} is not in [${d.from.join(', ')}]`);
            break;
          }
          case 'run_patch': {
            const p = runPatchSets(d.patch);
            if (p.sets.length > 0) fencedRun([...p.sets, 'updated_at = ?'], [...p.args, now], 'run_patch');
            break;
          }
          case 'usage_rollup': {
            const inst = sql.prepare(`SELECT usage, current_attempt FROM stage_runs WHERE id = ? AND workflow_run_id = ?`).get(d.stageRunId, runId) as Row | undefined;
            if (inst) {
              sql.prepare(`UPDATE stage_runs SET usage = ? WHERE id = ?`).run(JSON.stringify(addUsage(parse<Usage>(inst['usage'], {}), d.usage)), d.stageRunId);
              if (!d.scopeOnly && (inst['current_attempt'] as number) > 0) this.attempts.addUsage(d.stageRunId, inst['current_attempt'] as number, d.usage);
            }
            // A container's roll-up of its body: the run already counted it.
            if (d.scopeOnly) break;
            const run = sql.prepare(`SELECT usage FROM workflow_runs WHERE id = ?`).get(runId) as Row;
            fencedRun(['usage = ?'], [JSON.stringify(addUsage(parse<Usage>(run['usage'], {}), d.usage))], 'usage_rollup');
            break;
          }
          case 'instance_patch': {
            const p = stagePatchSets(d.patch);
            const changed = sql
              .prepare(`UPDATE stage_runs SET ${[...p.sets, 'version = version + 1', 'updated_at = ?'].join(', ')} WHERE id = ? AND workflow_run_id = ? AND status = ?`)
              .run(...p.args, now, d.id, runId, d.status).changes;
            if (changed === 0) throw new ApplyAbort('conflict', `instance ${d.id}: not ${d.status}`);
            break;
          }
          case 'record_iteration': {
            const r = d.row;
            sql
              .prepare(
                `INSERT INTO loop_iterations (stage_run_id, k, carry, exit_values, streaks, signals, score, checkpoint_turn_id, usage, outcome, started_at, ended_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (stage_run_id, k) DO NOTHING`,
              )
              .run(
                r.stageRunId,
                r.k,
                JSON.stringify(r.carry),
                JSON.stringify(r.exitValues),
                JSON.stringify(r.streaks),
                r.signals ? JSON.stringify(r.signals) : null,
                r.score,
                r.checkpointTurnId,
                JSON.stringify(r.usage),
                r.outcome,
                r.startedAt,
                r.endedAt,
              );
            break;
          }
          case 'consume_event':
            if (!this.events.consume(runId, d.eventId, d.stageRunId)) throw new ApplyAbort('conflict', `event ${d.eventId} was consumed already`);
            break;
          case 'emit': {
            const seq = (sql.prepare(`SELECT run_seq FROM workflow_runs WHERE id = ?`).get(runId) as { run_seq: number }).run_seq + 1;
            this.outbox.insert(runId, seq, d.event.kind, d.event.data, now);
            fencedRun(['run_seq = ?'], [seq], 'emit');
            outbox.push(seq);
            break;
          }
          default:
            if (EFFECT_DECISIONS.has(d.t)) effects.push(d);
        }
      }

      if (ctx.message) {
        journalSeq = this.journal.append(runId, ctx.message, decisions as unknown[], ctx.stateHash ?? '', now);
      }
    });

    try {
      tx.immediate();
    } catch (err) {
      if (err instanceof ApplyAbort) return { ok: false, reason: err.reason, detail: err.message };
      throw err;
    }
    return { ok: true, effects, timers, outbox, journalSeq };
  }
}
