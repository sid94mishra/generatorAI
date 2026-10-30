// ────────────────────────────────────────────────────────────────
// Browser session events over the multiplexed stream
// (`session` scope `browser:<workspaceId>`, prefix `browser.`): session and
// navigation changes refetch the descriptor at once; an inspector pick is
// handed to `onSelection`.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';

import { openMultiplexedStream } from '@/platform/muxStream.js';

import { fetchBrowserDescriptor, type BrowserDescriptor } from './browserApi.js';
import { parseBrowserStreamMessage, type BrowserSelection } from './browserEvents.js';

export function useBrowserEvents({ open, workspaceId, onDescriptor, onSelection, onError }: {
  open: boolean;
  workspaceId: string | undefined;
  onDescriptor: (d: BrowserDescriptor) => void;
  onSelection: (sel: BrowserSelection) => void;
  /** A page was blocked or the browser failed: show it, never fail silently. */
  onError?: (message: string) => void;
}): void {
  // The callbacks are read through refs so the subscription does not depend
  // on them. Otherwise a parent passing an inline callback re-runs the
  // effect on every render, closing + reopening the stream — and the
  // `browser.selection` event fires in the tiny gap where no listener is
  // attached, silently losing the attachment.
  const onDescriptorRef = useRef(onDescriptor);
  const onSelectionRef = useRef(onSelection);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onDescriptorRef.current = onDescriptor;
    onSelectionRef.current = onSelection;
    onErrorRef.current = onError;
  }, [onDescriptor, onSelection, onError]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    const es = openMultiplexedStream(
      'session',
      `browser:${workspaceId}`,
      {
        onMessage: (e) => {
          try {
            const msg = parseBrowserStreamMessage(e.data);
            if (!msg) return;
            if (msg.refreshDescriptor) {
              void fetchBrowserDescriptor(workspaceId).then((d) => onDescriptorRef.current(d)).catch(() => undefined);
            }
            if (msg.selection) onSelectionRef.current(msg.selection);
            if (msg.error) onErrorRef.current?.(msg.error);
          } catch { /* ignore */ }
        },
      },
      ['browser.'],
    );
    return () => { es.close(); };
  }, [open, workspaceId]);
}
