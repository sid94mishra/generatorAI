#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Migration history is immutable (workflow overhaul P00 WP-0.6b, RV-2, R-3).
//
// `packages/db/src/migrations/migrations.lock.json` maps every versioned
// migration to sha256({ name, sql, disableForeignKeys }). This check, part of
// `pnpm lint`, FAILS when:
//   - an existing entry's hash changed (a shipped migration was edited — the
//     v27 → v28 incident, where an in-place edit broke every upgraded DB);
//   - a migration has no entry (a new migration was added without locking it);
//   - an entry names a migration that no longer exists.
//
//   node scripts/check-migrations-lock.mjs           # check (lint)
//   node scripts/check-migrations-lock.mjs --write   # add entries for NEW migrations only
//
// `--write` never rewrites an existing entry; there is no flag that does.
// MIGRATIONS is loaded from the TypeScript source with the `tsx` that
// packages/db declares (plain Node cannot resolve its `.js`-suffixed imports).
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_TS = resolve(repoRoot, 'packages', 'db', 'src', 'migrations', 'index.ts');
export const LOCK_FILE = resolve(repoRoot, 'packages', 'db', 'src', 'migrations', 'migrations.lock.json');

/**
 * The content of a migration that must never change once shipped. Line
 * endings are normalised: the SQL lives in template literals, which carry
 * CRLF on a Windows checkout and LF everywhere else.
 */
export function hashMigration(m) {
  const sql = m.sql.map((stmt) => stmt.replace(/\r\n/g, '\n'));
  const base = { name: m.name, sql, disableForeignKeys: m.disableForeignKeys === true };
  // A migration with a JS step (v55+) also pins the content of its frozen
  // module files, so editing the conversion code is caught like editing SQL.
  const payload = m.lockFiles
    ? JSON.stringify({
        ...base,
        files: m.lockFiles.map((f) => [f, readFileSync(resolve(dirname(LOCK_FILE), f), 'utf8').replace(/\r\n/g, '\n')]),
      })
    : JSON.stringify(base);
  return createHash('sha256').update(payload).digest('hex');
}

/** Compare migrations against a lock; returns human-readable problems. */
export function compareLock(migrations, lock) {
  const problems = [];
  const seen = new Set();
  for (const m of migrations) {
    const key = String(m.version);
    seen.add(key);
    const want = lock[key];
    if (!want) problems.push(`v${m.version} (${m.name}) has no lock entry — run \`node scripts/check-migrations-lock.mjs --write\``);
    else if (want !== hashMigration(m)) {
      problems.push(`v${m.version} (${m.name}) changed after it was locked — shipped migrations are immutable; add a new migration instead`);
    }
  }
  for (const key of Object.keys(lock)) {
    if (!seen.has(key)) problems.push(`lock entry v${key} has no migration — migrations are never deleted`);
  }
  return problems;
}

async function loadMigrations() {
  const require = createRequire(resolve(repoRoot, 'packages', 'db', 'package.json'));
  const { tsImport } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
  const mod = await tsImport(pathToFileURL(MIGRATIONS_TS).href, import.meta.url);
  return [...mod.MIGRATIONS].sort((a, b) => a.version - b.version);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const migrations = await loadMigrations();
  const lock = existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : {};
  if (process.argv.includes('--write')) {
    let added = 0;
    for (const m of migrations) {
      if (!lock[String(m.version)]) {
        lock[String(m.version)] = hashMigration(m);
        added++;
      }
    }
    const ordered = Object.fromEntries(Object.entries(lock).sort((a, b) => Number(a[0]) - Number(b[0])));
    writeFileSync(LOCK_FILE, `${JSON.stringify(ordered, null, 2)}\n`);
    console.log(`[migrations-lock] added ${added} entr${added === 1 ? 'y' : 'ies'}; ${Object.keys(ordered).length} locked`);
  }
  const problems = compareLock(migrations, JSON.parse(readFileSync(LOCK_FILE, 'utf8')));
  for (const p of problems) console.error(`  ${p}`);
  console.log(
    `[migrations-lock] ${migrations.length} migration(s), head v${migrations.at(-1)?.version}: ` +
      (problems.length === 0 ? 'all locked and unchanged' : `${problems.length} problem(s)`),
  );
  if (problems.length > 0) process.exit(1);
}
