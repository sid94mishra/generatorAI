// ────────────────────────────────────────────────────────────────
// MuxSseConnection + the connection registry — W09-a (§5.9).
//
// The whole point of multiplexing is that one socket carries many scopes
// WITHOUT them interfering. So the tests that matter are the ones about
// interference: a scope that floods must lose its own frames and nobody
// else's, and a scope that is quiet must keep writing while a sibling is
// backed up. Everything else is bookkeeping.
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamEventRow } from '@generatorai/core';

import { MAX_WINDOW_MS } from '../streaming/coalescer.js';
import { MuxSseConnection, encodeMuxFrame } from '../streaming/muxConnection.js';
import {
  MAX_CONNECTIONS_PER_PRINCIPAL,
  MAX_SUBS_PER_CONNECTION,
  attachConnection,
  createConnection,
  destroyConnection,
  getConnection,
  resetConnectionRegistry,
  scopeKeyOf,
} from '../streaming/streamConnectionRegistry.js';

// The coalescer's window is a real (unref'd) timer. Fake timers make its
// firing deterministic — see the `id:` counter test below, the one place
// this file needs to observe two separate writes from two lone deltas.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

class FakeResponse extends EventEmitter {
  writableEnded = false;
  full = false;
  written: string[] = [];

  write(chunk: string): boolean {
    this.written.push(chunk);
    return !this.full;
  }

  end(): void {
    this.writableEnded = true;
  }

  drain(): void {
    this.full = false;
    this.emit('drain');
  }

  dataFrames(): Array<Record<string, unknown>> {
    return this.written
      .filter((w) => w.startsWith('id: '))
      .map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6).trim()) as Record<string, unknown>);
  }

  controlFrames(name: string): Array<Record<string, unknown>> {
    return this.written
      .filter((w) => w.startsWith(`event: ${name}\n`))
      .map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6).trim()) as Record<string, unknown>);
  }
}

let rowId = 0;
function row(seq: number, kind: string, payload: unknown = {}): StreamEventRow {
  rowId += 1;
  return { id: rowId, seq, kind, payload, ts: Date.now() } as unknown as StreamEventRow;
}

function makeConn(onShed: (reason: string) => void = () => {}) {
  const res = new FakeResponse();
  const conn = new MuxSseConnection(res as never, onShed);
  return { res, conn };
}

describe('MuxSseConnection framing', () => {
  it('addresses every frame with its scope, per-scope seq and global event id', () => {
    const { res, conn } = makeConn();
    conn.deliver('chat:A', row(900, 'harness.message_complete'));
    const [frame] = res.dataFrames();
    expect(frame).toMatchObject({ s: 'chat:A', q: 900, k: 'harness.message_complete' });
    expect(typeof frame!['e']).toBe('number');
  });

  it('uses an opaque per-connection counter for `id:`, not the scope sequence', () => {
    // N-9 — `Last-Event-ID` carries one integer, and on a shared socket no
    // single integer is a correct position. `q` is the resume key; `id:` only
    // exists so proxies and stray reconnects behave sanely.
    const { res, conn } = makeConn();
    // Advanced between deliveries so each lone delta closes its own window —
    // otherwise both ride out in one coalesced write and this assertion's
    // naive per-entry parse would only ever see the first id.
    conn.deliver('chat:A', row(900, 'harness.token'));
    vi.advanceTimersByTime(MAX_WINDOW_MS);
    conn.deliver('run:B', row(12, 'harness.token'));
    vi.advanceTimersByTime(MAX_WINDOW_MS);
    const ids = res.written.filter((w) => w.startsWith('id: ')).map((w) => w.slice(4, w.indexOf('\n')));
    expect(ids).toEqual(['1', '2']);
  });

  it('encodes once per (row, scope) so K subscribers on a scope cost one stringify', () => {
    const shared = row(1, 'harness.token');
    expect(encodeMuxFrame('chat:A', shared)).toBe(encodeMuxFrame('chat:A', shared));
    // Different scope keys are genuinely different frames — `s` is in the body.
    expect(encodeMuxFrame('chat:A', shared)).not.toBe(encodeMuxFrame('session:A', shared));
  });
});

/**
 * Fill the socket the way the runtime does — with a write that returns false.
 *
 * A test that only sets `full` still gets its first frame written, because
 * that write is what discovers the congestion. Every isolation test below
 * depends on starting from an already-congested socket.
 */
