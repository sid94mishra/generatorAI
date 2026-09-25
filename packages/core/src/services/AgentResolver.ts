import type { HarnessProviderId } from '@generatorai/shared';
import { isMcpSecretRef, MCP_REDACTED_VALUE } from '@generatorai/shared';
// ────────────────────────────────────────────────────────────────
// AgentResolver — the ONE place capability sets are combined.
//
// Levels, lowest to highest:
//   L0 platform defaults
//   L1 workflow.harnessConfig | chat-level harnessConfig
//   L2 the bound Agent
//   L3 AgentOverrides at the binding site (stage overrides / chat overrides)
//   L4 runtime overrides (run profile, per-turn)
//
// Combination rules (deliberately explicit — `deepMerge` REPLACES arrays,
// which would give "replace" where the product needs "union"):
//   skills / mcp servers  UNION across levels, minus removals
//   tool groups           tri-state fold; an explicit `false` beats a lower `true`
//   allow / deny lists    UNION; deny always beats allow
//   scalars               most-specific-wins
//   instructions          ordered concatenation, PLATFORM BLOCKS FIRST
//
// Do not reintroduce a second merge path.
// ────────────────────────────────────────────────────────────────

import type {
  Agent,
  AgentOverrides,
  AgentRuntimePolicy,
  AgentToolPolicy,
  HarnessConfig,
  ILogger,
  McpServerConfig,
  ResolutionWarning,
  ResolvedAgentProjection,
  ResolvedSkillRef,
  ResolvedTeamAgent,
} from '@generatorai/shared';
import { DEFAULT_AGENT_TOOL_POLICY, AGENT_TOOL_GROUPS, AGENT_INSTRUCTIONS_WARN_BYTES } from '@generatorai/shared';
import type { IAgentRepository } from '../domain/ports/IAgentRepository.js';
import type { ArtifactCatalog } from './ArtifactCatalog.js';

export interface ResolveAgentInput {
  /** Portable `scope:slug` ref of the driving agent. */
  agentRef?: string | undefined;
  overrides?: AgentOverrides | undefined;
  baseHarnessConfig?: Partial<HarnessConfig> | undefined;
  runtimeOverrides?: Partial<HarnessConfig> | undefined;
  projectId?: string | undefined;
  harnessType?: HarnessProviderId | undefined;
  scope: 'chat' | 'stage' | 'worker';
  /**
   * Resolve this in-memory agent instead of loading one. Used by the editor's
   * preview so effective capabilities are visible before the agent is saved.
   */
  inlineAgent?: Agent | undefined;
  /**
   * When supplied, resolution is a pass-through. Resume and replay MUST use the
   * frozen snapshot: resolving live would let an agent edit change the tool set
   * of an in-flight conversation and break the prompt-cache prefix.
   */
  snapshot?: ResolvedAgentProjection | undefined;
}

/**
 * Provider-neutral tool-group → concrete tool-name expansion.
 *
 * These are BUILT-IN tool names, so a denial here is applied through
 * `excludedBuiltinTools` (Copilot `defaultAgent.excludedTools` /
 * Claude `disallowedTools`), never through `excludedTools`.
 *
 * Names are deliberately over-listed: a tool the provider does not expose is
 * harmlessly ignored, whereas a MISSING name silently grants the capability the
 * agent was configured to refuse. Copilot's shell tool, for example, is
 * `powershell` on Windows and `bash` elsewhere.
 */
const GROUP_TOOL_NAMES: Record<keyof AgentToolPolicy, { copilot: string[]; claude: string[] }> = {
  browser: { copilot: [], claude: [] },
  widgets: { copilot: [], claude: [] },
  extensionAuthoring: { copilot: [], claude: [] },
  orchestration: { copilot: [], claude: [] },
  fileRead: {
    copilot: ['view', 'read_file', 'glob', 'grep'],
    claude: ['Read', 'Glob', 'Grep', 'NotebookRead'],
  },
  fileWrite: {
    copilot: ['create', 'create_file', 'write', 'write_file', 'edit_file', 'str_replace', 'str_replace_editor', 'apply_patch'],
    claude: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'FileWrite', 'FileEdit'],
  },
  shell: {
    copilot: ['bash', 'shell', 'powershell', 'pwsh', 'cmd', 'run_in_terminal'],
    claude: ['Bash', 'PowerShell', 'BashOutput', 'KillShell'],
  },
  web: {
    copilot: ['fetch', 'web_search', 'web_fetch'],
    claude: ['WebFetch', 'WebSearch'],
  },
};

export class AgentResolver {
  constructor(
    private agentRepo: IAgentRepository,
    private catalog: ArtifactCatalog,
    private logger: ILogger,
  ) {}

