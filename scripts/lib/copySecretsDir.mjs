// ────────────────────────────────────────────────────────────────
// copySecretsDir — recursive copy of the encrypted-secrets directory for
// `scripts/db-backup.ts`.
//
// APPLICATION-REVIEW-2026-09 §5.11: the documented backup procedure covered
// only the SQLite file. The vault (`secrets.vault.json`) and its key material
// (`kek.key` / `kek.wrapped`, the scrypt salt) live beside the DB in
// `<dataDir>/secrets/`, and without them a restored database still has every
// stored credential, host identity and token-signing seed unreadable.
//
// Kept as a plain `.mjs` helper (rather than inline in the `.ts` script) so the
// root vitest "node" project can exercise it directly —
// `scripts/__tests__/copySecretsDir.test.mjs`.
// ────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the server keeps its secrets directory for a given database file:
 * `createSecretStore({ dataDir })` resolves `<dataDir>/secrets`, and the server
 * passes `GENERATORAI_SECRETS_DIR` or, when unset, the DB file's directory as
 * `dataDir` (`apps/server/src/composition/security.ts`).
 *
 * @param {string} dbPath Absolute path of the SQLite file being backed up.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultSecretsDirFor(dbPath, env = process.env) {
  const override = env['GENERATORAI_SECRETS_DIR'];
  const dataDir = override && override.length > 0 ? override : join(dbPath, '..');
  return join(dataDir, 'secrets');
}

/**
 * Copy `srcDir` into `destDir` recursively. Regular files are copied with mode
 * 0600 and directories with 0700 where the platform honours modes (a no-op on
 * Windows) — key material must not become world-readable in the backup.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @returns {{ files: number, bytes: number }}
 */
export function copySecretsDir(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    throw new Error(`secrets directory not found: ${srcDir}`);
  }
  if (!statSync(srcDir).isDirectory()) {
    throw new Error(`secrets path is not a directory: ${srcDir}`);
  }
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const from = join(srcDir, entry.name);
    const to = join(destDir, entry.name);
    if (entry.isDirectory()) {
      const sub = copySecretsDir(from, to);
      files += sub.files;
      bytes += sub.bytes;
      continue;
    }
    if (!entry.isFile()) continue; // sockets, symlinks: nothing a restore needs
    copyFileSync(from, to);
    try {
      chmodSync(to, 0o600);
    } catch {
      // Windows: mode bits are advisory; the copy itself is what matters.
    }
    files += 1;
    bytes += statSync(to).size;
  }
  return { files, bytes };
}