function congest(res: FakeResponse, conn: MuxSseConnection): void {
  res.full = true;
  conn.deliver('warmup:0', row(1, 'harness.message_complete'));
  conn.forgetScope('warmup:0');
  res.written.length = 0;
}

describe('MuxSseConnection isolation between scopes', () => {
  it('bounds each scope separately, so a flood cannot evict a quiet sibling', () => {
    // §5.9.2 ③ — this is the reason five connections existed. Congestion is a
    // property of the socket, so while it lasts every scope queues; what must
    // NOT be shared is the budget, or one scope's flood discards another's
    // events.
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(900, 'harness.message_complete'));
    for (let seq = 1; seq <= 200; seq += 1) {
      conn.deliver('run:B', row(seq, 'harness.message_complete'));
    }

    expect(conn.stats.shed).toBe(false); // a busy scope must not cost the connection
    expect(conn.stats.scopes.get('run:B')?.droppedItems).toBeGreaterThan(0);
    expect(conn.stats.scopes.get('chat:A')?.droppedItems).toBe(0);
    expect(conn.stats.scopes.get('chat:A')?.queuedItems).toBe(1);
  });

  it('preserves order WITHIN a scope', () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(1, 'harness.message_complete'));
    conn.deliver('chat:A', row(2, 'harness.message_complete'));
    expect(res.dataFrames()).toHaveLength(0);

    res.drain();
    expect(res.dataFrames().map((f) => f['q'])).toEqual([1, 2]);
  });

  it('reports a gap against the scope that lost frames, not the connection', () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(900, 'harness.message_complete'));
    for (let seq = 1; seq <= 200; seq += 1) {
      conn.deliver('run:B', row(seq, 'harness.message_complete'));
    }

    res.drain();
    const gaps = res.controlFrames('gap');
    expect(gaps.map((g) => g['s'])).toEqual(['run:B']);
  });

  it('drops deltas while congested and keeps items', () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(1, 'harness.message_complete'));
    conn.deliver('chat:A', row(2, 'harness.token'));
    conn.deliver('chat:A', row(3, 'harness.token'));

    const stats = conn.stats.scopes.get('chat:A');
    expect(stats?.droppedDeltas).toBe(2);
    expect(stats?.queuedItems).toBe(1);
  });

  it('announces the gap BEFORE releasing the events that follow it', () => {
    // A client told about a hole after the events following it has already
    // rendered them into the hole.
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(1, 'harness.token'));
    conn.deliver('chat:A', row(2, 'harness.message_complete'));
    res.drain();

    const gapIndex = res.written.findIndex((w) => w.startsWith('event: gap\n'));
    const dataIndex = res.written.findIndex((w) => w.startsWith('id: '));
    expect(gapIndex).toBeGreaterThanOrEqual(0);
    expect(gapIndex).toBeLessThan(dataIndex);
  });

  it('drains scopes round-robin so a long backlog cannot starve a sibling', () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    for (let seq = 1; seq <= 3; seq += 1) {
      conn.deliver('run:B', row(seq, 'harness.message_complete'));
    }
    conn.deliver('chat:A', row(1, 'harness.message_complete'));

    res.drain();
    const order = res.dataFrames().map((f) => f['s']);
    // chat:A is behind three run:B frames, but must not wait for all of them.
    expect(order.indexOf('chat:A')).toBeLessThan(3);
  });

  it('sheds the connection only when the TOTAL byte budget is blown', () => {
    const reasons: string[] = [];
    const { res, conn } = makeConn((r) => reasons.push(r));
    congest(res, conn);
    const big = 'x'.repeat(400_000);
    for (let scope = 0; scope < 40 && !conn.stats.shed; scope += 1) {
      for (let seq = 1; seq <= 60; seq += 1) {
        conn.deliver(`run:${scope}`, row(seq, 'harness.message_complete', { big }));
      }
    }
    expect(conn.stats.shed).toBe(true);
    expect(reasons[0]).toContain('bytes');
  });

  it('releases a removed scope\'s queued bytes', () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(1, 'harness.message_complete', { text: 'x'.repeat(1000) }));
    expect(conn.stats.queuedBytes).toBeGreaterThan(0);
    conn.forgetScope('chat:A');
    expect(conn.stats.queuedBytes).toBe(0);
  });

  it('drops queued work on close so a dead client retains nothing', () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    conn.deliver('chat:A', row(1, 'harness.message_complete'));
    conn.close();
    expect(conn.stats.queuedBytes).toBe(0);
    expect(conn.stats.scopes.size).toBe(0);
  });
});

