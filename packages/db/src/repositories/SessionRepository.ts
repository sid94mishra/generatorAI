// ────────────────────────────────────────────────────────────────
// DrizzleSessionRepository — ISessionRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, inArray, sql, count, and } from 'drizzle-orm';
import type { ISessionRepository } from '@generatorai/core';
import type { Session, SessionStatus, SessionOwnerType } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { sessions } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonRecord, stringArray } from '../utils/jsonColumnSchemas.js';

export class DrizzleSessionRepository implements ISessionRepository {
  constructor(private db: AppDatabase) {}

  async create(session: Session): Promise<Session> {
    try {
      await this.db.insert(sessions).values({
        id: session.id,
        name: session.name,
        description: session.description ?? null,
        status: session.status,
        model: session.model ?? null,
        repoBranch: null,
        tags: session.tags,
        conversationId: session.conversationId ?? null,
        providerSessionId: session.providerSessionId ?? null,
        ownerType: session.ownerType ?? null,
        ownerId: session.ownerId ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        startedAt: session.startedAt ?? null,
        completedAt: session.completedAt ?? null,
        closedAt: session.closedAt ?? null,
      });
      return session;
    } catch (err) {
      throw new StorageError(
        `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<Session> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Session', id);
    return this.mapRow(row);
  }

  async getAll(): Promise<Session[]> {
    const rows = await this.db.select().from(sessions);
    return rows.map((r) => this.mapRow(r));
  }

  async getByStatus(statuses: SessionStatus[]): Promise<Session[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(inArray(sessions.status, statuses));
    return rows.map((r) => this.mapRow(r));
  }

  async countByStatus(statuses: SessionStatus[]): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(sessions)
      .where(inArray(sessions.status, statuses));
    return result[0]?.value ?? 0;
  }

  async getByOwner(ownerType: SessionOwnerType, ownerId: string): Promise<Session[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.ownerType, ownerType), eq(sessions.ownerId, ownerId)));
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<Session>): Promise<Session> {
    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.model !== undefined) values['model'] = updates.model;
    if (updates.tags !== undefined) values['tags'] = updates.tags;
    if (updates.conversationId !== undefined) values['conversationId'] = updates.conversationId;
    if (updates.providerSessionId !== undefined) values['providerSessionId'] = updates.providerSessionId ?? null;
    if (updates.ownerType !== undefined) values['ownerType'] = updates.ownerType;
    if (updates.ownerId !== undefined) values['ownerId'] = updates.ownerId;
    if (updates.startedAt !== undefined) values['startedAt'] = updates.startedAt;
    if (updates.completedAt !== undefined) values['completedAt'] = updates.completedAt;
    if (updates.closedAt !== undefined) values['closedAt'] = updates.closedAt;
    values['updatedAt'] = new Date();

    await this.db
      .update(sessions)
      .set(values)
      .where(eq(sessions.id, id));
    return this.getById(id);
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    await this.db
      .update(sessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(sessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  private mapRow(row: typeof sessions.$inferSelect): Session {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status as SessionStatus,
      model: row.model ?? undefined,
      tags: safeJsonColumn(row.tags, stringArray, { fallback: [] }) ?? [],
      conversationId: row.conversationId ?? undefined,
      providerSessionId: row.providerSessionId ?? undefined,
      ownerType: (row.ownerType as SessionOwnerType | null) ?? undefined,
      ownerId: row.ownerId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      closedAt: row.closedAt ?? undefined,
    };
  }
}
