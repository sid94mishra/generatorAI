// ────────────────────────────────────────────────────────────────
// ChangeSummaryService — baseline-aware, summary-first change engine
// ────────────────────────────────────────────────────────────────
//
// Differences from the legacy `ChangeSetService`:
//
//   1. Diffs against a CHECKPOINT, not "first commit ∪ working tree". The
//      caller picks the base (session baseline / a specific turn / a stage),
//      which is what makes "what did this message change?" possible.
//   2. Returns metadata only. Patches and file bodies are fetched per file,
//      so the file list stays small no matter how much changed.
//   3. Reports renames, binary files and oversized files explicitly instead
//      of emitting megabytes of unusable diff text.

import * as path from 'node:path';
import type { CheckpointRecord, ILogger } from '@generatorai/shared';
import type { GitBlobEntry, IGitClient } from '@generatorai/git';
import {
  discoverRepos,
  isNestedRepoPath,
  nestedRepoPrefixes,
  type DiscoveredRepo,
} from './RepoDiscovery.js';
import { isMetadataPath } from './ChangeSetService.js';
import {
  MAX_FILE_BODY_BYTES,
  MAX_PATCH_BYTES,
  type ChangeFilePatch,
  type ChangeFileVersions,
  type ChangeRevision,
  type ChangeSummary,
  type ChangeSummaryFile,
  type ChangeSummaryRepo,
  type GetChangeSummaryParams,
} from './summaryTypes.js';
import type { ChangeStatus } from './types.js';

/**
 * Minimal view of the checkpoint store this service needs. Declared
 * structurally so `@generatorai/changes` doesn't depend on the checkpoints
 * package (which depends on git, same as this one).
 */
export interface CheckpointLookup {
  getBaseline(workspaceId: string, repoAlias: string): Promise<CheckpointRecord | null>;
  getById(id: string): Promise<CheckpointRecord | null>;
  getLatest(workspaceId: string, repoAlias: string): Promise<CheckpointRecord | null>;
}

