// ────────────────────────────────────────────────────────────────
// Chat list v2 (G-02) — migrations v61/v62 (redesign v55/v56, renumbered after
// the Workflow Overhaul's v55–v60) and the repository's list page.
//
// Real temp SQLite file, real migrations. Pinned here:
//   - v61 backfills existing chats: last activity = newest message (else
//     creation), last turn = the newest assistant reply (partial → cancelled,
//     an `Error:` system line → failed, anything else → succeeded), and a
//     malformed metadata row does not abort the migration;
//   - v62 backfills a NULL activity and rejects NULL writes;
//   - keyset paging walks every row exactly once under each sort, ties
//     included, and the activity order is index-served (no temp B-tree);
//   - every filter, the total and the All / Active / Archived counts;
//   - the summary columns: activity never moves backwards, turn outcomes,
//     change stats report whether they moved.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatListFilter, ChatListPageQuery } from '@generatorai/core';
import type { Chat } from '@generatorai/shared';

import { closeDB, createDB, migrateDB, sessions, type AppDatabase } from '../src/index.js';
import { DrizzleChatRepository } from '../src/repositories/ChatRepository.js';

function raw(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g02-db-'));
  db = createDB(join(dir, 'chats.db'));
});

afterEach(() => {
  closeDB(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('migration v61 — chat list summary columns', () => {
  it('adds the columns and backfills activity and the last turn from the transcript', () => {
    migrateDB(db, { targetVersion: 60 });
    const sqlite = raw(db);
    const insertSession = sqlite.prepare(
      `INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', 1000, 1000)`,
    );
    const insertChat = sqlite.prepare(
      `INSERT INTO chats (id, name, session_id, tags, status, created_at, updated_at) VALUES (?, ?, ?, '[]', 'active', 1000, 5000)`,
    );
    const insertMessage = sqlite.prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, timestamp, metadata) VALUES (?, ?, ?, 'x', ?, ?)`,
    );
    for (const id of ['stopped', 'failed', 'fine', 'garbled', 'empty']) {
      insertSession.run(`s-${id}`, id);
      insertChat.run(id, id, `s-${id}`);
    }
    insertMessage.run('m1', 's-stopped', 'user', 1100, null);
    insertMessage.run('m2', 's-stopped', 'assistant', 1200, JSON.stringify({ partial: true }));
    insertMessage.run('m3', 's-failed', 'assistant', 1300, JSON.stringify({ systemMessages: ['Note', 'Error: rate limited\nretry later'] }));
    // An older successful reply must not win over the newest one.
    insertMessage.run('m4', 's-fine', 'assistant', 1100, JSON.stringify({ partial: true }));
    insertMessage.run('m5', 's-fine', 'assistant', 1400, JSON.stringify({ turnId: 't' }));
    insertMessage.run('m6', 's-fine', 'user', 1500, null);
    insertMessage.run('m7', 's-garbled', 'assistant', 1600, 'not json {');

    migrateDB(db);

    const rows = sqlite
      .prepare(
        `SELECT id, last_activity_at AS activity, last_turn_status AS status, last_turn_ended_at AS ended,
                last_turn_error AS error, changes_files AS files FROM chats ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      { id: 'empty', activity: 1_000_000, status: null, ended: null, error: null, files: null },
      { id: 'failed', activity: 1_300_000, status: 'failed', ended: 1_300_000, error: 'rate limited\nretry later', files: null },
      { id: 'fine', activity: 1_500_000, status: 'succeeded', ended: 1_400_000, error: null, files: null },
      { id: 'garbled', activity: 1_600_000, status: 'succeeded', ended: 1_600_000, error: null, files: null },
      { id: 'stopped', activity: 1_200_000, status: 'cancelled', ended: 1_200_000, error: null, files: null },
    ]);
    const indexes = (sqlite.prepare(`PRAGMA index_list(chats)`).all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_chats_last_activity', 'idx_chats_workspace_id']));
  });
});

describe('migration v62 — index-served activity order, non-NULL activity', () => {
  it('backfills a NULL activity, widens the activity index and rejects NULL writes', () => {
    migrateDB(db, { targetVersion: 61 });
    const sqlite = raw(db);
    sqlite.prepare(`INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES ('s-n', 'n', 'active', 1000, 1000)`).run();
    sqlite
      .prepare(`INSERT INTO chats (id, name, session_id, tags, status, created_at, updated_at) VALUES ('n', 'n', 's-n', '[]', 'active', 1234, 1234)`)
      .run();

    migrateDB(db);

    expect(sqlite.prepare(`SELECT last_activity_at AS a FROM chats WHERE id = 'n'`).get()).toEqual({ a: 1_234_000 });
    const columns = (index: string) =>
      (sqlite.prepare(`PRAGMA index_info(${index})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns('idx_chats_last_activity')).toEqual(['last_activity_at', 'id']);
    expect(columns('idx_chats_list_activity')).toEqual(['parent_chat_id', 'last_activity_at', 'id']);
    expect(columns('idx_chats_list_status_activity')).toEqual(['status', 'parent_chat_id', 'last_activity_at', 'id']);

    expect(() =>
      sqlite
        .prepare(`INSERT INTO chats (id, name, session_id, tags, status, created_at, updated_at) VALUES ('m', 'm', 's-n', '[]', 'active', 1, 1)`)
        .run(),
    ).toThrow(/last_activity_at/);
    expect(() => sqlite.prepare(`UPDATE chats SET last_activity_at = NULL WHERE id = 'n'`).run()).toThrow(/last_activity_at/);
  });
});

describe('DrizzleChatRepository — list page', () => {
  let repo: DrizzleChatRepository;
  const T0 = new Date('2026-09-26T09:00:00.000Z');

  async function chat(id: string, over: Partial<Chat> = {}, activityMs?: number): Promise<void> {
    await db.insert(sessions).values({ id: `s-${id}`, name: id, status: 'active', createdAt: T0, updatedAt: T0 });
    const createdAt = over.createdAt ?? T0;
    await repo.create({
      id,
      name: `Chat ${id}`,
      sessionId: `s-${id}`,
      tags: [],
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      ...over,
    } as Chat);
    if (activityMs !== undefined) await repo.touchActivity(id, new Date(activityMs));
  }

  const query = (filter: ChatListFilter = {}, over: Partial<ChatListPageQuery> = {}): ChatListPageQuery => ({
    filter,
    sort: 'activity',
    limit: 50,
    ...over,
  });

  async function ids(filter: ChatListFilter = {}, over: Partial<ChatListPageQuery> = {}): Promise<string[]> {
    return (await repo.listPage(query(filter, over))).rows.map((r) => r.chat.id);
  }

  /** Walks every page of a query with page size `limit`. */
  async function walk(sort: ChatListPageQuery['sort'], limit: number, filter: ChatListFilter = {}): Promise<string[]> {
    const seen: string[] = [];
    let after: ChatListPageQuery['after'];
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await repo.listPage({ filter, sort, limit, ...(after ? { after } : {}) });
      seen.push(...page.rows.map((r) => r.chat.id));
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error('paging did not terminate');
  }

  beforeEach(async () => {
    migrateDB(db);
    repo = new DrizzleChatRepository(db);
    const base = T0.getTime();
    await chat('alpha', { name: 'Alpha deploy', projectId: 'p1', tags: ['infra', 'urgent'], agentRef: 'global:reviewer' }, base + 5_000);
    await chat('bravo', { name: 'bravo notes', projectId: 'p1', description: 'about the 50% rollout' }, base + 4_000);
    // Three chats with the SAME activity time: the id breaks the tie.
    await chat('charlie', { name: 'Charlie', projectId: 'p2', tags: ['infra'] }, base + 3_000);
    await chat('delta', { name: 'delta', projectId: 'p2', agentRef: 'global:writer' }, base + 3_000);
    await chat('echo', { name: 'Echo', tags: ['misc'] }, base + 3_000);
    await chat('foxtrot', { name: 'Foxtrot', status: 'archived', projectId: 'p1' }, base + 1_000);
    // A worker chat: hidden unless asked for.
    await chat('worker', { name: 'Worker 1', parentChatId: 'alpha', projectId: 'p1' }, base + 9_000);
    // Created later but never active since: sorts by creation time × 1000.
    await chat('golf', { name: 'golf', createdAt: new Date(base + 2_000) });
  });

  it('sorts by last activity, newest first, and pages through every row exactly once', async () => {
    const all = await ids();
    expect(all).toEqual(['alpha', 'bravo', 'echo', 'delta', 'charlie', 'golf', 'foxtrot']);
    for (const limit of [1, 2, 3, 50]) {
      expect(await walk('activity', limit), `limit ${limit}`).toEqual(all);
    }
  });

  // P2-R30: the default list (workers hidden, with or without a status, first
  // page and cursor page) is read in order straight off an index — no temp
  // B-tree sort — on a fresh database, i.e. without ANALYZE statistics.
  it('serves the activity order from an index, with no temp B-tree, first page and cursor page', async () => {
    const sqlite = raw(db);
    const insertSession = sqlite.prepare(
      `INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', 1000, 1000)`,
    );
    const insertChat = sqlite.prepare(
      `INSERT INTO chats (id, name, session_id, tags, status, parent_chat_id, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, '[]', ?, ?, 1000, 1000, ?)`,
    );
    sqlite.transaction(() => {
      for (let i = 0; i < 300; i += 1) {
        insertSession.run(`s-bulk-${i}`, `bulk ${i}`);
        insertChat.run(`bulk-${i}`, `bulk ${i}`, `s-bulk-${i}`, i % 5 === 0 ? 'archived' : 'active', i % 7 === 0 ? 'alpha' : null, 1_000_000 + (i % 40) * 1000);
      }
    })();

    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const prepare = sqlite.prepare.bind(sqlite);
    const planOf = async (q: ChatListPageQuery) => {
      statements.length = 0;
      sqlite.prepare = ((text: string) => {
        const stmt = prepare(text);
        const all = stmt.all.bind(stmt);
        stmt.all = ((...params: unknown[]) => {
          statements.push({ sql: text, params });
          return all(...params);
        }) as typeof stmt.all;
        return stmt;
      }) as typeof sqlite.prepare;
      let page;
      try {
        page = await repo.listPage(q);
      } finally {
        sqlite.prepare = prepare;
      }
      const listed = statements[0]!;
      const plan = (prepare(`EXPLAIN QUERY PLAN ${listed.sql}`).all(...listed.params) as Array<{ detail: string }>)
        .map((r) => r.detail)
        .join(' | ');
      return { page, plan };
    };

    for (const filter of [{}, { status: 'active' as const }, { status: 'archived' as const }]) {
      const first = await planOf(query(filter, { limit: 10 }));
      expect(first.plan, JSON.stringify(filter)).toMatch(/USING INDEX idx_chats_(list|pin)_/);
      expect(first.plan, JSON.stringify(filter)).not.toMatch(/TEMP B-TREE/);
      expect(first.page.next).not.toBeNull();
      const next = await planOf(query(filter, { limit: 10, after: first.page.next! }));
      expect(next.plan, JSON.stringify(filter)).toMatch(/\(last_activity_at,id\)<\(\?,\?\)/);
      expect(next.plan, JSON.stringify(filter)).not.toMatch(/TEMP B-TREE/);
    }
    // Workers included: the pinned-first (pin, last_activity_at, id) index (v64).
    const workers = await planOf(query({ includeWorkers: true }, { limit: 10 }));
    expect(workers.plan).toMatch(/USING INDEX idx_chats_pin_all_activity/);
    expect(workers.plan).not.toMatch(/TEMP B-TREE/);
  });

  it('pages by name (case-insensitive, A→Z) and by creation time', async () => {
    const byName = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];
    expect(await walk('name', 2)).toEqual(byName);
    const byCreated = await walk('created', 2);
    expect(byCreated[0]).toBe('golf');
    expect([...byCreated].sort()).toEqual([...byName].sort());
  });

  it('reports the total and the segment counts for the filter without the status', async () => {
    const all = await repo.listPage(query({}, { limit: 2 }));
    expect(all.total).toBe(7);
    expect(all.counts).toEqual({ active: 6, archived: 1 });
    expect(all.rows).toHaveLength(2);
    expect(all.next).not.toBeNull();

    const archived = await repo.listPage(query({ status: 'archived', projectIds: ['p1'] }));
    expect(archived.rows.map((r) => r.chat.id)).toEqual(['foxtrot']);
    expect(archived.total).toBe(1);
    expect(archived.counts).toEqual({ active: 2, archived: 1 });
    expect(archived.next).toBeNull();
  });

  it('filters by project, agent, tags (any of), search and workers', async () => {
    expect(await ids({ projectIds: ['p1'] })).toEqual(['alpha', 'bravo', 'foxtrot']);
    expect(await ids({ projectIds: ['p1', 'p2'], status: 'active' })).toEqual(['alpha', 'bravo', 'delta', 'charlie']);
    expect(await ids({ agentRefs: ['global:writer', 'global:reviewer'] })).toEqual(['alpha', 'delta']);
    expect(await ids({ tags: ['infra', 'misc'] })).toEqual(['alpha', 'echo', 'charlie']);
    expect(await ids({ q: 'DEPLOY' })).toEqual(['alpha']);
    // The description matches; `%` is the character, not a wildcard.
    expect(await ids({ q: '50%' })).toEqual(['bravo']);
    expect(await ids({ q: '5_%' })).toEqual([]);
    // A tag matches too.
    expect(await ids({ q: 'urg' })).toEqual(['alpha']);
    expect(await ids({ includeWorkers: true, projectIds: ['p1'] })).toEqual(['worker', 'alpha', 'bravo', 'foxtrot']);
  });

  it('filters by resolved state: live ids, or a last turn outcome of a chat that is not live', async () => {
    await repo.recordTurnEnd('bravo', { status: 'succeeded', endedAt: new Date(T0.getTime() + 4_500) });
    await repo.recordTurnEnd('charlie', { status: 'failed', endedAt: new Date(T0.getTime() + 3_500), error: 'boom' });
    await repo.recordTurnEnd('delta', { status: 'succeeded', endedAt: new Date(T0.getTime() + 3_600) });

    const done = { ids: [], turnStatuses: ['succeeded' as const], excludeIds: ['delta'] };
    expect(await ids({ state: done })).toEqual(['bravo']);
    expect(await ids({ state: { ids: ['echo'], turnStatuses: ['failed'], excludeIds: [] } })).toEqual(['charlie', 'echo']); // the turn end moved charlie up
    // "Running" while nothing runs matches nothing — never everything.
    expect(await ids({ state: { ids: [], turnStatuses: [], excludeIds: [] } })).toEqual([]);
  });

  it('keeps the summary columns: activity only moves forward, outcomes and change stats', async () => {
    const before = await repo.getListActivity('echo');
    await repo.touchActivity('echo', new Date(T0.getTime()));
    expect((await repo.getListActivity('echo'))!.lastActivityAt).toEqual(before!.lastActivityAt);

    const ended = new Date(T0.getTime() + 60_000);
    await repo.recordTurnEnd('echo', { status: 'failed', endedAt: ended, error: 'provider down' });
    expect(await repo.getListActivity('echo')).toEqual({
      lastActivityAt: ended,
      lastTurn: { status: 'failed', endedAt: ended, error: 'provider down' },
    });
    // A later success clears the error.
    await repo.recordTurnEnd('echo', { status: 'succeeded', endedAt: new Date(ended.getTime() + 1), error: 'ignored' });
    expect((await repo.getListActivity('echo'))!.lastTurn).toEqual({ status: 'succeeded', endedAt: new Date(ended.getTime() + 1) });

    expect(await repo.setChangeStats('echo', { files: 2, additions: 10, deletions: 1 })).toBe(true);
    expect(await repo.setChangeStats('echo', { files: 2, additions: 10, deletions: 1 })).toBe(false);
    expect(await repo.setChangeStats('echo', { files: 0, additions: 0, deletions: 0 })).toBe(true);
    expect((await repo.getListActivity('echo'))!.changes).toEqual({ files: 0, additions: 0, deletions: 0 });
    expect(await repo.setChangeStats('missing', { files: 1, additions: 1, deletions: 1 })).toBe(false);
    expect(await repo.getListActivity('missing')).toBeNull();

    // The newest activity now leads the list.
    expect((await ids())[0]).toBe('echo');
  });

  it('finds every chat on a workspace', async () => {
    await chat('ws-a', { workspaceId: 'ws-1' });
    await chat('ws-b', { workspaceId: 'ws-1', parentChatId: 'ws-a' });
    expect((await repo.getByWorkspaceId('ws-1')).map((c) => c.id).sort()).toEqual(['ws-a', 'ws-b']);
  });
});
