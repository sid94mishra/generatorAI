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
 * W20 — the conditional half of the restart predicate.
 *
 * A count-based cap alone answers "how often", never "should we at all". These
 * are the failures where restarting is provably pointless: the entry point does
 * not exist, does not parse, or the runtime refused to load it. Burning five
 * restarts on `ERR_MODULE_NOT_FOUND` only delays the operator seeing the real
 * message by ~30 s of exponential backoff.
 *
 * Deliberately narrow: anything not matched here is treated as recoverable and
 * restarted, because a false "unrecoverable" takes the host down permanently
 * while a false "recoverable" costs one restart.
 */
const UNRECOVERABLE_STDERR_PATTERNS: readonly RegExp[] = [
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find module/,
  /ERR_UNSUPPORTED_DIR_IMPORT/,
  /ERR_UNKNOWN_FILE_EXTENSION/,
  /\bSyntaxError\b/,
];

/** Spawn-level errors that mean the file or permissions are wrong, not flaky. */
const UNRECOVERABLE_SPAWN_CODES: ReadonlySet<string> = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR']);

/** Lifecycle state, reported honestly rather than inferred from `stopped`. */
export type HostSupervisorState = 'idle' | 'starting' | 'running' | 'restarting' | 'stopped' | 'fatal';

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
  /**
   * Invoked once a RESTARTED host has signalled ready (never for the first
   * start). The new process boots with empty session maps, so whoever owns
   * session state must re-establish it here — without this the gateway keeps a
   * handler map the host knows nothing about and every later turn fails
   * SESSION_NOT_FOUND forever while everything still looks alive.
   */
  onHostRestart?: () => void | Promise<void>;
  /**
   * Invoked when the supervisor gives up: the restart cap was exhausted or the
   * failure was classified unrecoverable. The host will not come back without
   * an explicit `restart()`.
   */
  onFatal?: (reason: string) => void;
  /**
   * Process-spawn seam. Defaults to `child_process.fork`. Injectable so the
   * restart predicate, the re-attach handshake and the fatal path can be tested
   * without launching a real Node process per case.
   */
  forkChild?: (entryPath: string, env: NodeJS.ProcessEnv) => ChildProcess;
  /** Backoff timer seam, so restart tests do not sleep for real. */
  scheduleRestart?: (fn: () => void, delayMs: number) => void;
  /**
   * How long a host gets to act on SIGTERM before it is SIGKILLed. A host that
   * ignores SIGTERM would otherwise outlive its own replacement — two live
   * agent-host processes, one of them unreachable.
   */
  stopGraceMs?: number;
}

/** Default SIGTERM → SIGKILL escalation window. */
const STOP_GRACE_MS = 5_000;

export class HostSupervisor {
  /* W12 */
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<string, { resolve: (r: AgentHostResponse) => void; reject: (e: Error) => void }>();
  private readonly restartTimestamps: number[] = [];
  private stopped = false;
  private state: HostSupervisorState = 'idle';
  /** Reason recorded when `state === 'fatal'`, surfaced by `getFatalReason()`. */
  private fatalReason: string | undefined;
  /** True once the first start() has completed; every later ready is a restart. */
  private hasBooted = false;
  private readonly logger: ILogger;
  private readonly hostEntryPath: string;
  private readonly hostEnv: Record<string, string>;
  private readonly onHostEvent?: HostEventHandler;
  private readonly onHostRestart?: () => void | Promise<void>;
  private readonly onFatal?: (reason: string) => void;
  private readonly forkChild: (entryPath: string, env: NodeJS.ProcessEnv) => ChildProcess;
  private readonly scheduleRestart: (fn: () => void, delayMs: number) => void;
  private readonly stopGraceMs: number;

  constructor(opts: HostSupervisorOptions) {
    this.logger = opts.logger;
    this.onHostEvent = opts.onHostEvent;
    this.onHostRestart = opts.onHostRestart;
    this.onFatal = opts.onFatal;
    this.forkChild =
      opts.forkChild ??
      ((entryPath, env) => fork(entryPath, [], { env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }));
    this.scheduleRestart =
      opts.scheduleRestart ??
      ((fn, delayMs) => {
        setTimeout(fn, delayMs).unref();
      });
    this.stopGraceMs = opts.stopGraceMs ?? STOP_GRACE_MS;
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
    this.state = 'starting';
    try {
      await this.spawn();
      // Wait for the ready signal (pong with reqId '__ready__')
      await this.waitForReady();
    } catch (err) {
      this.state = 'fatal';
      this.fatalReason = String(err);
      throw err;
    }
    this.state = 'running';
    this.hasBooted = true;
    this.logger.info('[HostSupervisor] Agent host ready');
  }

