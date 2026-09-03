// ────────────────────────────────────────────────────────────────
// PtyHostAdapter — first-ever test coverage.
//
// Proves `PtyHostAdapter` correctly satisfies `ITerminalHost` against the
// REAL, out-of-process `apps/pty-host` build — not a mock of `PtyHostClient`.
// This is what lets `TerminalService`'s existing multi-host chain
// (`SandboxPtyHost` → `PtyHostAdapter` → `NodePtyHost` → `FallbackChildProcessHost`)
// pick the out-of-process host and have it behave exactly like any other
// `ITerminalHost` implementation the rest of the codebase already trusts.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { ILogger } from '@generatorai/shared';
import { PtyHostAdapter } from '../services/PtyHostAdapter.js';
import { PtyHostClient } from '../services/PtyHostClient.js';
import type { ITerminalHandle } from '../domain/ports/ITerminalHost.js';

const HOST_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', 'apps', 'pty-host', 'dist', 'index.js',
);

/** See the fixture's own header for why the real host cannot drive these cases. */
const CRASHABLE_HOST_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures', 'crashablePtyHostEntry.mjs',
);

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

describe('PtyHostAdapter — real out-of-process pty-host', () => {
  const adapters: PtyHostAdapter[] = [];

  afterEach(async () => {
    for (const a of adapters.splice(0)) await a.stop().catch(() => undefined);
  });

  function makeAdapter(): PtyHostAdapter {
    const adapter = new PtyHostAdapter({ logger: mockLogger(), hostEntryPath: HOST_ENTRY });
    adapters.push(adapter);
    return adapter;
  }

  it('isAvailable() is false before start() and true once the real host acknowledges readiness', async () => {
    const adapter = makeAdapter();
    expect(adapter.isAvailable()).toBe(false);
    await adapter.start();
    expect(adapter.isAvailable()).toBe(true);
  }, 15_000);

  it('spawn() creates a real PTY handle that echoes real shell output and reports a real pid', async () => {
    const adapter = makeAdapter();
    await adapter.start();

    const handle = await adapter.spawn({ workspaceId: 'ws-1', cwd: process.cwd(), cols: 80, rows: 24 });
    expect(handle.host).toBe('pty-host');

    const marker = `ADAPTER_TEST_${Math.random().toString(36).slice(2, 10)}`;
    const chunks: string[] = [];
    const unsub = handle.onData((buf) => chunks.push(buf.toString('utf8')));

    handle.write(process.platform === 'win32' ? `echo ${marker}\r` : `echo ${marker}\n`);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const check = () => {
        if (chunks.join('').includes(marker)) return resolve();
        if (Date.now() > deadline) return reject(new Error(`marker never echoed; got: ${chunks.join('')}`));
        setTimeout(check, 100);
      };
      check();
    });

    // pid is populated asynchronously via the session_ready notification —
    // by the time output has echoed, it must be a real positive pid.
    expect(handle.pid).not.toBeNull();
    expect(handle.pid!).toBeGreaterThan(0);

    unsub();
    handle.kill();
  }, 15_000);

  it('demuxes data/exit correctly across TWO concurrent handles on the same client/process', async () => {
    const adapter = makeAdapter();
    await adapter.start();

    // Deliberately NOT the default shell.
    //
    // On Windows the default is PowerShell, whose PSReadLine writes command
    // history to a file shared by every session and then offers predictive
    // suggestions from it. Session A runs `echo DEMUX_A_x`; session B types
    // `e`, and PSReadLine renders `cho DEMUX_A_x` into B's byte stream as a
    // dim-italic ghost suggestion. That looks exactly like demux crosstalk
    // and is not — the bytes are B's own process echoing a file it read.
    //
    // cmd.exe and sh have no predictive history, so the only way A's marker
    // can reach B's handle is a genuine routing bug, which is the property
    // this test exists to catch. Do not "simplify" this back to the default
    // shell: the assertion below silently becomes untrustworthy.
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const spawnOpts = { cwd: process.cwd(), cols: 80, rows: 24, shell };
    const handleA = await adapter.spawn({ workspaceId: 'ws-a', ...spawnOpts });
    const handleB = await adapter.spawn({ workspaceId: 'ws-b', ...spawnOpts });
    expect(handleA.id).not.toBe(handleB.id);

    const markerA = `DEMUX_A_${Math.random().toString(36).slice(2, 8)}`;
    const markerB = `DEMUX_B_${Math.random().toString(36).slice(2, 8)}`;
    const seenA: string[] = [];
    const seenB: string[] = [];
    handleA.onData((buf) => seenA.push(buf.toString('utf8')));
    handleB.onData((buf) => seenB.push(buf.toString('utf8')));

    const nl = process.platform === 'win32' ? '\r' : '\n';
    handleA.write(`echo ${markerA}${nl}`);
    handleB.write(`echo ${markerB}${nl}`);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const check = () => {
        if (seenA.join('').includes(markerA) && seenB.join('').includes(markerB)) return resolve();
        if (Date.now() > deadline) return reject(new Error('markers never echoed to their own handles'));
        setTimeout(check, 100);
      };
      check();
    });

    // The critical demux assertion: A's marker must NEVER show up in B's stream.
    expect(seenA.join('')).not.toContain(markerB);
    expect(seenB.join('')).not.toContain(markerA);

    handleA.kill();
    handleB.kill();
  }, 15_000);

  it('onExit fires when the real shell process exits on its own', async () => {
    const adapter = makeAdapter();
    await adapter.start();

    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', 'exit 0'] : ['-c', 'exit 0'];
    const handle = await adapter.spawn({
      workspaceId: 'ws-exit',
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      shell,
      shellArgs,
    });

    const exitInfo = await new Promise<{ code: number; signal?: string }>((resolve) => {
      handle.onExit((info) => resolve(info));
    });
    expect(exitInfo.code).toBe(0);
  }, 15_000);

  it('unsubscribing onData/onExit stops delivering further callbacks', async () => {
    const adapter = makeAdapter();
    await adapter.start();
    const handle = await adapter.spawn({ workspaceId: 'ws-unsub', cwd: process.cwd(), cols: 80, rows: 24 });

    let calls = 0;
    const unsub = handle.onData(() => { calls++; });
    unsub();

    handle.write(process.platform === 'win32' ? 'echo after-unsub\r' : 'echo after-unsub\n');
    await new Promise((r) => setTimeout(r, 1_500));

    expect(calls).toBe(0);
    handle.kill();
  }, 10_000);

  it('signal()/pause()/resume() proxy to the real session without throwing', async () => {
    const adapter = makeAdapter();
    await adapter.start();
    const handle: ITerminalHandle = await adapter.spawn({ workspaceId: 'ws-ctl', cwd: process.cwd(), cols: 80, rows: 24 });

    expect(() => handle.pause()).not.toThrow();
    expect(() => handle.resume()).not.toThrow();
    expect(() => handle.signal(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT')).not.toThrow();

    // Give the fire-and-forget IPC calls a moment before tearing down.
    await new Promise((r) => setTimeout(r, 300));
    handle.kill();
  }, 10_000);

  it('spawn() before start() lazily starts the host rather than throwing', async () => {
    const adapter = makeAdapter();
    const handle = await adapter.spawn({ workspaceId: 'ws-lazy', cwd: process.cwd(), cols: 80, rows: 24 });
    expect(handle.host).toBe('pty-host');
    expect(adapter.isAvailable()).toBe(true);
    handle.kill();
  }, 15_000);

  it('ack() reaches the real host, and scrollbackLines() returns the real VT model', async () => {
    // `PtyHostClient.ack()` had zero callers anywhere in the repo, so a command
    // printing past the host's 100 000-char watermark froze that terminal
    // permanently. `PtyHostHandle.ack()` is the gateway end of that loop.
    const adapter = makeAdapter();
    await adapter.start();
    const handle = await adapter.spawn({
      workspaceId: 'ws-ack',
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    const marker = `ACK_${Math.random().toString(36).slice(2, 8)}`;
    const seen: string[] = [];
    handle.onData((b) => seen.push(b.toString('utf8')));
    handle.write(process.platform === 'win32' ? `echo ${marker}\r` : `echo ${marker}\n`);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const check = () => {
        if (seen.join('').includes(marker)) return resolve();
        if (Date.now() > deadline) return reject(new Error('marker never echoed'));
        setTimeout(check, 100);
      };
      check();
    });

    expect(handle.ack).toBeTypeOf('function');
    expect(() => handle.ack!(seen.join('').length)).not.toThrow();

    const lines = await handle.scrollbackLines!(50);
    expect(lines.join('\n')).toContain(marker);

    handle.kill();
  }, 20_000);
});

