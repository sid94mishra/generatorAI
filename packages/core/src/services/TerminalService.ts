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

import { readBoundedInt, recordFallback } from '@generatorai/shared';
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
  /**
   * P1-28 session watermark — pause the PTY once this many bytes are emitted
   * but unacknowledged by the slowest attached viewer. Default 256 KiB.
   */
  highWatermarkBytes?: number;
  /**
   * Resume once outstanding bytes fall to this. Default 64 KiB.
   *
   * MUST be >= the client's ack batch size, or the last partial batch of a
   * flood is never acked and the session stays paused forever. `apps/web`
   * batches at 64 KiB.
   */
  lowWatermarkBytes?: number;
}

/**
 * P0-23: Ring buffer for PTY scrollback. Stores raw Buffer chunks in an array
 * instead of rebuilding a single concatenated Buffer on every data event.
 * Maintains a running `totalBytes` counter and trims from the head once
 * `maxBytes` is reached. `toBuffer()` concatenates on demand (replay only).
 */
class ChunkArray {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    // Trim from head while over budget.
    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      const oldest = this.chunks.shift()!;
      this.totalBytes -= oldest.length;
    }
  }

  /** Materialise all chunks into a single Buffer (used for scrollback replay). */
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  get byteLength(): number {
    return this.totalBytes;
  }
}

/**
 * P1-28 — the terminal watermark, owned by the SESSION rather than by a
 * WebSocket connection.
 *
 * `terminal-ws.ts` used to keep `unackedBytes`/`paused` per socket and act on
 * the SHARED PTY through `terminalService.pause/resume(sessionId)`. With two
 * viewers attached that is not a watermark at all: viewer A crossing its high
 * mark paused the PTY for everyone, viewer B's next ack — accounting for a
 * completely different byte range — resumed it, and the two oscillated against
 * each other while neither one's bound was actually enforced.
 *
 * The session tracks one monotonic `emitted` cursor and one acknowledged
 * cursor per viewer. Outstanding work is `emitted - min(acked)`: the SLOWEST
 * attached viewer governs, which is the only answer that bounds every viewer's
 * backlog with one shared producer. A viewer that attaches mid-stream starts
 * caught up (it is not responsible for bytes sent before it arrived), and a
 * viewer that leaves stops holding the session back.
 *
 * Acks are counted at PARSE completion, not on receipt: the client calls back
 * from inside `term.write(bytes, cb)`, so credit reflects what the terminal has
 * actually rendered rather than what TCP happened to deliver (W14).
 *
 * Separately from this, `TerminalService` credits the pty-host for every chunk
 * the moment it takes it — see `creditHost` in `spawn()`. That is a different
 * loop with a different question ("has the gateway taken these bytes off the
 * host's hands"), and it deliberately does NOT wait for a viewer: the host's
 * low watermark (5 000 chars) is far below the client's ack batch size (64 KiB),
 * so chaining the two would wedge a terminal on the residual bytes of the last
 * partial ack batch — the same permanent freeze P0-23 is about, just relocated.
 */
class SessionFlowControl {
  /** Total bytes the session has produced since spawn. Monotonic. */
  private emitted = 0;
  /** Per-viewer acknowledged cursor, in the same units as `emitted`. */
  private readonly viewers = new Map<object, { acked: number; stalled: boolean }>();
  private paused = false;

  constructor(
    private readonly high: number,
    private readonly low: number,
    private readonly onPause: () => void,
    private readonly onResume: () => void,
  ) {}

  attach(token: object): void {
    // Start at `emitted`, not 0 — a viewer that joins a session which has
    // already printed a gigabyte must not instantly pin it at the high mark.
    this.viewers.set(token, { acked: this.emitted, stalled: false });
  }

  detach(token: object): void {
    this.viewers.delete(token);
    this.reconcile();
  }

  onOutput(byteLength: number): void {
    this.emitted += byteLength;
    this.reconcile();
  }

  ack(token: object, bytes: number): void {
    const v = this.viewers.get(token);
    if (!v || bytes <= 0) return;
    // Clamped at `emitted`: a buggy or hostile client cannot ack its way past
    // what was actually sent and thereby disable the watermark.
    v.acked = Math.min(this.emitted, v.acked + bytes);
    this.reconcile();
  }

  /**
   * A viewer whose socket send buffer has blown past the circuit breaker is
   * not making progress even if it is still acking older bytes. Pin the
   * session paused until it drains.
   */
  setStalled(token: object, stalled: boolean): void {
    const v = this.viewers.get(token);
    if (!v || v.stalled === stalled) return;
    v.stalled = stalled;
    this.reconcile();
  }

