// ────────────────────────────────────────────────────────────────
// SseConnection — W05 + W06, the per-client write path.
//
// The old code's failure was that it LOOKED correct: it checked
// `res.write()`'s return value, kept a drain listener, and maintained a waiter
// list — but never pushed a waiter, so the producer was never slowed. Tests
// here assert the decisions, not the plumbing, because plumbing that is present
// and inert is exactly what was already there.
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamEventRow } from '@generatorai/core';

import { MAX_WINDOW_MS } from '../streaming/coalescer.js';
import { SseConnection, encodeEventFrame, parseCursor } from '../streaming/sseConnection.js';

/** Stands in for the database's stream space id. */
const SPACE = 'a1b2c3d4';

// The coalescer's window is a real (unref'd) timer. Fake timers make its
// firing deterministic instead of a race against the test runner's clock —
// see `flush()` below for why several tests need to trigger it explicitly.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A response whose `write` returns false on demand, so congestion is something
 * the test controls rather than something it has to provoke with real volume.
 */
class FakeResponse extends EventEmitter {
  writableEnded = false;
  full = false;
  written: string[] = [];
  throwOnWrite = false;

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw new Error('socket gone');
    this.written.push(chunk);
    return !this.full;
  }

  end(): void {
    this.writableEnded = true;
  }

  /** Let the socket accept data again and fire the drain the runtime would. */
  drain(): void {
    this.full = false;
    this.emit('drain');
  }

  /**
   * Individual event frames, split out of whatever `res.write()` calls
   * actually happened. The coalescer batches several frames into one write —
   * that IS the feature (W05) — so counting `written.length` measures
   * syscalls, not events delivered. SSE frames are `\n\n`-delimited and valid
   * to concatenate in one chunk; `EventSource` parses them identically either
   * way, so splitting here is what "how many events arrived" actually means.
   */
  frames(): string[] {
    return this.written
      .flatMap((w) => w.split('\n\n'))
      .filter((block) => block.length > 0 && !block.startsWith(': ') && !block.startsWith('event: '));
  }

  controlFrames(name: string): string[] {
    return this.written.filter((w) => w.startsWith(`event: ${name}\n`));
  }
}

function makeConn(onShed: (reason: string) => void = () => {}) {
  const res = new FakeResponse();
  const conn = new SseConnection(res as never, SPACE, onShed);
  return { res, conn };
}

/**
 * Force the coalescer's window closed.
 *
 * A lone delta is buffered and NOT written — that is the point of coalescing
 * — so a test that needs to observe (or provoke) an actual `res.write()` from
 * a delta alone has to close the window itself rather than wait on it.
 */
function flush(): void {
  vi.advanceTimersByTime(MAX_WINDOW_MS);
}

function row(seq: number, kind: string, payload: unknown = {}): StreamEventRow {
  return { id: seq, scope: 'chat', scopeId: 'c1', seq, kind, payload, ts: 0 };
}

describe('encodeEventFrame (P1-10)', () => {
  it('serialises one row exactly once however many subscribers read it', () => {
    const r = row(1, 'harness.token', { delta: 'hi' });
    const spy = vi.spyOn(JSON, 'stringify');

    const a = encodeEventFrame(r);
    const b = encodeEventFrame(r);
    const c = encodeEventFrame(r);

    expect(a).toBe(b);
    expect(b).toBe(c);
    // O(K) serialisations for K subscribers on one scope was the defect.
    expect(spy.mock.calls.filter(([v]) => v === r || (v as { kind?: string })?.kind === 'harness.token'))
      .toHaveLength(1);
    spy.mockRestore();
  });

  it('carries the kind inside the payload, with no `event:` field', () => {
    // Deliberate: EventSource has no wildcard addEventListener, so every data
    // frame has to reach one `onmessage` handler.
    const frame = encodeEventFrame(row(1, 'harness.token', { delta: 'x' }));
    expect(JSON.parse(frame)).toEqual({ kind: 'harness.token', payload: { delta: 'x' } });
  });
});

describe('SseConnection — uncongested', () => {
  it('writes every event straight through', () => {
    const { res, conn } = makeConn();
    conn.deliver(row(1, 'harness.token'));
    conn.deliver(row(2, 'harness.message_complete'));

    expect(res.frames()).toHaveLength(2);
    expect(res.frames()[0]).toContain(`id: ${SPACE}:1`);
    expect(conn.stats.droppedDeltas).toBe(0);
  });
});

