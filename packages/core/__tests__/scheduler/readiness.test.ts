// P03 WP-3.3 (R-7) — readiness v2 and scope outcome as tables (G5 §4.1, §3.6).

import { describe, expect, it } from 'vitest';

import { computeScopeOutcome, readiness, type InstanceState, type PredState } from '../../src/domain/scheduler/index.js';
import type { CompiledNode } from '../../src/domain/workflow-graph/index.js';
import { graphOf } from './harness.js';

function inst(id: string, over: Partial<InstanceState> = {}): InstanceState {
  return {
    id,
    stageKey: id,
    instancePath: id,
    scopeId: null,
    status: 'pending',
    statusReason: null,
    version: 0,
    currentAttempt: 0,
    attemptStatus: null,
    failedAttempts: 0,
    skipReason: null,
    skipCauseId: null,
    gateAs: null,
    output: null,
    summary: null,
    interruptData: null,
    errorCode: null,
    usage: {},
    leaseOwner: null,
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

const node = (join: CompiledNode['join']): CompiledNode => ({ ...graphOf(['x']).nodes.get('x')!, join });
const preds = (...states: PredState[]) => states.map((state, i) => ({ instance: inst(`p${i}`), state }));

describe('readiness (join policies, per predecessor)', () => {
  it.each<[string, CompiledNode['join'], PredState[], string]>([
    // all
    ['all: no predecessors', { mode: 'all' }, [], 'ready'],
    ['all: every predecessor active', { mode: 'all' }, ['active', 'active'], 'ready'],
    ['all: one pending blocks', { mode: 'all' }, ['active', 'pending'], 'blocked'],
    ['all: a dead predecessor vetoes even with one pending', { mode: 'all' }, ['dead', 'pending'], 'skip:join_unsatisfiable'],
    ['all: neutral is ignored when another is active (T2 join)', { mode: 'all' }, ['active', 'neutral'], 'ready'],
    ['all: only neutral → upstream_skipped (S1)', { mode: 'all' }, ['neutral'], 'skip:upstream_skipped'],
    // any
    ['any: first active wins', { mode: 'any', cancelRemaining: false }, ['active', 'pending'], 'ready'],
    ['any: active beside dead (S4 OR-join)', { mode: 'any', cancelRemaining: false }, ['active', 'dead'], 'ready'],
    ['any: pending blocks without an active', { mode: 'any', cancelRemaining: false }, ['dead', 'pending'], 'blocked'],
    ['any: every predecessor dead', { mode: 'any', cancelRemaining: false }, ['dead', 'dead'], 'skip:join_unsatisfiable'],
    ['any: every predecessor neutral', { mode: 'any', cancelRemaining: false }, ['neutral', 'neutral'], 'skip:upstream_skipped'],
    // n_of_m
    ['2 of 3: two active', { mode: 'n_of_m', n: 2, cancelRemaining: false }, ['active', 'active', 'pending'], 'ready'],
    ['2 of 3: one active, one pending', { mode: 'n_of_m', n: 2, cancelRemaining: false }, ['active', 'pending', 'dead'], 'blocked'],
    ['2 of 3: can no longer reach n', { mode: 'n_of_m', n: 2, cancelRemaining: false }, ['active', 'dead', 'neutral'], 'skip:join_unsatisfiable'],
  ])('%s', (_label, join, states, expected) => {
    const r = readiness(node(join), preds(...states));
    expect(r.kind === 'skip' ? `skip:${r.reason}` : r.kind).toBe(expected);
  });

  it('an edge `when` that cannot be evaluated fails the node (never a silent skip)', () => {
    const r = readiness(node({ mode: 'all' }), [{ instance: inst('p'), state: 'dead', error: 'boom' }]);
    expect(r).toEqual({ kind: 'fail', code: 'condition_error', message: 'boom' });
  });

  it('a skip names the predecessor that caused it', () => {
    const r = readiness(node({ mode: 'all' }), [{ instance: inst('a'), state: 'active' }, { instance: inst('b'), state: 'dead' }]);
    expect(r).toEqual({ kind: 'skip', reason: 'join_unsatisfiable', causeId: 'b' });
  });
});

describe('computeScopeOutcome (W-29, B-16)', () => {
  const scope = () => ({});
  it.each<[string, Array<string | { key: string }>, Array<Record<string, unknown>>, Record<string, Partial<InstanceState>>, string]>([
    ['all completed', ['a', 'b'], [{ from: 'a', to: 'b' }], { a: { status: 'completed' }, b: { status: 'completed' } }, 'completed'],
    [
      'S3: a notify stage on `completion` does not mask the failure',
      ['a', 'notify'],
      [{ from: 'a', to: 'notify', on: 'completion' }],
      { a: { status: 'failed' }, notify: { status: 'completed' } },
      'failed',
    ],
    [
      '`completion` with handlesFailure absorbs it',
      ['a', 'notify'],
      [{ from: 'a', to: 'notify', on: 'completion', handlesFailure: true }],
      { a: { status: 'failed' }, notify: { status: 'completed' } },
      'completed',
    ],
    [
      'an on-failure handler that completed absorbs it',
      ['a', 'fix'],
      [{ from: 'a', to: 'fix', on: 'failure' }],
      { a: { status: 'failed' }, fix: { status: 'completed' } },
      'completed',
    ],
    [
      'a handler that itself failed unhandled does not',
      ['a', 'fix'],
      [{ from: 'a', to: 'fix', on: 'failure' }],
      { a: { status: 'failed' }, fix: { status: 'failed' } },
      'failed',
    ],
    [
      'a handled chain: a → fix (failed) → fix2 (completed)',
      ['a', 'fix', 'fix2'],
      [{ from: 'a', to: 'fix', on: 'failure' }, { from: 'fix', to: 'fix2', on: 'failure' }],
      { a: { status: 'failed' }, fix: { status: 'failed' }, fix2: { status: 'completed' } },
      'completed',
    ],
    ['an unhandled cancel', ['a', 'b'], [], { a: { status: 'completed' }, b: { status: 'cancelled' } }, 'cancelled'],
    ['a cancelled join loser is handled', ['a', 'b'], [], { a: { status: 'completed' }, b: { status: 'cancelled', skipReason: 'cancelled_loser' } }, 'completed'],
    ['a failure beats a cancel', ['a', 'b'], [], { a: { status: 'failed' }, b: { status: 'cancelled' } }, 'failed'],
    ['skipped instances are neutral', ['a', 'b'], [{ from: 'a', to: 'b' }], { a: { status: 'completed' }, b: { status: 'skipped' } }, 'completed'],
  ])('%s', (_label, stages, edges, states, expected) => {
    const g = graphOf(stages, edges as never);
    const instances = Object.entries(states).map(([k, over]) => inst(k, over));
    expect(computeScopeOutcome(g, instances, scope)).toBe(expected);
  });
});