  /** Bytes emitted but not yet acknowledged by the slowest attached viewer. */
  get outstanding(): number {
    if (this.viewers.size === 0) return 0; // Nobody to wait for.
    let min = this.emitted;
    for (const v of this.viewers.values()) if (v.acked < min) min = v.acked;
    return this.emitted - min;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Release any pause and forget every viewer — used when the PTY exits. */
  reset(): void {
    this.viewers.clear();
    this.paused = false;
  }

  private reconcile(): void {
    const stalled = [...this.viewers.values()].some((v) => v.stalled);
    const outstanding = this.outstanding;
    if (!this.paused && (stalled || outstanding >= this.high)) {
      this.paused = true;
      this.onPause();
      return;
    }
    if (this.paused && !stalled && outstanding <= this.low) {
      this.paused = false;
      this.onResume();
    }
  }
}

/**
 * Handle a WebSocket connection holds for the lifetime of its attachment.
 * Everything a viewer can do to the shared session's flow control goes
 * through this object, so the transport never needs its own counters.
 */
export interface TerminalViewer {
  /** Credit bytes the client has finished PARSING (not merely received). */
  ack(bytes: number): void;
  /** Declare the viewer's own send buffer over/under its circuit breaker. */
  setStalled(stalled: boolean): void;
  /** Detach; releases whatever backpressure this viewer was contributing. */
  detach(): void;
}

/** Per-session in-memory record. */
interface TerminalRecord {
  workspaceId: string;
  handle: ITerminalHandle;
  /** P0-23: chunk-array ring instead of a re-concatenated flat Buffer. */
  scrollback: ChunkArray;
  /** Detach listeners on kill. */
  detachData: () => void;
  detachExit: () => void;
  /** Count of currently attached WebSocket clients. */
  wsCount: number;
  /**
   * P1-38: Epoch-ms of last CLIENT activity (WS attach/detach, resize, ack,
   * input).  No longer bumped on PTY output — output is not a signal that a
   * human is present, so the idle reaper was kept alive by a process printing
   * to a terminal that nobody was watching.
   */
  lastActivityAt: number;
  /** True once the PTY has exited — record kept briefly for replay then dropped. */
  exited: boolean;
  /** Reason string kept for `terminal.session_closed.reason`. */
  closeReason?: string;
  /** P1-28: session-owned watermark, shared by every attached viewer. */
  flow: SessionFlowControl;
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
    // Read through `readBoundedInt`, not a bare `Number()`. A typo'd value
    // produced `NaN`, and NaN is dangerous differently in each of these
    // fields: as a cap it makes every `>=` comparison false (the bound
    // silently disappears), and as an interval Node coerces it to 1 ms, so
    // `GENERATORAI_TERMINAL_IDLE_REAPER_MS=6O000` (letter O) turns the idle
    // reaper into a busy loop. Neither logs anything.
    this.cfg = {
      maxPerWorkspace:
        config?.maxPerWorkspace ??
        readBoundedInt('GENERATORAI_TERMINAL_MAX_PER_WORKSPACE', { defaultValue: 5, min: 1, max: 100 }),
      maxGlobal:
        config?.maxGlobal ??
        readBoundedInt('GENERATORAI_TERMINAL_MAX_GLOBAL', { defaultValue: 20, min: 1, max: 500 }),
      idleTtlMs:
        config?.idleTtlMs ??
        readBoundedInt('GENERATORAI_TERMINAL_IDLE_TTL_MS', {
          defaultValue: 30 * 60 * 1000,
          min: 10_000,
          max: 24 * 60 * 60 * 1000,
        }),
      idleReaperMs:
        config?.idleReaperMs ??
        readBoundedInt('GENERATORAI_TERMINAL_IDLE_REAPER_MS', {
          defaultValue: 60_000,
          // A floor well above 1 ms is the actual protection here.
          min: 1_000,
          max: 60 * 60 * 1000,
        }),
      scrollbackBytes:
        config?.scrollbackBytes ??
        readBoundedInt('GENERATORAI_TERMINAL_SCROLLBACK_BYTES', {
          defaultValue: 4 * 1024 * 1024,
          min: 64 * 1024,
          max: 64 * 1024 * 1024,
        }),
      eventBusScopePrefix: config?.eventBusScopePrefix ?? 'terminal',
      highWatermarkBytes:
        config?.highWatermarkBytes ??
        readBoundedInt('GENERATORAI_TERMINAL_HIGH_WATERMARK_BYTES', {
          defaultValue: 256 * 1024,
          min: 16 * 1024,
          max: 16 * 1024 * 1024,
        }),
      lowWatermarkBytes:
        config?.lowWatermarkBytes ??
        readBoundedInt('GENERATORAI_TERMINAL_LOW_WATERMARK_BYTES', {
          defaultValue: 64 * 1024,
          min: 4 * 1024,
          max: 8 * 1024 * 1024,
        }),
    };
    // An inverted pair silently disables the watermark — the pause would fire
    // and the resume condition would already hold — so clamp rather than trust
    // two independently-configured envs.
    if (this.cfg.lowWatermarkBytes >= this.cfg.highWatermarkBytes) {
      const low = Math.max(1, Math.floor(this.cfg.highWatermarkBytes / 4));
      this.logger.warn?.(
        `[TerminalService] lowWatermarkBytes (${this.cfg.lowWatermarkBytes}) >= highWatermarkBytes ` +
          `(${this.cfg.highWatermarkBytes}) — clamping low to ${low}`,
      );
      this.cfg.lowWatermarkBytes = low;
    }
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
    // Cap enforcement. Both caps count LIVE sessions only.
    //
    // P1-38: the global cap used `this.sessions.size`, which includes exited
    // records — those are retained for 5 minutes so a late reconnect can still
    // replay `terminal.session_closed`. Twenty corpses therefore refused every
    // spawn on the whole server for five minutes, while the per-workspace cap
    // right below already filtered them correctly.
    let liveGlobal = 0;
    let wsCount = 0;
    for (const r of this.sessions.values()) {
      if (r.exited) continue;
      liveGlobal++;
      if (r.workspaceId === params.workspaceId) wsCount++;
    }
    if (liveGlobal >= this.cfg.maxGlobal) {
      throw new Error(`Terminal spawn refused — server cap (${this.cfg.maxGlobal}) reached`);
    }
    if (wsCount >= this.cfg.maxPerWorkspace) {
      throw new Error(
        `Terminal spawn refused — workspace cap (${this.cfg.maxPerWorkspace}) reached`,
      );
    }

