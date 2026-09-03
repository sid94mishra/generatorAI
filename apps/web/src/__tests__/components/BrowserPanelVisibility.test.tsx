// ────────────────────────────────────────────────────────────────
// P1-50 — a Browser tab that is mounted but not selected must not hold a live
// screencast socket.
//
// The RightPane mounts every tab and hides the inactive ones, so five open
// Browser tabs meant five sockets streaming JPEG frames and five decode loops
// running for one visible view. The WebSocket path had no visibility check at
// all — only the HTTP polling fallback did.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/providers/ThemeProvider.js', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', theme: 'dark', setTheme: () => {} }),
}));
vi.mock('@/platform/authTransport.js', () => ({
  buildAuthenticatedSocketUrl: vi.fn(async (url: string) => url),
}));
vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: () => ({ close: () => {} }),
}));
vi.mock('./NativeBrowserView.js', () => ({ NativeBrowserView: () => null }));

import { BrowserPanel } from '@/components/chat/BrowserPanel.js';

const opened: string[] = [];

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'blob';
  closed = false;
  constructor(public url: string) {
    opened.push(url);
    FakeWebSocket.instances.push(this);
  }
  close() { this.closed = true; }
}

const descriptor = {
  status: 'active',
  mode: 'screencast',
  ready: true,
  currentUrl: 'https://example.com',
  config: { visibility: 'visible', enabled: true },
};

beforeEach(() => {
  opened.length = 0;
  FakeWebSocket.instances.length = 0;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/browser/descriptor')) {
      return { ok: true, json: async () => descriptor } as unknown as Response;
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' } as unknown as Response;
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel(visible: boolean) {
  return (
    <BrowserPanel
      embedded
      workspaceId="ws-1"
      tabId="browser-1"
      open
      visible={visible}
      onClose={() => {}}
    />
  );
}

describe('BrowserPanel visibility gating', () => {
  it('opens a live socket when the tab is the selected one', async () => {
    render(panel(true));
    await waitFor(() => expect(opened.some((u) => u.includes('/browser/stream'))).toBe(true));
  });

  it('opens NO socket while the tab is mounted but hidden', async () => {
    render(panel(false));
    // Give the descriptor poll and the ticket mint every chance to run.
    await new Promise((r) => setTimeout(r, 250));
    expect(opened.filter((u) => u.includes('/browser/stream'))).toHaveLength(0);
  });

  it('closes the socket when the tab stops being selected', async () => {
    const view = render(panel(true));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    const ws = FakeWebSocket.instances[0]!;
    view.rerender(panel(false));
    await waitFor(() => expect(ws.closed).toBe(true));
  });

  it('reopens the socket when the tab is selected again', async () => {
    const view = render(panel(true));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    view.rerender(panel(false));
    await waitFor(() => expect(FakeWebSocket.instances[0]!.closed).toBe(true));
    view.rerender(panel(true));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
  });
});
