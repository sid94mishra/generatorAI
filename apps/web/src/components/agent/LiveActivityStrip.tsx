// ────────────────────────────────────────────────────────────────
// LiveActivityStrip — "2 tools running · 3 sub-agents running · 1 pending".
//
// One line above the composer while a turn is in flight. During an
// orchestrator turn the transcript scrolls faster than it can be read and the
// only question the user has is how much is still outstanding; the strip
// answers it in a fixed place that does not move.
//
// It subscribes to the stream store ITSELF, with a selector that returns a
// primitive string. That matters: the blocks array is replaced on every
// streamed token, so a component that read `blocks` would re-render the
// composer area ~60×/second. Reading the formatted line instead means the
// strip re-renders only when the numbers actually change.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Spinner } from '@/components/ui/index.js';
import { useStreamStore } from '@/stores/streamStore.js';
import {
  computeLiveCounters,
  countRunningBackgroundTasks,
  formatLiveCounters,
} from '@/components/agent/liveCounters.js';

/** Running-or-pending background workers, for the Background Tasks tab badge. */
export function useRunningBackgroundTaskCount(sessionId: string | undefined): number {
  return useStreamStore((state) =>
    sessionId ? countRunningBackgroundTasks(state.streams[sessionId]?.blocks) : 0,
  );
}

export const LiveActivityStrip = React.memo(function LiveActivityStrip({
  sessionId,
  active,
}: {
  sessionId: string | undefined;
  /** The turn is in flight. A settled turn has nothing in flight to report. */
  active: boolean;
}) {
  const line = useStreamStore((state) =>
    sessionId ? formatLiveCounters(computeLiveCounters(state.streams[sessionId]?.blocks)) : null,
  );

  if (!active || !line) return null;

  return (
    <div
      data-testid="live-activity-strip"
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 px-1 pb-1 text-[11px] text-[var(--color-muted-foreground)]"
    >
      <Spinner size="xs" className="shrink-0 text-[var(--color-primary)]" />
      <span className="truncate">{line}</span>
    </div>
  );
});
