/**
 * W14 — PtyHostClient: gateway-side client that proxies to the pty-host process.
 *
 * Drop-in replacement for in-process node-pty usage. All PTY file descriptors
 * stay in the child process; the gateway only holds typed IPC messages.
 *
 * L5: Native handles (PTY FDs) never live in the control-plane process.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  PtyHostRequest,
  PtyHostResponse,
  PtyDataNotification,
  PtyExitNotification,
  PtySessionReadyNotification,
} from '@generatorai/shared';
import { isPtyHostResponse } from '@generatorai/shared';
import type { ILogger } from '@generatorai/shared';

/* W14 — restart cap constants */
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

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
}

export class PtyHostClient {
  /* W14 */
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<string, { resolve: (r: PtyHostResponse) => void; reject: (e: Error) => void }>();
  private readonly restartTimestamps: number[] = [];
  private stopped = false;
  private readonly logger: ILogger;
  private readonly hostEntryPath: string;
  private readonly hostEnv: Record<string, string>;
  private readonly onData?: PtyDataHandler;
  private readonly onExit?: PtyExitHandler;
  private readonly onReady?: PtyReadyHandler;

  constructor(opts: PtyHostClientOptions) {
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
    this.logger.info('[PtyHostClient] PTY host ready');
  }

  async createSession(opts: {
    sessionId: string;
    cols: number;
    rows: number;
    cwd: string;
    env?: Record<string, string>;
  }): Promise<void> {
    await this.send({ type: 'create_session', ...opts });
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.send({ type: 'write', sessionId, data });
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.send({ type: 'resize', sessionId, cols, rows });
  }

  async destroy(sessionId: string): Promise<void> {
    await this.send({ type: 'destroy', sessionId });
  }

  async ack(sessionId: string, bytesConsumed: number): Promise<void> {
    await this.send({ type: 'ack', sessionId, bytesConsumed });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
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

  private async spawn(): Promise<void> {
    if (this.stopped) throw new Error('[PtyHostClient] Supervisor is stopped');

    const child = fork(this.hostEntryPath, [], {
      env: { ...process.env, ...this.hostEnv },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
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

      const now = Date.now();
      this.restartTimestamps.push(now);
      const windowStart = now - RESTART_WINDOW_MS;
      const recent = this.restartTimestamps.filter((t) => t >= windowStart);
      this.restartTimestamps.splice(0, this.restartTimestamps.length - recent.length);

      if (recent.length > MAX_RESTARTS) {
        this.logger.error(`[PtyHostClient] FATAL: pty-host crashed ${recent.length} times — giving up`);
        this.stopped = true;
        return;
      }

      const delay = Math.min(1000 * 2 ** (recent.length - 1), 30_000);
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
      this.onExit?.(n.sessionId, n.code);
      return;
    }
    if (msg.type === 'session_ready') {
      const n = msg as PtySessionReadyNotification;
      this.onReady?.(n.sessionId, n.pid);
      return;
    }

    // Ready pong from boot
    if (msg.type === 'pong' && (msg as { reqId: string }).reqId === '__ready__') {
      this.pendingRequests.get('__ready__')?.resolve(msg);
      this.pendingRequests.delete('__ready__');
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
