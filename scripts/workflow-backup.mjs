#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// workflow-backup.mjs — P00 WP-0.1 of the workflow overhaul
//
// The overhaul's migrations (v55 / v57) drop workflow run history and rewrite
// how definitions are stored. Before any of them runs against a developer
// database, this script takes a restorable copy and a human-readable export:
//
//   1. Refuses to run while the server port (default 3100) is listening on
//      IPv4 or IPv6 (a probe that times out counts as listening) — a live
//      server holds the WAL and would keep writing while we copy.
//   2. Copies `<db>`, `<db>-wal` and `<db>-shm` into a NEW `<root>/<YYYYMMDD-HHMMSS-mmm>/`
//      with `fs.copyFileSync` (never rename: OneDrive-style EPERM, and the
//      source must stay untouched).
//   3. Opens the COPY read-only with better-sqlite3 (resolved from
//      packages/db) and exports every workflow definition with its stages and
//      edges to `workflow-definitions.json`. Raw rows, lossless: JSON columns
//      stay the strings SQLite holds, so the export can be re-inserted as is.
//      The API is never used; the server may be down.
//   4. Prints (and writes to `manifest.json`) row counts for sessions by
//      owner_type, chat_messages by the owning session's owner_type,
//      workflow_definitions, workflow_runs and automations.
//
// Usage:
//   pnpm workflow:backup [--db <path>] [--out-root <dir>] [--port <n>]
//
// Defaults:
//   --db        $DB_PATH, else <repo>/packages/db/data/generatorai.db
//   --out-root  $GENERATORAI_BACKUP_ROOT, else ~/.generatorai-backups
//   --port      3100 (the developer server)
//
// Prints the backup folder as the last line of stdout (`BACKUP_DIR=<path>`),
// so other scripts (workflow-cleanup-runs.mjs) can find it.
// ────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function expandHome(p) {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function defaultDbPath() {
  return process.env.DB_PATH || join(REPO_ROOT, 'packages', 'db', 'data', 'generatorai.db');
}

export function defaultBackupRoot() {
  return process.env.GENERATORAI_BACKUP_ROOT || join(homedir(), '.generatorai-backups');
}

/**
 * One TCP probe. A refused/unreachable connection is "free"; a connect is
 * "listening"; a TIMEOUT is also treated as listening — a hung server still
 * holds the WAL, so "could not tell" must never mean "safe to copy".
 */
