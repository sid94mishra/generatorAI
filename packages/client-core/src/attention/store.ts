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

export interface AttentionStoreOptions {
  projectId?: string;
}

/** Back-to-back refetches before waiting for the next trigger, so a persistent loss cannot spin. */
const MAX_CONSECUTIVE_FETCHES = 5;

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

  const dispatch = (event: AttentionReducerEvent): void => {
    const next = attentionReducer(state, event);
    if (next !== state) {
      state = next;
      for (const listener of listeners) listener();
    }
    if (event.type === 'resync') void refresh();
    // A gap seen while a fetch is in flight is the replay's to settle.
    else if (event.type === 'stream' && state.needsResync && !state.fetching) void refresh();
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

  const refresh = (): Promise<void> => {
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
      } finally {
        fetching = null;
      }
    })();
    return fetching;
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
      void refresh();
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
    },
    refresh,
  };
}
