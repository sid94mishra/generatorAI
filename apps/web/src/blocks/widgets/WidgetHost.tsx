// ────────────────────────────────────────────────────────────────
// WidgetHost — the dock's Widget tab body (F-dock-08), on the chat page and
// the legacy workflow run page. Three modes, picked by props:
//   • `instanceId` — exactly that widget, full height: a tab bound to one
//     widget, so N widgets live in N tabs instead of fighting over one.
//   • `onOpenWidget` — a launcher listing the session's widgets, for an
//     UNBOUND tab (added from "+"), so it never mounts a second live copy of
//     a widget that already has its own tab.
//   • neither — every widget stacked (the workflow run page).
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useStreamStore, type WidgetBlock } from '@/stores/streamStore.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { focusRing } from '@/ui/lib/focus.js';
import { WidgetFrame } from './WidgetFrame.js';

export interface WidgetHostProps {
  sessionId: string;
  /** Bind this host to a single widget instance. */
  instanceId?: string;
  /** Render a launcher instead of live frames, and open the picked widget. */
  onOpenWidget?: (instanceId: string) => void;
}

export function WidgetHost({ sessionId, instanceId, onOpenWidget }: WidgetHostProps) {
  const blocks = useStreamStore((s) => s.streams[sessionId]?.blocks);
  const widgets = useMemo<WidgetBlock[]>(
    () =>
      (blocks ?? []).filter(
        (b): b is WidgetBlock => b.type === 'widget' && b.surface === 'widget' && b.status !== 'closed',
      ),
    [blocks],
  );

  if (instanceId) {
    const block = widgets.find((w) => w.instanceId === instanceId);
    if (!block) {
      return (
        <EmptyState
          icon="widgets"
          title="Widget no longer available"
          description="It was closed, or its extension was removed or reloaded without it."
          className="h-full bg-surface px-6"
        />
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <WidgetFrame block={block} sessionId={sessionId} fullscreen />
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <EmptyState
        icon="widgets"
        title="No widgets yet"
        description="Ask the assistant to build or render an interactive widget."
        className="h-full bg-surface px-6"
      />
    );
  }

  if (onOpenWidget) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto bg-surface p-3">
        <p className="px-1 pb-1 text-small text-fg-3">
          {widgets.length} widget{widgets.length === 1 ? '' : 's'} in this chat — each opens in its own tab.
        </p>
        <ul className="flex flex-col gap-1.5">
          {widgets.map((w) => (
            <li key={w.instanceId}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenWidget(w.instanceId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenWidget(w.instanceId);
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-card border border-line-soft bg-raised px-3 py-2 hover:bg-hover',
                  focusRing,
                )}
              >
                <span className="flex size-control shrink-0 items-center justify-center rounded-control bg-run-bg text-run">
                  <Icon concept="widgets" size={14} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui font-medium text-fg">{w.title ?? w.component}</span>
                  <span className="truncate font-mono text-small text-fg-3">{w.descriptorId}</span>
                </span>
                <Icon concept="external-link" size={14} className="shrink-0 text-fg-3" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {widgets.map((w) => (
        <div key={w.instanceId} className="min-h-0 flex-1">
          <WidgetFrame block={w} sessionId={sessionId} fullscreen />
        </div>
      ))}
    </div>
  );
}
