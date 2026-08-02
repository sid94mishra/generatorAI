// ────────────────────────────────────────────────────────────────
// DrizzleWidgetInstanceRepository — persistence for widget instances.
// ────────────────────────────────────────────────────────────────

import { and, desc, eq } from 'drizzle-orm';
import type { WidgetInstance, WidgetInstanceStatus } from '@generatorai/shared';
import { StorageError, normalizeWidgetSurface } from '@generatorai/shared';
import { widgetInstances } from '../schema.js';
import type { AppDatabase } from '../index.js';

export interface IWidgetInstanceRepository {
  create(instance: WidgetInstance): Promise<void>;
  findById(id: string): Promise<WidgetInstance | null>;
  findByIds(ids: readonly string[]): Promise<WidgetInstance[]>;
  findBySession(sessionId: string): Promise<WidgetInstance[]>;
  findByChat(chatId: string): Promise<WidgetInstance[]>;
  findByWorkflowRun(workflowRunId: string): Promise<WidgetInstance[]>;
  updateState(id: string, state: unknown, updatedAt: string): Promise<void>;
  updateStatus(id: string, status: WidgetInstanceStatus, updatedAt: string, error?: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export class DrizzleWidgetInstanceRepository implements IWidgetInstanceRepository {
  constructor(private db: AppDatabase) {}

  async create(instance: WidgetInstance): Promise<void> {
    try {
      await this.db.insert(widgetInstances).values({
        id: instance.instanceId,
        descriptorId: instance.descriptorId,
        sessionId: instance.sessionId,
        chatId: instance.chatId ?? null,
        workflowRunId: instance.workflowRunId ?? null,
        stageRunId: instance.stageRunId ?? null,
        messageId: instance.messageId ?? null,
        surface: instance.surface,
        props: (instance.props ?? null) as unknown,
        state: (instance.state ?? null) as unknown,
        status: instance.status,
        error: instance.error ?? null,
        createdAt: new Date(instance.createdAt),
        updatedAt: new Date(instance.updatedAt),
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create widget instance: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findById(id: string): Promise<WidgetInstance | null> {
    const rows = await this.db.select().from(widgetInstances).where(eq(widgetInstances.id, id)).limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<WidgetInstance[]> {
    if (ids.length === 0) return [];
    const out: WidgetInstance[] = [];
    // Small IN batch — SQLite supports large arrays but keep it simple.
    for (const id of ids) {
      const found = await this.findById(id);
      if (found) out.push(found);
    }
    return out;
  }

  async findBySession(sessionId: string): Promise<WidgetInstance[]> {
    const rows = await this.db
      .select()
      .from(widgetInstances)
      .where(eq(widgetInstances.sessionId, sessionId))
      .orderBy(desc(widgetInstances.createdAt));
    return rows.map((r) => this.mapRow(r));
  }

  async findByChat(chatId: string): Promise<WidgetInstance[]> {
    const rows = await this.db
      .select()
      .from(widgetInstances)
      .where(eq(widgetInstances.chatId, chatId))
      .orderBy(desc(widgetInstances.createdAt));
    return rows.map((r) => this.mapRow(r));
  }

  async findByWorkflowRun(workflowRunId: string): Promise<WidgetInstance[]> {
    const rows = await this.db
      .select()
      .from(widgetInstances)
      .where(eq(widgetInstances.workflowRunId, workflowRunId))
      .orderBy(desc(widgetInstances.createdAt));
    return rows.map((r) => this.mapRow(r));
  }

  async updateState(id: string, state: unknown, updatedAt: string): Promise<void> {
    await this.db
      .update(widgetInstances)
      .set({ state: state as unknown, updatedAt: new Date(updatedAt) })
      .where(eq(widgetInstances.id, id));
  }

  async updateStatus(
    id: string,
    status: WidgetInstanceStatus,
    updatedAt: string,
    error?: string,
  ): Promise<void> {
    await this.db
      .update(widgetInstances)
      .set({
        status,
        error: error ?? null,
        updatedAt: new Date(updatedAt),
      })
      .where(and(eq(widgetInstances.id, id)));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(widgetInstances).where(eq(widgetInstances.id, id));
  }

  private mapRow(row: typeof widgetInstances.$inferSelect): WidgetInstance {
    return {
      instanceId: row.id,
      descriptorId: row.descriptorId,
      sessionId: row.sessionId,
      chatId: row.chatId ?? undefined,
      workflowRunId: row.workflowRunId ?? undefined,
      stageRunId: row.stageRunId ?? undefined,
      messageId: row.messageId ?? undefined,
      surface: normalizeWidgetSurface(row.surface),
      props: row.props ?? {},
      state: row.state ?? {},
      status: row.status as WidgetInstanceStatus,
      error: row.error ?? undefined,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
      updatedAt:
        row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
    };
  }
}
