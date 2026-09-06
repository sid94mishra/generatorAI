// ────────────────────────────────────────────────────────────────
// Schema convergence — review 5.10 / plan item 42.
//
// Three properties, each of which was false when 5.10 shipped:
//
//   1. A FRESH database has every column the code writes. `code_root` was
//      added by a bootstrap `safeAddColumn` that ran before v8 created the
//      table, was swallowed, and no test noticed because every developer's
//      database had been upgraded rather than created.
//   2. The Drizzle declarations in `schema.ts` describe tables and columns
//      that exist in a fresh database. (The reverse — every physical table
//      being declared — is deliberately NOT asserted: a third of the tables
//      are owned by raw-SQL repositories by design.)
//   3. A database UPGRADED from an old install converges on the same physical
//      shape as a fresh one. Migration source was edited in place at least
//      twice (v27 → v28, and the bootstrap block generally), so the two paths
//      had drifted apart with nothing to say so. Known, accepted drift is
//      listed EXPLICITLY below — adding to that list is a review decision,
//      not a way to make the test pass.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, migrateDB } from '../src/index.js';
import { MIGRATIONS } from '../src/migrations/index.js';
import * as schema from '../src/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_V11 = join(HERE, 'fixtures', 'schema-v11.sql');

type ColumnInfo = { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
type Shape = Map<string, Map<string, { type: string; notnull: number; dflt: string; pk: number }>>;

function raw(db: ReturnType<typeof createDB>): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function shapeOf(sqlite: Database.Database): Shape {
  const out: Shape = new Map();
  for (const t of tableNames(sqlite)) {
    const cols = sqlite.pragma(`table_info(${JSON.stringify(t)})`) as ColumnInfo[];
    const m = new Map<string, { type: string; notnull: number; dflt: string; pk: number }>();
    for (const c of cols) {
      m.set(c.name, {
        type: c.type.toUpperCase(),
        notnull: c.notnull,
        dflt: c.dflt_value === null || c.dflt_value === undefined ? '' : String(c.dflt_value),
        pk: c.pk,
      });
    }
    out.set(t, m);
  }
  return out;
}

function indexNames(sqlite: Database.Database): Set<string> {
  return new Set(
    (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name),
  );
}

const dirs: string[] = [];
/**
 * Every database opened by a test, closed before its directory is removed.
 * Windows refuses to delete a file that still has an open handle, so leaving a
 * connection open turns cleanup into an EPERM failure rather than a leak.
 */
const openDbs: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const db of openDbs.splice(0)) {
    try {
      db.close();
    } catch {
      // Already closed by the test — nothing to do.
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshDb() {
  const db = createDB(':memory:');
  migrateDB(db);
  openDbs.push({ close: () => closeDB(db) });
  return db;
}

/** Replay the v11 template's schema into a new file, then upgrade it with the real runner. */
function upgradedFromV11() {
  const dir = mkdtempSync(join(tmpdir(), 'gai-schema-v11-'));
  dirs.push(dir);
  const path = join(dir, 'old.db');
  const seed = new Database(path);
  seed.exec(readFileSync(FIXTURE_V11, 'utf8'));
  const v = (seed.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v;
  seed.close();
  expect(v).toBe(11);

  const db = createDB(path);
  migrateDB(db);
  openDbs.push({ close: () => closeDB(db) });
  return db;
}

describe('schema convergence (5.10 / item 42)', () => {
  it('a fresh database has execution_workspaces.code_root and accepts a workspace insert', () => {
    const db = freshDb();
    const sqlite = raw(db);
    const cols = (sqlite.pragma('table_info(execution_workspaces)') as ColumnInfo[]).map((c) => c.name);
    expect(cols).toContain('code_root');

    const now = Date.now();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO execution_workspaces (id, owner_type, owner_id, root_path, code_root, status, git_enabled, use_worktree, created_at, updated_at)
           VALUES ('ws1', 'chat', 'c1', '/tmp/ws1', '/tmp/ws1/repo', 'active', 0, 0, ?, ?)`,
        )
        .run(now, now),
    ).not.toThrow();
    const row = sqlite.prepare(`SELECT code_root FROM execution_workspaces WHERE id = 'ws1'`).get() as { code_root: string };
    expect(row.code_root).toBe('/tmp/ws1/repo');

    const version = (sqlite.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v;
    expect(version).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
    closeDB(db);
  });

  it('every Drizzle table and column declared in schema.ts exists in a fresh database', () => {
    const db = freshDb();
    const shape = shapeOf(raw(db));
    const missing: string[] = [];
    let declared = 0;
    for (const value of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>;
      try {
        cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
      } catch {
        continue; // not a table export (relations, enums, helpers)
      }
      declared += 1;
      const physical = shape.get(cfg.name);
      if (!physical) {
        missing.push(`table ${cfg.name}`);
        continue;
      }
      for (const col of cfg.columns) {
        if (!physical.has(col.name)) missing.push(`${cfg.name}.${col.name}`);
      }
    }
    expect(declared).toBeGreaterThan(30);
    expect(missing, 'schema.ts declares things a fresh migrateDB() does not create').toEqual([]);
    closeDB(db);
  });

  // Two complete migration chains — a fresh build AND a v11 upgrade — run
  // inside this one case. Vitest's 5 s default is enough on an idle machine
  // and not enough when the whole workspace suite is running beside it, which
  // made this fail only in CI-shaped conditions.
  it('a database upgraded from the v11 template converges on the fresh schema (explicit drift list)', () => {
    const fresh = freshDb();
    const upgraded = upgradedFromV11();
    const a = shapeOf(raw(fresh));
    const b = shapeOf(raw(upgraded));

    // ── Known, accepted drift between the two paths ──────────────────────
    // Each entry is a fact about databases that exist in the wild, not a
    // shortcut. Removing an entry requires a migration that reconciles the
    // two shapes; adding one requires explaining WHY the drift is acceptable.
    //
    // Format: `table.column` (column present on one path only) or
    // `index:<name>` (index present on one path only).
    // Empty on purpose. A fresh database and one upgraded from the v11
    // template now produce an identical schema, which is the property this
    // suite exists to hold. Adding an entry here is admitting a real
    // divergence between the two install paths, so each one needs a written
    // reason and a plan to remove it.
    const ACCEPTED_DRIFT = new Set<string>([]);

    const drift: string[] = [];
    for (const [table, colsA] of a) {
      const colsB = b.get(table);
      if (!colsB) {
        drift.push(`table ${table} (fresh only)`);
        continue;
      }
      for (const [name, defA] of colsA) {
        const defB = colsB.get(name);
        if (!defB) drift.push(`${table}.${name} (fresh only)`);
        else if (defA.type !== defB.type || defA.notnull !== defB.notnull || defA.pk !== defB.pk) {
          drift.push(`${table}.${name} (fresh ${JSON.stringify(defA)} vs upgraded ${JSON.stringify(defB)})`);
        }
      }
      for (const name of colsB.keys()) {
        if (!colsA.has(name)) drift.push(`${table}.${name} (upgraded only)`);
      }
    }
    for (const table of b.keys()) if (!a.has(table)) drift.push(`table ${table} (upgraded only)`);

    const idxA = indexNames(raw(fresh));
    const idxB = indexNames(raw(upgraded));
    for (const i of idxA) if (!idxB.has(i)) drift.push(`index:${i} (fresh only)`);
    for (const i of idxB) if (!idxA.has(i)) drift.push(`index:${i} (upgraded only)`);

    const unexpected = drift.filter((d) => {
      const key = d.replace(/ \(.*$/, '');
      return !ACCEPTED_DRIFT.has(key);
    });
    expect(unexpected, 'fresh and upgraded schemas differ beyond the accepted list').toEqual([]);

    // The accepted list must stay honest too: an entry that no longer drifts
    // is stale and must be removed, so the list cannot silently grow.
    const observed = new Set(drift.map((d) => d.replace(/ \(.*$/, '')));
    const stale = [...ACCEPTED_DRIFT].filter((k) => !observed.has(k));
    expect(stale, 'ACCEPTED_DRIFT entries that no longer drift').toEqual([]);

    closeDB(fresh);
    closeDB(upgraded);
  }, 30_000);

  it('migration versions are unique and contiguous from 1', () => {
    const versions = [...MIGRATIONS].map((m) => m.version).sort((x, y) => x - y);
    expect(new Set(versions).size).toBe(versions.length);
    // Contiguity matters because `_schema_versions` uses MAX(version): a gap
    // means a later fresh install can skip a number forever without anyone
    // noticing. Pre-assigned numbers held by in-flight branches show up here
    // as a gap — that is the signal, not noise.
    for (let i = 0; i < versions.length; i += 1) expect(versions[i]).toBe(i + 1);
  });
});
