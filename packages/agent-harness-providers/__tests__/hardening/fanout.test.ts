// ────────────────────────────────────────────────────────────────
// W13 — boundedFanOut: concurrency, ORDER, and the two timeouts.
//
// The plan's acceptance criterion is "named tests for each"; the names below
// are the mechanism names.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';

import {
  boundedFanOut,
  boundedFanOutMapped,
  DEFAULT_MAX_PARALLEL_TOOLS,
  FanOutAbortError,
  type FanOutFailure,
} from '../../src/hardening/fanout.js';
import { PoisonPillRegistry } from '../../src/hardening/poisonPill.js';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('W13 — MAX_PARALLEL_TOOLS = 8', () => {
  it('defaults to a concurrency of 8', () => {
    expect(DEFAULT_MAX_PARALLEL_TOOLS).toBe(8);
  });

  it('never runs more than `concurrency` workers at once', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);

    await boundedFanOut(
      items,
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 1));
        active -= 1;
      },
      { concurrency: 8 },
    );

    expect(maxActive).toBe(8);
    expect(active).toBe(0);
  });
});

describe('W13 — order-preserving parallel results', () => {
  it('returns results in EMISSION order, not completion order', async () => {
    // Deliberately inverted: the last item finishes first.
    const delays = [50, 40, 30, 20, 10, 0];
    const completionOrder: number[] = [];

    const outcomes = await boundedFanOut(
      delays,
      async (delay, { index }) => {
        await new Promise((r) => setTimeout(r, delay));
        completionOrder.push(index);
        return `result-${index}`;
      },
      { concurrency: 8 },
    );

    // Completion really was inverted — otherwise the assertion below is vacuous.
    expect(completionOrder[0]).toBe(delays.length - 1);
    expect(outcomes.map((o) => (o.status === 'fulfilled' ? o.value : o.kind))).toEqual([
      'result-0', 'result-1', 'result-2', 'result-3', 'result-4', 'result-5',
    ]);
    expect(outcomes.map((o) => o.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps position for a FAILED item instead of collapsing the batch', async () => {
    const outcomes = await boundedFanOut(
      [0, 1, 2],
      async (_item, { index }) => {
        if (index === 1) throw new Error('item one is broken');
        return index;
      },
    );

    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 0 });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', kind: 'error' });
    expect(outcomes[2]).toMatchObject({ status: 'fulfilled', value: 2 });
    // Promise.all would have lost items 0 and 2 entirely.
    expect(outcomes).toHaveLength(3);
  });

  it('boundedFanOutMapped substitutes a value per failure, in position', async () => {
    const values = await boundedFanOutMapped(
      ['a', 'b', 'c'],
      async (item) => {
        if (item === 'b') throw new Error('nope');
        return item.toUpperCase();
      },
      (failure) => `FAILED(${failure.kind})`,
    );
    expect(values).toEqual(['A', 'FAILED(error)', 'C']);
  });
});

describe('W13 — per-item fan-out timeout', () => {
  it('reaps ONLY the slow item and lets the rest through', async () => {
    const outcomes = await boundedFanOut(
      [10, 5_000, 10],
      async (delay) => {
        await new Promise((r) => setTimeout(r, delay));
        return delay;
      },
      { perItemTimeoutMs: 120, overallTimeoutMs: 5_000 },
    );

    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 10 });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', kind: 'per-item-timeout' });
    expect(outcomes[2]).toMatchObject({ status: 'fulfilled', value: 10 });
    expect((outcomes[1] as FanOutFailure).reason.message).toMatch(/per-item budget of 120ms/);
  });

  it('aborts the item signal so a cooperative worker can stop', async () => {
    let sawAbort = false;
    await boundedFanOut(
      [0],
      async (_item, { signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { sawAbort = true; resolve(); }, { once: true });
        });
      },
      { perItemTimeoutMs: 50, overallTimeoutMs: 2_000 },
    );
    expect(sawAbort).toBe(true);
  });

  it('clears the per-item timer when the item finishes in time', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const before = clearSpy.mock.calls.length;
    await boundedFanOut([0, 1, 2], async (i) => i, { perItemTimeoutMs: 10_000 });
    // One per item plus the overall timer. An uncleared timer keeps the event
    // loop alive and, per tool call, leaks a handle in a long-lived provider.
    expect(clearSpy.mock.calls.length - before).toBeGreaterThanOrEqual(4);
    clearSpy.mockRestore();
  });
});

