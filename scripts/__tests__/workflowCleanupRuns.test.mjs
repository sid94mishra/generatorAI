// P00 WP-0.8 — `pnpm workflow:cleanup-runs` against a real git fixture that
// looks like production: a BARE product clone with no fetch refspec, run and
// chat worktrees under `workspaces/executions/<owner>/source/<alias>`, a
// prunable worktree, a branch pushed with plain `git push`, and a chat-owned
// `generatorai/run-*` branch (P00 review R1–R5).
// Runs under the root vitest "node" project (`pnpm test:scripts`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDB,
  closeDB,
  migrateDB,
  DrizzleWorktreeRepository,
  DrizzleProjectCodebaseRepository,
  DrizzleProjectRepository,
  DrizzleProjectConfigRepository,
} from '../../packages/db/src/index.ts';
import { WorktreeService } from '../../packages/core/src/services/WorktreeService.ts';
import { ProjectService } from '../../packages/core/src/services/ProjectService.ts';
import { GitManager } from '../../packages/core/src/infrastructure/GitManager.ts';
import { SandboxedScriptRunner } from '../../packages/core/src/infrastructure/SandboxedScriptRunner.ts';
import { runCleanup, parentCloneOf, parseWorktreeList } from '../workflow-cleanup-runs.mjs';

const deps = {
  createDB,
  closeDB,
  DrizzleWorktreeRepository,
  DrizzleProjectCodebaseRepository,
  DrizzleProjectRepository,
  DrizzleProjectConfigRepository,
  WorktreeService,
  ProjectService,
  GitManager,
  SandboxedScriptRunner,
};

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

// Owner ids: only their first 8 characters appear in branch names.
const WF1 = 'aaaa1111-0000-4000-8000-000000000001'; // run with a `worktrees` row
const WF2 = 'bbbb2222-0000-4000-8000-000000000002'; // run workspace, worktree with NO mount row
const WF3 = 'cccc3333-0000-4000-8000-000000000003'; // run whose worktree dir was deleted (prunable)
const WF4 = 'dddd4444-0000-4000-8000-000000000004'; // run branches: merged / unpushed / pushed
const CHAT = 'eeee5555-0000-4000-8000-000000000005'; // chat that also uses the run- prefix
const b8 = (id) => id.slice(0, 8);

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gai-wfclean-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function commitOn(repo, branch, from, file) {
  git(repo, 'checkout', '-qb', branch, from);
  writeFileSync(join(repo, file), file);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', file);
}

