// ────────────────────────────────────────────────────────────────
// WorkspaceTreeService — "every file in the workspace", cheaply
// ────────────────────────────────────────────────────────────────
//
// The Changes surface answers "what changed?". This answers the other half:
// "what is here?", so the user can browse a file that the agent never
// touched and still get syntax highlighting, line numbers and — when the
// file *did* change — a diff.
//
// Deliberately separate from ChangeSummaryService rather than an extra flag
// on it. The two have completely different invalidation profiles: the change
// summary moves on every agent write, the path list only moves when files are
// created or deleted. Keeping them apart means toggling "all files" in the UI
// never refetches diffs, and vice versa.
//
// Listing goes through `git ls-files --others --cached --exclude-standard`,
// NOT a recursive readdir. That is one subprocess per repo regardless of size
// and it honours .gitignore, so `node_modules` never reaches the client.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ILogger } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { discoverRepos, isNestedRepoPath, nestedRepoPrefixes } from './RepoDiscovery.js';
import { isMetadataPath } from './ChangeSetService.js';
import { languageFor } from './ChangeSummaryService.js';
import { MAX_FILE_BODY_BYTES } from './summaryTypes.js';
import type { ChangeRepoKind, WorktreeRef } from './types.js';

/** Hard cap per repo. Beyond this the tree stops being browsable anyway. */
export const MAX_TREE_PATHS_PER_REPO = 20_000;

export interface WorkspaceTreeRepo {
  alias: string;
  kind: ChangeRepoKind;
  /** Repo-relative paths, sorted. NOT alias-prefixed. */
  paths: string[];
  /** True when the repo has more files than `MAX_TREE_PATHS_PER_REPO`. */
  truncated: boolean;
}

export interface WorkspaceTree {
  workspaceId: string;
  hasGit: boolean;
  repos: WorkspaceTreeRepo[];
  totalPaths: number;
}

export interface WorkspaceTreeFile {
  alias: string;
  path: string;
  /** null when the file is binary or over the inline budget. */
  contents: string | null;
  size: number;
  isBinary: boolean;
  isTooLarge: boolean;
  lang: string;
  /** Stable while the file is unchanged — usable as an ETag and a render key. */
  cacheKey: string;
}

export interface ListWorkspaceTreeParams {
  workspaceId: string;
  rootPath: string;
  worktrees?: WorktreeRef[];
  /** Restrict to one repo alias. */
  repoAlias?: string;
}

export interface ReadWorkspaceFileParams {
  rootPath: string;
  worktrees?: WorktreeRef[];
  alias: string;
  /** Repo-relative path. An `alias/` prefix is tolerated and stripped. */
  filePath: string;
}

export class WorkspaceTreeService {
  constructor(
    private readonly git: IGitClient,
    private readonly logger: ILogger,
  ) {}

  /** Every browsable path in every repo of the workspace. */
  async listTree(params: ListWorkspaceTreeParams): Promise<WorkspaceTree> {
    const { workspaceId, rootPath, worktrees = [], repoAlias } = params;

    // `autoInit: false` — browsing files must never mutate the workspace.
    const all = await discoverRepos(this.git, { rootPath, worktrees, autoInit: false });
    const repos = repoAlias ? all.filter((r) => r.alias === repoAlias) : all;

    const out: WorkspaceTreeRepo[] = [];
    let totalPaths = 0;

    for (const repo of repos) {
      try {
        const nested = nestedRepoPrefixes(repo, all);
        const listed = (await this.git.lsFiles(repo.repoDir)).filter(
          (p) => !isMetadataPath(p) && !isNestedRepoPath(p, nested),
        );
        const truncated = listed.length > MAX_TREE_PATHS_PER_REPO;
        const paths = (truncated ? listed.slice(0, MAX_TREE_PATHS_PER_REPO) : listed).sort();
        totalPaths += paths.length;
        out.push({ alias: repo.alias, kind: repo.kind, paths, truncated });
      } catch (err) {
        this.logger.warn(`[WorkspaceTree] Failed to list repo ${repo.alias}: ${err}`);
        out.push({ alias: repo.alias, kind: repo.kind, paths: [], truncated: false });
      }
    }

    return { workspaceId, hasGit: out.length > 0, repos: out, totalPaths };
  }

  /**
   * One file's current working-tree content.
   *
   * Distinct from `ChangeSummaryService.getFileVersions`, which can only
   * serve files that appear in a diff. Here any tracked path is fair game.
   */
  async readFile(params: ReadWorkspaceFileParams): Promise<WorkspaceTreeFile> {
    const { rootPath, worktrees = [], alias, filePath } = params;

    const repos = await discoverRepos(this.git, { rootPath, worktrees, autoInit: false });
    const repo = repos.find((r) => r.alias === alias);
    const repoDir = repo?.repoDir ?? rootPath;
    const relPath = stripPrefix(filePath, alias);

    // Path traversal guard: the resolved file must stay inside its repo.
    const resolvedRoot = path.resolve(repoDir);
    const fullPath = path.resolve(resolvedRoot, relPath);
    if (fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);

    const base = {
      alias,
      path: relPath,
      size: stat.size,
      lang: languageFor(relPath),
      // mtime + size is enough: any edit moves at least one of them, and it
      // avoids hashing megabytes just to answer "did this change?".
      cacheKey: `${alias}:${relPath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`,
    };

    if (stat.size > MAX_FILE_BODY_BYTES) {
      return { ...base, contents: null, isBinary: false, isTooLarge: true };
    }

    const buf = await fs.readFile(fullPath);
    if (looksBinary(buf)) {
      return { ...base, contents: null, isBinary: true, isTooLarge: false };
    }

    return {
      ...base,
      contents: buf.toString('utf-8'),
      isBinary: false,
      isTooLarge: false,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────

/** Tolerate an `alias/`-prefixed path so callers can pass tree ids verbatim. */
function stripPrefix(filePath: string, alias: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (alias === '.' || !alias) return normalized;
  return normalized.startsWith(`${alias}/`)
    ? normalized.slice(alias.length + 1)
    : normalized;
}

/**
 * A NUL byte in the first 8KB is how git itself decides a file is binary.
 * Extension sniffing would misclassify both ways (a .dat of JSON, a .ts of
 * minified junk with a stray NUL).
 */
function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8_000);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
