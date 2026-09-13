// ────────────────────────────────────────────────────────────────
// DrizzleWorkspaceFileReviewRepository — IWorkspaceFileReviewRepository impl
// ────────────────────────────────────────────────────────────────
//
// One row per file the user has pressed "Keep" on, keyed by
// (workspace, mount alias, repo-relative path). See the port for why the
// accepted blob sha is the only state worth storing.

import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  IWorkspaceFileReviewRepository,
  WorkspaceFileReviewKey,
  WorkspaceFileReviewRow,
} from '@generatorai/core';
import { StorageError } from '@generatorai/shared';
import { workspaceFileReviews } from '../schema.js';
import type { AppDatabase } from '../index.js';

/**
 * Rows written per statement. SQLite's default limit is 999 bound
 * parameters and each row binds five, so 100 leaves plenty of headroom while
 * keeping "Keep all" on a large change set to a handful of statements.
 */
const CHUNK = 100;

export class DrizzleWorkspaceFileReviewRepository implements IWorkspaceFileReviewRepository {
  constructor(private db: AppDatabase) {}

  async list(workspaceId: string): Promise<WorkspaceFileReviewRow[]> {
    const rows = await this.db
      .select()
      .from(workspaceFileReviews)
      .where(eq(workspaceFileReviews.workspaceId, workspaceId));
    return rows.map((r) => ({
      workspaceId: r.workspaceId,
      alias: r.alias,
      path: r.path,
      acceptedBlob: r.acceptedBlob,
      acceptedAt: r.acceptedAt,
    }));
  }

  async upsertMany(rows: WorkspaceFileReviewRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await this.db
          .insert(workspaceFileReviews)
          .values(rows.slice(i, i + CHUNK))
          // Keeping an already-kept file at a NEW blob is the normal path:
          // the agent edited it, the row went stale, the user accepted the
          // new content. That must update, not fail the whole batch.
          .onConflictDoUpdate({
            target: [
              workspaceFileReviews.workspaceId,
              workspaceFileReviews.alias,
              workspaceFileReviews.path,
            ],
            set: {
              acceptedBlob: sql`excluded.accepted_blob`,
              acceptedAt: sql`excluded.accepted_at`,
            },
          });
      }
    } catch (err) {
      throw new StorageError(
        `Failed to record file reviews: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async deleteMany(
    workspaceId: string,
    keys: readonly WorkspaceFileReviewKey[],
  ): Promise<void> {
    if (keys.length === 0) return;
    // Grouped by alias so the delete is one statement per mount rather than
    // one per file — a "Undo all" on a big change set would otherwise be
    // hundreds of round trips.
    const byAlias = new Map<string, string[]>();
    for (const key of keys) {
      const list = byAlias.get(key.alias);
      if (list) list.push(key.path);
      else byAlias.set(key.alias, [key.path]);
    }
    for (const [alias, paths] of byAlias) {
      for (let i = 0; i < paths.length; i += CHUNK) {
        await this.db
          .delete(workspaceFileReviews)
          .where(
            and(
              eq(workspaceFileReviews.workspaceId, workspaceId),
              eq(workspaceFileReviews.alias, alias),
              inArray(workspaceFileReviews.path, paths.slice(i, i + CHUNK)),
            ),
          );
      }
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.db
      .delete(workspaceFileReviews)
      .where(eq(workspaceFileReviews.workspaceId, workspaceId));
  }
}
