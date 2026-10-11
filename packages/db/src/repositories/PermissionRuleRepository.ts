// ────────────────────────────────────────────────────────────────
// DrizzlePermissionRuleRepository — the permission rules a chat or a
// workflow run remembered ("Allow for this chat / run"; v67, U-16 / D-147).
// ────────────────────────────────────────────────────────────────

import { and, asc, eq, type SQL } from 'drizzle-orm';
import { generateId, type PermissionRule } from '@generatorai/shared';
import type { IPermissionRuleRepository, PermissionRuleOwner, StoredPermissionRule } from '@generatorai/core';
import { permissionRules } from '../schema.js';
import type { AppDatabase } from '../index.js';

function ownerIs(owner: PermissionRuleOwner): SQL {
  return owner.kind === 'chat' ? eq(permissionRules.chatId, owner.id) : eq(permissionRules.runId, owner.id);
}

export class DrizzlePermissionRuleRepository implements IPermissionRuleRepository {
  constructor(private db: AppDatabase) {}

  async list(owner: PermissionRuleOwner): Promise<StoredPermissionRule[]> {
    const rows = await this.db
      .select()
      .from(permissionRules)
      .where(ownerIs(owner))
      .orderBy(asc(permissionRules.createdAt), asc(permissionRules.id));
    return rows.map((r) => ({ id: r.id, kind: r.kind, match: r.match, createdAt: r.createdAt }));
  }

  async add(owner: PermissionRuleOwner, rules: readonly PermissionRule[]): Promise<void> {
    if (rules.length === 0) return;
    const now = new Date();
    await this.db
      .insert(permissionRules)
      .values(
        rules.map((r) => ({
          id: generateId(),
          chatId: owner.kind === 'chat' ? owner.id : null,
          runId: owner.kind === 'run' ? owner.id : null,
          kind: r.kind,
          match: r.match,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  async remove(owner: PermissionRuleOwner, ruleId: string): Promise<boolean> {
    const removed = await this.db
      .delete(permissionRules)
      .where(and(ownerIs(owner), eq(permissionRules.id, ruleId)))
      .returning({ id: permissionRules.id });
    return removed.length > 0;
  }

  async clear(owner: PermissionRuleOwner): Promise<number> {
    const removed = await this.db.delete(permissionRules).where(ownerIs(owner)).returning({ id: permissionRules.id });
    return removed.length;
  }
}
