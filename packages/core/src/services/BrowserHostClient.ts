/**
 * W15 — BrowserHostClient: gateway-side client that proxies to the browser-host process.
 *
 * Drop-in replacement for in-process Playwright usage. The single Chromium
 * instance stays in the child process; the gateway only holds typed IPC messages.
 *
 * L5: Native handles (browser FDs, CDP sockets) never live in the control-plane.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BrowserHostRequest,
  BrowserHostResponse,
  BrowserHostConfig,
  BrowserHostAction,
  BrowserFrameNotification,
  BrowserSnapshotResultNotification,
  BrowserActionResultNotification,
} from '@generatorai/shared';
import { isBrowserHostResponse } from '@generatorai/shared';
import type { ILogger } from '@generatorai/shared';

/* W15 — restart cap constants */
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

export type BrowserFrameHandler = (contextId: string, data: string, format: 'jpeg' | 'webp') => void;

export interface BrowserHostClientOptions {
  hostEntryPath?: string;
  env?: Record<string, string>;
  logger: ILogger;
  onFrame?: BrowserFrameHandler;
}

export class BrowserHostClient {
  /* W15 */
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<string, { resolve: (r: BrowserHostResponse) => void; reject: (e: Error) => void }>();
  private readonly restartTimestamps: number[] = [];
  private stopped = false;
  private readonly logger: ILogger;
  private readonly hostEntryPath: string;
  private readonly hostEnv: Record<string, string>;
  private readonly onFrame?: BrowserFrameHandler;

  constructor(opts: BrowserHostClientOptions) {
    this.logger = opts.logger;
    this.onFrame = opts.onFrame;
    this.hostEntryPath = opts.hostEntryPath ?? this.resolveDefaultHostPath();
    this.hostEnv = {
      ...opts.env,
      GENERATORAI_PARENT_PID: String(process.pid),
    };
  }

