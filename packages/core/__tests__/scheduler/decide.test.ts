// ────────────────────────────────────────────────────────────────
// P03 WP-3.3 (R-7) — decide() semantics as table and scenario tests:
// run lifecycle, the B probes S1–S5 and T2, failure precedence (G5 §3.5),
// budgets, concurrency, commands (desired state first), timers, the
// `cancelRemaining` race and determinism. The harness checks, on every
// step, that each transition is legal in the spec's tables and that nothing
// launches outside a running/waiting run.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { classified } from '../../src/domain/errors/StageError.js';
import { attemptId, instanceId, PAUSE_TTL_MS, type Decision } from '../../src/domain/scheduler/index.js';
import { events, graphOf, kinds, only, Sim } from './harness.js';

describe('run lifecycle', () => {
  it('start → prepare; prepared → root instances, launches, running', () => {
    const s = new Sim(graphOf(['a', 'b'], [['a', 'b']]));
    const started = s.send({ type: 'start' });
    expect(kinds(started)).toEqual(['run_transition', 'emit', 'prepare']);
    expect(s.state.run.status).toBe('starting');

    const prepared = s.send({ type: 'prepared' });
    expect(s.state.run.status).toBe('running');
    const created = only(prepared, 'create_instances')[0]!;
    expect(created.rows.map((r) => [r.instancePath, r.id])).toEqual([
      ['a', instanceId('run-1', 'a')],
      ['b', instanceId('run-1', 'b')],
    ]);
    expect(s.statuses()).toEqual({ a: 'ready', b: 'pending' });
    expect(only(prepared, 'create_attempt')).toEqual([{ t: 'create_attempt', stageRunId: s.inst('a').id, attemptNo: 1, mode: 'fresh' }]);
    expect(only(prepared, 'launch')).toEqual([{ t: 'launch', stageRunId: s.inst('a').id, attemptNo: 1 }]);
    expect(only(prepared, 'timer').map((t) => t.kind)).toEqual(['queue_timeout']);
  });

  it('a linear run completes: finalizing → finalize → completed, with the terminal event contract (RV-5)', () => {
    const s = new Sim(graphOf(['a', 'b'], [['a', 'b']]));
    s.boot();
    s.succeed('a');
    expect(s.statuses()).toEqual({ a: 'completed', b: 'ready' });
    const last = s.succeed('b', { data: { ok: true } });
    expect(s.state.run.status).toBe('finalizing');
    expect(s.state.run.outcome).toBe('completed');
    expect(only(last, 'finalize')).toEqual([{ t: 'finalize', outcome: 'completed', compensate: [] }]);

    const done = s.send({ type: 'finalized', ok: true });
    expect(s.state.run.status).toBe('completed');
    expect(only(done, 'emit').map((e) => e.event)).toEqual([
      { kind: 'workflow_run.completed', data: { workflowRunId: 'run-1', runVersion: s.state.run.version } },
      { kind: 'workflow_run.finalized', data: { workflowRunId: 'run-1', runVersion: s.state.run.version, status: 'completed' } },
    ]);
  });

  it('a post-processing failure fails a completed run', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.succeed('a');
    const d = s.send({ type: 'finalized', ok: false, error: 'push rejected' });
    expect(s.state.run).toMatchObject({ status: 'failed', outcome: 'failed' });
    expect(only(d, 'emit').map((e) => e.event)).toEqual([
      { kind: 'workflow_run.failed', data: { workflowRunId: 'run-1', runVersion: s.state.run.version, error: 'push rejected' } },
      { kind: 'workflow_run.finalized', data: { workflowRunId: 'run-1', runVersion: s.state.run.version, status: 'failed' } },
    ]);
  });

  it('a setup failure runs the finalize lifecycle, then fails the run as setup:<phase> (CONVINV-R3)', () => {
    const s = new Sim(graphOf(['a']));
    s.send({ type: 'start' });
    const d = s.send({ type: 'prepare_failed', phase: 'clone', error: 'no repo' });
    expect(s.state.run).toMatchObject({ status: 'finalizing', statusReason: 'setup:clone', outcome: 'failed' });
    expect(only(d, 'finalize')).toEqual([{ t: 'finalize', outcome: 'failed', compensate: [] }]);
    expect(events(d)).not.toContain('workflow_run.finalized');
    const done = s.send({ type: 'finalized', ok: true });
    expect(s.state.run).toMatchObject({ status: 'failed', statusReason: 'setup:clone', outcome: 'failed' });
    expect(events(done)).toEqual(['workflow_run.failed', 'workflow_run.finalized']);
  });

  it('goes waiting when only a paused instance is left, running again when work resumes', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 1 } }]));
    s.boot();
    s.fail('a', classified('auth', 'bad key'));
    expect(s.status('a')).toBe('paused');
    expect(s.state.run.status).toBe('waiting');
    s.send({ type: 'command', command: { command: 'retry', instanceId: 'a', mode: 'resume' } });
    expect(s.state.run.status).toBe('running');
    expect(s.status('a')).toBe('ready');
  });

  it('an empty graph completes at once', () => {
    const s = new Sim(graphOf([]));
    s.boot();
    expect(s.state.run.status).toBe('finalizing');
  });
});

