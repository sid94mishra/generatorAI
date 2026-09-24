#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// workflow-cleanup-runs.mjs — P00 WP-0.8 of the workflow overhaul (RV-29).
//
// v55 and v57 drop workflow run history. The runs' git worktrees must be
// released FIRST: once the rows are gone, nothing records where a run's
// worktree lives, and the parent clones keep the registrations (and the
// `generatorai/run-*` branches) forever. This script, run against a DB with
// the server stopped:
//
//   1. refuses to run while port 3100 is listening;
//   2. for every `worktrees` row with run_type='workflow', removes the git
//      worktree through the repo's own `WorktreeService.removeWorktree`
//      (`git worktree remove` + `git worktree prune` on the parent clone,
//      the directory, and the row);
//   3. for every `execution_workspaces` row with owner_type='workflow_run',
//      does the same for its worktree mounts that lie inside the workspace
//      root (git-driven: the `.git` file names the parent clone);
//   4. deletes `generatorai/run-*` branches in every project clone ONLY when
//      merged into the clone's default branch or never pushed; a pushed,
//      unmerged branch (an open PR, perhaps) is kept and logged;
//   5. LISTS orphan directories (execution workspaces with no row, run
//      worktree dirs with no row) without deleting anything;
//   6. logs every action to <backup-root>/<ts>/cleanup.log and writes
//      cleanup.json (the record v55/v57 look for: dbPath + dryRun + counts).
//
// Usage:
//   pnpm workflow:cleanup-runs [--db <path>] [--out-root <dir>] [--dry-run]
//                              [--workspaces-dir <dir>] [--artifacts-dir <dir>] [--port <n>]
//
// Defaults follow the server and `workflow-backup.mjs`: --db $DB_PATH or
// <repo>/packages/db/data/generatorai.db; --workspaces-dir $WORKSPACES_DIR or
// ~/.generatorai/workspaces; --artifacts-dir $ARTIFACTS_DIR or
// ~/.generatorai/artifacts; --out-root $GENERATORAI_BACKUP_ROOT or
// ~/.generatorai-backups. `--dry-run` reads everything and changes nothing.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { defaultBackupRoot, defaultDbPath, isPortListening, parseArgs, timestamp } from './workflow-backup.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expandHome = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

async function git(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: String(err?.stderr ?? err?.message ?? err).trim() };
  }
}

/**
 * The parent clone of a linked worktree, from its `.git` FILE
 * (`gitdir: <clone>/.git/worktrees/<name>`). Null for anything else.
 */
export function parentCloneOf(worktreePath) {
  const dotGit = join(worktreePath, '.git');
  try {
    if (!statSync(dotGit).isFile()) return null;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    const gitdir = resolve(worktreePath, m[1].trim());
    const idx = gitdir.replace(/\\/g, '/').lastIndexOf('/.git/worktrees/');
    return idx === -1 ? null : gitdir.slice(0, idx);
  } catch {
    return null;
  }
}

/** Load the repo's own TypeScript services with the `tsx` packages/db declares. */
export async function loadDeps() {
  const require = createRequire(join(REPO_ROOT, 'packages', 'db', 'package.json'));
  const { tsImport } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
  const load = (rel) => tsImport(pathToFileURL(join(REPO_ROOT, rel)).href, import.meta.url);
  const [db, wt, ps, gm, sr] = await Promise.all([
    load('packages/db/src/index.ts'),
    load('packages/core/src/services/WorktreeService.ts'),
    load('packages/core/src/services/ProjectService.ts'),
    load('packages/core/src/infrastructure/GitManager.ts'),
    load('packages/core/src/infrastructure/SandboxedScriptRunner.ts'),
  ]);
  return {
    createDB: db.createDB,
    closeDB: db.closeDB,
    DrizzleWorktreeRepository: db.DrizzleWorktreeRepository,
    DrizzleProjectCodebaseRepository: db.DrizzleProjectCodebaseRepository,
    DrizzleProjectRepository: db.DrizzleProjectRepository,
    DrizzleProjectConfigRepository: db.DrizzleProjectConfigRepository,
    WorktreeService: wt.WorktreeService,
    ProjectService: ps.ProjectService,
    GitManager: gm.GitManager,
    SandboxedScriptRunner: sr.SandboxedScriptRunner,
  };
}

/**
 * @param {{ dbPath: string, backupRoot: string, workspacesDir: string, artifactsDir: string,
 *           dryRun?: boolean, port?: number, log?: (line: string) => void }} opts
 */