  async resolve(input: ResolveAgentInput): Promise<ResolvedAgentProjection> {
    if (input.snapshot) return input.snapshot;

    const warnings: ResolutionWarning[] = [];
    const harnessType = input.harnessType ?? 'copilot';

    const agent = await this.loadAgent(input, warnings);

    // ── Skills: UNION across levels, then subtract removals ──
    const skillIds = new Set<string>();
    for (const id of input.baseHarnessConfig?.agentOverrides?.addSkillIds ?? []) skillIds.add(id);
    for (const id of agent?.skillIds ?? []) skillIds.add(id);
    for (const id of input.overrides?.addSkillIds ?? []) skillIds.add(id);
    for (const id of input.runtimeOverrides?.agentOverrides?.addSkillIds ?? []) skillIds.add(id);
    for (const id of [
      ...(input.baseHarnessConfig?.agentOverrides?.removeSkillIds ?? []),
      ...(input.overrides?.removeSkillIds ?? []),
      ...(input.runtimeOverrides?.agentOverrides?.removeSkillIds ?? []),
    ]) {
      skillIds.delete(id);
    }

    // ── MCP servers ──
    // Rule (see packages/core/src/mcp/mergeMcpServers.ts for the full statement):
    //   baseline = every globally-enabled, fully-configured system/custom
    //              server ∪ every enabled project server
    //   explicit = agent.mcpServerIds ∪ addMcpServerIds (all levels)
    //   result   = (baseline ∪ explicit) − removeMcpServerIds − excludedMcpServerIds
    // A chat with NO agent therefore still gets the baseline; the caller
    // merges inline `harnessConfig.mcpServers` LAST. A server switched OFF in
    // Settings is a kill switch: it is never sent, even when an agent lists it
    // (the agent gets an MCP_SERVER_DISABLED warning instead of a silent drop).
    const explicitMcpIds = new Set<string>();
    for (const id of input.baseHarnessConfig?.agentOverrides?.addMcpServerIds ?? []) explicitMcpIds.add(id);
    for (const id of agent?.mcpServerIds ?? []) explicitMcpIds.add(id);
    for (const id of input.overrides?.addMcpServerIds ?? []) explicitMcpIds.add(id);
    for (const id of input.runtimeOverrides?.agentOverrides?.addMcpServerIds ?? []) explicitMcpIds.add(id);
    const removedMcpIds = new Set<string>([
      ...(input.baseHarnessConfig?.agentOverrides?.removeMcpServerIds ?? []),
      ...(input.overrides?.removeMcpServerIds ?? []),
      ...(input.runtimeOverrides?.agentOverrides?.removeMcpServerIds ?? []),
      ...(input.baseHarnessConfig?.excludedMcpServerIds ?? []),
      ...(input.runtimeOverrides?.excludedMcpServerIds ?? []),
    ]);

    const [skills, mcpServers] = await Promise.all([
      this.resolveSkills([...skillIds], input.projectId, warnings),
      this.resolveMcpServers([...explicitMcpIds], removedMcpIds, input.projectId, warnings),
    ]);

    // ── Tool groups: tri-state fold, `false` wins at the highest level that sets it ──
    const groups = this.foldToolPolicy(
      [
        input.baseHarnessConfig?.agentOverrides?.tools,
        agent?.tools,
        input.overrides?.tools,
        input.runtimeOverrides?.agentOverrides?.tools,
      ],
      agent?.role === 'orchestrator',
    );

    // ── Allow / deny: UNION; deny wins at projection time ──
    const allow = new Set<string>([
      ...(input.baseHarnessConfig?.agentOverrides?.extraAllow ?? []),
      ...(input.overrides?.extraAllow ?? []),
      ...(input.runtimeOverrides?.agentOverrides?.extraAllow ?? []),
    ]);
    const deny = new Set<string>([
      ...(input.baseHarnessConfig?.agentOverrides?.extraDeny ?? []),
      ...(input.overrides?.extraDeny ?? []),
      ...(input.runtimeOverrides?.agentOverrides?.extraDeny ?? []),
    ]);
    // A capability group turned OFF becomes a concrete deny-list for the target
    // provider; the group's tools are named differently on each.
    for (const group of AGENT_TOOL_GROUPS) {
      if (groups[group]) continue;
      const names = harnessType === 'claude-agent'
        ? GROUP_TOOL_NAMES[group].claude
        : GROUP_TOOL_NAMES[group].copilot;
      for (const n of names) deny.add(n);
    }
    for (const d of deny) allow.delete(d);

    // ── Scalars: most-specific-wins ──
    const runtime = this.foldRuntime([
      this.runtimeFromHarnessConfig(input.baseHarnessConfig),
      agent?.runtime,
      input.overrides?.runtime,
      input.runtimeOverrides?.agentOverrides?.runtime,
      this.runtimeFromHarnessConfig(input.runtimeOverrides),
    ]);

    // ── Instructions: ordered concatenation; the agent block goes LAST ──
    const instructionParts: string[] = [];
    if (agent) instructionParts.push(agent.instructions.trim());
    const appended = [
      input.overrides?.appendInstructions,
      input.runtimeOverrides?.agentOverrides?.appendInstructions,
    ].filter((s): s is string => !!s && s.trim().length > 0);
    for (const extra of appended) instructionParts.push(extra.trim());
    const instructions = instructionParts.join('\n\n');
    if (Buffer.byteLength(instructions, 'utf-8') > AGENT_INSTRUCTIONS_WARN_BYTES) {
      warnings.push({
        code: 'INSTRUCTIONS_LARGE',
        params: { bytes: Buffer.byteLength(instructions, 'utf-8') },
      });
    }

    const team = agent?.role === 'orchestrator'
      ? await this.resolveTeam(agent, input.projectId, warnings)
      : [];

    return {
      ...(agent ? { agentRef: agent.ref, agentId: agent.id, agentVersion: agent.version } : {}),
      driving: agent
        ? {
            ref: agent.ref,
            name: agent.name,
            description: agent.description,
            instructions,
            projection: agent.projection,
            role: agent.role,
          }
        : null,
      team,
      skills: {
        ids: skills.map((s) => s.id),
        names: skills.map((s) => s.name),
        directories: [],
        disabledNames: [],
        refs: skills,
      },
      mcpServers,
      toolPolicy: { allow: [...allow], deny: [...deny], groups },
      runtime,
      warnings,
    };
  }

