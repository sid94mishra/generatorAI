// ────────────────────────────────────────────────────────────────
// StreamWriteBatcher — W07, the micro-batched durable writer.
//
// MEASURED, and the reason this exists (see
// packages/db/__benchmarks__/streamAppend.bench.test.ts):
//
//   executing the two append statements  ~7 us
//   the WAL commit around them          ~210 us
//
// So a transaction per event is 97% overhead, and the plan's "<= 40 us per
// token" is unreachable while every token gets its own commit. Amortising one
// commit across a batch measures 16.7 us — a 44x improvement, and the single
// largest win available on the write path.
//
// WHAT IS PRESERVED. Commit-then-broadcast (EVT-01) is not negotiable: a live
// subscriber must never see an event that replay cannot return. So every
// caller's promise resolves only after the batch its event belongs to has
// COMMITTED, and the broker fans out from there. Batching adds latency, never
// uncertainty.
//
// WHAT DECIDES THE WAIT. W04's classification. An item flushes on the next
// microtask, because it is what the UI acts on — a completed message, a tool
// call, a lifecycle transition — and delaying those is visible. A delta may
// wait up to `DELTA_BATCH_MS`, because a token that arrives 8 ms later than it
// might have is indistinguishable from one that did not, and this is where the
// volume is. That asymmetry is the whole design: the events that can afford to
// wait are exactly the events there are most of.
// ────────────────────────────────────────────────────────────────

import {
  StreamAppendInTransactionError,
  type DrizzleStreamCursorRepository,
  type StreamEventRow,
  type StreamScope,
} from '@generatorai/db';
import { classifyEvent, type EventClass, type ILogger } from '@generatorai/shared';

/**
 * How long a delta may wait for company.
 *
 * The low end of the plan's 4-16 ms adaptive coalescing window. Long enough to
 * gather a useful batch at realistic token rates, short enough to stay under
 * the threshold at which a stream reads as stuttering.
 */
const DELTA_BATCH_MS = 8;

/**
 * Hard cap on ONE TRANSACTION (not on the queue — see `maxPending`).
 *
 * A batch is one synchronous SQLite transaction, so its size is how long the
 * event loop is blocked. 256 events at ~7 us each is under 2 ms.
 */
const MAX_BATCH = 256;

/**
 * Hard cap on the QUEUE (L2 — every queue is bounded, and its overflow
 * behaviour is stated in code).
 *
 * Reached when the producer outruns the disk for a sustained period: a provider
 * streaming faster than SQLite can checkpoint, or a stretch where every commit
 * is being retried. Past this, the OLDEST DELTA is dropped — deltas are
 * recoverable because the completed item supersedes them, and dropping the
 * oldest keeps the newest, which is what a reader wants. Items are never
 * dropped; if the queue is all items, the newest write is rejected rather than
 * silently losing one, so the caller learns immediately.
 */
const MAX_PENDING = 10_000;

/**
 * How long a commit may be blocked by an unrelated open transaction before the
 * batch gives up.
 *
 * `withTransaction` tolerates a caller holding a transaction for up to its
 * 10 s deadline, and better-sqlite3 exposes one connection, so a stream write
 * landing in that window cannot commit. Retrying is right — the transaction
 * will end — and this bounds how long we are willing to wait for it.
 */
const TX_CONTENTION_RETRY_MS = 25;
const TX_CONTENTION_MAX_WAIT_MS = 15_000;

interface Pending {
  scope: StreamScope;
  scopeId: string;
  kind: string;
  payload: unknown;
  cls: EventClass;
  resolve: (row: StreamEventRow) => void;
  reject: (err: unknown) => void;
}

export interface StreamWriteBatcherOptions {
  /** Set to 0 to write every event immediately. Used by tests. */
  deltaBatchMs?: number;
  maxBatch?: number;
  maxPending?: number;
  /** Overall budget for waiting out an unrelated open transaction. */
  contentionMaxWaitMs?: number;
}

