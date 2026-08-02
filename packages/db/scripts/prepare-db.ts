#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// prepare-db.ts — create a clean, fully-migrated SQLite database.
//
// One script, two modes, so distribution and local-dev reset share the exact
// same migration path (no drift between "what ships" and "what dev uses"):
//
//   reset         (Re)create a working database. Deletes any existing file and
//                 its WAL/SHM sidecars first, then creates + migrates a fresh,
//                 EMPTY database. Use this for a clean local-dev slate.
//                 Default path: ~/.generatorai/data.db (override with [path]).
//                 Deleting the DEFAULT runtime DB requires --force (guards
//                 against accidentally wiping working data).
//
//   prepare-dist  Create a clean, empty, migrated TEMPLATE database for shipping
//                 inside SDK/CLI/Web distributions. Writes to
//                 packages/db/data/template.db by default. End users copy this
//                 to their runtime location on first run instead of paying the
//                 migration cost (and to guarantee a known-good schema).
//
// After creating the DB it runs `PRAGMA wal_checkpoint(TRUNCATE)` so the result
// is a single self-contained `.db` file with no leftover WAL/SHM sidecars —
// safe to copy/ship.
//
// Usage:
//   pnpm db:reset [path]
//   pnpm db:prepare-dist [path]
//   tsx packages/db/scripts/prepare-db.ts <reset|prepare-dist> [path]
// ────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createDB, migrateDB, closeDB } from '../src/index.js';

type Mode = 'reset' | 'prepare-dist';

const HERE = dirname(fileURLToPath(import.meta.url));

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Remove a SQLite database file together with its WAL/SHM sidecars. */
function removeDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const f = `${dbPath}${suffix}`;
    if (existsSync(f)) rmSync(f);
  }
}

function defaultPathFor(mode: Mode): string {
  return mode === 'prepare-dist'
    ? resolve(HERE, '..', 'data', 'template.db')
    : resolve(expandHome('~/.generatorai/data.db'));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [modeArg, pathArg] = positional;
  const mode = modeArg as Mode;
  if (mode !== 'reset' && mode !== 'prepare-dist') {
    console.error(`[prepare-db] Unknown mode "${modeArg ?? ''}". Use "reset" or "prepare-dist".`);
    process.exit(2);
  }

  const usingDefaultPath = !pathArg;
  const dbPath = resolve(expandHome(pathArg ?? defaultPathFor(mode)));

  // `reset` is destructive (it deletes the target DB). When it would wipe the
  // DEFAULT runtime database (no explicit path given), require `--force` so a
  // stray `pnpm db:reset` can't silently destroy a user's working data.
  if (mode === 'reset' && usingDefaultPath && !force && existsSync(dbPath)) {
    console.error(
      `[prepare-db] Refusing to delete the default runtime database without confirmation:\n` +
      `  ${dbPath}\n` +
      `Re-run with an explicit path, or pass --force to confirm: pnpm db:reset --force`,
    );
    process.exit(2);
  }

  mkdirSync(dirname(dbPath), { recursive: true });

  console.log(`[prepare-db] mode=${mode} → ${dbPath}`);
  removeDbFiles(dbPath);

  // Create + migrate a fresh, empty database through the canonical runtime path.
  const db = createDB(dbPath);
  migrateDB(db);
  // Close the primary (WAL-mode) connection BEFORE checkpointing — a
  // `wal_checkpoint(TRUNCATE)` cannot truncate the -wal file while another
  // connection holds it open (it returns busy rather than throwing), which
  // would leave a -wal sidecar and defeat the single-portable-file guarantee.
  closeDB(db);

  // Fold the WAL back into the main file so the result is one portable file.
  const sqlite = new Database(dbPath);
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  sqlite.close();

  console.log(`[prepare-db] Done. Clean migrated database ready at ${dbPath}`);
  if (mode === 'prepare-dist') {
    console.log('[prepare-db] Ship this file with your distribution; the app copies it to the runtime DB path on first run.');
  }
}

main().catch((err) => {
  console.error('[prepare-db] Failed:', err);
  process.exit(1);
});
