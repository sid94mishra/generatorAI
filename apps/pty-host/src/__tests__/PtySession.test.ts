// ────────────────────────────────────────────────────────────────
// PtySession — P0-23 credit flow control, coalescing, and the VT model.
//
// Drives a fake `IPty` rather than a real shell: the properties under test
// are exact byte accounting and pause/resume ordering at specific watermark
// crossings, which a real shell cannot be made to hit deterministically.
// The real-process coverage lives in `PtyHostServer.test.ts` and
// `PtyHostAdapter.test.ts`; this file is where the arithmetic is pinned.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IPty } from 'node-pty';
import { PtySession } from '../PtySession.js';

const HIGH_WATERMARK = 100_000;
const LOW_WATERMARK = 5_000;
const COALESCE_MS = 5;

/** Minimal `IPty` stand-in that records pause/resume and lets a test push data. */
function fakePty(): IPty & {
  emit(chunk: string): void;
  exit(code: number): void;
  calls: string[];
} {
  let dataCb: ((s: string) => void) | undefined;
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | undefined;
  const calls: string[] = [];
  const pty = {
    pid: 4242,
    cols: 80,
    rows: 24,
    process: 'fake',
    handleFlowControl: false,
    onData: (cb: (s: string) => void) => { dataCb = cb; return { dispose: () => undefined }; },
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { exitCb = cb; return { dispose: () => undefined }; },
    write: vi.fn(),
    resize: vi.fn(() => { calls.push('resize'); }),
    kill: vi.fn(() => { calls.push('kill'); }),
    pause: vi.fn(() => { calls.push('pause'); }),
    resume: vi.fn(() => { calls.push('resume'); }),
    clear: vi.fn(),
    emit: (chunk: string) => dataCb?.(chunk),
    exit: (code: number) => exitCb?.({ exitCode: code }),
    calls,
  };
  return pty as unknown as IPty & { emit(chunk: string): void; exit(code: number): void; calls: string[] };
}

function makeSession(pty: ReturnType<typeof fakePty>) {
  const sent: string[] = [];
  const exits: Array<number | null> = [];
  const session = new PtySession({
    sessionId: 's1',
    pty,
    cols: 80,
    rows: 24,
    onData: (chunk) => sent.push(chunk),
    onExit: (code) => exits.push(code),
  });
  return { session, sent, exits };
}

describe('PtySession — credit flow control (P0-23)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('pauses the SHELL, not just an internal flag, once unacked output crosses the high watermark', () => {
    // The original code set `paused = true` and nothing else: node-pty kept
    // producing and the "backpressure" was an unbounded in-memory queue.
    const pty = fakePty();
    const { session, sent } = makeSession(pty);

    pty.emit('x'.repeat(HIGH_WATERMARK));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(sent.join('').length).toBe(HIGH_WATERMARK);
    expect(session.unacked).toBe(HIGH_WATERMARK);
    expect(pty.calls).toContain('pause');
  });

  it('resumes the shell once credit brings unacked below the low watermark — the freeze P0-23 describes', () => {
    const pty = fakePty();
    const { session, sent } = makeSession(pty);

    pty.emit('x'.repeat(HIGH_WATERMARK));
    vi.advanceTimersByTime(COALESCE_MS);
    expect(pty.calls.filter((c) => c === 'pause')).toHaveLength(1);

    // A partial credit must NOT resume — that would defeat the watermark.
    session.creditAck(HIGH_WATERMARK - LOW_WATERMARK - 1);
    expect(pty.calls).not.toContain('resume');

    // Full credit does.
    session.creditAck(LOW_WATERMARK + 1);
    expect(session.unacked).toBe(0);
    expect(pty.calls).toContain('resume');

    // …and the session is usable again: more output flows.
    pty.emit('after-resume');
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sent.join('')).toContain('after-resume');
  });

  it('never sends past the high watermark while uncredited — the whole point of the pause', () => {
    const pty = fakePty();
    const { session, sent } = makeSession(pty);

    pty.emit('x'.repeat(HIGH_WATERMARK));
    vi.advanceTimersByTime(COALESCE_MS);

    // A real `pty.pause()` would stop these arriving; simulate a producer that
    // had already queued more before the pause reached the kernel.
    pty.emit('y'.repeat(50_000));
    vi.advanceTimersByTime(COALESCE_MS * 10);

    expect(sent.join('')).not.toContain('y');
    expect(session.unacked).toBe(HIGH_WATERMARK);

    // Once credited, the held bytes are delivered — not dropped.
    session.creditAck(HIGH_WATERMARK);
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sent.join('')).toContain('y'.repeat(50_000));
  });

  it('a gateway pause is not undone by a credit ack, and vice versa', () => {
    // Two independent pause sources share one node-pty stream, and node-pty's
    // pause is not refcounted — collapsing them into one boolean let either
    // source silently cancel the other's backpressure.
    const pty = fakePty();
    const { session } = makeSession(pty);

    session.pause();                       // gateway (session watermark)
    expect(pty.calls).toEqual(['pause']);

    pty.emit('x'.repeat(HIGH_WATERMARK));  // credit exhaustion on top
    vi.advanceTimersByTime(COALESCE_MS);
    session.creditAck(HIGH_WATERMARK);     // credit restored…

    // …but the gateway still wants it stopped, so no resume yet.
    expect(pty.calls.filter((c) => c === 'resume')).toHaveLength(0);

    session.resume();
    expect(pty.calls.filter((c) => c === 'resume')).toHaveLength(1);
  });
});

describe('PtySession — coalescing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits one frame per window and preserves bytes exactly across a chunk array', () => {
    const pty = fakePty();
    const { sent } = makeSession(pty);

    for (let i = 0; i < 500; i++) pty.emit(`chunk-${i};`);
    vi.advanceTimersByTime(COALESCE_MS);

    expect(sent).toHaveLength(1);
    let expected = '';
    for (let i = 0; i < 500; i++) expected += `chunk-${i};`;
    expect(sent[0]).toBe(expected);
  });

  it('flushes buffered output when the shell exits inside the coalescing window', () => {
    const pty = fakePty();
    const { sent, exits } = makeSession(pty);

    pty.emit('last line before exit');
    pty.exit(0); // Within COALESCE_MS — nothing has flushed yet.

    expect(sent.join('')).toBe('last line before exit');
    expect(exits).toEqual([0]);
  });
});

describe('PtySession — headless VT model (W14)', () => {
  it('exposes rendered scrollback instead of the raw fragment array nothing ever read', () => {
    const pty = fakePty();
    const { session } = makeSession(pty);

    pty.emit('alpha\r\nbeta\r\ngamma\r\n');

    const lines = session.scrollbackLines();
    expect(lines).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('tail-limits scrollback', () => {
    const pty = fakePty();
    const { session } = makeSession(pty);
    for (let i = 0; i < 50; i++) pty.emit(`line-${i}\r\n`);
    expect(session.scrollbackLines(3)).toEqual(['line-47', 'line-48', 'line-49']);
  });

  it('stays bounded under a newline-free flood — the shape the old string[] grew forever on', () => {
    const pty = fakePty();
    const { session } = makeSession(pty);

    // 2 MiB with not a single newline. The old ring capped ENTRY COUNT, so
    // this all landed in one entry and the cap did nothing.
    for (let i = 0; i < 32; i++) pty.emit('z'.repeat(64 * 1024));

    const bytes = session.scrollbackLines().join('\n').length;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });
});