/** Thrown to a caller whose event could not be queued. */
export class StreamWriteQueueFullError extends Error {
  constructor(depth: number) {
    super(`StreamWriteBatcher: ${depth} events queued and all are items; refusing more`);
    this.name = 'StreamWriteQueueFullError';
  }
}

export class StreamWriteBatcher {
  private pending: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushScheduled = false;
  /** Serialises flushes: two overlapping batches would interleave transactions. */
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private droppedDeltas = 0;

  private readonly deltaBatchMs: number;
  private readonly maxBatch: number;
  private readonly maxPending: number;
  private readonly contentionMaxWaitMs: number;

  constructor(
    private readonly repo: DrizzleStreamCursorRepository,
    private readonly logger: ILogger,
    options: StreamWriteBatcherOptions = {},
  ) {
    this.deltaBatchMs = options.deltaBatchMs ?? DELTA_BATCH_MS;
    this.maxBatch = options.maxBatch ?? MAX_BATCH;
    this.maxPending = options.maxPending ?? MAX_PENDING;
    this.contentionMaxWaitMs = options.contentionMaxWaitMs ?? TX_CONTENTION_MAX_WAIT_MS;
  }

  /**
   * Queue one event. Resolves with its durable row once the batch has
   * committed, or rejects if the batch did.
   */
  write(
    scope: StreamScope,
    scopeId: string,
    kind: string,
    payload: unknown,
  ): Promise<StreamEventRow> {
    const cls = classifyEvent(kind, payload);

    if (this.pending.length >= this.maxPending && !this.makeRoom()) {
      // Every queued event is an item, so nothing may be dropped to make room.
      // Rejecting tells the caller now; growing would defer the same failure
      // to an out-of-memory kill that says nothing.
      return Promise.reject(new StreamWriteQueueFullError(this.pending.length));
    }

    return new Promise<StreamEventRow>((resolve, reject) => {
      this.pending.push({ scope, scopeId, kind, payload, cls, resolve, reject });

      // A full batch goes now regardless of class: past this point waiting buys
      // no further amortisation and only adds latency.
      if (this.pending.length >= this.maxBatch || cls === 'item') {
        this.flushSoon();
        return;
      }
      this.flushAfterWindow();
    });
  }

  /**
   * Drop the oldest delta to make room. Returns false when there is none — the
   * queue is all items, and an item may never be dropped.
   */
  private makeRoom(): boolean {
    const idx = this.pending.findIndex((p) => p.cls === 'delta');
    if (idx === -1) return false;
    const [dropped] = this.pending.splice(idx, 1);
    this.droppedDeltas += 1;
    // Resolving with a synthetic row would be a lie; rejecting is the honest
    // answer and the publisher's `.catch` already handles it.
    dropped?.reject(new StreamWriteQueueFullError(this.pending.length));
    if (this.droppedDeltas % 1_000 === 1) {
      this.logger.warn?.('[StreamWriteBatcher] dropping deltas — the writer is behind', {
        depth: this.pending.length,
        droppedDeltas: this.droppedDeltas,
      });
    }
    return true;
  }

  /**
   * Flush everything queued and wait for it to commit.
   *
   * Loops because `run()` only takes `maxBatch` at a time, and awaits inside
   * the loop because a single `await this.chain` captures the chain BEFORE the
   * commit is appended to it — which is how the previous version returned
   * without having written anything.
   */
  async flush(): Promise<void> {
    while (this.pending.length > 0 || this.inFlight > 0) {
      this.run();
      await this.chain.catch(() => undefined);
    }
  }

  /** Events queued but not yet committed. For the health endpoint and tests. */
  get depth(): number {
    return this.pending.length;
  }