describe('MuxSseConnection producer backpressure (W06)', () => {
  it('returns a pending promise for a queued item, resolved only once that scope drains', async () => {
    const { res, conn } = makeConn();
    congest(res, conn);

    let resolved = false;
    const pending = conn.deliver('chat:A', row(1, 'harness.message_complete'));
    expect(pending).toBeInstanceOf(Promise);
    void pending!.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    res.drain();
    await pending;
    expect(resolved).toBe(true);
  });

  it('a busy sibling scope does not delay release of a quiet scope\'s waiter', async () => {
    const { res, conn } = makeConn();
    congest(res, conn);

    const quiet = conn.deliver('chat:A', row(1, 'harness.message_complete'));
    for (let seq = 1; seq <= 5; seq += 1) conn.deliver('run:B', row(seq, 'harness.message_complete'));

    res.drain();
    // chat:A drains first in round-robin order (it queued first), so its
    // waiter must not wait on run:B's much longer backlog to also clear.
    await quiet;
  });

  it('releases a scope\'s waiter when the scope is forgotten out from under it', async () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    const pending = conn.deliver('chat:A', row(1, 'harness.message_complete'));

    conn.forgetScope('chat:A');
    await pending; // must resolve, not hang, once the scope's state is gone
  });

  it('releases every scope\'s waiters when the connection closes', async () => {
    const { res, conn } = makeConn();
    congest(res, conn);
    const a = conn.deliver('chat:A', row(1, 'harness.message_complete'));
    const b = conn.deliver('run:B', row(1, 'harness.message_complete'));

    conn.close();
    await Promise.all([a, b]);
  });
});

describe('stream connection registry (N-11, N-12)', () => {
  beforeEach(() => resetConnectionRegistry());

  const sub = (scope: string, id: string) => ({ scope: scope as never, id });

  it('caps connections per PRINCIPAL, which is the bound a tab actually hits', () => {
    // N-11 — the pre-existing cap is per `(scope, id)` at 6, and a tab's five
    // EventSources are five different pairs, so it was never approached.
    for (let i = 0; i < MAX_CONNECTIONS_PER_PRINCIPAL; i += 1) {
      expect(createConnection('device:d1', [sub('chat', 'A')], new Map()).ok).toBe(true);
    }
    const over = createConnection('device:d1', [sub('chat', 'A')], new Map());
    expect(over).toMatchObject({ ok: false, code: 'CONNECTION_CAP_EXCEEDED' });
    // A different principal is unaffected — the cap is not global.
    expect(createConnection('device:d2', [sub('chat', 'A')], new Map()).ok).toBe(true);
  });

  it('caps subscriptions per connection', () => {
    const subs = Array.from({ length: MAX_SUBS_PER_CONNECTION + 1 }, (_, i) => sub('chat', `c${i}`));
    expect(createConnection('device:d1', subs, new Map())).toMatchObject({
      ok: false,
      code: 'TOO_MANY_SUBSCRIPTIONS',
    });
  });

  it('keeps only cursors for scopes that were actually subscribed', () => {
    // An unbounded cursor map would grow across every reconnect, and a cursor
    // for a scope nobody is watching resumes nothing.
    const created = createConnection(
      'device:d1',
      [sub('chat', 'A')],
      new Map([
        ['chat:A', 900],
        ['run:B', 12],
      ]),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect([...created.record.cursors.keys()]).toEqual(['chat:A']);
  });

  it('lets exactly one GET claim a record', () => {
    const created = createConnection('device:d1', [sub('chat', 'A')], new Map());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(attachConnection(created.record.id)).toBeDefined();
    // A replayed ticket must not fork a second socket onto the same entry and
    // double the broker fan-out.
    expect(attachConnection(created.record.id)).toBeUndefined();
  });

  it('frees the cap slot when the record is destroyed', () => {
    const created = createConnection('device:d1', [sub('chat', 'A')], new Map());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    destroyConnection(created.record.id);
    expect(getConnection(created.record.id)).toBeUndefined();
    for (let i = 0; i < MAX_CONNECTIONS_PER_PRINCIPAL; i += 1) {
      expect(createConnection('device:d1', [sub('chat', 'A')], new Map()).ok).toBe(true);
    }
  });

  it('builds scope keys the frame format uses', () => {
    expect(scopeKeyOf('chat' as never, 'A')).toBe('chat:A');
  });
});
