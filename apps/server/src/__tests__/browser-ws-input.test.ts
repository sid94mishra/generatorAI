// ────────────────────────────────────────────────────────────────
// browser-ws — input backpressure (P1-32, second half).
//
// `interact()` is one CDP round trip and a trackpad emits pointer moves at up
// to ~500 Hz. The FIFO promise chain that keeps a click ordered ahead of a
// keystroke had no bound of its own, so at that rate it grew faster than it
// drained — unbounded memory, and input landing on the page seconds after the
// user made it.
//
// These drive the REAL socket handler over a real `ws` connection, with
// `interact` held open on purpose so the queue is observable while it is full.
// Auth is mocked the same way `terminal-ws.test.ts` mocks it: the subject here
// is the queue, not the upgrade.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { WebSocket } from 'ws';
import { attachBrowserWebSocket } from '../browser-ws.js';
import type { Container } from '../composition-root.js';
import type { BrowserInputEvent } from '@generatorai/core';

vi.mock('../middleware/wsAuth.js', () => ({
  authorizeWebSocketUpgrade: vi.fn(async () => ({ ok: true, principal: undefined })),
}));

const WORKSPACE_ID = 'ws_1';

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function fakeBrowserService() {
  const seen: BrowserInputEvent[] = [];
  /** Set to hold every `interact()` open until released. */
  let gate: Deferred | null = null;

  return {
    seen,
    holdInteract(): Deferred {
      gate = deferred();
      return gate;
    },
    releaseInteract(): void {
      gate?.release();
      gate = null;
    },
    bumpActivity: vi.fn(),
    // P1-33 — the handler asks before it streams. A fake that cannot answer
    // makes the socket close immediately, which is exactly what the endpoint
    // should do for a bridge that declares nothing.
    screencastCapabilities: vi.fn(() => ({ supportsScreencast: true, codecs: ['jpeg'] as const })),
    interact: vi.fn(async (_ws: string, event: BrowserInputEvent) => {
      seen.push(event);
      if (gate) await gate.promise;
    }),
    // Never yields: the stream sits on its seed frame, which keeps the socket
    // open without producing traffic that would race the assertions.
    screencast: vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
    })),
    frame: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
  };
}

function fakeContainer(browserService: ReturnType<typeof fakeBrowserService>): Container {
  return {
    browserService,
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    security: { audit: { record: vi.fn() } },
  } as unknown as Container;
}

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(() => r(undefined)));
});

async function connect(browserService: ReturnType<typeof fakeBrowserService>): Promise<WebSocket> {
  const server = http.createServer();
  servers.push(server);
  attachBrowserWebSocket(server, fakeContainer(browserService));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/workspaces/${WORKSPACE_ID}/browser/stream`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

/** Lets the server's message handler and the drain loop run. */
const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('browser-ws input queue', () => {
  it('bounds the queue instead of growing it once per message', async () => {
    const service = fakeBrowserService();
    const ws = await connect(service);
    const gate = service.holdInteract();

    // 400 discrete events, all at once, while the first is still in flight.
    // Unbounded, this becomes 400 queued promises and 400 CDP round trips
    // delivered long after the user stopped typing.
    for (let i = 0; i < 400; i += 1) {
      ws.send(JSON.stringify({ type: 'key.press', key: 'a' }));
    }
    await settle();
    gate.release();
    service.releaseInteract();
    await settle(300);

    expect(service.interact.mock.calls.length).toBeGreaterThan(0);
    // The exact ceiling is the depth bound plus the one in flight plus what the
    // token bucket let through before the queue filled; the assertion that
    // matters is that it is a small constant and not "all of them".
    expect(service.interact.mock.calls.length).toBeLessThan(100);
  });

  it('coalesces pointer moves to the latest position rather than replaying them', async () => {
    const service = fakeBrowserService();
    const ws = await connect(service);
    const gate = service.holdInteract();

    for (let i = 0; i < 200; i += 1) {
      ws.send(JSON.stringify({ type: 'mouse.move', x: i, y: i }));
    }
    await settle();
    gate.release();
    service.releaseInteract();
    await settle(300);

    const moves = service.seen.filter((e) => e.type === 'mouse.move');
    // Position is state, not an event: replaying 200 stale positions is
    // strictly worse than jumping straight to the current one.
    expect(moves.length).toBeLessThanOrEqual(3);
    // …and the position the page ends up at must be the newest one sent.
    const last = moves[moves.length - 1] as { x: number };
    expect(last.x).toBe(199);
  });

  it('still delivers a click before the keystroke behind it', async () => {
    // The ordering guarantee the original chain existed for. A bounded queue
    // that reordered would put the keystroke on whatever had focus BEFORE the
    // click — the exact bug the chain was added to fix.
    const service = fakeBrowserService();
    const ws = await connect(service);

    ws.send(JSON.stringify({ type: 'mouse.click', x: 5, y: 6 }));
    ws.send(JSON.stringify({ type: 'key.type', text: 'hello' }));
    await settle(200);

    expect(service.seen.map((e) => e.type)).toEqual(['mouse.click', 'key.type']);
  });

  it('ignores malformed messages without tearing the socket down', async () => {
    const service = fakeBrowserService();
    const ws = await connect(service);

    ws.send('not json');
    ws.send(JSON.stringify({ nope: true }));
    ws.send(JSON.stringify({ type: 'key.press', key: 'z' }));
    await settle(200);

    expect(service.seen.map((e) => e.type)).toEqual(['key.press']);
    expect(ws.readyState).toBe(ws.OPEN);
  });
});
