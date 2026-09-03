// ────────────────────────────────────────────────────────────────
// Performance budgets for the hot paths (Phase 9 items 1/2).
//
// The audit's §6.4 table names eight budgets. Four of them are properties of
// a running terminal (cold start, paint rate, idle CPU, resize recovery) and
// cannot be measured from a unit test — those belong to the real-console
// smoke tests. The four that ARE properties of this code are measured here,
// because they are the ones a refactor silently breaks:
//
//   - "Stream ingest to queued model update: p95 below 16 ms"
//   - "Heap growth during a soak: bounded" — enforced as a hard item cap
//   - "Token events clone timeline state and may scan/map retained items"
//   - "REST hydration can push a timeline beyond its nominal retention bound"
//
// The timing assertions are deliberately loose (10× the budget). A unit test
// on shared CI hardware cannot certify a p95, and a tight threshold would
// fail for reasons that have nothing to do with the code. What it CAN catch
// is the class of regression that matters here: an accidental O(n²) in the
// reducer, which does not miss the budget by 20% — it misses it by three
// orders of magnitude once a timeline is a few thousand items deep.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMELINE_RETENTION,
  emptyTimeline,
  mergeHistoryIntoTimeline,
  reduceEvent,
  timelineFromHistory,
  type StreamEvent,
  type TimelineState,
} from '../runTimeline.js';

// `text`, not `delta` — the real field every provider broadcasts
// (`AcpProvider`/`CodexProvider`/`FauxProvider` all send `{ text }`, and
// `AgentEvent.ts` declares it). A token event whose payload the reducer
// cannot read returns the state UNCHANGED, so a benchmark built on the
// wrong field measures the early-return path and reports a throughput
// number for work that never happened.
const token = (text: string): StreamEvent => ({ kind: 'harness.token', data: { text } });

/** Milliseconds for the slowest single call in `runs`. */
function slowest(runs: number, body: (index: number) => void): number {
  let worst = 0;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    body(i);
    worst = Math.max(worst, performance.now() - start);
  }
  return worst;
}

/**
 * Median milliseconds per call.
 *
 * The median, not the maximum, for anything that COMPARES two measurements.
 * Vitest runs ~30 test files concurrently, so the slowest single iteration of
 * a microsecond-scale loop is whatever the OS scheduler did to that thread —
 * a max-vs-max ratio measures the scheduler and fails at random. The median
 * is stable under that load and still moves by orders of magnitude for the
 * regression this is here to catch.
 */
function median(runs: number, body: (index: number) => void): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    body(i);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

describe('timeline retention bound', () => {
  it('holds the cap under a sustained event stream', () => {
    // "Heap growth during a two-hour 100 events/s soak: bounded." The
    // mechanism that makes it bounded is this cap; if it stops holding, the
    // soak has nothing left to bound it.
    let state = emptyTimeline();
    for (let i = 0; i < 5000; i++) {
      state = reduceEvent(state, { kind: 'harness.message_complete', data: { content: `m${i}` } }, {
        maxItems: 100,
      });
    }
    expect(state.items.length).toBeLessThanOrEqual(100);
    // And it keeps the NEWEST, not an arbitrary window.
    expect(state.items.at(-1)?.text).toContain('4999');
  });

  it('caps history hydration too — the bound applied to only one path before', () => {
    // Audit §6.4: "REST hydration can push a timeline beyond its nominal
    // retention bound." It did: `maxItems` was a `reduceEvent` option, and
    // history went in through a different door.
    const messages = Array.from({ length: 5000 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      content: `message ${i}`,
      timestamp: i,
    }));

    const hydrated = timelineFromHistory(messages);
    expect(hydrated.items.length).toBe(DEFAULT_TIMELINE_RETENTION);
    // The TAIL of the conversation is what a reopened pane needs.
    expect(hydrated.items.at(-1)?.text).toBe('message 4999');
  });

  it('caps the MERGE of history under live items, not just each side', () => {
    // Two individually-capped halves still exceed the cap once concatenated,
    // which is precisely what the old `[...history, ...live]` did.
    const live: TimelineState = {
      ...emptyTimeline(),
      items: Array.from({ length: 80 }, (_, i) => ({
        id: `live${i}`,
        kind: 'assistant' as const,
        text: `live ${i}`,
        complete: true,
        at: 1000 + i,
      })),
    };
    const history: TimelineState = {
      ...emptyTimeline(),
      items: Array.from({ length: 80 }, (_, i) => ({
        id: `hist${i}`,
        kind: 'user' as const,
        text: `hist ${i}`,
        complete: true,
        at: i,
      })),
    };

    const merged = mergeHistoryIntoTimeline(live, history, { maxItems: 100 });
    expect(merged.items).toHaveLength(100);
    // Trimmed from the OLDEST end — live events are newer than anything on
    // disk, so they must all survive.
    expect(merged.items.at(-1)?.id).toBe('live79');
    expect(merged.items.filter((item) => item.id.startsWith('live'))).toHaveLength(80);
  });

  it('keeps live items when there is no history, and history when there is no live', () => {
    const history = timelineFromHistory([
      { id: 'a', role: 'user', content: 'hi', timestamp: 1 },
    ]);
    expect(mergeHistoryIntoTimeline(undefined, history).items).toHaveLength(1);
    expect(mergeHistoryIntoTimeline(emptyTimeline(), history).items).toHaveLength(1);
  });
});

