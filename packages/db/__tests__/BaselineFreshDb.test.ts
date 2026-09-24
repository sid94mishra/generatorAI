// ────────────────────────────────────────────────────────────────
// Fresh-DB baseline + migration lock (workflow overhaul P00 WP-0.6b).
//
//   1. An EMPTY database reaches head through `baseline.sql`, is stamped
//      v1..BASELINE_VERSION, and matches `schema.ts` (drizzle introspection).
//   2. A v52 database (the developer DB's version on 2026-09-24) reaches head
//      through the historic path, keeping its chats, sessions and messages.
//   3. Both end with IDENTICAL `sqlite_master` DDL, which is also what the
//      historic path produces on an empty database.
//   4. The baseline and the lock are in step with MIGRATIONS.
//
// The v52 fixture is BUILT (`migrateDB(..., { targetVersion: 52 })` plus
// chat and stage-session rows) rather than copied from a backup: the real DB
// is ~310 MB of personal chats and cannot be anonymised cheaply. The same
// upgrade was exercised on a copy of the real DB in the P00 gate (STATUS.md).
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, migrateDB } from '../src/index.js';
import { BASELINE_VERSION, MIGRATIONS, chooseMigrationRoute } from '../src/migrations/index.js';
import { BASELINE_SQL } from '../src/migrations/baseline.generated.js';
import * as schema from '../src/schema.js';
// @ts-expect-error — plain .mjs lint script, no type declarations
import { compareLock } from '../../../scripts/check-migrations-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', 'src', 'migrations');
const HEAD = Math.max(...MIGRATIONS.map((m) => m.version));

type Db = ReturnType<typeof createDB>;
const raw = (db: Db): Database.Database => (db as unknown as { session: { client: Database.Database } }).session.client;

/** `sqlite_master` DDL as a sorted, line-ending-normalised list. */
function ddl(db: Db): string[] {
  return (
    raw(db)
      .prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ type: string; name: string; sql: string }>
  )
    .map((r) => `${r.type} ${r.name}: ${r.sql.replace(/\r\n/g, '\n').trim()}`)
    .sort();
}

const versions = (db: Db) =>
  raw(db).prepare(`SELECT version, name FROM _schema_versions ORDER BY version`).all() as Array<{ version: number; name: string }>;

