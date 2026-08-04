// ────────────────────────────────────────────────────────────────
// TerminalService — Integrated Terminal lifecycle + event emission.
//
// Ephemeral, in-memory session store keyed by workspaceId. Server restart
// clears everything (matches Browser session semantics). Consumed by:
//   • apps/server/src/routes/terminals.ts   (REST)
//   • apps/server/src/terminal-ws.ts        (WS transport)
//
// Emits `terminal.*` events on the unified EventBus using a synthetic
// session id `terminal:<workspaceId>` so the SPA can subscribe with
// `/api/stream?scope=session&id=terminal:<workspaceId>` — same shape as
// browser events.
//
// Owns:
//   • ITerminalHost implementations chain (node-pty → sandbox → fallback)
//   • Per-session output ring buffer (~10k lines / ~4 MB) for reconnect
//     replay via GET .../scrollback
//   • Per-workspace concurrency cap (default 5) + global cap (default 20)
//   • Idle reaper — session with no attached WS and no activity for TTL_MS
//     is killed and reaped.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { ILogger, TerminalHostKind, TerminalSessionDescriptor } from '@generatorai/shared';
import type { AgentEvent } from '@generatorai/shared';
import type { EventBus } from '../events/EventBus.js';
import type { ITerminalHost, ITerminalHandle, TerminalSpawnOptions } from '../domain/ports/ITerminalHost.js';

/** Config knobs — envs override at composition-root wiring time. */
export interface TerminalServiceConfig {
  /** Max concurrent sessions per workspace. Default 5. */
  maxPerWorkspace?: number;
  /** Global concurrent-session cap. Default 20. */
  maxGlobal?: number;
  /** Idle TTL — session with no WS + no activity for this long is killed. Default 30 min. */
  idleTtlMs?: number;
  /** Idle reaper tick period. Default 60 s. */
  idleReaperMs?: number;
  /**
   * Per-session output ring buffer size in bytes. Older bytes are dropped.
   * Default 4 MiB (~10 000 lines of typical shell output).
   */
  scrollbackBytes?: number;
  /**
   * Synthetic EventBus session id prefix. Emitted events land on
   * `${prefix}:${workspaceId}` — SPA subscribes to that channel.
   */
  eventBusScopePrefix?: string;
}

/** Per-session in-memory record. */
interface TerminalRecord {
  workspaceId: string;
  handle: ITerminalHandle;
  scrollback: Buffer;
  /** Detach listeners on kill. */
  detachData: () => void;
  detachExit: () => void;
  /** Count of currently attached WebSocket clients. */
  wsCount: number;
  /** Epoch-ms of last activity (input/output/resize/ack). */
  lastActivityAt: number;
  /** True once the PTY has exited — record kept briefly for replay then dropped. */
  exited: boolean;
  /** Reason string kept for `terminal.session_closed.reason`. */
  closeReason?: string;
}

export class TerminalService {
  private sessions = new Map<string, TerminalRecord>();
  private readonly cfg: Required<TerminalServiceConfig>;
  private readonly hosts: ITerminalHost[];
  private idleTimer: NodeJS.Timeout | null = null;

  /**
   * `resolveCwd` and `resolveEnv` are provided by the composition root so
   * the service stays decoupled from `WorkspaceManager`. They MUST return
   * an absolute, existing path — TerminalService will spawn there.
   */
  constructor(
    hosts: ITerminalHost[],
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    private readonly resolveCwd: (workspaceId: string) => Promise<string | null>,
    config?: TerminalServiceConfig,
  ) {
    if (hosts.length === 0) {
      throw new Error('[TerminalService] Requires at least one ITerminalHost');
    }
    this.hosts = hosts;
    this.cfg = {
      maxPerWorkspace: config?.maxPerWorkspace ?? Number(process.env['GENERATORAI_TERMINAL_MAX_PER_WORKSPACE'] ?? '5'),
      maxGlobal: config?.maxGlobal ?? Number(process.env['GENERATORAI_TERMINAL_MAX_GLOBAL'] ?? '20'),
      idleTtlMs: config?.idleTtlMs ?? Number(process.env['GENERATORAI_TERMINAL_IDLE_TTL_MS'] ?? String(30 * 60 * 1000)),
      idleReaperMs: config?.idleReaperMs ?? Number(process.env['GENERATORAI_TERMINAL_IDLE_REAPER_MS'] ?? '60000'),
      scrollbackBytes: config?.scrollbackBytes ?? Number(process.env['GENERATORAI_TERMINAL_SCROLLBACK_BYTES'] ?? String(4 * 1024 * 1024)),
      eventBusScopePrefix: config?.eventBusScopePrefix ?? 'terminal',
    };
  }

