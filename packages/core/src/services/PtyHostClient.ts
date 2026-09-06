/**
 * W14 — PtyHostClient: gateway-side client that proxies to the pty-host process.
 *
 * Drop-in replacement for in-process node-pty usage. All PTY file descriptors
 * stay in the child process; the gateway only holds typed IPC messages.
 *
 * L5: Native handles (PTY FDs) never live in the control-plane process.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  PtyHostRequest,
  PtyHostResponse,
  PtyDataNotification,
  PtyExitNotification,
  PtyScrollbackResponse,
  PtySessionReadyNotification,
} from '@generatorai/shared';
import { HOST_PROTOCOL_VERSIONS, assertHostHello, isPtyHostResponse } from '@generatorai/shared';
import { readBuildStamp } from '@generatorai/shared/node';
import type { ILogger } from '@generatorai/shared';

/** Plan item 43 — the protocol this gateway build speaks to pty-host. */
const EXPECTED_PROTOCOL_VERSION = HOST_PROTOCOL_VERSIONS['pty-host'];

/* W14 — restart cap defaults */
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
/** First backoff step; doubles per restart, capped at `RESTART_MAX_DELAY_MS`. */
const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;

export type PtyDataHandler = (sessionId: string, chunk: string) => void;
export type PtyExitHandler = (sessionId: string, code: number | null) => void;
export type PtyReadyHandler = (sessionId: string, pid: number) => void;

export interface PtyHostClientOptions {
  hostEntryPath?: string;
  env?: Record<string, string>;
  logger: ILogger;
  onData?: PtyDataHandler;
  onExit?: PtyExitHandler;
  onReady?: PtyReadyHandler;
  /** Crashes tolerated inside `RESTART_WINDOW_MS` before going fatal. Default 5. */
  maxRestarts?: number;
  /** First restart backoff step, doubling per restart. Default 1 000 ms. */
  restartBaseDelayMs?: number;
}

export class PtyHostClient {
  /* W14 */
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<string, { resolve: (r: PtyHostResponse) => void; reject: (e: Error) => void }>();
  private readonly restartTimestamps: number[] = [];
  /**
   * Sessions the host is believed to be running. Needed because a host crash
   * kills every PTY it owned, and nothing else in the system can observe that:
   * the child's own `exit` notifications die with it, so without this set the
   * gateway keeps handles, `TerminalService` records stay `exited: false`, and
   * the UI renders live terminals over processes that no longer exist.
   */
  private readonly liveSessions = new Set<string>();
  private stopped = false;
  /**
   * Set when the restart budget is exhausted. Distinct from `stopped`, which
   * means "deliberately shut down": callers need to tell "the host is gone and
   * is never coming back" from "we turned it off", because the first must make
   * `PtyHostAdapter.isAvailable()` go false so spawns fall through to the
   * in-process host instead of throwing forever.
   */
  private fatal = false;
  /**
   * Plan item 43 — the `hello` the CURRENT child sent, judged when its ready
   * pong arrives. Reset per spawn so a restarted host is checked on its own.
   */
  private helloFrame: unknown = undefined;
  /** This gateway build's own stamp, compared (advisory) against the host's. */
  private readonly buildStamp = readBuildStamp(import.meta.url);
  private readonly logger: ILogger;
  private readonly hostEntryPath: string;
  private readonly hostEnv: Record<string, string>;
  private readonly onData?: PtyDataHandler;
  private readonly onExit?: PtyExitHandler;
  private readonly onReady?: PtyReadyHandler;
  private readonly maxRestarts: number;
  private readonly restartBaseDelayMs: number;

  constructor(opts: PtyHostClientOptions) {
    this.maxRestarts = Math.max(0, opts.maxRestarts ?? MAX_RESTARTS);
    this.restartBaseDelayMs = Math.max(1, opts.restartBaseDelayMs ?? RESTART_BASE_DELAY_MS);
    this.logger = opts.logger;
    this.onData = opts.onData;
    this.onExit = opts.onExit;
    this.onReady = opts.onReady;
    this.hostEntryPath = opts.hostEntryPath ?? this.resolveDefaultHostPath();
    this.hostEnv = {
      ...opts.env,
      GENERATORAI_PARENT_PID: String(process.pid),
    };
  }

