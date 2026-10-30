// ────────────────────────────────────────────────────────────────
// StageIsolation — the worktree of an agent stage that works on its own
// (D-155; which stages do: domain/scheduler/isolation.ts).
//
//   place     the stage's worktrees: one per run mount, on a new branch cut
//             from a snapshot of the mount as it is now (uncommitted changes
//             included, like a map snapshot), in a workspace whose root is
//             fixed by (run, stage key) — a loop's next iteration and a
//             continued conversation find the same folder. The snapshot is
//             the merge base, kept by `refs/generatorai/iso/<run>/<stage>/…`.
//             A retry reuses the worktrees its failed attempt left. The run
//             mount's installed dependencies (`node_modules`) are linked in
//             entry by entry, so tests run without a fresh install;
//             relative links (workspace packages) resolve inside the
//             worktree.
//   merge     under the mounts' EXCLUSIVE lease, a 3-way merge per mount
//             (base: the snapshot, ours: the run mount now, theirs: the
//             stage's worktree), all computed before any applies. A conflict
//             applies nothing and answers the conflicted paths;
//             `markConflicts` then writes the merge, conflict markers
//             included, into the worktree and moves the base to the run
//             mount's state, so the agent resolves the markers and the next
//             merge is clean.
//   release   the worktrees, their branches, the workspace and the refs
//             (after a merge, and for every stage when the run finalizes).
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { ILogger, WorkflowRun, WorkspaceMount } from '@generatorai/shared';
import { MAP_ITEM_OWNER_SEP, type MountService } from '../MountService.js';
import { runWorkspace } from '../session/workspaceExposure.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { worktreeLeaseKey, type WorktreeLeases } from './WorktreeLeases.js';

const execFileP = promisify(execFile);

export interface StageIsolationDeps {
  workspaceManager: WorkspaceManager;
  leases: WorktreeLeases;
  platform: () => { mounts?: MountService | undefined };
  logger?: ILogger | undefined;
}

/** Where an isolated stage works. */
export interface IsolatedPlacement {
  workspaceId: string;
  /** alias → the stage's worktree. */
  mounts: Record<string, string>;
  primaryDir: string;
  branch: string | null;
}

export interface MergeConflict {
  /** `alias: path, path` per conflicting mount. */
  summary: string;
  paths: string[];
  /** Per conflicting mount: the run mount's state the merge met and the merge with markers. */
  plans: Array<{ alias: string; ours: string; conflictTree: string }>;
}

export type IsolatedMerge = { ok: true; changed: boolean } | { ok: false; conflict: MergeConflict };

const refSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
/** The owner of a stage's workspace: fixed per (run, stage key), so is its folder. */
const ownerIdOf = (runId: string, stageKey: string) => `${runId}${MAP_ITEM_OWNER_SEP}iso-${refSafe(stageKey)}`;
const baseRefPrefix = (runId: string, stageKey?: string) => `refs/generatorai/iso/${refSafe(runId)}/${stageKey ? `${refSafe(stageKey)}/` : ''}`;

/** Installed-dependency directories linked into a stage's worktree. */
const DEPENDENCY_DIRS = new Set(['node_modules']);

export class StageIsolation {
  constructor(private readonly deps: StageIsolationDeps) {}

  private get svc(): MountService {
    const svc = this.deps.platform().mounts;
    if (!svc) throw new Error('Mounts are not available in this process (no mount service)');
    return svc;
  }