const dirs: string[] = [];
const open: Db[] = [];
afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      closeDB(db);
    } catch {
      /* closed */
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function memory(): Db {
  const db = createDB(':memory:');
  open.push(db);
  return db;
}

describe('fresh-DB baseline (P00 WP-0.6b)', () => {
  it('is generated at the head migration and matches baseline.sql', () => {
    expect(BASELINE_VERSION).toBe(HEAD);
    const file = readFileSync(join(MIGRATIONS_DIR, 'baseline.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(BASELINE_SQL).toBe(file);
  });

  it('an empty database reaches head through the baseline and matches schema.ts', () => {
    const db = memory();
    expect(chooseMigrationRoute(raw(db))).toEqual({ kind: 'baseline' });
    migrateDB(db);

    expect(versions(db)).toEqual(
      [...MIGRATIONS].sort((a, b) => a.version - b.version).map((m) => ({ version: m.version, name: m.name })),
    );

    // Drizzle introspection: every declared table and column exists, with the
    // declared SQL type and nullability.
    const sqlite = raw(db);
    const problems: string[] = [];
    let declared = 0;
    for (const value of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>;
      try {
        cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
      } catch {
        continue;
      }
      declared++;
      const cols = new Map(
        (sqlite.pragma(`table_info(${JSON.stringify(cfg.name)})`) as Array<{ name: string; type: string; notnull: number; pk: number }>).map(
          (c) => [c.name, c],
        ),
      );
      if (cols.size === 0) {
        problems.push(`table ${cfg.name} missing`);
        continue;
      }
      for (const col of cfg.columns) {
        const phys = cols.get(col.name);
        if (!phys) {
          problems.push(`${cfg.name}.${col.name} missing`);
          continue;
        }
        if (phys.type.toUpperCase() !== col.getSQLType().toUpperCase()) {
          problems.push(`${cfg.name}.${col.name} type ${phys.type} ≠ ${col.getSQLType()}`);
        }
        // A NOT NULL declared in schema.ts must hold physically (primary keys
        // are implicitly non-null in SQLite's table_info only for INTEGER PKs).
        if (col.notNull && !col.primary && phys.notnull !== 1) problems.push(`${cfg.name}.${col.name} nullable`);
      }
    }
    expect(declared).toBeGreaterThan(30);
    expect(problems, 'schema.ts disagrees with the baseline schema').toEqual([]);
  });

  it('produces exactly the DDL the historic path produces', () => {
    const viaBaseline = memory();
    migrateDB(viaBaseline);
    const viaHistory = memory();
    migrateDB(viaHistory, { path: 'legacy' });
    expect(ddl(viaBaseline)).toEqual(ddl(viaHistory));
  });

  it('a database at the baseline skips the legacy bootstrap and is left unchanged', () => {
    const db = memory();
    migrateDB(db);
    const before = ddl(db);
    expect(chooseMigrationRoute(raw(db))).toEqual({ kind: 'versioned', currentVersion: HEAD });
    migrateDB(db);
    expect(ddl(db)).toEqual(before);
    expect(versions(db)).toHaveLength(MIGRATIONS.length);
  });

  it('a v52 database reaches head through the historic path with its chats intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gai-baseline-'));
    dirs.push(dir);
    const file = join(dir, 'v52.db');

    // Build the fixture: schema at v52, then a chat, a stage session and
    // messages for both, as the developer DB holds them.
    const seed = createDB(file);
    migrateDB(seed, { targetVersion: 52 });
    const s = raw(seed);
    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(52);
    const now = Date.now();
    s.prepare(
      `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`,
    ).run('s-chat', 'Chat: kept', now, now, 'chat-conv', 'chat', 'c1');
    s.prepare(
      `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id)
       VALUES (?, ?, 'closed', ?, ?, ?, ?, ?)`,
    ).run('s-stage', 'Stage session', now, now, 'stage-conv', 'stage_run', 'sr1');
    s.prepare(`INSERT INTO chats (id, name, status, session_id, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)`).run(
      'c1',
      'kept chat',
      's-chat',
      now,
      now,
    );
    const msg = s.prepare(`INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id) VALUES (?, ?, ?, ?, ?, ?)`);
    msg.run('m1', 's-chat', 'user', 'hello', now, 'c1');
    msg.run('m2', 's-chat', 'assistant', 'hi there', now + 1, 'c1');
    msg.run('m3', 's-stage', 'assistant', 'stage transcript', now + 2, null);
    const snapshot = (db: Db) => ({
      sessions: raw(db).prepare(`SELECT id, owner_type, status FROM sessions ORDER BY id`).all(),
      chats: raw(db).prepare(`SELECT id, name, session_id FROM chats ORDER BY id`).all(),
      messages: raw(db).prepare(`SELECT id, session_id, role, content FROM chat_messages ORDER BY id`).all(),
    });
    const before = snapshot(seed);
    closeDB(seed);

    // Upgrade exactly as a server boot does.
    const db = createDB(file);
    open.push(db);
    expect(chooseMigrationRoute(raw(db))).toEqual({ kind: 'legacy' });
    migrateDB(db);
    expect((raw(db).prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(HEAD);
    expect(snapshot(db)).toEqual(before);

    // …and converges on the fresh (baseline) schema.
    const fresh = memory();
    migrateDB(fresh);
    expect(ddl(db)).toEqual(ddl(fresh));
  });
});

describe('migrations lock (P00 WP-0.6b)', () => {
  it('locks every migration, unchanged', () => {
    const lock = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'migrations.lock.json'), 'utf8'));
    expect(compareLock(MIGRATIONS, lock)).toEqual([]);
  });

  it('flags an edited, a missing and an orphaned entry', () => {
    const lock = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'migrations.lock.json'), 'utf8'));
    const edited = MIGRATIONS.map((m) => (m.version === 3 ? { ...m, sql: [...m.sql, 'SELECT 1;'] } : m));
    const problems: string[] = compareLock(
      [...edited, { version: HEAD + 1, name: 'new_one', sql: ['SELECT 1;'] }],
      { ...lock, 999: 'deadbeef' },
    );
    expect(problems.some((p) => p.startsWith('v3 ') && p.includes('changed after it was locked'))).toBe(true);
    expect(problems.some((p) => p.startsWith(`v${HEAD + 1} `) && p.includes('no lock entry'))).toBe(true);
    expect(problems.some((p) => p.includes('lock entry v999 has no migration'))).toBe(true);
  });
});
