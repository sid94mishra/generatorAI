// ────────────────────────────────────────────────────────────────
// Provider capability levels (P02; RV-6, RV-9).
//
// What a session on each provider can be given, decided by provider id
// before a conversation exists: how skills are delivered, whether a run's
// permission mode can be enforced (PD-17), whether host tools reach the
// model. Each provider's `capabilities()` declares the same levels (a table
// test in agent-harness-providers keeps them in step). Pure data: the
// server's SessionComposer and the web SessionSpecEditor read the same table.
// ────────────────────────────────────────────────────────────────

export type ApprovalGatingLevel = 'per_call' | 'exec_and_patch' | 'none';
export type HostToolsLevel = 'full' | 'start_only' | 'none';
export type StructuredOutputLevel = 'native' | 'tool' | 'none';
export type SkillsLevel = 'plugin' | 'directories' | 'none';

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

export interface SessionCapabilityWarning {
  code:
    | 'permission_gating_unsupported'
    | 'permission_gating_exec_and_patch'
    | 'host_tools_unsupported'
    | 'host_tools_start_only'
    | 'skills_unsupported'
    | 'skills_process_global'
    | 'computer_use_blocked_bypass';
  /** `error` is refused at run start (PD-17); `warning` runs with less than asked. */
  severity: 'error' | 'warning';
  message: string;
}

/**
 * What a session editor should say about a configuration, given its provider:
 * the rules the composer applies (PD-17 refusals and warnings, host tools,
 * skills, computer use on bypass). Unknown provider (routing by model): only
 * the provider-independent checks.
 */
export function sessionCapabilityWarnings(input: {
  provider?: string;
  permissionMode?: string;
  /** Whether the session asks for skills (agent or explicit). */
  wantsSkills?: boolean;
  /** Whether the session asks for platform tools (browser, widgets, computer use, custom tools, MCP). */
  wantsHostTools?: boolean;
  computerUse?: boolean;
}): SessionCapabilityWarning[] {
  const out: SessionCapabilityWarning[] = [];
  const levels = capabilityLevelsFor(input.provider);
  const mode = input.permissionMode;
  const name = input.provider ?? 'This provider';
  if (input.computerUse && mode === 'bypassPermissions') {
    out.push({
      code: 'computer_use_blocked_bypass',
      severity: 'warning',
      message: 'Computer use is never given to a bypass session. Pick another permission mode to use it.',
    });
  }
  if (!levels) return out;
  if (levels.approvalGating === 'none' && (mode === 'default' || mode === 'plan')) {
    out.push({
      code: 'permission_gating_unsupported',
      severity: 'error',
      message: `${name} never asks before a tool runs, so it cannot hold "${mode}". Use acceptEdits or bypassPermissions.`,
    });
  } else if (levels.approvalGating === 'exec_and_patch' && (mode === 'default' || mode === 'acceptEdits')) {
    out.push({
      code: 'permission_gating_exec_and_patch',
      severity: 'warning',
      message: `${name} asks only before commands and patches. Other tools run without approval.`,
    });
  }
  if (input.wantsHostTools && levels.hostTools === 'none') {
    out.push({
      code: 'host_tools_unsupported',
      severity: 'warning',
      message: `${name} cannot use platform tools (browser, widgets, custom tools, platform MCP servers).`,
    });
  } else if (input.wantsHostTools && levels.hostTools === 'start_only') {
    out.push({
      code: 'host_tools_start_only',
      severity: 'warning',
      message: `${name} takes platform tools only when the session starts. Later changes need a new session.`,
    });
  }
  if (input.wantsSkills && levels.skills === 'none') {
    out.push({ code: 'skills_unsupported', severity: 'warning', message: `${name} does not load skills.` });
  } else if (input.wantsSkills && input.provider === 'codex') {
    out.push({
      code: 'skills_process_global',
      severity: 'warning',
      message: 'Codex skill folders are shared by every Codex session on this server.',
    });
  }
  return out;
}
