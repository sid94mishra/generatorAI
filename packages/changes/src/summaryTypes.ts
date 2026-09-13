// ────────────────────────────────────────────────────────────────
// Change summary types — the "summary first, patch on demand" model
// ────────────────────────────────────────────────────────────────
//
// The legacy `ChangeSet` shipped every file's full unified diff in one
// response, so a large run produced a multi-megabyte JSON payload on every
// poll. The summary model splits this into:
//
//   GET /changes           → per-file metadata + line counts only
//   GET /changes/file      → one file's patch (or both versions), ETag'd
//
// which keeps the file list O(files) instead of O(bytes-changed).

import type { ChangeRepoKind, ChangeStatus, MountRef } from './types.js';

/** Which side of the comparison a revision selector refers to. */
export type ChangeRevisionKind =
  /** The workspace's first checkpoint — "everything this session changed". */
  | 'baseline'
  /** A specific checkpoint id. */
  | 'checkpoint'
  /** The live working tree (head side only). */
  | 'working'
  /** A raw git revision (branch / tag / SHA). */
  | 'ref';

export interface ChangeRevision {
  kind: ChangeRevisionKind;
  /** Checkpoint id, or git revision, depending on `kind`. */
  id?: string;
  /** Resolved tree-ish actually used for the diff (undefined = working tree). */
  treeish?: string;
  /** Human label for the UI ("Session start", "Turn 3", "Stage: build"). */
  label?: string;
  createdAt?: Date;
  /**
   * True when `treeish` is a real commit's tree (blobs EOL-normalised by
   * git) rather than a byte-exact snapshot. The other side of such a diff
   * must be materialised the same way or every CRLF file reads as rewritten.
   */
  normalized?: boolean;
}

/** One changed file — metadata only, no content. */
export interface ChangeSummaryFile {
  /** Path relative to its repo (NOT alias-prefixed). */
  path: string;
  /** Previous path when the file was renamed/copied. */
  oldPath?: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  /**
   * Set when either side exceeds the body budget, so the client renders a
   * "too large to display" placeholder instead of requesting the content.
   */
  isTooLarge: boolean;
  /** Blob SHA on the base side (absent for added files). */
  oldBlob?: string;
  /** Blob SHA on the head side (absent for deleted files). */
  newBlob?: string;
  /** Detected language hint for syntax highlighting. */
  lang?: string;
  /**
   * True when the user has reviewed and accepted this file AT ITS CURRENT
   * head blob. Set by the API layer (the review rows live in the database,
   * which this package deliberately knows nothing about). Any later edit
   * changes the head blob and therefore silently un-keeps the file.
   */
  kept?: boolean;
}

export interface ChangeSummaryRepo {
  alias: string;
  kind: ChangeRepoKind;
  /** True when a checkpoint baseline was available for this repo. */
  hasBaseline: boolean;
  /**
   * THIS repo's resolved base and head.
   *
   * The response-level `base`/`head` only describe the FIRST repo. Every
   * mount resolves the same logical selector differently — one has a
   * checkpoint baseline, the next falls back to its branch base, a third to
   * its first commit — so a client that reads the top-level revision and
   * applies it to every file gets the wrong answer for all but one mount.
   * That is what hid the per-file discard action on every mount whose base
   * was not a checkpoint row.
   */
  base: ChangeRevision;
  head: ChangeRevision;
  stats: { files: number; additions: number; deletions: number };
  files: ChangeSummaryFile[];
  /** How many of `files` are kept. Set by the API layer alongside `kept`. */
  keptCount?: number;
  /**
   * Every path in the repo (tracked + untracked, gitignore-honouring), for
   * the full file-tree view. Omitted unless `includeTree` is requested.
   */
  paths?: string[];
}

export interface ChangeSummary {
  workspaceId: string;
  hasGit: boolean;
  /**
   * The FIRST repo's resolution, kept for compatibility. Prefer
   * `repos[].base` / `repos[].head`, which are correct per mount.
   */
  base: ChangeRevision;
  head: ChangeRevision;
  repos: ChangeSummaryRepo[];
  /** Aggregate across every repo. */
  stats: { files: number; additions: number; deletions: number };
  /** Kept files across every repo. Set by the API layer. */
  keptCount?: number;
}

/** Selector accepted by the API for either side of the comparison. */
export interface ChangeRevisionSelector {
  kind: ChangeRevisionKind;
  id?: string;
}

export interface GetChangeSummaryParams {
  workspaceId: string;
  rootPath: string;
  worktrees?: Array<{ alias: string; worktreePath: string }>;
  /** Workspace mounts; when present only these are tracked. */
  mounts?: MountRef[];
  base?: ChangeRevisionSelector;
  head?: ChangeRevisionSelector;
  /** Restrict to a single repo alias. */
  repoAlias?: string;
  /** Include the full path list per repo (for the tree view). */
  includeTree?: boolean;
  autoInit?: boolean;
}

/** One file's content on both sides, for `parseDiffFromFile`-style rendering. */
export interface ChangeFileVersions {
  path: string;
  alias: string;
  old: { name: string; contents: string | null; blob?: string } | null;
  new: { name: string; contents: string | null; blob?: string } | null;
  isBinary: boolean;
  isTooLarge: boolean;
  /** `<oldBlob>:<newBlob>` — usable directly as an ETag and a render cacheKey. */
  cacheKey: string;
}

/** One file's unified patch. */
export interface ChangeFilePatch {
  path: string;
  alias: string;
  patch: string;
  truncated: boolean;
  cacheKey: string;
}

/** Max bytes of file content returned inline before we flag `isTooLarge`. */
export const MAX_FILE_BODY_BYTES = 512 * 1024;
/** Max bytes of a single-file patch before it is trimmed. */
export const MAX_PATCH_BYTES = 512 * 1024;
