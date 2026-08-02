// ────────────────────────────────────────────────────────────────
// ChangeSetService — the single, centralized "what changed?" engine
// ────────────────────────────────────────────────────────────────
//
// Consolidates the diff logic that previously lived inline in the
// orchestrator HTTP route. Used by chat, workflow runs, and automations so
// every surface computes change sets identically.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ILogger } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { discoverRepos } from './RepoDiscovery.js';
import type {
  ChangeSet,
  ChangeRepo,
  ChangedFile,
  ChangeStatus,
  GetChangeSetParams,
} from './types.js';

export class ChangeSetService {
  constructor(
    private readonly git: IGitClient,
    private readonly logger: ILogger,
  ) {}

  /**
   * Compute the full change set for a workspace: its root repo (if any),
   * any agent-generated subdirectory repos, and any registered worktrees.
   */
  async getChangeSet(params: GetChangeSetParams): Promise<ChangeSet> {
    const { rootPath, worktrees = [], autoInit = true } = params;

    const repos = await discoverRepos(this.git, { rootPath, worktrees, autoInit });
    if (repos.length === 0) {
      return { hasGit: false, repos: [] };
    }

    const repoResults: ChangeRepo[] = [];
    for (const repo of repos) {
      try {
        const files = await this.collectRepoChanges(repo.alias, repo.repoDir);
        repoResults.push({ ...repo, files });
      } catch (err) {
        this.logger.warn(`[ChangeSet] Failed to diff repo ${repo.alias}`, { error: err });
        repoResults.push({ ...repo, files: [] });
      }
    }

    return { hasGit: true, repos: repoResults };
  }

  /**
   * Read the current (working-tree) content of a changed file, plus its
   * baseline content (from the first commit) when available — powers an
   * old-vs-new view without shipping the whole diff up front.
   */
  async getFileVersions(
    repoDir: string,
    relPath: string,
  ): Promise<{ current: string | null; baseline: string | null }> {
    let current: string | null = null;
    try {
      const full = path.join(repoDir, relPath);
      const stat = await fs.stat(full);
      if (stat.isFile() && stat.size <= 1_048_576) {
        current = await fs.readFile(full, 'utf-8');
      }
    } catch {
      current = null; // deleted or unreadable
    }

    let baseline: string | null = null;
    try {
      const first = await this.git.firstCommit(repoDir);
      if (first) {
        baseline = await this.git.showFile(repoDir, relPath, first);
      }
    } catch {
      baseline = null; // added file (no baseline)
    }

    return { current, baseline };
  }

  // ── Per-repo change collection ──

  private async collectRepoChanges(alias: string, repoDir: string): Promise<ChangedFile[]> {
    const statusOutput = await this.git.getStatus(repoDir);
    const unstagedDiff = await this.git.getDiff(repoDir, false);
    const stagedDiff = await this.git.getDiff(repoDir, true);
    const fullDiff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n');

    // The runtime auto-commits the workspace on completion, so `git status`
    // alone is empty for a finished run. Also diff HEAD against the very
    // first commit to always surface "what did this run produce".
    const rootCommit = await this.git.firstCommit(repoDir);
    let nameStatusOutput = '';
    if (rootCommit) {
      nameStatusOutput = await this.git.diffNameStatus(repoDir, `${rootCommit}..HEAD`);
    }

    const fileMap = new Map<string, ChangedFile>();
    const prefixFor = (p: string) => (alias === '.' ? p : `${alias}/${p}`);

    // Uncommitted (porcelain).
    if (statusOutput.trim()) {
      for (const line of statusOutput.split('\n')) {
        if (!line.trim()) continue;
        const statusCode = line.substring(0, 2).trim();
        const filePath = line.substring(3).split(' -> ').pop()?.trim() ?? '';
        if (!filePath) continue;
        const prefixed = prefixFor(filePath);
        fileMap.set(prefixed, {
          path: prefixed,
          status: this.porcelainStatus(statusCode),
          diff: extractFileDiff(fullDiff, filePath),
        });
      }
    }

    // Committed since baseline (name-status).
    if (nameStatusOutput.trim()) {
      for (const line of nameStatusOutput.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const code = parts[0] ?? '';
        const target = (parts[parts.length - 1] ?? '').trim();
        if (!target) continue;
        const prefixed = prefixFor(target);
        if (!fileMap.has(prefixed)) {
          fileMap.set(prefixed, {
            path: prefixed,
            status: this.nameStatus(code),
            diff: '',
          });
        }
      }
    }

    return Array.from(fileMap.values()).filter((f) => {
      const rel = alias === '.' ? f.path : f.path.slice(alias.length + 1);
      return !isMetadataPath(rel);
    });
  }

  private porcelainStatus(code: string): ChangeStatus {
    if (code === '??' || code.includes('A')) return 'added';
    if (code.includes('D')) return 'deleted';
    if (code.includes('R')) return 'renamed';
    return 'modified';
  }

  private nameStatus(code: string): ChangeStatus {
    if (code.startsWith('A')) return 'added';
    if (code.startsWith('D')) return 'deleted';
    if (code.startsWith('R')) return 'renamed';
    return 'modified';
  }

  // ── Filesystem helpers ──

  private async hasLocalGit(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, '.git'));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Paths matching this pattern are workflow runtime metadata (agent response
 * artifacts, scratch state) and must never surface as "code changes".
 */
export function isMetadataPath(p: string): boolean {
  const s = p.replace(/\\/g, '/');
  return (
    s.startsWith('artifacts/') ||
    s === 'artifacts' ||
    s.startsWith('uploads/') ||
    s === 'uploads' ||
    s === '.workspace.json' ||
    s === 'scratchpad.json' ||
    s === 'stream-log.jsonl' ||
    s.endsWith('/.workspace.json') ||
    s.endsWith('/scratchpad.json') ||
    s.endsWith('/stream-log.jsonl')
  );
}

/** Extract the diff hunk for a specific file from a combined diff output. */
export function extractFileDiff(fullDiff: string, filePath: string): string {
  if (!fullDiff) return '';
  const marker = `diff --git a/${filePath} b/${filePath}`;
  const start = fullDiff.indexOf(marker);
  if (start === -1) return '';
  const nextDiff = fullDiff.indexOf('\ndiff --git ', start + marker.length);
  return nextDiff === -1 ? fullDiff.substring(start) : fullDiff.substring(start, nextDiff);
}
