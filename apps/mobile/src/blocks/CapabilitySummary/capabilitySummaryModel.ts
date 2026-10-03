// MB-46 CapabilitySummary rules (03 MB-46): what an agent can do once resolved — the runtime line, the tool grid,
// skills and MCP names, and the warnings in words. Pure, unit-tested.
import type { AgentToolPolicy, ResolutionWarning, ResolvedAgentProjection } from '@generatorai/shared';

export const TOOL_LABELS: ReadonlyArray<{ key: keyof AgentToolPolicy; label: string }> = [
  { key: 'fileRead', label: 'Read files' },
  { key: 'fileWrite', label: 'Write files' },
  { key: 'shell', label: 'Shell' },
  { key: 'web', label: 'Web' },
  { key: 'widgets', label: 'Widgets' },
  { key: 'browser', label: 'Browser' },
  { key: 'extensionAuthoring', label: 'Extensions' },
  { key: 'orchestration', label: 'Orchestration' },
];

const EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max', ultra: 'ultra' };
const HARNESS: Record<string, string> = { 'claude-agent': 'Claude Code', copilot: 'GitHub Copilot', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode' };

export function harnessLabel(type: string | undefined): string | null {
  if (!type) return null;
  return HARNESS[type] ?? type;
}

/** "Claude Code · claude-sonnet-5" and "effort medium · long context · 40 turns" (only what is set). */
export function runtimeLines(runtime: ResolvedAgentProjection['runtime']): { title: string | null; detail: string | null } {
  const title = [harnessLabel(runtime.harnessType), runtime.model].filter(Boolean).join(' · ') || null;
  const detail = [
    runtime.reasoningEffort ? `effort ${EFFORT[runtime.reasoningEffort] ?? runtime.reasoningEffort}` : null,
    runtime.contextTier ? (runtime.contextTier === 'long_context' ? 'long context' : 'default context') : null,
    runtime.maxTurns ? `${runtime.maxTurns} turns` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { title, detail: detail || null };
}

export function toolRows(groups: AgentToolPolicy): Array<{ key: keyof AgentToolPolicy; label: string; on: boolean }> {
  return TOOL_LABELS.map((t) => ({ ...t, on: Boolean(groups[t.key]) }));
}

export function mcpNames(projection: Pick<ResolvedAgentProjection, 'mcpServers'>): string[] {
  return Object.keys(projection.mcpServers ?? {}).sort((a, b) => a.localeCompare(b));
}

export function warningText(w: ResolutionWarning): string {
  const id = String(w.params['id'] ?? w.params['name'] ?? w.params['ref'] ?? '');
  switch (w.code) {
    case 'SKILL_NOT_FOUND':
      return `Skill ${id} isn't installed.`;
    case 'MCP_SERVER_NOT_FOUND':
      return `MCP server ${id} isn't in the registry.`;
    case 'MCP_SERVER_NEEDS_CONFIGURATION':
      return `MCP server ${id} needs a key.`;
    case 'MCP_SERVER_DISABLED':
      return `MCP server ${id} is turned off.`;
    case 'AGENT_NOT_FOUND':
    case 'TEAM_AGENT_NOT_FOUND':
      return `Agent ${id} doesn't exist.`;
    case 'AGENT_DISABLED':
    case 'TEAM_AGENT_DISABLED':
      return `Agent ${id} is disabled.`;
    case 'INSTRUCTIONS_LARGE':
      return 'The instructions are long; they cost context on every turn.';
    case 'STAGING_BUDGET_EXCEEDED':
      return 'Too many skills to stage into the workspace.';
    case 'FIELD_UNSUPPORTED_BY_PROVIDER':
      return `${String(w.params['field'] ?? 'A setting')} isn't supported by ${harnessLabel(String(w.params['provider'] ?? '')) ?? 'this provider'}.`;
    default:
      return String(w.code);
  }
}

/** The compact form's line: "5 tools · 2 skills · 1 MCP". */
export function capabilityCounts(projection: Pick<ResolvedAgentProjection, 'toolPolicy' | 'skills' | 'mcpServers'>): string {
  const tools = toolRows(projection.toolPolicy.groups).filter((t) => t.on).length;
  const skills = projection.skills.names.length;
  const mcp = mcpNames(projection).length;
  return `${tools} tool${tools === 1 ? '' : 's'} · ${skills} skill${skills === 1 ? '' : 's'} · ${mcp} MCP`;
}
