// ────────────────────────────────────────────────────────────────
// PtyHostAdapter — `ITerminalHost` backed by the out-of-process pty-host
// (`apps/pty-host`), via `PtyHostClient`.
//
// L5: native PTY file descriptors never live in the control-plane process —
// `PtyHostClient` forks `apps/pty-host/dist/index.js` and only ever holds
// typed IPC messages. This adapter is the missing piece that lets
// `TerminalService` (which already supports a prioritized list of
// `ITerminalHost` implementations — see `NodePtyHost`/`SandboxPtyHost`/
// `FallbackChildProcessHost`) pick the out-of-process host instead of
// re-architecting TerminalService itself.
//
// `ITerminalHost.spawn()` returns an `ITerminalHandle` with SYNCHRONOUS
// write/resize/signal/pause/resume methods, while every `PtyHostClient`
// call is IPC (async). The handles below fire-and-forget those calls
// (logging on failure) — exactly the same shape TerminalService's callers
// already expect from a PTY handle (`write()` on a real `node-pty`
// instance doesn't return a completion promise either).
//
// One `PtyHostClient` — and therefore one pty-host CHILD PROCESS — serves
// every session this adapter spawns; sessions are demultiplexed by
// sessionId from the client's host-wide onData/onExit/onReady callbacks
// into per-handle listener sets, since the client's own callback shape is
// one-per-host, not one-per-session.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { ILogger, TerminalHostKind } from '@generatorai/shared';
import type {
  ITerminalHandle,
  ITerminalHost,
  TerminalSpawnOptions,
} from '../domain/ports/ITerminalHost.js';
import { PtyHostClient } from './PtyHostClient.js';

interface HandleListeners {
  data: Set<(chunk: Buffer) => void>;
  exit: Set<(info: { code: number; signal?: string }) => void>;
}

class PtyHostHandle implements ITerminalHandle {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: TerminalHostKind = 'pty-host';
  pid: number | null = null;
  readonly cwd: string;
  readonly shell: string;
  cols: number;
  rows: number;
  exitCode: number | null = null;
  exitSignal: string | undefined;
  readonly createdAt = Date.now();

  private readonly listeners: HandleListeners = { data: new Set(), exit: new Set() };

  constructor(
    private readonly client: PtyHostClient,
    opts: { id: string; workspaceId: string; cwd: string; shell: string; cols: number; rows: number },
    private readonly logger: ILogger,
  ) {
    this.id = opts.id;
    this.workspaceId = opts.workspaceId;
    this.cwd = opts.cwd;
    this.shell = opts.shell;
    this.cols = opts.cols;
    this.rows = opts.rows;
  }

  /** @internal — called by PtyHostAdapter's demux, not by TerminalService. */
  _dispatchData(chunk: string): void {
    const buf = Buffer.from(chunk, 'utf8');
    for (const cb of this.listeners.data) cb(buf);
  }

  /**
   * @internal
   *
   * `code === null` means the pty-host process itself died and took this PTY
   * with it — nobody observed how the shell terminated. Reporting `0` there
   * would tell the UI the command succeeded, so a lost session is surfaced as
   * `SIGHUP`, which is precisely what happened: the controlling process went
   * away.
   */
  _dispatchExit(code: number | null): void {
    const lostWithHost = code === null;
    this.exitCode = code ?? 1;
    if (lostWithHost) this.exitSignal = 'SIGHUP';
    for (const cb of this.listeners.exit) {
      cb({ code: this.exitCode, ...(lostWithHost ? { signal: 'SIGHUP' } : {}) });
    }
  }

  /** @internal */
  _dispatchReady(pid: number): void {
    this.pid = pid;
  }

  write(data: string | Buffer): void {
    void this.client.write(this.id, typeof data === 'string' ? data : data.toString('utf8')).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] write failed: ${String(err)}`);
    });
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    void this.client.resize(this.id, cols, rows).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] resize failed: ${String(err)}`);
    });
  }

  signal(name: string): void {
    void this.client.signal(this.id, name).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] signal ${name} failed: ${String(err)}`);
    });
  }

  kill(signal?: string): void {
    void this.client.destroy(this.id).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] kill failed: ${String(err)}`);
    });
    void signal; // destroy() always terminates the session; pty-host has no separate "kill with signal X" request.
  }

  pause(): void {
    void this.client.pause(this.id).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] pause failed: ${String(err)}`);
    });
  }

  resume(): void {
    void this.client.resume(this.id).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] resume failed: ${String(err)}`);
    });
  }

  /**
   * P0-23 (rebuilt): return N consumed chars of credit to the host.
   *
   * `PtyHostClient.ack()` existed but had ZERO callers, so `PtySession`'s
   * credit counter only ever went up: any command emitting more than the
   * host's 100 000-char high watermark stopped that terminal permanently.
   * This is the gateway end of that loop — `TerminalService` calls it once
   * output has actually been consumed (parsed by every attached viewer, or
   * banked into scrollback when nobody is watching).
   */
  ack(bytesConsumed: number): void {
    if (bytesConsumed <= 0) return;
    void this.client.ack(this.id, bytesConsumed).catch((err: unknown) => {
      this.logger.warn?.(`[PtyHostHandle] ack failed: ${String(err)}`);
    });
  }

  /** Rendered scrollback from the host's headless VT model (W14). */
  async scrollbackLines(tailLines = 0): Promise<string[]> {
    const { lines } = await this.client.scrollback(this.id, tailLines);
    return lines;
  }

  onData(cb: (chunk: Buffer) => void): () => void {
    this.listeners.data.add(cb);
    return () => this.listeners.data.delete(cb);
  }

  onExit(cb: (info: { code: number; signal?: string }) => void): () => void {
    this.listeners.exit.add(cb);
    return () => this.listeners.exit.delete(cb);
  }
}

