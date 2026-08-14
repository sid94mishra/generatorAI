// ────────────────────────────────────────────────────────────────
// DrizzleComputerUseRepository — grants + audit persistence for Computer Use.
//
// Two tables, two very different retention stories:
//
//   computer_use_grants — durable user decisions, scoped per workspace + app
//     + privilege tier. Cascades away with the workspace, because a grant
//     that outlives its subject is a standing authorisation nobody can see.
//
//   computer_use_audit  — an append-only trail that records REFUSALS as well
//     as successes. A blocked attempt against a password manager is the row a
//     security review most needs, and it is the only evidence the control
//     fired. Deliberately no FK: the trail must outlive the workspace.
// ────────────────────────────────────────────────────────────────

import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ComputerAuditEntry, ComputerConsentScope, ComputerStoredGrant } from '@generatorai/core';
import { StorageError } from '@generatorai/shared';
import { computerUseAudit, computerUseGrants } from '../schema.js';
import type { AppDatabase } from '../index.js';

export interface ComputerUseGrantRow extends ComputerStoredGrant {
  appIdentity: string;
  appLabel: string;
  grantedAt: Date;
  lastUsedAt: Date | null;
}

export class DrizzleComputerUseRepository {
  constructor(private db: AppDatabase) {}

  async findGrant(workspaceId: string, appIdentity: string): Promise<ComputerStoredGrant | null> {
    const rows = await this.db
      .select()
      .from(computerUseGrants)
      .where(and(eq(computerUseGrants.workspaceId, workspaceId), eq(computerUseGrants.appIdentity, appIdentity)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { decision: row.decision, scope: row.scope };
  }

  async saveGrant(
    workspaceId: string,
    appIdentity: string,
    appLabel: string,
    decision: 'always_allow' | 'deny',
    scope: ComputerConsentScope,
  ): Promise<void> {
    try {
      await this.db
        .insert(computerUseGrants)
        .values({
          id: randomUUID(),
          workspaceId,
          appIdentity,
          appLabel,
          decision,
          scope,
          grantedAt: new Date(),
          lastUsedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [computerUseGrants.workspaceId, computerUseGrants.appIdentity],
          set: { appLabel, decision, scope, grantedAt: new Date(), lastUsedAt: new Date() },
        });
    } catch (err) {
      throw new StorageError(
        `Failed to save computer-use grant: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async listGrants(workspaceId: string): Promise<ComputerUseGrantRow[]> {
    const rows = await this.db
      .select()
      .from(computerUseGrants)
      .where(eq(computerUseGrants.workspaceId, workspaceId));
    return rows.map((row) => ({
      appIdentity: row.appIdentity,
      appLabel: row.appLabel,
      decision: row.decision,
      scope: row.scope,
      grantedAt: row.grantedAt,
      lastUsedAt: row.lastUsedAt ?? null,
    }));
  }

  async revokeGrant(workspaceId: string, appIdentity: string): Promise<void> {
    await this.db
      .delete(computerUseGrants)
      .where(and(eq(computerUseGrants.workspaceId, workspaceId), eq(computerUseGrants.appIdentity, appIdentity)));
  }

  async recordAudit(entry: ComputerAuditEntry): Promise<void> {
    try {
      await this.db.insert(computerUseAudit).values({
        id: randomUUID(),
        workspaceId: entry.workspaceId,
        chatId: entry.chatId ?? null,
        appIdentity: entry.appIdentity,
        appLabel: entry.appLabel,
        action: entry.action,
        target: entry.target ?? null,
        path: entry.path ?? null,
        verified: entry.verified,
        refusalCode: entry.refusalCode ?? null,
        blockedOn: entry.blockedOn ?? null,
        artifactPath: entry.artifactPath ?? null,
        createdAt: entry.createdAt,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to record computer-use audit entry: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async listAudit(workspaceId: string, limit = 200): Promise<ComputerAuditEntry[]> {
    const rows = await this.db
      .select()
      .from(computerUseAudit)
      .where(eq(computerUseAudit.workspaceId, workspaceId))
      .orderBy(desc(computerUseAudit.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      chatId: row.chatId ?? undefined,
      appIdentity: row.appIdentity,
      appLabel: row.appLabel,
      action: row.action,
      target: row.target ?? undefined,
      path: row.path ?? undefined,
      verified: row.verified,
      refusalCode: (row.refusalCode ?? undefined) as ComputerAuditEntry['refusalCode'],
      blockedOn: row.blockedOn ?? undefined,
      artifactPath: row.artifactPath ?? undefined,
      createdAt: row.createdAt,
    }));
  }
}
