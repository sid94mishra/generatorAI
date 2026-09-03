// ────────────────────────────────────────────────────────────────
// terminal-ws — resize authority (Phase 5 item 5).
//
// No prior test exercised `terminal-ws.ts`'s WS route at all (grepped: zero
// hits for `attachTerminalWebSocket`/`terminal-ws` in any existing test).
// Real auth is mocked out here (`authorizeWebSocketUpgrade`) the same way
// route-level tests elsewhere in this suite fake a minimal `Container`
// rather than exercising real auth internals — this file's job is the
// resize-arbitration wiring, not re-proving auth, which every sibling
// `*-ws.ts` route shares unchanged.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { WebSocket } from 'ws';
import { attachTerminalWebSocket, ResizeAuthority } from '../terminal-ws.js';
import type { Container } from '../composition-root.js';

vi.mock('../middleware/wsAuth.js', () => ({
  authorizeWebSocketUpgrade: vi.fn(async () => ({ ok: true, principal: undefined })),
}));

const WORKSPACE_ID = 'ws_1';
const SESSION_ID = 'term_1';

/**
 * Records everything the route does to a session's flow control, so the P1-28
 * assertions can be made about the SESSION rather than about a socket. The
 * real `TerminalService.attachViewer` returns exactly this shape.
 */
interface ViewerSpy {
  acks: number[];
  stalls: boolean[];
  detached: boolean;
}

function fakeTerminalService() {
  const viewers: ViewerSpy[] = [];
  return {
    viewers,
    attachViewer: vi.fn(() => {
      const spy: ViewerSpy = { acks: [], stalls: [], detached: false };
      viewers.push(spy);
      return {
        ack: (bytes: number) => spy.acks.push(bytes),
        setStalled: (s: boolean) => spy.stalls.push(s),
        detach: () => { spy.detached = true; },
      };
    }),
    describe: vi.fn(() => ({
      id: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      pid: 123,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      host: 'node-pty',
      shell: '/bin/bash',
      exitCode: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    })),
    subscribeOutput: vi.fn(() => () => {}),
    subscribeExit: vi.fn(() => () => {}),
    input: vi.fn(),
    resize: vi.fn(async () => {}),
    signal: vi.fn(),
    kill: vi.fn(async () => {}),
  };
}

function fakeContainer(terminalService: ReturnType<typeof fakeTerminalService>): Container {
  return {
    terminalService,
    executionWorkspaceRepo: { findById: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    security: { audit: { record: vi.fn() } },
  } as unknown as Container;
}

async function startServer(
  terminalService: ReturnType<typeof fakeTerminalService>,
): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer();
  attachTerminalWebSocket(server, fakeContainer(terminalService));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    server,
    url: `ws://127.0.0.1:${port}/api/workspaces/${WORKSPACE_ID}/terminals/${SESSION_ID}/stream`,
  };
}

/**
 * Records every JSON control frame from the moment the socket is
 * constructed, not from whenever a test later gets around to asking for
 * one — `ws` can (and, on loopback, reliably does) deliver the server's
 * very first frame in the same synchronous pass that also fires `open`,
 * before any listener attached inside an `open` handler would exist to
 * catch it. Attaching the real listener up front, at construction, is what
 * makes `waitForFrame` correct regardless of that ordering.
 */
interface Recorder {
  ws: WebSocket;
  frames: Array<Record<string, unknown>>;
  waiters: Array<{ t: string; resolve: (frame: Record<string, unknown>) => void }>;
}

function connect(url: string): Promise<Recorder> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const recorder: Recorder = { ws, frames: [], waiters: [] };
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }
      recorder.frames.push(frame);
      const waiterIndex = recorder.waiters.findIndex((w) => w.t === frame['t']);
      if (waiterIndex !== -1) {
        const [waiter] = recorder.waiters.splice(waiterIndex, 1);
        waiter!.resolve(frame);
      }
    });
    ws.once('open', () => resolve(recorder));
    ws.once('error', reject);
  });
}

