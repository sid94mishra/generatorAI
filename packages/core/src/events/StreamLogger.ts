// ────────────────────────────────────────────────────────────────
// RunLogger — per-workflow-run event logger
//
// Creates a JSONL log file in the run's artifacts directory that captures every
// event for that run: streaming tokens, messages, tool calls, reasoning, stage
// lifecycle, orchestration. Auto-closes when the run reaches a terminal state.
// The file lives in the artifacts directory, so it appears in the UI's Files
// panel on its own.
//
// P0-15 / W07 — this used to be the single most expensive thing in a CPU
// profile, for two compounding reasons:
//
//   1. `appendFileSync` per event — a blocking syscall on the event loop, on
//      the streaming hot path.
//   2. Every logger subscribed to EVERY event in the process and filtered by
//      `workflowRunId` itself. With 22 active runs, one token was offered to 22
//      handlers, each doing (1).
//
// So 22 blocking syscalls per token, at 500-2000 tokens per second.
//
// Both are fixed here. Writes are buffered and flushed asynchronously, and the
// dispatcher at the bottom holds ONE bus subscription and routes by run id, so
// the per-event cost is a single Map lookup regardless of how many runs are
// live. `close()` stays synchronous — it runs once per run on a synchronous
// teardown path, and one blocking write there does not justify an API change.
// ────────────────────────────────────────────────────────────────

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PersistedEvent, ILogger } from '@generatorai/shared';
import type { EventBus } from './EventBus.js';

const LOG_FILENAME = 'stream-log.jsonl';
const TERMINAL_KINDS = new Set([
  'workflow_run.completed',
  'workflow_run.failed',
  'workflow_run.cancelled',
]);

/** Coalescing window. Matches `ITEM_BATCH_MS` — below the perceptual threshold. */
const FLUSH_INTERVAL_MS = 25;

/** Flush early once the buffer reaches this, so a burst does not sit in memory. */
const FLUSH_BYTES = 64 * 1024;

/**
 * Hard ceiling on buffered bytes (L2 — every queue is bounded, and its overflow
 * behaviour is stated in code). Reached only when the disk cannot keep up with
 * the agent, at which point the oldest lines are dropped and a marker is written
 * in their place. A diagnostic log that grows until the process dies is worse
 * than one with a hole in it that says so.
 */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export { LOG_FILENAME as RUN_LOG_FILENAME };

export class RunLogger {
  private closed = false;
  readonly logFilePath: string;

  private pending: string[] = [];
  private pendingBytes = 0;
  private droppedLines = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Serialises flushes so two appends cannot interleave and tear a line. */
  private flushChain: Promise<void> = Promise.resolve();
  /** Async appends started but not yet finished. `close()` reads this. */
  private writesInFlight = 0;
  private writeFailCount = 0;
  private attachedBus: EventBus | undefined;

