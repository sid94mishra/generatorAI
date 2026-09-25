// ────────────────────────────────────────────────────────────────
// Provider capability levels (P02 design; RV-6, RV-9).
//
// The composer decides by provider id, before a conversation exists, what a
// session can be given: how skills are delivered, whether a run's permission
// mode can be enforced (PD-17), whether host tools reach the model. Each
// provider's `capabilities()` declares the same levels; a table test keeps
// the two in step.
// ────────────────────────────────────────────────────────────────

import type {
  ApprovalGatingLevel,
  HostToolsLevel,
  SkillsLevel,
  StructuredOutputLevel,
} from '../../domain/ports/IProviderInstance.js';

export interface CapabilityLevels {
  approvalGating: ApprovalGatingLevel;
  hostTools: HostToolsLevel;
  structuredOutput: StructuredOutputLevel;
  skills: SkillsLevel;
}

export const PROVIDER_CAPABILITY_LEVELS = {
  // canUseTool reaches the session gate for every call not auto-allowed;
  // in-process MCP host tools; `outputFormat`; skills load from a local plugin.
  'claude-agent': { approvalGating: 'per_call', hostTools: 'full', structuredOutput: 'native', skills: 'plugin' },
  // SDK onPermissionRequest per call; tools on every session; no output schema;
  // `skillDirectories` is passed to the SDK (RV-8).
  copilot: { approvalGating: 'per_call', hostTools: 'full', structuredOutput: 'tool', skills: 'directories' },
  // Approvals only for exec/patch; `dynamicTools` only on thread/start;
  // `outputSchema`; skill roots are process-global (`skills/extraRoots/set`).
  codex: { approvalGating: 'exec_and_patch', hostTools: 'start_only', structuredOutput: 'native', skills: 'directories' },
  // Never asks; no host tools, no MCP, no skills.
  opencode: { approvalGating: 'none', hostTools: 'none', structuredOutput: 'none', skills: 'none' },
  // session/request_permission per call; the agent owns its tools.
  acp: { approvalGating: 'per_call', hostTools: 'none', structuredOutput: 'none', skills: 'none' },
} as const satisfies Record<string, CapabilityLevels>;

export type LevelledProviderId = keyof typeof PROVIDER_CAPABILITY_LEVELS;

/** The levels of `provider`, or undefined when the provider is unknown (routing by model). */
export function capabilityLevelsFor(provider: string | undefined): CapabilityLevels | undefined {
  if (!provider) return undefined;
  return (PROVIDER_CAPABILITY_LEVELS as Record<string, CapabilityLevels>)[provider];
}