function probe(port, host, timeoutMs) {
  return new Promise((res) => {
    const sock = connect({ port, host });
    const done = (v) => { sock.destroy(); res(v); };
    sock.setTimeout(timeoutMs, () => done(true));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** True when anything answers on <port> over IPv4 (127.0.0.1) or IPv6 (::1). */
export async function isPortListening(port, timeoutMs = 1500) {
  const [v4, v6] = await Promise.all([probe(port, '127.0.0.1', timeoutMs), probe(port, '::1', timeoutMs)]);
  return v4 || v6;
}

/** Local time with milliseconds: YYYYMMDD-HHMMSS-mmm. */
export function timestamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

/** Create a fresh `<root>/<timestamp>` folder; never reuses an existing one. */
export function createBackupDir(root) {
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < 20; i += 1) {
    const dir = join(root, i === 0 ? timestamp() : `${timestamp()}-${i}`);
    try {
      mkdirSync(dir); // not recursive: EEXIST if another run took the name
      return dir;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`could not create a unique backup folder under ${root}`);
}

/** better-sqlite3 as installed for packages/db (the root has no copy of its own). */
export function loadSqlite() {
  const require = createRequire(join(REPO_ROOT, 'packages', 'db', 'package.json'));
  return require('better-sqlite3');
}

function hasTable(db, name) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

function count(db, table) {
  return hasTable(db, table) ? db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n : null;
}

/** Row counts the migration WPs compare against after they run. */
export function collectCounts(db) {
  const counts = {
    schemaVersion: hasTable(db, '_schema_versions')
      ? db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM _schema_versions`).get().v
      : 0,
    sessionsByOwnerType: {},
    chatMessagesByOwnerType: {},
    chats: count(db, 'chats'),
    workflowDefinitions: count(db, 'workflow_definitions'),
    stageDefinitions: count(db, 'stage_definitions'),
    stageEdges: count(db, 'stage_edges'),
    workflowRuns: count(db, 'workflow_runs'),
    stageRuns: count(db, 'stage_runs'),
    automations: count(db, 'automations'),
  };
  if (hasTable(db, 'sessions')) {
    for (const r of db.prepare(`SELECT COALESCE(owner_type, '(null)') AS k, COUNT(*) AS n FROM sessions GROUP BY 1 ORDER BY 1`).all()) {
      counts.sessionsByOwnerType[r.k] = r.n;
    }
  }
  if (hasTable(db, 'chat_messages') && hasTable(db, 'sessions')) {
    for (const r of db
      .prepare(
        `SELECT COALESCE(s.owner_type, '(no session)') AS k, COUNT(*) AS n
           FROM chat_messages m LEFT JOIN sessions s ON s.id = m.session_id
          GROUP BY 1 ORDER BY 1`,
      )
      .all()) {
      counts.chatMessagesByOwnerType[r.k] = r.n;
    }
  }
  return counts;
}

/** Every definition with its stages (by `order`) and edges, as raw rows. */
export function exportDefinitions(db) {
  if (!hasTable(db, 'workflow_definitions')) return [];
  const defs = db.prepare(`SELECT * FROM workflow_definitions ORDER BY created_at, id`).all();
  const stagesStmt = hasTable(db, 'stage_definitions')
    ? db.prepare(`SELECT * FROM stage_definitions WHERE workflow_definition_id = ? ORDER BY "order", id`)
    : null;
  const edgesStmt = hasTable(db, 'stage_edges')
    ? db.prepare(`SELECT * FROM stage_edges WHERE workflow_definition_id = ? ORDER BY id`)
    : null;
  return defs.map((definition) => ({
    definition,
    stages: stagesStmt ? stagesStmt.all(definition.id) : [],
    edges: edgesStmt ? edgesStmt.all(definition.id) : [],
  }));
}

export async function runBackup({ dbPath, backupRoot, port = 3100, log = console.log }) {
  if (await isPortListening(port)) {
    throw Object.assign(new Error(`port ${port} is listening — stop the server before taking a backup`), { exitCode: 3 });
  }
  const src = resolve(expandHome(dbPath));
  if (!existsSync(src)) throw Object.assign(new Error(`database not found: ${src}`), { exitCode: 2 });

  const dir = createBackupDir(resolve(expandHome(backupRoot)));
  const base = 'generatorai.db';
  const copied = [];
  for (const suffix of ['', '-wal', '-shm']) {
    if (!existsSync(src + suffix)) continue;
    copyFileSync(src + suffix, join(dir, base + suffix));
    copied.push({ file: base + suffix, bytes: statSync(src + suffix).size });
  }

  const Database = loadSqlite();
  const db = new Database(join(dir, base), { readonly: true, fileMustExist: true });
  let counts;
  let definitions;
  try {
    counts = collectCounts(db);
    definitions = exportDefinitions(db);
  } finally {
    db.close();
  }

  const exportDoc = {
    exportedAt: new Date().toISOString(),
    source: src,
    schemaVersion: counts.schemaVersion,
    count: definitions.length,
    definitions,
  };
  writeFileSync(join(dir, 'workflow-definitions.json'), JSON.stringify(exportDoc, null, 2));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), source: src, files: copied, counts }, null, 2),
  );

  log(`[workflow-backup] source      ${src}`);
  log(`[workflow-backup] copied      ${copied.map((c) => `${c.file} (${c.bytes} B)`).join(', ')}`);
  log(`[workflow-backup] schema      v${counts.schemaVersion}`);
  log(`[workflow-backup] sessions by owner_type        ${JSON.stringify(counts.sessionsByOwnerType)}`);
  log(`[workflow-backup] chat_messages by owner_type   ${JSON.stringify(counts.chatMessagesByOwnerType)}`);
  log(`[workflow-backup] chats=${counts.chats} workflow_definitions=${counts.workflowDefinitions} stage_definitions=${counts.stageDefinitions} stage_edges=${counts.stageEdges}`);
  log(`[workflow-backup] workflow_runs=${counts.workflowRuns} stage_runs=${counts.stageRuns} automations=${counts.automations}`);
  log(`[workflow-backup] exported ${definitions.length} definition(s) → ${join(dir, 'workflow-definitions.json')}`);
  log(`BACKUP_DIR=${dir}`);
  return { dir, counts, definitions: definitions.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: pnpm workflow:backup [--db <path>] [--out-root <dir>] [--port <n>]');
    process.exit(0);
  }
  runBackup({
    dbPath: typeof args.db === 'string' ? args.db : defaultDbPath(),
    backupRoot: typeof args['out-root'] === 'string' ? args['out-root'] : defaultBackupRoot(),
    port: args.port ? Number(args.port) : 3100,
  }).catch((err) => {
    console.error(`[workflow-backup] ${err.message}`);
    process.exit(err.exitCode ?? 1);
  });
}
