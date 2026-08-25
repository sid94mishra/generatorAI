/**
 * W12 — Host Supervisor: gateway-side manager for the agent-host process.
 *
 * Spawns `apps/agent-host` as a child process using `child_process.fork()`.
 * Restarts on exit with a cap (5 restarts in 60 s → FATAL). Captures stderr.
 * Forwards typed IPC messages to the host and correlates responses.
 *
 * L5: The gateway never holds provider handles. This class is the boundary —
 * it communicates with the host but never touches provider runtimes directly.
 * L4: The pool that recovers from a wedge must never be the pool that wedges.
 *   → The host is a separate OS process; a wedged host does not stall the gateway.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ILogger } from '@generatorai/shared';
import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentEventNotification,
  SessionEndedNotification,
} from '@generatorai/shared';
import { isAgentHostResponse } from '@generatorai/shared';

/* W12 — restart cap constants */
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

/**
 * Distributive Omit over the discriminated union so callers can pass a single
 * member type (e.g. Omit<SpawnSessionRequest,'reqId'>) without TypeScript
 * complaining that `sessionId` doesn't exist on all union members.
 */
type DistributiveOmitReqId<T> = T extends { reqId: string } ? Omit<T, 'reqId'> : never;
type AnyRequestNoReqId = DistributiveOmitReqId<AgentHostRequest>;

export type HostEventHandler = (msg: AgentEventNotification | SessionEndedNotification) => void;

export interface HostSupervisorOptions {
  /** Absolute path to the agent-host entry point (index.js after build). */
  hostEntryPath?: string;
  /** Environment variables to pass to the child process. */
  env?: Record<string, string>;
  logger: ILogger;
  /** Callback invoked for every streamed AgentEvent or SessionEnded notification. */
  onHostEvent?: HostEventHandler;
}

export class HostSupervisor {
  /* W12 */
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<string, { resolve: (r: AgentHostResponse) => void; reject: (e: Error) => void }>();
  private readonly restartTimestamps: number[] = [];
  private stopped = false;
  private readonly logger: ILogger;
  private readonly hostEntryPath: string;
  private readonly hostEnv: Record<string, string>;
  private readonly onHostEvent?: HostEventHandler;

  constructor(opts: HostSupervisorOptions) {
    this.logger = opts.logger;
    this.onHostEvent = opts.onHostEvent;
    // Default: resolve relative to THIS file at runtime
    this.hostEntryPath = opts.hostEntryPath ?? this.resolveDefaultHostPath();
    this.hostEnv = {
      ...opts.env,
      GENERATORAI_PARENT_PID: String(process.pid),
    };
  }

  private resolveDefaultHostPath(): string {
    // __dirname equivalent for ESM
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Resolve from packages/core/dist/infrastructure → apps/agent-host/dist/index.js
    return path.resolve(__dirname, '../../../../apps/agent-host/dist/index.js');
  }

  /** Start the agent-host child process. */
  async start(): Promise<void> {
    await this.spawn();
    // Wait for the ready signal (pong with reqId '__ready__')
    await this.waitForReady();
    this.logger.info('[HostSupervisor] Agent host ready');
  }

  /** Send a typed request to the host and await the correlated response. */
  async send(req: AnyRequestNoReqId & { reqId?: string }): Promise<AgentHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const fullReq: AgentHostRequest = { ...req, reqId } as AgentHostRequest;

