/**
 * W14 — PTY session wrapper.
 *
 * Wraps one node-pty handle with:
 *   - 5 ms coalescing window (reduces IPC round-trips per token)
 *   - Watermark flow-control: pause above 100k chars unacked, resume below 5k
 *   - Ring-buffer scrollback (last 1000 lines) when xterm-headless unavailable
 */

import type { IPty } from 'node-pty';

/** High-watermark: pause sending when unacked chars exceed this. */
const HIGH_WATERMARK = 100_000;
/** Low-watermark: resume sending when unacked chars fall below this. */
const LOW_WATERMARK = 5_000;
/** Coalescing window before flushing to IPC. */
const COALESCE_MS = 5;
/** Max scrollback lines in the ring buffer. */
const MAX_SCROLLBACK_LINES = 1_000;

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
  /** Whether we are currently paused due to high watermark. */
  private paused = false;

  /** Coalescing buffer. */
  private coalesceBuffer = '';
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ring-buffer scrollback — last MAX_SCROLLBACK_LINES lines. */
  private readonly scrollback: string[] = [];

  constructor(opts: {
    sessionId: string;
    pty: IPty;
    onData: PtyDataCallback;
    onExit: PtyExitCallback;
  }) {
    this.sessionId = opts.sessionId;
    this.pty = opts.pty;
    this.pid = opts.pty.pid;
    this.onData = opts.onData;
    this.onExit = opts.onExit;

    this.pty.onData((raw) => this.handleRawData(raw));
    this.pty.onExit(({ exitCode }) => this.onExit(exitCode ?? null));
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  /** Gateway credited N consumed chars — potentially resume if below low-watermark. */
  creditAck(bytesConsumed: number): void {
    this.unackedChars = Math.max(0, this.unackedChars - bytesConsumed);
    if (this.paused && this.unackedChars < LOW_WATERMARK) {
      this.paused = false;
      this.flush();
    }
  }

  destroy(): void {
    if (this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    try {
      this.pty.kill();
    } catch {
      // Already dead
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private handleRawData(raw: string): void {
    // Accumulate scrollback lines
    const lines = raw.split('\n');
    for (const line of lines) {
      this.scrollback.push(line);
    }
    if (this.scrollback.length > MAX_SCROLLBACK_LINES) {
      this.scrollback.splice(0, this.scrollback.length - MAX_SCROLLBACK_LINES);
    }

    this.coalesceBuffer += raw;

    if (this.paused) return; // Don't schedule flush while paused

    if (this.coalesceTimer === null) {
      this.coalesceTimer = setTimeout(() => this.flush(), COALESCE_MS);
    }
  }

  private flush(): void {
    this.coalesceTimer = null;
    if (this.coalesceBuffer.length === 0) return;
    if (this.paused) return;

    const chunk = this.coalesceBuffer;
    this.coalesceBuffer = '';

    this.unackedChars += chunk.length;
    if (this.unackedChars >= HIGH_WATERMARK) {
      this.paused = true;
    }

    this.onData(chunk);
  }
}
