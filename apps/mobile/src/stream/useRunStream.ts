// ────────────────────────────────────────────────────────────────
// useRunStream — live updates for ONE open workflow run.
//
// The server fans every event carrying a `workflowRunId` out to the `run`
// scope (apps/server/src/composition/streamScopes.ts). Subscribing it while
// the run screen is focused turns a 5 s poll into event-driven refreshes;
// the screen keeps a slow poll as a safety net (`pollIntervalFor`).
//
// Events only INVALIDATE — the detail endpoints stay the source of truth, so
// a dropped or out-of-order frame can never leave the screen wrong, only
// briefly stale. Invalidations are coalesced: a running stage emits step
// events in bursts and one refetch per burst is plenty.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type MuxStreamEvent } from '@generatorai/client-core';

import { useMuxStream } from './MuxStreamProvider';

/** Kind prefixes that change what the run screens show. */
export const RUN_SCOPE_FILTER: readonly string[] = ['workflow_run.', 'stage_run.', 'chat.', 'message.'];

/** Coalescing window for bursts of step events. */
const FLUSH_MS = 400;

export function useRunStream(runId: string | undefined, enabled = true): { connected: boolean } {
  const stream = useMuxStream();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!stream || !runId || !enabled) {
      setConnected(false);
      return;
    }

    const flush = (): void => {
      timer.current = null;
      // Prefix match: run detail, interrupts, scratchpad and stage transcripts.
      void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
    };

    const unsubscribe = stream.subscribe(
      'run',
      runId,
      (_event: MuxStreamEvent) => {
        if (timer.current == null) timer.current = setTimeout(flush, FLUSH_MS);
      },
      {
        filter: [...RUN_SCOPE_FILTER],
        onConnected: () => setConnected(true),
        onReconnecting: () => setConnected(false),
        onDisconnected: () => {
          setConnected(false);
          // A gap means events were missed — refetch rather than trust the cache.
          flush();
        },
      },
    );

    return () => {
      unsubscribe();
      if (timer.current != null) clearTimeout(timer.current);
      timer.current = null;
      setConnected(false);
    };
  }, [stream, runId, enabled, queryClient]);

  return { connected };
}
