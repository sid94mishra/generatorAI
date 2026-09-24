// ────────────────────────────────────────────────────────────────
// Fresh-DB baseline + migration lock (workflow overhaul P00 WP-0.6b; review
// R10–R12).
//
//   1. An EMPTY database reaches head through `baseline.sql`, is stamped
//      v1..BASELINE_VERSION, and matches `schema.ts` in BOTH directions
//      (declared → physical exactly; physical → declared up to an explicit
//      allowlist of raw-SQL-owned columns, defaults, indexes and FKs).
//   2. The REAL developer schema at v52 (`fixtures/schema-v52-dev.sql`,
//      dumped from a copy of the developer DB by
//      `scripts/workflow-dbcopy-upgrade.mjs --dump-schema`: DDL and migration
//      names only, no user rows) plus synthetic chats/sessions/messages
//      reaches head through the historic path with those rows unchanged, and
//      converges on the fresh schema up to an explicit drift allowlist that
//      P01's v55 must empty.
//   3. A v52 database BUILT by the migrations converges exactly, and the
//      baseline's DDL equals the historic path's.
//   4. Two connections opening the same empty file cannot both apply the
//      baseline (BEGIN IMMEDIATE + re-check).
//   5. The baseline and the lock are in step with MIGRATIONS.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, migrateDB } from '../src/index.js';
import { BASELINE_VERSION, MIGRATIONS, applyBaselineIfEmpty, chooseMigrationRoute } from '../src/migrations/index.js';
import { BASELINE_SQL } from '../src/migrations/baseline.generated.js';
import * as schema from '../src/schema.js';
import { diffShapes, schemaShape } from '../scripts/schemaShape.js';
// @ts-expect-error — plain .mjs lint script, no type declarations
import { compareLock } from '../../../scripts/check-migrations-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', 'src', 'migrations');
const DEV_SCHEMA_V52 = join(HERE, 'fixtures', 'schema-v52-dev.sql');
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

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gai-baseline-'));
  dirs.push(dir);
  return join(dir, name);
}

function fileDb(file: string): Db {
  const db = createDB(file);
  open.push(db);
  return db;
}