describe('W13 — overall fan-out timeout', () => {
  it('returns within the overall budget even though a worker never settles', async () => {
    const never = deferred<number>();
    const started = Date.now();

    const outcomes = await boundedFanOut(
      [0, 1],
      async (_item, { index }) => (index === 0 ? 'fast' : never.promise),
      // Per-item budget deliberately LONGER than the overall one, so only the
      // overall bound can end this. That is the case the plan calls out: a
      // per-item timer alone does not bound the batch.
      { perItemTimeoutMs: 60_000, overallTimeoutMs: 200 },
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 'fast' });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', kind: 'overall-timeout' });
    expect((outcomes[1] as FanOutFailure).reason.message).toMatch(/overall budget of 200ms/);

    // Nothing is left dangling: every item has an outcome even though one
    // worker is still, right now, unresolved.
    expect(outcomes).toHaveLength(2);
    never.resolve(0);
  });

  it('reports queued-but-never-started items rather than dropping them', async () => {
    const never = deferred<number>();
    const outcomes = await boundedFanOut(
      [0, 1, 2, 3],
      async () => never.promise,
      { concurrency: 1, perItemTimeoutMs: 60_000, overallTimeoutMs: 150 },
    );
    expect(outcomes).toHaveLength(4);
    for (const o of outcomes) {
      expect(o.status).toBe('rejected');
      expect((o as FanOutFailure).kind).toBe('overall-timeout');
    }
    never.resolve(0);
  });

  it('a late rejection from an abandoned worker does not become unhandled', async () => {
    const late = deferred<number>();
    const outcomes = await boundedFanOut(
      [0],
      async () => late.promise,
      { perItemTimeoutMs: 60_000, overallTimeoutMs: 100 },
    );
    expect(outcomes[0]).toMatchObject({ status: 'rejected', kind: 'overall-timeout' });
    late.reject(new Error('the abandoned worker failed after we returned'));
    // If the rejection were unhandled, this tick is where the process would
    // record it. Awaiting proves the swallow in `boundedFanOut` is in place.
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('W13 — abort threading', () => {
  it('settles every item as `aborted` when the caller signal fires', async () => {
    const ac = new AbortController();
    const never = deferred<number>();
    const promise = boundedFanOut(
      [0, 1, 2],
      async () => never.promise,
      { signal: ac.signal, perItemTimeoutMs: 60_000, overallTimeoutMs: 60_000 },
    );
    setTimeout(() => ac.abort(), 20);
    const outcomes = await promise;
    for (const o of outcomes) {
      expect(o.status).toBe('rejected');
      expect((o as FanOutFailure).kind).toBe('aborted');
    }
    never.resolve(0);
  });

  it('settles immediately when the caller signal is ALREADY aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    let ran = false;
    const outcomes = await boundedFanOut([0, 1], async () => { ran = true; }, { signal: ac.signal });
    expect(ran).toBe(false);
    expect(outcomes.every((o) => o.status === 'rejected')).toBe(true);
  });
});

describe('W13 — poison-pill downgrade inside a fan-out', () => {
  it('quarantines a repeatedly-failing key and fails the rest of the batch FAST', async () => {
    const poison = new PoisonPillRegistry({ downgradeAfter: 2, quarantineAfter: 3 });
    let invocations = 0;

    // 30 calls, 8 permits: the batch cannot fit in one wave, which is exactly
    // when a poison pill starves the healthy work — the later waves are the
    // ones the ladder has to protect.
    const outcomes = await boundedFanOut(
      Array.from({ length: 30 }, () => 'BrokenTool'),
      async () => {
        invocations += 1;
        throw new Error('the tool is wedged');
      },
      { concurrency: 8, poison, keyOf: () => 'BrokenTool', perItemTimeoutMs: 1_000 },
    );

    expect(outcomes).toHaveLength(30);
    const kinds = outcomes.map((o) => (o as FanOutFailure).kind);
    expect(kinds.filter((k) => k === 'poisoned').length).toBeGreaterThan(0);
    // The whole point: the broken tool stopped consuming the batch's budget.
    // The first wave runs before any failure has been recorded; nothing after
    // the quarantine trips may execute at all.
    expect(invocations).toBeLessThanOrEqual(8);
    expect(poison.statusOf('BrokenTool')).toBe('quarantined');

    const poisonedReason = (outcomes.find((o) => (o as FanOutFailure).kind === 'poisoned') as FanOutFailure).reason;
    expect(poisonedReason).toBeInstanceOf(FanOutAbortError);
    expect(poisonedReason.message).toMatch(/disabled for the rest of this batch/);
  });

  it('does not penalise a healthy key sharing the batch with a poisoned one', async () => {
    const poison = new PoisonPillRegistry({ downgradeAfter: 2, quarantineAfter: 3 });
    const items = ['bad', 'good', 'bad', 'good', 'bad', 'good', 'bad', 'good'];

    const outcomes = await boundedFanOut(
      items,
      async (item) => {
        if (item === 'bad') throw new Error('wedged');
        return 'ok';
      },
      { concurrency: 8, poison, keyOf: (item) => item, perItemTimeoutMs: 1_000 },
    );

    for (let i = 0; i < items.length; i++) {
      if (items[i] === 'good') expect(outcomes[i]).toMatchObject({ status: 'fulfilled', value: 'ok' });
    }
    expect(poison.statusOf('good')).toBe('healthy');
  });
});
