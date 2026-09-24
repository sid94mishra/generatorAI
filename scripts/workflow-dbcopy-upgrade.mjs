#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// workflow-dbcopy-upgrade.mjs — repeatable "does a real developer database
// upgrade cleanly?" check (workflow overhaul §7 step 5b; P00 review R22).
//
//   pnpm workflow:dbcopy-upgrade [--db <path>] [--dump-schema <file>] [--keep]
//
// 1. Copies the database (+ -wal/-shm, `fs.copyFileSync`) into a fresh temp
//    folder. --db defaults to $WORKFLOW_DBCOPY or C:/gaiwf/dbcopy/generatorai.db.
//    When --db is the live developer DB (`defaultDbPath()`), refuses while
//    :3100 is listening. The source is never opened.
// 2. Records, on the COPY: schema version, sessions by owner_type, chat,
//    session and chat-message counts, and a sha256 over every row of `chats`,
//    `sessions` and `chat_messages` (the columns that existed BEFORE the
//    upgrade, in primary-key order).
// 3. Runs the real `migrateDB` on the copy, then records the same again.
// 4. Compares the upgraded schema with a fresh database's (structural diff,
//    `packages/db/scripts/schemaShape.ts`) and prints the drift.
// 5. Exits 1 if any chat, session or message count or hash changed.
//    Deletes the temp copy unless --keep.
//
// `--dump-schema <file>` writes the ORIGINAL copy's schema (sqlite_master
// DDL in creation order + the `_schema_versions` rows, applied_at zeroed)
// and nothing else — no user rows — which is how
// packages/db/__tests__/fixtures/schema-v52-dev.sql was produced.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultDbPath, isPortListening, loadSqlite, parseArgs } from './workflow-backup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHAT_TABLES = ['chats', 'sessions', 'chat_messages'];

async function tsImport(rel) {
  const require = createRequire(join(REPO_ROOT, 'packages', 'db', 'package.json'));
  const api = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
  return api.tsImport(pathToFileURL(join(REPO_ROOT, rel)).href, import.meta.url);
}

/** Schema-only dump: DDL in creation order + `_schema_versions` rows. No user data. */
export function dumpSchemaOnly(sqlite) {
  const ddl = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`)
    .all()
    .map((r) => `${r.sql.replace(/\r\n/g, '\n').trim()};`);
  const versions = sqlite.prepare(`SELECT version, name FROM _schema_versions ORDER BY version`).all();
  const inserts = versions.map((v) => `INSERT INTO _schema_versions (version, applied_at, name) VALUES (${v.version}, 0, '${v.name.replace(/'/g, "''")}');`);
  return (
    `-- Schema-only snapshot of a real developer database at v${versions.at(-1)?.version ?? 0}\n` +
    `-- (scripts/workflow-dbcopy-upgrade.mjs --dump-schema). DDL and migration\n` +
    `-- names only: no user rows. Used by BaselineFreshDb.test.ts.\n\n` +
    [...ddl, ...inserts].join('\n\n') +
    '\n'
  );
}

/** Counts + content hashes of the chat tables, over `columns` (or all current ones). */
export function chatFingerprint(sqlite, columns) {
  const out = { columns: {}, counts: {}, hashes: {} };
  const exists = (t) => !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  for (const t of CHAT_TABLES) {
    if (!exists(t)) continue;
    const cols = columns?.[t] ?? sqlite.pragma(`table_info(${t})`).map((c) => c.name);
    out.columns[t] = cols;
    const h = createHash('sha256');
    let n = 0;
    for (const row of sqlite.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}" ORDER BY rowid`).iterate()) {
      h.update(JSON.stringify(row, (_k, v) => (Buffer.isBuffer(v) ? v.toString('base64') : typeof v === 'bigint' ? String(v) : v)));
      h.update('\n');
      n++;
    }
    out.counts[t] = n;
    out.hashes[t] = h.digest('hex');
  }
  out.sessionsByOwnerType = Object.fromEntries(
    exists('sessions')
      ? sqlite.prepare(`SELECT COALESCE(owner_type,'(null)') AS k, COUNT(*) AS n FROM sessions GROUP BY 1 ORDER BY 1`).all().map((r) => [r.k, r.n])
      : [],
  );
  out.version = exists('_schema_versions') ? sqlite.prepare(`SELECT COALESCE(MAX(version),0) AS v FROM _schema_versions`).get().v : 0;
  return out;
}