  private async runMounts(run: WorkflowRun): Promise<{ workspaceId: string; root: string; mounts: WorkspaceMount[] }> {
    const ws = await runWorkspace(this.deps.workspaceManager, run);
    const mounts = (await this.svc.list(ws.id)).filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position);
    return { workspaceId: ws.id, root: ws.rootPath, mounts };
  }

  /**
   * The stage's worktrees, cut now or left by an earlier attempt. Null when
   * the run's folder cannot be forked (no mount service, no mounts, or one
   * that is not git backed): the stage then works in the run's folder.
   */
  async place(run: WorkflowRun, stageKey: string): Promise<IsolatedPlacement | null> {
    if (!this.deps.platform().mounts) return null;
    const { workspaceId: runWorkspaceId, root, mounts } = await this.runMounts(run);
    if (mounts.length === 0 || mounts.some((m) => !m.git?.isRepo)) return null;
    const git = this.svc.git;
    const ownerId = ownerIdOf(run.id, stageKey);

    const existing = await this.deps.workspaceManager.findWorkspaceByOwner(ownerId);
    if (existing) {
      const rows = (await this.svc.list(existing.id)).filter((m) => m.status === 'ready').sort((a, b) => a.position - b.position);
      const based = await Promise.all(mounts.map((m) => git.revParse(m.path, `${baseRefPrefix(run.id, stageKey)}${refSafe(m.alias)}`)));
      if (rows.length === mounts.length && based.every(Boolean)) return placementOf(existing.id, rows);
      await this.release(run, stageKey);
    }

    const snapshot: Record<string, string> = {};
    for (const m of mounts) {
      const tree = await git.writeTreeFromWorktree(m.path, path.join(root, '.generatorai', 'iso-index', `${refSafe(stageKey)}-${refSafe(m.alias)}.base`), { honourEol: true });
      if (!tree) throw new Error(`mount "${m.alias}" could not be snapshotted`);
      const head = await git.revParse(m.path, 'HEAD');
      const sha = await git.commitTree(m.path, tree, `GeneratorAI stage snapshot (run ${run.id}, ${stageKey})`, head ?? undefined);
      await git.updateRef(m.path, `${baseRefPrefix(run.id, stageKey)}${refSafe(m.alias)}`, sha);
      snapshot[m.alias] = sha;
    }
    const ws = await this.deps.workspaceManager.createWorkspace({
      ownerType: 'workflow_run',
      ownerId,
      ...(run.projectId ? { projectId: run.projectId } : {}),
      gitEnabled: false,
      sources: [],
    });
    let rows: WorkspaceMount[];
    try {
      const branch = (alias: string) => `generatorai/${run.id.slice(0, 8)}-${refSafe(stageKey)}${mounts.length > 1 ? `-${refSafe(alias)}` : ''}`;
      rows = await this.svc.forkFromSnapshot(runWorkspaceId, snapshot, ws, { branchFor: branch });
    } catch (err) {
      await this.deps.workspaceManager.deleteWorkspace(ws.id).catch(() => undefined);
      throw err;
    }
    for (const m of mounts) {
      const fork = rows.find((r) => r.alias === m.alias);
      if (fork) await linkDependencies(m.path, fork.path).catch((err: unknown) => this.deps.logger?.warn(`[StageIsolation] linking dependencies into ${fork.path}: ${String(err)}`));
    }
    return placementOf(ws.id, rows);
  }

  /** Merge the stage's worktrees into the run mounts (see the file header). */
  async merge(run: WorkflowRun, stageKey: string, placement: IsolatedPlacement, owner: string, cancelled: () => boolean): Promise<IsolatedMerge> {
    const { root, mounts } = await this.runMounts(run);
    const git = this.svc.git;
    const release = await this.deps.leases.acquire(mounts.map((m) => worktreeLeaseKey(m.id)), 'exclusive', owner);
    try {
      const idx = (m: WorkspaceMount, what: string) => path.join(root, '.generatorai', 'iso-index', `${refSafe(stageKey)}-${refSafe(m.alias)}.${what}`);
      const plans: Array<{ mount: WorkspaceMount; from: string; to: string }> = [];
      const conflict: MergeConflict = { summary: '', paths: [], plans: [] };
      const summaries: string[] = [];
      for (const m of mounts) {
        const forkPath = placement.mounts[m.alias];
        const base = await git.revParse(m.path, `${baseRefPrefix(run.id, stageKey)}${refSafe(m.alias)}`);
        if (!forkPath || !base) continue;
        const forkTree = await git.writeTreeFromWorktree(forkPath, idx(m, 'stage'), { honourEol: true });
        if (!forkTree) throw new Error(`the stage's worktree "${m.alias}" could not be read`);
        const baseTree = await git.revParse(m.path, `${base}^{tree}`);
        if (forkTree === baseTree) continue; // the stage changed nothing here
        const theirs = await git.commitTree(forkPath, forkTree, `GeneratorAI stage ${stageKey}`, base);
        const curTree = await git.writeTreeFromWorktree(m.path, idx(m, 'run'), { honourEol: true });
        if (!curTree) throw new Error(`the run mount "${m.alias}" could not be read`);
        const head = await git.revParse(m.path, 'HEAD');
        const ours = await git.commitTree(m.path, curTree, 'GeneratorAI stage merge base', head ?? undefined);
        const merged = await git.mergeTrees(m.path, base, ours, theirs);
        if (!merged.supported) throw new Error(`git could not merge the trees of mount "${m.alias}"`);
        if (merged.conflicts.length > 0 || !merged.tree) {
          summaries.push(`${m.alias}: ${merged.conflicts.slice(0, 10).join(', ')}${merged.conflicts.length > 10 ? ` (+${merged.conflicts.length - 10})` : ''}`);
          conflict.paths.push(...merged.conflicts.map((p) => (mounts.length > 1 ? `${m.alias}/${p}` : p)));
          if (merged.conflictTree) conflict.plans.push({ alias: m.alias, ours, conflictTree: merged.conflictTree });
          continue;
        }
        if (merged.tree !== curTree) plans.push({ mount: m, from: curTree, to: merged.tree });
      }
      if (summaries.length > 0) return { ok: false, conflict: { ...conflict, summary: summaries.join('; ') } };
      if (cancelled()) throw new Error('The run was cancelled before the stage merged');
      const applied: typeof plans = [];
      try {
        for (const p of plans) {
          await git.checkoutTree(p.mount.path, p.from, p.to, idx(p.mount, 'apply'));
          applied.push(p);
        }
      } catch (err) {
        for (const p of applied.reverse()) await git.checkoutTree(p.mount.path, p.to, p.from, idx(p.mount, 'undo')).catch(() => undefined);
        throw err;
      }
      return { ok: true, changed: plans.length > 0 };
    } finally {
      release();
    }
  }

  /**
   * After a conflict: the worktree holds the merge, conflict markers
   * included, and its merge base becomes the run mount's state the merge
   * met — once the agent resolves the markers the next merge is clean.
   */
  async markConflicts(run: WorkflowRun, stageKey: string, placement: IsolatedPlacement, conflict: MergeConflict): Promise<void> {
    const { root, mounts } = await this.runMounts(run);
    const git = this.svc.git;
    for (const plan of conflict.plans) {
      const m = mounts.find((x) => x.alias === plan.alias);
      const forkPath = placement.mounts[plan.alias];
      if (!m || !forkPath) continue;
      const index = path.join(root, '.generatorai', 'iso-index', `${refSafe(stageKey)}-${refSafe(m.alias)}.conflict`);
      const forkTree = await git.writeTreeFromWorktree(forkPath, index, { honourEol: true });
      if (!forkTree) throw new Error(`the stage's worktree "${m.alias}" could not be read`);
      await git.checkoutTree(forkPath, forkTree, plan.conflictTree, `${index}.apply`);
      await git.updateRef(m.path, `${baseRefPrefix(run.id, stageKey)}${refSafe(m.alias)}`, plan.ours);
    }
  }

  /** Remove the stage's worktrees, branches, workspace and base refs. */
  async release(run: Pick<WorkflowRun, 'id' | 'workspaceId'>, stageKey: string): Promise<void> {
    await releaseStageWorktrees({ ...this.deps, mounts: this.deps.platform().mounts }, run, [stageKey]);
  }
}

