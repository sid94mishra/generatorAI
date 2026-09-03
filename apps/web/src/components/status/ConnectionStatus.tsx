// ────────────────────────────────────────────────────────────────
// ConnectionStatus — SSE connection state indicator
// ────────────────────────────────────────────────────────────────

import React, { useState, useRef } from 'react';
import { useConnectionStore } from '@/stores/connectionStore.js';
import { cn } from '@/lib/utils.js';

interface ConnectionStatusProps {
  sessionId: string;
}

export function ConnectionStatus({ sessionId }: ConnectionStatusProps) {
  const connection = useConnectionStore((state) => state.connections[sessionId]);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const state = connection?.state ?? 'disconnected';
  const lastEventTime = connection?.lastEventTime;
  const eventsReceived = connection?.eventsReceived ?? 0;
  // N4 — a resume that had to skip past a hole. The transcript on screen is
  // missing events that will never arrive, so the indicator says so rather
  // than showing a healthy green dot over an incomplete conversation.
  const unrecoverable = connection?.unrecoverableEvents ?? 0;

  const dotColor: Record<string, string> = {
    connected: 'bg-green-500',
    reconnecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-red-500',
  };

  const label: Record<string, string> = {
    connected: 'Connected',
    reconnecting: 'Reconnecting...',
    disconnected: 'Disconnected',
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
        <span className={cn('h-2 w-2 rounded-full', dotColor[state])} />
        <span className="hidden sm:inline">{label[state]}</span>
        {unrecoverable > 0 && (
          <span
            data-testid="connection-gap-badge"
            title={`${unrecoverable} event${unrecoverable === 1 ? '' : 's'} could not be recovered after a dropped connection — reload to refetch the full transcript`}
            className="rounded bg-[var(--color-warning)]/15 px-1 text-[10px] font-semibold text-[var(--color-warning)]"
          >
            ⚠ gap
          </span>
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-subtle p-3 text-xs"
        >
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[var(--color-muted-foreground)]">Status</span>
              <span className="font-medium text-[var(--color-foreground)]">{label[state]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted-foreground)]">Events</span>
              <span className="font-medium text-[var(--color-foreground)]">{eventsReceived}</span>
            </div>
            {unrecoverable > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-[var(--color-warning)]">Unrecovered</span>
                <span className="font-medium text-[var(--color-warning)]">{unrecoverable}</span>
              </div>
            )}
            {lastEventTime && (
              <div className="flex justify-between">
                <span className="text-[var(--color-muted-foreground)]">Last event</span>
                <span className="font-medium text-[var(--color-foreground)]">
                  {new Date(lastEventTime).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
