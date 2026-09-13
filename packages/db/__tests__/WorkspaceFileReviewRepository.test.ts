// ────────────────────────────────────────────────────────────────
// Per-file review rows ("Keep") — repository behaviour
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { createDB, migrateDB, DrizzleWorkspaceFileReviewRepository } from '../src/index.js';

describe('DrizzleWorkspaceFileReviewRepository', () => {
  let db: ReturnType<typeof createDB>;
  let repo: DrizzleWorkspaceFileReviewRepository;
  const now = new Date('2026-01-01T00:00:00Z');

  const row = (alias: string, path: string, blob: string, workspaceId = 'ws1') => ({
    workspaceId,
    alias,
    path,
    acceptedBlob: blob,
    acceptedAt: now,
  });

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
    repo = new DrizzleWorkspaceFileReviewRepository(db);
  });

  it('stores and lists rows per workspace', async () => {
    await repo.upsertMany([row('.', 'a.txt', 'aaa'), row('api', 'src/b.ts', 'bbb')]);
    await repo.upsertMany([row('.', 'other.txt', 'ccc', 'ws2')]);

    const rows = await repo.list('ws1');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.path).sort()).toEqual(['a.txt', 'src/b.ts']);
    expect(await repo.list('ws2')).toHaveLength(1);
  });

  it('re-keeping the same file at a new blob updates rather than duplicating', async () => {
    // The normal path: the agent edited a kept file, so the old acceptance
    // no longer matches and the user accepts the new content.
    await repo.upsertMany([row('.', 'a.txt', 'aaa')]);
    await repo.upsertMany([row('.', 'a.txt', 'zzz')]);

    const rows = await repo.list('ws1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.acceptedBlob).toBe('zzz');
  });

  it('keeps the same path under different aliases apart', async () => {
    await repo.upsertMany([row('.', 'README.md', 'aaa'), row('api', 'README.md', 'bbb')]);
    expect(await repo.list('ws1')).toHaveLength(2);

    await repo.deleteMany('ws1', [{ alias: 'api', path: 'README.md' }]);
    const rows = await repo.list('ws1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.alias).toBe('.');
  });

  it('deletes only the named keys, across several aliases in one call', async () => {
    await repo.upsertMany([
      row('.', 'a.txt', 'aaa'),
      row('.', 'b.txt', 'bbb'),
      row('api', 'c.ts', 'ccc'),
    ]);
    await repo.deleteMany('ws1', [
      { alias: '.', path: 'a.txt' },
      { alias: 'api', path: 'c.ts' },
    ]);
    expect((await repo.list('ws1')).map((r) => r.path)).toEqual(['b.txt']);
  });

  it('is a no-op for empty batches', async () => {
    await repo.upsertMany([]);
    await repo.deleteMany('ws1', []);
    expect(await repo.list('ws1')).toEqual([]);
  });

  it('drops every row of a workspace and leaves other workspaces alone', async () => {
    await repo.upsertMany([row('.', 'a.txt', 'aaa'), row('.', 'b.txt', 'bbb', 'ws2')]);
    await repo.deleteWorkspace('ws1');
    expect(await repo.list('ws1')).toEqual([]);
    expect(await repo.list('ws2')).toHaveLength(1);
  });

  it('stores the empty blob a deleted file is accepted at', async () => {
    await repo.upsertMany([row('.', 'gone.txt', '')]);
    expect((await repo.list('ws1'))[0]!.acceptedBlob).toBe('');
  });
});