  /** Current lifecycle state. Never inferred — set at every transition. */
  getState(): HostSupervisorState {
    return this.state;
  }

  /** Why the supervisor gave up, when `getState() === 'fatal'`. */
  getFatalReason(): string | undefined {
    return this.fatalReason;
  }

  /**
   * Explicit recovery from `stopped` or `fatal`.
   *
   * △ Restart-cap exhaustion used to set `stopped = true` with no way back:
   * `spawn()` threw "Supervisor is stopped" forever and nothing reported it, so
   * the gateway kept answering health checks as if the host were fine. The cap
   * still exists — it stops an automatic crash loop — but an operator (or a
   * caller that has fixed the underlying problem) can now clear it. The restart
   * window is cleared too, otherwise the very first exit after recovery would
   * re-trip the cap on stale timestamps.
   */
  async restart(): Promise<void> {
    this.stopped = false;
    this.fatalReason = undefined;
    this.restartTimestamps.length = 0;
    // Detach BEFORE spawning the replacement. `this.child` is the identity every
    // handler checks itself against, so clearing it here is what makes the old
    // child's late `exit` a no-op instead of an event that nulls the
    // replacement and forks a third process (B2).
    this.terminate(this.child);
    this.child = null;
    await this.start();
  }

  /**
   * Send a host process on its way and make sure it actually goes.
   *
   * SIGTERM is a request. A host wedged in native code never acts on it, and
   * without escalation it outlives the replacement — the "two live agent-host
   * processes" half of B2. The timer is unref'd and cleared on exit, so a host
   * that shuts down cleanly is never signalled twice.
   */
  private terminate(child: ChildProcess | null): void {
    if (!child) return;
    let exited = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    child.once('exit', () => {
      exited = true;
      if (escalation) clearTimeout(escalation);
    });

    child.kill('SIGTERM');
    if (exited) return;

    escalation = setTimeout(() => {
      if (exited) return;
      this.logger.warn('[HostSupervisor] Agent host did not exit on SIGTERM — sending SIGKILL');
      try {
        child.kill('SIGKILL');
      } catch (err: unknown) {
        this.logger.warn(`[HostSupervisor] SIGKILL failed: ${String(err)}`);
      }
    }, this.stopGraceMs);
    if (typeof escalation.unref === 'function') escalation.unref();
  }

  /** Send a typed request to the host and await the correlated response. */
  async send(req: AnyRequestNoReqId & { reqId?: string }): Promise<AgentHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const fullReq: AgentHostRequest = { ...req, reqId } as AgentHostRequest;

    return new Promise<AgentHostResponse>((resolve, reject) => {
      if (!this.child || !this.child.connected) {
        // Surface the fatal reason rather than a generic "not connected":
        // "the host gave up 4 minutes ago because the entry point is missing"
        // is actionable; "not connected" sends the operator to the network.
        reject(
          new Error(
            `[HostSupervisor] Agent host is not connected (state=${this.state}` +
              `${this.fatalReason ? `, reason=${this.fatalReason}` : ''})`,
          ),
        );
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
    this.state = 'stopped';
    this.terminate(this.child);
    this.child = null;
    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('[HostSupervisor] Host stopped'));
      this.pendingRequests.delete(id);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async spawn(): Promise<void> {
    if (this.stopped) throw new Error('[HostSupervisor] Supervisor is stopped');

    const child = this.forkChild(this.hostEntryPath, { ...process.env, ...this.hostEnv });

    // Capture stderr — attach to spawn/exit errors per W12 spec
    let stderrBuffer = '';
    /** Set by child.on('error') so the exit handler can classify a spawn failure. */
    let spawnErrorCode: string | undefined;
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
      // A superseded child must not resolve requests belonging to its
      // replacement: reqIds are only unique per supervisor, not per process.
      if (this.child !== child) return;
      if (!isAgentHostResponse(raw)) return;
      this.routeResponse(raw);
    });

    child.on('exit', (code, signal) => {
      this.logger.warn(`[HostSupervisor] Agent host exited (code=${code} signal=${signal}). stderr: ${stderrBuffer.slice(-512)}`);

      // B2 — everything below belongs to the CURRENT host. A child that was
      // already replaced (by `restart()` or `stop()`) exits asynchronously,
      // long after `this.child` moved on; letting it run this handler nulled
      // the live replacement, rejected ITS in-flight requests and scheduled a
      // restart that forked a third process while the second kept running.
      if (this.child !== child) {
        this.logger.info('[HostSupervisor] Superseded agent host exited — no action taken');
        return;
      }
      this.child = null;

      if (this.stopped) return;

      // Reject all in-flight requests
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`[HostSupervisor] Host exited unexpectedly. stderr: ${stderrBuffer.slice(-256)}`));
        this.pendingRequests.delete(id);
      }