  /** On the next microtask — same tick, no timer, no visible delay. */
  private flushSoon(): void {
    this.clearTimer();
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.run();
    });
  }

  /**
   * Schedule a delta flush.
   *
   * Deltas are coalesced to the END OF THE CURRENT TICK, not to a fixed
   * wall-clock delay. Everything emitted in the same tick — including from
   * other sessions — still lands in one transaction, which is where the
   * amortisation comes from; but a lone delta no longer sits waiting for a
   * timer that cannot bring it company.
   *
   * That distinction was worth a lot: `EventBus` serialises emits per session,
   * so for a single active conversation there was only ever ONE delta pending.
   * It waited out the full window, the batch never filled, and every event paid
   * the delay while getting none of the batching benefit — a ceiling of about
   * 1000/`deltaBatchMs` events per second per conversation (review 3.4).
   *
   * The timer is kept as a backstop for the case the tick never drains.
   */
  private flushAfterWindow(): void {
    if (this.timer || this.flushScheduled) return;
    if (this.deltaBatchMs <= 0) {
      this.flushSoon();
      return;
    }
    // End of tick: same-tick producers have all been given their chance.
    const immediate = setImmediate(() => {
      this.clearTimer();
      this.run();
    });
    immediate.unref?.();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      clearImmediate(immediate);
      this.run();
    }, this.deltaBatchMs);
    // Never the reason the process cannot exit; shutdown calls `flush()`.
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private run(): void {
    this.clearTimer();
    if (this.pending.length === 0) return;

    const batch = this.pending.splice(0, this.maxBatch);
    // If the cap left events behind, they are a batch of their own rather than
    // waiting for a fresh window — they have already waited once.
    if (this.pending.length > 0) this.flushSoon();

    this.inFlight += 1;
    // Both handlers, so one rejected link cannot poison the chain for every
    // future batch. `commit` never rejects, but the chain must not depend on
    // that remaining true.
    this.chain = this.chain.then(
      () => this.commit(batch),
      () => this.commit(batch),
    );
  }

  private async commit(batch: Pending[]): Promise<void> {
    try {
      const rows = await this.appendWithContentionRetry(batch);
      if (rows.length !== batch.length) {
        // Resolving a waiter with `undefined` would throw downstream inside the
        // broker's fan-out, far from the cause.
        throw new Error(
          `StreamWriteBatcher: appendBatch returned ${rows.length} rows for ${batch.length} events`,
        );
      }
      for (let i = 0; i < batch.length; i += 1) {
        // Resolved one at a time, in order, AFTER the commit. The broker fans
        // out from here, so no subscriber can observe an event the transaction
        // did not durably write.
        batch[i]!.resolve(rows[i]!);
      }
    } catch (err) {
      // Settle FIRST. Logging can throw — a broken transport, an exporter
      // fault — and a throw before this loop leaves every promise in the batch
      // unsettled, hanging the emitting session forever.
      for (const p of batch) p.reject(err);
      try {
        // All-or-nothing: a partial batch would mean some events were broadcast
        // and others silently were not, with no way for a subscriber to tell.
        this.logger.error?.('[StreamWriteBatcher] batch failed — rejected every event in it', {
          size: batch.length,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* a failing logger must not wedge the write path */
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * Commit, waiting out an unrelated open transaction rather than failing.
   *
   * better-sqlite3 exposes one connection, and `withTransaction` legitimately
   * holds it across awaits for up to its 10 s deadline. `appendBatch` refuses
   * to run inside a transaction — correctly, because it would become a
   * SAVEPOINT the outer rollback could undo after the broadcast — but the
   * batcher commits on a timer, so it can land in that window through no fault
   * of its own. Failing there would reject up to 256 events belonging to a
   * completely unrelated chat, which then drops those broadcasts.
   */
  private async appendWithContentionRetry(batch: Pending[]): Promise<StreamEventRow[]> {
    const deadline = Date.now() + this.contentionMaxWaitMs;
    for (;;) {
      try {
        return await this.repo.appendBatch(batch);
      } catch (err) {
        if (!(err instanceof StreamAppendInTransactionError) || Date.now() >= deadline) throw err;
        await new Promise((r) => {
          const t = setTimeout(r, TX_CONTENTION_RETRY_MS);
          t.unref?.();
        });
      }
    }
  }
}
