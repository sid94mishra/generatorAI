// P00 WP-0.1 — `pnpm workflow:backup`. Runs under the root vitest "node"
// project (`pnpm test:scripts`; `turbo test` runs it).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSqlite, runBackup } from '../workflow-backup.mjs';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-wfbk-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedDb(file) {
  const Database = loadSqlite();
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE _schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER, name TEXT);
    INSERT INTO _schema_versions VALUES (52, 0, 'x');
    CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_type TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, session_id TEXT);
    CREATE TABLE workflow_definitions (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
    CREATE TABLE stage_definitions (id TEXT PRIMARY KEY, workflow_definition_id TEXT, name TEXT, "order" INTEGER, prompts TEXT);
    CREATE TABLE stage_edges (id TEXT PRIMARY KEY, workflow_definition_id TEXT, from_stage_id TEXT, to_stage_id TEXT, edge_type TEXT);
    CREATE TABLE workflow_runs (id TEXT PRIMARY KEY);
    CREATE TABLE automations (id TEXT PRIMARY KEY);
    INSERT INTO sessions VALUES ('s1', 'chat'), ('s2', 'stage_run'), ('s3', 'stage_run');
    INSERT INTO chat_messages VALUES ('m1', 's1'), ('m2', 's2'), ('m3', 's3'), ('m4', 's3');
    INSERT INTO workflow_definitions VALUES ('d1', 'one', 1), ('d2', 'two', 2);
    INSERT INTO stage_definitions VALUES ('a', 'd1', 'A', 1, '[{"text":"x"}]'), ('b', 'd1', 'B', 0, '[]');
    INSERT INTO stage_edges VALUES ('e1', 'd1', 'b', 'a', 'on_success');
    INSERT INTO workflow_runs VALUES ('r1');
  `);
  // Leave the WAL un-checkpointed: the backup must carry `-wal` along.
  return db;
}

describe('workflow-backup', () => {
  it('copies the db + wal, exports every definition with stages and edges, and counts rows', async () => {
    const src = path.join(dir, 'src.db');
    const live = seedDb(src);
    const lines = [];
    const res = await runBackup({ dbPath: src, backupRoot: path.join(dir, 'out'), port: 1, log: (l) => lines.push(l) });
    live.close();

    expect(fs.existsSync(path.join(res.dir, 'generatorai.db'))).toBe(true);
    const exp = JSON.parse(fs.readFileSync(path.join(res.dir, 'workflow-definitions.json'), 'utf8'));
    expect(exp.count).toBe(2);
    expect(exp.definitions.map((d) => d.definition.id)).toEqual(['d1', 'd2']);
    expect(exp.definitions[0].stages.map((s) => s.id)).toEqual(['b', 'a']);
    expect(exp.definitions[0].stages[1].prompts).toBe('[{"text":"x"}]');
    expect(exp.definitions[0].edges).toHaveLength(1);
    expect(res.counts.sessionsByOwnerType).toEqual({ chat: 1, stage_run: 2 });
    expect(res.counts.chatMessagesByOwnerType).toEqual({ chat: 1, stage_run: 3 });
    expect(res.counts.workflowRuns).toBe(1);
    expect(res.counts.automations).toBe(0);
    expect(res.counts.schemaVersion).toBe(52);
    expect(lines.at(-1)).toBe(`BACKUP_DIR=${res.dir}`);
  });

  it('refuses to run while the port is listening', async () => {
    const srv = net.createServer();
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    try {
      await expect(
        runBackup({ dbPath: path.join(dir, 'missing.db'), backupRoot: dir, port, log: () => {} }),
      ).rejects.toThrow(/is listening/);
    } finally {
      srv.close();
    }
  });
});

describe('workflow-backup safety (P00 review R15/R16)', () => {
  it('detects a server listening on IPv6 only', async () => {
    const { isPortListening } = await import('../workflow-backup.mjs');
    const srv = net.createServer();
    const ok = await new Promise((r) => {
      srv.once('error', () => r(false));
      srv.listen(0, '::1', () => r(true));
    });
    if (!ok) return; // no IPv6 loopback on this host
    try {
      expect(await isPortListening(srv.address().port)).toBe(true);
    } finally {
      srv.close();
    }
  });

  it('never reuses a backup folder, even within the same millisecond', async () => {
    const { createBackupDir } = await import('../workflow-backup.mjs');
    const a = createBackupDir(dir);
    const b = createBackupDir(dir);
    expect(a).not.toBe(b);
    expect(path.basename(a)).toMatch(/^\d{8}-\d{6}-\d{3}/);
  });
});