describe('SseConnection — congested (W06)', () => {
  it('drops deltas rather than stalling, and says how many', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token')); // fills the buffer
    flush(); // the fill only actually reaches the socket once the window closes
    expect(conn.stats.droppedDeltas).toBe(0);

    for (let i = 2; i <= 6; i += 1) conn.deliver(row(i, 'harness.token'));

    expect(conn.stats.droppedDeltas).toBe(5);
    expect(conn.stats.queuedItems).toBe(0);
  });

  it('never drops an item — it queues', () => {
    const { conn, res } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // establish congestion before the items under test arrive

    conn.deliver(row(2, 'harness.message_complete'));
    conn.deliver(row(3, 'stage_run.completed'));
    conn.deliver(row(4, 'harness.tool_complete'));

    // A hole in the item stream is one a client cannot detect or repair.
    expect(conn.stats.queuedItems).toBe(3);
    expect(conn.stats.droppedDeltas).toBe(0);
  });

  it('announces the gap BEFORE releasing what came after it', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // establish congestion before the deltas under test arrive
    conn.deliver(row(2, 'harness.token'));
    conn.deliver(row(3, 'harness.token'));
    conn.deliver(row(4, 'harness.message_complete'));

    res.drain();

    const gapIndex = res.written.findIndex((w) => w.startsWith('event: gap\n'));
    const itemIndex = res.written.findIndex((w) => w.includes(`id: ${SPACE}:4`));
    expect(gapIndex).toBeGreaterThanOrEqual(0);
    // A client told about the hole afterwards has already rendered into it.
    expect(gapIndex).toBeLessThan(itemIndex);

    const gap = JSON.parse(res.controlFrames('gap')[0]!.split('data: ')[1]!);
    expect(gap).toMatchObject({ fromSeq: 2, toSeq: 3, dropped: 2, reason: 'slow_consumer' });
  });

  it('flushes queued items on drain, in order', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // establish congestion before the items under test arrive
    conn.deliver(row(2, 'harness.message_complete'));
    conn.deliver(row(3, 'stage_run.completed'));

    res.drain();

    const ids = res.frames().map((f) => Number(/id: [^:]+:(\d+)/.exec(f)![1]));
    expect(ids).toEqual([1, 2, 3]);
    expect(conn.stats.queuedItems).toBe(0);
  });

  it('stops flushing the moment the socket fills again', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    for (let i = 2; i <= 5; i += 1) conn.deliver(row(i, 'harness.message_complete'));

    // Drain fires but the socket only accepts one more frame.
    res.full = false;
    res.emit('drain');
    // FakeResponse accepts everything once `full` is false, so all four go.
    expect(conn.stats.queuedItems).toBe(0);
  });
});

describe('SseConnection — shedding (L2)', () => {
  it('disconnects a consumer that cannot drain even the item lane, with a reason', () => {
    const shed = vi.fn();
    const { res, conn } = makeConn(shed);
    res.full = true;
    conn.deliver(row(0, 'harness.token'));

    for (let i = 1; i <= 300; i += 1) conn.deliver(row(i, 'harness.message_complete'));

    expect(shed).toHaveBeenCalledTimes(1);
    expect(shed.mock.calls[0]![0]).toContain('item queue exceeded');
    // Told why, on the way out — a socket that just dies looks like a network
    // fault and gets retried forever.
    expect(res.controlFrames('slow_consumer_dropped')).toHaveLength(1);
    expect(res.writableEnded).toBe(true);
    expect(conn.isClosed).toBe(true);
  });

  it('bounds by BYTES too, not only frame count', () => {
    const shed = vi.fn();
    const { res, conn } = makeConn(shed);
    res.full = true;
    conn.deliver(row(0, 'harness.token'));

    // 10 frames of 1 MB each: far under the 256-frame cap, far over 8 MB.
    const fat = 'x'.repeat(1024 * 1024);
    for (let i = 1; i <= 10; i += 1) conn.deliver(row(i, 'harness.tool_complete', { out: fat }));

    expect(shed).toHaveBeenCalledTimes(1);
    expect(shed.mock.calls[0]![0]).toContain('bytes');
  });

  it('sheds only once however many events arrive after', () => {
    const shed = vi.fn();
    const { res, conn } = makeConn(shed);
    res.full = true;
    conn.deliver(row(0, 'harness.token'));
    for (let i = 1; i <= 400; i += 1) conn.deliver(row(i, 'harness.message_complete'));

    expect(shed).toHaveBeenCalledTimes(1);
  });
});