/** The well-known SHA of git's empty tree — valid in every repository. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class ChangeSummaryService {
  /** repoDir → throwaway index used to materialise the working tree. */
  private readonly workingIndexCache = new Map<string, string>();
  /** repoDir → last materialised working tree, with its timestamp. */
  private readonly workingTreeCache = new Map<
    string,
    { tree: string | undefined; at: number }
  >();
  /**
   * How long a materialised working tree is reused. Long enough to cover one
   * panel render (summary + per-file fetches), short enough that a manual
   * refresh always sees current state.
   *
   * Must be at least `WorkspaceCheckpointService.LIVE_DEBOUNCE_MS` (2 s), the
   * interval between live snapshots during a turn. At 1.5 s the entry had
   * ALWAYS just expired by the time the next snapshot asked for it, so the
   * cache never once hit on the path it exists to serve and every live
   * snapshot re-ran a full change-summary rebuild (review 3.5). The invariant
   * is asserted in `ChangeSummaryService.cacheTtl.test.ts`.
   */
  static readonly WORKING_TREE_TTL_MS = 2_500;

  constructor(
    private readonly git: IGitClient,
    private readonly checkpoints: CheckpointLookup,
    private readonly logger: ILogger,
  ) {}

  /** Per-file metadata for every repo in the workspace. No file bodies. */
  async getSummary(params: GetChangeSummaryParams): Promise<ChangeSummary> {
    const {
      workspaceId,
      rootPath,
      worktrees = [],
      base = { kind: 'baseline' as const },
      head = { kind: 'working' as const },
      repoAlias,
      includeTree = false,
      autoInit = true,
    } = params;

    const allRepos = await discoverRepos(this.git, { rootPath, worktrees, autoInit });
    const repos = repoAlias ? allRepos.filter((r) => r.alias === repoAlias) : allRepos;

    if (repos.length === 0) {
      return {
        workspaceId,
        hasGit: false,
        base: { kind: base.kind },
        head: { kind: head.kind },
        repos: [],
        stats: { files: 0, additions: 0, deletions: 0 },
      };
    }

    const summaries: ChangeSummaryRepo[] = [];
    let baseRevision: ChangeRevision = { kind: base.kind };
    let headRevision: ChangeRevision = { kind: head.kind };

    for (const repo of repos) {
      try {
        const resolvedBase = await this.resolveRevision(workspaceId, repo, base);
        const resolvedHead = await this.resolveRevision(workspaceId, repo, head);
        // Report the first repo's resolution as the response-level revision —
        // aliases share the same logical selector, only the SHA differs.
        if (summaries.length === 0) {
          baseRevision = resolvedBase;
          headRevision = resolvedHead;
        }

        const files = await this.collectFiles(
          repo,
          resolvedBase,
          resolvedHead,
          nestedRepoPrefixes(repo, allRepos),
        );
        const stats = files.reduce(
          (acc, f) => ({
            files: acc.files + 1,
            additions: acc.additions + f.additions,
            deletions: acc.deletions + f.deletions,
          }),
          { files: 0, additions: 0, deletions: 0 },
        );

        const summary: ChangeSummaryRepo = {
          alias: repo.alias,
          kind: repo.kind,
          hasBaseline: resolvedBase.treeish !== undefined && resolvedBase.kind !== 'ref',
          stats,
          files,
        };
        if (includeTree) {
          summary.paths = (await this.git.lsFiles(repo.repoDir)).filter(
            (p) => !isMetadataPath(p),
          );
        }
        summaries.push(summary);
      } catch (err) {
        this.logger.warn(`[ChangeSummary] Failed to summarise repo ${repo.alias}: ${err}`);
        summaries.push({
          alias: repo.alias,
          kind: repo.kind,
          hasBaseline: false,
          stats: { files: 0, additions: 0, deletions: 0 },
          files: [],
        });
      }
    }

    const stats = summaries.reduce(
      (acc, r) => ({
        files: acc.files + r.stats.files,
        additions: acc.additions + r.stats.additions,
        deletions: acc.deletions + r.stats.deletions,
      }),
      { files: 0, additions: 0, deletions: 0 },
    );

    return {
      workspaceId,
      hasGit: true,
      base: baseRevision,
      head: headRevision,
      repos: summaries,
      stats,
    };
  }

  /**
   * Both versions of one file. Preferred over `getFilePatch` because it
   * enables "expand unchanged context" in the renderer, which needs the full
   * file rather than just the changed hunks.
   *
   * When the caller already knows both blob SHAs — the change summary reports
   * them for every file — this takes a fast path that reads the two objects
   * directly. That matters a lot: the derivation below costs eight or nine
   * git subprocesses (materialising the working tree, resolving each side's
   * path to a sha, sizing each blob, then reading each blob), and on Windows
   * a spawn is ~300ms, so opening one file used to take about three seconds.
   * Reading known objects costs two.
   */
  async getFileVersions(
    params: GetChangeSummaryParams & {
      filePath: string;
      alias?: string;
      /** Known blob SHAs from the summary. Absent side = file added/deleted. */
      blobs?: { old?: string | undefined; new?: string | undefined };
    },
  ): Promise<ChangeFileVersions> {
    const repo = await this.resolveRepo(params, params.alias ?? '.');
    const relPath = stripAliasPrefix(params.filePath, repo.alias);

    const fast = await this.tryReadKnownBlobs(repo, relPath, params.blobs);
    if (fast) return fast;

    const base = await this.resolveRevision(params.workspaceId, repo, params.base ?? { kind: 'baseline' });
    const head = await this.resolveRevision(params.workspaceId, repo, params.head ?? { kind: 'working' });

    const oldBlob = base.treeish
      ? await this.git.blobShaAt(repo.repoDir, base.treeish, relPath)
      : null;
    const newBlob = head.treeish
      ? await this.git.blobShaAt(repo.repoDir, head.treeish, relPath)
      : await this.workingBlobSha(repo.repoDir, relPath);

    const oldSize = oldBlob ? await this.git.blobSize(repo.repoDir, oldBlob) : null;
    const newSize = newBlob ? await this.git.blobSize(repo.repoDir, newBlob) : null;
    const isTooLarge =
      (oldSize ?? 0) > MAX_FILE_BODY_BYTES || (newSize ?? 0) > MAX_FILE_BODY_BYTES;

    let oldContents: string | null = null;
    let newContents: string | null = null;
    let isBinary = false;

    if (!isTooLarge) {
      if (oldBlob) {
        oldContents = await this.readBlob(repo.repoDir, base.treeish!, relPath);
        if (oldContents !== null && looksBinary(oldContents)) isBinary = true;
      }
      if (newBlob) {
        newContents = head.treeish
          ? await this.readBlob(repo.repoDir, head.treeish, relPath)
          : await this.readWorkingFile(repo.repoDir, relPath);
        if (newContents !== null && looksBinary(newContents)) isBinary = true;
      }
      if (isBinary) {
        oldContents = null;
        newContents = null;
      }
    }

    const name = path.basename(relPath);
    return {
      path: relPath,
      alias: repo.alias,
      old: oldBlob ? { name, contents: oldContents, ...(oldBlob ? { blob: oldBlob } : {}) } : null,
      new: newBlob ? { name, contents: newContents, ...(newBlob ? { blob: newBlob } : {}) } : null,
      isBinary,
      isTooLarge,
      cacheKey: `${oldBlob ?? 'none'}:${newBlob ?? 'none'}`,
    };
  }

  /**
   * Blob content keyed by `<repoDir>\0<sha>`.
   *
   * Exact rather than best-effort: git object ids are content addresses, so
   * a given sha's bytes can never change. Worth caching because a git spawn
   * costs ~500ms on Windows and the same blobs are re-read constantly — the
   * unchanged side of a file the agent keeps editing, every file again after
   * switching base revision, and both sides on each ETag revalidation.
   *
   * Bounded by total bytes rather than entry count: one 400KB file and ten
   * thousand one-line files are very different memory footprints.
   */
  private readonly blobCache = new Map<string, string>();
  private blobCacheBytes = 0;
  private static readonly BLOB_CACHE_MAX_BYTES = 8 * 1024 * 1024;

  private cacheBlob(key: string, contents: string): void {
    // Never let a single large blob evict the entire cache to store itself.
    if (contents.length > ChangeSummaryService.BLOB_CACHE_MAX_BYTES / 4) return;
    while (
      this.blobCacheBytes + contents.length > ChangeSummaryService.BLOB_CACHE_MAX_BYTES &&
      this.blobCache.size > 0
    ) {
      // FIFO eviction — insertion order is Map's iteration order.
      const oldest = this.blobCache.keys().next().value;
      if (oldest === undefined) break;
      this.blobCacheBytes -= this.blobCache.get(oldest)?.length ?? 0;
      this.blobCache.delete(oldest);
    }
    this.blobCache.set(key, contents);
    this.blobCacheBytes += contents.length;
  }

  /**
   * Read one blob, cheapest source first:
   *   1. the content cache
   *   2. the working tree, when the file on disk still hashes to this sha —
   *      pure Node, no subprocess, and it is the overwhelmingly common case
   *      for the head side of a diff
   *   3. `git cat-file`
   */
  private async readBlobCached(
    repoDir: string,
    sha: string,
    workingPath?: string,
  ): Promise<string | null> {
    const key = `${repoDir}\u0000${sha}`;
    const hit = this.blobCache.get(key);
    if (hit !== undefined) return hit;

    if (workingPath) {
      const onDisk = await this.readWorkingBlob(repoDir, workingPath);
      // Comparing hashes is what makes this safe. It is only valid because
      // every snapshot command runs with `core.autocrlf=false`, so a blob's
      // bytes are exactly the bytes on disk.
      if (onDisk && onDisk.sha === sha) {
        this.cacheBlob(key, onDisk.contents);
        return onDisk.contents;
      }
    }

    const contents = await this.git.readBlobById(repoDir, sha);
    if (contents === null) return null;
    this.cacheBlob(key, contents);
    return contents;
  }

  /** Working-tree file as both its git object id and its text, in one read. */
  private async readWorkingBlob(
    repoDir: string,
    relPath: string,
  ): Promise<{ sha: string; contents: string } | null> {
    try {
      const fs = await import('node:fs/promises');
      const crypto = await import('node:crypto');
      const abs = await this.resolveInsideRepo(repoDir, relPath);
      if (!abs) return null;
      const buf = await fs.readFile(abs);
      // git's blob object id: sha1("blob <len>\0" + content)
      const hash = crypto.createHash('sha1');
      hash.update(`blob ${buf.length}\0`);
      hash.update(buf);
      return { sha: hash.digest('hex'), contents: buf.toString('utf-8') };
    } catch {
      return null;
    }
  }

  /**
   * Fast path for `getFileVersions`: read the two blobs the caller already
   * named instead of re-deriving them.
   *
   * Returns null whenever the fast path cannot be trusted, so the caller
   * falls through to the full derivation:
   *   • no blobs supplied
   *   • a sha that isn't a plain object id (never interpolated into git args)
   *   • an object that no longer exists — blobs written into a throwaway
   *     index are unreferenced, so `git gc` may prune them
   *
   * Content for a given blob pair is immutable, which is what makes this
   * safe: the pair is also the ETag and the client's query key, so a stale
   * pair produces a different key and a fresh request rather than stale text.
   */
  private async tryReadKnownBlobs(
    repo: DiscoveredRepo,
    relPath: string,
    blobs: { old?: string | undefined; new?: string | undefined } | undefined,
  ): Promise<ChangeFileVersions | null> {
    const oldBlob = blobs?.old;
    const newBlob = blobs?.new;
    if (!oldBlob && !newBlob) return null;

    const [oldContents, newContents] = await Promise.all([
      oldBlob ? this.readBlobCached(repo.repoDir, oldBlob) : Promise.resolve(null),
      // Only the head side can be served from the working tree; the base side
      // is a historical revision that by definition is not on disk.
      newBlob ? this.readBlobCached(repo.repoDir, newBlob, relPath) : Promise.resolve(null),
    ]);

    // A named object that failed to read means the assumption behind this
    // path is broken; re-derive rather than reporting the side as empty.
    if (oldBlob && oldContents === null) return null;
    if (newBlob && newContents === null) return null;

    const isBinary =
      (oldContents !== null && looksBinary(oldContents)) ||
      (newContents !== null && looksBinary(newContents));
    const isTooLarge =
      (oldContents?.length ?? 0) > MAX_FILE_BODY_BYTES ||
      (newContents?.length ?? 0) > MAX_FILE_BODY_BYTES;
    const usable = !isBinary && !isTooLarge;

    const name = path.basename(relPath);
    return {
      path: relPath,
      alias: repo.alias,
      old: oldBlob ? { name, contents: usable ? oldContents : null, blob: oldBlob } : null,
      new: newBlob ? { name, contents: usable ? newContents : null, blob: newBlob } : null,
      isBinary,
      isTooLarge,
      cacheKey: `${oldBlob ?? 'none'}:${newBlob ?? 'none'}`,
    };
  }

  /** Unified patch for one file. Used when the bodies are too large to ship. */
  async getFilePatch(
    params: GetChangeSummaryParams & { filePath: string; alias?: string; contextLines?: number },
  ): Promise<ChangeFilePatch> {
    const repo = await this.resolveRepo(params, params.alias ?? '.');
    const base = await this.resolveRevision(params.workspaceId, repo, params.base ?? { kind: 'baseline' });
    const head = await this.resolveRevision(params.workspaceId, repo, params.head ?? { kind: 'working' });
    const relPath = stripAliasPrefix(params.filePath, repo.alias);

    let patch = await this.git.diffPatch(
      repo.repoDir,
      base.treeish ?? EMPTY_TREE_SHA,
      head.treeish,
      relPath,
      params.contextLines ?? 3,
    );

    let truncated = false;
    if (patch.length > MAX_PATCH_BYTES) {
      patch = patch.slice(0, MAX_PATCH_BYTES);
      truncated = true;
    }

    const oldBlob = base.treeish
      ? await this.git.blobShaAt(repo.repoDir, base.treeish, relPath)
      : null;
    const newBlob = head.treeish
      ? await this.git.blobShaAt(repo.repoDir, head.treeish, relPath)
      : await this.workingBlobSha(repo.repoDir, relPath);

    return {
      path: relPath,
      alias: repo.alias,
      patch,
      truncated,
      cacheKey: `${oldBlob ?? 'none'}:${newBlob ?? 'none'}`,
    };
  }

  // ── Internals ───────────────────────────────────────────────

  private async collectFiles(
    repo: DiscoveredRepo,
    base: ChangeRevision,
    head: ChangeRevision,
    /**
     * Repo-relative paths of nested repositories. `git add -A` records such a
     * boundary as a single gitlink entry, which would otherwise surface as a
     * bogus "added file" whose real contents already appear under its own
     * repo alias.
     */
    nestedPrefixes: readonly string[] = [],
  ): Promise<ChangeSummaryFile[]> {
    const from = base.treeish ?? EMPTY_TREE_SHA;
    const to = head.treeish;

    // PERFORMANCE: a constant number of git invocations regardless of how
    // many files changed. `--raw` carries both blob SHAs and the status and
    // `--numstat` carries the line counts, so the naive "two subprocesses per
    // file" lookup is gone. On Windows each spawn costs ~250 ms, so this is
    // the difference between a snappy panel and a multi-second stall.
    const [numstat, raw] = await Promise.all([
      this.git.diffNumstat(repo.repoDir, from, to),
      this.git.diffRaw(repo.repoDir, from, to),
    ]);

    if (raw.length === 0) return [];

    // Blob sizes come from `ls-tree`, cached by tree SHA. Git trees are
    // immutable, so this cache can never go stale: a changed working tree
    // produces a different tree SHA and therefore a different key.
    const needsBaseSizes = raw.some((e) => e.code.startsWith('D') || e.oldSha);
    const [headBlobs, baseBlobs] = await Promise.all([
      to ? this.lsTreeCached(repo.repoDir, to) : Promise.resolve([]),
      needsBaseSizes ? this.lsTreeCached(repo.repoDir, from) : Promise.resolve([]),
    ]);

    const sizeBySha = new Map<string, number>();
    for (const b of baseBlobs) sizeBySha.set(b.sha, b.size);
    for (const b of headBlobs) sizeBySha.set(b.sha, b.size);
    const sizeFor = (sha: string | undefined): number => (sha ? (sizeBySha.get(sha) ?? 0) : 0);

    const statsByPath = new Map(numstat.map((e) => [e.path, e]));
    const files: ChangeSummaryFile[] = [];

    for (const entry of raw) {
      if (isMetadataPath(entry.path)) continue;
      if (isNestedRepoPath(entry.path, nestedPrefixes)) continue;
      const counts = statsByPath.get(entry.path);
      const isBinary =
        counts !== undefined && (counts.additions === -1 || counts.deletions === -1);

      files.push({
        path: entry.path,
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
        status: mapStatus(entry.code),
        additions: isBinary ? 0 : Math.max(0, counts?.additions ?? 0),
        deletions: isBinary ? 0 : Math.max(0, counts?.deletions ?? 0),
        isBinary,
        isTooLarge:
          sizeFor(entry.oldSha) > MAX_FILE_BODY_BYTES ||
          sizeFor(entry.newSha) > MAX_FILE_BODY_BYTES,
        ...(entry.oldSha ? { oldBlob: entry.oldSha } : {}),
        ...(entry.newSha ? { newBlob: entry.newSha } : {}),
        lang: languageFor(entry.path),
      });
    }

    files.sort((a, b) => compareTreePaths(a.path, b.path));
    return files;
  }

  /**
   * Turn a selector into a concrete tree-ish.
   *
   * IMPORTANT: `working` does NOT resolve to `undefined`. `git diff <tree>`
   * with no second argument compares the tree against the index + working
   * tree for *tracked paths only* — untracked files are invisible, and in a
   * workspace with no commits (the normal case, since checkpoints never touch
   * HEAD) every baseline file would be reported as deleted. So the working
   * tree is materialised into an ephemeral tree object and we always diff
   * tree → tree.
   */
  private async resolveRevision(
    workspaceId: string,
    repo: DiscoveredRepo,
    selector: { kind: ChangeRevision['kind']; id?: string },
  ): Promise<ChangeRevision> {
    switch (selector.kind) {
      case 'working': {
        const treeish = await this.materializeWorkingTree(repo.repoDir);
        return {
          kind: 'working',
          ...(treeish ? { treeish } : {}),
          label: 'Working tree',
        };
      }

      case 'ref': {
        const sha = selector.id ? await this.git.revParse(repo.repoDir, selector.id) : null;
        return {
          kind: 'ref',
          ...(selector.id ? { id: selector.id } : {}),
          ...(sha ? { treeish: sha } : {}),
          label: selector.id ?? 'ref',
        };
      }

      case 'checkpoint': {
        const cp = selector.id ? await this.checkpoints.getById(selector.id) : null;
        if (!cp || cp.repoAlias !== repo.alias) {
          // A checkpoint id is workspace-wide but stored per repo alias. When
          // the requested one belongs to a different alias, fall back to this
          // repo's own baseline so the response is still coherent.
          return this.resolveBaseline(workspaceId, repo);
        }
        return {
          kind: 'checkpoint',
          id: cp.id,
          treeish: cp.treeSha,
          label: checkpointLabel(cp),
          createdAt: cp.createdAt,
        };
      }

      case 'baseline':
      default:
        return this.resolveBaseline(workspaceId, repo);
    }
  }

  /**
   * `ls-tree` results cached by tree SHA. Git tree objects are immutable, so
   * this cache is exact rather than best-effort: any change to the working
   * tree yields a different SHA and therefore a different key. Bounded so a
   * long-lived server can't accumulate entries without limit.
   */
  private readonly lsTreeCache = new Map<string, GitBlobEntry[]>();
  private static readonly LS_TREE_CACHE_MAX = 64;

  private async lsTreeCached(repoDir: string, treeish: string): Promise<GitBlobEntry[]> {
    const key = `${repoDir}\u0000${treeish}`;
    const hit = this.lsTreeCache.get(key);
    if (hit) return hit;

    const blobs = await this.git.lsTreeBlobs(repoDir, treeish);
    if (this.lsTreeCache.size >= ChangeSummaryService.LS_TREE_CACHE_MAX) {
      // Simple FIFO eviction — insertion order is Map's iteration order.
      const oldest = this.lsTreeCache.keys().next().value;
      if (oldest !== undefined) this.lsTreeCache.delete(oldest);
    }
    this.lsTreeCache.set(key, blobs);
    return blobs;
  }

  /**
   * Write the current working tree to a throwaway tree object so it can be
   * diffed like any other revision. Uses a dedicated index file (separate
   * from the checkpoint one) so a concurrent capture can never observe it.
   *
   * Result is cached for a short window. Rendering one panel fires a summary
   * request followed by N per-file requests; without the cache each of those
   * would re-run `git add -A` + `write-tree`. The cache also makes the whole
   * batch read a CONSISTENT snapshot, so the file list and the file bodies
   * can't disagree because the agent wrote something in between.
   */
  private async materializeWorkingTree(repoDir: string): Promise<string | undefined> {
    const cached = this.workingTreeCache.get(repoDir);
    if (cached && Date.now() - cached.at < ChangeSummaryService.WORKING_TREE_TTL_MS) {
      return cached.tree;
    }

    let indexFile = this.workingIndexCache.get(repoDir);
    if (!indexFile) {
      const gitDir = await this.git.absoluteGitDir(repoDir);
      if (!gitDir) return undefined;
      indexFile = path.join(gitDir, 'generatorai-readonly.index');
      this.workingIndexCache.set(repoDir, indexFile);
    }
    const tree = (await this.git.writeTreeFromWorktree(repoDir, indexFile)) ?? undefined;
    this.workingTreeCache.set(repoDir, { tree, at: Date.now() });
    return tree;
  }

  /**
   * Drop the memoised working-tree snapshot.
   *
   * MUST be called by every path that mutates the working tree before it
   * announces the change. The memo exists so that one panel render (a summary
   * plus N file requests) reads a consistent view, but clients refetch the
   * instant they see the event — landing inside the TTL and then sitting on a
   * tree that still lists files which no longer exist, until a manual reload.
   *
   * Current callers: the checkpoint-restore route, and the `checkpoint.created`
   * subscriber in the server composition root (which also re-anchors review
   * threads and so must not read a stale file list).
   *
   * Not covered by a unit test: asserting the stale window requires freezing
   * `Date`, which corrupts git's index timestamp handling and breaks unrelated
   * tests in this suite. Verified in the browser instead.
   */
  invalidateWorkingTree(repoDir?: string): void {
    if (repoDir) this.workingTreeCache.delete(repoDir);
    else this.workingTreeCache.clear();
  }

  private async resolveBaseline(
    workspaceId: string,
    repo: DiscoveredRepo,
  ): Promise<ChangeRevision> {
    const baseline = await this.checkpoints.getBaseline(workspaceId, repo.alias);
    if (baseline) {
      return {
        kind: 'baseline',
        id: baseline.id,
        treeish: baseline.treeSha,
        label: 'Session start',
        createdAt: baseline.createdAt,
      };
    }
    // No checkpoint yet (legacy workspace, or checkpointing disabled). Fall
    // back to the repo's root commit so the panel still shows something
    // meaningful rather than an empty list.
    const first = await this.git.firstCommit(repo.repoDir);
    return {
      kind: 'baseline',
      ...(first ? { treeish: first } : { treeish: EMPTY_TREE_SHA }),
      label: first ? 'First commit' : 'Empty',
    };
  }

  private async resolveRepo(
    params: GetChangeSummaryParams,
    alias: string,
  ): Promise<DiscoveredRepo> {
    const repos = await discoverRepos(this.git, {
      rootPath: params.rootPath,
      worktrees: params.worktrees ?? [],
      autoInit: params.autoInit ?? false,
    });
    const match = repos.find((r) => r.alias === alias);
    if (match) return match;
    // Unknown alias — treat the workspace root as the repo so the request
    // degrades to "no such file" instead of a 500.
    return { alias: '.', repoDir: params.rootPath, kind: 'root' };
  }

  /**
   * Resolve `relPath` INSIDE `repoDir`, or return null.
   *
   * `relPath` arrives from a query parameter on the workspace changes routes,
   * and both readers below simply joined it onto the repository directory — so
   * `../../..`-style input, or an absolute path, read whatever the server user
   * could read and returned it through the run page's Changes tab. Resolving
   * and then checking containment is what makes the path a path inside the
   * repository rather than a suggestion (review 6.2).
   *
   * `realpath` is applied when the file exists so a symlink planted inside the
   * worktree cannot point out of it either; a missing file falls back to the
   * lexical resolution, which is still contained.
   */
  private async resolveInsideRepo(repoDir: string, relPath: string): Promise<string | null> {
    const fs = await import('node:fs/promises');
    const root = path.resolve(repoDir);
    const candidate = path.resolve(root, relPath);
    const contained = (p: string): boolean => p === root || p.startsWith(root + path.sep);
    if (!contained(candidate)) return null;
    try {
      const real = await fs.realpath(candidate);
      const realRoot = await fs.realpath(root).catch(() => root);
      return real === realRoot || real.startsWith(realRoot + path.sep) ? real : null;
    } catch {
      // Does not exist yet (a deleted or added file): the lexical check above
      // already bounds it.
      return candidate;
    }
  }

  /** Hash the working-tree copy so the head side still gets a cache key. */
  private async workingBlobSha(repoDir: string, relPath: string): Promise<string | null> {
    try {
      const fs = await import('node:fs/promises');
      const crypto = await import('node:crypto');
      const abs = await this.resolveInsideRepo(repoDir, relPath);
      if (!abs) return null;
      const buf = await fs.readFile(abs);
      // git's blob object id: sha1("blob <len>\0" + content)
      const hash = crypto.createHash('sha1');
      hash.update(`blob ${buf.length}\0`);
      hash.update(buf);
      return hash.digest('hex');
    } catch {
      return null;
    }
  }

  private async readBlob(
    repoDir: string,
    treeish: string,
    relPath: string,
  ): Promise<string | null> {
    try {
      return await this.git.showFile(repoDir, relPath, treeish);
    } catch {
      return null;
    }
  }

  private async readWorkingFile(repoDir: string, relPath: string): Promise<string | null> {
    try {
      const fs = await import('node:fs/promises');
      const abs = await this.resolveInsideRepo(repoDir, relPath);
      if (!abs) return null;
      return await fs.readFile(abs, 'utf-8');
    } catch {
      return null;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Order paths the way a file tree displays them: at every level directories
 * come before files, each group alphabetical.
 *
 * A plain `localeCompare` on the full path does NOT produce this. It compares
 * `/` (0x2F) against ordinary name characters, so a root file like
 * `package.json` lands between `docs/README.md` and `src/index.ts`, and
 * `src/index.ts` sorts before `src/api/routes.ts`. The changes list and the
 * tree then disagree about where a file is, which makes the two views
 * impossible to scan together.
 */
export function compareTreePaths(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  const shared = Math.min(as.length, bs.length);

  for (let i = 0; i < shared; i++) {
    // A segment is a directory when it is not the last one in its path.
    const aIsDir = i < as.length - 1;
    const bIsDir = i < bs.length - 1;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;

    const segA = as[i]!;
    const segB = bs[i]!;
    if (segA !== segB) return segA.localeCompare(segB);
  }

  return as.length - bs.length;
}

function mapStatus(code: string | undefined): ChangeStatus {
  if (!code) return 'modified';
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  if (code.startsWith('R') || code.startsWith('C')) return 'renamed';
  return 'modified';
}

function checkpointLabel(cp: CheckpointRecord): string {
  if (cp.label) return cp.label;
  switch (cp.kind) {
    case 'baseline':
      return 'Session start';
    case 'turn':
      return cp.promptExcerpt ? `Turn: ${cp.promptExcerpt.slice(0, 60)}` : 'Turn';
    case 'stage':
      return 'Stage';
    case 'autorun':
      return 'Automation run';
    case 'pre_restore':
      return 'Before restore';
    case 'manual':
      return 'Manual checkpoint';
    default:
      return cp.kind;
  }
}

/** A NUL byte in the first block is git's own binary heuristic. */
function looksBinary(content: string): boolean {
  return content.slice(0, 8000).includes('\u0000');
}

export function stripAliasPrefix(filePath: string, alias: string): string {
  if (alias === '.') return filePath;
  return filePath.startsWith(`${alias}/`) ? filePath.slice(alias.length + 1) : filePath;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  dockerfile: 'dockerfile',
};

export function languageFor(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return LANG_BY_EXT[ext] ?? 'text';
}