  /** Boot the idle reaper. Idempotent. */
  start(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.reapIdle(), this.cfg.idleReaperMs);
    // Node's unref lets the process exit even when the timer is pending.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.idleTimer as any).unref?.();
  }

  /** Kill everything + stop the reaper. Called from container.shutdown. */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    for (const rec of this.sessions.values()) {
      try { rec.handle.kill(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }

  /**
   * Kill every session belonging to `workspaceId`. Called from
   * WorkspaceManager.deleteWorkspace so PTYs aren't orphaned.
   */
  async killAllForWorkspace(workspaceId: string, reason = 'workspace_deleted'): Promise<void> {
    const victims: string[] = [];
    for (const [sid, rec] of this.sessions) {
      if (rec.workspaceId === workspaceId) victims.push(sid);
    }
    for (const sid of victims) {
      await this.kill(sid, reason);
    }
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Spawn a new PTY for `workspaceId`. Enforces the per-workspace + global
   * caps; emits `terminal.session_created`.
   */
  async spawn(params: {
    workspaceId: string;
    cols?: number;
    rows?: number;
    shell?: string;
    attachToSandbox?: boolean;
    runId?: string;
  }): Promise<TerminalSessionDescriptor> {
    // Cap enforcement.
    if (this.sessions.size >= this.cfg.maxGlobal) {
      throw new Error(`Terminal spawn refused — server cap (${this.cfg.maxGlobal}) reached`);
    }
    let wsCount = 0;
    for (const r of this.sessions.values()) {
      if (r.workspaceId === params.workspaceId && !r.exited) wsCount++;
    }
    if (wsCount >= this.cfg.maxPerWorkspace) {
      throw new Error(
        `Terminal spawn refused — workspace cap (${this.cfg.maxPerWorkspace}) reached`,
      );
    }

    const cwd = await this.resolveCwd(params.workspaceId);
    if (!cwd) throw new Error(`Workspace not found or has no rootPath: ${params.workspaceId}`);

    // Host selection: try in order, first available wins.
    const host = this.hosts.find((h) => h.isAvailable());
    if (!host) throw new Error('[TerminalService] No available terminal host on this platform');

    const cols = Math.max(1, Math.min(500, Math.floor(params.cols ?? 80)));
    const rows = Math.max(1, Math.min(200, Math.floor(params.rows ?? 24)));

    const spawnOpts: TerminalSpawnOptions = {
      workspaceId: params.workspaceId,
      cwd,
      cols,
      rows,
      ...(params.shell ? { shell: params.shell } : {}),
      ...(params.attachToSandbox ? { attachToSandbox: true } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
    };
    const handle = await host.spawn(spawnOpts);

    const rec: TerminalRecord = {
      workspaceId: params.workspaceId,
      handle,
      scrollback: Buffer.alloc(0),
      detachData: () => undefined,
      detachExit: () => undefined,
      wsCount: 0,
      lastActivityAt: Date.now(),
      exited: false,
    };

    rec.detachData = handle.onData((chunk) => {
      rec.lastActivityAt = Date.now();
      // Append to scrollback ring, trimming from the head if it grows too large.
      const next = Buffer.concat([rec.scrollback, chunk]);
      if (next.length > this.cfg.scrollbackBytes) {
        rec.scrollback = next.subarray(next.length - this.cfg.scrollbackBytes);
      } else {
        rec.scrollback = next;
      }
    });

    rec.detachExit = handle.onExit((info) => {
      rec.exited = true;
      rec.lastActivityAt = Date.now();
      void this.emit(params.workspaceId, {
        kind: 'terminal.session_closed',
        data: {
          workspaceId: params.workspaceId,
          sessionId: handle.id,
          code: info.code,
          ...(info.signal ? { signal: info.signal } : {}),
          ...(rec.closeReason ? { reason: rec.closeReason } : {}),
        },
      });
    });

    this.sessions.set(handle.id, rec);

    const descriptor = this.describe(handle.id);
    await this.emit(params.workspaceId, {
      kind: 'terminal.session_created',
      data: {
        workspaceId: params.workspaceId,
        sessionId: handle.id,
        host: handle.host,
        pid: handle.pid,
        cwd: handle.cwd,
        shell: handle.shell,
      },
    });

    this.logger.info?.(
      `[TerminalService] Spawned ${handle.host} sid=${handle.id} pid=${handle.pid ?? 'n/a'} cwd=${handle.cwd}`,
    );
    return descriptor!;
  }

  /** List sessions for a workspace. Exited sessions are excluded. */
  list(workspaceId: string): TerminalSessionDescriptor[] {
    const out: TerminalSessionDescriptor[] = [];
    for (const rec of this.sessions.values()) {
      if (rec.workspaceId !== workspaceId || rec.exited) continue;
      const d = this.describe(rec.handle.id);
      if (d) out.push(d);
    }
    return out;
  }

  /** Look up a session. */
  describe(sessionId: string): TerminalSessionDescriptor | null {
    const rec = this.sessions.get(sessionId);
    if (!rec) return null;
    const h = rec.handle;
    return {
      id: h.id,
      workspaceId: h.workspaceId,
      pid: h.pid,
      cwd: h.cwd,
      cols: h.cols,
      rows: h.rows,
      host: h.host,
      shell: h.shell,
      exitCode: h.exitCode,
      ...(h.exitSignal ? { exitSignal: h.exitSignal } : {}),
      createdAt: h.createdAt,
      lastActivityAt: rec.lastActivityAt,
    };
  }

  /** Kill a session. Idempotent. */
  async kill(sessionId: string, reason = 'user'): Promise<void> {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    rec.closeReason = reason;
    try { rec.handle.kill(); } catch { /* ignore */ }
    // exit event fires on the handle → onExit callback above emits SSE.
    // Give it a tick to drain, then drop the record.
    setTimeout(() => {
      const r = this.sessions.get(sessionId);
      if (!r) return;
      r.detachData();
      r.detachExit();
      this.sessions.delete(sessionId);
    }, 250);
  }

  /**
   * Send raw input into the PTY. Called from the WS handler.
   */
  input(sessionId: string, data: string): boolean {
    const rec = this.sessions.get(sessionId);
    if (!rec || rec.exited) return false;
    rec.lastActivityAt = Date.now();
    try {
      rec.handle.write(data);
      return true;
    } catch (err) {
      this.logger.warn?.(
        `[TerminalService] input write failed sid=${sessionId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Resize the PTY. Emits `terminal.session_resized`. */
  async resize(sessionId: string, cols: number, rows: number): Promise<boolean> {
    const rec = this.sessions.get(sessionId);
    if (!rec || rec.exited) return false;
    const c = Math.max(1, Math.min(500, Math.floor(cols)));
    const r = Math.max(1, Math.min(200, Math.floor(rows)));
    try {
      rec.handle.resize(c, r);
      rec.lastActivityAt = Date.now();
    } catch (err) {
      this.logger.warn?.(
        `[TerminalService] resize failed sid=${sessionId}: ${(err as Error).message}`,
      );
      return false;
    }
    await this.emit(rec.workspaceId, {
      kind: 'terminal.session_resized',
      data: { workspaceId: rec.workspaceId, sessionId, cols: c, rows: r },
    });
    return true;
  }

  /** Deliver a POSIX signal. */
  signal(sessionId: string, name: string): boolean {
    const rec = this.sessions.get(sessionId);
    if (!rec || rec.exited) return false;
    try {
      rec.handle.signal(name);
      rec.lastActivityAt = Date.now();
      return true;
    } catch (err) {
      this.logger.warn?.(
        `[TerminalService] signal failed sid=${sessionId} name=${name}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Return the tail of the scrollback buffer for replay on WS reconnect.
   * `tailBytes` clamps the response — `0` means "everything currently
   * buffered".
   */
  scrollback(sessionId: string, tailBytes = 0): Buffer {
    const rec = this.sessions.get(sessionId);
    if (!rec) return Buffer.alloc(0);
    if (tailBytes <= 0 || tailBytes >= rec.scrollback.length) return rec.scrollback;
    return rec.scrollback.subarray(rec.scrollback.length - tailBytes);
  }

  // ── WS attach hooks (called from terminal-ws.ts) ──────────────

  /** Register a WS client. Increments wsCount for idle-reaper accounting. */
  onWsAttach(sessionId: string): TerminalRecord | null {
    const rec = this.sessions.get(sessionId);
    if (!rec) return null;
    rec.wsCount += 1;
    rec.lastActivityAt = Date.now();
    return rec;
  }

  /** Detach a WS client. */
  onWsDetach(sessionId: string): void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    rec.wsCount = Math.max(0, rec.wsCount - 1);
    rec.lastActivityAt = Date.now();
  }

  /**
   * Subscribe to raw PTY output. Used by the WS layer to forward frames
   * to the client. Returns an unsubscribe function.
   */
  subscribeOutput(sessionId: string, cb: (chunk: Buffer) => void): () => void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return () => undefined;
    return rec.handle.onData((chunk) => {
      rec.lastActivityAt = Date.now();
      cb(chunk);
    });
  }

  subscribeExit(
    sessionId: string,
    cb: (info: { code: number; signal?: string }) => void,
  ): () => void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return () => undefined;
    return rec.handle.onExit(cb);
  }

  /** OS-level flow control — plumbed through from the WS watermark logic. */
  pause(sessionId: string): void {
    this.sessions.get(sessionId)?.handle.pause();
  }
  resume(sessionId: string): void {
    this.sessions.get(sessionId)?.handle.resume();
  }

  // ── Internal ──────────────────────────────────────────────────

  private reapIdle(): void {
    const now = Date.now();
    for (const [sid, rec] of this.sessions) {
      // Drop exited records after 5 minutes so late reconnects can still
      // fetch the terminal.session_closed via SSE replay.
      if (rec.exited && now - rec.lastActivityAt > 5 * 60 * 1000) {
        rec.detachData();
        rec.detachExit();
        this.sessions.delete(sid);
        continue;
      }
      if (rec.exited) continue;
      if (rec.wsCount > 0) continue;
      if (now - rec.lastActivityAt < this.cfg.idleTtlMs) continue;
      this.logger.info?.(
        `[TerminalService] Reaping idle sid=${sid} workspace=${rec.workspaceId}`,
      );
      rec.closeReason = 'idle_timeout';
      try { rec.handle.kill(); } catch { /* ignore */ }
    }
  }

  private async emit(workspaceId: string, event: AgentEvent): Promise<void> {
    try {
      const scopeSession = `${this.cfg.eventBusScopePrefix}:${workspaceId}`;
      await this.eventBus.emit(scopeSession, event);
    } catch (err) {
      this.logger.warn?.(
        `[TerminalService] emit failed workspace=${workspaceId}: ${(err as Error).message}`,
      );
    }
  }
}

/** Re-export for consumer convenience. */
export type { TerminalHostKind };