  private resolveDefaultHostPath(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, '../../../../apps/browser-host/dist/index.js');
  }

  async start(): Promise<void> {
    await this.spawn();
    await this.waitForReady();
    this.logger.info('[BrowserHostClient] Browser host ready');
  }

  async createContext(contextId: string, config?: BrowserHostConfig): Promise<void> {
    await this.sendRequest({ type: 'create_context', contextId, config });
  }

  async navigate(contextId: string, url: string): Promise<void> {
    await this.sendRequest({ type: 'navigate', contextId, url });
  }

  async snapshot(contextId: string, mode: 'accessibility' | 'screenshot'): Promise<{ data: string; format: 'json' | 'jpeg' }> {
    const res = await this.sendRequest({ type: 'snapshot', contextId, mode });
    if (res.type === 'snapshot_result') {
      const snap = res as BrowserSnapshotResultNotification;
      return { data: snap.data, format: snap.format };
    }
    throw new Error(`[BrowserHostClient] Unexpected snapshot response: ${res.type}`);
  }

  async performAction(contextId: string, action: BrowserHostAction): Promise<{ success: boolean; error?: string }> {
    const res = await this.sendRequest({ type: 'action', contextId, action });
    if (res.type === 'action_result') {
      const r = res as BrowserActionResultNotification;
      return { success: r.success, error: r.error };
    }
    throw new Error(`[BrowserHostClient] Unexpected action response: ${res.type}`);
  }

  async startScreencast(contextId: string, fps?: number): Promise<void> {
    await this.sendRequest({ type: 'start_screencast', contextId, fps });
  }

  async stopScreencast(contextId: string): Promise<void> {
    await this.sendRequest({ type: 'stop_screencast', contextId });
  }

  async destroyContext(contextId: string): Promise<void> {
    await this.sendRequest({ type: 'destroy_context', contextId });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('[BrowserHostClient] Host stopped'));
      this.pendingRequests.delete(id);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  // DistributiveOmit workaround: accept a plain record so the discriminated union keeps its members
  private async sendRequest(req: Record<string, unknown> & { type: string; reqId?: string }): Promise<BrowserHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const fullReq: BrowserHostRequest = { ...req, reqId } as unknown as BrowserHostRequest;

    return new Promise<BrowserHostResponse>((resolve, reject) => {
      if (!this.child || !this.child.connected) {
        reject(new Error('[BrowserHostClient] Browser host is not connected'));
        return;
      }
      const timeoutHandle = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`[BrowserHostClient] Request ${reqId} timed out`));
        }
      }, 30_000);
      timeoutHandle.unref();

      const clearingResolve = (val: BrowserHostResponse) => { clearTimeout(timeoutHandle); resolve(val); };
      const clearingReject = (err: unknown) => { clearTimeout(timeoutHandle); reject(err); };

      this.pendingRequests.set(reqId, { resolve: clearingResolve, reject: clearingReject });
      this.child.send(fullReq, (err) => {
        if (err) {
          this.pendingRequests.delete(reqId);
          clearingReject(new Error(`[BrowserHostClient] IPC send error: ${String(err)}`));
        }
      });
    });
  }

  private async spawn(): Promise<void> {
    if (this.stopped) throw new Error('[BrowserHostClient] Supervisor is stopped');

    const child = fork(this.hostEntryPath, [], {
      env: { ...process.env, ...this.hostEnv },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      this.logger.warn(`[browser-host:stderr] ${text.trimEnd()}`);
      if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logger.info(`[browser-host:stdout] ${chunk.toString().trimEnd()}`);
    });

    child.on('message', (raw: unknown) => {
      if (!isBrowserHostResponse(raw)) return;
      this.routeResponse(raw as BrowserHostResponse);
    });

    child.on('exit', (code, signal) => {
      this.logger.warn(`[BrowserHostClient] Browser host exited (code=${code} signal=${signal})`);
      this.child = null;
      if (this.stopped) return;

      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`[BrowserHostClient] Host exited unexpectedly`));
        this.pendingRequests.delete(id);
      }

      const now = Date.now();
      this.restartTimestamps.push(now);
      const windowStart = now - RESTART_WINDOW_MS;
      const recent = this.restartTimestamps.filter((t) => t >= windowStart);
      this.restartTimestamps.splice(0, this.restartTimestamps.length - recent.length);

      if (recent.length > MAX_RESTARTS) {
        this.logger.error(`[BrowserHostClient] FATAL: browser-host crashed ${recent.length} times — giving up`);
        this.stopped = true;
        return;
      }

      const delay = Math.min(1000 * 2 ** (recent.length - 1), 30_000);
      setTimeout(() => {
        this.spawn().then(() => this.waitForReady()).catch((err: unknown) => {
          this.logger.error(`[BrowserHostClient] Restart failed: ${String(err)}`);
        });
      }, delay).unref();
    });

    child.on('error', (err: Error) => {
      this.logger.error(`[BrowserHostClient] Child process error: ${String(err)}`);
    });

    this.child = child;
  }

  private routeResponse(msg: BrowserHostResponse): void {
    // Fire-and-forget notifications
    if (msg.type === 'frame') {
      const n = msg as BrowserFrameNotification;
      this.onFrame?.(n.contextId, n.data, n.format);
      return;
    }
    if (msg.type === 'context_ready' || msg.type === 'context_destroyed') {
      // No reqId — handled via create/destroy correlated requests
      return;
    }

    // Ready pong from boot
    if (msg.type === 'pong' && (msg as { reqId: string }).reqId === '__ready__') {
      this.pendingRequests.get('__ready__')?.resolve(msg);
      this.pendingRequests.delete('__ready__');
      return;
    }

    // Correlated response (snapshot_result, action_result, ack, error, pong)
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
          reject(new Error('[BrowserHostClient] Browser host did not send ready signal within 10s'));
        }
      }, 10_000).unref();
    });
  }
}
