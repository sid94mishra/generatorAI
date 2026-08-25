#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// db-reclaim.ts — W02 one-off storage reclaim
//
// The background retention sweeper (EventRetentionService) deletes rows, but
// SQLite parks the freed pages on its free list; the file never shrinks. On a
// database that has been running with retention effectively disabled, that
// means ~1.4 GB of a 1.76 GB file is dead space that a bounded sweep can never
// return.
//
// This script is the maintenance-window half of that story:
//   1. Aggressively sweeps expired rows in bounded batches until nothing is
//      left above the TTL, so VACUUM has as little to copy as possible.
//   2. Switches the database to `auto_vacuum=INCREMENTAL` so future sweeps can
//      reclaim pages on their own. This setting only takes effect on the next
//      full VACUUM, which is why it is set here rather than at boot.
//   3. Runs a full VACUUM, which rewrites the file and returns the free pages
//      to the filesystem.
//   4. Runs ANALYZE so the planner has statistics for the newly compacted file.
//
// VACUUM takes an exclusive lock. SQLite documents that it may need up to
// TWICE the size of the database in free space (the rewrite plus the journal),
// so the script checks for that before starting. It also refuses to run while
// another process holds the database, because in WAL mode the mode switch
// silently no-ops and the whole reclaim reports success while doing nothing.
//
// Usage:
//   pnpm db:reclaim [path/to/data.db] [--ttl-days N] [--dry-run]
//
// With no path it resolves GENERATORAI_DB_PATH, then the same default the
// server uses (~/.generatorai/data.db). It always prints the resolved path
// before touching anything — reclaiming the wrong file and reporting "0 MB
// reclaimed" is the most likely way to waste a maintenance window.
// ────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, statSync, statfsSync } from 'node:fs';

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Tables pruned by TTL, and the epoch-ms column each one is aged by. */
const TTL_TABLES: ReadonlyArray<{ table: string; tsColumn: string }> = [
  { table: 'events', tsColumn: 'timestamp' },
  { table: 'stream_cursors', tsColumn: 'ts' },
];

const BATCH = 50_000;

/**
 * Must match `AppConfig.database.eventPayloadTtlDays`. Defaulting lower than
 * the server's retention policy means the documented recovery procedure quietly
 * deletes history the policy says to keep.
 */
const DEFAULT_TTL_DAYS = 30;

/** The server's own default. Kept in sync with `AppConfig`. */
const DEFAULT_DB_PATH = '~/.generatorai/data.db';

