// ────────────────────────────────────────────────────────────────
// W07 — the micro-batched durable writer.
//
// The performance claim is measured in packages/db/__benchmarks__. What is
// tested here is the part that could be silently wrong: that batching did not
// weaken commit-then-broadcast, reorder anything, or turn a failed write into a
// resolved promise.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, DrizzleStreamCursorRepository, type AppDatabase } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

import { StreamBroker } from '../src/services/StreamBroker.js';
import { StreamWriteBatcher } from '../src/services/StreamWriteBatcher.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

let dir: string;
let db: AppDatabase;
let repo: DrizzleStreamCursorRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-batch-'));
  db = createDB(join(dir, 'b.db'));
  migrateDB(db);
  repo = new DrizzleStreamCursorRepository(db);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

function rowCount(): number {
  const sqlite = (
    db as unknown as { session: { client: { prepare: (s: string) => { get: () => { n: number } } } } }
  ).session.client;
  return sqlite.prepare('SELECT COUNT(*) AS n FROM stream_cursors').get().n;
}

describe('StreamWriteBatcher', () => {
  it('assigns consecutive sequence numbers within one scope', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger());
    const rows = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        w.write('chat', 'c1', 'harness.token', { i }),
      ),
    );
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('keeps scopes on independent sequences even inside one batch', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger());
    const [a1, b1, a2, b2] = await Promise.all([
      w.write('chat', 'a', 'harness.token', {}),
      w.write('chat', 'b', 'harness.token', {}),
      w.write('chat', 'a', 'harness.token', {}),
      w.write('chat', 'b', 'harness.token', {}),
    ]);
    expect([a1!.seq, a2!.seq]).toEqual([1, 2]);
    expect([b1!.seq, b2!.seq]).toEqual([1, 2]);
  });

  it('resolves each event with its own row, in call order', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger());
    const rows = await Promise.all(
      Array.from({ length: 10 }, (_, i) => w.write('chat', 'c1', 'harness.token', { i })),
    );
    rows.forEach((row, i) => {
      expect((row.payload as { i: number }).i).toBe(i);
    });
    // Row ids are monotonic too, so `e` remains a usable cross-scope identity.
    const ids = rows.map((r) => r.id);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
  });

  it('a batch that fails rejects every event in it, not just one', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger());
    const boom = new Error('disk gone');
    vi.spyOn(repo, 'appendBatch').mockRejectedValueOnce(boom);

    const results = await Promise.allSettled([
      w.write('chat', 'c1', 'harness.token', { i: 0 }),
      w.write('chat', 'c1', 'harness.token', { i: 1 }),
      w.write('chat', 'c1', 'harness.token', { i: 2 }),
    ]);

    // Partial success would mean some events were broadcast and others silently
    // were not, with no way for a subscriber to tell which.
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('caps a single transaction so the event loop is never blocked without bound', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger(), { maxBatch: 4 });
    const spy = vi.spyOn(repo, 'appendBatch');

    await Promise.all(
      Array.from({ length: 13 }, (_, i) => w.write('chat', 'c1', 'harness.token', { i })),
    );

    expect(spy.mock.calls.every(([events]) => events.length <= 4)).toBe(true);
    expect(rowCount()).toBe(13);
  });

  it('drains everything on flush()', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger(), { deltaBatchMs: 10_000 });
    const pending = Promise.all(
      Array.from({ length: 5 }, (_, i) => w.write('chat', 'c1', 'harness.token', { i })),
    );
    expect(w.depth).toBe(5);

    await w.flush();
    await pending;

    expect(w.depth).toBe(0);
    expect(rowCount()).toBe(5);
  });

  describe('class decides the wait (W04)', () => {
    it('does not hold an item behind the delta window', async () => {
      // A 10s window would hang this test if items waited for it.
      const w = new StreamWriteBatcher(repo, mockLogger(), { deltaBatchMs: 10_000 });
      const row = await w.write('chat', 'c1', 'harness.message_complete', { text: 'done' });
      expect(row.seq).toBe(1);
    });

    it('lets deltas wait so they can share a commit', async () => {
      const w = new StreamWriteBatcher(repo, mockLogger(), { deltaBatchMs: 15 });
      const spy = vi.spyOn(repo, 'appendBatch');

      await Promise.all(
        Array.from({ length: 8 }, (_, i) => w.write('chat', 'c1', 'harness.token', { i })),
      );

      // The point of the exercise: 8 events, far fewer transactions.
      expect(spy.mock.calls.length).toBeLessThan(8);
      expect(rowCount()).toBe(8);
    });

    it('an item flushes the deltas queued ahead of it, preserving order', async () => {
      const w = new StreamWriteBatcher(repo, mockLogger(), { deltaBatchMs: 10_000 });
      const t1 = w.write('chat', 'c1', 'harness.token', { i: 0 });
      const t2 = w.write('chat', 'c1', 'harness.token', { i: 1 });
      const done = w.write('chat', 'c1', 'harness.message_complete', {});

      const [a, b, c] = await Promise.all([t1, t2, done]);
      expect([a!.seq, b!.seq, c!.seq]).toEqual([1, 2, 3]);
    });
  });
});

