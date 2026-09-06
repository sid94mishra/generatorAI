// ────────────────────────────────────────────────────────────────
// `safeAddColumnOn` pins its three swallowed SQLite error strings against
// the SQLite build actually linked into better-sqlite3. The helper matches on
// message SUBSTRINGS; if SQLite ever rewords one, the helper's behaviour flips
// silently (a swallowed error becomes a thrown one, or worse, a thrown one
// becomes swallowed). This is the regression class behind review 5.10.
// ────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { SAFE_ADD_COLUMN_SWALLOWED, safeAddColumnOn } from '../src/migrations/index.js';

function fresh(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, a TEXT)`);
  return db;
}

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('expected the statement to throw');
}

describe('safeAddColumnOn — swallowed SQLite error wording', () => {
  it('pins exactly three swallowed substrings', () => {
    expect([...SAFE_ADD_COLUMN_SWALLOWED]).toEqual(['duplicate column', 'already exists', 'no such table']);
  });

  it('"duplicate column": the real SQLite message contains the pinned substring and is swallowed', () => {
    const db = fresh();
    const msg = messageOf(() => db.exec(`ALTER TABLE t ADD COLUMN a TEXT`));
    expect(msg).toContain('duplicate column');
    expect(() => safeAddColumnOn(db, `ALTER TABLE t ADD COLUMN a TEXT`)).not.toThrow();
  });

  it('"no such table": the real SQLite message contains the pinned substring and is swallowed', () => {
    const db = fresh();
    const msg = messageOf(() => db.exec(`ALTER TABLE nope ADD COLUMN a TEXT`));
    expect(msg).toContain('no such table');
    // This is the 5.10 hazard: swallowed means "the table is created later
    // and owns the column". A column added this way for a table the bootstrap
    // block does not create never lands on a fresh database.
    expect(() => safeAddColumnOn(db, `ALTER TABLE nope ADD COLUMN a TEXT`)).not.toThrow();
  });

  it('"already exists": the real SQLite message contains the pinned substring and is swallowed', () => {
    const db = fresh();
    const msg = messageOf(() => db.exec(`CREATE TABLE t (id TEXT)`));
    expect(msg).toContain('already exists');
    expect(() => safeAddColumnOn(db, `CREATE INDEX idx_t_a ON t(a); CREATE INDEX idx_t_a ON t(a)`)).not.toThrow();
  });

  it('every other error is re-thrown', () => {
    const db = fresh();
    // SQLite accepts a NOT NULL column without a default on an EMPTY table, so
    // the table needs a row for this to be a genuine failure rather than a
    // no-op that would pass this assertion for the wrong reason.
    db.exec(`INSERT INTO t (id, a) VALUES ('1', 'x')`);
    expect(() => safeAddColumnOn(db, `ALTER TABLE t ADD COLUMN b TEXT NOT NULL`)).toThrow(/NOT NULL/);
    expect(() => safeAddColumnOn(db, `THIS IS NOT SQL`)).toThrow(/syntax error/);
  });
});
