// ────────────────────────────────────────────────────────────────
// DrizzleAgentInteractionRepository — IAgentInteractionRepository (PLN-01)
//
// Durable human-interaction gates. The critical property is that `resolve` is
// a CONDITIONAL transition from 'pending': two approvers racing produce
// exactly one winner, and the loser gets a deterministic 409 upstream.
// ────────────────────────────────────────────────────────────────

import { and, asc, eq, lt } from 'drizzle-orm';
import type {
  CreateInteractionParams,
  IAgentInteractionRepository,
} from '@generatorai/core';
import type { AgentInteraction, AgentInteractionStatus } from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { agentInteractions } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleAgentInteractionRepository implements IAgentInteractionRepository {
  constructor(private db: AppDatabase) {}

  async create(params: CreateInteractionParams): Promise<AgentInteraction> {
    const now = new Date();
    try {
      await this.db.insert(agentInteractions).values({
        id: params.id,
        scopeKind: params.scopeKind,
        scopeId: params.scopeId,
        chatId: params.chatId ?? null,
        sessionId: params.sessionId ?? null,
        turnId: params.turnId ?? null,
        kind: params.kind,
        status: 'pending',
        payload: params.payload,
        createdAt: now,
        expiresAt: params.expiresAt ?? null,
      });
    } catch (err) {
      // The partial unique index (chat_id, turn_id, kind) WHERE status='pending'
      // makes a duplicate gate a hard error rather than a silent second prompt.
      throw new StorageError(
        `Failed to open interaction: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
    return {
      id: params.id,
      scopeKind: params.scopeKind,
      scopeId: params.scopeId,
      ...(params.chatId ? { chatId: params.chatId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.turnId ? { turnId: params.turnId } : {}),
      kind: params.kind,
      status: 'pending',
      payload: params.payload,
      createdAt: now,
      ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
    };
  }

  async findById(id: string): Promise<AgentInteraction | null> {
    const rows = await this.db
      .select()
      .from(agentInteractions)
      .where(eq(agentInteractions.id, id))
      .limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async listPendingByChat(chatId: string): Promise<AgentInteraction[]> {
    const rows = await this.db
      .select()
      .from(agentInteractions)
      .where(and(eq(agentInteractions.chatId, chatId), eq(agentInteractions.status, 'pending')))
      .orderBy(asc(agentInteractions.createdAt));
    return rows.map((r) => this.mapRow(r));
  }

  async listPendingByScope(
    scopeKind: 'chat' | 'stage_run',
    scopeId: string,
  ): Promise<AgentInteraction[]> {
    const rows = await this.db
      .select()
      .from(agentInteractions)
      .where(
        and(
          eq(agentInteractions.scopeKind, scopeKind),
          eq(agentInteractions.scopeId, scopeId),
          eq(agentInteractions.status, 'pending'),
        ),
      )
      .orderBy(asc(agentInteractions.createdAt));
    return rows.map((r) => this.mapRow(r));
  }

  async resolve(
    id: string,
    status: AgentInteractionStatus,
    resolution: unknown,
  ): Promise<boolean> {
    const updated = await this.db
      .update(agentInteractions)
      .set({ status, resolution, resolvedAt: new Date() })
      // Conditional on 'pending' — this is what makes one-winner-wins real.
      .where(and(eq(agentInteractions.id, id), eq(agentInteractions.status, 'pending')))
      .returning({ id: agentInteractions.id });
    return updated.length > 0;
  }

  async cancelForTurn(chatId: string, turnId: string, reason: string): Promise<string[]> {
    const updated = await this.db
      .update(agentInteractions)
      .set({ status: 'cancelled', resolution: { reason }, resolvedAt: new Date() })
      .where(
        and(
          eq(agentInteractions.chatId, chatId),
          eq(agentInteractions.turnId, turnId),
          eq(agentInteractions.status, 'pending'),
        ),
      )
      .returning({ id: agentInteractions.id });
    return updated.map((r) => r.id);
  }

  async cancelForChat(chatId: string, reason: string): Promise<string[]> {
    const updated = await this.db
      .update(agentInteractions)
      .set({ status: 'cancelled', resolution: { reason }, resolvedAt: new Date() })
      .where(and(eq(agentInteractions.chatId, chatId), eq(agentInteractions.status, 'pending')))
      .returning({ id: agentInteractions.id });
    return updated.map((r) => r.id);
  }

  async expireStale(olderThan: Date): Promise<string[]> {
    const updated = await this.db
      .update(agentInteractions)
      .set({
        status: 'expired',
        resolution: { reason: 'timeout' },
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(agentInteractions.status, 'pending'),
          eq(agentInteractions.scopeKind, 'chat'),
          lt(agentInteractions.createdAt, olderThan),
        ),
      )
      .returning({ id: agentInteractions.id });
    return updated.map((r) => r.id);
  }

  async expireAllPendingChatGates(reason: string): Promise<string[]> {
    // Called on boot. A chat gate blocks an in-memory SDK callback that did
    // NOT survive the restart, so the row can never be honestly resumed.
    const updated = await this.db
      .update(agentInteractions)
      .set({ status: 'expired', resolution: { reason }, resolvedAt: new Date() })
      .where(
        and(eq(agentInteractions.status, 'pending'), eq(agentInteractions.scopeKind, 'chat')),
      )
      .returning({ id: agentInteractions.id });
    return updated.map((r) => r.id);
  }

  private mapRow(row: typeof agentInteractions.$inferSelect): AgentInteraction {
    return {
      id: row.id,
      scopeKind: row.scopeKind,
      scopeId: row.scopeId,
      ...(row.chatId ? { chatId: row.chatId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.turnId ? { turnId: row.turnId } : {}),
      kind: row.kind,
      status: row.status,
      payload: row.payload,
      ...(row.resolution !== null && row.resolution !== undefined
        ? { resolution: row.resolution }
        : {}),
      createdAt: row.createdAt,
      ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    };
  }
}
