import type { HarnessProviderId, ReasoningEffort } from './ProviderConfig.js';
// ────────────────────────────────────────────────────────────────
// Agent — first-class, user-authored agent definition.
//
// An Agent bundles instructions, a capability policy
// (skills / MCP servers / tool groups) and a runtime policy
// (model / effort / permission mode) under a portable `scope:slug` ref.
//
// It can drive a Chat, a Workflow Stage, or an Orchestrator worker.
// `AgentResolver` (packages/core) is the ONLY place these are combined
// with binding-site overrides.
// ────────────────────────────────────────────────────────────────

import type { AgentMode, AgentPermissionMode } from './AgentMode.js';

export type AgentScope = 'system' | 'global' | 'project';
export type AgentRole = 'agent' | 'orchestrator';

/**
 * How the agent's instructions reach the provider.
 *
 * - `append`  — instructions are appended after the platform blocks (default).
 * - `replace` — the base instructions are dropped, but the platform capability
 *               blocks (browser / widgets / orchestrator / plan) still survive,
 *               otherwise the tools they describe become unusable.
 *
 * Provider-native binding (`SessionConfig.agent` / `Options.agent`) is
 * deliberately NOT exposed: on Claude it replaces the whole system prompt.
 */
export type AgentProjectionMode = 'append' | 'replace';

/**
 * Capability groups. Every field is tri-state on the persisted side:
 *   true      — force on
 *   false     — force off (beats a lower level's true)
 *   undefined — inherit
 * Persisted as `Partial<AgentToolPolicy>`; the resolver emits the full shape.
 */
export interface AgentToolPolicy {
  /** Integrated Browser tool set. */
  browser: boolean;
  /** render_widget / update_widget / read_widget / describe_widget / widget_action / widget_exec. */
  widgets: boolean;
  /** write_extension / reload_extension. */
  extensionAuthoring: boolean;
  /** Background-agent tool set. Forced true when role === 'orchestrator'. */
  orchestration: boolean;
  fileRead: boolean;
  fileWrite: boolean;
  shell: boolean;
  /** Web fetch / search. */
  web: boolean;
}

export const AGENT_TOOL_GROUPS: readonly (keyof AgentToolPolicy)[] = [
  'browser',
  'widgets',
  'extensionAuthoring',
  'orchestration',
  'fileRead',
  'fileWrite',
  'shell',
  'web',
] as const;

/** Platform defaults (L0) when no level expresses an opinion. */
export const DEFAULT_AGENT_TOOL_POLICY: AgentToolPolicy = {
  browser: true,
  widgets: true,
  // OFF by default: `write_extension` writes a file tree under the user's
  // extension directory and hot-loads it INTO THE SERVER PROCESS. That is
  // host code execution, so it is a capability an agent must be granted
  // explicitly (agent tool policy → extensionAuthoring), never inherited.
  extensionAuthoring: false,
  orchestration: false,
  fileRead: true,
  fileWrite: true,
  shell: true,
  web: true,
};

export interface AgentRuntimePolicy {
  /** Omit to inherit from the binding site / workflow / server default. */
  model?: string;
  harnessType?: HarnessProviderId;
  reasoningEffort?: ReasoningEffort;
  contextTier?: 'default' | 'long_context';
  maxTurns?: number;
  permissionMode?: AgentPermissionMode;
  defaultAgentMode?: AgentMode;
}

export interface AgentOrchestrationPolicy {
  /** Portable `scope:slug` refs this orchestrator may spawn. Empty = any enabled non-orchestrator agent. */
  teamAgentRefs: string[];
  maxWorkers?: number;
  defaultWorkerModel?: string;
}

export interface Agent {
  id: string;
  scope: AgentScope;
  /** '' for system/global scope. Never null — SQLite treats NULL as distinct in UNIQUE indexes. */
  projectId: string;
  slug: string;
  /** Derived `${scope}:${slug}` — the PORTABLE binding identifier. */
  ref: string;
  name: string;
  /** Required (>= 10 chars). This is the delegation routing signal on both SDKs. */
  description: string;
  instructions: string;
  role: AgentRole;
  projection: AgentProjectionMode;
  icon?: string;
  color?: string;
  tags: string[];
  enabled: boolean;

  /** Catalog artifact ids (system_configs / project_configs rows of type 'skill'). */
  skillIds: string[];
  /** Ids from the vetted MCP registry only — never inline server definitions. */
  mcpServerIds: string[];
  tools: Partial<AgentToolPolicy>;
  runtime: AgentRuntimePolicy;
  orchestration?: AgentOrchestrationPolicy;

