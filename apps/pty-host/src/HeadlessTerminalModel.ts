/**
 * W14 — headless VT model.
 *
 * `PtySession` previously kept a `string[]` of raw output fragments. Nothing
 * ever read it, and it was not a terminal model at all: a fragment is not a
 * line. One write can carry half a line, a cursor-addressing sequence, or a
 * full-screen repaint, so `split('\n')` produced entries whose COUNT was
 * capped while each entry's LENGTH stayed unbounded — a `yes`-style flood
 * with no newlines grew one entry forever. That is the copy-storm shape
 * P0-23 exists to prevent, not a bound on it.
 *
 * `xterm-headless` runs the same VT parser the browser client runs, so what
 * we replay is what the user would actually have seen, at the plan's required
 * cost of O(lines × columns) rather than O(bytes ever written).
 *
 * It is declared as an `optionalDependency`, so it genuinely may be absent
 * (`--no-optional`, a platform install failure). The fallback below is a
 * bounded line ring: degraded — no cursor addressing, no alt-screen, control
 * sequences stripped rather than interpreted — but still bounded, which is
 * the property that matters. A terminal whose memory silently grows without
 * limit is worse than one whose scrollback is approximate.
 */

import { createRequire } from 'node:module';

/** Default scrollback depth held by the model. */
export const DEFAULT_SCROLLBACK_LINES = 1_000;

/** Hard cap on a single line's length in the fallback ring — see file header. */
const FALLBACK_MAX_LINE_CHARS = 4_096;

/**
 * ESC and BEL are built with `String.fromCharCode` rather than written as
 * literal control bytes: a raw ESC inside a regex literal is invisible in a
 * diff, breaks grep, and is mangled by editors that normalise control
 * characters.
 *
 * Covers OSC (terminated by BEL or ST), CSI, and two-character escapes —
 * enough that a shell prompt replays as text instead of as garbage.
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ESCAPE_SEQUENCE_RE = new RegExp(
  [
    `${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)`, // OSC … (BEL | ST)
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,               // CSI
    `${ESC}[@-Z\\\\-_]`,                        // two-character escape
  ].join('|'),
  'g',
);

interface HeadlessTerminalCtor {
  new (opts: { cols: number; rows: number; scrollback: number; allowProposedApi: boolean }): {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    dispose(): void;
    readonly buffer: {
      readonly active: {
        readonly length: number;
        getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
      };
    };
  };
}

/**
 * Resolved once per process, not per session — the module load is the
 * expensive part and a host owns many sessions. `null` means "tried and
 * unavailable"; `undefined` means "not tried yet", so a missing package is
 * not re-resolved on every spawn.
 */
let cachedCtor: HeadlessTerminalCtor | null | undefined;

function loadHeadlessTerminal(): HeadlessTerminalCtor | null {
  if (cachedCtor !== undefined) return cachedCtor;
  try {
    // `xterm-headless` ships CommonJS, so `createRequire` is the correct
    // loader here — a dynamic `import()` would be async, and `PtySession`'s
    // constructor is synchronous by contract with the IPC handler.
    const require = createRequire(import.meta.url);
    const mod = require('xterm-headless') as {
      Terminal?: HeadlessTerminalCtor;
      default?: { Terminal?: HeadlessTerminalCtor };
    };
    cachedCtor = mod.Terminal ?? mod.default?.Terminal ?? null;
  } catch {
    cachedCtor = null;
  }
  return cachedCtor;
}

export class HeadlessTerminalModel {
  /** True when the real VT parser is in use; false on the degraded line ring. */
  readonly vt: boolean;

  private readonly maxLines: number;
  private term: InstanceType<HeadlessTerminalCtor> | null = null;

  /** Fallback ring — only populated when `vt` is false. */
  private readonly ring: string[] = [];
  /** Partial trailing line in the fallback ring, not yet terminated by a newline. */
  private partial = '';

  constructor(opts: { cols: number; rows: number; maxLines?: number; forceFallback?: boolean }) {
    this.maxLines = Math.max(1, opts.maxLines ?? DEFAULT_SCROLLBACK_LINES);
    // `forceFallback` exists so the degraded path stays reachable in a test
    // without uninstalling an optional dependency the rest of the suite needs.
    const Ctor = opts.forceFallback ? null : loadHeadlessTerminal();
    if (Ctor) {
      this.term = new Ctor({
        cols: Math.max(1, opts.cols),
        rows: Math.max(1, opts.rows),
        scrollback: this.maxLines,
        allowProposedApi: true,
      });
      this.vt = true;
    } else {
      this.vt = false;
    }
  }

  write(chunk: string): void {
    if (this.term) {
      this.term.write(chunk);
      return;
    }
    this.writeFallback(chunk);
  }

  resize(cols: number, rows: number): void {
    // Only the real VT model has a geometry; the fallback ring is line-based
    // and has nothing to reflow.
    this.term?.resize(Math.max(1, cols), Math.max(1, rows));
  }

  /**
   * Rendered scrollback, oldest line first. `tailLines` clamps the result to
   * the most recent N lines — the plan's cross-restart revive budget is 100,
   * well under the 1 000 the model retains.
   */
  lines(tailLines = 0): string[] {
    const all = this.term ? this.readVtLines() : [...this.ring, ...(this.partial ? [this.partial] : [])];
    if (tailLines <= 0 || tailLines >= all.length) return all;
    return all.slice(all.length - tailLines);
  }

  dispose(): void {
    try {
      this.term?.dispose();
    } catch {
      // A double dispose must not take the whole host down on shutdown.
    }
    this.term = null;
    this.ring.length = 0;
    this.partial = '';
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private readVtLines(): string[] {
    const buf = this.term!.buffer.active;
    const out: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      // `trimRight` — a VT buffer is a fixed grid, so every line is padded to
      // `cols` with spaces. Replaying that verbatim would multiply the payload.
      out.push(buf.getLine(y)?.translateToString(true) ?? '');
    }
    // Trailing blank rows are the unwritten remainder of the viewport, not
    // content: a 24-row terminal that printed one line would otherwise report
    // 23 empty lines of "scrollback".
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out;
  }

  private writeFallback(chunk: string): void {
    const plain = chunk.replace(ESCAPE_SEQUENCE_RE, '');
    let start = 0;
    for (let i = 0; i < plain.length; i++) {
      if (plain[i] !== '\n') continue;
      this.pushFallbackLine(this.partial + plain.slice(start, i).replace(/\r$/, ''));
      this.partial = '';
      start = i + 1;
    }
    this.partial += plain.slice(start);
    // Cap the in-progress line so a flood carrying no newline at all cannot
    // grow it forever — the precise failure the raw `string[]` had.
    if (this.partial.length > FALLBACK_MAX_LINE_CHARS) {
      this.partial = this.partial.slice(-FALLBACK_MAX_LINE_CHARS);
    }
  }

  private pushFallbackLine(line: string): void {
    this.ring.push(line.length > FALLBACK_MAX_LINE_CHARS ? line.slice(-FALLBACK_MAX_LINE_CHARS) : line);
    if (this.ring.length > this.maxLines) {
      this.ring.splice(0, this.ring.length - this.maxLines);
    }
  }
}