describe('B probes and T2 (readiness in a run)', () => {
  it('S1: an operator skip as `skipped` skips the successor; as `completed` it runs', () => {
    for (const [as, expected] of [['skipped', 'skipped'], ['completed', 'ready']] as const) {
      const s = new Sim(graphOf([{ key: 'a' }, { key: 'b', retry: { maxAttempts: 1 } }, { key: 'c' }], [['a', 'b'], ['b', 'c']]));
      s.boot();
      s.succeed('a');
      s.fail('b', classified('auth', 'x'));
      expect(s.status('b')).toBe('paused');
      s.send({ type: 'command', command: { command: 'skip', instanceId: 'b', as } });
      expect(s.status('c')).toBe(expected);
      if (as === 'skipped') expect(s.inst('c')).toMatchObject({ skipReason: 'upstream_skipped', skipCauseId: s.inst('b').id });
    }
  });

  it('S3: a failed stage with a `completion` notify fails the run; the notify still runs', () => {
    const s = new Sim(graphOf([{ key: 'a', onExhausted: 'fail', retry: { maxAttempts: 1 } }, 'notify'], [{ from: 'a', to: 'notify', on: 'completion' }]));
    s.boot();
    s.fail('a', classified('auth', 'x'));
    expect(s.statuses()).toEqual({ a: 'failed', notify: 'ready' });
    s.succeed('notify');
    expect(s.state.run.outcome).toBe('failed');
  });

  it('S4: B -success-> D <-failure- C with both completed: `all` skips D, `any` runs it', () => {
    for (const [join, expected] of [[{ mode: 'all' }, 'skipped'], [{ mode: 'any' }, 'ready']] as const) {
      const s = new Sim(graphOf(['b', 'c', { key: 'd', join }], [{ from: 'b', to: 'd' }, { from: 'c', to: 'd', on: 'failure' }]));
      s.boot();
      s.succeed('b');
      s.succeed('c');
      expect(s.status('d')).toBe(expected);
      if (expected === 'skipped') expect(s.inst('d').skipReason).toBe('join_unsatisfiable');
    }
  });

  it('S5: a guard that cannot be evaluated fails the stage with condition_error', () => {
    const s = new Sim(graphOf([{ key: 'a', guard: 'variables.count > ' }, 'b'], [['a', 'b']]));
    s.boot();
    expect(s.inst('a')).toMatchObject({ status: 'failed', errorCode: 'condition_error' });
    expect(s.inst('b')).toMatchObject({ status: 'skipped', skipReason: 'join_unsatisfiable' });
    expect(s.state.run.outcome).toBe('failed');
  });

  it('T2: guards over variables and stage outputs, skip cascade, join with a skipped predecessor, always edge', () => {
    const g = graphOf(
      [
        'r',
        { key: 'c_and', guard: "variables.env == 'prod' and variables.count > 3" },
        { key: 'c_or_false', guard: "variables.env == 'dev' or variables.count < 2" },
        { key: 'c_not', guard: 'not variables.flag' },
        { key: 'c_stageref', guard: "stages.r.status == 'completed' and stages.r.output.score >= 5" },
        'd_after_skip',
        'j',
        'j_always',
      ],
      [
        ['r', 'c_and'],
        ['r', 'c_or_false'],
        ['r', 'c_not'],
        ['r', 'c_stageref'],
        ['c_or_false', 'd_after_skip'],
        ['c_and', 'j'],
        ['c_or_false', 'j'],
        { from: 'c_or_false', to: 'j_always', on: 'always' },
      ],
    );
    const s = new Sim(g, { variables: { env: 'prod', count: 5, flag: false } });
    s.boot();
    s.succeed('r', { data: { score: 7 } });
    expect(s.statuses()).toMatchObject({
      c_and: 'ready',
      c_or_false: 'skipped',
      c_not: 'ready',
      c_stageref: 'ready',
      d_after_skip: 'skipped',
      j: 'pending',
      j_always: 'ready',
    });
    expect(s.inst('c_or_false').skipReason).toBe('guard_false');
    expect(s.inst('d_after_skip').skipReason).toBe('upstream_skipped');
    s.succeed('c_and');
    expect(s.status('j')).toBe('ready');
  });
});

