// ────────────────────────────────────────────────────────────────
// boundedFanOut — W13, the bounded/ordered fan-out primitive.
//
// Every provider fan-out in this package must go through here. The plan's
// rule (PART 4.5) is one line with three clauses, and all three matter:
//
//   "Bound every fan-out: {concurrency: 8} + per-item AND overall timeout."
//
// ── Why an OVERALL timeout is not redundant with the per-item one ──
//
// A per-item timeout bounds one item. It does not bound the BATCH: with a
// concurrency of 8 and 40 items each taking just under the per-item deadline,
// the batch still runs for 5 × perItemTimeout. And a per-item timer only
// reaps a worker that is cooperatively awaiting something — a transport that
// "awaits an unbounded deferred per request" (t3code) has no such await to
// interrupt, so the deferred never settles and the timer never gets to run its
// continuation before the parent needs an answer. That is the exact shape of
// the failure the plan calls out:
//
//   "a wedged child would block the parent interrupt forever — exactly during
//    the runaway fleet where Stop matters most."
//
// So the overall deadline is enforced by RETURNING, not by waiting. When it
// fires we fill every unsettled slot with an `overall-timeout` outcome and
// return immediately. In-flight workers are ABORTED (the linked signal) but
// not awaited, because a wedged worker is precisely one that will not honour
// the abort. A promise cannot be killed in JS; refusing to await it is the
// only bound that actually holds. Their eventual rejections are swallowed so a
// reaped worker cannot crash the process later with an unhandled rejection.
//
// ── Why results are indexed, not pushed ────────────────────────────
//
// Results are written into a pre-sized array at the item's own index and
// returned in that order, so the batch's output order is the order the MODEL
// emitted the calls in, regardless of completion order. Anthropic's parallel
// tool-use contract requires all `tool_result` blocks for one assistant turn
// to come back in a single user message; returning them in completion order
// silently reorders the model's own reasoning about which result belongs to
// which call. A `Promise.all` would preserve order but fails the whole batch
// on the first rejection, and `Promise.allSettled` preserves order but has no
// concurrency bound — this has both.
// ────────────────────────────────────────────────────────────────

import { ToolSemaphore } from '../toolSemaphore.js';
import type { PoisonPillRegistry } from './poisonPill.js';
import { FanOutAbortError, type FanOutFailureKind } from './errors.js';

export { FanOutAbortError, type FanOutFailureKind } from './errors.js';

/** `MAX_PARALLEL_TOOLS = 8` (W13). `0` or less means unlimited. */
export const DEFAULT_MAX_PARALLEL_TOOLS = 8;

/** Default per-item budget. Generous: real tools legitimately take minutes. */
export const DEFAULT_PER_ITEM_TIMEOUT_MS = 120_000;

/**
 * Default overall budget for one fan-out. Deliberately NOT
 * `perItem × ceil(n / concurrency)`: the point of the overall bound is to cap
 * how long a Stop can be delayed, which is a UX number, not a throughput one.
 */
export const DEFAULT_OVERALL_TIMEOUT_MS = 300_000;

export interface FanOutSuccess<T> {
  readonly status: 'fulfilled';
  readonly index: number;
  readonly value: T;
}

export interface FanOutFailure {
  readonly status: 'rejected';
  readonly index: number;
  readonly kind: FanOutFailureKind;
  readonly reason: Error;
}

export type FanOutOutcome<T> = FanOutSuccess<T> | FanOutFailure;

export interface FanOutContext {
  /** Position in the input array — also the position of this outcome. */
  readonly index: number;
  /**
   * Aborted when the item's own deadline passes, when the batch deadline
   * passes, or when the caller's signal aborts. Thread it into anything the
   * worker awaits; that is the only way a worker can be reaped cooperatively.
   */
  readonly signal: AbortSignal;
}