describe('PtyHostClient — host death (W20 / P0-23 zombie sessions)', () => {
  const clients: PtyHostClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.stop().catch(() => undefined);
  });

  function makeClient(handlers: {
    onExit?: (sessionId: string, code: number | null) => void;
    onData?: (sessionId: string, chunk: string) => void;
    maxRestarts?: number;
    restartBaseDelayMs?: number;
  } = {}): PtyHostClient {
    const client = new PtyHostClient({
      logger: mockLogger(),
      hostEntryPath: CRASHABLE_HOST_ENTRY,
      // Shrink the production backoff (1 s doubling) so the restart-budget
      // test does not spend a minute asleep. The BUDGET is what is under test,
      // not the wall-clock delay between attempts.
      restartBaseDelayMs: 10,
      ...handlers,
    });
    clients.push(client);
    return client;
  }

  it('synthesises an exit for every live session when the host process dies', async () => {
    // Without this the adapter kept every handle, `TerminalService` records
    // stayed `exited: false`, the idle reaper never collected them, and the UI
    // rendered live terminals over processes that no longer existed.
    const exits: Array<[string, number | null]> = [];
    const client = makeClient({ onExit: (sid, code) => exits.push([sid, code]) });
    await client.start();

    await client.createSession({ sessionId: 'a', cols: 80, rows: 24, cwd: process.cwd() });
    await client.createSession({ sessionId: 'b', cols: 80, rows: 24, cwd: process.cwd() });

    // The host dies without acking — the client must not hang on it either.
    await client.write('a', '__CRASH__').catch(() => undefined);

    await vi.waitFor(() => expect(exits).toHaveLength(2), { timeout: 8_000 });
    expect(exits.map(([sid]) => sid).sort()).toEqual(['a', 'b']);
    // `null`, not a fabricated 0: nobody observed how the shell terminated.
    expect(exits.every(([, code]) => code === null)).toBe(true);
  }, 20_000);

  it('does not synthesise an exit for a session that was already destroyed', async () => {
    const exits: string[] = [];
    const client = makeClient({ onExit: (sid) => exits.push(sid) });
    await client.start();

    await client.createSession({ sessionId: 'gone', cols: 80, rows: 24, cwd: process.cwd() });
    await client.createSession({ sessionId: 'live', cols: 80, rows: 24, cwd: process.cwd() });
    await client.destroy('gone');

    await client.write('live', '__CRASH__').catch(() => undefined);

    await vi.waitFor(() => expect(exits).toHaveLength(1), { timeout: 8_000 });
    expect(exits).toEqual(['live']);
  }, 20_000);

  it('ack() reaches the host over IPC', async () => {
    const data: string[] = [];
    const client = makeClient({ onData: (_sid, chunk) => data.push(chunk) });
    await client.start();
    await client.createSession({ sessionId: 's', cols: 80, rows: 24, cwd: process.cwd() });

    await client.ack('s', 4_096);
    expect(data).toContain('CREDIT:4096');
  }, 15_000);

  it('goes fatal after the restart budget so callers can fall back instead of throwing forever', async () => {
    // `stopped = true` was set but never exposed, so `PtyHostAdapter.isAvailable()`
    // kept returning true over a host that was never coming back and every
    // subsequent spawn threw rather than falling through to `NodePtyHost`.
    const client = makeClient({ maxRestarts: 2 });
    await client.start();
    expect(client.isFatal()).toBe(false);

    // The (maxRestarts + 1)-th crash inside the window trips the latch.
    for (let i = 0; i < 6 && !client.isFatal(); i++) {
      await client.createSession({ sessionId: `s${i}`, cols: 80, rows: 24, cwd: process.cwd() }).catch(() => undefined);
      await client.write(`s${i}`, '__CRASH__').catch(() => undefined);
      // Wait for the respawn before crashing again.
      await vi.waitFor(async () => {
        await client.createSession({ sessionId: `probe${i}`, cols: 80, rows: 24, cwd: process.cwd() });
      }, { timeout: 10_000, interval: 50 }).catch(() => undefined);
    }

    expect(client.isFatal()).toBe(true);
  }, 40_000);
});