function resolveDbPath(positional: string | undefined): string {
  const raw = positional ?? process.env['GENERATORAI_DB_PATH'] ?? DEFAULT_DB_PATH;
  return resolve(expandHome(raw));
}

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const ttlIdx = args.indexOf('--ttl-days');
  const ttlDays = ttlIdx >= 0 ? Number(args[ttlIdx + 1]) : DEFAULT_TTL_DAYS;

  if (!Number.isFinite(ttlDays) || ttlDays < 1) {
    console.error('[db-reclaim] --ttl-days must be a positive number');
    process.exit(2);
  }

  const dbPath = resolveDbPath(positional[0]);
  console.log(`[db-reclaim] resolved database: ${dbPath}`);
  if (!existsSync(dbPath)) {
    console.error(
      `[db-reclaim] Database not found: ${dbPath}\n` +
        '[db-reclaim] Pass the path explicitly or set GENERATORAI_DB_PATH.',
    );
    process.exit(2);
  }

  const sizeBefore = statSync(dbPath).size;
  console.log(`[db-reclaim] size before: ${mib(sizeBefore)}`);
  console.log(`[db-reclaim] TTL: ${ttlDays} days${dryRun ? ' (dry run)' : ''}`);

  if (!dryRun) {
    // 2x, per SQLite's own VACUUM documentation. Running out of space midway
    // aborts the rewrite and leaves the original intact, but it burns the
    // window and can leave the journal mode switched.
    try {
      const fsStat = statfsSync(dirname(dbPath));
      const free = fsStat.bavail * fsStat.bsize;
      const needed = sizeBefore * 2;
      console.log(`[db-reclaim] free space: ${mib(free)} (VACUUM needs ~${mib(needed)})`);
      if (free < needed) {
        console.error('[db-reclaim] not enough free disk space for VACUUM — aborting');
        process.exit(2);
      }
    } catch {
      console.warn('[db-reclaim] could not check free space; continuing');
    }
  }

  const db = new Database(dbPath);
  db.pragma('busy_timeout = 30000');

  // Before deleting anything: prove nobody else holds the file. In WAL mode the
  // `journal_mode = DELETE` switch below silently returns `wal`, `auto_vacuum`
  // becomes a no-op, and the operator is told only AFTER millions of rows are
  // gone and a full rewrite has been attempted.
  if (!dryRun) {
    try {
      db.pragma('locking_mode = EXCLUSIVE');
      db.exec('BEGIN EXCLUSIVE');
      db.exec('COMMIT');
    } catch (err) {
      db.close();
      console.error(
        '[db-reclaim] another process is holding the database — stop the server first.\n' +
          `[db-reclaim] ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    }
  }

  let restoreWal = false;
  try {
    reclaim(db, ttlDays, dryRun, () => {
      restoreWal = true;
    });
  } finally {
    // Always leave the file in the mode the server expects, even on a throw
    // halfway through the rewrite.
    if (restoreWal) {
      try {
        db.pragma('journal_mode = WAL');
      } catch {
        /* reported below by the verification read */
      }
    }
  }

  if (dryRun) {
    db.close();
    console.log('[db-reclaim] dry run complete — nothing was modified');
    return;
  }

  // Verify rather than assume. If this reports anything but 2, the background
  // sweeper's incremental reclaim will be silently inert and the file will grow
  // again — which is the exact failure this script exists to end.
  const autoVacuum = Number(db.pragma('auto_vacuum', { simple: true }));
  const journalMode = String(db.pragma('journal_mode', { simple: true }));
  db.close();

  const sizeAfter = statSync(dbPath).size;
  console.log(`[db-reclaim] size after: ${mib(sizeAfter)}`);
  console.log(`[db-reclaim] reclaimed: ${mib(sizeBefore - sizeAfter)}`);
  console.log(`[db-reclaim] journal_mode=${journalMode} auto_vacuum=${autoVacuum}`);

  if (autoVacuum !== 2) {
    console.error(
      '[db-reclaim] FAILED to set auto_vacuum=INCREMENTAL (got ' +
        `${autoVacuum}). Background reclaim will do nothing. Re-run with the ` +
        'server fully stopped and no other process holding the database.',
    );
    process.exit(1);
  }
  if (journalMode.toLowerCase() !== 'wal') {
    console.error(
      `[db-reclaim] journal_mode is ${journalMode}, expected wal. ` +
        'Start the server to restore it before relying on concurrent reads.',
    );
    process.exit(1);
  }
}

function reclaim(
  db: Database.Database,
  ttlDays: number,
  dryRun: boolean,
  markWalNeedsRestore: () => void,
): void {
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

  for (const { table, tsColumn } of TTL_TABLES) {
    const doomed = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${tsColumn} < ?`)
      .get(cutoff) as { n: number };
    console.log(`[db-reclaim] ${table}: ${doomed.n} rows older than the TTL`);
    if (dryRun || doomed.n === 0) continue;

    const del = db.prepare(
      `DELETE FROM ${table} WHERE rowid IN (
         SELECT rowid FROM ${table} WHERE ${tsColumn} < ? ORDER BY ${tsColumn} ASC LIMIT ?
       )`,
    );
    let removed = 0;
    for (;;) {
      const changes = del.run(cutoff, BATCH).changes;
      if (changes === 0) break;
      removed += changes;
      process.stdout.write(`\r[db-reclaim] ${table}: deleted ${removed}/${doomed.n}`);
    }
    process.stdout.write('\n');
  }

  if (dryRun) return;

  // `auto_vacuum` can only change on a full rewrite, and SQLite documents that
  // the change does not take effect via VACUUM while the database is in WAL
  // mode. Leaving WAL is therefore mandatory, not tidiness.
  console.log('[db-reclaim] checkpointing WAL and leaving WAL mode');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  markWalNeedsRestore();

  console.log('[db-reclaim] setting auto_vacuum=INCREMENTAL');
  db.pragma('auto_vacuum = INCREMENTAL');

  console.log('[db-reclaim] running VACUUM (this rewrites the whole file)');
  const vacuumStart = Date.now();
  db.exec('VACUUM');
  console.log(`[db-reclaim] VACUUM finished in ${Math.round((Date.now() - vacuumStart) / 1000)}s`);

  console.log('[db-reclaim] running ANALYZE');
  db.exec('ANALYZE');
}

main();
