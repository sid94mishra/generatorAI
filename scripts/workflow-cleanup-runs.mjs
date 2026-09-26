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
//   1. refuses to run while port 3100 is listening (IPv4 or IPv6);
//   2. for every `worktrees` row with run_type IN ('workflow','automation'),
//      removes the git worktree through the repo's own
//      `WorktreeService.removeWorktree` (`git worktree remove` + prune, the
//      directory and the row);
//   3. for every `execution_workspaces` row owned by a workflow run or an
//      automation execution, finds its worktrees three ways — worktree mounts,
//      a scan of `<root>/source/*` (the `.git` file names the parent clone),
//      and `git worktree list --porcelain` entries under the root — and
//      removes them from their parent clone;
//   4. deletes a `generatorai/run-<id8>-*` branch ONLY when <id8> belongs to a
//      workflow run or automation (a `workflow_runs` id, an automation
//      execution, or a `worktrees` row of that type) AND NOTHING chat-owned
//      shares the id (chats, chat workspaces and chat worktree rows use the
//      same `run-` prefix), AND the branch is merged into the clone's default
//      branch or was never pushed. "Pushed" asks the remote itself
//      (`git ls-remote --heads`), because product clones are bare with no
//      fetch refspec and keep no remote-tracking refs; when the remote cannot
//      be asked, the branch is kept. Branches checked out in a live (not
//      prunable) worktree are kept;
//   5. LISTS orphan directories (execution workspaces with no row, run
//      worktree dirs with no row) without deleting anything;
//   6. logs every action (including a `git status --porcelain` summary before
//      any forced worktree removal) to <backup-root>/<ts>/cleanup.log and
//      writes cleanup.json (the record v55/v57 look for: dbPath + dryRun +
//      counts).
//
// `--dry-run` opens the DB READ-ONLY, changes nothing, and predicts the real
// run: prunable worktrees are treated as already pruned.
//
// Usage:
//   pnpm workflow:cleanup-runs [--db <path>] [--out-root <dir>] [--dry-run]
//                              [--workspaces-dir <dir>] [--artifacts-dir <dir>] [--port <n>]
//
// Defaults follow the server and `workflow-backup.mjs`: --db $DB_PATH or
// <repo>/packages/db/data/generatorai.db; --workspaces-dir $WORKSPACES_DIR or
// ~/.generatorai/workspaces; --artifacts-dir $ARTIFACTS_DIR or
// ~/.generatorai/artifacts; --out-root $GENERATORAI_BACKUP_ROOT or
// ~/.generatorai-backups.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  createBackupDir,
  defaultBackupRoot,
  defaultDbPath,
  isPortListening,
  loadSqlite,
  parseArgs,
} from './workflow-backup.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expandHome = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
const RUN_BRANCH = /^generatorai\/run-([0-9a-f]{8})-/i;

async function git(cwd, args, timeout = 60_000) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout,
    });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: String(err?.stderr ?? err?.message ?? err).trim() };
  }
}

/** Case-insensitive on Windows, where the same directory has many spellings. */
const norm = (p) => {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
/** One key per clone however its path is spelled (8.3 names, case, slashes). */
const cloneKey = (p) => {
  try {
    return norm(realpathSync.native(p));
  } catch {
    return norm(p);
  }
};
const within = (child, root) => {
  const c = norm(child);
  const r = norm(root);
  return c === r || c.startsWith(r + sep);
};

/**
 * The parent clone of a linked worktree, from its `.git` FILE. Handles both
 * a normal clone (`gitdir: <clone>/.git/worktrees/<name>`) and a bare clone
 * (`gitdir: <bare>/worktrees/<name>`, what product clones are). Null for
 * anything that is not a linked worktree.
 */
export function parentCloneOf(worktreePath) {
  const dotGit = join(worktreePath, '.git');
  try {
    if (!statSync(dotGit).isFile()) return null;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    const gitdir = resolve(worktreePath, m[1].trim());
    const fwd = gitdir.replace(/\\/g, '/');
    const nonBare = fwd.lastIndexOf('/.git/worktrees/');
    if (nonBare !== -1) return gitdir.slice(0, nonBare);
    const bare = fwd.lastIndexOf('/worktrees/');
    return bare === -1 ? null : gitdir.slice(0, bare);
  } catch {
    return null;
  }
}

/** `git worktree list --porcelain` → [{ path, branch?, prunable, bare }]. */
export function parseWorktreeList(porcelain) {
  const out = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const wt = lines.find((l) => l.startsWith('worktree '));
    if (!wt) continue;
    const branch = lines.find((l) => l.startsWith('branch refs/heads/'));
    out.push({
      path: wt.slice('worktree '.length),
      ...(branch ? { branch: branch.slice('branch refs/heads/'.length) } : {}),
      prunable: lines.some((l) => l.startsWith('prunable')),
      bare: lines.includes('bare'),
    });
  }
  return out;
}

