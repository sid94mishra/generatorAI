// Regressions of the final review (ENGINE-R5, R6, R12; ECON-R5): what a
// pause, a carried verdict and the run wall clock must keep.

import { describe, expect, it } from 'vitest';
import { classified } from '../../src/domain/errors/StageError.js';
import { graphOf, only, Sim } from './harness.js';

describe('retry mode across a pause (ENGINE-R5)', () => {
  it('a restart retry stays a restart through a run pause/resume, and waits out its backoff again', () => {
    const s = new Sim(graphOf(['a']));
    s.boot();
    s.fail('a', classified('output_schema', 'bad json'));
    expect(s.inst('a').statusReason).toBe('retry:restart');
    s.send({ type: 'command', command: { command: 'pause', mode: 'drain' } });
    expect(s.status('a')).toBe('paused');
    const r = s.send({ type: 'command', command: { command: 'resume' } });
    expect(s.status('a')).toBe('retry_wait');
    expect(only(r, 'timer').some((t) => t.kind === 'retry')).toBe(true);
    const ca = only(s.fire('retry', 'a'), 'create_attempt')[0];
    expect(ca?.mode).toBe('restart');
  });

  it('a stage-level pause of a retry keeps its mode', () => {
    const s = new Sim(graphOf([{ key: 'a', retry: { maxAttempts: 3, mode: 'restart', initialDelayMs: 60_000 } }]));
    s.boot();
    s.fail('a', classified('overloaded', 'busy'));
    s.send({ type: 'command', command: { command: 'pause', instanceId: 'a', mode: 'drain' } });
    s.send({ type: 'command', command: { command: 'resume', instanceId: 'a' } });
    expect(s.status('a')).toBe('retry_wait');
    expect(only(s.fire('retry', 'a'), 'create_attempt')[0]?.mode).toBe('restart');
  });
});

describe('a carried verdict rides a resume only (ENGINE-R6)', () => {
  it('approve with no frame, pause before the claim, retry restart: the restart carries no verdict', () => {
    const s = new Sim(graphOf([{ key: 'a', approval: {} }]));
    s.boot();
    s.exec('a', 'starting');
    s.exec('a', 'running');
    s.exec('a', 'awaiting_input', null);
    s.state = { ...s.state, instances: s.state.instances.map((i) => ({ ...i, attemptStatus: 'aborted' as const })) };
    const d1 = s.send({ type: 'command', command: { command: 'approve', instanceId: 'a', outcome: 'approved' } });
    expect(only(d1, 'create_attempt')[0]?.overrides).toMatchObject({ verdict: { outcome: 'approved' } });
    expect(s.inst('a').interruptData).toBeNull();
    s.send({ type: 'command', command: { command: 'pause', instanceId: 'a', mode: 'drain' } });
    const d = s.send({ type: 'command', command: { command: 'retry', instanceId: 'a', mode: 'restart' } });
    const ca = only(d, 'create_attempt')[0];
    expect(ca?.mode).toBe('restart');
    expect(ca?.overrides).toBeUndefined();
  });
});

describe('the run wall clock (ENGINE-R12, ECON-R5)', () => {
  it('its timer firing while the run is paused is not lost: resume re-arms what is left, or refuses when it is spent', () => {
    const s = new Sim(graphOf(['a', 'b'], [['a', 'b']]), { budget: { maxWallClockMs: 10_000 } });
    s.boot();
    s.send({ type: 'command', command: { command: 'pause', mode: 'drain' } });
    s.now += 4_000;
    const r = s.send({ type: 'command', command: { command: 'resume' } });
    const t = only(r, 'timer').find((x) => x.kind === 'run_budget_wall_clock');
    expect(t?.baseDelayMs).toBe(6_000);
    s.send({ type: 'command', command: { command: 'pause', mode: 'drain' } });
    s.now += 20_000;
    s.fire('run_budget_wall_clock', null); // dropped while paused
    const again = s.send({ type: 'command', command: { command: 'resume' } });
    expect(only(again, 'reject')[0]?.code).toBe('invalid_state');
    expect(s.state.run.status).toBe('paused');
  });

  it('a raise that leaves the wall clock spent keeps a budget-paused run paused', () => {
    const s = new Sim(graphOf(['a']), { budget: { maxWallClockMs: 1_000, maxCostUsd: 1 } });
    s.boot();
    s.now += 2_000;
    s.fire('run_budget_wall_clock', null);
    expect(s.state.run).toMatchObject({ status: 'paused', statusReason: 'budget_exhausted' });
    s.send({ type: 'command', command: { command: 'raise_budget', maxCostUsd: 5 } });
    expect(s.state.run.status).toBe('paused');
    const d = s.send({ type: 'command', command: { command: 'raise_budget', maxWallClockMs: 60_000 } });
    expect(s.state.run.status).toBe('running');
    expect(only(d, 'timer').some((x) => x.kind === 'run_budget_wall_clock')).toBe(true);
  });
});
