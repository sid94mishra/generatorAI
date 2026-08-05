// ────────────────────────────────────────────────────────────────
// WidgetHost — the RightPane `widget` tab body, on both the Chat page and
// the Workflow Run page.
//
// Three modes, picked by props:
//   • `instanceId` — render exactly that widget, full height. This is what a
//     tab bound to a widget uses, so N widgets live in N tabs instead of
//     fighting over one.
//   • `onOpenWidget` — render a launcher listing the session's widgets. Used
//     by an UNBOUND tab so it never mounts a second live copy of a widget
//     that already has its own tab.
//   • neither — legacy stacked frames (workflow runs still use this).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { LayoutGrid, ExternalLink } from 'lucide-react';
import { useStreamStore, type StreamBlock } from '@/stores/streamStore.js';
import { WidgetFrame } from '@/components/widgets/WidgetFrame.js';

type WidgetBlock = Extract<StreamBlock, { type: 'widget' }>;

interface WidgetHostProps {
  sessionId: string;
  /** Bind this host to a single widget instance. */
  instanceId?: string;
  /** Render a launcher instead of live frames, and open the picked widget. */
  onOpenWidget?: (instanceId: string) => void;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--color-muted-foreground)]">
      <div className="text-sm font-medium text-[var(--color-foreground)]">No widgets yet</div>
      <div>Ask the assistant to build or render an interactive widget.</div>
    </div>
  );
}

export function WidgetHost({ sessionId, instanceId, onOpenWidget }: WidgetHostProps) {
  const stream = useStreamStore((s) => s.streams[sessionId]);
  const widgets = React.useMemo<WidgetBlock[]>(() => {
    if (!stream) return [];
    return stream.blocks.filter(
      (b): b is WidgetBlock =>
        b.type === 'widget' && b.surface === 'widget' && b.status !== 'closed',
    );
  }, [stream]);

  if (instanceId) {
    const block = widgets.find((w) => w.instanceId === instanceId);
    if (!block) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--color-muted-foreground)]">
          <div className="text-sm font-medium text-[var(--color-foreground)]">
            Widget no longer available
          </div>
          <div>It was closed, or its extension was removed or reloaded without it.</div>
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        <WidgetFrame block={block} sessionId={sessionId} fullscreen />
      </div>
    );
  }

  if (widgets.length === 0) return <EmptyState />;

  if (onOpenWidget) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto p-3">
        <p className="px-1 pb-1 text-[11px] text-[var(--color-muted-foreground)]">
          {widgets.length} widget{widgets.length === 1 ? '' : 's'} in this chat — each opens in its
          own tab.
        </p>
        {widgets.map((w) => (
          <button
            key={w.instanceId}
            type="button"
            onClick={() => onOpenWidget(w.instanceId)}
            className="flex items-center gap-2.5 rounded-lg border border-[var(--color-border)]/60 px-3 py-2 text-left transition-colors hover:bg-[var(--color-accent)]/50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <LayoutGrid className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-[var(--color-foreground)]">
                {w.title ?? w.component}
              </span>
              <span className="block truncate font-mono text-[10px] text-[var(--color-muted-foreground)]">
                {w.descriptorId}
              </span>
            </span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {widgets.map((w) => (
        <div key={w.instanceId} className="flex-1 min-h-0">
          <WidgetFrame block={w} sessionId={sessionId} fullscreen />
        </div>
      ))}
    </div>
  );
}
