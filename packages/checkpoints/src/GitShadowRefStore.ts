// ────────────────────────────────────────────────────────────────
// GitShadowRefStore — snapshots as git objects under a private ref
// ────────────────────────────────────────────────────────────────
//
// The snapshot primitive:
//
//   GIT_INDEX_FILE=<gitdir>/generatorai-snapshot.index git add -A
//   GIT_INDEX_FILE=<gitdir>/generatorai-snapshot.index git write-tree
//   git commit-tree <tree> [-p <prev>] -m "…"
//   git update-ref refs/generatorai/checkpoints/<…> <commit>
//
// Properties that make this the right primitive:
//   • O(changed files) — git only re-hashes what changed, and reusing the
//     same throwaway index across captures keeps git's stat cache warm.
//   • Content-addressed + zlib compressed → storage is effectively free.
//   • Captures the WHOLE working tree, so bash-command edits, sub-agent
//     edits and external edits are all included (unlike editor-level
//     checkpointing which only sees its own file-edit tool).
//   • Invisible to the user's git: no index, HEAD, branch or remote is
//     touched, and `refs/generatorai/**` is never pushed.

import * as path from 'node:path';
import type { ILogger, CheckpointDiffFile } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import type { ISnapshotStore, SnapshotHandle } from './ports/ISnapshotStore.js';

/** Private ref namespace. Never pushed, never shown by `git branch`. */
export const CHECKPOINT_REF_PREFIX = 'refs/generatorai/checkpoints';

/** Name of the throwaway index file kept inside the repo's git dir. */
const SNAPSHOT_INDEX_FILE = 'generatorai-snapshot.index';
/** Separate index for restores so a concurrent capture can't observe it. */
const RESTORE_INDEX_FILE = 'generatorai-restore.index';

export class GitShadowRefStore implements ISnapshotStore {
  /** Cache of repoDir → absolute git dir (avoids a rev-parse per capture). */
  private readonly gitDirCache = new Map<string, string>();
  /**
   * repoDir → private shadow git dir. Registered by the workspace layer for
   * every mount that has one. With a shadow store NOTHING is written into
   * the repository's own `.git` (no refs, no objects, no index files), and a
   * plain folder is tracked without ever being `git init`-ed.
   */
  private readonly shadows = new Map<string, string>();
  private readonly scopedClients = new Map<string, IGitClient>();

  constructor(
    private readonly git: IGitClient,
    private readonly logger: ILogger,
  ) {}

  /** Route every snapshot command for `repoDir` through `gitDir`. */
  registerShadow(repoDir: string, gitDir: string | undefined): void {
    const key = path.resolve(repoDir);
    if (gitDir) this.shadows.set(key, gitDir);
    else this.shadows.delete(key);
  }

  shadowGitDir(repoDir: string): string | undefined {
    return this.shadows.get(path.resolve(repoDir));
  }

  gitFor(repoDir: string): IGitClient {
    const gitDir = this.shadowGitDir(repoDir);
    if (!gitDir) return this.git;
    let client = this.scopedClients.get(gitDir);
    if (!client) {
      client = this.git.withGitDir(gitDir);
      this.scopedClients.set(gitDir, client);
    }
    return client;
  }

  async prepare(repoDir: string): Promise<boolean> {
    const shadow = this.shadowGitDir(repoDir);
    if (shadow) {
      // The mount service configured the store (alternates, EOL, excludes)
      // when the mount was prepared; this only re-creates it if it vanished.
      return this.git.initShadowRepo(shadow, repoDir);
    }
    if (await this.git.isGitRepo(repoDir)) return true;
    // Legacy workspaces without a shadow store: the managed root is
    // git-init'd so it gets the same content-addressed machinery. Never
    // reached for a user's own folder — those always have a shadow store.
    return this.git.initIfNeeded(repoDir);
  }

  async capture(
    repoDir: string,
    refName: string,
    message: string,
    parentRefValue?: string,
    previousTreeSha?: string,
  ): Promise<SnapshotHandle | null> {
    const indexFile = await this.indexPath(repoDir, SNAPSHOT_INDEX_FILE);
    if (!indexFile) return null;

    const treeSha = await this.gitFor(repoDir).writeTreeFromWorktree(repoDir, indexFile);
    if (!treeSha) return null;

    // Identical content → no new checkpoint (keeps the rewind list clean and
    // avoids unbounded ref growth during idle polling).
    if (previousTreeSha && treeSha === previousTreeSha) return null;

    const refValue = await this.gitFor(repoDir).commitTree(repoDir, treeSha, message, parentRefValue);
    await this.gitFor(repoDir).updateRef(repoDir, refName, refValue);

    return { refValue, treeSha };
  }