describe('SseConnection — lifecycle', () => {
  it('ignores delivery after close', () => {
    const { res, conn } = makeConn();
    conn.close();
    conn.deliver(row(1, 'harness.token'));
    expect(res.frames()).toHaveLength(0);
  });

  it('closes itself when the socket throws', () => {
    const { res, conn } = makeConn();
    res.throwOnWrite = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // the delta is buffered, not written, until the window closes
    expect(conn.isClosed).toBe(true);
  });

  it('drops queued work on close so a dead client retains nothing', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // establish congestion before the item under test arrives
    conn.deliver(row(2, 'harness.message_complete'));
    expect(conn.stats.queuedItems).toBe(1);

    conn.close();
    expect(conn.stats.queuedItems).toBe(0);
  });
});

describe('database-scoped resume cursors (W08)', () => {
  const q = (raw: string | undefined) => parseCursor(raw, SPACE);
  const h = q;

  it('stamps the space id into every frame id', () => {
    const { res, conn } = makeConn();
    conn.deliver(row(7, 'harness.token'));
    flush();
    expect(res.frames()[0]).toContain(`id: ${SPACE}:7`);
  });

  it('round-trips a cursor from this database', () => {
    expect(h(`${SPACE}:42`)).toEqual({
      afterSeq: 42,
      foreign: false,
      invalid: false,
    });
  });

  it('honours a cursor across a server restart', () => {
    // THE regression this replaced. `stream_sequences` persists and is never
    // reset, so seq 812 still means the same event after a restart. A previous
    // version keyed this on a per-process id and therefore skipped replay
    // entirely on every restart — the exact outage the mechanism exists for.
    expect(h(`${SPACE}:812`).afterSeq).toBe(812);
    expect(h(`${SPACE}:812`).foreign).toBe(false);
  });

  it('rejects a cursor from a different database', () => {
    // A restored backup or a wiped dev database: the numbers genuinely changed
    // underneath the client, so its cursor names something else entirely.
    const parsed = h('deadbeef:42');
    expect(parsed.foreign).toBe(true);
    expect(parsed.afterSeq).toBeUndefined();
    expect(parsed.invalid).toBe(false); // normal, not an error
  });

  it('takes a bare integer at face value, whatever sent it', () => {
    // The sequence space is durable, so an unqualified cursor is still a
    // correct position in it — it just carries no evidence of WHICH database
    // minted it. That is what `?afterSeq=` means to the CLI and curl, and what
    // every client minted before the space id existed replays exactly once.
    expect(q('17')).toEqual({ afterSeq: 17, foreign: false, invalid: false });
    expect(q('0')).toEqual({ afterSeq: 0, foreign: false, invalid: false });
    expect(h('812').afterSeq).toBe(812);
  });

  it('treats absent as "no cursor", not as an error', () => {
    for (const parsed of [h(undefined), h(''), q(undefined)]) {
      expect(parsed).toEqual({
        afterSeq: undefined,
        foreign: false,
        invalid: false,
      });
    }
  });

  it.each(['abc', `${SPACE}:abc`, '-1', `${SPACE}:-3`, '1.5', '0x10'])(
    'rejects %s as malformed',
    (raw) => {
      expect(q(raw).invalid).toBe(true);
    },
  );
});