/**
 * Remove the worktrees, branches, workspaces and base refs of the given
 * stages of a run; without `stageKeys` (the run finalized), of every stage
 * the run has — `stageKeys` then names them.
 */
export async function releaseStageWorktrees(
  deps: { workspaceManager: WorkspaceManager; mounts?: MountService | undefined; logger?: ILogger | undefined },
  run: Pick<WorkflowRun, 'id' | 'workspaceId'>,
  stageKeys: Iterable<string>,
  opts: { allRefs?: boolean } = {},
): Promise<void> {
  const svc = deps.mounts;
  if (!svc) return;
  const keys = [...new Set(stageKeys)];
  for (const key of keys) {
    const ws = await deps.workspaceManager.findWorkspaceByOwner(ownerIdOf(run.id, key)).catch(() => null);
    if (!ws) continue;
    for (const m of await svc.list(ws.id)) await svc.remove(m.id, { deleteBranch: true }).catch(() => undefined);
    await deps.workspaceManager.deleteWorkspace(ws.id).catch((err: unknown) => deps.logger?.warn(`[StageIsolation] workspace ${ws.id}: ${String(err)}`));
  }
  const runWs = await runWorkspace(deps.workspaceManager, run).catch(() => null);
  if (!runWs) return;
  for (const m of await svc.list(runWs.id)) {
    if (!m.git?.isRepo || m.status === 'removed') continue;
    if (opts.allRefs) await deleteRefs(m.path, baseRefPrefix(run.id));
    else for (const key of keys) await deleteRefs(m.path, baseRefPrefix(run.id, key));
  }
}

