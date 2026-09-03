/**
 * W14 — PTY session wrapper.
 *
 * Wraps one node-pty handle with:
 *   - 5 ms coalescing window (reduces IPC round-trips per token)
 *   - Credit flow-control: above HIGH_WATERMARK unacked chars the shell is
 *     stopped at the kernel; it resumes once the gateway credits back below
 *     LOW_WATERMARK
 *   - A headless VT model for scrollback (see `HeadlessTerminalModel`)
 *
 * P0-23 (rebuilt). Two independent defects lived here:
 *
 *   1. The high watermark set `paused = true` but never told the PTY to stop
 *      producing. node-pty kept emitting, `handleRawData` kept appending, and
 *      `flush()` refused to drain — so the "backpressure" mechanism was in
 *      fact an unbounded in-memory queue that grew for as long as the command
 *      ran. The plan is explicit that the pause must reach the shell
 *      (`PH->>SH: pause() — kernel backpressure, shell blocks in write()`);
 *      only then does the producer actually slow down.
 *   2. The coalesce buffer was a `+=` string concatenation on the write path —
 *      the exact O(n²) copy the plan forbids ("a chunk array with head
 *      removal, NEVER concatenation on the write path"). It is a chunk array
 *      now, joined once per 5 ms flush.
 *
 * The pause has two independent sources — credit exhaustion (here) and an
 * explicit `pause` request from the gateway (OS-level flow control driven by
 * the session watermark in `TerminalService`). They are tracked separately and
 * ORed: whichever raised the pause, the PTY only resumes once BOTH are clear.
 * Collapsing them into one boolean meant a credit ack could silently undo a
 * gateway-requested pause, and vice versa.
 */

import type { IPty } from 'node-pty';
import { HeadlessTerminalModel } from './HeadlessTerminalModel.js';

/** High-watermark: stop the shell when unacked chars reach this. */
const HIGH_WATERMARK = 100_000;
/** Low-watermark: restart the shell when unacked chars fall below this. */
const LOW_WATERMARK = 5_000;
/** Coalescing window before flushing to IPC. */
const COALESCE_MS = 5;

export type PtyDataCallback = (chunk: string) => void;
export type PtyExitCallback = (code: number | null) => void;

export class PtySession {
  /* W14 */
  readonly sessionId: string;
  readonly pid: number;

  private readonly pty: IPty;
  private readonly onData: PtyDataCallback;
  private readonly onExit: PtyExitCallback;

  /** Unacked chars (sent to gateway but not yet credited back). */
  private unackedChars = 0;
  /** Pause raised because `unackedChars` crossed HIGH_WATERMARK. */
  private creditPaused = false;
  /** Pause raised by an explicit `pause` request from the gateway. */
  private manualPaused = false;
  /** Whether `pty.pause()` is currently in effect — avoids redundant calls. */
  private ptyPaused = false;

  /** Coalescing buffer — chunk array, never a growing concatenation. */
  private coalesceChunks: string[] = [];
  private coalesceLength = 0;
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Headless VT model — bounded O(lines × cols) scrollback. */
  private readonly model: HeadlessTerminalModel;

  constructor(opts: {
    sessionId: string;
    pty: IPty;
    onData: PtyDataCallback;
    onExit: PtyExitCallback;
    cols?: number;
    rows?: number;
    scrollbackLines?: number;
  }) {
    this.sessionId = opts.sessionId;
    this.pty = opts.pty;
    this.pid = opts.pty.pid;
    this.onData = opts.onData;
    this.onExit = opts.onExit;
    this.model = new HeadlessTerminalModel({
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      ...(opts.scrollbackLines !== undefined ? { maxLines: opts.scrollbackLines } : {}),
    });

    this.pty.onData((raw) => this.handleRawData(raw));
    this.pty.onExit(({ exitCode }) => {
      // Drain whatever the shell printed immediately before dying, otherwise
      // the last line of a command's output is lost whenever it lands inside
      // the 5 ms coalescing window. Bypasses the credit gate: the process is
      // gone, so there is nothing left to backpressure.
      this.flush({ force: true });
      this.onExit(exitCode ?? null);
    });
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
    this.model.resize(cols, rows);
  }

