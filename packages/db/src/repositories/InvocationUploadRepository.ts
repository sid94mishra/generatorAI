// ────────────────────────────────────────────────────────────────
// DrizzleInvocationUploadRepository — files staged before a run starts
// (`invocation_uploads`, v58; P04 WP-4.3).
// ────────────────────────────────────────────────────────────────

import { and, eq, isNull, lt } from 'drizzle-orm';
import type { IInvocationUploadRepository, InvocationUploadRecord } from '@generatorai/core';
import { invocationUploads } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleInvocationUploadRepository implements IInvocationUploadRepository {
  constructor(private db: AppDatabase) {}

  async create(record: InvocationUploadRecord): Promise<void> {
    await this.db.insert(invocationUploads).values({ ...record });
  }

  async get(id: string): Promise<InvocationUploadRecord | null> {
    const row = (await this.db.select().from(invocationUploads).where(eq(invocationUploads.id, id)).limit(1))[0];
    return row ? { ...row, principalId: row.principalId ?? null, consumedByRunId: row.consumedByRunId ?? null } : null;
  }

  async markConsumed(id: string, runId: string): Promise<boolean> {
    const rows = await this.db
      .update(invocationUploads)
      .set({ consumedByRunId: runId })
      .where(and(eq(invocationUploads.id, id), isNull(invocationUploads.consumedByRunId)))
      .returning({ id: invocationUploads.id });
    if (rows.length > 0) return true;
    // The same run consuming it again (a resumed `uploads` phase) is not a conflict.
    return (await this.get(id))?.consumedByRunId === runId;
  }

  async listExpired(now: Date): Promise<InvocationUploadRecord[]> {
    const rows = await this.db
      .select()
      .from(invocationUploads)
      .where(and(lt(invocationUploads.expiresAt, now), isNull(invocationUploads.consumedByRunId)));
    return rows.map((row) => ({ ...row, principalId: row.principalId ?? null, consumedByRunId: row.consumedByRunId ?? null }));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(invocationUploads).where(eq(invocationUploads.id, id));
  }
}
