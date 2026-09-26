// ────────────────────────────────────────────────────────────────
// P03 WP-3.6 — the RunActor's contract over a scripted store (G5 §5.2):
// strictly serial processing, re-decide on a lost CAS (at most three
// times), retirement when fenced (RV-27), effects only after a commit,
// command rejections without a write. The SQLite store and whole runs are
// covered by the db and testkit suites.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { ApplyContext, ApplyResult, IRunStore } from '../../src/domain/ports/IRunStore.js';
import type { Decision, RunState } from '../../src/domain/scheduler/types.js';
import { RunActor } from '../../src/services/engine/RunActor.js';
import { graphOf } from '../scheduler/harness.js';

function state(status: RunState['run']['status'] = 'created'): RunState {
  return {
    run: { id: 'r', name: 'r', status, statusReason: null, outcome: null, version: 0, variables: {}, codebases: {}, usage: {}, budget: null, unattended: false, startedAt: null },
    instances: [],
  };
}

class ScriptedStore implements IRunStore {
  readonly applied: Array<{ epoch: number; decisions: readonly Decision[]; ctx: ApplyContext }> = [];
  loads = 0;
  constructor(
    private readonly results: ApplyResult[],
    private readonly current: () => RunState = () => state(),
  ) {}
  loadRunState(): RunState {
    this.loads += 1;
    return this.current();
  }
  apply(_runId: string, ownerEpoch: number, decisions: readonly Decision[], ctx: ApplyContext): ApplyResult {
    this.applied.push({ epoch: ownerEpoch, decisions, ctx });
    return this.results.shift() ?? { ok: true, effects: decisions.filter((d) => d.t === 'prepare'), timers: [], outbox: [], journalSeq: 1 };
  }
}

function actor(store: IRunStore, hooks: { dispatched?: unknown[]; fenced?: string[]; terminal?: string[] } = {}) {
  return new RunActor({
    runId: 'r',
    ownerEpoch: 7,
    compiled: graphOf(['a']),
    store,
    dispatch: (_id, res) => hooks.dispatched?.push(res.effects.map((e) => e.t)),
    onFenced: (id) => hooks.fenced?.push(id),
    onTerminal: (id) => hooks.terminal?.push(id),
    now: () => 1_000,
  });
}

describe('RunActor', () => {
  it('applies one batch fenced by its epoch, journals the message, dispatches after the commit', async () => {
    const store = new ScriptedStore([]);
    const dispatched: unknown[] = [];
    const r = await actor(store, { dispatched }).post({ type: 'start' });
    expect(r.ok).toBe(true);
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0]!.epoch).toBe(7);
    expect(store.applied[0]!.ctx.message).toEqual({ type: 'start' });
    expect(store.applied[0]!.ctx.stateHash).toMatch(/^[0-9a-f]{16}$/);
    expect(dispatched).toEqual([['prepare']]);
  });

  it('a lost CAS re-reads and re-decides; after three losses it gives up without dispatching', async () => {
    const conflict: ApplyResult = { ok: false, reason: 'conflict', detail: 'raced' };
    const store = new ScriptedStore([conflict, conflict]);
    const dispatched: unknown[] = [];
    expect((await actor(store, { dispatched }).post({ type: 'start' })).ok).toBe(true);
    expect(store.loads).toBe(3);
    expect(dispatched).toHaveLength(1);

    const stuck = new ScriptedStore([conflict, conflict, conflict]);
    const none: unknown[] = [];
    const r = await actor(stuck, { dispatched: none }).post({ type: 'start' });
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
    expect(stuck.applied).toHaveLength(3);
    expect(none).toEqual([]);
  });

  it('fenced: the actor retires, reports it, and refuses later messages', async () => {
    const store = new ScriptedStore([{ ok: false, reason: 'fenced', detail: 'epoch 8 now' }]);
    const fenced: string[] = [];
    const a = actor(store, { fenced });
    expect(await a.post({ type: 'start' })).toMatchObject({ ok: false, reason: 'fenced' });
    expect(fenced).toEqual(['r']);
    expect(a.isRetired).toBe(true);
    expect(await a.post({ type: 'tick' })).toMatchObject({ ok: false, reason: 'retired' });
    expect(store.applied).toHaveLength(1);
  });

  it('a refused command writes nothing and carries the reason', async () => {
    const store = new ScriptedStore([]);
    const r = await actor(store).post({ type: 'command', command: { command: 'resume' } });
    expect(r).toMatchObject({ ok: true, rejected: { code: 'invalid_state' } });
    expect(store.applied).toEqual([]);
  });

  it('processes strictly in order: a message posted while one is processed waits its turn', async () => {
    const order: string[] = [];
    let a!: RunActor;
    const s2 = new (class extends ScriptedStore {
      override apply(runId: string, epoch: number, d: readonly Decision[], ctx: ApplyContext): ApplyResult {
        order.push(`apply:${(ctx.message as { type: string }).type}`);
        if ((ctx.message as { type: string }).type === 'start') void a.post({ type: 'prepared' }).then(() => order.push('prepared-done'));
        return super.apply(runId, epoch, d, ctx);
      }
    })([], () => state(order.includes('apply:start') ? 'starting' : 'created'));
    a = actor(s2);
    await a.post({ type: 'start' }).then(() => order.push('start-done'));
    await new Promise((r) => setTimeout(r, 0));
    // The nested post was not processed inside the first apply: it queued behind it.
    expect(order.filter((o) => o.startsWith('apply:'))).toEqual(['apply:start', 'apply:prepared']);
    expect(order).toContain('prepared-done');
  });
});