export interface FanOutOptions<I> {
  /** Max items in flight. Defaults to 8. `<= 0` means unlimited. */
  concurrency?: number;
  /** Per-item budget in ms. `<= 0` disables. */
  perItemTimeoutMs?: number;
  /** Whole-batch budget in ms. `<= 0` disables. */
  overallTimeoutMs?: number;
  /** Caller abort — e.g. the turn's own AbortController. */
  signal?: AbortSignal;
  /** Poison-pill ladder. Shared across batches when the caller keeps one. */
  poison?: PoisonPillRegistry;
  /** Groups items for the poison ladder. Defaults to the item's index (no grouping). */
  keyOf?: (item: I, index: number) => string;
  /** Reuse an existing permit pool (e.g. a provider-wide `ToolSemaphore`). */
  semaphore?: ToolSemaphore;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Bounded, order-preserving fan-out with per-item and overall deadlines.
 *
 * Never rejects: every item resolves to an outcome. A caller that wants
 * throw-on-failure decides that itself, from data it can see.
 */
export async function boundedFanOut<I, T>(
  items: readonly I[],
  worker: (item: I, ctx: FanOutContext) => Promise<T>,
  options: FanOutOptions<I> = {},
): Promise<Array<FanOutOutcome<T>>> {
  const results: Array<FanOutOutcome<T> | undefined> = new Array(items.length).fill(undefined);
  if (items.length === 0) return [];

  const concurrency = options.concurrency ?? DEFAULT_MAX_PARALLEL_TOOLS;
  const perItemTimeoutMs = options.perItemTimeoutMs ?? DEFAULT_PER_ITEM_TIMEOUT_MS;
  const overallTimeoutMs = options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  const semaphore = options.semaphore ?? new ToolSemaphore(concurrency);
  const poison = options.poison;
  const keyOf = options.keyOf ?? ((_i: I, index: number) => String(index));

  // One controller for the whole batch. Aborting it is how the overall
  // deadline and the caller's Stop reach every in-flight worker at once.
  const batchAc = new AbortController();
  const onCallerAbort = () => batchAc.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) batchAc.abort(options.signal.reason);
    else options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let overallExpired = false;

  const settleOne = (index: number, outcome: FanOutOutcome<T>): void => {
    if (results[index] === undefined) results[index] = outcome;
  };

  const runItem = async (item: I, index: number): Promise<void> => {
    const key = keyOf(item, index);

    if (poison?.isQuarantined(key)) {
      settleOne(index, {
        status: 'rejected', index, kind: 'poisoned',
        reason: new FanOutAbortError('poisoned', poison.quarantineReason(key)),
      });
      return;
    }
    if (batchAc.signal.aborted) {
      settleOne(index, {
        status: 'rejected', index, kind: overallExpired ? 'overall-timeout' : 'aborted',
        reason: new FanOutAbortError(
          overallExpired ? 'overall-timeout' : 'aborted',
          overallExpired
            ? `Fan-out exceeded its overall budget of ${overallTimeoutMs}ms before item ${index} started.`
            : `Fan-out was cancelled before item ${index} started.`,
        ),
      });
      return;
    }

    await semaphore.run(async () => {
      if (batchAc.signal.aborted) {
        settleOne(index, {
          status: 'rejected', index, kind: overallExpired ? 'overall-timeout' : 'aborted',
          reason: new FanOutAbortError(
            overallExpired ? 'overall-timeout' : 'aborted',
            `Fan-out item ${index} was cancelled while queued.`,
          ),
        });
        return;
      }
      // Re-check the ladder AFTER acquiring the permit, not only before
      // queueing. With 8 permits and 30 calls to the same broken tool, all 30
      // are queued in the same tick — long before the first failure is
      // recorded — so a start-time check alone would let every one of them
      // execute and the quarantine would never bite. The decision has to be
      // made where the work actually starts.
      if (poison?.isQuarantined(key)) {
        settleOne(index, {
          status: 'rejected', index, kind: 'poisoned',
          reason: new FanOutAbortError('poisoned', poison.quarantineReason(key)),
        });
        return;
      }

      // Per-item controller, linked to the batch controller. Cleared in
      // `finally` so a fast item never leaves a timer behind — an uncleared
      // timer keeps the event loop alive and, in a long-lived provider,
      // accumulates one handle per tool call.
      const itemAc = new AbortController();
      const linkBatch = () => itemAc.abort(batchAc.signal.reason);
      batchAc.signal.addEventListener('abort', linkBatch, { once: true });
      let itemTimer: ReturnType<typeof setTimeout> | undefined;
      let itemExpired = false;

      try {
        const run = poison
          ? poison.runFor(key, () => worker(item, { index, signal: itemAc.signal }))
          : worker(item, { index, signal: itemAc.signal });

        let value: T;
        if (perItemTimeoutMs > 0) {
          const deadline = new Promise<never>((_resolve, reject) => {
            itemTimer = setTimeout(() => {
              itemExpired = true;
              itemAc.abort();
              reject(new FanOutAbortError(
                'per-item-timeout',
                `Fan-out item ${index} exceeded its per-item budget of ${perItemTimeoutMs}ms.`,
              ));
            }, perItemTimeoutMs);
          });
          // The loser of the race is never awaited again; swallow it so a
          // late rejection from a reaped worker is not unhandled.
          void run.catch(() => undefined);
          value = await Promise.race([run, deadline]);
        } else {
          value = await run;
        }

        poison?.recordSuccess(key);
        settleOne(index, { status: 'fulfilled', index, value });
      } catch (err) {
        poison?.recordFailure(key);
        const kind: FanOutFailureKind =
          err instanceof FanOutAbortError ? err.kind
            : itemExpired ? 'per-item-timeout'
              : overallExpired ? 'overall-timeout'
                : batchAc.signal.aborted ? 'aborted'
                  : 'error';
        settleOne(index, { status: 'rejected', index, kind, reason: asError(err) });
      } finally {
        if (itemTimer !== undefined) clearTimeout(itemTimer);
        batchAc.signal.removeEventListener('abort', linkBatch);
      }
    });
  };

