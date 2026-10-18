// ────────────────────────────────────────────────────────────────
// PermissionRuleService (U-16, D-147) — "Allow for this chat / for this run",
// and "Allow in this project" (evaluation action 4): a project's rules cover
// every chat and run in that project, so a team stops asking for `pnpm test`.
//
// A tool-permission gate answered with `remember` stores the gate's rules
// (`payload.rememberRules`, derived by `rememberablePermission` from the full
// request) for its owner: a chat for its lifetime, a workflow run for all of
// its stages. Before a later gate of that owner parks, `covering` says
// whether the owner's rules cover it; the gate port then allows it without
// asking and records that it did. Provider-independent: it sits behind the
// one permission gate every provider's callback reaches.
// ────────────────────────────────────────────────────────────────

import { permissionRuleKey, type PermissionRule, type ToolPermissionRequestPayload } from '@generatorai/shared';
import type {
  IPermissionRuleRepository,
  PermissionRuleOwner,
  StoredPermissionRule,
} from '../domain/ports/IPermissionRuleRepository.js';

export class PermissionRuleService {
  constructor(private readonly repo: IPermissionRuleRepository) {}

  list(owner: PermissionRuleOwner): Promise<StoredPermissionRule[]> {
    return this.repo.list(owner);
  }

  /** Remembers a gate's rules for its owner. A gate that derived none is refused by the caller first. */
  async remember(owner: PermissionRuleOwner, rules: readonly PermissionRule[]): Promise<PermissionRule[]> {
    const plain = rules.map(({ kind, match }) => ({ kind, match }));
    if (plain.length > 0) await this.repo.add(owner, plain);
    return owner.kind === 'project' ? plain.map((r) => ({ ...r, scope: 'project' as const })) : plain;
  }

  revoke(owner: PermissionRuleOwner, ruleId: string): Promise<boolean> {
    return this.repo.remove(owner, ruleId);
  }

  clear(owner: PermissionRuleOwner): Promise<number> {
    return this.repo.clear(owner);
  }

  /**
   * The rules that allow this gate without asking, or null when it must ask. Covered means: the gate derived at
   * least one rule (so it is not risky, not always-ask, not on the never-list) and the owner has every one of
   * them — every command of a shell line. A file write in plan mode always asks.
   */
  async covering(
    owners: PermissionRuleOwner | readonly PermissionRuleOwner[],
    payload: Pick<ToolPermissionRequestPayload, 'type' | 'rememberRules'>,
    permissionMode: string,
  ): Promise<PermissionRule[] | null> {
    const wanted = payload.rememberRules ?? [];
    if (wanted.length === 0) return null;
    if (permissionMode === 'plan' && payload.type === 'file_write') return null;
    // The owner's own rules first, then its project's: each command may be covered by either.
    const own = new Set<string>();
    const project = new Set<string>();
    for (const owner of Array.isArray(owners) ? owners : [owners]) {
      const into = (owner as PermissionRuleOwner).kind === 'project' ? project : own;
      for (const r of await this.repo.list(owner as PermissionRuleOwner)) into.add(permissionRuleKey(r));
    }
    const covered: PermissionRule[] = [];
    for (const { kind, match } of wanted) {
      const key = permissionRuleKey({ kind, match });
      if (own.has(key)) covered.push({ kind, match });
      else if (project.has(key)) covered.push({ kind, match, scope: 'project' });
      else return null;
    }
    return covered;
  }
}

/** The rules a stored gate payload offers to remember (empty when it cannot be remembered). */
export function rememberRulesOf(payload: unknown): PermissionRule[] {
  const rules = (payload && typeof payload === 'object' ? (payload as { rememberRules?: unknown }).rememberRules : undefined) ?? [];
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r): r is PermissionRule =>
      !!r && typeof r === 'object' && ((r as PermissionRule).kind === 'command' || (r as PermissionRule).kind === 'tool') && typeof (r as PermissionRule).match === 'string',
  );
}

/** Why a stored gate payload cannot be remembered. */
export function rememberRefusalOf(payload: unknown): string {
  const refusal = payload && typeof payload === 'object' ? (payload as { rememberRefusal?: unknown }).rememberRefusal : undefined;
  return typeof refusal === 'string' && refusal ? refusal : 'This request cannot be remembered; it asks every time.';
}