function fixture() {
  const art = join(root, 'art');
  const ws = join(root, 'ws');
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const clone = join(art, 'projects', 'p1', 'repos', 'repo');

  git(root, 'init', '-q', '--bare', origin);
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'a.txt'), 'a');
  git(seed, 'add', '.');
  git(seed, 'commit', '-qm', 'init');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');

  // The product clone: bare, no fetch refspec, no remote-tracking refs.
  mkdirSync(join(art, 'projects', 'p1', 'repos'), { recursive: true });
  git(root, 'clone', '-q', '--bare', origin, clone);

  // Branches, created in the bare clone through a scratch worktree.
  const scratch = join(root, 'scratch');
  git(clone, 'worktree', 'add', '-q', scratch, 'main');
  git(scratch, 'branch', `generatorai/run-${b8(WF4)}-merged`, 'main');
  commitOn(scratch, `generatorai/run-${b8(WF4)}-unpushed`, 'main', 'u.txt');
  commitOn(scratch, `generatorai/run-${b8(WF4)}-pushed`, 'main', 'p.txt');
  git(scratch, 'push', '-q', 'origin', `generatorai/run-${b8(WF4)}-pushed`); // plain push: no tracking ref in a bare clone
  commitOn(scratch, `generatorai/run-${b8(CHAT)}-Backend`, 'main', 'chat.txt'); // unpushed, unmerged, chat-owned
  commitOn(scratch, 'generatorai/run-ffff9999-orphan', 'main', 'o.txt'); // owner unknown
  git(scratch, 'checkout', '-q', '--detach', 'main');
  git(clone, 'worktree', 'remove', '--force', scratch);

  // WF1: a `worktrees` row in the legacy project worktrees dir.
  const wt1 = join(art, 'projects', 'p1', 'worktrees', WF1, 'repo');
  git(clone, 'worktree', 'add', '-q', '-b', `generatorai/run-${b8(WF1)}-repo`, wt1, 'main');
  // WF2: a run workspace worktree with NO workspace_mounts row (R2), dirty.
  const wsRoot2 = join(ws, 'executions', WF2);
  const wt2 = join(wsRoot2, 'source', 'repo');
  git(clone, 'worktree', 'add', '-q', '-b', `generatorai/run-${b8(WF2)}-repo`, wt2, 'main');
  writeFileSync(join(wt2, 'dirty.txt'), 'uncommitted');
  // WF3: a worktree whose directory is gone → prunable (R3); branch unpushed + unmerged.
  const wt3 = join(ws, 'executions', WF3, 'source', 'repo');
  git(clone, 'worktree', 'add', '-q', '-b', `generatorai/run-${b8(WF3)}-repo`, wt3, 'main');
  writeFileSync(join(wt3, 'w3.txt'), 'w3');
  git(wt3, 'add', '.');
  git(wt3, 'commit', '-qm', 'w3');
  rmSync(join(ws, 'executions', WF3), { recursive: true, force: true });
  // The chat's own workspace worktree: never touched.
  const wtChat = join(ws, 'executions', CHAT, 'source', 'repo');
  git(clone, 'worktree', 'add', '-q', '-b', `generatorai/run-${b8(CHAT)}-live`, wtChat, 'main');

  // Orphans: a workspace dir and a run worktree dir with no rows.
  mkdirSync(join(ws, 'executions', 'orphan-ws'), { recursive: true });
  mkdirSync(join(art, 'projects', 'p1', 'worktrees', 'r-orphan'), { recursive: true });

  const dbPath = join(root, 'data.db');
  const db = createDB(dbPath);
  migrateDB(db);
  const s = db.session.client;
  s.pragma('foreign_keys = OFF');
  const now = Date.now();
  s.prepare(`INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES ('p1', 'P', ?, ?, ?)`).run(join(art, 'projects', 'p1'), now, now);
  s.prepare(
    `INSERT INTO project_codebases (id, project_id, alias, type, clone_path, status, created_at, updated_at)
     VALUES ('cb1', 'p1', 'repo', 'git-remote', ?, 'ready', ?, ?)`,
  ).run(clone, now, now);
  const run = s.prepare(`INSERT INTO workflow_runs (id, workflow_definition_id, name, created_at, updated_at) VALUES (?, 'd1', 'r', ?, ?)`);
  for (const id of [WF1, WF2, WF3, WF4]) run.run(id, now, now);
  s.prepare(`INSERT INTO sessions (id, name, created_at, updated_at, owner_type, owner_id) VALUES ('s-chat', 'c', ?, ?, 'chat', ?)`).run(now, now, CHAT);
  s.prepare(`INSERT INTO chats (id, name, session_id, created_at, updated_at) VALUES (?, 'chat', 's-chat', ?, ?)`).run(CHAT, now, now);
  s.prepare(
    `INSERT INTO worktrees (id, project_id, codebase_id, run_id, run_type, worktree_path, branch_name, status, created_at)
     VALUES ('w1', 'p1', 'cb1', ?, 'workflow', ?, ?, 'active', ?)`,
  ).run(WF1, wt1, `generatorai/run-${b8(WF1)}-repo`, now);
  const wsRow = s.prepare(
    `INSERT INTO execution_workspaces (id, owner_type, owner_id, root_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
  );
  wsRow.run('ws2', 'workflow_run', WF2, wsRoot2, now, now);
  wsRow.run('ws3', 'workflow_run', WF3, join(ws, 'executions', WF3), now, now);
  wsRow.run('ws-chat', 'chat', CHAT, join(ws, 'executions', CHAT), now, now);
  closeDB(db);
  return { art, ws, clone, wt1, wt2, wtChat, dbPath };
}

const branches = (clone) =>
  git(clone, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/generatorai').split('\n').filter(Boolean).sort();
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

describe('workflow-cleanup-runs', () => {
  it('resolves the parent clone of a worktree of a BARE clone', () => {
    const f = fixture();
    // realpath: git writes the long form of the temp dir, tmpdir() may be 8.3.
    expect(realpathSync.native(parentCloneOf(f.wt1))).toBe(realpathSync.native(f.clone));
    expect(parentCloneOf(f.clone)).toBeNull();
  });

  it('parses prunable entries from `git worktree list --porcelain`', () => {
    const list = parseWorktreeList('worktree /c\nbare\n\nworktree /w\nHEAD 1\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n');
    expect(list).toEqual([
      { path: '/c', prunable: false, bare: true },
      { path: '/w', branch: 'x', prunable: true, bare: false },
    ]);
  });

  it('dry run opens the DB read-only, changes nothing, and predicts the real run', async () => {
    const f = fixture();
    const before = { db: hash(f.dbPath), branches: branches(f.clone) };
    const res = await runCleanup(
      { dbPath: f.dbPath, backupRoot: join(root, 'bk'), workspacesDir: f.ws, artifactsDir: f.art, dryRun: true, port: 1 },
      deps,
    );
    expect(hash(f.dbPath)).toBe(before.db);
    expect(branches(f.clone)).toEqual(before.branches);
    expect(existsSync(f.wt1) && existsSync(f.wt2)).toBe(true);
    const log = readFileSync(res.logFile, 'utf8');
    expect(log).toContain(`run-${b8(CHAT)}-Backend: keep (chat-owned)`);
    expect(log).toContain(`run-${b8(WF4)}-pushed: keep (pushed and not merged)`);
    expect(log).toContain(`run-${b8(WF4)}-unpushed: delete (never pushed)`);
    // The prunable worktree does not "hold" its branch in the prediction.
    expect(log).toContain(`run-${b8(WF3)}-repo: delete (never pushed)`);
    expect(log).toMatch(/\[status\] .*source[\\/]repo: 1 uncommitted change/);
    expect(log).toContain('DRY RUN');
  });

  it('removes run worktrees (incl. ones with no mount row), keeps chat and pushed branches, lists orphans', async () => {
    const f = fixture();
    const res = await runCleanup(
      { dbPath: f.dbPath, backupRoot: join(root, 'bk'), workspacesDir: f.ws, artifactsDir: f.art, port: 1 },
      deps,
    );
    expect(existsSync(f.wt1)).toBe(false);
    expect(existsSync(f.wt2)).toBe(false); // found by scanning <root>/source (R2)
    expect(existsSync(f.wtChat)).toBe(true); // a chat workspace is never touched
    const listed = parseWorktreeList(git(f.clone, 'worktree', 'list', '--porcelain'));
    expect(listed.filter((w) => !w.bare).map((w) => w.branch)).toEqual([`generatorai/run-${b8(CHAT)}-live`]);

    expect(branches(f.clone)).toEqual(
      [
        `generatorai/run-${b8(CHAT)}-Backend`, // chat-owned, unmerged, never pushed: kept (R1)
        `generatorai/run-${b8(CHAT)}-live`,
        `generatorai/run-${b8(WF4)}-pushed`, // pushed with plain `git push` from a bare clone (R4)
        'generatorai/run-ffff9999-orphan', // owner unknown
      ].sort(),
    );
    expect(res.summary.worktreeRows).toEqual({ found: 1, removed: 1, failed: 0 });
    expect(res.summary.mounts.removed).toBe(1);
    expect(res.summary.branches.chatOwned).toBe(2);
    expect(res.summary.branches.unknownOwner).toBe(1);

    const db = createDB(f.dbPath);
    expect(db.session.client.prepare(`SELECT COUNT(*) AS n FROM worktrees`).get().n).toBe(0);
    closeDB(db);

    // Orphans are listed, never deleted.
    expect(res.summary.orphans.map((o) => o.replace(/\\/g, '/').split('/').pop()).sort()).toEqual(['orphan-ws', 'r-orphan']);
    expect(existsSync(join(f.ws, 'executions', 'orphan-ws'))).toBe(true);
    const summary = JSON.parse(readFileSync(join(res.outDir, 'cleanup.json'), 'utf8'));
    expect(summary.dryRun).toBe(false);
    expect(summary.dbPath).toBe(f.dbPath);
  });
});