  private resolveDefaultHostPath(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, '../../../../apps/pty-host/dist/index.js');
  }

  async start(): Promise<void> {
    await this.spawn();
    await this.waitForReady();
    this.logger.info(`[PtyHostClient] PTY host ready (protocol v${EXPECTED_PROTOCOL_VERSION})`);
  }

  /** True once the restart budget is exhausted — the host is permanently down. */
  isFatal(): boolean {
    return this.fatal;
  }

  async createSession(opts: {
    sessionId: string;
    cols: number;
    rows: number;
    cwd: string;
    env?: Record<string, string>;
    shell?: string;
    shellArgs?: string[];
  }): Promise<void> {
    await this.send({ type: 'create_session', ...opts });
    // Only after the host has acked — a rejected create (duplicate id, spawn
    // failure) must not leave a phantom session that a later crash would
    // synthesise an exit for.
    this.liveSessions.add(opts.sessionId);
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.send({ type: 'write', sessionId, data });
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.send({ type: 'resize', sessionId, cols, rows });
  }

  async destroy(sessionId: string): Promise<void> {
    // Dropped before the round-trip, not after: a host that dies mid-destroy
    // would otherwise synthesise an exit for a session the caller has already
    // torn down, and the caller has no way to tell the two apart.
    this.liveSessions.delete(sessionId);
    await this.send({ type: 'destroy', sessionId });
  }

  async signal(sessionId: string, signal: string): Promise<void> {
    await this.send({ type: 'signal', sessionId, signal });
  }

  async pause(sessionId: string): Promise<void> {
    await this.send({ type: 'pause', sessionId });
  }

  async resume(sessionId: string): Promise<void> {
    await this.send({ type: 'resume', sessionId });
  }

  async ack(sessionId: string, bytesConsumed: number): Promise<void> {
    await this.send({ type: 'ack', sessionId, bytesConsumed });
  }

  /**
   * Rendered scrollback from the host's headless VT model. Bounded at
   * O(lines × columns) regardless of how much the command printed.
   */
  async scrollback(sessionId: string, tailLines = 0): Promise<{ lines: string[]; vt: boolean }> {
    const resp = await this.send({ type: 'scrollback', sessionId, tailLines });
    if (resp.type !== 'scrollback') {
      throw new Error(
        `[PtyHostClient] scrollback failed: ${(resp as { message?: string }).message ?? resp.type}`,
      );
    }
    const ok = resp as PtyScrollbackResponse;
    return { lines: ok.lines, vt: ok.vt };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    // Deliberate shutdown, so no synthesised exits: the caller is tearing the
    // whole thing down and does not need per-session obituaries.
    this.liveSessions.clear();
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('[PtyHostClient] Host stopped'));
      this.pendingRequests.delete(id);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  // DistributiveOmit so discriminated-union members keep their specific fields
  private async send(req: Record<string, unknown> & { type: string; reqId?: string }): Promise<PtyHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const fullReq: PtyHostRequest = { ...req, reqId } as unknown as PtyHostRequest;

    return new Promise<PtyHostResponse>((resolve, reject) => {
      if (!this.child || !this.child.connected) {
        reject(new Error('[PtyHostClient] PTY host is not connected'));
        return;
      }
      const timeoutHandle = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`[PtyHostClient] Request ${reqId} timed out`));
        }
      }, 30_000);
      timeoutHandle.unref();

      const clearingResolve = (val: PtyHostResponse) => { clearTimeout(timeoutHandle); resolve(val); };
      const clearingReject = (err: unknown) => { clearTimeout(timeoutHandle); reject(err); };

      this.pendingRequests.set(reqId, { resolve: clearingResolve, reject: clearingReject });
      this.child.send(fullReq, (err) => {
        if (err) {
          this.pendingRequests.delete(reqId);
          clearingReject(new Error(`[PtyHostClient] IPC send error: ${String(err)}`));
        }
      });
    });
  }

  /**
   * △ Found while adding real process tests for this client: plain `node
   * <host entry>` cannot boot — every workspace package's `package.json`
   * "exports" field resolves the `import` condition to `./src/index.ts`
   * (correct for TS-aware tooling — tsx, vitest, the monorepo's own `tsc`
   * project references), but plain Node's native `.ts` support only STRIPS
   * TYPE SYNTAX — it does not resolve a `.js` import specifier to a sibling
   * `.ts` file the way tsx/vite/ts-node do. Every relative `from './x.js'`
   * inside that `.ts` source then fails with `ERR_MODULE_NOT_FOUND`.
   *
   * The original fix passed the bare specifier `'tsx'`, which Node resolves
   * against the *current working directory*, and relied on `tsx` being a
   * devDependency of `apps/server`. Both halves were wrong for anything but a
   * dev checkout: under `pnpm install --prod` — and in a packaged desktop
   * build — devDependencies are not installed at all, so the fork died on
   * `ERR_MODULE_NOT_FOUND: tsx` and the pty host could not start AT ALL in
   * production. `tsx` is now a real `dependency` of `@generatorai/pty-host`
   * (the package that actually needs it), and it is resolved from the host
   * entry file's own resolution root to an absolute path, so the answer does
   * not depend on where the gateway happens to have been launched from.
   *
   * Returns `[]` when tsx cannot be resolved: a build whose workspace deps are
   * genuinely compiled to `.js` needs no loader, and refusing to fork at all
   * would turn a working configuration into a hard failure.
   */
  private resolveExecArgv(): string[] {
    try {
      const requireFromHost = createRequire(this.hostEntryPath);
      const tsxLoader = requireFromHost.resolve('tsx');
      return ['--import', pathToFileURL(tsxLoader).href];
    } catch {
      this.logger.warn(
        '[PtyHostClient] `tsx` is not resolvable from the pty-host entry — forking without a TypeScript loader. ' +
          'This is correct only if the workspace packages it imports are compiled JavaScript.',
      );
      return [];
    }
  }

  private async spawn(): Promise<void> {
    if (this.stopped) throw new Error('[PtyHostClient] Supervisor is stopped');

    // A new process, a new handshake. `process.env` is spread into the child,
    // so a `GENERATORAI_BUILD_STAMP` set on the gateway reaches the host too.
    this.helloFrame = undefined;
    const child = fork(this.hostEntryPath, [], {
      env: { ...process.env, ...this.hostEnv },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv: this.resolveExecArgv(),
    });

    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      this.logger.warn(`[pty-host:stderr] ${text.trimEnd()}`);
      if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logger.info(`[pty-host:stdout] ${chunk.toString().trimEnd()}`);
    });

    child.on('message', (raw: unknown) => {
      if (!isPtyHostResponse(raw)) return;
      this.routeResponse(raw as PtyHostResponse);
    });

    child.on('exit', (code, signal) => {
      this.logger.warn(`[PtyHostClient] PTY host exited (code=${code} signal=${signal})`);
      this.child = null;
      if (this.stopped) return;

      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`[PtyHostClient] Host exited unexpectedly`));
        this.pendingRequests.delete(id);
      }

      // Every PTY the host owned died with it. Synthesise the exit the host
      // can no longer send, BEFORE any restart: without this the adapter keeps
      // its handles, `TerminalService` records stay `exited: false`, the idle
      // reaper never collects them, and the SPA renders live terminals over
      // dead processes forever. `null` (rather than a fabricated numeric code)
      // is the honest answer — nobody observed how the shell terminated.
      const orphaned = [...this.liveSessions];
      this.liveSessions.clear();
      if (orphaned.length > 0) {
        this.logger.warn(
          `[PtyHostClient] Synthesising exit for ${orphaned.length} session(s) lost with the host`,
        );
      }
      for (const sessionId of orphaned) {
        try {
          this.onExit?.(sessionId, null);
        } catch (err: unknown) {
          // One subscriber throwing must not strand the remaining sessions.
          this.logger.warn(`[PtyHostClient] exit handler threw for ${sessionId}: ${String(err)}`);
        }
      }

      const now = Date.now();
      this.restartTimestamps.push(now);
      const windowStart = now - RESTART_WINDOW_MS;
      const recent = this.restartTimestamps.filter((t) => t >= windowStart);
      this.restartTimestamps.splice(0, this.restartTimestamps.length - recent.length);

      if (recent.length > this.maxRestarts) {
        this.logger.error(`[PtyHostClient] FATAL: pty-host crashed ${recent.length} times — giving up`);
        this.stopped = true;
        // `stopped` alone is invisible to callers, so `PtyHostAdapter` kept
        // reporting `isAvailable() === true` and every subsequent spawn threw
        // instead of falling through to the in-process host. This flag is what
        // makes the fallback actually happen.
        this.fatal = true;
        return;
      }

      const delay = Math.min(this.restartBaseDelayMs * 2 ** (recent.length - 1), RESTART_MAX_DELAY_MS);
      setTimeout(() => {
        this.spawn().then(() => this.waitForReady()).catch((err: unknown) => {
          this.logger.error(`[PtyHostClient] Restart failed: ${String(err)}`);
        });
      }, delay).unref();
    });

    child.on('error', (err: Error) => {
      this.logger.error(`[PtyHostClient] Child process error: ${String(err)}`);
    });

    this.child = child;
  }

  private routeResponse(msg: PtyHostResponse): void {
    // Fire-and-forget notifications
    if (msg.type === 'data') {
      this.onData?.((msg as PtyDataNotification).sessionId, (msg as PtyDataNotification).chunk);
      return;
    }
    if (msg.type === 'exit') {
      const n = msg as PtyExitNotification;
      // The host reported this one itself, so it must not also be synthesised
      // if the host later dies.
      this.liveSessions.delete(n.sessionId);
      this.onExit?.(n.sessionId, n.code);
      return;
    }
    if (msg.type === 'session_ready') {
      const n = msg as PtySessionReadyNotification;
      this.onReady?.(n.sessionId, n.pid);
      return;
    }

    // Plan item 43 — the handshake frame. Recorded here, judged at the ready
    // pong below, so "hello never came" and "hello came wrong" fail the same way.
    if (msg.type === 'hello') {
      this.helloFrame = msg;
      return;
    }

    // Ready pong from boot
    if (msg.type === 'pong' && (msg as { reqId: string }).reqId === '__ready__') {
      const pending = this.pendingRequests.get('__ready__');
      this.pendingRequests.delete('__ready__');
      let warning: string | undefined;
      try {
        warning = assertHostHello('pty-host', EXPECTED_PROTOCOL_VERSION, this.buildStamp, this.helloFrame);
      } catch (err: unknown) {
        // A stale dist fails identically on every restart, so latch fatal (which
        // is what makes `PtyHostAdapter.isAvailable()` fall through to the
        // in-process host) and kill the child. `stopped` is set BEFORE the kill
        // so the exit handler neither synthesises exits nor schedules a restart.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`[PtyHostClient] ${reason}`);
        this.stopped = true;
        this.fatal = true;
        const child = this.child;
        this.child = null;
        child?.kill('SIGTERM');
        pending?.reject(new Error(`[PtyHostClient] ${reason}`));
        return;
      }
      if (warning) this.logger.warn(`[PtyHostClient] ${warning}`);
      pending?.resolve(msg);
      return;
    }

    // Correlated response
    const reqId = (msg as { reqId?: string }).reqId;
    if (reqId) {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        this.pendingRequests.delete(reqId);
        pending.resolve(msg);
      }
    }
  }

  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingRequests.set('__ready__', { resolve: () => resolve(), reject });
      setTimeout(() => {
        if (this.pendingRequests.has('__ready__')) {
          this.pendingRequests.delete('__ready__');
          reject(new Error('[PtyHostClient] PTY host did not send ready signal within 10s'));
        }
      }, 10_000).unref();
    });
  }
}
