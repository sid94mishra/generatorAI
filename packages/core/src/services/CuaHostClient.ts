/**
 * W17 — CuaHostClient: gateway-side client that proxies to the cua-host process.
 *
 * Drop-in replacement for in-process CUA driver calls. The driver stays in the
 * child process; the gateway reads the descriptor file and routes IPC only.
 *
 * L5: Native handles (OS input APIs) never live in the control-plane process.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CuaHostRequest,
  CuaHostResponse,
  ComputerAction,
  CuaConnectionDescriptor,
} from '@generatorai/shared';
import { isCuaHostResponse } from '@generatorai/shared';
import type { ILogger } from '@generatorai/shared';

/* W17 — restart cap constants */
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

export interface CuaHostClientOptions {
  hostEntryPath?: string;
  dataDir?: string;
  env?: Record<string, string>;
  logger: ILogger;
}

export class CuaHostClient {
  /* W17 */
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<string, { resolve: (r: CuaHostResponse) => void; reject: (e: Error) => void }>();
  private readonly restartTimestamps: number[] = [];
  private stopped = false;
  private readonly logger: ILogger;
  private readonly hostEntryPath: string;
  private readonly hostEnv: Record<string, string>;
  private readonly dataDir: string;

  constructor(opts: CuaHostClientOptions) {
    this.logger = opts.logger;
    this.dataDir = opts.dataDir ?? process.cwd();
    this.hostEntryPath = opts.hostEntryPath ?? this.resolveDefaultHostPath();
    this.hostEnv = {
      ...opts.env,
      GENERATORAI_PARENT_PID: String(process.pid),
      GENERATORAI_DATA_DIR: this.dataDir,
    };
  }

  private resolveDefaultHostPath(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, '../../../../apps/cua-host/dist/index.js');
  }

  async start(): Promise<void> {
    await this.spawn();
    await this.waitForReady();
    this.logger.info('[CuaHostClient] CUA host ready');
  }

  async performAction(action: ComputerAction, captureAfter = true): Promise<{ success: boolean; screenshot?: string; error?: string }> {
    const actionId = randomUUID();
    const res = await this.sendRequest({ type: 'perform_action', actionId, action, captureAfter });
    if (res.type === 'action_result') {
      return { success: res.success, screenshot: res.screenshot, error: res.error };
    }
    throw new Error(`[CuaHostClient] Unexpected response: ${res.type}`);
  }

  async capture(): Promise<string> {
    const captureId = randomUUID();
    const res = await this.sendRequest({ type: 'capture', captureId });
    if (res.type === 'capture_result') {
      return res.screenshot;
    }
    throw new Error(`[CuaHostClient] Unexpected capture response: ${res.type}`);
  }

  /**
   * Read and verify the connection descriptor written by cua-host.
   * Used by the gateway to confirm the host is alive before routing actions.
   */
  async readDescriptor(): Promise<CuaConnectionDescriptor | null> {
    const descriptorPath = path.join(this.dataDir, 'cua-connection.json');
    try {
      const raw = await fs.readFile(descriptorPath, 'utf-8');
      return JSON.parse(raw) as CuaConnectionDescriptor;
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('[CuaHostClient] Host stopped'));
      this.pendingRequests.delete(id);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  // DistributiveOmit workaround: accept a plain record so the discriminated union keeps its members
  private async sendRequest(req: Record<string, unknown> & { type: string; reqId?: string }): Promise<CuaHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const fullReq: CuaHostRequest = { ...req, reqId } as unknown as CuaHostRequest;

    return new Promise<CuaHostResponse>((resolve, reject) => {
      if (!this.child || !this.child.connected) {
        reject(new Error('[CuaHostClient] CUA host is not connected'));
        return;
      }
      const timeoutHandle = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`[CuaHostClient] Request ${reqId} timed out`));
        }
      }, 30_000);
      timeoutHandle.unref();

      const clearingResolve = (val: CuaHostResponse) => { clearTimeout(timeoutHandle); resolve(val); };
      const clearingReject = (err: unknown) => { clearTimeout(timeoutHandle); reject(err); };

      this.pendingRequests.set(reqId, { resolve: clearingResolve, reject: clearingReject });
      this.child.send(fullReq, (err) => {
        if (err) {
          this.pendingRequests.delete(reqId);
          clearingReject(new Error(`[CuaHostClient] IPC send error: ${String(err)}`));
        }
      });
    });
  }

  private async spawn(): Promise<void> {
    if (this.stopped) throw new Error('[CuaHostClient] Supervisor is stopped');

    const child = fork(this.hostEntryPath, [], {
      env: { ...process.env, ...this.hostEnv },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      this.logger.warn(`[cua-host:stderr] ${text.trimEnd()}`);
      if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logger.info(`[cua-host:stdout] ${chunk.toString().trimEnd()}`);
    });

    child.on('message', (raw: unknown) => {
      if (!isCuaHostResponse(raw)) return;
      this.routeResponse(raw as CuaHostResponse);
    });

    child.on('exit', (code, signal) => {
      this.logger.warn(`[CuaHostClient] CUA host exited (code=${code} signal=${signal})`);
      this.child = null;
      if (this.stopped) return;

      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`[CuaHostClient] Host exited unexpectedly`));
        this.pendingRequests.delete(id);
      }

      const now = Date.now();
      this.restartTimestamps.push(now);
      const windowStart = now - RESTART_WINDOW_MS;
      const recent = this.restartTimestamps.filter((t) => t >= windowStart);
      this.restartTimestamps.splice(0, this.restartTimestamps.length - recent.length);

      if (recent.length > MAX_RESTARTS) {
        this.logger.error(`[CuaHostClient] FATAL: cua-host crashed ${recent.length} times — giving up`);
        this.stopped = true;
        return;
      }

      const delay = Math.min(1000 * 2 ** (recent.length - 1), 30_000);
      setTimeout(() => {
        this.spawn().then(() => this.waitForReady()).catch((err: unknown) => {
          this.logger.error(`[CuaHostClient] Restart failed: ${String(err)}`);
        });
      }, delay).unref();
    });

    child.on('error', (err: Error) => {
      this.logger.error(`[CuaHostClient] Child process error: ${String(err)}`);
    });

    this.child = child;
  }

  private routeResponse(msg: CuaHostResponse): void {
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
          reject(new Error('[CuaHostClient] CUA host did not send ready signal within 10s'));
        }
      }, 10_000).unref();
    });
  }
}
