// ────────────────────────────────────────────────────────────────
// ISnapshotStore — port for materialising workspace snapshots
// ────────────────────────────────────────────────────────────────

import type { CheckpointDiffFile } from '@generatorai/shared';

export interface SnapshotHandle {
  /** Commit SHA the private ref points at. */
  refValue: string;
  /** Tree SHA — the snapshot content itself. */
  treeSha: string;
}

export interface ISnapshotStore {
  /** Ensure `repoDir` can hold snapshots (git-inits it when necessary). */
  prepare(repoDir: string): Promise<boolean>;

  /**
   * Capture the current working tree. Returns `null` when `previousTreeSha`
   * is supplied and nothing changed since then.
   */
  capture(
    repoDir: string,
    refName: string,
    message: string,
    parentRefValue?: string,
    previousTreeSha?: string,
  ): Promise<SnapshotHandle | null>;

  /** Aggregate per-file deltas between two snapshot trees. */
  diff(
    repoDir: string,
    fromTree: string,
    toTree: string | undefined,
    pathspec?: string[],
  ): Promise<CheckpointDiffFile[]>;

  /** Unified patch for one file between two snapshot trees. */
  patch(
    repoDir: string,
    fromTree: string,
    toTree: string | undefined,
    filePath: string,
    contextLines?: number,
  ): Promise<string>;

  /** Whether a snapshot object is still present in the object database. */
  exists(repoDir: string, sha: string): Promise<boolean>;

  /** Drop the private ref (objects become GC-able). */
  dropRef(repoDir: string, refName: string): Promise<void>;
}
