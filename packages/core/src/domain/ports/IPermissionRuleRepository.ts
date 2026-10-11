// ────────────────────────────────────────────────────────────────
// Remembered permission rules (U-16, D-147) — per owner: a chat for its
// lifetime, a workflow run for all of its stages. Rows go with their owner
// (ON DELETE CASCADE).
// ────────────────────────────────────────────────────────────────

import type { PermissionRule } from '@generatorai/shared';

/** Who a rule belongs to. */
export type PermissionRuleOwner = { kind: 'chat'; id: string } | { kind: 'run'; id: string };

/** A rule as stored. */
export interface StoredPermissionRule extends PermissionRule {
  id: string;
  createdAt: Date;
}

export interface IPermissionRuleRepository {
  /** The owner's rules, oldest first. */
  list(owner: PermissionRuleOwner): Promise<StoredPermissionRule[]>;
  /** Adds rules the owner does not have yet (idempotent per kind + match). */
  add(owner: PermissionRuleOwner, rules: readonly PermissionRule[]): Promise<void>;
  /** Removes one rule; false when the owner has no such rule. */
  remove(owner: PermissionRuleOwner, ruleId: string): Promise<boolean>;
  /** Removes all of the owner's rules; the number removed. */
  clear(owner: PermissionRuleOwner): Promise<number>;
}