describe('failure precedence (G5 §3.5)', () => {
  it('a transient error retries: retry_wait with the backoff, then a resume attempt', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2, jitter: 'equal' } }]));
    s.boot();
    const d = s.fail('a', classified('overloaded', 'busy', { retryAfterMs: 5000 }));
    expect(s.inst('a')).toMatchObject({ status: 'retry_wait', statusReason: 'retry:resume', errorCode: 'overloaded', failedAttempts: 1 });
    expect(only(d, 'settle_attempt')[0]).toMatchObject({ attemptNo: 1, status: 'failed' });
    expect(only(d, 'timer')[0]).toMatchObject({ kind: 'retry', baseDelayMs: 1000, jitter: 'equal', minDelayMs: 5000 });

    s.fire('retry', 'a');
    expect(only(s.log.at(-1)!.decisions, 'create_attempt')[0]).toMatchObject({ attemptNo: 2, mode: 'resume' });
    const second = s.fail('a', classified('overloaded', 'busy'));
    expect(only(second, 'timer')[0]).toMatchObject({ baseDelayMs: 2000 });
  });

  it.each<[string, Record<string, unknown>, Parameters<typeof classified>, boolean, string, string | null]>([
    ['deterministic: no retry, pause (default onExhausted)', {}, ['auth', 'bad key'], false, 'paused', 'deterministic:auth'],
    ['deterministic with onExhausted fail', { onExhausted: 'fail' }, ['auth', 'bad key'], false, 'failed', null],
    ['transient out of attempts: pause', { retry: { maxAttempts: 1 } }, ['overloaded', 'busy'], false, 'paused', 'retries_exhausted'],
    ['transient not in retryOn: pause', { retry: { retryOn: ['rate_limited'] } }, ['overloaded', 'busy'], false, 'paused', 'retries_exhausted'],
    ['repairable with restartOnExhausted: restart retry', {}, ['output_schema', 'bad json'], false, 'retry_wait', 'retry:restart'],
    ['repairable without restartOnExhausted: pause', { repair: { restartOnExhausted: false } }, ['output_schema', 'bad json'], false, 'paused', 'retries_exhausted'],
    ['interrupted, unsafe to replay: pause (never fail)', { onExhausted: 'fail' }, ['process_restart_unsafe', 'crash'], false, 'paused', 'interrupted:process_restart_unsafe'],
    ['interrupted, safe to replay: resume retry', {}, ['lease_expired', 'lease'], true, 'retry_wait', 'retry:resume'],
    ['human rejection: failed even with onExhausted pause', {}, ['rejected_by_human', 'no'], false, 'failed', 'rejected'],
    ['stage budget spent: no retry', { budget: { maxTurns: 1 } }, ['overloaded', 'busy'], false, 'paused', 'retries_exhausted'],
  ])('%s', (_label, stage, err, safe, status, reason) => {
    const s = new Sim(graphOf([{ key: 'a', ...stage }]));
    s.boot();
    if (stage['budget']) s.send({ type: 'usage_tick', stageRunId: s.inst('a').id, attemptNo: 0, usage: { turns: 1 } });
    s.fail('a', classified(...err), safe);
    expect(s.inst('a').status).toBe(status);
    if (reason !== null) expect(s.inst('a').statusReason).toBe(reason);
  });

  it('ROUTE: an active failure edge fails the stage and runs the handler; the run then completes', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 1 } }, 'b', 'fix'], [['a', 'b'], { from: 'a', to: 'fix', on: 'failure' }]));
    s.boot();
    s.fail('a', classified('auth', 'x'));
    expect(s.statuses()).toEqual({ a: 'failed', b: 'skipped', fix: 'ready' });
    s.succeed('fix');
    expect(s.state.run.outcome).toBe('completed');
  });

  it('ROUTE only through an edge whose `when` holds for the failure', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 1 } }, 'fix'], [{ from: 'a', to: 'fix', on: 'failure', when: "parent.status == 'cancelled'" }]));
    s.boot();
    s.fail('a', classified('auth', 'x'));
    expect(s.status('a')).toBe('paused');
  });

  it('an unclassified error is retried at most once', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 5, initialDelayMs: 0 } }]));
    s.boot();
    const odd = { ...classified('transport', 'odd'), unclassified: true as const };
    s.fail('a', odd);
    expect(s.status('a')).toBe('retry_wait');
    s.fire('retry', 'a');
    s.fail('a', odd);
    expect(s.inst('a')).toMatchObject({ status: 'paused', failedAttempts: 2 });
  });

  it('the totalMs deadline stops retries', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 5 }, timeouts: { totalMs: 10_000 } }]));
    s.boot();
    s.now += 20_000;
    s.fail('a', classified('overloaded', 'busy'));
    expect(s.status('a')).toBe('paused');
  });

  it('an outcome that loses the race to a pause is dropped (step 0)', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.send({ type: 'command', command: { command: 'pause', instanceId: 'a', mode: 'drain' } });
    const d = s.send({ type: 'attempt_settled', stageRunId: s.inst('a').id, attemptNo: 1, outcome: { kind: 'failed', error: classified('overloaded', 'x') } });
    expect(kinds(d)).toEqual(['settle_attempt']);
    expect(only(d, 'settle_attempt')[0]!.status).toBe('aborted');
    expect(s.status('a')).toBe('paused');
  });

  it('success reported outside validating is never a completion (F-5)', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.send({ type: 'attempt_settled', stageRunId: s.inst('a').id, attemptNo: 1, outcome: { kind: 'succeeded', output: { text: 'x' } } });
    expect(s.inst('a')).toMatchObject({ status: 'retry_wait', statusReason: 'retry:restart', errorCode: 'output_schema' });
  });

  it('a stale or duplicate settlement is ignored', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.succeed('a');
    const again = s.send({ type: 'attempt_settled', stageRunId: s.inst('a').id, attemptNo: 1, outcome: { kind: 'succeeded', output: {} } });
    expect(again).toEqual([]);
  });

  it('lease expiry settles the attempt as interrupted; unsafe → paused', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.exec('a', 'starting', 'boot-1:a:1');
    const d = s.send({ type: 'lease_expired', stageRunId: s.inst('a').id, owner: 'boot-1:a:1' });
    expect(only(d, 'settle_attempt')[0]).toMatchObject({ status: 'interrupted' });
    expect(s.inst('a')).toMatchObject({ status: 'paused', statusReason: 'interrupted:lease_expired' });
    // An expiry for an owner that re-claimed since is ignored.
    const s2 = new Sim(graphOf(['a']));
    s2.boot();
    s2.exec('a', 'starting', 'boot-2:a:1');
    expect(s2.send({ type: 'lease_expired', stageRunId: s2.inst('a').id, owner: 'boot-1:a:1' })).toEqual([]);
  });
});