/**
 * Who owns an 8-char `run-<id8>` branch id. Chat-owned ids are never
 * deleted, even when they also collide with a run id.
 */
export function buildOwnership(sqlite) {
  const hasTable = (t) => !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const ids = (sql) => sqlite.prepare(sql).all().map((r) => String(r.id).slice(0, 8).toLowerCase());
  const run = new Set();
  const chat = new Set();
  if (hasTable('workflow_runs')) ids(`SELECT id FROM workflow_runs`).forEach((i) => run.add(i));
  if (hasTable('automation_executions')) ids(`SELECT id FROM automation_executions`).forEach((i) => run.add(i));
  if (hasTable('worktrees')) {
    ids(`SELECT run_id AS id FROM worktrees WHERE run_type IN ('workflow','automation') AND run_id IS NOT NULL`).forEach((i) => run.add(i));
    ids(`SELECT run_id AS id FROM worktrees WHERE (run_type IS NULL OR run_type NOT IN ('workflow','automation')) AND run_id IS NOT NULL`).forEach((i) =>
      chat.add(i),
    );
  }
  if (hasTable('execution_workspaces')) {
    ids(`SELECT owner_id AS id FROM execution_workspaces WHERE owner_type IN ('workflow_run','automation_execution')`).forEach((i) => run.add(i));
    ids(`SELECT owner_id AS id FROM execution_workspaces WHERE owner_type = 'chat'`).forEach((i) => chat.add(i));
  }
  if (hasTable('chats')) ids(`SELECT id FROM chats`).forEach((i) => chat.add(i));
  return {
    run,
    chat,
    /** 'chat' | 'run' | 'unknown' for a branch name. */
    ownerOf(branch) {
      const m = RUN_BRANCH.exec(branch);
      if (!m) return 'unknown';
      const id = m[1].toLowerCase();
      if (chat.has(id)) return 'chat';
      if (run.has(id)) return 'run';
      return 'unknown';
    },
  };
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

/** Branch names on each remote of a clone; null when a remote could not be asked. */
async function remoteBranches(clone) {
  const remotes = (await git(clone, ['remote'])).out.split(/\r?\n/).filter(Boolean);
  const names = new Set();
  for (const r of remotes) {
    const ls = await git(clone, ['ls-remote', '--heads', r, 'refs/heads/generatorai/run-*'], 30_000);
    if (!ls.ok) return { names, unreachable: r, error: ls.out };
    for (const line of ls.out.split(/\r?\n/)) {
      const m = /\srefs\/heads\/(.+)$/.exec(line);
      if (m) names.add(m[1]);
    }
  }
  return { names, unreachable: null };
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

  const outDir = createBackupDir(resolve(expandHome(opts.backupRoot)));
  const logFile = join(outDir, 'cleanup.log');
  const log = (line) => {
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    opts.log?.(line);
  };
  log(`[cleanup] db=${dbPath} dryRun=${dryRun} workspacesDir=${workspacesDir} artifactsDir=${artifactsDir}`);

  // A dry run opens the database read-only and never builds the services
  // that write; only the real run needs the Drizzle repositories.
  let db;
  let sqlite;
  let closeDb;
  if (dryRun) {
    const Database = loadSqlite();
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    closeDb = () => sqlite.close();
  } else {
    deps ??= await loadDeps();
    db = deps.createDB(dbPath);
    sqlite = db.session.client;
    closeDb = () => deps.closeDB(db);
  }
  const quiet = { debug() {}, info: (m) => log(`  ${m}`), warn: (m) => log(`  WARN ${m}`), error: (m) => log(`  ERROR ${m}`) };
  const summary = {
    dbPath,
    dryRun,
    startedAt: new Date().toISOString(),
    worktreeRows: { found: 0, removed: 0, failed: 0 },
    mounts: { found: 0, removed: 0, missing: 0, failed: 0 },
    branches: { found: 0, deleted: 0, kept: 0, failed: 0, chatOwned: 0, unknownOwner: 0 },
    orphans: [],
  };

  /** Log what a forced removal is about to discard. */
  const logDirty = async (path) => {
    if (!existsSync(path)) return;
    const st = await git(path, ['status', '--porcelain']);
    if (!st.ok) return log(`  [status] ${path}: ${st.out.slice(0, 200)}`);
    const lines = st.out ? st.out.split(/\r?\n/) : [];
    log(`  [status] ${path}: ${lines.length === 0 ? 'clean' : `${lines.length} uncommitted change(s): ${lines.slice(0, 5).join(' | ')}`}`);
  };

  try {
    const hasTable = (t) => !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    const ownership = buildOwnership(sqlite);
    let worktreeService;
    if (!dryRun) {
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
      worktreeService = new deps.WorktreeService(new deps.DrizzleWorktreeRepository(db), codebaseRepo, projectService, gitManager, quiet);
    }

    // Every project clone, up front: step 3 consults their worktree lists.
    // Keyed by real path so one clone spelled two ways is processed once.
    const cloneMap = new Map();
    const clones = { add: (c) => { const k = cloneKey(c); if (!cloneMap.has(k)) cloneMap.set(k, resolve(c)); } };
    if (hasTable('project_codebases')) {
      for (const c of sqlite
        .prepare(`SELECT clone_path AS clone FROM project_codebases WHERE clone_path IS NOT NULL AND type <> 'local-dir'`)
        .all()) {
        clones.add(resolve(c.clone));
      }
    }

    // Orphans are judged against the rows as they are BEFORE this cleanup
    // removes anything; otherwise a run directory emptied below would be
    // reported as an orphan it never was.
    const owners = new Set(
      hasTable('execution_workspaces') ? sqlite.prepare(`SELECT owner_id AS o FROM execution_workspaces`).all().map((r) => r.o) : [],
    );
    const knownWorktrees = hasTable('worktrees')
      ? sqlite.prepare(`SELECT worktree_path AS p FROM worktrees`).all().map((r) => norm(r.p))
      : [];

    // ── 2. worktree rows of workflow runs / automations ──
    const rows = hasTable('worktrees')
      ? sqlite
          .prepare(
            `SELECT w.id, w.run_id AS runId, w.run_type AS runType, w.worktree_path AS path, w.branch_name AS branch,
                    c.clone_path AS clone
               FROM worktrees w LEFT JOIN project_codebases c ON c.id = w.codebase_id
              WHERE w.run_type IN ('workflow','automation') ORDER BY w.created_at`,
          )
          .all()
      : [];
    summary.worktreeRows.found = rows.length;
    const handled = new Set();
    for (const r of rows) {
      handled.add(norm(r.path));
      if (r.clone) clones.add(resolve(r.clone));
      log(`[worktree] ${r.runType} run=${r.runId} ${r.path} (${r.branch}) ${existsSync(r.path) ? 'present' : 'missing on disk'}`);
      await logDirty(r.path);
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

    // ── 3. worktrees of workflow-run / automation workspaces ──
    const workspaces = hasTable('execution_workspaces')
      ? sqlite
          .prepare(
            `SELECT id, owner_id AS ownerId, root_path AS root FROM execution_workspaces
              WHERE owner_type IN ('workflow_run','automation_execution')`,
          )
          .all()
      : [];
    log(`[workspaces] ${workspaces.length} workflow-run/automation workspace(s)`);
    const mountStmt = hasTable('workspace_mounts')
      ? sqlite.prepare(`SELECT id, path FROM workspace_mounts WHERE workspace_id = ? AND mode = 'worktree' AND status <> 'removed'`)
      : null;
    const cloneWorktrees = new Map();
    for (const clone of cloneMap.values()) {
      if (!existsSync(clone)) continue;
      const list = await git(clone, ['worktree', 'list', '--porcelain']);
      cloneWorktrees.set(clone, list.ok ? parseWorktreeList(list.out) : []);
    }
    for (const ws of workspaces) {
      const root = resolve(ws.root);
      /** path → { mountId?, clone? } */
      const found = new Map();
      for (const m of mountStmt ? mountStmt.all(ws.id) : []) {
        if (!within(m.path, root)) {
          log(`[mount] skip ${m.id}: ${m.path} is outside workspace ${ws.id}`);
          continue;
        }
        found.set(norm(m.path), { path: resolve(m.path), mountId: m.id });
      }
      const sourceDir = join(root, 'source');
      if (existsSync(sourceDir)) {
        for (const alias of readdirSync(sourceDir)) {
          const p = join(sourceDir, alias);
          const clone = parentCloneOf(p);
          if (clone && !found.has(norm(p))) found.set(norm(p), { path: p, clone });
        }
      }
      for (const [clone, list] of cloneWorktrees) {
        for (const wt of list) {
          if (!wt.bare && within(wt.path, root) && !found.has(norm(wt.path))) found.set(norm(wt.path), { path: resolve(wt.path), clone });
        }
      }
      for (const [key, f] of found) {
        if (handled.has(key)) continue;
        handled.add(key);
        summary.mounts.found++;
        const clone = f.clone ?? (existsSync(f.path) ? parentCloneOf(f.path) : null);
        if (clone) clones.add(resolve(clone));
        if (!existsSync(f.path)) {
          summary.mounts.missing++;
          log(`[mount] run=${ws.ownerId} ${f.path} missing on disk${clone ? ` (registered in ${clone}; pruned below)` : ''}`);
          continue;
        }
        log(`[mount] run=${ws.ownerId} ${f.path} parent=${clone ?? '(not a linked worktree)'}`);
        await logDirty(f.path);
        if (dryRun || !clone) continue;
        const rm = await git(clone, ['worktree', 'remove', '--force', f.path]);
        await git(clone, ['worktree', 'prune']);
        if (rm.ok) {
          summary.mounts.removed++;
          if (f.mountId) {
            sqlite.prepare(`UPDATE workspace_mounts SET status = 'removed', updated_at = ? WHERE id = ?`).run(Date.now(), f.mountId);
          }
          log(`[mount] removed ${f.path}`);
        } else {
          summary.mounts.failed++;
          log(`[mount] FAILED ${f.path}: ${rm.out}`);
        }
      }
    }

    // ── 4. generatorai/run-* branches ──
    for (const clone of [...cloneMap.values()].sort()) {
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
      const branches = list.out ? list.out.split(/\r?\n/) : [];
      if (branches.length === 0) continue;
      // A prunable worktree is gone on disk; the real run prunes it above, so
      // a dry run must not count it as holding its branch.
      const checkedOut = new Set(
        parseWorktreeList((await git(clone, ['worktree', 'list', '--porcelain'])).out || '')
          .filter((w) => w.branch && !w.prunable)
          .map((w) => w.branch),
      );
      const remote = await remoteBranches(clone);
      if (remote.unreachable) log(`[branches] ${clone}: remote ${remote.unreachable} unreachable (${remote.error.slice(0, 160)}); unmerged branches are kept`);
      // The default branch: origin/HEAD on a normal clone; a bare product
      // clone has no remote-tracking refs, and its own HEAD IS the default.
      const originHead = await git(clone, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
      const base = originHead.ok && originHead.out ? originHead.out : 'HEAD';
      for (const b of branches) {
        summary.branches.found++;
        const owner = ownership.ownerOf(b);
        let verdict;
        if (owner === 'chat') {
          summary.branches.chatOwned++;
          verdict = 'keep (chat-owned)';
        } else if (owner !== 'run') {
          summary.branches.unknownOwner++;
          verdict = 'keep (owner unknown)';
        } else if (checkedOut.has(b)) {
          verdict = 'keep (checked out in a worktree)';
        } else if ((await git(clone, ['merge-base', '--is-ancestor', b, base])).ok) {
          verdict = `delete (merged into ${base})`;
        } else if (remote.unreachable) {
          verdict = 'keep (remote unreachable; cannot prove it was never pushed)';
        } else if (remote.names.has(b)) {
          verdict = 'keep (pushed and not merged)';
        } else {
          verdict = 'delete (never pushed)';
        }
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
          const runDir = norm(join(wtDir, run));
          if (!knownWorktrees.some((p) => p === runDir || p.startsWith(runDir + sep))) summary.orphans.push(resolve(wtDir, run));
        }
      }
    }
    for (const o of summary.orphans) log(`[orphan] ${o} (not deleted)`);
  } finally {
    closeDb();
  }
  summary.finishedAt = new Date().toISOString();
  writeFileSync(join(outDir, 'cleanup.json'), JSON.stringify(summary, null, 2));
  const b = summary.branches;
  log(
    `[cleanup] ${dryRun ? 'DRY RUN — nothing changed. ' : ''}worktree rows ${summary.worktreeRows.found} ` +
      `(removed ${summary.worktreeRows.removed}), workspace worktrees ${summary.mounts.found} (removed ${summary.mounts.removed}, ` +
      `missing ${summary.mounts.missing}), run branches ${b.found} (deleted ${b.deleted}, kept ${b.kept}: ` +
      `${b.chatOwned} chat-owned, ${b.unknownOwner} unknown owner), orphan dirs ${summary.orphans.length}`,
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
