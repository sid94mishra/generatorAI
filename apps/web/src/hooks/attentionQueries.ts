// ────────────────────────────────────────────────────────────────
// Attention feed hooks (G-01) — Needs you + Running, live.
//
// The snapshot comes through React Query (`GET /api/attention`); the live
// half is one `global` subscription on the shared multiplexed stream,
// filtered to `attention.`, whose deltas are folded into the cached snapshot
// with client-core's `applyAttentionEvent` — the same seq rules mobile's
// `createAttentionStore` applies:
//
//   - a delta already covered by the snapshot is ignored;
//   - a skipped `seq`, a stream resync, or a reconnect after an error
//     invalidates the query, which refetches;
//   - deltas that arrive before the first snapshot are held and replayed on
//     top of it, so nothing that happened during the fetch is lost.
//
// Consumers: the sidebar and rail (P3), ChatsList status (P3), Home, the
// ProjectDetail banner and the palette (P5). No UI lives here. Until
// `data` is defined the lists are UNKNOWN, not empty — render nothing
// rather than "Nothing needs you" (D-36).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ATTENTION_STREAM_FILTER,
  applyAttentionEvent,
  isAttentionStreamEvent,
  type AttentionStreamEvent,
} from '@generatorai/client-core';
import type { AttentionCounts, AttentionFilter, AttentionSnapshot } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import { openMultiplexedStream } from '../platform/muxStream.js';

export const attentionKeys = {
  all: ['attention'] as const,
  snapshot: (projectId?: string) => ['attention', projectId ?? 'all'] as const,
};

export interface UseAttentionOptions {
  /** Only this project's items; counts follow the filter. */
  projectId?: string;
  enabled?: boolean;
}

/** Parses one multiplexed frame body (`{"kind":…,"payload":…}`). */
function parseFrame(raw: string): AttentionStreamEvent | null {
  try {
    const frame = JSON.parse(raw) as { kind?: unknown; payload?: unknown };
    return typeof frame.kind === 'string' ? { kind: frame.kind, data: frame.payload } : null;
  } catch {
    return null;
  }
}

/**
 * Applies one delta to the cached snapshot for `key`. Returns false when the
 * cache holds no snapshot yet (the caller buffers the delta).
 */
function applyToCache(
  queryClient: QueryClient,
  key: readonly unknown[],
  filter: AttentionFilter,
  event: AttentionStreamEvent,
): boolean {
  const current = queryClient.getQueryData<AttentionSnapshot>(key);
  if (!current) return false;
  const result = applyAttentionEvent(current, event, filter);
  if (result.gap) {
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  } else if (result.snapshot !== current) {
    queryClient.setQueryData(key, result.snapshot);
  }
  return true;
}

/** Pre-snapshot deltas worth holding; anything older is either in the snapshot or shows up as a gap. */
const MAX_BUFFERED = 500;

/** The attention snapshot, kept live. `data.needsYou` / `data.running` / `data.counts`. */
export function useAttention(options: UseAttentionOptions = {}) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const { projectId } = options;
  const enabled = options.enabled !== false;
  const buffered = useRef<AttentionStreamEvent[]>([]);

  const query = useQuery({
    queryKey: attentionKeys.snapshot(projectId),
    queryFn: () => platform.getAttention(projectId ? { projectId } : undefined),
    enabled,
    // The stream keeps it current; the interval is only a safety net for a
    // principal whose `global` subscription was refused.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!enabled) return;
    const key = attentionKeys.snapshot(projectId);
    const filter: AttentionFilter = projectId ? { projectId } : {};
    const refetch = (): void => {
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    };
    let lostConnection = false;
    buffered.current = [];

    const handle = openMultiplexedStream(
      'global',
      'all',
      {
        onMessage: (message) => {
          const event = parseFrame(message.data);
          if (!event || !isAttentionStreamEvent(event)) return;
          if (!applyToCache(queryClient, key, filter, event)) {
            buffered.current = [...buffered.current, event].slice(-MAX_BUFFERED);
          }
        },
        // The server could not replay this scope from our cursor.
        onResync: refetch,
        onError: () => {
          lostConnection = true;
        },
        onOpen: () => {
          // A restarted server re-numbers `seq`; one refetch settles it.
          if (lostConnection) {
            lostConnection = false;
            refetch();
          }
        },
      },
      [...ATTENTION_STREAM_FILTER],
    );
    return () => {
      handle.close();
      buffered.current = [];
    };
  }, [enabled, projectId, queryClient]);

  // Replay deltas that arrived while the first snapshot was in flight.
  const data = query.data;
  useEffect(() => {
    if (!data || buffered.current.length === 0) return;
    const key = attentionKeys.snapshot(projectId);
    const filter: AttentionFilter = projectId ? { projectId } : {};
    const pending = buffered.current;
    buffered.current = [];
    for (const event of pending) applyToCache(queryClient, key, filter, event);
  }, [data, projectId, queryClient]);

  return query;
}

/**
 * Needs you / Running totals for badges (rail dot, running counter). Undefined
 * until loaded — never a made-up zero.
 */
export function useAttentionCounts(): AttentionCounts | undefined {
  return useAttention().data?.counts;
}
