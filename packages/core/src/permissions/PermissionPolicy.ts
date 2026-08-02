// ────────────────────────────────────────────────────────────────
// PermissionPolicy — TOL-04 plan-mode + allow/deny/ask rules.
//
// A policy has two layers:
//
//   1. `mode` — coarse global behaviour. Most calls never reach the rule
//      engine because the mode short-circuits the decision:
//        • `default`          — rules decide; unmatched requests → 'ask'
//        • `acceptEdits`      — auto-allow file writes; rest via rules
//        • `plan`             — every tool call becomes 'ask' so the agent
//                               surfaces its plan before executing anything
//        • `bypassPermissions`— allow everything; log, don't prompt.
//                               Dev/CI only — loud warnings on boot.
//
//   2. `rules[]` — fine-grained `PermissionRule` entries evaluated in
//      order. First match wins. A rule can match on `tool` name (exact /
//      glob), `kind` (one of `PermissionKind`), and optionally a `resource`
//      pattern. The action is `allow | deny | ask`.
//
// The evaluator is pure (no side effects) so it can be run from any
// harness adapter's pre-tool hook. Adapters call `evaluatePermission`
// from their `onPreToolUse` implementation — the Copilot adapter threads
// the decision through the SDK's native `permissionDecision` field;
// adapters without a native hook path evaluate before firing the tool.
// ────────────────────────────────────────────────────────────────

import type { Permission, PermissionKind } from './Permission.js';

/** Coarse operating mode. Usually workflow- or run-level. */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions';

/** Action a rule or mode dictates for a permission request. */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * A declarative policy entry. All three match fields are optional; a rule
 * with no matchers applies to every request. `priority` is advisory —
 * rules are evaluated in the order supplied; higher-priority policies
 * should be earlier in the list. We keep priority as a data field so
 * future UI / sorting code has something to order on.
 */
export interface PermissionRule {
  /** Rule name for logging + telemetry. */
  name: string;
  /** Resulting action when this rule matches. */
  action: PermissionAction;
  /**
   * Tool name matcher. Glob-like: `*` matches any, `fs.*` matches
   * namespace prefixes, exact names match themselves. Omit to match all
   * tools.
   */
  tool?: string;
  /** Kind matcher. Omit to match all kinds. */
  kind?: PermissionKind;
  /**
   * Resource substring match (e.g. path prefix, host pattern). Omit to
   * skip resource matching. Intentionally permissive — authors can tighten
   * with globs via `tool` + `kind` instead.
   */
  resource?: string;
  /** Optional sorting hint; not used by the evaluator. */
  priority?: number;
}

/** Full policy: a mode plus an ordered rule list. */
export interface PermissionPolicy {
  mode: PermissionMode;
  rules: PermissionRule[];
}

/** Request shape passed into the evaluator. */
export interface PermissionRequest {
  /** Name of the tool about to run. */
  toolName: string;
  /** One of the permissions the tool declared as required. */
  permission: Permission;
}

/**
 * Decision the evaluator returns. `matchedRule` is the rule that fired
 * (when one did) so callers can surface it in logs / UI.
 */
export interface PermissionDecision {
  action: PermissionAction;
  reason: string;
  matchedRule?: PermissionRule;
}

/**
 * Match a glob-like tool pattern against a concrete name. Supports `*` as
 * a full wildcard and namespace globs like `fs.*`. Intentionally narrow —
 * if a use-case needs real glob semantics we'll pull in minimatch.
 */
export function toolMatches(pattern: string | undefined, name: string): boolean {
  if (!pattern) return true;
  if (pattern === '*') return true;
  if (pattern === name) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return name.startsWith(prefix + '.');
  }
  return false;
}

/**
 * Pure policy evaluator. Given a policy and a request, returns the
 * decision without side effects. Evaluation order:
 *
 *   1. `bypassPermissions` → always allow (with a reason string callers
 *      should log prominently).
 *   2. `plan` → always ask. A plan-mode run surfaces everything to the
 *      approver so nothing runs unsupervised.
 *   3. `acceptEdits` → auto-allow `file_write` (and `file_read`, which is
 *      implied by writes). All other kinds fall through to rules.
 *   4. Rules, in order. First match wins.
 *   5. Fallback: `default` → `ask`. We deliberately do not auto-allow
 *      unmatched requests — secure defaults.
 */
export function evaluatePermission(
  policy: PermissionPolicy,
  request: PermissionRequest,
): PermissionDecision {
  if (policy.mode === 'bypassPermissions') {
    return {
      action: 'allow',
      reason: `bypassPermissions mode — allowed without prompting (${request.permission.kind})`,
    };
  }

  if (policy.mode === 'plan') {
    return {
      action: 'ask',
      reason: `plan mode — surfacing '${request.toolName}' for approval before execution`,
    };
  }

  if (policy.mode === 'acceptEdits') {
    if (request.permission.kind === 'file_write' || request.permission.kind === 'file_read') {
      return {
        action: 'allow',
        reason: `acceptEdits mode — auto-allow file ${request.permission.kind}`,
      };
    }
    // fall through to rules for non-edit kinds
  }

  // Rule engine — first match wins.
  for (const rule of policy.rules) {
    if (!toolMatches(rule.tool, request.toolName)) continue;
    if (rule.kind && rule.kind !== request.permission.kind) continue;
    if (rule.resource && request.permission.resource) {
      if (!request.permission.resource.includes(rule.resource)) continue;
    } else if (rule.resource && !request.permission.resource) {
      // rule specifies a resource match but request has none → not a hit
      continue;
    }
    return {
      action: rule.action,
      reason: `matched rule '${rule.name}'`,
      matchedRule: rule,
    };
  }

  return {
    action: 'ask',
    reason: `no rule matched '${request.toolName}' (${request.permission.kind}); default → ask`,
  };
}

/** Convenience: evaluate every permission a tool requires. Returns the
 *  strongest decision ('deny' > 'ask' > 'allow') so a single deny blocks. */
export function evaluateToolPermissions(
  policy: PermissionPolicy,
  toolName: string,
  required: readonly Permission[],
): PermissionDecision {
  if (required.length === 0) {
    // No declared permissions → take the mode's implicit stance rather
    // than defaulting to allow. This is what makes `requiredPermissions`
    // safe to omit on a custom tool registration: you get the policy's
    // default treatment.
    return evaluatePermission(policy, {
      toolName,
      permission: { kind: 'other', description: 'no declared permissions' },
    });
  }

  let worst: PermissionDecision = {
    action: 'allow',
    reason: 'all permissions allowed',
  };
  for (const permission of required) {
    const d = evaluatePermission(policy, { toolName, permission });
    if (d.action === 'deny') return d;
    if (d.action === 'ask' && worst.action === 'allow') worst = d;
  }
  return worst;
}
