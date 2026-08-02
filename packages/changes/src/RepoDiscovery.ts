// ────────────────────────────────────────────────────────────────
// RepoDiscovery — the single definition of "which repos live in a workspace"
// ────────────────────────────────────────────────────────────────
//
// Shared by ChangeSetService (what changed?) and the checkpoint coordinator
// (what do we snapshot?). Both MUST agree, otherwise a repo could be diffed
// against a baseline that was never captured for it.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { IGitClient } from '@generatorai/git';
import type { ChangeRepoKind, WorktreeRef } from './types.js';

/**
 * Directory names managed by the workflow runtime itself — never tracked as
 * source repositories or listed as user output.
 */
export const RESERVED_DIRS = new Set([
  '.git',
  'artifacts',
  'uploads',
  'source',
  'output',
  'scripts',
  'config',
  'node_modules',
  'dist',
  'build',
  '.cache',
  '.next',
  '.turbo',
  'coverage',
]);

export interface DiscoveredRepo {
  alias: string;
  repoDir: string;
  kind: ChangeRepoKind;
}

export interface DiscoverReposParams {
  rootPath: string;
  worktrees?: WorktreeRef[];
  /**
   * Auto-run `git init` in agent-generated subdirectories that have code but
   * no repo yet, so newly-generated codebases get a real change set.
   */
  autoInit?: boolean;
}

/**
 * Discovery order is load-bearing:
 *   1. registered worktrees — so a worktree that physically lives under the
 *      workspace root is never mis-classified as a "generated" subdir repo
 *   2. agent-generated subdirectory repos
 *   3. the workspace root itself
 */
export async function discoverRepos(
  git: IGitClient,
  params: DiscoverReposParams,
): Promise<DiscoveredRepo[]> {
  const { rootPath, worktrees = [], autoInit = true } = params;
  const repos: DiscoveredRepo[] = [];
  const seen = new Set<string>();

  for (const wt of worktrees) {
    const alias = path.basename(wt.worktreePath);
    if (seen.has(alias)) continue;
    if (await hasLocalGit(wt.worktreePath)) {
      repos.push({ alias, repoDir: wt.worktreePath, kind: 'linked' });
      seen.add(alias);
    }
  }

  /**
   * Whether the workspace root is itself a repository. Checked up front
   * because it decides whether auto-init can be skipped below — and it is a
   * single `fs.access`, versus one git subprocess per candidate directory.
   */
  const rootIsRepo = await hasLocalGit(rootPath);

  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (RESERVED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      if (seen.has(entry.name)) continue;
      const subDir = path.join(rootPath, entry.name);

      if (await hasLocalGit(subDir)) {
        repos.push({ alias: entry.name, repoDir: subDir, kind: 'generated' });
        seen.add(entry.name);
        continue;
      }
      // A subdirectory of a repository is already inside its work tree, so
      // `initIfNeeded` would decline — but only after spawning `git rev-parse`
      // to find that out. At ~500ms per spawn on Windows, a workspace with a
      // handful of subdirectories was paying seconds per request for an
      // answer we can derive from the root check above.
      if (rootIsRepo) continue;
      if (autoInit && (await directoryHasCode(subDir))) {
        const created = await git.initIfNeeded(subDir);
        if (created) {
          repos.push({ alias: entry.name, repoDir: subDir, kind: 'generated' });
          seen.add(entry.name);
        }
      }
    }
  } catch {
    // Workspace dir may not exist yet.
  }

  if (rootIsRepo) {
    repos.push({ alias: '.', repoDir: rootPath, kind: 'root' });
  }

  return repos;
}

export async function hasLocalGit(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Repo-relative prefixes of every OTHER discovered repo nested inside `repo`.
 *
 * A workspace with several repos almost always has them as subdirectories of
 * the root repo, and git surfaces such a boundary as a single opaque entry:
 * `ls-files --others` reports `payments-api/` and `add -A` records a gitlink.
 * Both are useless in the UI — the entry is a directory, so opening it fails,
 * and its real files are already listed under their own repo. Callers use
 * this to drop those phantom entries.
 */
export function nestedRepoPrefixes(
  repo: DiscoveredRepo,
  allRepos: readonly DiscoveredRepo[],
): string[] {
  const parent = path.resolve(repo.repoDir);
  const prefixes: string[] = [];
  for (const other of allRepos) {
    if (other.alias === repo.alias) continue;
    const child = path.resolve(other.repoDir);
    if (child === parent || !child.startsWith(parent + path.sep)) continue;
    prefixes.push(child.slice(parent.length + 1).replace(/\\/g, '/'));
  }
  return prefixes;
}

/** True when `relPath` is, or lives under, one of `prefixes`. */
export function isNestedRepoPath(relPath: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return false;
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return prefixes.some((p) => normalized === p || normalized.startsWith(`${p}/`));
}

async function directoryHasCode(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (RESERVED_DIRS.has(e.name)) continue;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
