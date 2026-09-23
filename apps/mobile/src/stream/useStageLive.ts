// ────────────────────────────────────────────────────────────────
// A running workflow stage, streamed.
//
// The run screens read a stage's transcript from REST, and the server saves
// the agent's message only when the stage ends, so a running stage showed
// its prompt and nothing else for minutes. This rebuilds the stage the way
// web's `sseManager` does: subscribe to the run and buffer, page the stage's
// logged events so far over REST (`stageCatchUpRows`), apply those, then the
// buffered and live events newer than the backlog — all through the chat's
// own event router into the stream store under `stageRun:<id>`, the key web
// uses for the same thing. Subscribing first is what closes the gap between
// the backlog read and the live edge; the sequence check drops the overlap.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { StreamEventRouter, type MuxStreamEvent, type StreamEffect, type StreamState } from '@generatorai/client-core';
import { MOBILE_CAPABILITIES } from '@generatorai/shared';

import { useApi } from '../api/useApi';
import type { ReplayPage } from '../components/scm/scmResults';
import { useMuxStream } from './MuxStreamProvider';
import { protectStream, useStreamStore } from './streamStore';
import { CATCH_UP_PAGE_SIZE, stageCatchUpRows } from './turnCatchUp';

const FLUSH_INTERVAL_MS = 16;

export function stageStreamKey(stageRunId: string): string {
  return `stageRun:${stageRunId}`;
}

/**
 * One feed per stage however many screens show it. The run page stays
 * mounted under the stage screen, and two feeds writing the same key would
 * each apply every event — doubled text.
 */
const feeds = new Map<string, { count: number; stop: () => void }>();

function acquire(key: string, start: () => () => void): () => void {
  const existing = feeds.get(key);
  if (existing) existing.count += 1;
  else feeds.set(key, { count: 1, stop: start() });
  return () => {
    const feed = feeds.get(key);
    if (!feed) return;
    feed.count -= 1;
    if (feed.count > 0) return;
    feeds.delete(key);
    feed.stop();
  };
}

/** The stage's live stream state while it runs; undefined before it has any. */
export function useStageLive(runId: string, stageRunId: string, live: boolean): StreamState | undefined {
  const api = useApi();
  const stream = useMuxStream();
  const key = stageStreamKey(stageRunId);

  useEffect(() => {
    if (!live || !stream) return;
    const mux = stream;
    return acquire(key, () => startFeed(mux));

    function startFeed(mux: NonNullable<typeof stream>): () => void {
      const unprotect = protectStream(key);
      // Rebuilt from the log on every mount, so start from nothing.
      useStreamStore.getState().clear(key);

      const router = new StreamEventRouter({ blockDelivery: MOBILE_CAPABILITIES.highLatencyBlockDelivery });
      let pending: StreamEffect[] = [];
      let buffered: MuxStreamEvent[] | null = [];
      let backlogEnd = 0;
      let cancelled = false;

      const route = (kind: string, data: Record<string, unknown>): void => {
        if (data['stageRunId'] !== stageRunId) return;
        for (const effect of router.handle(key, { kind, data })) {
          // The run screens refetch the run on their own; only block edits land here.
          if (effect.op !== 'invalidate') pending.push(effect);
        }
      };
      const routeLive = (event: MuxStreamEvent): void => {
        if (event.sequence !== undefined && event.sequence <= backlogEnd) return;
        route(event.kind, event.data);
      };
      const flush = (final = false): void => {
        const effects = pending.concat(final ? router.drainFinal() : router.drain());
        pending = [];
        if (effects.length > 0) useStreamStore.getState().applyEffects(effects);
      };

      const unsubscribe = mux.subscribe(
        'run',
        runId,
        (event: MuxStreamEvent) => {
          if (buffered) buffered.push(event);
          else routeLive(event);
        },
        { filter: ['harness.'] },
      );
      const timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);

      void stageCatchUpRows(
        (afterSeq) => api.replay('run', runId, afterSeq, CATCH_UP_PAGE_SIZE) as Promise<ReplayPage>,
        stageRunId,
      )
        .catch(() => null)
        .then((backlog) => {
          if (cancelled) return;
          for (const row of backlog?.rows ?? []) route(row.kind, row.payload ?? {});
          backlogEnd = backlog?.lastSeq ?? 0;
          const held = buffered ?? [];
          buffered = null;
          for (const event of held) routeLive(event);
          flush();
        });

      return () => {
        cancelled = true;
        unsubscribe();
        clearInterval(timer);
        flush(true);
        router.reset();
        unprotect();
      };
    }
  }, [live, stream, api, runId, stageRunId, key]);

  return useStreamStore((s) => (live ? s.streams[key] : undefined));
}
