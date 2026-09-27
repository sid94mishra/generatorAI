// ────────────────────────────────────────────────────────────────
// P03 WP-3.1 — CAS repositories and RunStore on a real SQLite (G5 §7.5).
//
//   - transition(): legal pairs only, one of two racing writers wins,
//     version pinning, the lease stamped by the claim (B-2);
//   - RunStore.apply: a stale owner_epoch is fenced; a CAS that loses
//     rejects the WHOLE batch (nothing persisted); decide() batches round
//     trip through loadRunState;
//   - timers fire once; the outbox is idempotent by (run, run_seq).
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { classified, compile, decide, type Decision } from '@generatorai/core';
import { parseGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeDB,
  createDB,
  DrizzleStageRunRepository,
  DrizzleWorkflowRunRepository,
  IllegalTransitionError,
  migrateDB,
  RunSessionRepository,
  RunStore,
  SchedulerJournalRepository,
  StageAttemptRepository,
  WorkflowOutboxRepository,
  WorkflowTimerRepository,
  type AppDatabase,
} from '../index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});
const raw = (db: AppDatabase): Database.Database => (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_800_000_000_000;

function setup(run: Record<string, unknown> = {}) {
  const db = createDB(':memory:');
  open.push(db);
  migrateDB(db);
  const s = raw(db);
  s.prepare(`INSERT INTO workflow_definitions (id, name, spec, created_at, updated_at) VALUES ('d', 'D', '{}', ?, ?)`).run(T, T);
  s.prepare(`INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at) VALUES ('v', 'd', 1, 'h', 'published', '{}', ?)`).run(T);
  s.prepare(
    `INSERT INTO workflow_runs (id, workflow_definition_id, definition_version_id, name, status, permission_mode, root_run_id, trigger, budget, created_at, updated_at)
     VALUES ('r', 'd', 'v', 'Run', ?, 'default', 'r', ?, ?, ?, ?)`,
  ).run(run['status'] ?? 'created', run['trigger'] ?? null, run['budget'] ?? null, T, T);
  const runs = new DrizzleWorkflowRunRepository(db);
  const epoch = runs.claimOwnership('r', 'boot-1', 60_000, T)!;
  return { db, s, store: new RunStore(db), stages: new DrizzleStageRunRepository(db), runs, epoch };
}

function insertInstance(s: Database.Database, id: string, status = 'ready'): void {
  s.prepare(
    `INSERT INTO stage_runs (id, workflow_run_id, stage_key, name, instance_path, status, created_at, updated_at) VALUES (?, 'r', ?, ?, ?, ?, ?, ?)`,
  ).run(id, id, id, id, status, T, T);
}

const graphOf = (stages: string[], edges: Array<[string, string]> = []) =>
  compile(
    parseGraph({
      formatVersion: 2,
      workflow: { name: 'g' },
      stages: stages.map((k) => ({ key: k, name: k, kind: 'agent', prompts: [{ label: 'main', text: k }] })),
      edges: edges.map(([from, to]) => ({ from, to })),
    } as unknown as WorkflowGraphInput),
  );

describe('stage_runs transition() CAS', () => {
  it('refuses an illegal pair (dev/test throw) and needs a lease to enter starting', () => {
    const { s, stages } = setup();
    insertInstance(s, 'i', 'pending');
    expect(() => stages.transition('i', ['pending'], 'completed')).toThrow(IllegalTransitionError);
    insertInstance(s, 'j', 'ready');
    expect(() => stages.transition('j', ['ready'], 'starting')).toThrow(/lease/);
  });

  it('the claim stamps lease, heartbeat and progress in the same statement; leaving the attempt clears the lease', () => {
    const { s, stages } = setup();
    insertInstance(s, 'i');
    const r = stages.transition('i', ['ready'], 'starting', { lease: { owner: 'boot-1:i:1', ttlMs: 60_000 }, now: T + 5 });
    expect(r.ok && r.row).toMatchObject({ status: 'starting', version: 1, leaseOwner: 'boot-1:i:1', leaseExpiresAt: T + 60_005, heartbeatAt: T + 5, lastProgressAt: T + 5, startedAt: T + 5 });
    expect(stages.renewLease('i', 'boot-1:i:1', 60_000, T + 100)).toBe(true);
    expect(stages.renewLease('i', 'someone-else', 60_000, T + 100)).toBe(false);
    expect(stages.markProgress('i', 'boot-1:i:1', T + 200)).toBe(true);
    const paused = stages.transition('i', ['starting'], 'paused', { patch: { statusReason: 'user_paused' }, now: T + 300 });
    expect(paused.ok && paused.row).toMatchObject({ status: 'paused', leaseOwner: null, leaseExpiresAt: null, statusReason: 'user_paused' });
    expect(stages.renewLease('i', 'boot-1:i:1', 60_000)).toBe(false);
  });

  it('two racing writers from the same state: exactly one wins (claim vs cancel)', () => {
    const { s, stages } = setup();
    insertInstance(s, 'i');
    const cancel = stages.transition('i', ['ready'], 'cancelled', { patch: { statusReason: 'user_cancel' } });
    const claim = stages.transition('i', ['ready'], 'starting', { lease: { owner: 'x', ttlMs: 1000 } });
    expect(cancel.ok).toBe(true);
    expect(claim).toEqual({ ok: false, current: expect.objectContaining({ status: 'cancelled' }) });
  });

  it('pins the version when asked', () => {
    const { s, stages } = setup();
    insertInstance(s, 'i', 'paused');
    expect(stages.transition('i', ['paused'], 'ready', { expectedVersion: 3 }).ok).toBe(false);
    expect(stages.transition('i', ['paused'], 'ready', { expectedVersion: 0 }).ok).toBe(true);
  });
});

describe('workflow_runs transition() and ownership', () => {
  it('fences on owner_epoch; a second claim bumps the epoch only for the owner or after expiry', () => {
    const { runs, epoch } = setup();
    expect(epoch).toBe(1);
    expect(runs.claimOwnership('r', 'boot-2', 60_000, T + 1)).toBeNull();
    expect(runs.claimOwnership('r', 'boot-2', 60_000, T + 120_000)).toBe(2);
    expect(runs.transition('r', ['created'], 'starting', { ownerEpoch: 1 }).ok).toBe(false);
    expect(runs.transition('r', ['created'], 'starting', { ownerEpoch: 2 }).ok).toBe(true);
    expect(() => runs.transition('r', ['starting'], 'completed')).toThrow(IllegalTransitionError);
  });
});

describe('RunStore.apply', () => {
  it('round-trips decide() batches through loadRunState: a run to completion', () => {
    const { store, runs, stages, epoch } = setup();
    const graph = graphOf(['a', 'b'], [['a', 'b']]);
    let now = T;
    const step = (msg: Parameters<typeof decide>[2]) => {
      const state = store.loadRunState('r')!;
      const ds = decide(graph, state, msg, now++);
      const res = store.apply('r', epoch, ds, { now, message: msg, stateHash: 'h' });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      return { ds, res };
    };
    step({ type: 'start' });
    const { res } = step({ type: 'prepared' });
    expect(res.ok && res.effects.map((e) => e.t)).toEqual(['launch']);
    expect(res.ok && res.timers.map((t) => t.kind)).toEqual(['queue_timeout']);

    // The executor's own moves, then its report.
    const a = store.loadRunState('r')!.instances.find((i) => i.stageKey === 'a')!;
    expect(a).toMatchObject({ status: 'ready', currentAttempt: 1, attemptStatus: 'running' });
    expect(stages.transition(a.id, ['ready'], 'starting', { lease: { owner: 'e', ttlMs: 60_000 } }).ok).toBe(true);
    expect(stages.transition(a.id, ['starting'], 'running', { lease: { owner: 'e', ttlMs: 60_000 } }).ok).toBe(true);
    expect(stages.transition(a.id, ['running'], 'validating').ok).toBe(true);
    step({ type: 'attempt_settled', stageRunId: a.id, attemptNo: 1, outcome: { kind: 'succeeded', output: { data: { n: 1 } }, usage: { turns: 2, costUsd: 0.5 } } });

    const after = store.loadRunState('r')!;
    expect(after.instances.map((i) => [i.stageKey, i.status])).toEqual([['a', 'completed'], ['b', 'ready']]);
    expect(after.instances[0]).toMatchObject({ output: { n: 1 }, attemptStatus: 'succeeded', usage: { turns: 2, costUsd: 0.5 } });
    expect(after.run.usage).toEqual({ turns: 2, costUsd: 0.5 });
    expect(new StageAttemptRepository(raw(open[0]!)).get(a.id, 1)).toMatchObject({ status: 'succeeded', usage: { turns: 2, costUsd: 0.5 } });

    const b = after.instances[1]!;
    stages.transition(b.id, ['ready'], 'starting', { lease: { owner: 'e', ttlMs: 60_000 } });
    stages.transition(b.id, ['starting'], 'running', { lease: { owner: 'e', ttlMs: 60_000 } });
    stages.transition(b.id, ['running'], 'validating');
    const fin = step({ type: 'attempt_settled', stageRunId: b.id, attemptNo: 1, outcome: { kind: 'succeeded', output: { text: 'ok' } } });
    expect(fin.res.ok && fin.res.effects).toEqual([{ t: 'finalize', outcome: 'completed', compensate: [] }]);
    step({ type: 'finalized', ok: true });

    const row = runs.getRunRow('r')!;
    expect(row).toMatchObject({ status: 'completed', outcome: 'completed' });
    const outbox = new WorkflowOutboxRepository(raw(open[0]!)).listPending();
    expect(outbox.map((o) => o.kind)).toEqual([
      'workflow_run.starting',
      'workflow_run.running',
      'stage_run.completed',
      'stage_run.completed',
      'workflow_run.completed',
      'workflow_run.finalized',
    ]);
    expect(outbox.map((o) => o.runSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(row.runSeq).toBe(6);
    expect(new SchedulerJournalRepository(raw(open[0]!)).list('r').map((j) => j.seq)).toEqual([1, 2, 3, 4, 5]);
    // Terminal: no live timer left.
    expect(new WorkflowTimerRepository(raw(open[0]!)).listLive('r')).toEqual([]);
  });

  it('a stale owner_epoch is fenced and writes nothing', () => {
    const { store, runs } = setup();
    runs.claimOwnership('r', 'boot-1', 60_000, T); // epoch 2 now
    const ds = decide(graphOf(['a']), store.loadRunState('r')!, { type: 'start' }, T);
    const res = store.apply('r', 1, ds, { now: T, message: { type: 'start' } });
    expect(res).toMatchObject({ ok: false, reason: 'fenced' });
    expect(runs.getRunRow('r')).toMatchObject({ status: 'created', runSeq: 0 });
    expect(new SchedulerJournalRepository(raw(open[0]!)).list('r')).toEqual([]);
  });

  it('a lost CAS rejects the whole batch: the executor cancelled first (desired state first)', () => {
    const { s, store, epoch } = setup({ status: 'running' });
    insertInstance(s, 'x', 'ready');
    const batch: Decision[] = [
      { t: 'emit', event: { kind: 'probe', data: {} } },
      { t: 'run_transition', from: ['running'], to: 'waiting' },
      { t: 'transition', id: 'x', from: ['pending'], to: 'ready' },
    ];
    const res = store.apply('r', epoch, batch, { now: T });
    expect(res).toMatchObject({ ok: false, reason: 'conflict' });
    const run = s.prepare(`SELECT status, run_seq FROM workflow_runs WHERE id = 'r'`).get();
    expect(run).toEqual({ status: 'running', run_seq: 0 });
    expect(s.prepare(`SELECT COUNT(*) AS n FROM workflow_outbox`).get()).toEqual({ n: 0 });
  });

  it('draws jitter for a timer and honours minDelayMs; replacing a live timer of the same kind', () => {
    const { store, epoch } = setup({ status: 'running' });
    const timers = new WorkflowTimerRepository(raw(open[0]!));
    const res = store.apply(
      'r',
      epoch,
      [
        { t: 'timer', id: 't1', kind: 'pause_ttl', stageRunId: null, baseDelayMs: 1000, jitter: 'full' },
        { t: 'timer', id: 't2', kind: 'pause_ttl', stageRunId: null, baseDelayMs: 1000, jitter: 'equal', minDelayMs: 5000 },
      ],
      { now: T, random: () => 0.5 },
    );
    expect(res.ok && res.timers.map((t) => [t.id, t.fireAt])).toEqual([
      ['t1', T + 500],
      ['t2', T + 5000],
    ]);
    expect(timers.listLive('r').map((t) => t.id)).toEqual(['t2']);
    expect(timers.fire('t2', T + 5000)).toBe(true);
    expect(timers.fire('t2', T + 5001)).toBe(false); // fired once
    expect(timers.fire('t1', T + 5001)).toBe(false); // cancelled
  });
});

describe('run-side repositories', () => {
  it('outbox marks a row dispatched once (redelivery after a crash is a no-op)', () => {
    const { s, epoch, store } = setup({ status: 'running' });
    void s;
    store.apply('r', epoch, [{ t: 'emit', event: { kind: 'e1', data: { a: 1 } } }], { now: T });
    const outbox = new WorkflowOutboxRepository(raw(open[0]!));
    const [row] = outbox.listPending();
    expect(row).toMatchObject({ runSeq: 1, kind: 'e1', payload: { a: 1 } });
    expect(outbox.markDispatched('r', 1, T)).toBe(true);
    expect(outbox.markDispatched('r', 1, T + 1)).toBe(false);
    expect(outbox.listPending()).toEqual([]);
  });

  it('attempts: create once, settle only while live, repairs counted', () => {
    const { s } = setup({ status: 'running' });
    insertInstance(s, 'i');
    const attempts = new StageAttemptRepository(raw(open[0]!));
    expect(attempts.create({ stageRunId: 'i', attemptNo: 1, mode: 'fresh', epoch: 1, now: T })).toBe(true);
    expect(attempts.create({ stageRunId: 'i', attemptNo: 1, mode: 'fresh', epoch: 1, now: T })).toBe(false);
    expect(attempts.incrementRepair('i', 1)).toBe(1);
    expect(attempts.settle('i', 1, 'failed', { error: classified('output_schema', 'bad'), now: T + 1 })).toBe(true);
    expect(attempts.settle('i', 1, 'succeeded', { now: T + 2 })).toBe(false);
    expect(attempts.get('i', 1)).toMatchObject({ status: 'failed', errorClass: 'repairable', errorCode: 'output_schema', repairCount: 1, endedAt: T + 1 });
    expect(attempts.incrementRepair('i', 1)).toBeNull();
  });

  it('run sessions: bind, rebind with a new config hash, release', () => {
    setup({ status: 'running' });
    const sessions = new RunSessionRepository(raw(open[0]!));
    sessions.upsert({ id: 'rs1', workflowRunId: 'r', sessionKey: 'group:review', sessionId: 's1', configHash: 'c1', now: T });
    const rebound = sessions.upsert({ id: 'rs2', workflowRunId: 'r', sessionKey: 'group:review', sessionId: 's2', configHash: 'c2', now: T + 1 });
    expect(rebound).toMatchObject({ id: 'rs1', sessionId: 's2', configHash: 'c2', status: 'active' });
    expect(sessions.release('r', 'group:review', T + 2)).toBe(true);
    expect(sessions.listActive('r')).toEqual([]);
  });
});