export async function runUpgradeCheck({ dbPath, dumpSchema, keep = false, log = console.log }) {
  const src = resolve(dbPath);
  if (!existsSync(src)) throw Object.assign(new Error(`database not found: ${src}`), { exitCode: 2 });
  if (resolve(defaultDbPath()) === src && (await isPortListening(3100))) {
    throw Object.assign(new Error('refusing to copy the live developer DB while :3100 is listening'), { exitCode: 3 });
  }
  const dir = mkdtempSync(join(tmpdir(), 'gai-dbup-'));
  const copy = join(dir, 'generatorai.db');
  for (const s of ['', '-wal', '-shm']) if (existsSync(src + s)) copyFileSync(src + s, copy + s);

  try {
    const Database = loadSqlite();
    if (dumpSchema) {
      const ro = new Database(copy, { readonly: true });
      try {
        writeFileSync(dumpSchema, dumpSchemaOnly(ro));
      } finally {
        ro.close();
      }
      log(`[dbcopy-upgrade] wrote schema-only dump to ${dumpSchema}`);
      return { dumped: dumpSchema };
    }

    const { createDB, closeDB, migrateDB } = await tsImport('packages/db/src/index.ts');
    const { chooseMigrationRoute } = await tsImport('packages/db/src/migrations/index.ts');
    const { schemaShape, diffShapes } = await tsImport('packages/db/scripts/schemaShape.ts');

    const db = createDB(copy);
    const sqlite = db.session.client;
    const before = chatFingerprint(sqlite);
    const route = chooseMigrationRoute(sqlite);
    const t0 = Date.now();
    migrateDB(db);
    const ms = Date.now() - t0;
    const after = chatFingerprint(sqlite, before.columns);
    const fresh = createDB(':memory:');
    migrateDB(fresh);
    const drift = diffShapes(schemaShape(sqlite), schemaShape(fresh.session.client), ['upgraded', 'fresh']);
    closeDB(fresh);
    closeDB(db);

    const changed = CHAT_TABLES.filter(
      (t) => before.counts[t] !== after.counts[t] || before.hashes[t] !== after.hashes[t],
    );
    const sameOwners = JSON.stringify(before.sessionsByOwnerType) === JSON.stringify(after.sessionsByOwnerType);
    const result = {
      source: src,
      route: route.kind,
      versionBefore: before.version,
      versionAfter: after.version,
      ms,
      counts: before.counts,
      sessionsByOwnerType: before.sessionsByOwnerType,
      chatRowsPreserved: changed.length === 0 && sameOwners,
      changed,
      schemaDrift: drift,
    };
    log(
      `[dbcopy-upgrade] ${src}: v${before.version} → v${after.version} via ${route.kind} in ${ms} ms; ` +
        `chats ${before.counts.chats}, sessions ${before.counts.sessions} ${JSON.stringify(before.sessionsByOwnerType)}, ` +
        `messages ${before.counts.chat_messages}; chat rows ${result.chatRowsPreserved ? 'UNCHANGED (hashes match)' : `CHANGED: ${changed.join(', ')}`}`,
    );
    log(`[dbcopy-upgrade] schema drift vs a fresh database (${drift.length}):`);
    for (const d of drift) log(`  ${d}`);
    return result;
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
    else log(`[dbcopy-upgrade] kept ${dir}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runUpgradeCheck({
    dbPath: typeof args.db === 'string' ? args.db : process.env.WORKFLOW_DBCOPY || 'C:/gaiwf/dbcopy/generatorai.db',
    dumpSchema: typeof args['dump-schema'] === 'string' ? resolve(args['dump-schema']) : undefined,
    keep: !!args.keep,
  })
    .then((r) => process.exit(r.dumped || r.chatRowsPreserved ? 0 : 1))
    .catch((err) => {
      console.error(`[dbcopy-upgrade] ${err.message}`);
      process.exit(err.exitCode ?? 1);
    });
}