  /**
   * An empty projection — the SYNCHRONOUS fallback for callers that have no
   * resolver wired at all.
   *
   * It carries NO MCP servers, so a caller that has a resolver must not
   * short-circuit to this when no agent is bound: call `resolve({ scope,
   * projectId })` with no `agentRef` instead, which returns the project +
   * globally-enabled baseline (see `resolveMcpServers`). Falling back to
   * `empty()` was why a chat without an agent got zero MCP servers.
   */
  static empty(): ResolvedAgentProjection {
    return {
      driving: null,
      team: [],
      skills: { ids: [], names: [], directories: [], disabledNames: [], refs: [] },
      mcpServers: {},
      toolPolicy: { allow: [], deny: [], groups: { ...DEFAULT_AGENT_TOOL_POLICY } },
      runtime: {},
      warnings: [],
    };
  }

  private async loadAgent(
    input: ResolveAgentInput,
    warnings: ResolutionWarning[],
  ): Promise<Agent | null> {
    if (input.inlineAgent) return input.inlineAgent;
    const ref = input.agentRef ?? input.baseHarnessConfig?.agentRef;
    if (ref) {
      const found = await this.agentRepo.getByRef(ref);
      if (!found) {
        warnings.push({ code: 'AGENT_NOT_FOUND', params: { ref } });
        return null;
      }
      if (!found.enabled) {
        warnings.push({ code: 'AGENT_DISABLED', params: { ref } });
        return null;
      }
      return found;
    }
    return null;
  }

  private async resolveSkills(
    ids: string[],
    projectId: string | undefined,
    warnings: ResolutionWarning[],
  ): Promise<ResolvedSkillRef[]> {
    if (ids.length === 0) return [];
    const catalog = await this.catalog.listSkills(projectId);
    const byId = new Map(catalog.map((s) => [s.id, s]));
    const out: ResolvedSkillRef[] = [];
    for (const id of ids) {
      const hit = byId.get(id);
      if (!hit) {
        warnings.push({ code: 'SKILL_NOT_FOUND', params: { id } });
        continue;
      }
      out.push({ id: hit.id, name: hit.name, filePath: hit.filePath, source: hit.source });
    }
    return out;
  }

  /**
   * baseline ∪ explicit − removed, keyed by server NAME (what the harness
   * exposes). Only `enabled` catalog entries (user toggle on AND fully
   * configured) are ever returned; an explicit id that is not usable gets a
   * warning so the drop is visible.
   */
  private async resolveMcpServers(
    explicitIds: string[],
    removedIds: Set<string>,
    projectId: string | undefined,
    warnings: ResolutionWarning[],
  ): Promise<Record<string, McpServerConfig>> {
    const catalog = await this.catalog.listMcpServers(projectId);
    const byId = new Map(catalog.map((s) => [s.id, s]));
    const chosen = new Map<string, (typeof catalog)[number]>();

    for (const s of catalog) if (s.enabled) chosen.set(s.id, s);

    for (const id of explicitIds) {
      const hit = byId.get(id);
      if (!hit) {
        warnings.push({ code: 'MCP_SERVER_NOT_FOUND', params: { id } });
        continue;
      }
      if (hit.needsConfiguration) {
        warnings.push({
          code: 'MCP_SERVER_NEEDS_CONFIGURATION',
          params: {
            id,
            missing: [...hit.needsConfiguration.missingInputs, ...hit.needsConfiguration.missingCredentials].join(','),
          },
        });
        continue;
      }
      if (!hit.enabled) {
        warnings.push({ code: 'MCP_SERVER_DISABLED', params: { id } });
        continue;
      }
      chosen.set(id, hit);
    }

    for (const id of removedIds) chosen.delete(id);

    const out: Record<string, McpServerConfig> = {};
    for (const s of chosen.values()) out[s.name] = s.config;
    return out;
  }