export async function runCleanup(opts, deps) {
  const { dryRun = false, port = 3100 } = opts;
  if (await isPortListening(port)) {
    throw Object.assign(new Error(`port ${port} is listening — stop the server before cleaning up runs`), { exitCode: 3 });
  }
  const dbPath = resolve(expandHome(opts.dbPath));
  if (!existsSync(dbPath)) throw Object.assign(new Error(`database not found: ${dbPath}`), { exitCode: 2 });
  const workspacesDir = resolve(expandHome(opts.workspacesDir));
  const artifactsDir = resolve(expandHome(opts.artifactsDir));

  const outDir = join(resolve(expandHome(opts.backupRoot)), timestamp());
  mkdirSync(outDir, { recursive: true });
  const logFile = join(outDir, 'cleanup.log');
  const log = (line) => {
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    opts.log?.(line);
  };
  log(`[cleanup] db=${dbPath} dryRun=${dryRun} workspacesDir=${workspacesDir} artifactsDir=${artifactsDir}`);

  deps ??= await loadDeps();
  const quiet = { debug() {}, info: (m) => log(`  ${m}`), warn: (m) => log(`  WARN ${m}`), error: (m) => log(`  ERROR ${m}`) };
  const db = deps.createDB(dbPath);
  const sqlite = db.session.client;
  const summary = {
    dbPath,
    dryRun,
    startedAt: new Date().toISOString(),
    worktreeRows: { found: 0, removed: 0, failed: 0 },
    mounts: { found: 0, removed: 0, missing: 0, failed: 0 },
    branches: { found: 0, deleted: 0, kept: 0, failed: 0 },
    orphans: [],
  };
  try {
    const hasTable = (t) => !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    const scriptRunner = new deps.SandboxedScriptRunner(quiet);
    const gitManager = new deps.GitManager(scriptRunner, quiet, { workspacesDir });
    const codebaseRepo = new deps.DrizzleProjectCodebaseRepository(db);
    const projectService = new deps.ProjectService(
      new deps.DrizzleProjectRepository(db),
      codebaseRepo,
      new deps.DrizzleProjectConfigRepository(db),
      artifactsDir,
      quiet,
    );
    const worktreeService = new deps.WorktreeService(
      new deps.DrizzleWorktreeRepository(db),
      codebaseRepo,
      projectService,
      gitManager,
      quiet,
    );
    const clones = new Set();

    // Orphans are judged against the rows as they are BEFORE this cleanup
    // removes anything; otherwise a run directory emptied below would be
    // reported as an orphan it never was.
    const owners = new Set(
      hasTable('execution_workspaces')
        ? sqlite.prepare(`SELECT owner_id AS o FROM execution_workspaces`).all().map((r) => r.o)
        : [],
    );
    const knownWorktrees = hasTable('worktrees')
      ? sqlite.prepare(`SELECT worktree_path AS p FROM worktrees`).all().map((r) => resolve(r.p))
      : [];

    // ── 2. worktree rows of workflow runs ──
    const rows = hasTable('worktrees')
      ? sqlite
          .prepare(
            `SELECT w.id, w.run_id AS runId, w.worktree_path AS path, w.branch_name AS branch, c.clone_path AS clone
               FROM worktrees w LEFT JOIN project_codebases c ON c.id = w.codebase_id
              WHERE w.run_type = 'workflow' ORDER BY w.created_at`,
          )
          .all()
      : [];
    summary.worktreeRows.found = rows.length;
    const handled = new Set();
    for (const r of rows) {
      handled.add(resolve(r.path));
      if (r.clone) clones.add(resolve(r.clone));
      log(`[worktree] run=${r.runId} ${r.path} (${r.branch}) ${existsSync(r.path) ? 'present' : 'missing on disk'}`);
      if (dryRun) continue;
      try {
        await worktreeService.removeWorktree(r.id);
        summary.worktreeRows.removed++;
        log(`[worktree] removed ${r.id}`);
      } catch (err) {
        summary.worktreeRows.failed++;
        log(`[worktree] FAILED ${r.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── 3. worktree mounts of workflow-run workspaces ──
    const workspaces = hasTable('execution_workspaces')
      ? sqlite
          .prepare(`SELECT id, owner_id AS ownerId, root_path AS root, status FROM execution_workspaces WHERE owner_type = 'workflow_run'`)
          .all()
      : [];
    log(`[workspaces] ${workspaces.length} workflow-run workspace(s)`);
    const mountStmt = hasTable('workspace_mounts')
      ? sqlite.prepare(`SELECT id, path FROM workspace_mounts WHERE workspace_id = ? AND mode = 'worktree' AND status <> 'removed'`)
      : null;
    for (const ws of workspaces) {
      const root = resolve(ws.root);
      for (const m of mountStmt ? mountStmt.all(ws.id) : []) {
        const p = resolve(m.path);
        if (handled.has(p)) continue;
        if (p !== root && !p.startsWith(root + sep)) {
          log(`[mount] skip ${m.id}: ${m.path} is outside workspace ${ws.id}`);
          continue;
        }
        handled.add(p);
        summary.mounts.found++;
        if (!existsSync(p)) {
          summary.mounts.missing++;
          log(`[mount] run=${ws.ownerId} ${p} missing on disk`);
          continue;
        }
        const clone = parentCloneOf(p);
        if (clone) clones.add(resolve(clone));
        log(`[mount] run=${ws.ownerId} ${p} parent=${clone ?? '(not a linked worktree)'}`);
        if (dryRun || !clone) continue;
        const rm = await git(clone, ['worktree', 'remove', '--force', p]);
        await git(clone, ['worktree', 'prune']);
        if (rm.ok) {
          summary.mounts.removed++;
          if (hasTable('workspace_mounts')) {
            sqlite.prepare(`UPDATE workspace_mounts SET status = 'removed', updated_at = ? WHERE id = ?`).run(Date.now(), m.id);
          }
          log(`[mount] removed ${p}`);
        } else {
          summary.mounts.failed++;
          log(`[mount] FAILED ${p}: ${rm.out}`);
        }
      }
    }

    // ── 4. generatorai/run-* branches ──
    if (hasTable('project_codebases')) {
      for (const c of sqlite.prepare(`SELECT clone_path AS clone FROM project_codebases WHERE clone_path IS NOT NULL AND type <> 'local-dir'`).all()) {
        clones.add(resolve(c.clone));
      }
    }
    for (const clone of [...clones].sort()) {
      if (!existsSync(clone)) {
        log(`[branches] ${clone}: clone missing on disk`);
        continue;
      }
      if (!dryRun) await git(clone, ['worktree', 'prune']);
      const list = await git(clone, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/generatorai/run-*']);
      if (!list.ok) {
        log(`[branches] ${clone}: ${list.out}`);
        continue;
      }
      const branches = list.out ? list.out.split('\n') : [];
      if (branches.length === 0) continue;
      const remoteRefs = new Set(
        ((await git(clone, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])).out || '').split('\n'),
      );
      const checkedOut = new Set(
        [...((await git(clone, ['worktree', 'list', '--porcelain'])).out || '').matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]),
      );
      const originHead = await git(clone, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
      const base = originHead.ok && originHead.out ? originHead.out : 'HEAD';
      for (const b of branches) {
        summary.branches.found++;
        const merged = (await git(clone, ['merge-base', '--is-ancestor', b, base])).ok;
        const upstream = (await git(clone, ['config', '--get', `branch.${b}.remote`])).ok;
        const pushed = upstream || [...remoteRefs].some((r) => r.endsWith(`/${b}`));
        const verdict = checkedOut.has(b)
          ? 'keep (checked out in a worktree)'
          : merged
            ? `delete (merged into ${base})`
            : !pushed
              ? 'delete (never pushed)'
              : 'keep (pushed and not merged)';
        log(`[branch] ${clone} ${b}: ${verdict}`);
        if (!verdict.startsWith('delete')) {
          summary.branches.kept++;
          continue;
        }
        if (dryRun) continue;
        const del = await git(clone, ['branch', '-D', b]);
        if (del.ok) summary.branches.deleted++;
        else {
          summary.branches.failed++;
          log(`[branch] FAILED ${b}: ${del.out}`);
        }
      }
    }

    // ── 5. orphan directories (listed, never deleted) ──
    const execDir = join(workspacesDir, 'executions');
    if (existsSync(execDir)) {
      for (const name of readdirSync(execDir)) {
        if (!owners.has(name)) summary.orphans.push(join(execDir, name));
      }
    }
    const projectsDir = join(artifactsDir, 'projects');
    if (existsSync(projectsDir)) {
      for (const project of readdirSync(projectsDir)) {
        const wtDir = join(projectsDir, project, 'worktrees');
        if (!existsSync(wtDir)) continue;
        for (const run of readdirSync(wtDir)) {
          const runDir = resolve(wtDir, run);
          if (!knownWorktrees.some((p) => p === runDir || p.startsWith(runDir + sep))) summary.orphans.push(runDir);
        }
      }
    }
    for (const o of summary.orphans) log(`[orphan] ${o} (not deleted)`);
  } finally {
    deps.closeDB(db);
  }
  summary.finishedAt = new Date().toISOString();
  writeFileSync(join(outDir, 'cleanup.json'), JSON.stringify(summary, null, 2));
  log(
    `[cleanup] ${dryRun ? 'DRY RUN — nothing changed. ' : ''}worktree rows ${summary.worktreeRows.found} ` +
      `(removed ${summary.worktreeRows.removed}), mounts ${summary.mounts.found} (removed ${summary.mounts.removed}, ` +
      `missing ${summary.mounts.missing}), run branches ${summary.branches.found} (deleted ${summary.branches.deleted}, ` +
      `kept ${summary.branches.kept}), orphan dirs ${summary.orphans.length}`,
  );
  log(`CLEANUP_LOG=${logFile}`);
  return { outDir, logFile, summary };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const pick = (flag, env, fallback) => (typeof args[flag] === 'string' ? args[flag] : process.env[env] || fallback);
  runCleanup({
    dbPath: typeof args.db === 'string' ? args.db : defaultDbPath(),
    backupRoot: typeof args['out-root'] === 'string' ? args['out-root'] : defaultBackupRoot(),
    workspacesDir: pick('workspaces-dir', 'WORKSPACES_DIR', '~/.generatorai/workspaces'),
    artifactsDir: pick('artifacts-dir', 'ARTIFACTS_DIR', '~/.generatorai/artifacts'),
    dryRun: !!args['dry-run'],
    port: args.port ? Number(args.port) : 3100,
    log: (l) => console.log(l),
  }).catch((err) => {
    console.error(`[cleanup] ${err.message}`);
    process.exit(err.exitCode ?? 1);
  });
}