  constructor(
    private readonly runId: string,
    artifactsDir: string,
    private readonly logger: ILogger,
  ) {
    mkdirSync(artifactsDir, { recursive: true });
    this.logFilePath = join(artifactsDir, LOG_FILENAME);

    // Truncate any existing file and write the header synchronously: the path
    // must be a valid log the instant the constructor returns.
    writeFileSync(
      this.logFilePath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        kind: '__run_log.started',
        data: { runId, logFile: this.logFilePath },
      }) + '\n',
      'utf-8',
    );

    this.logger.info(`[RunLogger] Logging run ${runId} to ${this.logFilePath}`);
  }

  /**
   * Register with the shared dispatcher, which owns the bus subscription.
   *
   * Auto-closes when a terminal `workflow_run.*` event for this run arrives.
   */
  attach(eventBus: EventBus): void {
    if (this.closed) return;
    this.attachedBus = eventBus;
    getDispatcher(eventBus).register(this.runId, this);
  }

  /** Flush and close the log file. Safe to call multiple times. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.attachedBus) {
      getDispatcher(this.attachedBus).unregister(this.runId, this);
      this.attachedBus = undefined;
    }

    this.buffer({
      timestamp: new Date().toISOString(),
      kind: '__run_log.closed',
      data: { runId: this.runId },
    });
    this.flushSync();

    this.logger.info(`[RunLogger] Closed log for run ${this.runId}`);
  }

  /** Called by the dispatcher for events already matched to this run. */
  handleEvent(event: PersistedEvent, terminal: boolean): void {
    if (this.closed) return;
    this.buffer({
      timestamp: new Date(event.timestamp).toISOString(),
      sessionId: event.sessionId,
      sequenceId: event.sequenceId,
      kind: event.kind,
      data: event.data,
    });
    if (terminal) this.close();
  }

  private buffer(record: Record<string, unknown>): void {
    let line: string;
    try {
      line = JSON.stringify(record) + '\n';
    } catch {
      // A payload with a cycle or a BigInt must not take the run down.
      line = JSON.stringify({ kind: record['kind'], data: '<unserialisable>' }) + '\n';
    }

    this.pending.push(line);
    this.pendingBytes += Buffer.byteLength(line, 'utf8');

    // `length > 1` keeps at least one line, so a SINGLE line larger than the
    // ceiling still gets written rather than looping forever trying to evict
    // its way under it. That is the right trade for a diagnostic log: one
    // oversized record is bounded by the payload that produced it, whereas
    // refusing it would lose the very event most likely to explain a failure.
    while (this.pendingBytes > MAX_BUFFERED_BYTES && this.pending.length > 1) {
      const dropped = this.pending.shift();
      this.pendingBytes -= dropped === undefined ? 0 : Buffer.byteLength(dropped, 'utf8');
      this.droppedLines += 1;
    }

    this.scheduleFlush(this.pendingBytes >= FLUSH_BYTES ? 0 : FLUSH_INTERVAL_MS);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushAsync();
    }, delayMs);
    // A diagnostic log must never be the reason the process cannot exit.
    this.flushTimer.unref?.();
  }

  /** Take everything buffered, plus a drop marker if any lines were lost. */
  private drain(): string | undefined {
    if (this.pending.length === 0) return undefined;
    const chunk = this.pending.join('');
    this.pending = [];
    this.pendingBytes = 0;

    if (this.droppedLines === 0) return chunk;
    const marker =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        kind: '__run_log.dropped',
        data: { runId: this.runId, lines: this.droppedLines },
      }) + '\n';
    this.droppedLines = 0;
    return marker + chunk;
  }

  private flushAsync(): void {
    const chunk = this.drain();
    if (chunk === undefined) return;
    this.writesInFlight += 1;
    this.flushChain = this.flushChain
      .then(() => appendFile(this.logFilePath, chunk, 'utf-8'))
      .then(
        () => {
          this.writeFailCount = 0;
        },
        (err: unknown) => this.reportWriteFailure(err),
      )
      .finally(() => {
        this.writesInFlight -= 1;
      });
  }

  /**
   * Blocking flush, used only by `close()`.
   *
   * One syscall per run on a teardown path, versus one per event on the hot
   * path — which is the entire point of this rewrite.
   *
   * Falls back to the async chain when a flush is already in flight. A
   * synchronous append can complete BEFORE an `appendFile` that started
   * earlier, which would put the closed marker in the middle of the file and
   * reorder the events around it; on Windows the two can also interleave
   * mid-line and produce unparseable JSONL.
   */
  private flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const chunk = this.drain();
    if (chunk === undefined) return;

    if (this.writesInFlight > 0) {
      this.flushChain = this.flushChain
        .then(() => appendFile(this.logFilePath, chunk, 'utf-8'))
        .catch((err: unknown) => this.reportWriteFailure(err));
      return;
    }

    try {
      appendFileSync(this.logFilePath, chunk, 'utf-8');
    } catch (err) {
      this.reportWriteFailure(err);
    }
  }

  private reportWriteFailure(err: unknown): void {
    // Non-fatal — never crash a workflow over its own diagnostic log.
    // Rate-limited so a failing disk cannot itself become the log spam.
    this.writeFailCount += 1;
    if (this.writeFailCount <= 3) {
      this.logger.warn(`[RunLogger] Failed to write events (attempt ${this.writeFailCount})`, {
        runId: this.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Shared dispatcher ───────────────────────────────────────────────────────

/**
 * One bus subscription for every run logger on a given bus.
 *
 * Before this, each logger subscribed independently and re-checked
 * `data.workflowRunId` for every event in the process, so the cost of one token
 * scaled with the number of live runs. Now the match happens once and resolves
 * to a Map lookup.
 */
class RunLoggerDispatcher {
  private readonly byRun = new Map<string, Set<RunLogger>>();
  private unsubSession: (() => void) | undefined;
  private unsubGlobal: (() => void) | undefined;

  constructor(private readonly bus: EventBus) {}

  register(runId: string, logger: RunLogger): void {
    const existing = this.byRun.get(runId);
    if (existing) existing.add(logger);
    else this.byRun.set(runId, new Set([logger]));
    this.ensureSubscribed();
  }

  unregister(runId: string, logger: RunLogger): void {
    const set = this.byRun.get(runId);
    if (!set) return;
    set.delete(logger);
    if (set.size === 0) this.byRun.delete(runId);
    // The subscription is kept even at zero loggers: runs start and stop
    // constantly, and churning two bus subscriptions per run costs more than
    // the `size === 0` check that `route` opens with.
  }

  private ensureSubscribed(): void {
    if (this.unsubSession) return;
    this.unsubSession = this.bus.subscribeAll((event) => this.route(event, false));
    this.unsubGlobal = this.bus.subscribeGlobal((event) => this.route(event, true));
  }

  private route(event: PersistedEvent, global: boolean): void {
    if (this.byRun.size === 0) return;
    const data = event.data as Record<string, unknown> | null;
    const runId = data?.['workflowRunId'];
    if (typeof runId !== 'string') return;
    const loggers = this.byRun.get(runId);
    if (!loggers) return;

    const terminal = global && TERMINAL_KINDS.has(event.kind);
    // Copied: `handleEvent` can close, which unregisters and mutates the set.
    for (const logger of [...loggers]) logger.handleEvent(event, terminal);
  }
}

const dispatchers = new WeakMap<EventBus, RunLoggerDispatcher>();

function getDispatcher(bus: EventBus): RunLoggerDispatcher {
  let d = dispatchers.get(bus);
  if (!d) {
    d = new RunLoggerDispatcher(bus);
    dispatchers.set(bus, d);
  }
  return d;
}
