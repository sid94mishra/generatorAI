// ────────────────────────────────────────────────────────────────
// Unit tests for the security properties ScopedCdpProxy adds on top of the
// removed app-wide `--remote-debugging-port` switch: single-target scope,
// Origin rejection, and token-path rejection. Uses a minimal fake
// `WebContents` — everything ScopedCdpProxy imports from `electron` is a
// type-only import (erased at compile time), so this runs under plain
// Node/Vitest with no real Electron process.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { chromium } from 'playwright-core';
import type { WebContents } from 'electron';
import { ScopedCdpProxy } from './ScopedCdpProxy';

function createFakeWebContents(): WebContents {
  let attached = false;
  const debuggerObj = {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => { attached = true; }),
    detach: vi.fn(() => { attached = false; }),
    sendCommand: vi.fn(async (method: string, _params?: unknown) => {
      // Playwright's Page object seeds its URL from the frame tree, not
      // from Target.attachedToTarget's targetInfo — a real webContents.
      // debugger answers this for real; the fake needs a minimal stand-in.
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'frame-1', url: 'https://example.com/', mimeType: 'text/html', securityOrigin: 'https://example.com' }, childFrames: [] } };
      }
      return {};
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return {
    debugger: debuggerObj,
    isDestroyed: () => false,
    getTitle: () => 'Test Page',
    getURL: () => 'https://example.com/',
    focus: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as WebContents;
}

/** Send one JSON-RPC request over an open socket and await its response. */
function sendAndAwait(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
    ws.once('error', reject);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitCloseOrError(ws: WebSocket): Promise<{ code?: number }> {
  return new Promise((resolve) => {
    ws.once('unexpected-response', (_req, res) => resolve({ code: res.statusCode }));
    ws.once('error', () => resolve({}));
    ws.once('close', (code) => resolve({ code }));
  });
}

describe('ScopedCdpProxy', () => {
  let proxy: ScopedCdpProxy | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
    sockets.length = 0;
    if (proxy) { await proxy.stop(); proxy = null; }
  });

  it('exposes exactly one synthetic target to a legitimate client', async () => {
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);
    await waitOpen(ws);

    const res = await sendAndAwait(ws, 1, 'Target.getTargets');
    const targets = (res.result as { targetInfos: unknown[] }).targetInfos;
    expect(targets).toHaveLength(1);
    expect((targets[0] as { url: string }).url).toBe('https://example.com/');
  });

  it('rejects a connection carrying an Origin header (browser-page origin)', async () => {
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const ws = new WebSocket(wsUrl, { origin: 'https://evil.test' });
    sockets.push(ws);
    const outcome = await waitCloseOrError(ws);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
    // ws surfaces a rejected upgrade as either 'unexpected-response' (403) or a socket error.
    if (outcome.code !== undefined) expect(outcome.code).toBe(403);
  });

  it('rejects a connection with the wrong path token', async () => {
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const badUrl = wsUrl.replace(/\/[^/]+$/, '/00000000-0000-0000-0000-000000000000');
    const ws = new WebSocket(badUrl);
    sockets.push(ws);
    const outcome = await waitCloseOrError(ws);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
    if (outcome.code !== undefined) expect(outcome.code).toBe(401);
  });

  it('rejects a connection with a mismatched Host header', async () => {
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const url = new URL(wsUrl);
    const ws = new WebSocket(wsUrl, { headers: { Host: `evil.example:${url.port}` } });
    sockets.push(ws);
    const outcome = await waitCloseOrError(ws);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
    if (outcome.code !== undefined) expect(outcome.code).toBe(403);
  });

  it('routes Page.bringToFront to webContents.focus() rather than the CDP debugger', async () => {
    const wc = createFakeWebContents();
    proxy = new ScopedCdpProxy(wc);
    const wsUrl = await proxy.start();
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);
    await waitOpen(ws);

    const res = await sendAndAwait(ws, 2, 'Page.bringToFront');
    expect(res.result).toEqual({});
    expect(wc.focus).toHaveBeenCalled();
    expect((wc.debugger as unknown as { sendCommand: ReturnType<typeof vi.fn> }).sendCommand)
      .not.toHaveBeenCalledWith('Page.bringToFront', expect.anything(), expect.anything());
  });

  it('a real Playwright chromium.connectOverCDP() sees exactly one page', async () => {
    // This is the actual client the proxy has to satisfy in production
    // (ElectronBridgeAdapter). Playwright's connectOverCDP never calls
    // Target.attachToTarget itself — it calls Target.setAutoAttach and
    // waits for the browser to proactively emit Target.attachedToTarget,
    // and asserts targetInfo.browserContextId is set. A proxy that only
    // answers a client-driven attachToTarget (satisfying the earlier tests
    // in this file) can still fail this one — that's the whole point of
    // testing against the real client, not just the raw wire protocol.
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const browser = await chromium.connectOverCDP(wsUrl);
    try {
      const contexts = browser.contexts();
      expect(contexts).toHaveLength(1);
      // The fake debugger doesn't implement enough of the frame-tree/
      // navigation protocol for Playwright's Page to resolve a URL from —
      // that part is exercised for real in the desktop smoke test against
      // the actual webContents.debugger. What matters here is the property
      // the earlier bug broke: connectOverCDP must resolve exactly one page.
      expect(contexts[0]!.pages()).toHaveLength(1);
    } finally {
      await browser.close().catch(() => undefined);
    }
  });

  it('only one client can be attached at a time (a second connection displaces the first)', async () => {
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const ws1 = new WebSocket(wsUrl);
    sockets.push(ws1);
    await waitOpen(ws1);

    const ws2 = new WebSocket(wsUrl);
    sockets.push(ws2);
    await waitOpen(ws2);

    await new Promise((r) => setTimeout(r, 50));
    expect(ws1.readyState).toBe(WebSocket.CLOSED);
  });

  it("advertises the tab's real main-frame id as the target id", async () => {
    // Playwright maps a frame to its session by walking up to a frame whose id
    // is a target id — true in Chromium, where a page's target id IS its main
    // frame id. An invented id broke that walk: Playwright threw while
    // attaching the main frame and every agent evaluate hung.
    proxy = new ScopedCdpProxy(createFakeWebContents());
    const wsUrl = await proxy.start();
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);
    await waitOpen(ws);
    const res = await sendAndAwait(ws, 3, 'Target.getTargetInfo');
    expect((res.result as { targetInfo: { targetId: string } }).targetInfo.targetId).toBe('frame-1');
  });

  it("cycles Runtime on a client's Runtime.enable so a reconnecting client learns the page's contexts", async () => {
    const wc = createFakeWebContents();
    proxy = new ScopedCdpProxy(wc);
    const wsUrl = await proxy.start();
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);
    await waitOpen(ws);
    const send = wc.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();
    const res = await sendAndAwait(ws, 7, 'Runtime.enable');
    expect(res).toMatchObject({ id: 7, result: {} });
    expect(send.mock.calls.map((c) => c[0])).toEqual(['Runtime.disable', 'Runtime.enable']);
  });
});
