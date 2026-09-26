// ────────────────────────────────────────────────────────────────
// Idempotency-key repository tests (Track A3)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { createDB, migrateDB, DrizzleIdempotencyKeyRepository } from '../src/index.js';

describe('DrizzleIdempotencyKeyRepository (Track A3)', () => {
  let db: ReturnType<typeof createDB>;
  let repo: DrizzleIdempotencyKeyRepository;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
    repo = new DrizzleIdempotencyKeyRepository(db);
  });

  it('claims a fresh (key, scope) exactly once', async () => {
    const now = new Date();
    const record = {
      key: 'req-1',
      scope: 'automation:abc',
      executionId: 'exec-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    const first = await repo.claim(record);
    expect(first).toEqual({ executionId: 'exec-1', replay: false, requestHash: null });
  });

  it('returns the original executionId on replay within TTL', async () => {
    const now = new Date();
    await repo.claim({
      key: 'req-1',
      scope: 'automation:abc',
      executionId: 'exec-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const replay = await repo.claim({
      key: 'req-1',
      scope: 'automation:abc',
      executionId: 'exec-2',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(replay).toMatchObject({ executionId: 'exec-1', replay: true, requestHash: null });
  });

  it('treats different scopes with the same key as independent', async () => {
    const now = new Date();
    const base = {
      key: 'req-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    const a = await repo.claim({ ...base, scope: 'automation:abc', executionId: 'exec-1' });
    const b = await repo.claim({ ...base, scope: 'webhook:xyz', executionId: 'exec-2' });
    expect(a.replay).toBe(false);
    expect(b.replay).toBe(false);
  });

  it('allows re-claim after expiry', async () => {
    const past = new Date(Date.now() - 60_000);
    await repo.claim({
      key: 'req-1',
      scope: 'automation:abc',
      executionId: 'exec-1',
      createdAt: past,
      expiresAt: past, // already expired
    });
    const now = new Date();
    const fresh = await repo.claim({
      key: 'req-1',
      scope: 'automation:abc',
      executionId: 'exec-2',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(fresh).toEqual({ executionId: 'exec-2', replay: false, requestHash: null });
  });

  it('sweepExpired removes only expired rows', async () => {
    const now = Date.now();
    // expired
    await repo.claim({
      key: 'old',
      scope: 's',
      executionId: 'e1',
      createdAt: new Date(now - 120_000),
      expiresAt: new Date(now - 60_000),
    });
    // still live
    await repo.claim({
      key: 'new',
      scope: 's',
      executionId: 'e2',
      createdAt: new Date(now),
      expiresAt: new Date(now + 60_000),
    });
    const removed = await repo.sweepExpired();
    expect(removed).toBe(1);
    // Live row remains.
    const replay = await repo.claim({
      key: 'new',
      scope: 's',
      executionId: 'e3',
      createdAt: new Date(now),
      expiresAt: new Date(now + 60_000),
    });
    expect(replay).toMatchObject({ executionId: 'e2', replay: true, requestHash: null });
  });

  it('updateExecutionId rewrites the stored id for an existing claim', async () => {
    const now = new Date();
    await repo.claim({
      key: 'req-42',
      scope: 'auto:x',
      executionId: 'placeholder-42',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await repo.updateExecutionId('req-42', 'auto:x', 'real-42');
    const replay = await repo.claim({
      key: 'req-42',
      scope: 'auto:x',
      executionId: 'ignored',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(replay).toMatchObject({ executionId: 'real-42', replay: true, requestHash: null });
  });

  it('two concurrent claim() calls only one wins', async () => {
    const now = new Date();
    const base = {
      key: 'race',
      scope: 'auto:x',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    // better-sqlite3 is synchronous so parallel promises still resolve
    // in sequence; validate that the loser sees a replay hit.
    const [a, b] = await Promise.all([
      repo.claim({ ...base, executionId: 'A' }),
      repo.claim({ ...base, executionId: 'B' }),
    ]);
    // Exactly one non-replay and one replay.
    const replayCount = [a, b].filter((r) => r.replay).length;
    const freshCount = [a, b].filter((r) => !r.replay).length;
    expect(replayCount).toBe(1);
    expect(freshCount).toBe(1);
    // Both callers agree on the winning executionId.
    expect(a.executionId).toBe(b.executionId);
  });
});
