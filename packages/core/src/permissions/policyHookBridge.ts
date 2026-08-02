// ────────────────────────────────────────────────────────────────
// policyHookBridge — TOL-04 glue between `PermissionPolicy` and `HookBridge`.
//
// `HookBridge` (HKS-01) is the harness-agnostic synchronous hook port.
// `PermissionPolicy` (TOL-04) is the declarative mode + rule engine. This
// file produces a `HookBridge` whose `onPreToolUse` evaluates a policy
// and returns an `allow | deny | ask` decision.
//
// Usage — in an adapter's `createConversation`:
//
//   const policyBridge = makePolicyHookBridge({
//     policy, registry, onDecision: (name, d) => logger.info(...)
//   });
//   const userBridge = hookInterceptor.buildHookBridge(hooks, ctx);
//   const combined = mergeHookBridges(policyBridge, userBridge);
//   adapter.createConversation({ ...params, hooks: combined });
//
// Splitting the policy and the HookExecutor-driven hooks into two bridges
// that get merged keeps responsibilities clean: policy evaluation is pure
// and synchronous; user hooks may be scripts / HTTP / in-process
// callbacks. A future OpenAI adapter that doesn't have a native
// `onPreToolUse` can still apply `policyBridge` inside its own tool-
// execution gate by reading the returned output.
// ────────────────────────────────────────────────────────────────

import type {
  HookBridge,
  HookBridgeInvocation,
  PreToolUseHookOutput,
} from '../domain/ports/IHookBridge.js';
import type { CustomToolRegistry } from '../tools/CustomToolRegistry.js';
import type { PermissionPolicy, PermissionDecision } from './PermissionPolicy.js';
import { evaluateToolPermissions } from './PermissionPolicy.js';

export interface PolicyHookBridgeOptions {
  policy: PermissionPolicy;
  /**
   * Optional registry — used to look up `requiredPermissions` for the
   * invoked tool. Omitted = policy evaluates against the mode only
   * (which is still useful for `plan`, `bypassPermissions`, `acceptEdits`).
   */
  registry?: CustomToolRegistry;
  /** Observer for telemetry / logging. */
  onDecision?: (toolName: string, decision: PermissionDecision) => void;
}

/**
 * Build a `HookBridge` that applies a `PermissionPolicy` in `onPreToolUse`.
 * Does not touch other hook phases; merge with additional bridges via
 * `mergeHookBridges` when more behaviour is needed.
 */
export function makePolicyHookBridge(
  opts: PolicyHookBridgeOptions,
): HookBridge {
  return {
    onPreToolUse: async (input) => {
      const tool = opts.registry?.get(input.toolName);
      const required = tool?.requiredPermissions ?? [];

      // `skipPermission` on the tool short-circuits both the harness and
      // the policy — a tool that declares it's always safe should behave
      // that way no matter the mode.
      if (tool?.skipPermission) {
        opts.onDecision?.(input.toolName, {
          action: 'allow',
          reason: 'tool declared skipPermission=true',
        });
        const out: PreToolUseHookOutput = { decision: 'allow' };
        return out;
      }

      const decision = evaluateToolPermissions(
        opts.policy,
        input.toolName,
        required,
      );
      opts.onDecision?.(input.toolName, decision);
      const out: PreToolUseHookOutput = {
        decision: decision.action,
        reason: decision.reason,
      };
      return out;
    },
  };
}

/**
 * Merge multiple `HookBridge` objects into one. When multiple bridges
 * define the same phase we run them in order; for `onPreToolUse` a `deny`
 * from any bridge short-circuits the rest. For additive output fields
 * (`additionalContext`, `modifiedArgs`) the later bridge wins when
 * present.
 *
 * This lets callers compose the policy bridge (TOL-04) with the user
 * HookExecutor-driven bridge (HKS-01) without either side knowing about
 * the other.
 */
export function mergeHookBridges(...bridges: HookBridge[]): HookBridge {
  const kept = bridges.filter((b) => b !== undefined);

  const mergeOnPre: HookBridge['onPreToolUse'] = async (input, invocation) => {
    let merged: PreToolUseHookOutput = {};
    for (const b of kept) {
      if (!b.onPreToolUse) continue;
      const out = (await b.onPreToolUse(input, invocation)) ?? {};
      if (out.decision === 'deny') {
        // First deny wins. Preserve any earlier merged context.
        return { ...merged, ...out, decision: 'deny' };
      }
      merged = { ...merged, ...out };
    }
    return merged;
  };

  // For the remaining phases — run sequentially, merging outputs. Every phase
  // handler has a different (input, invocation) signature, so calling them
  // through a generic `K` would require the *intersection* of all input types
  // (TypeScript can't call a union of function types). We instead treat each
  // handler as a concrete "any-phase" callable that returns a mergeable record.
  // The narrow casts (no `any`) erase only the per-phase input identity, which
  // is sound here because we never inspect the input — we just forward it.
  type AnyHookHandler = (
    input: never,
    invocation: HookBridgeInvocation,
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  const mergeSequential = <K extends keyof HookBridge>(key: K): HookBridge[K] => {
    const handler = async (
      input: Parameters<NonNullable<HookBridge[K]>>[0],
      invocation: HookBridgeInvocation,
    ): Promise<Record<string, unknown>> => {
      let merged: Record<string, unknown> = {};
      for (const b of kept) {
        const fn = b[key] as AnyHookHandler | undefined;
        if (!fn) continue;
        const out = (await fn(input as never, invocation)) ?? {};
        merged = { ...merged, ...out };
      }
      return merged;
    };
    return handler as HookBridge[K];
  };

  return {
    onPreToolUse: kept.some((b) => b.onPreToolUse) ? mergeOnPre : undefined,
    onPostToolUse: kept.some((b) => b.onPostToolUse) ? mergeSequential('onPostToolUse') : undefined,
    onUserPromptSubmitted: kept.some((b) => b.onUserPromptSubmitted) ? mergeSequential('onUserPromptSubmitted') : undefined,
    onSessionStart: kept.some((b) => b.onSessionStart) ? mergeSequential('onSessionStart') : undefined,
    onSessionEnd: kept.some((b) => b.onSessionEnd) ? mergeSequential('onSessionEnd') : undefined,
    onErrorOccurred: kept.some((b) => b.onErrorOccurred) ? mergeSequential('onErrorOccurred') : undefined,
  };
}
