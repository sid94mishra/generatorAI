// ────────────────────────────────────────────────────────────────
// createAttentionStore — the attention feed as a framework-free store (G-01).
//
// Wires `attentionReducer` to its two inputs: the snapshot endpoint and the
// `global` stream scope. Mobile wraps it in its own state container; the web
// uses React Query plus `applyAttentionEvent` directly
// (`apps/web/src/hooks/attentionQueries.ts`), with the same seq rules.
//
// Lifecycle:
//   start()  subscribe `global` (filtered to `attention.`) FIRST, then fetch
//            the snapshot — deltas that land while the fetch is in flight are
//            buffered by the reducer and replayed on top of it.
//   gap      a skipped `seq`, a stream `gap:` disconnect, or a reconnect after
//            any disconnect marks the snapshot stale; the store refetches.
//            One fetch at a time; a gap during a fetch triggers exactly one
//            more.
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
    // Also when the state did not change: a second gap during a fetch that
    // may have been answered before it must queue one more fetch.
    if (state.needsResync && (event.type === 'stream' || event.type === 'resync')) void refresh();
  };

  const fetchOnce = async (): Promise<void> => {
    try {
      const snapshot = await api.getAttention(filter.projectId ? filter : undefined);
      if (running) dispatch({ type: 'snapshot', snapshot });
    } catch (err) {
      if (running) dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
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
        do {
          refetchQueued = false;
          await fetchOnce();
        } while (refetchQueued && running);
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
          disconnected = true;
          if (reason?.startsWith('gap')) dispatch({ type: 'resync' });
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
