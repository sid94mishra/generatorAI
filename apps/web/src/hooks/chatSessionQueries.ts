// ────────────────────────────────────────────────────────────────
// Chat-session transport for the chat page (03-domain §6.4).
//
// Everything the chat page used to do with the platform client, raw `fetch`
// or the multiplexed stream directly: the chat's SSE connection, the browser
// and computer session events that pop dock tabs open, and starting the
// integrated browser in visible mode. The POLICY (which event opens which
// tab) lives in `features/chat`; these hooks only move bytes.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef } from 'react';
import { usePlatform } from '@/providers/PlatformProvider.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import { openMultiplexedStream } from '@/platform/muxStream.js';
import { connectChatSession } from '@/stores/sseManager.js';

/** Keep a callback's latest identity without resubscribing on every render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Connect the chat's event stream into the stream store while mounted.
 * Depends on primitives only, so a refetched chat record never reconnects.
 */
export function useChatSessionConnection(chatId: string | undefined, sessionId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  useEffect(() => {
    if (!chatId || !sessionId) return;
    const disconnect = connectChatSession(chatId, sessionId, platform);
    return () => {
      disconnect();
    };
  }, [chatId, sessionId, platform]);
}

/** What the chat page reads from the browser descriptor. */
export interface BrowserDescriptorProbe {
  ready?: boolean;
  config?: { visibility?: string };
}

function browserDescriptorUrl(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/browser/descriptor`;
}

async function readBrowserDescriptor(workspaceId: string): Promise<BrowserDescriptorProbe | null> {
  const response = await fetch(browserDescriptorUrl(workspaceId));
  return response.ok ? ((await response.json()) as BrowserDescriptorProbe) : null;
}

export interface BrowserSessionHandlers {
  /**
   * The descriptor as it stood when the page subscribed — chat creation may
   * have fired `browser.session_created` before anyone was listening.
   */
  onInitialDescriptor: (descriptor: BrowserDescriptorProbe) => void;
  /** A browser session was created; `descriptor` was re-read just after. */
  onSessionCreated: (descriptor: BrowserDescriptorProbe) => void;
}

/**
 * Browser session lifecycle for one workspace: a one-shot descriptor probe on
 * subscribe, then `browser.session_created` on the `browser:<workspaceId>`
 * channel (the one BrowserPanel listens on), each followed by a fresh
 * descriptor read so the caller can check the visibility policy. Failed reads
 * are ignored — the agent still lazy-starts the browser headless.
 */
export function useBrowserSessionEvents(
  workspaceId: string | undefined,
  handlers: BrowserSessionHandlers,
) {
  const latest = useLatest(handlers);
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void readBrowserDescriptor(workspaceId)
      .then((descriptor) => {
        if (cancelled || !descriptor) return;
        latest.current.onInitialDescriptor(descriptor);
      })
      .catch(() => undefined);
    const stream = openMultiplexedStream(
      'session',
      `browser:${workspaceId}`,
      {
        onMessage: (event) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse(event.data) as { kind?: string };
            if (payload.kind !== 'browser.session_created') return;
            void readBrowserDescriptor(workspaceId)
              .then((descriptor) => {
                if (cancelled || !descriptor) return;
                latest.current.onSessionCreated(descriptor);
              })
              .catch(() => undefined);
          } catch {
            /* malformed frame — ignore */
          }
        },
      },
      ['browser.session_created'],
    );
    return () => {
      cancelled = true;
      try {
        stream.close();
      } catch {
        /* already closed */
      }
    };
  }, [workspaceId, latest]);
}

/**
 * `computer.*` events for one workspace, while `enabled`. The handler gets
 * the frame's `kind`; it is not called for frames without one.
 */
export function useComputerSessionEvents(
  workspaceId: string | undefined,
  enabled: boolean,
  onEvent: (kind: string) => void,
) {
  const latest = useLatest(onEvent);
  useEffect(() => {
    if (!workspaceId || !enabled) return;
    let cancelled = false;
    const stream = openMultiplexedStream(
      'session',
      `computer:${workspaceId}`,
      {
        onMessage: (event) => {
          if (cancelled) return;
          try {
            const frame = JSON.parse(event.data) as { kind?: string };
            if (frame.kind) latest.current(frame.kind);
          } catch {
            /* malformed frame — ignore */
          }
        },
      },
      ['computer.'],
    );
    return () => {
      cancelled = true;
      try {
        stream.close();
      } catch {
        /* already closed */
      }
    };
  }, [workspaceId, enabled, latest]);
}

/**
 * Start the workspace's integrated browser in VISIBLE mode, so the agent's
 * later lazy `open_browser_page` reuses a session the user can watch instead
 * of starting a headless one. Never throws: a failed start is non-fatal.
 */
export function useStartVisibleBrowser() {
  return useCallback(async (workspaceId: string) => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/browser/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { enabled: true, visibility: 'visible' } }),
      });
    } catch {
      /* non-fatal — the agent still lazy-starts (headless) */
    }
  }, []);
}