describe('StreamBroker with batching', () => {
  it('never fans out an event before it is committed (EVT-01)', async () => {
    const broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 5 });
    const seenAtBroadcast: number[] = [];

    await broker.subscribe('chat', 'c1', () => {
      // Read the durable table at the instant of broadcast. If fan-out ever
      // ran before the commit, this would lag behind.
      seenAtBroadcast.push(rowCount());
    });

    for (let i = 0; i < 12; i += 1) {
      await broker.publish('chat', 'c1', 'harness.token', { i });
    }
    await broker.flushWrites();

    expect(seenAtBroadcast).toHaveLength(12);
    seenAtBroadcast.forEach((committed, i) => {
      expect(committed, `event ${i} was broadcast before it was durable`).toBeGreaterThanOrEqual(
        i + 1,
      );
    });
  });

  it('delivers events to a subscriber in sequence order', async () => {
    const broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 5 });
    const seqs: number[] = [];
    await broker.subscribe('chat', 'c1', (row) => {
      seqs.push(row.seq);
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => broker.publish('chat', 'c1', 'harness.token', { i })),
    );
    await broker.flushWrites();

    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('a replay taken after publish resolves includes the event (read-your-writes)', async () => {
    const broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 50 });
    await broker.publish('chat', 'c1', 'harness.token', { i: 0 });

    // No flush, no wait — resolving the publish must already mean durable.
    const replayed = await repo.replayAfter('chat', 'c1', 0);
    expect(replayed).toHaveLength(1);
  });

  it('reports queue depth so throttling is visible rather than mysterious', async () => {
    const broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 10_000 });
    const p = Promise.all([
      broker.publish('chat', 'c1', 'harness.token', {}),
      broker.publish('chat', 'c1', 'harness.token', {}),
    ]);
    expect(broker.writeDepth).toBe(2);
    await broker.flushWrites();
    await p;
    expect(broker.writeDepth).toBe(0);
  });

  it('awaits a subscriber before resolving — the producer-side half of W06', async () => {
    // This is the mechanism the connection classes plug into: a handler that
    // does not resolve immediately (a queued item awaiting drain) must make
    // `publish()` itself pending, because `publish()` is what the harness's
    // per-session emit queue awaits. Fire-and-forget fan-out cannot produce
    // this — that was the defect (P0-7 / W06).
    const broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 5 });
    let releaseHandler: (() => void) | undefined;
    await broker.subscribe(
      'chat',
      'c1',
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve;
        }),
    );

    let resolved = false;
    const publishing = broker.publish('chat', 'c1', 'harness.message_complete', {}).then(() => {
      resolved = true;
    });

    // Give the write + fan-out every chance to run ahead if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    releaseHandler?.();
    await publishing;
    expect(resolved).toBe(true);
  });

  it('a handler that throws does not stop fan-out to the next subscriber or the publish itself', async () => {
    const broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 5 });
    const seen: number[] = [];
    await broker.subscribe('chat', 'c1', () => {
      throw new Error('subscriber blew up');
    });
    await broker.subscribe('chat', 'c1', (row) => {
      seen.push(row.seq);
    });

    await expect(broker.publish('chat', 'c1', 'harness.message_complete', {})).resolves.toMatchObject({
      seq: 1,
    });
    expect(seen).toEqual([1]);
  });
});

// ────────────────────────────────────────────────────────────────
// Review 3.4 — a lone delta must not wait out the whole window.
//
// `EventBus` serialises emits per session, so for one active conversation
// there is only ever ONE delta pending. It used to wait the full 8 ms batching
// window, which the batch could never fill, so every event paid the delay and
// got none of the batching benefit — a ceiling of roughly 125 events per
// second per conversation, which is what made long answers fall progressively
// further behind the model.
// ────────────────────────────────────────────────────────────────

describe('delta flush latency (review 3.4)', () => {
  it('writes a single delta without waiting out the full batching window', async () => {
    // A deliberately long window: if the flush waited for it, this test would
    // time out rather than merely be slow.
    const w = new StreamWriteBatcher(repo, mockLogger(), { deltaBatchMs: 10_000 });

    const started = Date.now();
    await w.write('chat', 'c1', 'harness.token', { text: 'hi' });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(rowCount()).toBe(1);
  });

  it('still batches deltas emitted in the same tick into one transaction', async () => {
    const w = new StreamWriteBatcher(repo, mockLogger(), { deltaBatchMs: 10_000 });
    const spy = vi.spyOn(repo, 'appendBatch');

    await Promise.all([
      w.write('chat', 'c1', 'harness.token', { text: 'a' }),
      w.write('chat', 'c1', 'harness.token', { text: 'b' }),
      w.write('chat', 'c1', 'harness.token', { text: 'c' }),
    ]);

    // Three events, ONE transaction: the amortisation the window exists for is
    // preserved. Only the dead waiting is gone.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(rowCount()).toBe(3);
  });
});