function placementOf(workspaceId: string, rows: WorkspaceMount[]): IsolatedPlacement {
  return {
    workspaceId,
    mounts: Object.fromEntries(rows.map((m) => [m.alias, m.path])),
    primaryDir: rows[0]!.path,
    branch: rows[0]!.git?.branch ?? null,
  };
}

async function deleteRefs(repoDir: string, prefix: string): Promise<void> {
  try {
    const { stdout } = await execFileP('git', ['for-each-ref', '--format=%(refname)', prefix], { cwd: repoDir, timeout: 15_000 });
    for (const ref of stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
      await execFileP('git', ['update-ref', '-d', ref], { cwd: repoDir, timeout: 15_000 }).catch(() => undefined);
    }
  } catch {
    /* a repository that is gone has no refs left */
  }
}

/**
 * Link the installed dependencies of `from` (a run mount) into `to` (a
 * worktree of it): every ignored `node_modules` git reports becomes a real
 * directory in the worktree (so its own ignore rules still match) whose
 * entries point at the run mount's. A relative link inside — a workspace
 * package (`../packages/b`), pnpm's `.pnpm/…` — is copied as it is, so it
 * resolves inside the worktree and imports see the stage's own edits; an
 * absolute one into the mount (a Windows junction) is moved to the worktree.
 */
export async function linkDependencies(from: string, to: string): Promise<void> {
  const { stdout } = await execFileP('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'], {
    cwd: from,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  for (const line of stdout.split('\n')) {
    const rel = line.trim().replace(/\/$/, '');
    if (!rel || !DEPENDENCY_DIRS.has(path.posix.basename(rel))) continue;
    const dst = path.join(to, ...rel.split('/'));
    if (existsSync(dst) || !existsSync(path.dirname(dst))) continue;
    await mirrorEntries(path.join(from, ...rel.split('/')), dst, from, to, 0);
  }
}

async function mirrorEntries(srcDir: string, dstDir: string, from: string, to: string, depth: number): Promise<void> {
  await fs.mkdir(dstDir, { recursive: true });
  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await fs.readlink(src);
      const inside = path.isAbsolute(target) && !path.relative(from, target).startsWith('..') ? path.join(to, path.relative(from, target)) : null;
      const isDir = await fs.stat(src).then((s) => s.isDirectory()).catch(() => false);
      await linkTo(inside ?? target, dst, isDir, !path.isAbsolute(target));
    } else if (entry.isDirectory() && entry.name.startsWith('@') && depth === 0) {
      await mirrorEntries(src, dst, from, to, depth + 1); // a scope's packages are links of their own
    } else {
      await linkTo(src, dst, entry.isDirectory(), false);
    }
  }
}

async function linkTo(target: string, dst: string, isDir: boolean, relative: boolean): Promise<void> {
  if (process.platform !== 'win32') return fs.symlink(target, dst);
  // Windows: a directory is a junction (no privilege needed; absolute target), a file a copy.
  if (isDir) return fs.symlink(relative ? path.resolve(path.dirname(dst), target) : target, dst, 'junction');
  return fs.copyFile(relative ? path.resolve(path.dirname(dst), target) : target, dst);
}