export interface PtyHostAdapterOptions {
  logger: ILogger;
  /** Overrides the client's default `apps/pty-host/dist/index.js` resolution — tests only. */
  hostEntryPath?: string;
}

export class PtyHostAdapter implements ITerminalHost {
  readonly kind: TerminalHostKind = 'pty-host';

  private readonly client: PtyHostClient;
  private readonly handles = new Map<string, PtyHostHandle>();
  private readonly logger: ILogger;
  private startPromise: Promise<void> | null = null;
  private ready = false;
  private failed = false;

  constructor(opts: PtyHostAdapterOptions) {
    this.logger = opts.logger;
    this.client = new PtyHostClient({
      logger: opts.logger,
      ...(opts.hostEntryPath ? { hostEntryPath: opts.hostEntryPath } : {}),
      onData: (sessionId, chunk) => this.handles.get(sessionId)?._dispatchData(chunk),
      onExit: (sessionId, code) => {
        this.handles.get(sessionId)?._dispatchExit(code);
        this.handles.delete(sessionId);
      },
      onReady: (sessionId, pid) => this.handles.get(sessionId)?._dispatchReady(pid),
    });
  }

  /**
   * Starts the pty-host child process. Idempotent — safe to call once at
   * boot (composition-root does this eagerly, matching `AgentHostClient`)
   * and again defensively before the first `spawn()`.
   *
   * A REJECTED attempt is not cached. The previous version stored the failed
   * promise forever, so one unlucky boot (a cold `pnpm install`, a slow disk,
   * a transient EPERM on the fork) permanently disabled the out-of-process
   * host for the life of the process — every later `start()` re-awaited the
   * same rejection without ever retrying.
   */
  async start(): Promise<void> {
    if (this.ready) return;
    if (!this.startPromise) {
      this.startPromise = this.client.start()
        .then(() => { this.ready = true; })
        .catch((err: unknown) => {
          this.failed = true;
          this.startPromise = null; // Allow a later attempt to actually retry.
          this.logger.error?.(`[PtyHostAdapter] Failed to start pty-host: ${String(err)}`);
          throw err;
        });
    }
    return this.startPromise;
  }

  /**
   * Resolves once an in-flight `start()` has settled — used by
   * `TerminalService` so a terminal opened during the first few hundred ms of
   * boot waits for this host instead of silently landing on the in-process
   * `NodePtyHost` and producing a mixed-host pool. Never rejects: a failed
   * start is a fallback, not a spawn error.
   */
  async whenReady(): Promise<void> {
    if (!this.startPromise) return;
    await this.startPromise.catch(() => undefined);
  }

  /**
   * True once the out-of-process host has acknowledged readiness — never a
   * static `true`, and never true again once the client has declared itself
   * fatally down (restart budget exhausted). That last clause is what makes
   * `TerminalService` fall through to `NodePtyHost` after a crash loop; while
   * it was missing, `isAvailable()` stayed `true` over a host that was never
   * coming back and every spawn threw.
   */
  isAvailable(): boolean {
    return this.ready && !this.failed && !this.client.isFatal();
  }

  async spawn(opts: TerminalSpawnOptions): Promise<ITerminalHandle> {
    if (!this.isAvailable()) await this.start();
    if (!this.isAvailable()) throw new Error('[PtyHostAdapter] pty-host is not available');

    const id = randomUUID();
    const shell = opts.shell ?? (process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash'));
    const handle = new PtyHostHandle(
      this.client,
      { id, workspaceId: opts.workspaceId, cwd: opts.cwd, shell, cols: opts.cols, rows: opts.rows },
      this.logger,
    );
    this.handles.set(id, handle);

    try {
      await this.client.createSession({
        sessionId: id,
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        shell,
        ...(opts.shellArgs ? { shellArgs: opts.shellArgs } : {}),
        ...(opts.env ? { env: opts.env } : {}),
      });
    } catch (err) {
      this.handles.delete(id);
      throw err;
    }

    return handle;
  }

  async stop(): Promise<void> {
    await this.client.stop();
    this.handles.clear();
    this.ready = false;
  }
}
