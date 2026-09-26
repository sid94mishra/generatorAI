// ────────────────────────────────────────────────────────────────
// createAttentionStore — the attention feed as a framework-free store (G-01).
//
// Wires `attentionReducer` to its two inputs: the snapshot endpoint and the
// `global` stream scope. Mobile wraps it in its own state container and the
// web in `useSyncExternalStore` (`apps/web/src/hooks/attentionQueries.ts`):
// one implementation of the seq rules for every client.
//
// Lifecycle:
//   start()  subscribe `global` (filtered to `attention.`) FIRST, then fetch
//            the snapshot — deltas that land while a fetch is in flight are
//            held by the reducer and replayed on top of it.
//   gap      a skipped `seq`, a stream `gap:` disconnect, or a reconnect after
//            any disconnect marks the snapshot stale; the store refetches.
//            One fetch at a time and never cancelled: a delta gap during a
//            fetch is settled by the replay (a hole there fetches again); an
//            explicit resync during a fetch queues exactly one more, because
//            the response in flight may predate the server's restart.
//   failure  while the store has no usable snapshot (none yet, or stale), a
//            failed fetch is retried on its own with exponential backoff
//            (1 s doubling to 30 s, reset by a snapshot) — mobile has no
//            safety refresh to fall back on (P2-R31). "No snapshot" counts as
//            stale. While a retry is pending, deltas and resyncs only wait for
//            it (they are held for its replay), so a failing server sees one
//            request per backoff step, not one per delta. `refresh()` is the
//            explicit exception: it fetches now. `stop()` cancels the timer.
// ────────────────────────────────────────────────────────────────

import type { AttentionFilter, AttentionSnapshot } from '@generatorai/shared';
import {
  ATTENTION_STREAM_FILTER,
  attentionReducer,
  initialAttentionState,
  type AttentionReducerEvent,
  type AttentionState,
  type AttentionStreamEvent,
} from './reducer.js';

/** Where snapshots come from — `IPlatformClient` and `createApiClient` both satisfy it. */
export interface AttentionSnapshotSource {
  getAttention(filter?: AttentionFilter): Promise<AttentionSnapshot>;
}

/**
 * The stream port. `MuxStreamClient` satisfies it structurally; the web
 * adapts `openMultiplexedStream`.
 */
export interface AttentionStreamPort {
  subscribe(
    scope: string,
    id: string,
    handler: (event: AttentionStreamEvent) => void,
    options?: {
      filter?: string[];
      onConnected?: () => void;
      onDisconnected?: (reason?: string) => void;
    },
  ): () => void;
}

export interface AttentionStore {
  getState(): AttentionState;
  /** Called after every state change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  /** Refetch the snapshot now (pull-to-refresh). */
  refresh(): Promise<void>;
}

/** The timer the retry backoff runs on. Injectable so tests can drive it. */
export interface AttentionTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AttentionRetryOptions {
  /** First retry delay; doubles per consecutive failure. Default 1 s. */
  baseMs?: number;
  /** Longest retry delay. Default 30 s. */
  maxMs?: number;
}

export interface AttentionStoreOptions {
  projectId?: string;
  retry?: AttentionRetryOptions;
  /** Defaults to the global `setTimeout` / `clearTimeout`. */
  timers?: AttentionTimers;
}

export const ATTENTION_RETRY_BASE_MS = 1_000;
export const ATTENTION_RETRY_MAX_MS = 30_000;

/** Back-to-back refetches before backing off, so a persistent loss cannot spin. */
const MAX_CONSECUTIVE_FETCHES = 5;

const globalTimers: AttentionTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createAttentionStore(
  api: AttentionSnapshotSource,
  mux: AttentionStreamPort,
  options: AttentionStoreOptions = {},
): AttentionStore {
  const filter: AttentionFilter = options.projectId ? { projectId: options.projectId } : {};
  let state = initialAttentionState(filter);
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  let running = false;
  let fetching: Promise<void> | null = null;
  let refetchQueued = false;
  let disconnected = false;
  const timers = options.timers ?? globalTimers;
  const retryBaseMs = options.retry?.baseMs ?? ATTENTION_RETRY_BASE_MS;
  const retryMaxMs = options.retry?.maxMs ?? ATTENTION_RETRY_MAX_MS;
  /** Consecutive rounds that ended without a usable snapshot; drives the backoff. */
  let failures = 0;
  let retryTimer: unknown = null;

  /** No snapshot yet, or the one held is stale: either way the view needs a fetch. */
  const needsSnapshot = (): boolean => !state.snapshot || state.needsResync;

  const clearRetry = (): void => {
    if (retryTimer === null) return;
    timers.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (): void => {
    if (!running || retryTimer !== null) return;
    const delay = Math.min(retryBaseMs * 2 ** failures, retryMaxMs);
    failures += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      void run();
    }, delay);
  };

  /** An internal trigger (gap, resync). A pending retry already covers it: wait for that. */
  const trigger = (): void => {
    if (retryTimer === null) void run();
  };

  const dispatch = (event: AttentionReducerEvent): void => {
    const next = attentionReducer(state, event);
    if (next !== state) {
      state = next;
      for (const listener of listeners) listener();
    }
    if (event.type === 'resync') trigger();
    // A gap seen while a fetch is in flight is the replay's to settle.
    else if (event.type === 'stream' && needsSnapshot() && !state.fetching) trigger();
  };

  /** Resolves true when a snapshot landed. */
  const fetchOnce = async (): Promise<boolean> => {
    dispatch({ type: 'fetch' });
    try {
      const snapshot = await api.getAttention(filter.projectId ? filter : undefined);
      if (running) dispatch({ type: 'snapshot', snapshot });
      return true;
    } catch (err) {
      if (running) dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };

  const run = (): Promise<void> => {
    if (!running) return Promise.resolve();
    if (fetching) {
      refetchQueued = true;
      return fetching;
    }
    fetching = (async () => {
      try {
        let rounds = 0;
        let ok = true;
        do {
          refetchQueued = false;
          ok = await fetchOnce();
          rounds += 1;
        } while (ok && running && rounds < MAX_CONSECUTIVE_FETCHES && (refetchQueued || state.needsResync));
        if (ok) failures = 0;
        // Still without a usable snapshot (the fetch failed, or the rounds ran
        // out on a persistent loss): try again after the backoff. A failed
        // refresh of a live, current view needs no retry — the stream keeps it.
        if (running && (refetchQueued || needsSnapshot())) scheduleRetry();
      } finally {
        fetching = null;
      }
    })();
    return fetching;
  };

  /** Explicit (pull-to-refresh, a safety interval): fetch now, even during a backoff. */
  const refresh = (): Promise<void> => {
    clearRetry();
    return run();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (running) return;
      running = true;
      unsubscribe = mux.subscribe('global', 'all', (event) => dispatch({ type: 'stream', event }), {
        filter: [...ATTENTION_STREAM_FILTER],
        onConnected: () => {
          // A reconnect may have resumed cleanly, but a restarted server
          // re-numbers `seq`; one cheap refetch settles both cases.
          if (disconnected) {
            disconnected = false;
            dispatch({ type: 'resync' });
          }
        },
        onDisconnected: (reason) => {
          // A gap is repaired right now; marking it disconnected as well would
          // fetch a second time on the next connect.
          if (reason?.startsWith('gap')) dispatch({ type: 'resync' });
          else disconnected = true;
        },
      });
      void run();
    },
    stop() {
      running = false;
      clearRetry();
      failures = 0;
      unsubscribe?.();
      unsubscribe = null;
    },
    refresh,
  };
}
