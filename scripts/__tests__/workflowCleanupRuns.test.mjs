// P00 WP-0.8 — `pnpm workflow:cleanup-runs` against a real git fixture.
// Runs under the root vitest "node" project (`pnpm exec vitest run scripts`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDB, closeDB, migrateDB, DrizzleWorktreeRepository, DrizzleProjectCodebaseRepository, DrizzleProjectRepository, DrizzleProjectConfigRepository } from '../../packages/db/src/index.ts';
import { WorktreeService } from '../../packages/core/src/services/WorktreeService.ts';
import { ProjectService } from '../../packages/core/src/services/ProjectService.ts';
import { GitManager } from '../../packages/core/src/infrastructure/GitManager.ts';
import { SandboxedScriptRunner } from '../../packages/core/src/infrastructure/SandboxedScriptRunner.ts';
import { runCleanup, parentCloneOf } from '../workflow-cleanup-runs.mjs';

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

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gai-wfclean-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const art = join(root, 'art');
  const ws = join(root, 'ws');
  const clone = join(art, 'projects', 'p1', 'repos', 'repo');
  mkdirSync(clone, { recursive: true });
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'a');
  git(clone, 'add', '.');
  git(clone, 'commit', '-qm', 'init');

  // Branches: merged (at main), never pushed (own commit), pushed + unmerged.
  git(clone, 'branch', 'generatorai/run-merged');
  git(clone, 'checkout', '-qb', 'generatorai/run-unpushed');
  writeFileSync(join(clone, 'b.txt'), 'b');
  git(clone, 'add', '.');
  git(clone, 'commit', '-qm', 'unpushed work');
  git(clone, 'checkout', '-qb', 'generatorai/run-pushed', 'main');
  writeFileSync(join(clone, 'c.txt'), 'c');
  git(clone, 'add', '.');
  git(clone, 'commit', '-qm', 'pushed work');
  git(clone, 'update-ref', 'refs/remotes/origin/generatorai/run-pushed', 'HEAD');
  git(clone, 'checkout', '-q', 'main');

  // Run r1: a `worktrees` row (legacy project worktrees dir).
  const wt1 = join(art, 'projects', 'p1', 'worktrees', 'r1', 'repo');
  git(clone, 'worktree', 'add', '-q', '-b', 'generatorai/run-r1-repo', wt1);
  // Run r2: a worktree MOUNT inside its execution workspace.
  const wsRoot = join(ws, 'executions', 'r2');
  const wt2 = join(wsRoot, 'source', 'repo');
  git(clone, 'worktree', 'add', '-q', '-b', 'generatorai/run-r2-repo', wt2);
  // Orphans: a workspace dir and a run worktree dir with no rows.
  mkdirSync(join(ws, 'executions', 'orphan-ws'), { recursive: true });
  mkdirSync(join(art, 'projects', 'p1', 'worktrees', 'r-orphan'), { recursive: true });

  const dbPath = join(root, 'data.db');
  const db = createDB(dbPath);
  migrateDB(db);
  const s = db.session.client;
  const now = Date.now();
  s.prepare(`INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES ('p1', 'P', ?, ?, ?)`).run(join(art, 'projects', 'p1'), now, now);
  s.prepare(
    `INSERT INTO project_codebases (id, project_id, alias, type, clone_path, status, created_at, updated_at)
     VALUES ('cb1', 'p1', 'repo', 'git-remote', ?, 'ready', ?, ?)`,
  ).run(clone, now, now);
  s.prepare(
    `INSERT INTO worktrees (id, project_id, codebase_id, run_id, run_type, worktree_path, branch_name, status, created_at)
     VALUES ('w1', 'p1', 'cb1', 'r1', 'workflow', ?, 'generatorai/run-r1-repo', 'active', ?)`,
  ).run(wt1, now);
  s.prepare(
    `INSERT INTO execution_workspaces (id, owner_type, owner_id, root_path, status, created_at, updated_at)
     VALUES ('ws2', 'workflow_run', 'r2', ?, 'completed', ?, ?)`,
  ).run(wsRoot, now, now);
  s.prepare(
    `INSERT INTO workspace_mounts (id, workspace_id, alias, origin_kind, mode, path, status, created_at, updated_at)
     VALUES ('m2', 'ws2', 'repo', 'codebase', 'worktree', ?, 'ready', ?, ?)`,
  ).run(wt2, now, now);
  closeDB(db);
  return { art, ws, clone, wt1, wt2, dbPath };
}

const branches = (clone) => git(clone, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/generatorai').split('\n').filter(Boolean).sort();

describe('workflow-cleanup-runs', () => {
  it('resolves the parent clone of a linked worktree', () => {
    const f = fixture();
    // realpath: git writes the long form of the temp dir, tmpdir() may be 8.3.
    expect(realpathSync.native(parentCloneOf(f.wt1))).toBe(realpathSync.native(f.clone));
    expect(parentCloneOf(f.clone)).toBeNull();
  });

  it('dry run changes nothing and logs the plan', async () => {
    const f = fixture();
    const before = branches(f.clone);
    const res = await runCleanup(
      { dbPath: f.dbPath, backupRoot: join(root, 'bk'), workspacesDir: f.ws, artifactsDir: f.art, dryRun: true, port: 1 },
      deps,
    );
    expect(existsSync(f.wt1) && existsSync(f.wt2)).toBe(true);
    expect(branches(f.clone)).toEqual(before);
    expect(res.summary.worktreeRows.found).toBe(1);
    expect(res.summary.mounts.found).toBe(1);
    const log = readFileSync(res.logFile, 'utf8');
    expect(log).toContain('generatorai/run-pushed: keep (pushed and not merged)');
    expect(log).toContain('generatorai/run-unpushed: delete (never pushed)');
    expect(log).toContain('DRY RUN');
  });

  it('removes run worktrees, deletes merged/unpushed run branches, keeps pushed ones, lists orphans', async () => {
    const f = fixture();
    const res = await runCleanup(
      { dbPath: f.dbPath, backupRoot: join(root, 'bk'), workspacesDir: f.ws, artifactsDir: f.art, port: 1 },
      deps,
    );
    expect(existsSync(f.wt1)).toBe(false);
    expect(existsSync(f.wt2)).toBe(false);
    expect(git(f.clone, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(branches(f.clone)).toEqual(['generatorai/run-pushed']);
    expect(res.summary.worktreeRows).toEqual({ found: 1, removed: 1, failed: 0 });
    expect(res.summary.mounts).toEqual({ found: 1, removed: 1, missing: 0, failed: 0 });

    const db = createDB(f.dbPath);
    expect(db.session.client.prepare(`SELECT COUNT(*) AS n FROM worktrees`).get().n).toBe(0);
    expect(db.session.client.prepare(`SELECT status FROM workspace_mounts WHERE id = 'm2'`).get().status).toBe('removed');
    closeDB(db);

    // Orphans are listed, never deleted.
    expect(res.summary.orphans.map((o) => o.replace(/\\/g, '/').split('/').pop()).sort()).toEqual(['orphan-ws', 'r-orphan']);
    expect(existsSync(join(f.ws, 'executions', 'orphan-ws'))).toBe(true);
    const summary = JSON.parse(readFileSync(join(res.outDir, 'cleanup.json'), 'utf8'));
    expect(summary.dryRun).toBe(false);
    expect(summary.dbPath).toBe(f.dbPath);
  });
});