  /** Deliver a POSIX signal to the child. node-pty's own `.kill(name)` — best-effort on Windows, which has no POSIX signal delivery and just terminates regardless of `name`. */
  signal(name: string): void {
    this.pty.kill(name);
  }

  /** OS-level flow-control pause requested by the gateway (session watermark). */
  pause(): void {
    this.manualPaused = true;
    this.applyPtyFlowControl();
  }

  /** Clear the gateway-requested pause. A credit pause, if any, still holds. */
  resume(): void {
    this.manualPaused = false;
    this.applyPtyFlowControl();
    this.scheduleFlush();
  }

  /** Gateway credited N consumed chars — resumes the shell below the low watermark. */
  creditAck(bytesConsumed: number): void {
    this.unackedChars = Math.max(0, this.unackedChars - bytesConsumed);
    if (this.creditPaused && this.unackedChars < LOW_WATERMARK) {
      this.creditPaused = false;
      this.applyPtyFlowControl();
      // Bytes the shell had already produced before the kernel pause took
      // effect are still sitting in the coalesce buffer; drain them now, or
      // the last screenful of a flood is stranded until the next data event —
      // and after `pty.pause()` there may never be one.
      this.scheduleFlush();
    }
  }

  /** Rendered scrollback from the headless VT model (W14 replay/revive). */
  scrollbackLines(tailLines = 0): string[] {
    return this.model.lines(tailLines);
  }

  /** True when the real VT parser backs the model rather than the degraded ring. */
  get hasVtModel(): boolean {
    return this.model.vt;
  }

  /** Unacked chars currently outstanding — surfaced for tests and diagnostics. */
  get unacked(): number {
    return this.unackedChars;
  }

  destroy(): void {
    if (this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    this.coalesceChunks = [];
    this.coalesceLength = 0;
    this.model.dispose();
    try {
      this.pty.kill();
    } catch {
      // Already dead
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private handleRawData(raw: string): void {
    // The VT model is the scrollback; it is bounded by construction, so it is
    // fed unconditionally — including while paused, since these bytes were
    // already produced by the shell and dropping them would put the model out
    // of sync with what the client will eventually be sent.
    this.model.write(raw);

    this.coalesceChunks.push(raw);
    this.coalesceLength += raw.length;

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.creditPaused) return; // No credit left — do not send more.
    if (this.coalesceLength === 0) return;
    if (this.coalesceTimer !== null) return;
    this.coalesceTimer = setTimeout(() => this.flush(), COALESCE_MS);
  }

  private flush(opts?: { force: boolean }): void {
    if (this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    if (this.coalesceLength === 0) return;
    if (this.creditPaused && !opts?.force) return;

    // One join per flush, not one concatenation per data event.
    const chunk = this.coalesceChunks.join('');
    this.coalesceChunks = [];
    this.coalesceLength = 0;

    this.unackedChars += chunk.length;
    if (!this.creditPaused && this.unackedChars >= HIGH_WATERMARK) {
      this.creditPaused = true;
      this.applyPtyFlowControl();
    }

    this.onData(chunk);
  }

  /**
   * Single point that touches `pty.pause()`/`pty.resume()`. node-pty's pause
   * is not refcounted, so calling `resume()` while another source still wants
   * the stream stopped would silently defeat that source's backpressure.
   */
  private applyPtyFlowControl(): void {
    const shouldPause = this.creditPaused || this.manualPaused;
    if (shouldPause === this.ptyPaused) return;
    this.ptyPaused = shouldPause;
    try {
      if (shouldPause) this.pty.pause();
      else this.pty.resume();
    } catch {
      // A PTY that has already exited throws here on some platforms; the
      // session is about to be torn down either way.
      this.ptyPaused = false;
    }
  }
}
