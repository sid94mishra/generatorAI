// ────────────────────────────────────────────────────────────────
// IWorkspaceFileReviewRepository — "I have reviewed this file" rows
// ────────────────────────────────────────────────────────────────
//
// Backs the Changes tab's per-file Keep / Undo flow. A row records that the
// user accepted one file AT ONE EXACT CONTENT: `acceptedBlob` is the git
// blob sha the working tree had when they pressed Keep (the empty string for
// a deleted file). Nothing else needs to be stored, because that single
// value is what makes the state self-correcting — the moment the agent edits
// the file again the head blob differs, the row no longer matches, and the
// file drops back into the "to review" list on its own.
//
// Rows are workspace-scoped and die with the workspace.

export interface WorkspaceFileReviewRow {
  workspaceId: string;
  /** Mount alias the file belongs to (`.` for the workspace root). */
  alias: string;
  /** Repo-relative path, never alias-prefixed. */
  path: string;
  /** Head blob sha at the moment of acceptance; `''` for a deleted file. */
  acceptedBlob: string;
  acceptedAt: Date;
}

/** Identifies one row without its content. */
export interface WorkspaceFileReviewKey {
  alias: string;
  path: string;
}

export interface IWorkspaceFileReviewRepository {
  /** Every accepted file in a workspace. */
  list(workspaceId: string): Promise<WorkspaceFileReviewRow[]>;
  /** Insert or replace. Re-keeping a file at a new blob is an update. */
  upsertMany(rows: WorkspaceFileReviewRow[]): Promise<void>;
  deleteMany(workspaceId: string, keys: readonly WorkspaceFileReviewKey[]): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}
