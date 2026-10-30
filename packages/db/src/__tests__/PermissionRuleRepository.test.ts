// ────────────────────────────────────────────────────────────────
// U-16 (D-147) — remembered permission rules (v67) on a real SQLite: owner
// isolation (a chat's rules never reach another chat or a run), idempotent
// adds, revoke / clear, and the rows going with their owner.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDB, createDB, DrizzlePermissionRuleRepository, migrateDB, type AppDatabase } from '../index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});
const raw = (db: AppDatabase): Database.Database => (db as unknown as { session: { client: Database.Database } }).session.client;
const T = 1_800_000_000_000;

function setup() {
  const db = createDB(':memory:');
  open.push(db);
  migrateDB(db);
  const s = raw(db);
  for (const id of ['c1', 'c2']) {
    s.prepare(`INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`).run(`s-${id}`, id, T, T);
    s.prepare(
      `INSERT INTO chats (id, name, session_id, tags, status, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, '[]', 'active', ?, ?, ?)`,
    ).run(id, id, `s-${id}`, T, T, T);
  }
  s.prepare(`INSERT INTO workflow_definitions (id, name, spec, created_at, updated_at) VALUES ('d', 'D', '{}', ?, ?)`).run(T, T);
  s.prepare(`INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at) VALUES ('v', 'd', 1, 'h', 'published', '{}', ?)`).run(T);
  s.prepare(
    `INSERT INTO workflow_runs (id, workflow_definition_id, definition_version_id, name, status, permission_mode, root_run_id, created_at, updated_at)
     VALUES ('r', 'd', 'v', 'Run', 'running', 'acceptEdits', 'r', ?, ?)`,
  ).run(T, T);
  return { s, repo: new DrizzlePermissionRuleRepository(db) };
}

describe('DrizzlePermissionRuleRepository', () => {
  it('keeps each owner\'s rules to itself and adds idempotently', async () => {
    const { repo } = setup();
    await repo.add({ kind: 'chat', id: 'c1' }, [{ kind: 'command', match: 'pnpm lint' }, { kind: 'command', match: 'git status' }]);
    await repo.add({ kind: 'chat', id: 'c1' }, [{ kind: 'command', match: 'pnpm lint' }, { kind: 'tool', match: 'pnpm lint' }]);
    await repo.add({ kind: 'run', id: 'r' }, [{ kind: 'command', match: 'pnpm lint' }]);

    const c1 = await repo.list({ kind: 'chat', id: 'c1' });
    expect(c1.map((r) => `${r.kind}:${r.match}`).sort()).toEqual(['command:git status', 'command:pnpm lint', 'tool:pnpm lint']);
    expect(c1.every((r) => r.createdAt instanceof Date && typeof r.id === 'string')).toBe(true);
    expect(await repo.list({ kind: 'chat', id: 'c2' })).toEqual([]);
    expect((await repo.list({ kind: 'run', id: 'r' })).map((r) => r.match)).toEqual(['pnpm lint']);
  });

  it('revokes one rule of its owner only, and clears', async () => {
    const { repo } = setup();
    await repo.add({ kind: 'chat', id: 'c1' }, [{ kind: 'command', match: 'ls' }, { kind: 'command', match: 'cat' }]);
    const [first] = await repo.list({ kind: 'chat', id: 'c1' });
    expect(await repo.remove({ kind: 'chat', id: 'c2' }, first!.id)).toBe(false);
    expect(await repo.remove({ kind: 'chat', id: 'c1' }, first!.id)).toBe(true);
    expect(await repo.list({ kind: 'chat', id: 'c1' })).toHaveLength(1);
    expect(await repo.clear({ kind: 'chat', id: 'c1' })).toBe(1);
    expect(await repo.list({ kind: 'chat', id: 'c1' })).toEqual([]);
  });

  it('removes the rows with their chat or run', async () => {
    const { s, repo } = setup();
    await repo.add({ kind: 'chat', id: 'c1' }, [{ kind: 'command', match: 'ls' }]);
    await repo.add({ kind: 'run', id: 'r' }, [{ kind: 'command', match: 'ls' }]);
    s.prepare(`DELETE FROM chats WHERE id = 'c1'`).run();
    s.prepare(`DELETE FROM workflow_runs WHERE id = 'r'`).run();
    expect((s.prepare(`SELECT COUNT(*) n FROM permission_rules`).get() as { n: number }).n).toBe(0);
  });

  it('refuses a row with no owner or two owners', () => {
    const { s } = setup();
    const insert = s.prepare(`INSERT INTO permission_rules (id, chat_id, run_id, kind, match, created_at) VALUES (?, ?, ?, 'command', 'ls', ?)`);
    expect(() => insert.run('x1', null, null, T)).toThrow();
    expect(() => insert.run('x2', 'c1', 'r', T)).toThrow();
  });

  it('v68: a project owns rules of its own, isolated from its chats, and they go with the project', async () => {
    const { s, repo } = setup();
    s.prepare(`INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES ('p1', 'P', '/tmp', ?, ?)`).run(T, T);
    await repo.add({ kind: 'project', id: 'p1' }, [{ kind: 'command', match: 'pnpm test' }]);
    await repo.add({ kind: 'project', id: 'p1' }, [{ kind: 'command', match: 'pnpm test' }]);
    await repo.add({ kind: 'chat', id: 'c1' }, [{ kind: 'command', match: 'pnpm test' }]);
    expect((await repo.list({ kind: 'project', id: 'p1' })).map((r) => r.match)).toEqual(['pnpm test']);
    expect(await repo.list({ kind: 'chat', id: 'c2' })).toEqual([]);
    // Exactly one owner per row.
    expect(() =>
      s.prepare(`INSERT INTO permission_rules (id, chat_id, project_id, kind, match, created_at) VALUES ('x', 'c1', 'p1', 'tool', 'Bash', ?)`).run(T),
    ).toThrow();
    s.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
    expect(await repo.list({ kind: 'project', id: 'p1' })).toEqual([]);
    expect((await repo.list({ kind: 'chat', id: 'c1' })).length).toBe(1);
  });
});

