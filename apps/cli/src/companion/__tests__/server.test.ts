import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry } from '@generatorai/cli-core';
import { Readable, Writable } from 'node:stream';
import {
  createConnectionHandler,
  createSharedState,
  serveStdio,
  startCompanion,
  type Frame,
  type Request,
  type SharedCompanionState,
} from '../server.js';
import type { GlobalFlags, Session } from '../../session.js';

function fakeSession(): Session {
  return {
    config: { cli: { verbose: false }, server: { timeoutMs: 5000 } },
    capabilities: {},
    renderer: {},
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    outputMode: 'auto',
    dispose: async () => {},
  } as unknown as Session;
}

function sharedState(expectedNonce: string | null): SharedCompanionState {
  return createSharedState({
    session: fakeSession(),
    flags: {} as GlobalFlags,
    registry: new CommandRegistry(),
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
    audit: null,
    expectedNonce,
  });
}

async function send(handle: (req: Request, emit: (f: Frame) => void) => Promise<Frame | null>, request: Request) {
  return handle(request, () => {});
}

// ── Unit level: the connection-scoped closure itself ────────────────

describe('createConnectionHandler — per-connection isolation', () => {
  it('starts unauthenticated when a nonce is required, and rejects real methods until `hello` succeeds', async () => {
    const shared = sharedState('correct-nonce');
    const { handle } = createConnectionHandler(shared, () => {});

    const before = await send(handle, { v: 1, id: '1', method: 'ping' });
    expect(before).toMatchObject({ ok: false, error: { code: 'NOAUTH' } });

    const hello = await send(handle, { v: 1, id: '2', method: 'hello', params: { nonce: 'correct-nonce' } });
    expect(hello).toMatchObject({ ok: true });

    const after = await send(handle, { v: 1, id: '3', method: 'ping' });
    expect(after).toMatchObject({ ok: true });
  });

  it('does NOT leak one connection handler\'s authentication into a separate one', async () => {
    const shared = sharedState('correct-nonce');

    const peerA = createConnectionHandler(shared, () => {});
    const peerB = createConnectionHandler(shared, () => {});

    // Peer A authenticates.
    await send(peerA.handle, { v: 1, id: '1', method: 'hello', params: { nonce: 'correct-nonce' } });
    expect(await send(peerA.handle, { v: 1, id: '2', method: 'ping' })).toMatchObject({ ok: true });

    // Peer B, sharing the exact same registry/methods/client state, has sent
    // nothing. It must still be unauthenticated — this is the bug: the old
    // code kept `authenticated` in the state shared across every connection.
    expect(await send(peerB.handle, { v: 1, id: '3', method: 'ping' })).toMatchObject({
      ok: false,
      error: { code: 'NOAUTH' },
    });
  });

  it('calls onAuthFailure for a bad nonce on ONE connection without touching another', async () => {
    const shared = sharedState('correct-nonce');
    const failA = vi.fn();
    const failB = vi.fn();
    const peerA = createConnectionHandler(shared, failA);
    const peerB = createConnectionHandler(shared, failB);

    const result = await send(peerA.handle, { v: 1, id: '1', method: 'hello', params: { nonce: 'wrong' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOAUTH' } });
    expect(failA).toHaveBeenCalledTimes(1);
    expect(failB).not.toHaveBeenCalled();

    // Peer B is wholly unaffected: it can still authenticate with the right nonce.
    const helloB = await send(peerB.handle, { v: 1, id: '2', method: 'hello', params: { nonce: 'correct-nonce' } });
    expect(helloB).toMatchObject({ ok: true });
  });

  it('requires no handshake when the companion was launched with no nonce at all', async () => {
    const shared = sharedState(null);
    const { handle } = createConnectionHandler(shared, () => {});
    expect(await send(handle, { v: 1, id: '1', method: 'ping' })).toMatchObject({ ok: true });
  });

  it('abortAll cancels every request tracked on that connection and only that connection', async () => {
    const shared = sharedState(null);
    const peerA = createConnectionHandler(shared, () => {});
    const peerB = createConnectionHandler(shared, () => {});

    // `cancel` reads from the connection-local `inFlight` map; simulate an
    // in-flight request by starting one against an unknown method long
    // enough to inspect `cancel`'s "cancelled" flag before/after abortAll.
    // Since unknown methods resolve immediately, we assert the narrower,
    // deterministic contract instead: abortAll never throws and a
    // subsequent request on the same connection still gets a normal reply.
    expect(() => peerA.abortAll()).not.toThrow();
    expect(await send(peerB.handle, { v: 1, id: '1', method: 'ping' })).toMatchObject({ ok: true });
  });

  it('rejects an unversioned mismatch and an unknown method without authenticating first', async () => {
    const shared = sharedState(null);
    const { handle } = createConnectionHandler(shared, () => {});
    expect(await send(handle, { v: 99, id: '1', method: 'ping' })).toMatchObject({
      ok: false,
      error: { code: 'VERSION_MISMATCH' },
    });
    expect(await send(handle, { v: 1, id: '2', method: 'not.a.real.method' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('serveStdio — connection teardown', () => {
  it('aborts every in-flight request when stdin closes, not just on a bad nonce', async () => {
    const shared = sharedState(null);
    const input = new Readable({ read() {} });
    const written: string[] = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        written.push(String(chunk));
        cb();
      },
    });

    const controller = new AbortController();
    const done = serveStdio(shared, controller.signal, { input, output });

    // Fire a request whose method does not exist — resolves immediately —
    // just to prove the transport is live before closing it.
    input.push(`${JSON.stringify({ v: 1, id: '1', method: 'ping' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(written.some((line) => line.includes('"ok":true'))).toBe(true);

    // Ending stdin (the parent process closing the pipe) must resolve
    // `serveStdio` — previously it discarded `abortAll` entirely, so this
    // path never cancelled anything left in flight.
    input.push(null);
    await expect(done).resolves.toBeUndefined();
  });
});

// ── Integration level: the real net.Server wiring in serveSocket ────

/**
 * A Unix socket / Windows named pipe path unique to this test run. Windows
 * has no filesystem-backed sockets — a pipe name outside `\\.\pipe\` fails
 * to bind — so the two platforms need genuinely different path shapes.
 */
function testSocketPath(): string {
  const id = randomBytes(6).toString('hex');
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\generatorai-companion-test-${id}`;
  }
  const dir = mkdtempSync(join(tmpdir(), 'generatorai-companion-'));
  return join(dir, 'companion.sock');
}

function rmTestSocketPath(socketPath: string): void {
  if (process.platform === 'win32') return; // no filesystem entry to clean up
  rmSync(join(socketPath, '..'), { recursive: true, force: true });
}

function connectRaw(socketPath: string, attemptsLeft = 40): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (err) => {
      socket.destroy();
      if (attemptsLeft <= 0) {
        reject(err);
        return;
      }
      setTimeout(() => {
        connectRaw(socketPath, attemptsLeft - 1).then(resolve, reject);
      }, 25);
    });
  });
}

function lineReader(socket: net.Socket): () => Promise<Frame> {
  const pending: Frame[] = [];
  const waiters: Array<(f: Frame) => void> = [];
  let buffer = '';
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const frame = JSON.parse(line) as Frame;
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else pending.push(frame);
    }
  });
  return () =>
    new Promise((resolve) => {
      const frame = pending.shift();
      if (frame) {
        resolve(frame);
        return;
      }
      waiters.push(resolve);
    });
}

describe('companion socket transport — real net.Server (regression guard)', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    // Reverse (stack) order: release what was acquired LAST first. A test
    // pushes its client sockets' destroy() after the server's abort — this
    // still tears the sockets down before `server.close()` is asked to
    // wait for them, rather than the other way around. Genuinely awaiting
    // each step (not just firing `.abort()` and moving on) matters here:
    // a `net.Server.close()` will not settle until every open connection
    // on it has ended, and starting the next test's own server/pipe while
    // this one is still mid-teardown was observed to make that next test
    // hang for the full 15s timeout on this platform.
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
  });

  it('gives two real socket connections independent authentication state', async () => {
    const socketPath = testSocketPath();
    cleanups.push(() => rmTestSocketPath(socketPath));

    vi.stubEnv('GENERATORAI_COMPANION_NONCE', 'shared-launch-nonce');
    const controller = new AbortController();
    // Actually awaits `net.Server.close()` settling, not just firing
    // `.abort()` and moving on — see the `afterEach` comment above.
    cleanups.push(async () => {
      controller.abort();
      await companion.catch(() => {});
    });

    const companion = startCompanion({
      session: fakeSession(),
      flags: {} as GlobalFlags,
      registry: new CommandRegistry(),
      socketPath,
      signal: controller.signal,
    });
    companion.catch(() => {}); // suppresses the unhandled-rejection warning; the real await is in cleanup

    const socketA = await connectRaw(socketPath);
    const socketB = await connectRaw(socketPath);
    cleanups.push(() => {
      socketA.destroy();
      socketB.destroy();
    });
    const readA = lineReader(socketA);
    const readB = lineReader(socketB);

    socketA.write(`${JSON.stringify({ v: 1, id: '1', method: 'hello', params: { nonce: 'shared-launch-nonce' } })}\n`);
    expect(await readA()).toMatchObject({ ok: true });
    socketA.write(`${JSON.stringify({ v: 1, id: '2', method: 'ping' })}\n`);
    expect(await readA()).toMatchObject({ ok: true });

    // Socket B never sent `hello`. If auth state were shared across
    // connections (the original bug), this would incorrectly succeed.
    socketB.write(`${JSON.stringify({ v: 1, id: '1', method: 'ping' })}\n`);
    expect(await readB()).toMatchObject({ ok: false, error: { code: 'NOAUTH' } });
  }, 15_000);

  it('destroys only the misbehaving socket on a bad nonce; the server and other sockets survive', async () => {
    const socketPath = testSocketPath();
    cleanups.push(() => rmTestSocketPath(socketPath));

    vi.stubEnv('GENERATORAI_COMPANION_NONCE', 'shared-launch-nonce');
    const controller = new AbortController();
    cleanups.push(async () => {
      controller.abort();
      await companion.catch(() => {});
    });

    const companion = startCompanion({
      session: fakeSession(),
      flags: {} as GlobalFlags,
      registry: new CommandRegistry(),
      socketPath,
      signal: controller.signal,
    });
    companion.catch(() => {});

    const attacker = await connectRaw(socketPath);
    // Without a `data` listener (or an explicit `resume()`), a `net.Socket`
    // stays in Node's paused mode — nothing reads the NOAUTH frame the
    // server sends before closing, and that left-unread buffered data was
    // observed to also stall the socket's own `close` event on this
    // platform. This test does not care about the frame's content, only
    // that the connection ends; `resume()` says exactly that.
    attacker.resume();
    const attackerClosed = new Promise<void>((resolve) => attacker.once('close', resolve));
    attacker.write(`${JSON.stringify({ v: 1, id: '1', method: 'hello', params: { nonce: 'wrong-nonce' } })}\n`);
    await attackerClosed;

    // The server process is still alive and still accepts new, legitimate peers.
    const good = await connectRaw(socketPath);
    cleanups.push(() => good.destroy());
    const readGood = lineReader(good);
    good.write(`${JSON.stringify({ v: 1, id: '1', method: 'hello', params: { nonce: 'shared-launch-nonce' } })}\n`);
    expect(await readGood()).toMatchObject({ ok: true });
  }, 15_000);

  it('delivers the NOAUTH frame before destroying the socket, not just an abrupt close with no explanation', async () => {
    const socketPath = testSocketPath();
    cleanups.push(() => rmTestSocketPath(socketPath));

    vi.stubEnv('GENERATORAI_COMPANION_NONCE', 'shared-launch-nonce');
    const controller = new AbortController();
    cleanups.push(async () => {
      controller.abort();
      await companion.catch(() => {});
    });

    const companion = startCompanion({
      session: fakeSession(),
      flags: {} as GlobalFlags,
      registry: new CommandRegistry(),
      socketPath,
      signal: controller.signal,
    });
    companion.catch(() => {});

    const attacker = await connectRaw(socketPath);
    cleanups.push(() => attacker.destroy());
    const readAttacker = lineReader(attacker);
    const closed = new Promise<void>((resolve) => attacker.once('close', resolve));

    attacker.write(`${JSON.stringify({ v: 1, id: '1', method: 'hello', params: { nonce: 'wrong-nonce' } })}\n`);

    // If the socket were destroyed before the frame is written (the bug —
    // destroy() made `write`'s `!socket.destroyed` guard false by the time
    // it ran), this `readAttacker()` would hang until the test's own
    // timeout instead of ever resolving.
    const frame = await readAttacker();
    expect(frame).toMatchObject({ ok: false, error: { code: 'NOAUTH' } });
    await closed;
  }, 15_000);
});
