// ────────────────────────────────────────────────────────────────
// W08 — resume that tells the truth.
//
// The failure this prevents is silent and permanent: a client returning with a
// cursor that retention has already swept past gets "everything after seq 40",
// which is rows 100+ — renderable, plausible, and missing 41-99 forever with
// nothing to detect it by. Same for a cursor minted before a restart, when seq
// numbers have gone back to 1 and name entirely different events.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDB,
  migrateDB,
  DrizzleStreamCursorRepository,
  type AppDatabase,
} from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

import { StreamBroker, type StreamResumeStatus } from '../src/services/StreamBroker.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

let dir: string;
let db: AppDatabase;
let repo: DrizzleStreamCursorRepository;
let broker: StreamBroker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-resume-'));
  db = createDB(join(dir, 'r.db'));
  migrateDB(db);
  repo = new DrizzleStreamCursorRepository(db);
  broker = new StreamBroker(repo, mockLogger(), { deltaBatchMs: 0 });
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

async function publish(n: number, scopeId = 'c1'): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await broker.publish('chat', scopeId, 'harness.token', { i });
  }
  await broker.flushWrites();
}

/** Subscribe and capture the resume verdict plus everything delivered. */
async function resumeFrom(
  afterSeq: number | undefined,
  opts: { syncReplayLimit?: number } = {},
): Promise<{ status: StreamResumeStatus | undefined; seqs: number[]; unsubscribe: () => void }> {
  let status: StreamResumeStatus | undefined;
  const seqs: number[] = [];
  const unsubscribe = await broker.subscribe(
    'chat',
    'c1',
    (row) => {
      seqs.push(row.seq);
    },
    {
      ...(afterSeq === undefined ? {} : { afterSeq }),
      ...(opts.syncReplayLimit === undefined ? {} : { syncReplayLimit: opts.syncReplayLimit }),
      onResume: (s) => {
        status = s;
      },
    },
  );
  return { status, seqs, unsubscribe };
}

describe('StreamBroker resume status (W08)', () => {
  it('reports a clean resume when every event after the cursor is still stored', async () => {
    await publish(10);
    const { status, seqs, unsubscribe } = await resumeFrom(4);

    expect(status).toMatchObject({ resumed: true, afterSeq: 4, oldestSeq: 1, deliveredUpTo: 10 });
    expect(status?.reason).toBeUndefined();
    expect(seqs).toEqual([5, 6, 7, 8, 9, 10]);
    unsubscribe();
  });

  it('reports cursor_expired when retention swept past the cursor', async () => {
    await publish(10);
    // Simulate a sweep: everything up to seq 5 is gone.
    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } } })
      .session.client;
    sqlite.prepare('DELETE FROM stream_cursors WHERE seq <= ?').run(5);

    const { status, unsubscribe } = await resumeFrom(2);

    // Rows 3-5 no longer exist. Replaying "after 2" hands back 6-10, which the
    // client would render straight into the hole where 3-5 belonged.
    expect(status?.resumed).toBe(false);
    expect(status?.reason).toBe('cursor_expired');
    expect(status?.oldestSeq).toBe(6);
    unsubscribe();
  });

  it('does NOT call a contiguous cursor expired', async () => {
    await publish(10);
    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } } })
      .session.client;
    sqlite.prepare('DELETE FROM stream_cursors WHERE seq <= ?').run(5);

    // Cursor is 5, oldest surviving is 6 — exactly contiguous, nothing lost.
    const { status, seqs, unsubscribe } = await resumeFrom(5);
    expect(status?.resumed).toBe(true);
    expect(seqs).toEqual([6, 7, 8, 9, 10]);
    unsubscribe();
  });

  it('reports replay_truncated separately from an expired cursor', async () => {
    // The client's response differs: truncation needs another page, expiry
    // needs a full re-snapshot. Collapsing them makes the cheap case expensive.
    await publish(30);
    const { status, unsubscribe } = await resumeFrom(0, { syncReplayLimit: 10 });

    expect(status?.resumed).toBe(false);
    expect(status?.reason).toBe('replay_truncated');
    expect(status?.deliveredUpTo).toBe(10);
    unsubscribe();
  });

  it('reports honestly when there is no cursor at all', async () => {
    await publish(3);
    const { status, unsubscribe } = await resumeFrom(undefined);

    // Not a resume — the client is starting from a snapshot, and saying so
    // beats leaving it to guess from the absence of a frame.
    expect(status?.resumed).toBe(false);
    unsubscribe();
  });

  it('does not report a false resumed:true when retention sweeps DURING the resume window', async () => {
    // △ Phase 1 review — `oldestSeq` used to be read BEFORE `replayAfter`. A
    // sweep landing between those two reads made `oldest` stale-low, so a
    // replay that was actually missing rows could still pass the
    // `oldest > requested + 1` check and be reported `resumed: true` — the
    // exact silent hole W08 exists to prevent. Reading `replayAfter` first
    // means the floor read afterwards can only be stale in the SAFE
    // direction (an unnecessary `cursor_expired`, never a false `resumed`).
    await publish(10);
    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } } })
      .session.client;

    const original = repo.replayAfter.bind(repo);
    vi.spyOn(repo, 'replayAfter').mockImplementation(async (...args) => {
      const rows = await original(...args);
      // Simulate a retention sweep landing in the gap between the replay read
      // and the (now second) oldestSeq read: rows 3-5 disappear right here.
      sqlite.prepare('DELETE FROM stream_cursors WHERE seq <= ?').run(5);
      return rows;
    });

    const { status, unsubscribe } = await resumeFrom(2);

    // The replay itself still returned rows 3-10 (it read before the sweep),
    // but the floor read afterwards is now 6 — the mechanism must notice the
    // ground moved and refuse to call this a clean resume.
    expect(status?.resumed).toBe(false);
    expect(status?.reason).toBe('cursor_expired');
    unsubscribe();
  });

  it('fires before any replayed event reaches the handler', async () => {
    await publish(5);
    const order: string[] = [];
    const unsubscribe = await broker.subscribe(
      'chat',
      'c1',
      () => order.push('event'),
      {
        afterSeq: 0,
        onResume: () => order.push('hello'),
      },
    );

    // A client told about a hole after the events following it has already
    // rendered them into the hole.
    expect(order[0]).toBe('hello');
    expect(order.filter((o) => o === 'hello')).toHaveLength(1);
    unsubscribe();
  });
});

describe('oldestSeq', () => {
  it('is 0 for a scope with nothing stored', async () => {
    expect(await repo.oldestSeq('chat', 'empty')).toBe(0);
  });

  it('tracks the floor as retention sweeps', async () => {
    await publish(5);
    expect(await repo.oldestSeq('chat', 'c1')).toBe(1);

    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } } })
      .session.client;
    sqlite.prepare('DELETE FROM stream_cursors WHERE seq <= ?').run(3);

    expect(await repo.oldestSeq('chat', 'c1')).toBe(4);
  });

  it('is per-scope, not global', async () => {
    await publish(3, 'c1');
    await publish(3, 'c2');
    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } } })
      .session.client;
    sqlite.prepare("DELETE FROM stream_cursors WHERE scope_id = 'c1' AND seq <= 2").run();

    expect(await repo.oldestSeq('chat', 'c1')).toBe(3);
    expect(await repo.oldestSeq('chat', 'c2')).toBe(1);
  });
});
