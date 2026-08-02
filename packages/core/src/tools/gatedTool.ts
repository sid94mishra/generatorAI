// ────────────────────────────────────────────────────────────────
// gatedTool — TOL-02 wrap a ToolDefinition with a PermissionPolicy.
//
// The harness's native permission prompt (Copilot's `onPermissionRequest`
// + `onPreToolUse`) still runs as before. This wrapper adds a
// **domain-level** gate on top, driven by the tool's declared
// `requiredPermissions` and the active `PermissionPolicy`:
//
//   gate decision   → behaviour
//   'allow'         → invoke handler as normal
//   'ask'           → invoke handler (the harness will prompt the user)
//   'deny'          → throw before invoking, no tool side-effect
//
// Why the wrapper AND the harness's native check?
//
//   1. Some harnesses (OpenAI) don't emit permission requests at all —
//      the wrapper is the only gate.
//   2. For harnesses that do (Copilot, Claude) the wrapper lets domain
//      policy (acceptEdits, plan, bypass) take effect even when the
//      harness's built-in prompt would happily forward the request to the
//      user. `plan` mode, for example, needs to turn every tool into an
//      'ask' regardless of what the SDK thinks about it.
//   3. It encodes `skipPermission` uniformly — if the tool says it's
//      safe and the registry + wrapper agree, we skip the domain gate
//      too, not just the harness prompt.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';
import type { PermissionPolicy, PermissionDecision } from '../permissions/index.js';
import { evaluateToolPermissions } from '../permissions/index.js';

/** Error thrown when the domain policy denies a tool invocation. */
export class ToolPermissionDeniedError extends Error {
  readonly code = 'TOOL_PERMISSION_DENIED';
  readonly toolName: string;
  readonly decision: PermissionDecision;
  constructor(toolName: string, decision: PermissionDecision) {
    super(`Tool '${toolName}' denied by permission policy: ${decision.reason}`);
    this.name = 'ToolPermissionDeniedError';
    this.toolName = toolName;
    this.decision = decision;
  }
}

export interface GateOptions {
  policy: PermissionPolicy;
  /**
   * Observer invoked on every decision. Useful for logging + telemetry
   * (e.g. "deny events crossed N/min" metrics). Kept synchronous so it
   * can't silently delay tool execution.
   */
  onDecision?: (toolName: string, decision: PermissionDecision) => void;
}

/**
 * Returns a new `ToolDefinition` whose `handler` evaluates the
 * `PermissionPolicy` before calling the underlying handler. Metadata
 * (`name`, `description`, `parametersSchema`, `skipPermission`,
 * `requiredPermissions`, `owner`) is copied through unchanged — adapters
 * can still read it off the returned object.
 */
export function withPermissionGate(
  tool: ToolDefinition,
  opts: GateOptions,
): ToolDefinition {
  return {
    ...tool,
    handler: async (args: Record<string, unknown>) => {
      if (tool.skipPermission) {
        opts.onDecision?.(tool.name, {
          action: 'allow',
          reason: 'tool declared skipPermission=true',
        });
        return tool.handler(args);
      }
      const decision = evaluateToolPermissions(
        opts.policy,
        tool.name,
        tool.requiredPermissions ?? [],
      );
      opts.onDecision?.(tool.name, decision);
      if (decision.action === 'deny') {
        throw new ToolPermissionDeniedError(tool.name, decision);
      }
      // 'allow' and 'ask' both proceed; the harness's native prompt (when
      // it exists) handles the user-facing confirmation for 'ask'.
      return tool.handler(args);
    },
  };
}

/** Apply `withPermissionGate` to an entire list. */
export function gateTools(
  tools: readonly ToolDefinition[],
  opts: GateOptions,
): ToolDefinition[] {
  return tools.map((t) => withPermissionGate(t, opts));
}
