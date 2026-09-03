// ────────────────────────────────────────────────────────────────
// PtyHostServer — first-ever test coverage.
//
// Spawns the REAL built `apps/pty-host` process (child_process.fork) and
// drives it over its real IPC protocol — not a mock. This is the same
// process shape `PtyHostClient` uses in production, so a regression in
// the wire protocol (message framing, request/response correlation,
// session lifecycle) fails here, not just against a mocked transport.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PtyHostRequest, PtyHostResponse } from '@generatorai/shared';
import { isPtyHostResponse } from '@generatorai/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_ENTRY = join(__dirname, '..', '..', 'dist', 'index.js');

/** Minimal hand-rolled client — deliberately independent of `PtyHostClient` (packages/core) so this test exercises the wire protocol on its own, not that client's own logic. */
class RawPtyHostTestClient {
  private child: ChildProcess;
  private pending = new Map<string, { resolve: (r: PtyHostResponse) => void; reject: (e: Error) => void }>();
  onData: ((sessionId: string, chunk: string) => void) | null = null;
  onExit: ((sessionId: string, code: number | null) => void) | null = null;

  constructor() {
    // `--import tsx`: plain `node dist/index.js` cannot resolve
    // `@generatorai/shared`'s workspace "exports" (`.js`-extension imports
    // pointing at `.ts` source — see PtyHostClient.ts's `spawn()` for the
    // full explanation). Hooking tsx here mirrors what `PtyHostClient`
    // itself now does in production.
    this.child = fork(HOST_ENTRY, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], execArgv: ['--import', 'tsx'] });
    this.child.on('message', (raw: unknown) => {
      if (!isPtyHostResponse(raw)) return;
      if (raw.type === 'data') { this.onData?.(raw.sessionId, raw.chunk); return; }
      if (raw.type === 'exit') { this.onExit?.(raw.sessionId, raw.code); return; }
      const reqId = (raw as { reqId?: string }).reqId;
      if (reqId && this.pending.has(reqId)) {
        this.pending.get(reqId)!.resolve(raw);
        this.pending.delete(reqId);
      }
    });
  }

  async waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const handler = (raw: unknown) => {
        if (isPtyHostResponse(raw) && raw.type === 'pong' && raw.reqId === '__ready__') {
          this.child.off('message', handler);
          resolve();
        }
      };
      this.child.on('message', handler);
    });
  }

  // Plain `Record<...>`, not `Omit<PtyHostRequest, 'reqId'>` — `Omit` does not
  // distribute over a union, so it would collapse every discriminated variant
  // down to only the fields common to all of them (losing `sessionId`/`data`/
  // etc.). Same shape `PtyHostClient.send()`'s own private helper uses.
  send(req: Record<string, unknown> & { type: string; reqId?: string }): Promise<PtyHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const full = { ...req, reqId } as PtyHostRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out')), 5_000);
      this.pending.set(reqId, {
        resolve: (r) => { clearTimeout(timeout); resolve(r); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });
      this.child.send(full);
    });
  }

  kill(): void {
    this.child.kill('SIGTERM');
  }
}

