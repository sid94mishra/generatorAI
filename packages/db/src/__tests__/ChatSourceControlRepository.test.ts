// ────────────────────────────────────────────────────────────────
// DrizzleChatRepository — the per-chat agent-native source-control option
// (`chats.source_control`, migration 54).
//
// Pins the round trip that the feature rests on: the option survives a
// create, comes back off a fresh read as the same object, is replaceable
// through `update`, is clearable with `null`, and — for the chats that
// existed before v54 — reads back as `undefined` rather than `null`, which
// is the convention every other optional JSON column on this table follows.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Chat, ChatSourceControlOptions } from '@generatorai/shared';

import { createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import { DrizzleChatRepository } from '../repositories/ChatRepository.js';
import { sessions } from '../schema.js';

function rawClient(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

let dir: string;
let db: AppDatabase;
let repo: DrizzleChatRepository;

async function makeChat(overrides: Partial<Chat> = {}): Promise<Chat> {
  const id = `chat-${Math.random().toString(36).slice(2)}`;
  const sessionId = `sess-${id}`;
  const now = new Date();
  await db.insert(sessions).values({ id: sessionId, name: id, status: 'active', createdAt: now, updatedAt: now });
  return repo.create({
    id,
    name: 'Source control round trip',
    sessionId,
    tags: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Chat);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-chat-scm-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  repo = new DrizzleChatRepository(db);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

describe('chats.source_control — migration 54', () => {
  it('adds the column and is re-runnable on an existing database', () => {
    const client = rawClient(db);
    // △ `>= 54`, not `= 54`: the runner resumes from MAX(version), so leaving
    // a later row behind would silently skip 54 and assert nothing.
    client.exec(`DELETE FROM _schema_versions WHERE version >= 54;`);
    // The ALTER cannot say `IF NOT EXISTS`; the runner tolerates exactly the
    // "duplicate column" error this re-run produces.
    expect(() => migrateDB(db)).not.toThrow();

    const cols = (client.prepare(`PRAGMA table_info(chats)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('source_control');
  });
});

describe('DrizzleChatRepository — sourceControl round trip', () => {
  const options: ChatSourceControlOptions = {
    autoCommit: true,
    autoPush: true,
    autoPullRequest: false,
    base: 'main',
    draft: true,
  };

  it('persists the option on create and reads it back unchanged', async () => {
    const created = await makeChat({ sourceControl: options });
    const read = await repo.getById(created.id);
    expect(read.sourceControl).toEqual(options);
  });

  it('a chat created without the option reads back undefined, not null', async () => {
    const created = await makeChat();
    const read = await repo.getById(created.id);
    expect(read.sourceControl).toBeUndefined();
    expect('sourceControl' in read && read.sourceControl === null).toBe(false);
  });

  it('update replaces the whole option and a later read agrees', async () => {
    const created = await makeChat({ sourceControl: options });
    const next: ChatSourceControlOptions = {
      autoCommit: true,
      autoPush: true,
      autoPullRequest: true,
      base: 'release/1.x',
    };
    const updated = await repo.update(created.id, { sourceControl: next });
    expect(updated.sourceControl).toEqual(next);
    expect((await repo.getById(created.id)).sourceControl).toEqual(next);
  });

  it('turns the option on for a chat that was created without it', async () => {
    const created = await makeChat();
    await repo.update(created.id, { sourceControl: options });
    expect((await repo.getById(created.id)).sourceControl).toEqual(options);
  });

  it('an unrelated update leaves the option alone', async () => {
    const created = await makeChat({ sourceControl: options });
    await repo.update(created.id, { name: 'renamed' });
    const read = await repo.getById(created.id);
    expect(read.name).toBe('renamed');
    expect(read.sourceControl).toEqual(options);
  });

  it('clears the option back to undefined when set to null', async () => {
    const created = await makeChat({ sourceControl: options });
    await repo.update(created.id, { sourceControl: null as unknown as ChatSourceControlOptions });
    expect((await repo.getById(created.id)).sourceControl).toBeUndefined();
  });

  it('refuses to write a non-object into the JSON column', async () => {
    const created = await makeChat();
    await expect(
      repo.update(created.id, { sourceControl: 'always' as unknown as ChatSourceControlOptions }),
    ).rejects.toThrow(/source/i);
  });
});