    const cwd = await this.resolveCwd(params.workspaceId);
    if (!cwd) throw new Error(`Workspace not found or has no rootPath: ${params.workspaceId}`);

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

    const host = await this.selectHost(spawnOpts);
    if (!host) throw new Error('[TerminalService] No available terminal host on this platform');

    // §11.1 — landing on a degraded host is silent otherwise: the terminal
    // opens and works, it just has no TTY (so no vim, no colour, no cursor
    // addressing) or has lost the process isolation the pty host provides.
    // Counting it is the difference between "users report flaky terminals"
    // and "node-pty failed to load on this box".
    if (host.kind === 'fallback-child-process') {
      recordFallback('terminal_child_process_host');
    } else if (host.kind === 'node-pty' && this.hosts.some((h) => h.kind === 'pty-host')) {
      // A pty-host was configured but was not the one chosen.
      recordFallback('terminal_in_process_host');
    }

    const handle = await host.spawn(spawnOpts);

    const rec: TerminalRecord = {
      workspaceId: params.workspaceId,
      handle,
      // P0-23: ChunkArray avoids O(n²) Buffer.concat on every data event.
      scrollback: new ChunkArray(this.cfg.scrollbackBytes),
      detachData: () => undefined,
      detachExit: () => undefined,
      wsCount: 0,
      lastActivityAt: Date.now(),
      exited: false,
      flow: new SessionFlowControl(
        this.cfg.highWatermarkBytes,
        this.cfg.lowWatermarkBytes,
        () => {
          this.logger.debug?.(`[TerminalService] watermark pause sid=${handle.id}`);
          try { handle.pause(); } catch { /* PTY already gone */ }
        },
        () => {
          this.logger.debug?.(`[TerminalService] watermark resume sid=${handle.id}`);
          try { handle.resume(); } catch { /* PTY already gone */ }
        },
      ),
    };

    rec.detachData = handle.onData((chunk) => {
      // P1-38: Do NOT bump lastActivityAt on PTY output — idle reaper should
      // fire when no client is attached, not when the process is printing.
      rec.scrollback.append(chunk);
      rec.flow.onOutput(chunk.length);
      // P0-23 (rebuilt): return credit to an out-of-process host the moment
      // the gateway has taken the bytes. `PtyHostClient.ack()` had no caller
      // at all, so `PtySession`'s credit counter only ever climbed and any
      // command printing past its 100 000-char high watermark froze that
      // terminal permanently. Crediting here — rather than waiting on a
      // viewer — is deliberate: see `SessionFlowControl`'s header for why
      // chaining the two loops re-creates the freeze on the tail of the last
      // partial ack batch. Client backpressure is carried by the session
      // watermark above, which reaches the shell as a real `pause`.
      rec.handle.ack?.(chunk.length);
    });

