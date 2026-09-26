// ────────────────────────────────────────────────────────────────
// Live-stream health for the shell (sidebar footer, rail dot) — the data half
// of the old `status/ConnectionStatus.tsx` badge, which lived in the global
// Header until P3-04 moved connection status to the sidebar footer (D-21).
//
// Two things only the shell can say:
//  • the stream is reconnecting / has dropped — a server restart used to be
//    completely invisible (observed live: server killed mid-turn, page showed
//    nothing);
//  • a resume had to skip past a hole (`connectionStore.recordGap`): the
//    transcript on screen misses events that will never arrive over the
//    stream. The one real fix is to refetch from the persisted history, which
//    does have them.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectionStore, type ConnectionState } from '@/stores/connectionStore.js';

export interface ConnectionSummary {
  state: ConnectionState;
  eventsReceived: number;
  lastEventTime: number | null;
  /** Events that could not be recovered after a dropped connection. */
  unrecoverable: number;
  lastGapAt: number | null;
}

/** Worst state across the given connection rows, plus summed gap counts. */
export function summarizeConnections(
  rows: ReadonlyArray<{
    state: ConnectionState;
    eventsReceived: number;
    lastEventTime: number | null;
    unrecoverableEvents: number;
    lastGapAt: number | null;
  }>,
  scoped: boolean,
): ConnectionSummary {
  let state: ConnectionState = scoped ? 'disconnected' : 'connected';
  let eventsReceived = 0;
  let lastEventTime: number | null = null;
  let unrecoverable = 0;
  let lastGapAt: number | null = null;
  for (const info of rows) {
    eventsReceived += info.eventsReceived;
    if (info.lastEventTime !== null && (lastEventTime === null || info.lastEventTime > lastEventTime)) {
      lastEventTime = info.lastEventTime;
    }
    unrecoverable += info.unrecoverableEvents;
    if (info.lastGapAt !== null && (lastGapAt === null || info.lastGapAt > lastGapAt)) {
      lastGapAt = info.lastGapAt;
    }
    if (scoped) {
      state = info.state;
      continue;
    }
    // Aggregate mode: a 'disconnected' row with zero received events is the
    // initial record for a scope whose subscription never opened (or a stale
    // default), not an outage — ignore it.
    if (info.state === 'reconnecting' && state === 'connected') state = 'reconnecting';
    if (info.state === 'disconnected' && info.eventsReceived > 0) state = 'disconnected';
  }
  return { state, eventsReceived, lastEventTime, unrecoverable, lastGapAt };
}

/** Every stream scope this tab is subscribed to, summarised (worst state wins). */
export function useConnectionSummary(): ConnectionSummary {
  return useConnectionStore(useShallow((s) => summarizeConnections(Object.values(s.connections), false)));
}

/**
 * Refetch every active query (the transcript above all) from the persisted
 * history, then clear the recorded gap. The missing events are gone from the
 * STREAM, not from the server.
 */
export function useRefetchAfterGap(): { refetch: () => Promise<void>; refetching: boolean } {
  const clearGap = useConnectionStore((s) => s.clearGap);
  const queryClient = useQueryClient();
  const [refetching, setRefetching] = useState(false);
  const refetch = useCallback(async () => {
    setRefetching(true);
    try {
      await queryClient.invalidateQueries();
      clearGap();
    } finally {
      setRefetching(false);
    }
  }, [queryClient, clearGap]);
  return { refetch, refetching };
}
