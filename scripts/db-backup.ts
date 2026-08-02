#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// db-backup.ts — DB-02 safe SQLite backup script
//
// WAL mode means the committed writes can live in `<db>-wal` / `<db>-shm`
// files that only get folded into the main `.db` at checkpoint time.
// A naive `cp data.db backup.db` produces a broken backup because the
// latest writes are still in the WAL.
//
// This script:
//   1. Opens the DB in read-write mode (required for the checkpoint).
//   2. Runs `PRAGMA wal_checkpoint(TRUNCATE)` to flush WAL → main file and
//      truncate the WAL back to zero bytes.
//   3. Uses SQLite's online-backup API (`db.backup()`) to atomically copy
//      the main file to the destination. `db.backup()` handles concurrent
//      writers correctly and doesn't need the source to be idle.
//
// Usage:
//   pnpm db:backup [source.db] [destination.db]
//
// Defaults to `~/.generatorai/data.db` and `<dest-dir>/data-<timestamp>.db`.
// ────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

async function main(): Promise<void> {
  const [, , srcArg, destArg] = process.argv;
  const src = resolve(expandHome(srcArg ?? '~/.generatorai/data.db'));
  if (!existsSync(src)) {
    console.error(`[db-backup] Source DB not found: ${src}`);
    process.exit(2);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = basename(src, extname(src));
  const defaultDest = resolve(
    expandHome(`~/.generatorai/backups/${baseName}-${stamp}.db`),
  );
  const dest = destArg ? resolve(expandHome(destArg)) : defaultDest;

  mkdirSync(dirname(dest), { recursive: true });

  const db = new Database(src);
  try {
    // Step 1 — force-flush WAL into main file. TRUNCATE also shrinks the WAL
    // back to zero bytes so we don't preserve it in the backup.
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const cp = checkpoint[0];
    if (cp && cp.busy !== 0) {
      console.warn(
        `[db-backup] WAL checkpoint reported busy=${cp.busy} — some writers were active; backup will still be consistent but the WAL could not be fully truncated.`,
      );
    }

    // Step 2 — online backup. This is an atomic, lock-aware copy that works
    // even if other writers are active; the copy is point-in-time consistent.
    await db.backup(dest);
    console.log(`[db-backup] ✓ Backup written: ${dest}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`[db-backup] Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
