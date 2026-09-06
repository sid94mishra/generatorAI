// ────────────────────────────────────────────────────────────────
// ConnectionStatus — live-stream health + the N4 "events are missing" badge.
//
// Mounted in the app header (`layout/Header.tsx`), so it is on screen on
// every page. Two things it has to say, neither of which the rest of the UI
// can:
//
//  • the stream is reconnecting / has dropped — a server restart used to be
//    completely invisible (observed live: server killed mid-turn, page showed
//    nothing);
//  • a resume had to skip past a hole (`connectionStore.recordGap`). The
//    transcript on screen is then missing events that will never arrive over
//    the stream. The badge names the moment it happened and offers the one
//    real fix: refetch from the persisted history, which does have them.
//
// Without `sessionId` it summarises every scope this tab is subscribed to —
// the worst state wins, gap counts are summed. Review 5.7 / plan item 10: the
// detection side of this was fully built and the badge had no importer; it
// now has one.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useConnectionStore, type ConnectionState } from '@/stores/connectionStore.js';
import { Tooltip } from '@/components/ui/Tooltip.js';
import { Button } from '@/components/ui/Button.js';
import { cn } from '@/lib/utils.js';

interface ConnectionStatusProps {
  /** Summarise one session; omit for every scope this tab is subscribed to. */
  sessionId?: string;
  /**
   * Render nothing while everything is connected and no gap is recorded.
   * The header uses this: a permanent green dot is noise, an absence of
   * warnings is the signal.
   */
  quietWhenHealthy?: boolean;
  className?: string;
}

interface Summary {
  state: ConnectionState;
  eventsReceived: number;
  lastEventTime: number | null;
  unrecoverable: number;
  lastGapAt: number | null;
}

const LABEL: Record<ConnectionState, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-success',
  reconnecting: 'bg-warning animate-pulse',
  disconnected: 'bg-danger',
};

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
): Summary {
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

export function ConnectionStatus({ sessionId, quietWhenHealthy = false, className }: ConnectionStatusProps) {
  const summary = useConnectionStore(
    useShallow((s): Summary => {
      const rows = sessionId
        ? (s.connections[sessionId] ? [s.connections[sessionId]!] : [])
        : Object.values(s.connections);
      return summarizeConnections(rows, sessionId !== undefined);
    }),
  );
  const clearGap = useConnectionStore((s) => s.clearGap);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // The missing events are gone from the STREAM, not from the server: the
  // persisted history has them. Refetching every active query — the transcript
  // above all — replaces the incomplete view with the authoritative one, and
  // only then is the warning cleared.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      clearGap(sessionId);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, clearGap, sessionId]);

  const { state, unrecoverable, lastGapAt } = summary;
  const healthy = state === 'connected' && unrecoverable === 0;
  if (quietWhenHealthy && healthy) return null;

  const gapTime = lastGapAt ? new Date(lastGapAt).toLocaleTimeString() : null;
  const gapTitle = `${unrecoverable} event${unrecoverable === 1 ? '' : 's'} could not be recovered after a dropped connection${gapTime ? ` (since ${gapTime})` : ''}. Refresh to reload the full transcript from the server.`;

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      data-testid="connection-status"
      data-state={state}
    >
      {(!quietWhenHealthy || state !== 'connected') && (
        <Tooltip
          content={
            state === 'connected'
              ? `Live updates connected · ${summary.eventsReceived} events${summary.lastEventTime ? ` · last ${new Date(summary.lastEventTime).toLocaleTimeString()}` : ''}`
              : state === 'reconnecting'
                ? 'Live updates interrupted — reconnecting. Anything missed is replayed on reconnect.'
                : 'Live updates disconnected. The page keeps retrying; refresh if this persists.'
          }
        >
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              state === 'connected' && 'border-border text-muted-foreground',
              state === 'reconnecting' && 'border-warning/40 text-warning',
              state === 'disconnected' && 'border-danger/40 text-danger',
            )}
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', DOT[state])} />
            <span>{LABEL[state]}</span>
          </span>
        </Tooltip>
      )}

      {unrecoverable > 0 && (
        <Tooltip content={gapTitle}>
          <Button
            variant="ghost"
            size="sm"
            data-testid="connection-gap-badge"
            aria-label={`${gapTitle} Refresh now.`}
            onClick={() => void refresh()}
            disabled={refreshing}
            className={cn(
              'h-auto gap-1 rounded-full border border-warning/40 bg-warning-muted px-2 py-0.5',
              'text-[11px] font-medium text-warning hover:bg-warning/20 hover:text-warning',
            )}
          >
            <TriangleAlert aria-hidden className="h-3 w-3" />
            <span>
              Events may be missing{gapTime ? ` since ${gapTime}` : ''}
              <span className="hidden sm:inline"> — refresh</span>
            </span>
            <RefreshCw aria-hidden className={cn('h-3 w-3', refreshing && 'animate-spin')} />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
