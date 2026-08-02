import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  DrizzleStreamCursorRepository,
  migrateDB,
  type AppDatabase,
} from '@generatorai/db';
import { StreamBroker } from '../src/services/StreamBroker.js';
import type { StreamEventRow } from '../src/services/StreamBroker.js';

const silentLogger = {
  debug() {}, info() {}, warn() {}, error() {},
  child() { return silentLogger; },
};

function makeBroker(): { broker: StreamBroker; db: AppDatabase } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite) as unknown as AppDatabase;
  migrateDB(db);
  const repo = new DrizzleStreamCursorRepository(db);
  const broker = new StreamBroker(repo, silentLogger);
  return { broker, db };
}

describe('StreamBroker', () => {
  let broker: StreamBroker;

  beforeEach(() => {
    broker = makeBroker().broker;
  });

  it('allocates monotonic per-(scope, scopeId) sequences', async () => {
    const a1 = await broker.publish('run', 'r1', 'x', {});
    const a2 = await broker.publish('run', 'r1', 'x', {});
    const a3 = await broker.publish('run', 'r1', 'x', {});
    expect([a1.seq, a2.seq, a3.seq]).toEqual([1, 2, 3]);

    // Different scopeId has its own sequence space
    const b1 = await broker.publish('run', 'r2', 'x', {});
    expect(b1.seq).toBe(1);

    // Different scope also independent
    const c1 = await broker.publish('chat', 'r1', 'x', {});
    expect(c1.seq).toBe(1);
  });

  it('replays persisted events after seq, capped at limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await broker.publish('chat', 'c1', 'msg', { n: i });
    }
    const rows = await broker.replay('chat', 'c1', 2, 10);
    expect(rows.map((r) => r.seq)).toEqual([3, 4, 5]);
    const capped = await broker.replay('chat', 'c1', 0, 2);
    expect(capped.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('delivers live events to subscribers', async () => {
    const received: StreamEventRow[] = [];
    const unsub = await broker.subscribe('session', 's1', (r) => { received.push(r); });
    await broker.publish('session', 's1', 'e1', { a: 1 });
    await broker.publish('session', 's1', 'e2', { a: 2 });
    expect(received.map((r) => r.kind)).toEqual(['e1', 'e2']);
    unsub();
  });

  it('unsubscribe stops delivery', async () => {
    const received: StreamEventRow[] = [];
    const unsub = await broker.subscribe('session', 's1', (r) => { received.push(r); });
    await broker.publish('session', 's1', 'e1', {});
    unsub();
    await broker.publish('session', 's1', 'e2', {});
    expect(received).toHaveLength(1);
  });

  it('replays from afterSeq on subscribe then attaches live', async () => {
    await broker.publish('run', 'r', 'a', {});
    await broker.publish('run', 'r', 'b', {});

    const received: StreamEventRow[] = [];
    await broker.subscribe('run', 'r', (r) => { received.push(r); }, { afterSeq: 0 });

    await broker.publish('run', 'r', 'c', {});
    expect(received.map((r) => r.kind)).toEqual(['a', 'b', 'c']);
  });

  it('dedupes rows between replay and real-time', async () => {
    await broker.publish('run', 'r', 'a', {});
    const received: StreamEventRow[] = [];
    // Subscribe with afterSeq=0 — replays seq 1 — then a new publish during
    // attach-window would double-deliver without the dedup watermark.
    await broker.subscribe('run', 'r', (r) => { received.push(r); }, { afterSeq: 0 });
    await broker.publish('run', 'r', 'b', {});
    expect(received.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('filters by kind prefix when subscribed', async () => {
    const received: StreamEventRow[] = [];
    await broker.subscribe(
      'run', 'r',
      (r) => { received.push(r); },
      { kindPrefixes: ['stage.', 'workflow_run.'] },
    );
    await broker.publish('run', 'r', 'stage.started', {});
    await broker.publish('run', 'r', 'harness.token', {});        // should filter out
    await broker.publish('run', 'r', 'workflow_run.done', {});
    expect(received.map((r) => r.kind)).toEqual(['stage.started', 'workflow_run.done']);
  });

  it('caps kind prefix list at 10', async () => {
    const received: StreamEventRow[] = [];
    const prefixes = Array.from({ length: 20 }, (_, i) => `k${i}.`);
    await broker.subscribe('run', 'r', (r) => { received.push(r); }, { kindPrefixes: prefixes });
    // k0.-k9. should pass; k10.- should filter (capped to first 10).
    await broker.publish('run', 'r', 'k0.x', {});
    await broker.publish('run', 'r', 'k15.x', {});
    expect(received.map((r) => r.kind)).toEqual(['k0.x']);
  });

  it('clamps syncReplayLimit to MAX_SYNC_REPLAY', async () => {
    // Publish a handful, request huge limit — broker clamps internally.
    for (let i = 0; i < 5; i += 1) await broker.publish('run', 'r', 'x', {});
    const rows = await broker.replay('run', 'r', 0, 100_000);
    expect(rows).toHaveLength(5);
  });

  it('isolates scopes on live broadcast', async () => {
    const aReceived: StreamEventRow[] = [];
    const bReceived: StreamEventRow[] = [];
    await broker.subscribe('run', 'a', (r) => { aReceived.push(r); });
    await broker.subscribe('run', 'b', (r) => { bReceived.push(r); });
    await broker.publish('run', 'a', 'x', {});
    expect(aReceived).toHaveLength(1);
    expect(bReceived).toHaveLength(0);
  });

  it('subscriberCount reflects attach/detach', async () => {
    expect(broker.subscriberCount('session', 's')).toBe(0);
    const u1 = await broker.subscribe('session', 's', () => {});
    const u2 = await broker.subscribe('session', 's', () => {});
    expect(broker.subscriberCount('session', 's')).toBe(2);
    u1();
    expect(broker.subscriberCount('session', 's')).toBe(1);
    u2();
    expect(broker.subscriberCount('session', 's')).toBe(0);
  });

  it('does not drop events published during replay (race fix)', async () => {
    // Simulate the race: subscribe with afterSeq=0, a publish happens
    // immediately (same tick before replay's await settles).
    await broker.publish('run', 'r', 'old', {});
    const received: StreamEventRow[] = [];

    // Start subscribe but don't await it yet — this returns a promise while
    // replayAfter is still awaiting DB.
    const subscribePromise = broker.subscribe('run', 'r', (row) => {
      received.push(row);
    }, { afterSeq: 0 });

    // Publish DURING the replay fetch. With the buffering fix, this row
    // lands in the real-time buffer, gets deduped, and is delivered after
    // replay flushes. Without the fix, it would be dropped because the
    // real-time handler wasn't attached yet.
    await broker.publish('run', 'r', 'midflight', {});

    await subscribePromise;
    // One more to prove live delivery works after the swap.
    await broker.publish('run', 'r', 'after', {});

    const kinds = received.map((r) => r.kind);
    expect(kinds).toContain('old');
    expect(kinds).toContain('midflight');
    expect(kinds).toContain('after');
    // No duplicates.
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('prune removes rows older than cutoff', async () => {
    await broker.publish('run', 'r', 'old', {});
    // Wait a tick, then prune everything older than now-0.
    await new Promise((r) => setTimeout(r, 10));
    const removed = await broker.prune(0);
    expect(removed).toBeGreaterThanOrEqual(1);
    const rows = await broker.replay('run', 'r', 0, 10);
    expect(rows).toHaveLength(0);
  });
});