  private async resolveTeam(
    orchestrator: Agent,
    projectId: string | undefined,
    warnings: ResolutionWarning[],
  ): Promise<ResolvedTeamAgent[]> {
    const refs = orchestrator.orchestration?.teamAgentRefs ?? [];
    if (refs.length === 0) return [];
    const out: ResolvedTeamAgent[] = [];
    for (const ref of refs) {
      const member = await this.agentRepo.getByRef(ref);
      if (!member) {
        warnings.push({ code: 'TEAM_AGENT_NOT_FOUND', params: { ref } });
        continue;
      }
      if (!member.enabled) {
        warnings.push({ code: 'TEAM_AGENT_DISABLED', params: { ref } });
        continue;
      }
      if (member.role === 'orchestrator') continue; // recursion guard
      const skills = await this.resolveSkills(member.skillIds, projectId, warnings);
      out.push({
        ref: member.ref,
        name: member.slug,
        description: member.description,
        instructions: member.instructions,
        ...(member.runtime.model ? { model: member.runtime.model } : {}),
        ...(member.runtime.reasoningEffort ? { reasoningEffort: member.runtime.reasoningEffort } : {}),
        ...(member.runtime.maxTurns ? { maxTurns: member.runtime.maxTurns } : {}),
        ...(member.runtime.permissionMode ? { permissionMode: member.runtime.permissionMode } : {}),
        ...(skills.length ? { skills: skills.map((s) => s.name) } : {}),
      });
    }
    return out;
  }

  /** Highest level with a defined value wins; `false` at any level sticks. */
  private foldToolPolicy(
    levels: Array<Partial<AgentToolPolicy> | undefined>,
    forceOrchestration: boolean,
  ): AgentToolPolicy {
    const out: AgentToolPolicy = { ...DEFAULT_AGENT_TOOL_POLICY };
    for (const level of levels) {
      if (!level) continue;
      for (const group of AGENT_TOOL_GROUPS) {
        const v = level[group];
        if (typeof v === 'boolean') out[group] = v;
      }
    }
    if (forceOrchestration) out.orchestration = true;
    return out;
  }

  private foldRuntime(levels: Array<AgentRuntimePolicy | undefined>): AgentRuntimePolicy {
    const out: AgentRuntimePolicy = {};
    for (const level of levels) {
      if (!level) continue;
      for (const [k, v] of Object.entries(level)) {
        if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
      }
    }
    return out;
  }

  private runtimeFromHarnessConfig(cfg?: Partial<HarnessConfig>): AgentRuntimePolicy | undefined {
    if (!cfg) return undefined;
    const out: AgentRuntimePolicy = {};
    if (cfg.model) out.model = cfg.model;
    if (cfg.harnessType) out.harnessType = cfg.harnessType;
    if (cfg.reasoningEffort) out.reasoningEffort = cfg.reasoningEffort;
    if (cfg.contextTier) out.contextTier = cfg.contextTier;
    if (cfg.maxTurns) out.maxTurns = cfg.maxTurns;
    if (cfg.permissionMode) out.permissionMode = cfg.permissionMode;
    if (cfg.defaultAgentMode) out.defaultAgentMode = cfg.defaultAgentMode;
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

/**
 * Strip credential material before a projection is persisted as a snapshot,
 * returned from the preview endpoint, or serialised to `.agent.md`.
 */
export function redactProjection(p: ResolvedAgentProjection): ResolvedAgentProjection {
  // Keep the maps' shape and their `secretref:` pointers (they name a
  // secret, they are not one), so a session resumed from the snapshot still
  // gets its credentials injected; only literal values are masked (P02
  // review R2). A server whose map still holds the mask is dropped with a
  // warning at injection rather than started with a bogus value.
  const mask = (map: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(map).map(([k, v]) => [k, isMcpSecretRef(v) ? v : MCP_REDACTED_VALUE]));
  const mcpServers: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(p.mcpServers)) {
    const cfg = raw as McpServerConfig;
    const clone: Record<string, unknown> = { ...cfg };
    if (cfg.env && Object.keys(cfg.env).length > 0) clone['env'] = mask(cfg.env);
    if (cfg.headers && Object.keys(cfg.headers).length > 0) clone['headers'] = mask(cfg.headers);
    mcpServers[name] = clone;
  }
  return { ...p, mcpServers };
}
