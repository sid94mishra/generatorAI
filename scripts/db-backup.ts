#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// db-backup.ts — DB-02 safe SQLite backup script (+ secrets directory)
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
//   4. Copies the encrypted-secrets directory beside it, into
//      `<destination>.secrets/`.
//
// Step 4 exists because of APPLICATION-REVIEW-2026-09 §5.11: this script used
// to back up the database alone. The vault (`secrets.vault.json`), its
// key-encryption key (`kek.key` for the file-backed provider, `kek.wrapped`
// for OS-keystore installs) and the passphrase salt live NEXT to the DB in
// `<dataDir>/secrets/`, and a database restored without them has every stored
// credential, host identity and token-signing seed permanently unreadable.
// The DB and the secrets directory are one backup unit — restore both or
// neither.
//
// Usage:
//   pnpm db:backup [source.db] [destination.db] [secretsDir]
//
// Defaults:
//   source       ~/.generatorai/data.db
//   destination  ~/.generatorai/backups/data-<timestamp>.db
//   secretsDir   $GENERATORAI_SECRETS_DIR/secrets when that variable is set
//                (the server resolves it the same way), else
//                <dirname(source)>/secrets
//
// A missing secrets directory is a WARNING, not a failure: an install that
// uses GENERATORAI_SECRET_KEY / GENERATORAI_SECRET_PASSPHRASE still has a vault
// file there, but a freshly-initialised server that has never stored a secret
// may not. Read the warning; do not ignore it on a production host.
// ────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { copySecretsDir, defaultSecretsDirFor } from './lib/copySecretsDir.mjs';

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

async function main(): Promise<void> {
  const [, , srcArg, destArg, secretsArg] = process.argv;
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
  const secretsSrc = secretsArg
    ? resolve(expandHome(secretsArg))
    : resolve(defaultSecretsDirFor(src));
  const secretsDest = `${dest}.secrets`;

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

  // Step 3 — the secrets directory. Without it the backup above restores to a
  // database whose every stored secret is unreadable.
  if (!existsSync(secretsSrc)) {
    console.warn(
      `[db-backup] ⚠ Secrets directory not found: ${secretsSrc}\n` +
        '[db-backup]   The database was backed up WITHOUT its vault and key material. If this server\n' +
        '[db-backup]   has ever stored a secret, restoring this backup alone loses all of them.\n' +
        '[db-backup]   Pass the secrets directory as the third argument, or set GENERATORAI_SECRETS_DIR.',
    );
    return;
  }
  const { files, bytes } = copySecretsDir(secretsSrc, secretsDest);
  console.log(`[db-backup] ✓ Secrets copied: ${secretsDest} (${files} file(s), ${bytes} bytes)`);
  console.log('[db-backup]   Restore the .db and the .secrets/ directory together — they are one unit.');
}

main().catch((err) => {
  console.error(`[db-backup] Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