/** Chats, a chat session and a stage session with messages, as the developer DB holds them. */
function seedChats(s: Database.Database): void {
  const now = Date.now();
  const session = s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  session.run('s-chat', 'Chat: kept', 'active', now, now, 'chat-conv', 'chat', 'c1');
  session.run('s-stage', 'Stage session', 'closed', now, now, 'stage-conv', 'stage_run', 'sr1');
  s.prepare(`INSERT INTO chats (id, name, status, session_id, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)`).run(
    'c1',
    'kept chat',
    's-chat',
    now,
    now,
  );
  const msg = s.prepare(`INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  msg.run('m1', 's-chat', 'user', 'hello', now, 'c1', null);
  msg.run('m2', 's-chat', 'assistant', 'hi there — ünïcode ✓', now + 1, 'c1', '{"turnId":"t1"}');
  msg.run('m3', 's-stage', 'assistant', 'stage transcript', now + 2, null, '{"stageRunId":"sr1"}');
}

function chatSnapshot(db: Db) {
  return {
    sessions: raw(db).prepare(`SELECT id, owner_type, owner_id, status, conversation_id FROM sessions ORDER BY id`).all(),
    chats: raw(db).prepare(`SELECT id, name, session_id, status FROM chats ORDER BY id`).all(),
    messages: raw(db).prepare(`SELECT id, session_id, role, content, timestamp, chat_id, metadata FROM chat_messages ORDER BY id`).all(),
  };
}

// ── Allowlists (each entry is a known, accepted difference; emptying them is P01's job) ──

/**
 * Real developer schema (v52, upgraded over many releases) vs a fresh
 * database at head. P01's v55 (`workflow_definitions_v2`) rebuilds these
 * tables and must reconcile every entry, then delete it here.
 */
const DEV_SCHEMA_DRIFT = [
  'column chats.selected_artifacts: only in upgraded', // bootstrap column dropped from schema.ts, never physically dropped
  'column conversation_instance_ownership.binding_origin: dflt upgraded=\'explicit\' fresh=\'migrated-ambiguous\'', // migration default edited in place before the lock existed
  'column stage_definitions.selected_artifacts: only in upgraded', // same as chats.selected_artifacts
  'column-order chats', // ADD COLUMN order differs between install paths
  'column-order stage_definitions',
  'column-order stage_runs',
  'index idx_idempotency_keys_expires: only in fresh', // index renamed in migration source after it shipped
  'index idx_idempotency_keys_scope_expires: only in upgraded',
].sort();

/**
 * Physical → declared (fresh DB vs schema.ts), for tables schema.ts
 * declares. Raw-SQL repositories own some columns, defaults, indexes and
 * FKs by design; each is listed so a NEW undeclared one fails.
 */
const REVERSE_SCHEMA_ALLOWLIST: string[] = [
  // Legacy `copilot_config*` columns kept physically after the harness rename
  // (Phase 13 note in migrations/index.ts); P01's v55 drops them.
  'extra column chats.copilot_config',
  'extra column stage_definitions.copilot_config_overrides',
  'extra column workflow_definitions.copilot_config',
  'extra column workflows.copilot_config_overrides',
  // Defaults that disagree with schema.ts. The repositories always write the
  // column, so neither default is observed today.
  "default chats.default_agent_mode: physical='interactive' schema='auto'",
  "default system_configs.metadata: physical=(none) schema='{}'",
  // Physical FK / indexes created by raw-SQL migrations and never declared.
  'fk workflow_runs ancestor_run_id->workflow_runs.id: not declared',
  'index idx_agent_interactions_pending on agent_interactions: not declared',
  'index idx_chat_messages_chat_time on chat_messages: not declared',
  'index idx_chats_forked_from on chats: not declared',
  'index idx_stage_runs_parent on stage_runs: not declared',
  'index idx_stage_runs_run_status on stage_runs: not declared',
  'index idx_stream_cursors_kind_ts on stream_cursors: not declared',
  'index idx_workflow_runs_ancestor on workflow_runs: not declared',
  'index idx_workspace_artifacts_type on workspace_artifacts: not declared',
  // Declared in schema.ts but never created by any migration (drizzle-kit
  // would create them; migrateDB does not).
  'index idx_automations_scope on automations: declared, missing',
  'index idx_workflow_defs_scope on workflow_definitions: declared, missing',
  'index idx_workflow_runs_project on workflow_runs: declared, missing',
  'index pk_idempotency_keys on idempotency_keys: declared, missing',
  'index pk_stream_sequences on stream_sequences: declared, missing',
];

/** Every physical column/default/index/FK of a declared table that schema.ts does not declare. */
function reverseSchemaDiff(sqlite: Database.Database): string[] {
  const out: string[] = [];
  for (const value of Object.values(schema)) {
    let cfg: ReturnType<typeof getTableConfig>;
    try {
      cfg = getTableConfig(value as SQLiteTable);
    } catch {
      continue;
    }
    const phys = sqlite.pragma(`table_info(${JSON.stringify(cfg.name)})`) as Array<{ name: string; dflt_value: unknown }>;
    const declared = new Map(cfg.columns.map((c) => [c.name, c]));
    for (const p of phys) {
      const col = declared.get(p.name);
      if (!col) {
        out.push(`extra column ${cfg.name}.${p.name}`);
        continue;
      }
      const physDefault = p.dflt_value === null || p.dflt_value === undefined ? '' : String(p.dflt_value);
      const d = (col as { default?: unknown }).default;
      let schemaDefault = '';
      if (col.hasDefault && d !== undefined) {
        if (typeof d === 'string') schemaDefault = `'${d.replace(/'/g, "''")}'`;
        else if (typeof d === 'number' || typeof d === 'bigint') schemaDefault = String(d);
        else if (typeof d === 'boolean') schemaDefault = d ? '1' : '0';
        else if (d && typeof d === 'object' && 'queryChunks' in (d as object)) continue; // sql`…` default: not comparable textually
        else schemaDefault = `'${JSON.stringify(d)}'`;
      }
      if (physDefault !== schemaDefault) {
        out.push(`default ${cfg.name}.${p.name}: physical=${physDefault || '(none)'} schema=${schemaDefault || '(none)'}`);
      }
    }
    const physIdx = (
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`).all(cfg.name) as Array<{ name: string }>
    ).map((r) => r.name);
    const declIdx = cfg.indexes.map((i) => i.config.name);
    for (const n of physIdx) if (!declIdx.includes(n)) out.push(`index ${n} on ${cfg.name}: not declared`);
    for (const n of declIdx) if (!physIdx.includes(n)) out.push(`index ${n} on ${cfg.name}: declared, missing`);
    const physFk = (sqlite.pragma(`foreign_key_list(${JSON.stringify(cfg.name)})`) as Array<{ from: string; table: string; to: string }>).map(
      (f) => `${f.from}->${f.table}.${f.to}`,
    );
    const declFk = cfg.foreignKeys.flatMap((fk) => {
      const r = fk.reference();
      const target = getTableConfig(r.foreignTable).name;
      return r.columns.map((c, i) => `${c.name}->${target}.${r.foreignColumns[i]!.name}`);
    });
    for (const f of physFk) if (!declFk.includes(f)) out.push(`fk ${cfg.name} ${f}: not declared`);
    for (const f of declFk) if (!physFk.includes(f)) out.push(`fk ${cfg.name} ${f}: declared, missing`);
  }
  return out.sort();
}

describe('fresh-DB baseline (P00 WP-0.6b)', () => {
  it('is generated at the head migration and matches baseline.sql', () => {
    expect(BASELINE_VERSION).toBe(HEAD);
    const file = readFileSync(join(MIGRATIONS_DIR, 'baseline.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(BASELINE_SQL).toBe(file);
  });

  it('an empty database reaches head through the baseline and matches schema.ts (declared → physical)', () => {
    const db = memory();
    expect(chooseMigrationRoute(raw(db))).toEqual({ kind: 'baseline' });
    migrateDB(db);

    expect(versions(db)).toEqual(
      [...MIGRATIONS].sort((a, b) => a.version - b.version).map((m) => ({ version: m.version, name: m.name })),
    );

    const sqlite = raw(db);
    const problems: string[] = [];
    let declared = 0;
    for (const value of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>;
      try {
        cfg = getTableConfig(value as SQLiteTable);
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
        if (col.notNull && !col.primary && phys.notnull !== 1) problems.push(`${cfg.name}.${col.name} nullable`);
      }
    }
    expect(declared).toBeGreaterThan(30);
    expect(problems, 'schema.ts declares what the baseline does not create').toEqual([]);
  });

  it('matches schema.ts in reverse (physical → declared) up to an explicit allowlist', () => {
    const db = memory();
    migrateDB(db);
    expect(reverseSchemaDiff(raw(db))).toEqual([...REVERSE_SCHEMA_ALLOWLIST].sort());
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

  it('two connections opening the same empty file apply the baseline once', () => {
    const file = tempFile('race.db');
    const a = fileDb(file);
    const b = fileDb(file);
    // Both saw an empty database; B wins the race and migrates first.
    expect(chooseMigrationRoute(raw(a))).toEqual({ kind: 'baseline' });
    migrateDB(b);
    // A's baseline attempt re-checks inside BEGIN IMMEDIATE and backs off.
    expect(applyBaselineIfEmpty(raw(a))).toBe(false);
    expect(() => migrateDB(a)).not.toThrow();
    expect(versions(a)).toHaveLength(MIGRATIONS.length);
    expect(ddl(a)).toEqual(ddl(b));
  });

  it('the REAL developer schema at v52 reaches head via the historic path, chats intact, drift allowlisted', () => {
    const file = tempFile('dev-v52.db');
    const seed = fileDb(file);
    raw(seed).exec(readFileSync(DEV_SCHEMA_V52, 'utf8'));
    expect((raw(seed).prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(52);
    seedChats(raw(seed));
    const before = chatSnapshot(seed);

    expect(chooseMigrationRoute(raw(seed))).toEqual({ kind: 'legacy' });
    migrateDB(seed);
    expect((raw(seed).prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(HEAD);
    expect(chatSnapshot(seed)).toEqual(before);

    const fresh = memory();
    migrateDB(fresh);
    expect(diffShapes(schemaShape(raw(seed)), schemaShape(raw(fresh)), ['upgraded', 'fresh'])).toEqual(DEV_SCHEMA_DRIFT);
  });

  it('a v52 database built by the migrations reaches head with its chats intact and identical DDL', () => {
    const file = tempFile('v52.db');
    const seed = createDB(file);
    migrateDB(seed, { targetVersion: 52 });
    expect((raw(seed).prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(52);
    seedChats(raw(seed));
    const before = chatSnapshot(seed);
    closeDB(seed);

    const db = fileDb(file);
    expect(chooseMigrationRoute(raw(db))).toEqual({ kind: 'legacy' });
    migrateDB(db);
    expect((raw(db).prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(HEAD);
    expect(chatSnapshot(db)).toEqual(before);
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