  async diff(
    repoDir: string,
    fromTree: string,
    toTree: string | undefined,
    pathspec?: string[],
  ): Promise<CheckpointDiffFile[]> {
    const [numstat, nameStatus] = await Promise.all([
      this.gitFor(repoDir).diffNumstat(repoDir, fromTree, toTree, pathspec),
      this.gitFor(repoDir).diffNameStatusZ(repoDir, fromTree, toTree, pathspec),
    ]);

    const statusByPath = new Map(nameStatus.map((e) => [e.path, e]));
    const out: CheckpointDiffFile[] = [];

    for (const entry of numstat) {
      const ns = statusByPath.get(entry.path);
      const isBinary = entry.additions === -1 || entry.deletions === -1;
      out.push({
        path: entry.path,
        ...(entry.oldPath ?? ns?.oldPath ? { oldPath: entry.oldPath ?? ns?.oldPath } : {}),
        status: mapStatus(ns?.code),
        additions: isBinary ? 0 : entry.additions,
        deletions: isBinary ? 0 : entry.deletions,
        isBinary,
      });
    }

    // Pure renames and mode-only changes produce a name-status row but no
    // numstat row — surface them so the file list is complete.
    const seen = new Set(out.map((f) => f.path));
    for (const ns of nameStatus) {
      if (seen.has(ns.path)) continue;
      out.push({
        path: ns.path,
        ...(ns.oldPath ? { oldPath: ns.oldPath } : {}),
        status: mapStatus(ns.code),
        additions: 0,
        deletions: 0,
        isBinary: false,
      });
    }

    return out;
  }

  async patch(
    repoDir: string,
    fromTree: string,
    toTree: string | undefined,
    filePath: string,
    contextLines = 3,
  ): Promise<string> {
    return this.gitFor(repoDir).diffPatch(repoDir, fromTree, toTree, filePath, contextLines);
  }

  async exists(repoDir: string, sha: string): Promise<boolean> {
    return this.gitFor(repoDir).objectExists(repoDir, sha);
  }

  async dropRef(repoDir: string, refName: string): Promise<void> {
    await this.gitFor(repoDir).deleteRef(repoDir, refName);
  }

  /** Restore index path (used by CheckpointService during rewind). */
  async restoreIndexPath(repoDir: string): Promise<string | null> {
    return this.indexPath(repoDir, RESTORE_INDEX_FILE);
  }

  private async indexPath(repoDir: string, fileName: string): Promise<string | null> {
    const shadow = this.shadowGitDir(repoDir);
    if (shadow) return path.join(shadow, fileName);
    let gitDir = this.gitDirCache.get(repoDir);
    if (!gitDir) {
      const resolved = await this.gitFor(repoDir).absoluteGitDir(repoDir);
      if (!resolved) {
        this.logger.warn(`[Checkpoints] Not a git repository: ${repoDir}`);
        return null;
      }
      gitDir = resolved;
      this.gitDirCache.set(repoDir, gitDir);
    }
    return path.join(gitDir, fileName);
  }
}

function mapStatus(code: string | undefined): CheckpointDiffFile['status'] {
  if (!code) return 'modified';
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  if (code.startsWith('R') || code.startsWith('C')) return 'renamed';
  return 'modified';
}

/** Build the private ref name for a checkpoint. */
export function checkpointRefName(
  workspaceId: string,
  repoAlias: string,
  seq: number,
): string {
  const alias = repoAlias === '.' ? 'root' : sanitizeRefComponent(repoAlias);
  return `${CHECKPOINT_REF_PREFIX}/${sanitizeRefComponent(workspaceId)}/${alias}/${seq}`;
}

/** git refs forbid a range of characters — normalise aggressively. */
export function sanitizeRefComponent(value: string): string {
  const cleaned = value
    .replace(/[\\/]/g, '-')
    .replace(/[~^:?*[\]@{}\s.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned : 'x';
}