/** Resolves with a frame of type `t` — already-recorded or a future one. */
function waitForFrame(recorder: Recorder, t: string): Promise<Record<string, unknown>> {
  const existing = recorder.frames.find((f) => f['t'] === t);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    recorder.waiters.push({ t, resolve });
  });
}

function closeAndWait(recorder: Recorder): Promise<void> {
  return new Promise((resolve) => {
    recorder.ws.once('close', () => resolve());
    recorder.ws.close();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('terminal-ws resize authority (Phase 5 item 5)', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("(a) applies a single attacher's resize, unchanged from before this existed", async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const a = await connect(started.url);
    await waitForFrame(a, 'ready');
    a.ws.send(JSON.stringify({ t: 'resize', cols: 100, rows: 40 }));

    await vi.waitFor(() => expect(terminalService.resize).toHaveBeenCalledWith(SESSION_ID, 100, 40));
    expect(terminalService.resize).toHaveBeenCalledTimes(1);

    await closeAndWait(a);
  });

  it("(b) ignores a second attacher's resize while the owner is still connected, but still applies the owner's own", async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const owner = await connect(started.url);
    await waitForFrame(owner, 'ready');
    const viewer = await connect(started.url);
    await waitForFrame(viewer, 'ready');

    viewer.ws.send(JSON.stringify({ t: 'resize', cols: 999, rows: 999 }));
    await delay(50); // give the (expected to be ignored) message a chance to land
    expect(terminalService.resize).not.toHaveBeenCalled();

    owner.ws.send(JSON.stringify({ t: 'resize', cols: 120, rows: 30 }));
    await vi.waitFor(() => expect(terminalService.resize).toHaveBeenCalledWith(SESSION_ID, 120, 30));
    expect(terminalService.resize).toHaveBeenCalledTimes(1);

    await closeAndWait(owner);
    await closeAndWait(viewer);
  });

  it('(c) transfers ownership to the next-oldest attacher once the owner disconnects', async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const owner = await connect(started.url);
    await waitForFrame(owner, 'ready');
    const second = await connect(started.url);
    await waitForFrame(second, 'ready');

    await closeAndWait(owner);
    await delay(30); // let the server's own close handler (the detach) land

    second.ws.send(JSON.stringify({ t: 'resize', cols: 77, rows: 22 }));
    await vi.waitFor(() => expect(terminalService.resize).toHaveBeenCalledWith(SESSION_ID, 77, 22));
    expect(terminalService.resize).toHaveBeenCalledTimes(1);

    await closeAndWait(second);
  });

  it('(d) starts clean on a fresh attach after every prior client detached — no stale attach-order state', async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const first = await connect(started.url);
    await waitForFrame(first, 'ready');
    await closeAndWait(first);
    await delay(30);

    const fresh = await connect(started.url);
    await waitForFrame(fresh, 'ready');
    fresh.ws.send(JSON.stringify({ t: 'resize', cols: 55, rows: 15 }));

    await vi.waitFor(() => expect(terminalService.resize).toHaveBeenCalledWith(SESSION_ID, 55, 15));
    expect(terminalService.resize).toHaveBeenCalledTimes(1);

    await closeAndWait(fresh);
  });
});