describe('reducer cost', () => {
  it('reduces one token event in constant time regardless of timeline depth', () => {
    // "Token events clone timeline state and may scan/map retained items."
    // A per-event scan of the retained list is the regression this catches:
    // at the 2000-item bound it is 2000× the work of a constant-time append,
    // on the hottest path in the app.
    const shallow = emptyTimeline();
    let deep = emptyTimeline();
    for (let i = 0; i < DEFAULT_TIMELINE_RETENTION; i++) {
      deep = reduceEvent(deep, { kind: 'harness.message_complete', data: { content: `m${i}` } });
    }
    expect(deep.items.length).toBe(DEFAULT_TIMELINE_RETENTION);

    // Warm both paths first so the comparison is not measuring JIT.
    for (let i = 0; i < 200; i++) {
      reduceEvent(shallow, token('x'));
      reduceEvent(deep, token('x'));
    }

    const shallowMedian = median(2000, () => void reduceEvent(shallow, token('x')));
    const deepMedian = median(2000, () => void reduceEvent(deep, token('x')));

    // Two independent guards, both deliberately loose. A per-event scan of
    // the retained list is 2000× the work of an append at the bound, so a
    // real regression blows past either by orders of magnitude; scheduler
    // noise moves neither.
    expect(deepMedian).toBeLessThan(1);
    expect(deepMedian).toBeLessThan(Math.max(shallowMedian * 100, 0.5));
  });

  it('stays far inside the 16 ms ingest budget for a burst of token deltas', () => {
    // "Stream ingest to queued model update: p95 below 16 ms." Measured as
    // the slowest single reduction in a 2000-event burst — a p95 would be
    // kinder and this is the number that actually stalls a frame.
    let state = emptyTimeline();
    state = reduceEvent(state, { kind: 'harness.turn_start', data: {} });
    const worst = slowest(2000, (i) => {
      state = reduceEvent(state, token(`tok${i} `), { maxItems: DEFAULT_TIMELINE_RETENTION });
    });
    expect(worst).toBeLessThan(16);
  });

  it('returns the SAME object for an event it ignores, so no render is scheduled', () => {
    // The store skips its `set()` on reference equality, and a `set()` also
    // re-runs stream reconciliation over the whole workbench (audit §6.4).
    // A reducer that returned a fresh object for every unmodelled kind spent
    // all of that on nothing — and the server emits plenty of kinds no pane
    // renders.
    const state = emptyTimeline();
    expect(reduceEvent(state, { kind: 'totally.unknown', data: {} })).toBe(state);
  });

  it('still advances the cursor for an unmodelled event that carries a sequence', () => {
    // Otherwise a run of unmodelled events stalls the resume cursor, and a
    // reconnect re-delivers all of them.
    const state = emptyTimeline();
    const next = reduceEvent(state, { kind: 'totally.unknown', data: {}, sequence: 42 });
    expect(next).not.toBe(state);
    expect(next.lastSequence).toBe(42);
  });
});
