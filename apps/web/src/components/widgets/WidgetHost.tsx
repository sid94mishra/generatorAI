// ────────────────────────────────────────────────────────────────
// WidgetHost — Renders every full-page (`surface: 'widget'`) widget
// block for a session. Used as the RightPane `widget` tab body on both
// the Chat page and the Workflow Run page.
//
// Because a single session can have multiple widgets alive at once, we
// render them as a stacked list of frames. Each frame is full-height
// (flex-1) so the topmost stays useful.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useStreamStore, type StreamBlock } from '@/stores/streamStore.js';
import { WidgetFrame } from '@/components/widgets/WidgetFrame.js';

interface WidgetHostProps {
  sessionId: string;
}

export function WidgetHost({ sessionId }: WidgetHostProps) {
  const stream = useStreamStore((s) => s.streams[sessionId]);
  const widgets = React.useMemo(() => {
    if (!stream) return [];
    return stream.blocks.filter(
      (b): b is Extract<StreamBlock, { type: 'widget' }> =>
        b.type === 'widget' && b.surface === 'widget' && b.status !== 'closed',
    );
  }, [stream]);

  if (widgets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-6 gap-2 text-xs text-[var(--color-muted-foreground)]">
        <div className="text-sm font-medium text-[var(--color-foreground)]">
          No widgets yet
        </div>
        <div>
          Ask the assistant to build or render an interactive widget.
        </div>
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