  const all = Promise.all(items.map((item, index) => runItem(item, index)));
  // Same reasoning as above: once the overall deadline wins the race, nobody
  // awaits `all` again.
  void all.catch(() => undefined);

  // Stop waiting the moment the batch is aborted, whichever side aborted it.
  //
  // Awaiting `all` alone is not enough and this is the whole point of the
  // mechanism: a WEDGED worker is by definition one that does not observe the
  // abort signal, so `all` never settles for it. The parent must stop waiting
  // on its own, which is what racing against the abort event does. Both the
  // overall deadline and the caller's Stop reach us through the same event, so
  // there is exactly one place that decides to give up.
  const stopped = new Promise<void>((resolve) => {
    if (batchAc.signal.aborted) resolve();
    else batchAc.signal.addEventListener('abort', () => resolve(), { once: true });
  });

  try {
    if (overallTimeoutMs > 0) {
      overallTimer = setTimeout(() => {
        overallExpired = true;
        batchAc.abort();
      }, overallTimeoutMs);
    }
    await Promise.race([all, stopped]);
  } finally {
    if (overallTimer !== undefined) clearTimeout(overallTimer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }

  // Anything still unsettled is either wedged past the batch deadline or was
  // cancelled. Both are reported, in position, rather than dropped — a dropped
  // tool call is one the agent waits on forever.
  for (let i = 0; i < results.length; i++) {
    if (results[i] !== undefined) continue;
    const cancelled = batchAc.signal.aborted && !overallExpired;
    results[i] = {
      status: 'rejected',
      index: i,
      kind: cancelled ? 'aborted' : 'overall-timeout',
      reason: new FanOutAbortError(
        cancelled ? 'aborted' : 'overall-timeout',
        cancelled
          ? `Fan-out item ${i} was cancelled before it produced a result.`
          : `Fan-out exceeded its overall budget of ${overallTimeoutMs}ms; ` +
            `item ${i} was still in flight and has been abandoned.`,
      ),
    };
  }

  return results as Array<FanOutOutcome<T>>;
}

/**
 * Convenience wrapper for the common case: the caller wants values in order
 * and a legible string in place of anything that failed. Used by the tool
 * factories, where "the model must receive one result per call it emitted" is
 * the actual requirement.
 */
export async function boundedFanOutMapped<I, T>(
  items: readonly I[],
  worker: (item: I, ctx: FanOutContext) => Promise<T>,
  onFailure: (failure: FanOutFailure, item: I) => T,
  options: FanOutOptions<I> = {},
): Promise<T[]> {
  const outcomes = await boundedFanOut(items, worker, options);
  return outcomes.map((o, i) =>
    o.status === 'fulfilled' ? o.value : onFailure(o, items[i] as I),
  );
}