    return new Promise<AgentHostResponse>((resolve, reject) => {
      if (!this.child || !this.child.connected) {
        reject(new Error('[HostSupervisor] Agent host is not connected'));
        return;
      }
      // MINOR-6 fix: capture the timer handle so it can be cleared on success.
      // Without clearTimeout() the timer closure kept a reference to `this` and
      // `reqId` for 30 seconds after every successful request.
      const timeoutHandle = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`[HostSupervisor] Request ${reqId} timed out`));
        }
      }, 30_000);
      timeoutHandle.unref();

      // Wrap resolve/reject so the timer is cancelled when the request settles.
      const clearingResolve = (val: AgentHostResponse) => {
        clearTimeout(timeoutHandle);
        resolve(val);
      };
      const clearingReject = (err: unknown) => {
        clearTimeout(timeoutHandle);
        reject(err);
      };

      this.pendingRequests.set(reqId, { resolve: clearingResolve, reject: clearingReject });
      this.child.send(fullReq, (err) => {
        if (err) {
          this.pendingRequests.delete(reqId);
          clearingReject(new Error(`[HostSupervisor] IPC send error: ${String(err)}`));
        }
      });
    });
  }

  /** Stop the agent-host child process. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('[HostSupervisor] Host stopped'));
      this.pendingRequests.delete(id);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async spawn(): Promise<void> {
    if (this.stopped) throw new Error('[HostSupervisor] Supervisor is stopped');

    const child = fork(this.hostEntryPath, [], {
      env: { ...process.env, ...this.hostEnv },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // Capture stderr — attach to spawn/exit errors per W12 spec
    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      this.logger.warn(`[agent-host:stderr] ${text.trimEnd()}`);
      // Keep last 8KB of stderr
      if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logger.info(`[agent-host:stdout] ${chunk.toString().trimEnd()}`);
    });

    child.on('message', (raw: unknown) => {
      if (!isAgentHostResponse(raw)) return;
      this.routeResponse(raw);
    });

    child.on('exit', (code, signal) => {
      this.logger.warn(`[HostSupervisor] Agent host exited (code=${code} signal=${signal}). stderr: ${stderrBuffer.slice(-512)}`);
      this.child = null;

      if (this.stopped) return;

      // Reject all in-flight requests
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`[HostSupervisor] Host exited unexpectedly. stderr: ${stderrBuffer.slice(-256)}`));
        this.pendingRequests.delete(id);
      }

      // Restart cap check
      const now = Date.now();
      this.restartTimestamps.push(now);
      const windowStart = now - RESTART_WINDOW_MS;
      const recentRestarts = this.restartTimestamps.filter((t) => t >= windowStart);
      this.restartTimestamps.splice(0, this.restartTimestamps.length - recentRestarts.length);

      if (recentRestarts.length > MAX_RESTARTS) {
        this.logger.error(`[HostSupervisor] FATAL: agent-host crashed ${recentRestarts.length} times in ${RESTART_WINDOW_MS / 1000}s — giving up. Last stderr: ${stderrBuffer.slice(-1024)}`);
        this.stopped = true;
        return;
      }

      const delay = Math.min(1000 * 2 ** (recentRestarts.length - 1), 30_000);
      this.logger.info(`[HostSupervisor] Restarting agent host in ${delay}ms (attempt ${recentRestarts.length})`);
      setTimeout(() => {
        this.spawn().then(() => this.waitForReady()).catch((err: unknown) => {
          this.logger.error(`[HostSupervisor] Restart failed: ${String(err)}`);
        });
      }, delay).unref();
    });

    child.on('error', (err: Error) => {
      this.logger.error(`[HostSupervisor] Child process error: ${String(err)}`);
    });

    this.child = child;
  }

  private routeResponse(msg: AgentHostResponse): void {
    // Streaming notifications — no reqId correlation
    if (msg.type === 'agent_event' || msg.type === 'session_ended') {
      this.onHostEvent?.(msg as AgentEventNotification | SessionEndedNotification);
      return;
    }

    // Ready pong from boot
    if (msg.type === 'pong' && msg.reqId === '__ready__') {
      // Handled by waitForReady
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
      this.pendingRequests.set('__ready__', {
        resolve: () => resolve(),
        reject,
      });
      setTimeout(() => {
        if (this.pendingRequests.has('__ready__')) {
          this.pendingRequests.delete('__ready__');
          reject(new Error('[HostSupervisor] Agent host did not send ready signal within 10s'));
        }
      }, 10_000).unref();
    });
  }
}