describe('budgets', () => {
  it('a stage over its budget is aborted after the desired state is written, and pauses (budget_exceeded)', () => {
    const s = new Sim(graphOf([{ key: 'a', budget: { maxCostUsd: 1 } }]));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    const d = s.send({ type: 'usage_tick', stageRunId: s.inst('a').id, attemptNo: 1, usage: { costUsd: 1.5, turns: 1 } });
    expect(kinds(d).indexOf('transition')).toBeLessThan(kinds(d).indexOf('abort'));
    expect(only(d, 'abort')[0]).toMatchObject({ reason: 'budget' });
    expect(s.inst('a')).toMatchObject({ status: 'paused', statusReason: 'deterministic:budget_exceeded' });
    expect(s.state.run.usage).toEqual({ costUsd: 1.5, turns: 1 });
  });

  it('an exhausted run budget refuses new launches and pauses the run (budget_exhausted)', () => {
    const s = new Sim(graphOf(['a', 'b'], [['a', 'b']]), { budget: { maxTurns: 3 } });
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.send({ type: 'usage_tick', stageRunId: s.inst('a').id, attemptNo: 1, usage: { turns: 3 } });
    // The run drains: the in-flight stage finishes, nothing new launches.
    expect(s.state.run).toMatchObject({ status: 'paused', statusReason: 'budget_exhausted' });
    expect(s.status('a')).toBe('running');
    const d = s.succeed('a');
    expect(s.statuses()).toEqual({ a: 'completed', b: 'pending' });
    expect(only(d, 'launch')).toEqual([]);
  });

  it('the run wall-clock budget arms a timer and pauses the run when it fires', () => {
    const s = new Sim(graphOf(['a']), { budget: { maxWallClockMs: 60_000 } });
    s.send({ type: 'start' });
    const d = s.send({ type: 'prepared' });
    expect(only(d, 'timer').find((t) => t.kind === 'run_budget_wall_clock')).toMatchObject({ baseDelayMs: 60_000, stageRunId: null });
    s.fire('run_budget_wall_clock', null);
    expect(s.state.run).toMatchObject({ status: 'paused', statusReason: 'budget_exhausted' });
  });
});