    rec.detachExit = handle.onExit((info) => {
      rec.exited = true;
      rec.lastActivityAt = Date.now();
      // A dead PTY cannot be resumed, and a session left `paused` would hold
      // a stale flag that the idle reaper's corpse-drop path never clears.
      rec.flow.reset();
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
    // Materialise the chunk array only when a caller actually needs it.
    const buf = rec.scrollback.toBuffer();
    if (tailBytes <= 0 || tailBytes >= buf.length) return buf;
    return buf.subarray(buf.length - tailBytes);
  }

  /**
   * Rendered scrollback from the host's headless VT model, when the host has
   * one (W14 — only the out-of-process pty-host does). Bounded at
   * O(lines × columns), unlike `scrollback()`'s raw byte ring.
   *
   * Returns `null` when the session is unknown or its host keeps no VT model,
   * so callers can tell "no such thing here" from "an empty terminal".
   */
  async scrollbackText(sessionId: string, tailLines = 0): Promise<string[] | null> {
    const rec = this.sessions.get(sessionId);
    if (!rec?.handle.scrollbackLines) return null;
    try {
      return await rec.handle.scrollbackLines(tailLines);
    } catch (err) {
      this.logger.warn?.(
        `[TerminalService] scrollbackText failed sid=${sessionId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── WS attach hooks (called from terminal-ws.ts) ──────────────

  /**
   * Register a WS client and hand it back the only flow-control surface it
   * needs (P1-28). Replaces the old `onWsAttach`/`onWsDetach` +
   * `pause`/`resume` quartet: the transport used to own the counters and act
   * on the shared PTY, which is exactly what made two viewers fight.
   *
   * Returns `null` for an unknown session.
   */
  attachViewer(sessionId: string): TerminalViewer | null {
    const rec = this.sessions.get(sessionId);
    if (!rec) return null;
    rec.wsCount += 1;
    rec.lastActivityAt = Date.now();

    // Identity token — the viewer's own key into the session's ack table. An
    // object reference, not the session id, because several viewers share one
    // session and each needs its own cursor.
    const token = {};
    rec.flow.attach(token);
    let detached = false;

    return {
      ack: (bytes: number) => {
        if (detached) return;
        rec.lastActivityAt = Date.now();
        rec.flow.ack(token, bytes);
      },
      setStalled: (stalled: boolean) => {
        if (detached) return;
        rec.flow.setStalled(token, stalled);
      },
      detach: () => {
        if (detached) return;
        detached = true;
        rec.wsCount = Math.max(0, rec.wsCount - 1);
        rec.lastActivityAt = Date.now();
        rec.flow.detach(token);
      },
    };
  }

  /**
   * Subscribe to raw PTY output. Used by the WS layer to forward frames
   * to the client. Returns an unsubscribe function.
   */
  subscribeOutput(sessionId: string, cb: (chunk: Buffer) => void): () => void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return () => undefined;
    // P1-38: lastActivityAt is NOT bumped on PTY output. Idle reaper checks
    // wsCount first (skips if any client is attached), so bumping here served
    // no purpose and kept dead-corpse sessions alive indefinitely.
    return rec.handle.onData((chunk) => cb(chunk));
  }

  subscribeExit(
    sessionId: string,
    cb: (info: { code: number; signal?: string }) => void,
  ): () => void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return () => undefined;
    return rec.handle.onExit(cb);
  }

  /**
   * Flow-control state for a session — diagnostics and tests. There is no
   * public `pause`/`resume` any more: the session's own watermark is the only
   * thing allowed to stop and start the shared PTY (P1-28).
   */
  flowState(sessionId: string): { paused: boolean; outstanding: number; viewers: number } | null {
    const rec = this.sessions.get(sessionId);
    if (!rec) return null;
    return { paused: rec.flow.isPaused, outstanding: rec.flow.outstanding, viewers: rec.flow.viewerCount };
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Pick the host for this spawn.
   *
   * Two defects lived in the one-line `this.hosts.find(h => h.isAvailable())`
   * this replaces:
   *
   *   • `SandboxPtyHost` sits first and reports available whenever docker is
   *     on PATH, but throws from `spawn()` unless `attachToSandbox` was asked
   *     for — so on a developer machine with docker installed, every ordinary
   *     terminal was routed to it and failed. `canServe()` is the per-spawn
   *     gate that was missing.
   *   • Hosts that start asynchronously (the out-of-process pty-host) report
   *     unavailable until their child process answers, and boot kicks that off
   *     fire-and-forget. Terminals opened in the first few hundred ms therefore
   *     silently landed on the in-process `NodePtyHost` while later ones landed
   *     on the pty host — one pool, two hosts, decided by timing. Awaiting an
   *     in-flight start before dropping to a lower-priority host removes the
   *     race; `whenReady()` never rejects, so a genuinely failed start still
   *     falls through instead of failing the spawn.
   */
  private async selectHost(opts: TerminalSpawnOptions): Promise<ITerminalHost | undefined> {
    for (const host of this.hosts) {
      if (host.canServe && !host.canServe(opts)) continue;
      if (host.isAvailable()) return host;
      if (host.whenReady) {
        await host.whenReady();
        if (host.isAvailable()) return host;
      }
    }
    return undefined;
  }

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
