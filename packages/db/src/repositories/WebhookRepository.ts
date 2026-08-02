// ────────────────────────────────────────────────────────────────
// DrizzleWebhookRepository — IWebhookRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and } from 'drizzle-orm';
import type { IWebhookRepository } from '@generatorai/core';
import type { WebhookRegistration, WebhookDelivery } from '@generatorai/shared';
import { webhookRegistrations, webhookDeliveries } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonRecord, jsonUnknown } from '../utils/jsonColumnSchemas.js';

export class DrizzleWebhookRepository implements IWebhookRepository {
  constructor(private db: AppDatabase) {}

  async getActiveRegistrations(source: string, eventType: string): Promise<WebhookRegistration[]> {
    const rows = await this.db
      .select()
      .from(webhookRegistrations)
      .where(
        and(
          eq(webhookRegistrations.source, source),
          eq(webhookRegistrations.eventType, eventType),
          eq(webhookRegistrations.enabled, true),
        ),
      );
    return rows.map((r) => this.mapRegistration(r));
  }

  async getRegistration(id: string): Promise<WebhookRegistration | null> {
    const rows = await this.db
      .select()
      .from(webhookRegistrations)
      .where(eq(webhookRegistrations.id, id))
      .limit(1);
    const row = rows[0];
    return row ? this.mapRegistration(row) : null;
  }

  async getAllRegistrations(): Promise<WebhookRegistration[]> {
    const rows = await this.db.select().from(webhookRegistrations);
    return rows.map((r) => this.mapRegistration(r));
  }

  async createRegistration(reg: WebhookRegistration): Promise<WebhookRegistration> {
    await this.db.insert(webhookRegistrations).values({
      id: reg.id,
      name: reg.name,
      source: reg.source,
      eventType: reg.eventType,
      condition: reg.condition ?? null,
      templateId: reg.templateId,
      autoStart: reg.autoStart,
      sessionConfig: reg.sessionConfig ?? null,
      enabled: reg.enabled,
      createdAt: reg.createdAt,
      lastTriggeredAt: reg.lastTriggeredAt ?? null,
    });
    return reg;
  }

  async deleteRegistration(id: string): Promise<void> {
    await this.db.delete(webhookRegistrations).where(eq(webhookRegistrations.id, id));
  }

  async logDelivery(delivery: WebhookDelivery): Promise<void> {
    await this.db.insert(webhookDeliveries).values({
      id: delivery.id,
      registrationId: delivery.registrationId ?? null,
      deliveryId: delivery.deliveryId ?? null,
      source: delivery.source,
      eventType: delivery.eventType,
      payload: delivery.payload ?? null,
      status: delivery.status,
      error: delivery.error ?? null,
      sessionId: delivery.sessionId ?? null,
      receivedAt: delivery.receivedAt,
      processedAt: delivery.processedAt ?? null,
    });
  }

  async getDeliveryById(deliveryId: string): Promise<WebhookDelivery | null> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId))
      .limit(1);
    const row = rows[0];
    return row ? this.mapDelivery(row) : null;
  }

  async updateDeliveryStatus(deliveryId: string, status: string): Promise<void> {
    await this.db
      .update(webhookDeliveries)
      .set({ status: status as WebhookDelivery['status'] })
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
  }

  async updateDelivery(deliveryId: string, updates: Partial<WebhookDelivery>): Promise<void> {
    const values: Record<string, unknown> = {};
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.sessionId !== undefined) values['sessionId'] = updates.sessionId;
    if (updates.processedAt !== undefined) values['processedAt'] = updates.processedAt;

    await this.db
      .update(webhookDeliveries)
      .set(values)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
  }

  private mapRegistration(row: typeof webhookRegistrations.$inferSelect): WebhookRegistration {
    return {
      id: row.id,
      name: row.name,
      source: row.source,
      eventType: row.eventType,
      condition: row.condition ?? undefined,
      templateId: row.templateId,
      autoStart: row.autoStart,
      sessionConfig: safeJsonColumn(row.sessionConfig, jsonRecord, { fallback: undefined }),
      enabled: row.enabled,
      createdAt: row.createdAt,
      lastTriggeredAt: row.lastTriggeredAt ?? undefined,
    };
  }

  private mapDelivery(row: typeof webhookDeliveries.$inferSelect): WebhookDelivery {
    return {
      id: row.id,
      registrationId: row.registrationId ?? undefined,
      deliveryId: row.deliveryId ?? undefined,
      source: row.source,
      eventType: row.eventType,
      payload: safeJsonColumn(row.payload, jsonUnknown, { fallback: undefined }),
      status: row.status as WebhookDelivery['status'],
      error: row.error ?? undefined,
      sessionId: row.sessionId ?? undefined,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt ?? undefined,
    };
  }
}