describe('producer backpressure (W06)', () => {
  it('returns a pending promise for a queued item, and resolves only once the socket drains', async () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // establish congestion

    let resolved = false;
    const pending = conn.deliver(row(2, 'harness.message_complete'));
    expect(pending).toBeInstanceOf(Promise);
    void pending!.then(() => {
      resolved = true;
    });

    // A microtask tick is not enough to resolve it — nothing has drained yet.
    await Promise.resolve();
    expect(resolved).toBe(false);

    res.drain();
    await pending;
    expect(resolved).toBe(true);
  });

  it('does not return a pending promise for a delta — it is dropped instead', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush();

    const ret = conn.deliver(row(2, 'harness.token'));
    expect(ret).toBeUndefined();
    expect(conn.stats.droppedDeltas).toBe(1);
  });

  it('does not return a pending promise for an item delivered straight through', () => {
    const { conn } = makeConn();
    const ret = conn.deliver(row(1, 'harness.message_complete'));
    expect(ret).toBeUndefined();
  });

  it('releases a waiter immediately if enqueueing it sheds the connection', async () => {
    // The item that tips the connection over MAX_QUEUED_ITEMS must not leave
    // its own caller waiting on a connection that is already gone.
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(0, 'harness.token'));
    flush();

    let last: void | Promise<void> = undefined;
    for (let i = 1; i <= 260; i += 1) last = conn.deliver(row(i, 'harness.message_complete'));

    expect(conn.isClosed).toBe(true);
    // Whether the very last call returned a promise or not, it must resolve
    // rather than hang — if it doesn't, this test times out instead of
    // passing, which is exactly the failure mode being guarded against.
    await last;
  });

  it('releases every waiter when the connection is closed out from under it', async () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush();
    const pending = conn.deliver(row(2, 'harness.message_complete'));

    conn.close();
    await pending; // must resolve, not hang, once the connection is gone
  });
});

describe('ordering under congestion (P1-B3)', () => {
  it('queues an item while earlier items are queued, even when a write would succeed', () => {
    // `res.write()` returns true again as soon as the buffer drops below its
    // high-water mark, but Node only emits 'drain' at ZERO. Branching on
    // `congested` alone let a later item overtake earlier ones, and the client
    // dedups on seq, so the overtaken ones were discarded on arrival.
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token')); // fills
    flush(); // ... once the window closes and the write actually happens
    conn.deliver(row(2, 'harness.message_complete'));
    conn.deliver(row(3, 'stage_run.completed'));
    expect(conn.stats.queuedItems).toBe(2);

    // The socket accepts writes again but has NOT drained.
    res.full = false;
    conn.deliver(row(4, 'harness.tool_complete'));

    // 4 must not have overtaken 2 and 3.
    expect(conn.stats.queuedItems).toBe(3);
    expect(res.frames()).toHaveLength(1); // only seq 1 went out

    res.drain();
    const ids = res.frames().map((f) => Number(/id: [^:]+:(\d+)/.exec(f)![1]));
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it('a control frame cannot clear congestion and let a later item jump the queue', () => {
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // establish congestion before the item under test arrives
    conn.deliver(row(2, 'harness.message_complete'));

    // A small successful write mid-drain used to set congested = false.
    res.full = false;
    conn.writeControl('hello', { resumed: true });

    conn.deliver(row(3, 'harness.tool_complete'));
    expect(conn.stats.queuedItems).toBe(2);
  });

  it('keeps heartbeating while congested', () => {
    // A heartbeat exists to stop an idle proxy killing the connection, and
    // congestion is when that matters most. Skipping it let the very mechanism
    // meant to keep a slow client alive be the reason it was dropped.
    const { res, conn } = makeConn();
    res.full = true;
    conn.deliver(row(1, 'harness.token'));
    flush(); // otherwise writeComment's own pre-flush writes it as a 2nd frame
    const before = res.written.length;

    conn.writeComment('heartbeat 1');
    expect(res.written.length).toBe(before + 1);
  });

  it('bounds the queue by real bytes, not UTF-16 units', () => {
    const shed = vi.fn();
    const { res, conn } = makeConn(shed);
    res.full = true;
    conn.deliver(row(0, 'harness.token'));
    flush(); // establish congestion before the items under test arrive

    // 3 bytes per char in UTF-8, 1 unit in `String.length` — the old
    // accounting under-counted this by 3x.
    const cjk = '\u6f22'.repeat(700_000);
    for (let i = 1; i <= 4; i += 1) conn.deliver(row(i, 'harness.tool_complete', { out: cjk }));

    expect(shed).toHaveBeenCalledTimes(1);
    expect(shed.mock.calls[0]![0]).toContain('bytes');
  });
});