  /** Monotonic; bumped on every mutation. Part of the conversation binding key. */
  version: number;
  /** Set when the agent was synced from a `.agent.md` file on disk. */
  sourcePath?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentParams {
  scope?: AgentScope;
  projectId?: string;
  slug?: string;
  name: string;
  description: string;
  instructions: string;
  role?: AgentRole;
  projection?: AgentProjectionMode;
  icon?: string;
  color?: string;
  tags?: string[];
  enabled?: boolean;
  skillIds?: string[];
  mcpServerIds?: string[];
  tools?: Partial<AgentToolPolicy>;
  runtime?: AgentRuntimePolicy;
  orchestration?: AgentOrchestrationPolicy;
  sourcePath?: string;
}

export type UpdateAgentParams = Partial<Omit<CreateAgentParams, 'scope' | 'projectId'>> & {
  scope?: AgentScope;
  projectId?: string;
};

/**
 * Additive delta a binding site (chat / stage) applies on top of an agent.
 * Capability lists UNION; removals always win.
 */
export interface AgentOverrides {
  addSkillIds?: string[];
  removeSkillIds?: string[];
  addMcpServerIds?: string[];
  removeMcpServerIds?: string[];
  tools?: Partial<AgentToolPolicy>;
  runtime?: Partial<AgentRuntimePolicy>;
  appendInstructions?: string;
  /** Provider-neutral extra tool names to allow / deny. Deny always wins. */
  extraAllow?: string[];
  extraDeny?: string[];
}

export type ResolutionWarningCode =
  | 'FIELD_UNSUPPORTED_BY_PROVIDER'
  | 'SKILL_NOT_FOUND'
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_SERVER_NEEDS_CONFIGURATION'
  | 'MCP_SERVER_DISABLED'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_DISABLED'
  | 'STAGING_BUDGET_EXCEEDED'
  | 'INSTRUCTIONS_LARGE'
  | 'TEAM_AGENT_DISABLED'
  | 'TEAM_AGENT_NOT_FOUND';

/**
 * Machine-readable warning. Core never emits user-facing English — the
 * presentation layer maps `code` + `params` to copy (layering rule).
 */
export interface ResolutionWarning {
  code: ResolutionWarningCode;
  params: Record<string, string | number>;
}

/** A resolved skill reference: catalog id, provider-facing name, on-disk path. */
export interface ResolvedSkillRef {
  id: string;
  name: string;
  filePath: string;
  source: 'system' | 'project';
}

/** A team agent projected as a delegatable sub-agent. */
export interface ResolvedTeamAgent {
  ref: string;
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
  skills?: string[];
  maxTurns?: number;
  permissionMode?: AgentPermissionMode;
}

export interface ResolvedAgentProjection {
  agentRef?: string;
  agentId?: string;
  agentVersion?: number;

  /** null = no agent bound (pre-Agents behaviour). */
  driving: {
    ref: string;
    name: string;
    description: string;
    instructions: string;
    projection: AgentProjectionMode;
    role: AgentRole;
  } | null;

  /** Delegatable sub-agents. Orchestrator-only in v1. */
  team: ResolvedTeamAgent[];

  skills: {
    ids: string[];
    names: string[];
    directories: string[];
    disabledNames: string[];
    refs: ResolvedSkillRef[];
  };

  /** Server name → config. Values come from the vetted registry only. */
  mcpServers: Record<string, unknown>;

  toolPolicy: {
    allow: string[];
    deny: string[];
    groups: AgentToolPolicy;
  };

  runtime: AgentRuntimePolicy;

  warnings: ResolutionWarning[];
}

/** Build the portable ref for an agent. */
export function agentRef(scope: AgentScope, slug: string): string {
  return `${scope}:${slug}`;
}

/** Parse a `scope:slug` ref. Returns null when the string is not a valid ref. */
export function parseAgentRef(ref: string): { scope: AgentScope; slug: string } | null {
  const idx = ref.indexOf(':');
  if (idx <= 0) return null;
  const scope = ref.slice(0, idx);
  const slug = ref.slice(idx + 1);
  if (scope !== 'system' && scope !== 'global' && scope !== 'project') return null;
  if (!slug) return null;
  return { scope, slug };
}

export const AGENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Derive a valid slug from a display name. */
export function slugifyAgentName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length >= 2 ? base : `agent-${base}`.slice(0, 64);
}

/** Hard cap on instruction size; anything larger is rejected at save time. */
export const AGENT_INSTRUCTIONS_MAX_BYTES = 32 * 1024;
/** Soft cap — above this the editor and resolver warn about context cost. */
export const AGENT_INSTRUCTIONS_WARN_BYTES = 8 * 1024;
