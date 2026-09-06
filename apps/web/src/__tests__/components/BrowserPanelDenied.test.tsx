// ────────────────────────────────────────────────────────────────
// A refused device must stop asking.
//
// `DEFAULT_DEVICE_SCOPES` deliberately withholds `exec:browser`, so the
// descriptor endpoint answers 403 for every freshly paired browser. The poll
// treated that like a network hiccup and retried every 2 s forever — measured
// live at 48 requests in 90 s from ONE idle chat tab. Because
// `/workspaces/:id/browser` is riskLevel 'high', each denial wrote a
// 'critical' security-audit row, so a tab left open quietly produced ~1,900
// critical rows an hour.
//
// The bug was invisible: the panel looked correct the whole time. These cases
// pin the two halves of the fix — stop retrying a verdict, and say what is
// actually wrong instead of pointing at an unrelated setting.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
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

let descriptorCalls = 0;

class QuietWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'blob';
  constructor(public url: string) {}
  close() {}
}

/** Serves `status` for the descriptor and a bland 200 for everything else. */
function stubFetch(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/browser/descriptor')) {
        descriptorCalls += 1;
        return {
          ok: false,
          status,
          json: async () => ({}),
          text: async () => JSON.stringify({ error: { code: 'INSUFFICIENT_SCOPE' } }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({}), text: async () => '{}' } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  descriptorCalls = 0;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietWebSocket;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel() {
  return <BrowserPanel embedded workspaceId="ws-1" tabId="browser-1" open visible onClose={() => {}} />;
}

describe('BrowserPanel — a denied device', () => {
  it('stops polling after a 403 instead of retrying every 2s', async () => {
    stubFetch(403);
    render(panel());
    await waitFor(() => expect(descriptorCalls).toBeGreaterThan(0));
    const afterFirst = descriptorCalls;
    // Comfortably past the old 2 s retry, so a surviving timer would show up.
    await new Promise((r) => setTimeout(r, 2600));
    expect(descriptorCalls).toBe(afterFirst);
  });

  it('stops polling after a 401 as well', async () => {
    stubFetch(401);
    render(panel());
    await waitFor(() => expect(descriptorCalls).toBeGreaterThan(0));
    const afterFirst = descriptorCalls;
    await new Promise((r) => setTimeout(r, 2600));
    expect(descriptorCalls).toBe(afterFirst);
  });

  it('keeps retrying a transient failure, which IS worth retrying', async () => {
    stubFetch(503);
    render(panel());
    await waitFor(() => expect(descriptorCalls).toBeGreaterThan(0));
    const afterFirst = descriptorCalls;
    await new Promise((r) => setTimeout(r, 2600));
    expect(descriptorCalls).toBeGreaterThan(afterFirst);
  });

  it('names the real problem rather than an unrelated setting', async () => {
    stubFetch(403);
    render(panel());
    // The old copy sent the user to "Settings → Browser & Terminal →
    // interactive browser", which cannot grant a scope.
    await waitFor(() => expect(screen.getByText(/isn’t granted to this device/i)).toBeTruthy());
    expect(screen.queryByText(/interactive browser/i)).toBeNull();
  });
});