describe('concurrency', () => {
  it('maxParallel bounds the admitted instances; a finished one frees a slot', () => {
    const s = new Sim(graphOf(['a', 'b', 'c', 'd'], [], { maxParallel: 2 }));
    const d = s.boot();
    expect(only(d, 'launch').map((l) => l.stageRunId)).toEqual([s.inst('a').id, s.inst('b').id]);
    expect(s.statuses()).toEqual({ a: 'ready', b: 'ready', c: 'ready', d: 'ready' });
    const next = s.succeed('a');
    expect(only(next, 'launch').map((l) => l.stageRunId)).toEqual([s.inst('c').id]);
  });

  it('one live stage per session group (awaiting input holds the group)', () => {
    const s = new Sim(graphOf([{ key: 'a', sessionGroup: 'g' }, { key: 'b', sessionGroup: 'g' }, 'c']));
    const d = s.boot();
    expect(only(d, 'launch').map((l) => l.stageRunId).sort()).toEqual([s.inst('a').id, s.inst('c').id].sort());
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.exec('a', 'awaiting_input', null);
    expect(only(s.send({ type: 'tick' }), 'launch')).toEqual([]);
    s.send({ type: 'command', command: { command: 'approve', instanceId: 'a', outcome: 'approved' } });
    s.exec('a', 'running');
    const done = s.succeed('a');
    expect(only(done, 'launch').map((l) => l.stageRunId)).toEqual([s.inst('b').id]);
  });

  it('cancelRemaining: an any-join that fires cancels its exclusive in-flight predecessors', () => {
    const s = new Sim(
      graphOf(['fast', 'slow', 'slow_up', { key: 'j', join: { mode: 'any', cancelRemaining: true } }, 'other'], [['fast', 'j'], ['slow_up', 'slow'], ['slow', 'j'], ['slow_up', 'other']]),
    );
    s.boot();
    s.exec('slow_up', 'starting');
    s.exec('slow_up', 'running');
    const d = s.succeed('fast');
    expect(s.status('j')).toBe('ready');
    expect(s.inst('slow')).toMatchObject({ status: 'cancelled', skipReason: 'cancelled_loser' });
    // `slow_up` also feeds `other`: not exclusive to the join, so it keeps running.
    expect(s.status('slow_up')).toBe('running');
    expect(only(d, 'abort')).toEqual([]);
  });
});