      // W20 — CONDITIONAL restart predicate. The count-based cap answers "how
      // often"; this answers "at all". A missing or unparseable entry point
      // will fail identically five more times.
      const unrecoverable = this.classifyUnrecoverable(stderrBuffer, spawnErrorCode);
      if (unrecoverable) {
        this.enterFatal(`unrecoverable agent-host failure (${unrecoverable}). stderr: ${stderrBuffer.slice(-1024)}`);
        return;
      }

      // Restart cap check
      const now = Date.now();
      this.restartTimestamps.push(now);
      const windowStart = now - RESTART_WINDOW_MS;
      const recentRestarts = this.restartTimestamps.filter((t) => t >= windowStart);
      this.restartTimestamps.splice(0, this.restartTimestamps.length - recentRestarts.length);

      if (recentRestarts.length > MAX_RESTARTS) {
        this.enterFatal(
          `agent-host crashed ${recentRestarts.length} times in ${RESTART_WINDOW_MS / 1000}s — giving up. ` +
            `Last stderr: ${stderrBuffer.slice(-1024)}`,
        );
        return;
      }

      const delay = Math.min(1000 * 2 ** (recentRestarts.length - 1), 30_000);
      this.state = 'restarting';
      this.logger.info(`[HostSupervisor] Restarting agent host in ${delay}ms (attempt ${recentRestarts.length})`);
      this.scheduleRestart(() => {
        this.spawn()
          .then(() => this.waitForReady())
          .then(() => this.onReadyAfterRestart())
          .catch((err: unknown) => {
            this.logger.error(`[HostSupervisor] Restart failed: ${String(err)}`);
          });
      }, delay);
    });

    child.on('error', (err: Error & { code?: string }) => {
      // Recorded on the closure, so a superseded child's error can never
      // reclassify the current one's exit.
      spawnErrorCode = err.code;
      this.logger.error(`[HostSupervisor] Child process error: ${String(err)}`);
    });

    this.child = child;
  }

  /**
   * Returns a short reason string when the failure is one restarting cannot
   * fix, or undefined when it is worth another attempt.
   */
  private classifyUnrecoverable(stderr: string, spawnErrorCode: string | undefined): string | undefined {
    if (spawnErrorCode && UNRECOVERABLE_SPAWN_CODES.has(spawnErrorCode)) return `spawn ${spawnErrorCode}`;
    for (const pattern of UNRECOVERABLE_STDERR_PATTERNS) {
      if (pattern.test(stderr)) return `stderr matched ${pattern.source}`;
    }
    return undefined;
  }

  /** Give up: stop restarting, record why, and tell the owner. */
  private enterFatal(reason: string): void {
    this.logger.error(`[HostSupervisor] FATAL: ${reason}`);
    this.stopped = true;
    this.state = 'fatal';
    this.fatalReason = reason;
    try {
      this.onFatal?.(reason);
    } catch (err: unknown) {
      this.logger.warn(`[HostSupervisor] onFatal handler threw: ${String(err)}`);
    }
  }

  /**
   * The restarted host is up. It booted with EMPTY session maps, so the owner
   * of session state gets a chance to re-establish it before any turn is sent.
   */
  private async onReadyAfterRestart(): Promise<void> {
    this.state = 'running';
    if (!this.hasBooted || !this.onHostRestart) return;
    try {
      await this.onHostRestart();
    } catch (err: unknown) {
      this.logger.error(`[HostSupervisor] onHostRestart handler failed: ${String(err)}`);
    }
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