describe('terminal-ws flow control (P1-28)', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('never pauses or resumes the shared PTY itself — the session owns the watermark', async () => {
    // This is the regression that matters: the route used to keep
    // `unackedBytes`/`paused` per socket and call
    // `terminalService.pause/resume(sessionId)` on the SHARED PTY, so two
    // viewers oscillated against each other. `TerminalService` no longer even
    // exposes those methods; a route that still reached for them would throw.
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const a = await connect(started.url);
    await waitForFrame(a, 'ready');
    const b = await connect(started.url);
    await waitForFrame(b, 'ready');

    a.ws.send(JSON.stringify({ t: 'ack', bytes: 4096 }));
    b.ws.send(JSON.stringify({ t: 'ack', bytes: 128 }));
    await vi.waitFor(() => {
      expect(terminalService.viewers[0]!.acks).toEqual([4096]);
      expect(terminalService.viewers[1]!.acks).toEqual([128]);
    });

    expect(terminalService).not.toHaveProperty('pause');
    expect(terminalService).not.toHaveProperty('resume');

    await closeAndWait(a);
    await closeAndWait(b);
  });

  it('gives each connection its OWN ack cursor into the shared session', async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const a = await connect(started.url);
    await waitForFrame(a, 'ready');
    const b = await connect(started.url);
    await waitForFrame(b, 'ready');

    expect(terminalService.attachViewer).toHaveBeenCalledTimes(2);
    expect(terminalService.viewers).toHaveLength(2);

    await closeAndWait(a);
    await closeAndWait(b);
  });

  it('detaches its viewer on close, releasing the backpressure it contributed', async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const a = await connect(started.url);
    await waitForFrame(a, 'ready');
    await closeAndWait(a);

    await vi.waitFor(() => expect(terminalService.viewers[0]!.detached).toBe(true));
  });

  it('rejects a malformed ack instead of corrupting the session cursor', async () => {
    const terminalService = fakeTerminalService();
    const started = await startServer(terminalService);
    server = started.server;

    const a = await connect(started.url);
    await waitForFrame(a, 'ready');

    a.ws.send(JSON.stringify({ t: 'ack', bytes: -5 }));
    a.ws.send(JSON.stringify({ t: 'ack', bytes: 'lots' }));
    // NaN survives JSON.stringify as `null`; send the raw text so the guard is
    // actually exercised rather than the `typeof` branch alone.
    a.ws.send('{"t":"ack","bytes":1e999}');
    a.ws.send(JSON.stringify({ t: 'ack', bytes: 64 }));

    await vi.waitFor(() => expect(terminalService.viewers[0]!.acks).toEqual([64]));

    await closeAndWait(a);
  });
});

describe('ResizeAuthority', () => {
  it('treats the first attacher as owner', () => {
    const ra = new ResizeAuthority();
    const a = {} as WebSocket;
    ra.attach('s1', a);
    expect(ra.isOwner('s1', a)).toBe(true);
  });

  it('a later attacher is not owner while the first remains attached', () => {
    const ra = new ResizeAuthority();
    const a = {} as WebSocket;
    const b = {} as WebSocket;
    ra.attach('s1', a);
    ra.attach('s1', b);
    expect(ra.isOwner('s1', a)).toBe(true);
    expect(ra.isOwner('s1', b)).toBe(false);
  });

  it('promotes the next-oldest attacher when the owner detaches', () => {
    const ra = new ResizeAuthority();
    const a = {} as WebSocket;
    const b = {} as WebSocket;
    ra.attach('s1', a);
    ra.attach('s1', b);
    ra.detach('s1', a);
    expect(ra.isOwner('s1', b)).toBe(true);
  });

  it('keeps sessions independent — one session has no bearing on another', () => {
    const ra = new ResizeAuthority();
    const a = {} as WebSocket;
    const b = {} as WebSocket;
    ra.attach('s1', a);
    ra.attach('s2', b);
    expect(ra.isOwner('s1', b)).toBe(false);
    expect(ra.isOwner('s2', a)).toBe(false);
  });

  it('drops empty session state once every connection detaches, so a later attach starts clean', () => {
    const ra = new ResizeAuthority();
    const a = {} as WebSocket;
    ra.attach('s1', a);
    ra.detach('s1', a);
    const b = {} as WebSocket;
    ra.attach('s1', b);
    expect(ra.isOwner('s1', b)).toBe(true);
  });

  it('detach is a safe no-op for a session/connection it never saw', () => {
    const ra = new ResizeAuthority();
    expect(() => ra.detach('unknown', {} as WebSocket)).not.toThrow();
  });

  it('a connection that never attached is never owner', () => {
    const ra = new ResizeAuthority();
    const a = {} as WebSocket;
    ra.attach('s1', a);
    expect(ra.isOwner('s1', {} as WebSocket)).toBe(false);
  });
});
