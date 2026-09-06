// ────────────────────────────────────────────────────────────────
// Bounded flush before a fault exit — APPLICATION-REVIEW-2026-09 §6.7.
//
// `handleFault` in index.ts has three paths that end in `process.exit(1)`
// without going through `container.shutdown()`: a fault raised while a
// shutdown is already in progress, a fault before the server is listening,
// and a fault storm with no shutdown handler registered. Each of those threw
// away whatever the EventBus persist queue and the StreamBroker write batcher
// were still holding — up to the whole delta window of events.
//
// A full graceful shutdown is not an option on those paths (the process is
// by definition in an unknown state), but a *bounded* attempt to commit the
// already-queued writes is: they are plain SQLite inserts on data the
// process has already accepted. If the flush hangs — the fault may well be
// in the database layer itself — the deadline wins and the exit happens
// anyway. Losing the race costs at most `deadlineMs`; winning it saves the
// tail of every live conversation.
// ────────────────────────────────────────────────────────────────

export const FAULT_FLUSH_DEADLINE_MS = 2_000;

export interface BoundedFlushDeps {
  /** Commits queued writes. Absent before the container exists. */
  flush?: () => Promise<unknown>;
  /** Injected for tests; defaults to `process.exit`. */
  exit?: (code: number) => void;
  deadlineMs?: number;
  log?: (msg: string) => void;
}

/**
 * Race `flush()` against a deadline, then exit with `code` exactly once.
 * Never throws: a rejected flush is logged and the exit still happens.
 */
export function exitAfterBoundedFlush(code: number, deps: BoundedFlushDeps = {}): Promise<void> {
  const exit = deps.exit ?? ((c: number) => process.exit(c));
  const deadlineMs = deps.deadlineMs ?? FAULT_FLUSH_DEADLINE_MS;
  const log = deps.log ?? ((m: string) => console.error(m));

  if (!deps.flush) {
    exit(code);
    return Promise.resolve();
  }

  let settled = false;
  const finish = (why: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    log(`[Server] pre-exit flush ${why}`);
    exit(code);
  };

  const timer = setTimeout(() => finish(`abandoned after ${deadlineMs}ms`), deadlineMs);
  // The timer must not keep a dying process alive if the flush resolves first.
  timer.unref?.();

  let flushPromise: Promise<unknown>;
  try {
    flushPromise = Promise.resolve(deps.flush());
  } catch (err) {
    flushPromise = Promise.reject(err);
  }

  return flushPromise
    .then(() => finish('completed'))
    .catch((err: unknown) => finish(`failed: ${err instanceof Error ? err.message : String(err)}`));
}
