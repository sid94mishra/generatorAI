// ────────────────────────────────────────────────────────────────
// LiveActivityLine — "2 tools running · 3 sub-agents running · 1 pending",
// one line above the composer while a turn (or an orchestrator's workers) is
// in flight (04 parity #31; moved from components/agent/LiveActivityStrip in
// P4-12, restyled on the kit).
//
// It subscribes to the stream store ITSELF with a selector that returns a
// primitive string: the blocks array is replaced on every streamed token, so
// reading `blocks` would re-render the composer area ~60×/second; reading the
// formatted line re-renders only when the numbers change.
// ────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { computeLiveCounters, countRunningBackgroundTasks, formatLiveCounters } from '@generatorai/client-core';
import { useStreamStore } from '@/stores/streamStore.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';

/** Running-or-pending background workers, for the Tasks tab badge. */
export function useRunningBackgroundTaskCount(sessionId: string | undefined): number {
  return useStreamStore((state) => (sessionId ? countRunningBackgroundTasks(state.streams[sessionId]?.blocks) : 0));
}

export const LiveActivityLine = memo(function LiveActivityLine({
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
  const shown = active && !!line;
  // Eases in above the composer (D-108), so the transcript above shrinks smoothly; leaves at once.
  return (
    <Reveal open={shown}>
      {shown ? (
        <div
          data-testid="live-activity-strip"
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 px-1 pb-1 text-small text-fg-3"
        >
          <Spinner size={12} className="shrink-0 text-run" />
          <span className="truncate">{line}</span>
        </div>
      ) : null}
    </Reveal>
  );
});