describe('commands (desired state first)', () => {
  it('run cancel writes cancelled before aborting, then finalizes once the executors stop', () => {
    const s = new Sim(graphOf(['a', 'b', 'c'], [['a', 'c']]));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    const d = s.send({ type: 'command', command: { command: 'cancel' } });
    // Every abort follows the write of that instance's desired state.
    for (const [i, a] of d.entries()) {
      if (a.t !== 'abort') continue;
      expect(d.slice(0, i).some((x) => x.t === 'transition' && x.id === a.stageRunId && x.to === 'cancelled')).toBe(true);
    }
    expect(s.statuses()).toEqual({ a: 'cancelled', b: 'cancelled', c: 'cancelled' });
    expect(s.state.run.status).toBe('cancelling');
    // b was admitted but never claimed: its attempt is settled now; a's executor reports later.
    expect(only(d, 'abort').map((a) => a.stageRunId).sort()).toEqual([s.inst('a').id, s.inst('b').id].sort());
    expect(only(d, 'finalize')).toEqual([]);

    const ack = s.send({ type: 'attempt_settled', stageRunId: s.inst('a').id, attemptNo: 1, outcome: { kind: 'aborted', reason: 'cancel' } });
    expect(only(ack, 'finalize')).toEqual([{ t: 'finalize', outcome: 'cancelled', compensate: [] }]);
    s.send({ type: 'finalized', ok: true });
    expect(s.state.run.status).toBe('cancelled');
    expect(events(s.log.at(-1)!.decisions)).toEqual(['workflow_run.cancelled', 'workflow_run.finalized']);
  });

  it('a cancelled or failed run compensates its completed stages, last completed first', () => {
    const s = new Sim(graphOf([{ key: 'a', compensate: [{ name: 'undo', config: { type: 'restore_checkpoint' } }] }, { key: 'b', compensate: [{ name: 'undo', config: { type: 'restore_checkpoint' } }] }, 'c'], [['a', 'b'], ['b', 'c']]));
    s.boot();
    s.succeed('a');
    s.now += 10;
    s.succeed('b');
    const d = s.send({ type: 'command', command: { command: 'cancel' } });
    s.send({ type: 'attempt_settled', stageRunId: s.inst('c').id, attemptNo: 1, outcome: { kind: 'aborted', reason: 'cancel' } });
    void d;
    const fin = only(s.log.flatMap((l) => l.decisions), 'finalize')[0]!;
    expect(fin).toEqual({ t: 'finalize', outcome: 'cancelled', compensate: [s.inst('b').id, s.inst('a').id] });
  });

  it('run pause (interrupt) pauses in-flight instances and aborts them; resume makes them ready with resume attempts', () => {
    const s = new Sim(graphOf(['a', 'b']));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    const d = s.send({ type: 'command', command: { command: 'pause', mode: 'interrupt' } });
    expect(s.state.run.status).toBe('paused');
    expect(s.statuses()).toEqual({ a: 'paused', b: 'paused' });
    expect(only(d, 'abort').map((a) => a.reason)).toEqual(['pause', 'pause']);
    s.send({ type: 'attempt_settled', stageRunId: s.inst('a').id, attemptNo: 1, outcome: { kind: 'aborted', reason: 'pause' } });
    const r = s.send({ type: 'command', command: { command: 'resume' } });
    expect(s.state.run.status).toBe('running');
    expect(only(r, 'create_attempt').map((c) => [c.attemptNo, c.mode])).toEqual([
      [2, 'resume'],
      [2, 'resume'],
    ]);
  });

  it('run pause (drain) leaves in-flight instances running', () => {
    const s = new Sim(graphOf(['a', 'b']));
    s.boot();
    s.exec('a', 'starting');
    s.send({ type: 'command', command: { command: 'pause', mode: 'drain' } });
    expect(s.statuses()).toEqual({ a: 'starting', b: 'paused' });
  });

  it('instance retry with restart, and a version conflict is refused', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 1 } }]));
    s.boot();
    s.fail('a', classified('auth', 'x'));
    const stale = s.send({ type: 'command', command: { command: 'retry', instanceId: 'a', mode: 'restart', expectedVersion: 0 } });
    expect(stale).toEqual([{ t: 'reject', code: 'version_conflict', message: expect.any(String) }]);
    const ok = s.send({ type: 'command', command: { command: 'retry', instanceId: 'a', mode: 'restart', expectedVersion: s.inst('a').version } });
    expect(only(ok, 'create_attempt')[0]).toMatchObject({ attemptNo: 2, mode: 'restart' });
  });

  it.each<[string, Record<string, unknown>]>([
    ['retry a completed instance', { command: 'retry', instanceId: 'a', mode: 'resume' }],
    ['skip a completed instance', { command: 'skip', instanceId: 'a', as: 'skipped' }],
    ['approve an instance not awaiting input', { command: 'approve', instanceId: 'a', outcome: 'approved' }],
    ['a stage command without an instance', { command: 'fail' }],
    ['an unknown instance', { command: 'cancel', instanceId: 'nope' }],
  ])('refuses: %s', (_label, command) => {
    const s = new Sim(graphOf(['a', 'b'], [['a', 'b']]));
    s.boot();
    s.succeed('a');
    const d = s.send({ type: 'command', command: command as never });
    expect(kinds(d)).toEqual(['reject']);
  });

  it('approve: a live frame gets the verdict; after a restart a resume attempt carries it', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.exec('a', 'awaiting_input', null);
    const live = s.send({ type: 'command', command: { command: 'approve', instanceId: 'a', outcome: 'changes_requested', feedback: 'more tests' } });
    expect(only(live, 'deliver_input')).toEqual([
      { t: 'deliver_input', stageRunId: s.inst('a').id, attemptNo: 1, verdict: { outcome: 'changes_requested', feedback: 'more tests' } },
    ]);
    expect(only(live, 'transition')).toEqual([]); // the executor resumes the parked turn itself

    // After a restart recovery marked the attempt interrupted: no frame.
    s.state = { ...s.state, instances: s.state.instances.map((i) => ({ ...i, attemptStatus: 'interrupted' as const })) };
    const relaunch = s.send({ type: 'command', command: { command: 'approve', instanceId: 'a', outcome: 'approved' } });
    expect(only(relaunch, 'create_attempt')[0]).toEqual({
      t: 'create_attempt',
      stageRunId: s.inst('a').id,
      attemptNo: 2,
      mode: 'resume',
      overrides: { verdict: { outcome: 'approved' } },
    });
  });

  it('frame_lost: an in-turn gate lost to a restart pauses the instance (interrupted); a completion review stays parked', () => {
    const s = new Sim(graphOf(['a', 'b']));
    s.boot();
    for (const path of ['a', 'b']) {
      s.exec(path, 'starting');
      s.exec(path, 'running');
      s.exec(path, 'awaiting_input', null);
    }
    const withKind = (path: string, kind: string) =>
      (s.state = { ...s.state, instances: s.state.instances.map((i) => (i.instancePath === path ? { ...i, interruptData: { kind } } : i)) });
    withKind('a', 'tool_permission');
    withKind('b', 'stage_completion_review');
    const lost = s.send({ type: 'frame_lost', stageRunId: s.inst('a').id, attemptNo: 1 });
    expect(s.inst('a')).toMatchObject({ status: 'paused', statusReason: 'interrupted', attemptStatus: 'aborted' });
    expect(events(lost)).toContain('stage_run.paused');
    s.send({ type: 'frame_lost', stageRunId: s.inst('b').id, attemptNo: 1 });
    expect(s.inst('b')).toMatchObject({ status: 'awaiting_input', attemptStatus: 'aborted' });
    // A resume re-sends the interrupted turn in a new attempt.
    s.send({ type: 'command', command: { command: 'resume', instanceId: 'a' } });
    expect(s.status('a')).toBe('ready');
    expect(only(s.log.at(-1)!.decisions, 'create_attempt')[0]).toMatchObject({ attemptNo: 2, mode: 'resume' });
  });

  it('an operator skip override skips the stage instead of launching it', () => {
    const s = new Sim(graphOf(['a', 'b'], [['a', 'b']]), { skipKeys: ['a'] });
    s.boot();
    expect(s.inst('a')).toMatchObject({ status: 'skipped', skipReason: 'operator' });
  });

  it('approve rejected fails the stage (routing applies) and stops the frame', () => {
    const s = new Sim(graphOf(['a', 'fix'], [{ from: 'a', to: 'fix', on: 'failure' }]));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.exec('a', 'awaiting_input', null);
    const d = s.send({ type: 'command', command: { command: 'approve', instanceId: 'a', outcome: 'rejected', feedback: 'wrong' } });
    expect(s.inst('a')).toMatchObject({ status: 'failed', errorCode: 'rejected_by_human' });
    expect(s.status('fix')).toBe('ready');
    expect(only(d, 'abort')[0]).toMatchObject({ stageRunId: s.inst('a').id });
  });
});

