// ────────────────────────────────────────────────────────────────
// G-20 — background-task cancel attribution: migration v63 (redesign v57,
// renumbered after the Workflow Overhaul's v55–v60) and the
// repository. Real temp SQLite file, real migrations.
//
// Pinned: v63 adds the two columns to an existing database without touching
// its rows; a `cancelled` status stores who/when and maps them back onto
// `backgroundTask`; any other status clears them (a follow-up turn); a garbage
// `cancelled_by` value is not passed through.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Chat } from '@generatorai/shared';

import { closeDB, createDB, migrateDB, sessions, type AppDatabase } from '../src/index.js';
import { DrizzleChatRepository } from '../src/repositories/ChatRepository.js';

function raw(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g20-db-'));
  db = createDB(join(dir, 'chats.db'));
});

afterEach(() => {
  closeDB(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('migration v63 — background_task_cancel_attribution', () => {
  it('adds the columns and leaves existing worker rows as they were', () => {
    migrateDB(db, { targetVersion: 62 });
    const sqlite = raw(db);
    sqlite.prepare(`INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES ('s-w', 'w', 'active', 1000, 1000)`).run();
    sqlite
      .prepare(
        `INSERT INTO chats (id, name, session_id, tags, status, created_at, updated_at, last_activity_at, parent_chat_id, background_task_status)
         VALUES ('w', 'w', 's-w', '[]', 'active', 1000, 1000, 1000000, 'parent', 'cancelled')`,
      )
      .run();
    migrateDB(db);
    const cols = (sqlite.prepare(`PRAGMA table_info(chats)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['background_task_cancelled_by', 'background_task_cancelled_at']));
    const row = sqlite
      .prepare(`SELECT background_task_status s, background_task_cancelled_by b, background_task_cancelled_at a FROM chats WHERE id = 'w'`)
      .get() as { s: string; b: string | null; a: number | null };
    // Who cancelled an existing task was never recorded: no invented attribution.
    expect(row).toEqual({ s: 'cancelled', b: null, a: null });
  });
});

describe('DrizzleChatRepository — cancel attribution', () => {
  let repo: DrizzleChatRepository;
  const T0 = new Date('2026-09-26T09:00:00.000Z');

  async function worker(id: string): Promise<void> {
    await db.insert(sessions).values({ id: `s-${id}`, name: id, status: 'active', createdAt: T0, updatedAt: T0 });
    await repo.create({
      id,
      name: `Worker ${id}`,
      sessionId: `s-${id}`,
      tags: [],
      status: 'active',
      parentChatId: 'orch',
      backgroundTask: { orchestratorChatId: 'orch', taskName: `task ${id}`, status: 'running' },
      createdAt: T0,
      updatedAt: T0,
    } as Chat);
  }

  beforeEach(async () => {
    migrateDB(db);
    repo = new DrizzleChatRepository(db);
    await worker('w1');
    await worker('w2');
  });

  it('stores who and when with a cancelled status and maps them onto backgroundTask', async () => {
    await repo.updateBackgroundTaskStatus('w1', 'cancelled', { cancelledBy: 'user', cancelledAt: 1_700 });
    await repo.updateBackgroundTaskStatus('w2', 'cancelled', { cancelledBy: 'orchestrator', cancelledAt: 1_800 });
    expect((await repo.getById('w1')).backgroundTask).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'user',
      cancelledAt: 1_700,
    });
    const listed = await repo.listBackgroundTasks('orch');
    expect(listed.map((c) => [c.id, c.backgroundTask?.cancelledBy, c.backgroundTask?.cancelledAt])).toEqual([
      ['w1', 'user', 1_700],
      ['w2', 'orchestrator', 1_800],
    ]);
  });

  it('clears the attribution on any other status and ignores one passed with a non-cancelled status', async () => {
    await repo.updateBackgroundTaskStatus('w1', 'cancelled', { cancelledBy: 'user', cancelledAt: 1_700 });
    await repo.updateBackgroundTaskStatus('w1', 'running');
    const task = (await repo.getById('w1')).backgroundTask!;
    expect(task.status).toBe('running');
    expect(task).not.toHaveProperty('cancelledBy');
    expect(task).not.toHaveProperty('cancelledAt');

    await repo.updateBackgroundTaskStatus('w2', 'completed', { cancelledBy: 'user', cancelledAt: 9 });
    expect((await repo.getById('w2')).backgroundTask).not.toHaveProperty('cancelledBy');
  });

  it('does not pass a garbage cancelled_by through', async () => {
    raw(db)
      .prepare(`UPDATE chats SET background_task_status = 'cancelled', background_task_cancelled_by = 'robot', background_task_cancelled_at = 5 WHERE id = 'w1'`)
      .run();
    const task = (await repo.getById('w1')).backgroundTask!;
    expect(task).not.toHaveProperty('cancelledBy');
    expect(task.cancelledAt).toBe(5);
  });
});