describe('PtyHostAdapter — availability', () => {
  it('reports unavailable once the client has gone fatal, so TerminalService falls through', async () => {
    const adapter = new PtyHostAdapter({ logger: mockLogger(), hostEntryPath: CRASHABLE_HOST_ENTRY });
    try {
      await adapter.start();
      expect(adapter.isAvailable()).toBe(true);

      // Reach into the client the adapter owns and latch it fatal the same way
      // an exhausted restart budget does. Asserting through the public
      // `isAvailable()` is the point: that is what host selection reads.
      const client = (adapter as unknown as { client: { isFatal(): boolean } }).client;
      vi.spyOn(client, 'isFatal').mockReturnValue(true);

      expect(adapter.isAvailable()).toBe(false);
    } finally {
      await adapter.stop().catch(() => undefined);
    }
  }, 20_000);

  it('a failed start is retried rather than cached forever', async () => {
    // The rejected promise used to be stored permanently, so one unlucky boot
    // disabled the out-of-process host for the life of the process.
    const missing = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'does-not-exist.mjs');
    const adapter = new PtyHostAdapter({ logger: mockLogger(), hostEntryPath: missing });
    try {
      await expect(adapter.start()).rejects.toThrow();
      const first = (adapter as unknown as { startPromise: Promise<void> | null }).startPromise;
      expect(first).toBeNull();

      // Second call actually attempts again (and fails again, for the same
      // reason) rather than re-awaiting the cached rejection.
      await expect(adapter.start()).rejects.toThrow();
    } finally {
      await adapter.stop().catch(() => undefined);
    }
  }, 30_000);

  it('whenReady() resolves rather than rejecting when the start failed', async () => {
    const missing = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'does-not-exist.mjs');
    const adapter = new PtyHostAdapter({ logger: mockLogger(), hostEntryPath: missing });
    try {
      const started = adapter.start().catch(() => undefined);
      await expect(adapter.whenReady()).resolves.toBeUndefined();
      await started;
      expect(adapter.isAvailable()).toBe(false);
    } finally {
      await adapter.stop().catch(() => undefined);
    }
  }, 30_000);
});