describe('apps/pty-host — real process, real IPC', () => {
  const clients: RawPtyHostTestClient[] = [];

  afterEach(() => {
    for (const c of clients.splice(0)) c.kill();
  });

  function makeClient(): RawPtyHostTestClient {
    const c = new RawPtyHostTestClient();
    clients.push(c);
    return c;
  }

  it('responds to ping', async () => {
    const client = makeClient();
    await client.waitForReady();
    const resp = await client.send({ type: 'ping' });
    expect(resp.type).toBe('pong');
  }, 10_000);

  it('creates a real PTY session, echoes real shell output, and destroys it cleanly', async () => {
    const client = makeClient();
    await client.waitForReady();

    const sessionId = randomUUID();
    const chunks: string[] = [];
    client.onData = (id, chunk) => { if (id === sessionId) chunks.push(chunk); };

    const readyPromise = new Promise<number>((resolve) => {
      const handler = (raw: unknown) => {
        if (isPtyHostResponse(raw) && raw.type === 'session_ready' && raw.sessionId === sessionId) {
          resolve(raw.pid);
        }
      };
      (client as unknown as { child: ChildProcess }).child.on('message', handler);
    });

    const createResp = await client.send({
      type: 'create_session',
      sessionId,
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
    });
    expect(createResp).toMatchObject({ type: 'ack', ok: true });

    const pid = await readyPromise;
    expect(pid).toBeGreaterThan(0);

    const marker = `PTY_HOST_TEST_${randomUUID().slice(0, 8)}`;
    const shellCmd = process.platform === 'win32' ? `echo ${marker}\r` : `echo ${marker}\n`;
    const writeResp = await client.send({ type: 'write', sessionId, data: shellCmd });
    expect(writeResp).toMatchObject({ type: 'ack', ok: true });

    // Real shell, real output — wait for it to actually appear.
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const check = () => {
        if (chunks.join('').includes(marker)) return resolve();
        if (Date.now() > deadline) return reject(new Error(`marker never echoed; got: ${chunks.join('')}`));
        setTimeout(check, 100);
      };
      check();
    });

    const resizeResp = await client.send({ type: 'resize', sessionId, cols: 100, rows: 30 });
    expect(resizeResp).toMatchObject({ type: 'ack', ok: true });

    const destroyResp = await client.send({ type: 'destroy', sessionId });
    expect(destroyResp).toMatchObject({ type: 'ack', ok: true });
  }, 15_000);

  it('signal/pause/resume round-trip without error against a real session', async () => {
    const client = makeClient();
    await client.waitForReady();
    const sessionId = randomUUID();
    await client.send({ type: 'create_session', sessionId, cols: 80, rows: 24, cwd: process.cwd() });

    await expect(client.send({ type: 'pause', sessionId })).resolves.toMatchObject({ type: 'ack', ok: true });
    await expect(client.send({ type: 'resume', sessionId })).resolves.toMatchObject({ type: 'ack', ok: true });
    await expect(
      client.send({ type: 'signal', sessionId, signal: process.platform === 'win32' ? 'SIGTERM' : 'SIGINT' }),
    ).resolves.toMatchObject({ type: 'ack', ok: true });

    await client.send({ type: 'destroy', sessionId });
  }, 10_000);

  it('errors on an operation against an unknown sessionId', async () => {
    const client = makeClient();
    await client.waitForReady();
    const resp = await client.send({ type: 'write', sessionId: 'does-not-exist', data: 'x' });
    expect(resp).toMatchObject({ type: 'error', ok: false });
  }, 10_000);

  it('rejects creating a session with a sessionId that already exists', async () => {
    const client = makeClient();
    await client.waitForReady();
    const sessionId = randomUUID();
    await client.send({ type: 'create_session', sessionId, cols: 80, rows: 24, cwd: process.cwd() });
    const dup = await client.send({ type: 'create_session', sessionId, cols: 80, rows: 24, cwd: process.cwd() });
    expect(dup).toMatchObject({ type: 'error', ok: false });
    await client.send({ type: 'destroy', sessionId });
  }, 10_000);

  it('serves rendered scrollback from the headless VT model over IPC', async () => {
    // W14: `xterm-headless` was declared as an optionalDependency and imported
    // NOWHERE, while `PtySession` kept a `string[]` of raw fragments no code
    // path ever read — no replay, no getter, no request type. This is the
    // end-to-end proof that the model exists, is fed, and is reachable.
    const client = makeClient();
    await client.waitForReady();
    const sessionId = randomUUID();
    await client.send({ type: 'create_session', sessionId, cols: 80, rows: 24, cwd: process.cwd() });

    const marker = `VT_${randomUUID().slice(0, 8)}`;
    const chunks: string[] = [];
    client.onData = (id, chunk) => { if (id === sessionId) chunks.push(chunk); };
    await client.send({
      type: 'write',
      sessionId,
      data: process.platform === 'win32' ? `echo ${marker}\r` : `echo ${marker}\n`,
    });

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const check = () => {
        if (chunks.join('').includes(marker)) return resolve();
        if (Date.now() > deadline) return reject(new Error('marker never echoed'));
        setTimeout(check, 100);
      };
      check();
    });

    const resp = await client.send({ type: 'scrollback', sessionId, tailLines: 50 });
    expect(resp.type).toBe('scrollback');
    const sb = resp as { type: 'scrollback'; lines: string[]; vt: boolean };
    // The VT model is a PARSED grid, so the marker appears as text rather than
    // wrapped in the escape sequences the raw byte stream carries.
    expect(sb.lines.join('\n')).toContain(marker);
    expect(sb.lines.length).toBeLessThanOrEqual(50);

    await client.send({ type: 'destroy', sessionId });
  }, 15_000);

  it('errors on a scrollback request for an unknown session rather than returning an empty one', async () => {
    const client = makeClient();
    await client.waitForReady();
    const resp = await client.send({ type: 'scrollback', sessionId: 'nope' });
    expect(resp).toMatchObject({ type: 'error', ok: false });
  }, 10_000);

  it('emits an exit notification when the underlying shell exits on its own', async () => {
    const client = makeClient();
    await client.waitForReady();
    const sessionId = randomUUID();

    const exitPromise = new Promise<number | null>((resolve) => {
      client.onExit = (id, code) => { if (id === sessionId) resolve(code); };
    });

    // A shell invoked with an explicit "exit" command terminates on its own —
    // proves the REAL PTY exit path, not just a client-initiated destroy().
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', 'exit 0'] : ['-c', 'exit 0'];
    await client.send({
      type: 'create_session',
      sessionId,
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      shell,
      shellArgs,
    });

    await expect(exitPromise).resolves.not.toBeUndefined();
  }, 10_000);
});