describe('timers', () => {
  it('queue_timeout fails an admitted instance that was never claimed', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    const d = s.fire('queue_timeout', 'a');
    expect(s.inst('a')).toMatchObject({ status: 'failed', errorCode: 'queue_timeout' });
    expect(only(d, 'abort')[0]).toMatchObject({ reason: 'queue_timeout' });
    // Once claimed, the timer is moot.
    const s2 = new Sim(graphOf(['a']));
    s2.boot();
    s2.exec('a', 'starting');
    expect(s2.fire('queue_timeout', 'a')).toEqual([]);
  });

  it('PD-2: an unattended pause arms a 72 h TTL that fails the stage', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 1 } }]), { unattended: true });
    s.boot();
    const d = s.fail('a', classified('auth', 'x'));
    expect(only(d, 'timer').find((t) => t.kind === 'pause_ttl')).toMatchObject({ baseDelayMs: PAUSE_TTL_MS, stageRunId: s.inst('a').id });
    s.fire('pause_ttl', 'a');
    expect(s.inst('a')).toMatchObject({ status: 'failed', errorCode: 'pause_expired' });
    expect(s.state.run.outcome).toBe('failed');
  });

  it('PD-2: an unattended run paused past its TTL fails', () => {
    const s = new Sim(graphOf(['a']), { unattended: true });
    s.boot();
    const d = s.send({ type: 'command', command: { command: 'pause', mode: 'drain' } });
    expect(only(d, 'timer').filter((t) => t.kind === 'pause_ttl').map((t) => t.stageRunId)).toEqual([null]);
    s.fire('pause_ttl', null);
    expect(s.state.run).toMatchObject({ status: 'finalizing', outcome: 'failed', statusReason: 'pause_expired' });
  });
});

describe('determinism (G5 §5.3)', () => {
  const script = (s: Sim): Decision[][] => {
    const out: Decision[][] = [];
    out.push(s.boot());
    out.push(s.fail('a', classified('overloaded', 'busy')));
    out.push(s.fire('retry', 'a'));
    out.push(s.succeed('a', { data: { n: 1 } }));
    out.push(s.succeed('b'));
    out.push(s.send({ type: 'finalized', ok: true }));
    return out;
  };

  it('the same messages from the same state give byte-identical decisions and ids', () => {
    const g = graphOf(['a', 'b', 'c'], [['a', 'b'], { from: 'a', to: 'c', on: 'failure' }]);
    const one = JSON.stringify(script(new Sim(g)));
    const two = JSON.stringify(script(new Sim(g)));
    expect(one).toBe(two);
    expect(one).toContain(instanceId('run-1', 'a'));
    expect(attemptId(instanceId('run-1', 'a'), 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
