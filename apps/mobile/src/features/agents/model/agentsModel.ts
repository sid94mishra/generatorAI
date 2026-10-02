// Agents rules (MAgents … MAgentDelete; 04 §2.7; M7-03). Pure, unit-tested: list filters and rows, menus, the editor
// draft (identity, instructions, role, runtime, team, skills / MCP, tri-state capabilities), its change count,
// validation and the create / update bodies, "start from" seeds, and the delete dialog's wording.
import type { Agent, AgentToolPolicy, AgentRuntimePolicy, CreateAgentParams, UpdateAgentParams } from '@generatorai/shared';
import { AGENT_INSTRUCTIONS_MAX_BYTES, AGENT_INSTRUCTIONS_WARN_BYTES, AGENT_SLUG_PATTERN, slugifyAgentName } from '@generatorai/shared';

/** The list rows carry the full agent on the wire; the client type names only the summary, so the rest is optional. */
export interface AgentListItem {
  id: string;
  ref: string;
  scope: 'system' | 'global' | 'project';
  slug: string;
  name: string;
  description: string;
  role: 'agent' | 'orchestrator';
  enabled: boolean;
  skillIds: string[];
  mcpServerIds: string[];
  version: number;
  projectId?: string;
  runtime?: AgentRuntimePolicy;
  orchestration?: { teamAgentRefs: string[]; maxWorkers?: number; defaultWorkerModel?: string };
  updatedAt?: string;
  tags?: string[];
}

export type AgentScopeFilter = 'all' | 'system' | 'global' | 'project';
export type AgentRoleFilter = 'any' | 'agent' | 'orchestrator';
export type AgentSort = 'name' | 'updated';

export const SCOPE_LABEL: Record<AgentListItem['scope'], string> = { system: 'Built-in', global: 'Global', project: 'Project' };
export const SCOPE_ICON = { system: 'lock', global: 'link', project: 'folder-open' } as const;
export const ROLE_LABEL: Record<AgentListItem['role'], string> = { agent: 'Worker', orchestrator: 'Orchestrator' };
export const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

export function scopeCounts(agents: readonly AgentListItem[]): Record<AgentScopeFilter, number> {
  return {
    all: agents.length,
    system: agents.filter((a) => a.scope === 'system').length,
    global: agents.filter((a) => a.scope === 'global').length,
    project: agents.filter((a) => a.scope === 'project').length,
  };
}

export function filterAgents(agents: readonly AgentListItem[], f: { scope: AgentScopeFilter; role: AgentRoleFilter; query: string; sort: AgentSort }): AgentListItem[] {
  const q = f.query.trim().toLowerCase();
  const list = agents.filter(
    (a) =>
      (f.scope === 'all' || a.scope === f.scope) &&
      (f.role === 'any' || a.role === f.role) &&
      (!q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || a.description.toLowerCase().includes(q)),
  );
  return f.sort === 'updated'
    ? list.sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '') || a.name.localeCompare(b.name))
    : list.sort((a, b) => a.name.localeCompare(b.name));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "claude-sonnet-5 · medium" — only what the row carries (MD-27). */
export function modelLine(runtime: AgentRuntimePolicy | undefined): string | null {
  if (!runtime?.model) return null;
  return runtime.reasoningEffort ? `${runtime.model} · ${runtime.reasoningEffort}` : runtime.model;
}

/** "2 skills · 1 MCP", "team of 3", "read-only" for built-ins. */
export function agentFacts(agent: AgentListItem): string[] {
  const facts: string[] = [];
  if (agent.scope === 'system') facts.push('read-only');
  if (agent.role === 'orchestrator' && agent.orchestration) facts.push(`team of ${agent.orchestration.teamAgentRefs.length}`);
  else {
    if (agent.skillIds.length) facts.push(plural(agent.skillIds.length, 'skill'));
    if (agent.mcpServerIds.length) facts.push(`${agent.mcpServerIds.length} MCP`);
  }
  return facts;
}

export type AgentMenuId = 'edit' | 'duplicate' | 'export' | 'delete';

/** Built-ins are read-only: Duplicate · Export only (MDF-104). Authoring needs `admin:settings`. */
export function agentMenu(agent: Pick<AgentListItem, 'scope'>, canEdit: boolean): Array<{ id: AgentMenuId; label: string; icon: string; destructive?: boolean } | { type: 'separator' }> {
  const builtIn = agent.scope === 'system';
  return [
    ...(canEdit && !builtIn ? [{ id: 'edit' as const, label: 'Edit', icon: 'edit' }] : []),
    ...(canEdit ? [{ id: 'duplicate' as const, label: 'Duplicate', icon: 'copy' }] : []),
    { id: 'export', label: 'Export .agent.md', icon: 'download' },
    ...(canEdit && !builtIn ? [{ type: 'separator' as const }, { id: 'delete' as const, label: 'Delete', icon: 'trash', destructive: true }] : []),
  ];
}

// ── Capabilities ────────────────────────────────────────────────

/** The capability rows in the order the boards draw them (MAgentEdit3, MAgentDetail). */
export const CAPABILITIES: ReadonlyArray<{ key: keyof AgentToolPolicy; label: string; short: string }> = [
  { key: 'fileRead', label: 'Read files', short: 'Read files' },
  { key: 'fileWrite', label: 'Write files', short: 'Write files' },
  { key: 'shell', label: 'Run shell commands', short: 'Shell' },
  { key: 'web', label: 'Web fetch & search', short: 'Web' },
  { key: 'browser', label: 'Integrated browser', short: 'Browser' },
  { key: 'widgets', label: 'Widgets & canvas', short: 'Widgets' },
  { key: 'extensionAuthoring', label: 'Extension authoring', short: 'Extensions' },
  { key: 'orchestration', label: 'Orchestration', short: 'Orchestration' },
  { key: 'workflows', label: 'Run workflows', short: 'Workflows' },
  { key: 'workflowAuthoring', label: 'Author workflows', short: 'Workflow authoring' },
];

export type TriState = 'inherit' | 'on' | 'off';

export function triOf(tools: Partial<AgentToolPolicy>, key: keyof AgentToolPolicy): TriState {
  const v = tools[key];
  return v === undefined ? 'inherit' : v ? 'on' : 'off';
}

export function withTri(tools: Partial<AgentToolPolicy>, key: keyof AgentToolPolicy, value: TriState): Partial<AgentToolPolicy> {
  const next = { ...tools };
  if (value === 'inherit') delete next[key];
  else next[key] = value === 'on';
  return next;
}

// ── Editor draft ────────────────────────────────────────────────

export interface AgentDraft {
  name: string;
  slug: string;
  /** True once the user typed a slug; until then it follows the name. */
  slugTouched: boolean;
  description: string;
  scope: 'global' | 'project';
  projectId: string | null;
  tags: string[];
  enabled: boolean;
  instructions: string;
  projection: 'append' | 'replace';
  role: 'agent' | 'orchestrator';
  harnessType: string | null;
  model: string | null;
  reasoningEffort: string | null;
  contextTier: 'default' | 'long_context' | null;
  maxTurns: number | null;
  team: string[];
  maxWorkers: number | null;
  defaultWorkerModel: string | null;
  skillIds: string[];
  mcpServerIds: string[];
  tools: Partial<AgentToolPolicy>;
}

export const BLANK_DRAFT: AgentDraft = {
  name: '',
  slug: '',
  slugTouched: false,
  description: '',
  scope: 'global',
  projectId: null,
  tags: [],
  enabled: true,
  instructions: '',
  projection: 'append',
  role: 'agent',
  harnessType: null,
  model: null,
  reasoningEffort: null,
  contextTier: null,
  maxTurns: null,
  team: [],
  maxWorkers: null,
  defaultWorkerModel: null,
  skillIds: [],
  mcpServerIds: [],
  tools: {},
};

export function draftFrom(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    slug: agent.slug,
    slugTouched: true,
    description: agent.description,
    scope: agent.scope === 'project' ? 'project' : 'global',
    projectId: agent.projectId || null,
    tags: [...agent.tags],
    enabled: agent.enabled,
    instructions: agent.instructions,
    projection: agent.projection,
    role: agent.role,
    harnessType: agent.runtime.harnessType ?? null,
    model: agent.runtime.model ?? null,
    reasoningEffort: agent.runtime.reasoningEffort ?? null,
    contextTier: agent.runtime.contextTier ?? null,
    maxTurns: agent.runtime.maxTurns ?? null,
    team: [...(agent.orchestration?.teamAgentRefs ?? [])],
    maxWorkers: agent.orchestration?.maxWorkers ?? null,
    defaultWorkerModel: agent.orchestration?.defaultWorkerModel ?? null,
    skillIds: [...agent.skillIds],
    mcpServerIds: [...agent.mcpServerIds],
    tools: { ...agent.tools },
  };
}

/** A duplicate starts from the agent under a new name and slug, always editable (a built-in becomes global). */
export function duplicateDraft(agent: Agent, scope: 'global' | 'project' = agent.scope === 'project' ? 'project' : 'global', projectId: string | null = agent.projectId || null): AgentDraft {
  const name = `${agent.name} copy`;
  return { ...draftFrom(agent), name, slug: slugifyAgentName(name), slugTouched: false, scope, projectId: scope === 'project' ? projectId : null };
}

export function withName(draft: AgentDraft, name: string): AgentDraft {
  return { ...draft, name, ...(draft.slugTouched ? {} : { slug: slugifyAgentName(name || 'agent') }) };
}

export function instructionsBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function validateDraft(draft: AgentDraft, takenSlugs: ReadonlySet<string> = new Set()): Partial<Record<'name' | 'slug' | 'description' | 'instructions' | 'projectId', string>> {
  const errors: Partial<Record<'name' | 'slug' | 'description' | 'instructions' | 'projectId', string>> = {};
  if (!draft.name.trim()) errors.name = 'Give the agent a name.';
  if (!AGENT_SLUG_PATTERN.test(draft.slug)) errors.slug = 'Use 2–64 lowercase letters, digits and hyphens.';
  else if (takenSlugs.has(draft.slug)) errors.slug = 'Another agent in this scope uses this slug.';
  if (draft.description.trim().length < 10) errors.description = 'At least 10 characters — it tells the model when to use this agent.';
  if (!draft.instructions.trim()) errors.instructions = 'Write the instructions.';
  else if (instructionsBytes(draft.instructions) > AGENT_INSTRUCTIONS_MAX_BYTES) errors.instructions = `Over the ${AGENT_INSTRUCTIONS_MAX_BYTES / 1024} KB limit.`;
  if (draft.scope === 'project' && !draft.projectId) errors.projectId = 'Choose the project.';
  return errors;
}

export function instructionsLevel(text: string): 'ok' | 'warn' | 'error' {
  const bytes = instructionsBytes(text);
  if (bytes > AGENT_INSTRUCTIONS_MAX_BYTES) return 'error';
  return bytes > AGENT_INSTRUCTIONS_WARN_BYTES ? 'warn' : 'ok';
}

function runtimeOf(d: AgentDraft): AgentRuntimePolicy {
  return {
    ...(d.harnessType ? { harnessType: d.harnessType as AgentRuntimePolicy['harnessType'] } : {}),
    ...(d.model ? { model: d.model } : {}),
    ...(d.reasoningEffort ? { reasoningEffort: d.reasoningEffort as AgentRuntimePolicy['reasoningEffort'] } : {}),
    ...(d.contextTier ? { contextTier: d.contextTier } : {}),
    ...(d.maxTurns ? { maxTurns: d.maxTurns } : {}),
  };
}

export function createBody(d: AgentDraft): CreateAgentParams {
  return {
    scope: d.scope,
    ...(d.scope === 'project' && d.projectId ? { projectId: d.projectId } : {}),
    slug: d.slug,
    name: d.name.trim(),
    description: d.description.trim(),
    instructions: d.instructions,
    role: d.role,
    projection: d.projection,
    tags: d.tags,
    enabled: d.enabled,
    skillIds: d.skillIds,
    mcpServerIds: d.mcpServerIds,
    tools: d.tools,
    runtime: runtimeOf(d),
    ...(d.role === 'orchestrator'
      ? { orchestration: { teamAgentRefs: d.team, ...(d.maxWorkers ? { maxWorkers: d.maxWorkers } : {}), ...(d.defaultWorkerModel ? { defaultWorkerModel: d.defaultWorkerModel } : {}) } }
      : {}),
  };
}

/** The full desired state (PUT replaces these fields); scope and project never change in place. */
export function updateBody(d: AgentDraft): UpdateAgentParams {
  const { scope: _scope, projectId: _projectId, ...rest } = createBody(d);
  return rest;
}

const DRAFT_FIELDS: ReadonlyArray<keyof AgentDraft> = [
  'name', 'slug', 'description', 'scope', 'projectId', 'tags', 'enabled', 'instructions', 'projection', 'role', 'harnessType', 'model', 'reasoningEffort', 'contextTier', 'maxTurns', 'team', 'maxWorkers', 'defaultWorkerModel', 'skillIds', 'mcpServerIds', 'tools',
];

/** How many fields differ ("3 changes"); capabilities count per changed row. */
export function changeCount(saved: AgentDraft, draft: AgentDraft): number {
  let n = 0;
  for (const key of DRAFT_FIELDS) {
    if (key === 'tools') {
      for (const c of CAPABILITIES) if (triOf(saved.tools, c.key) !== triOf(draft.tools, c.key)) n += 1;
    } else if (JSON.stringify(saved[key]) !== JSON.stringify(draft[key])) n += 1;
  }
  return n;
}

// ── Delete (MAgentDelete) ───────────────────────────────────────

export interface UsageLike {
  chats: ReadonlyArray<{ id: string; name: string }>;
  stages: ReadonlyArray<{ id: string; name: string; workflowDefinitionId: string }>;
  workflows: ReadonlyArray<{ id: string; name: string }>;
}

/** Workflows using it (direct or through a stage), de-duplicated. */
export function usedWorkflows(usage: UsageLike): Array<{ id: string; name: string; stage?: string }> {
  const out = new Map<string, { id: string; name: string; stage?: string }>();
  for (const w of usage.workflows) out.set(w.id, { id: w.id, name: w.name });
  for (const s of usage.stages) if (!out.has(s.workflowDefinitionId)) out.set(s.workflowDefinitionId, { id: s.workflowDefinitionId, name: s.name, stage: s.name });
  return [...out.values()];
}

/** Not in use → a real delete; in use → a soft delete labelled for what it does (MDF-29, MDF-104). */
export function deleteDialog(name: string, usage: UsageLike | null): { title: string; message: string; impact: string[]; confirmLabel: string; force: boolean } {
  const workflows = usage ? usedWorkflows(usage) : [];
  const chats = usage?.chats ?? [];
  if (!workflows.length && !chats.length) {
    return { title: `Delete “${name}”?`, message: `${name} is removed from every picker. This can't be undone.`, impact: [], confirmLabel: 'Delete agent', force: false };
  }
  const impact = [
    ...(workflows.length ? [`${plural(workflows.length, 'workflow')}: ${workflows.map((w) => w.name).join(', ')}`] : []),
    ...(chats.length ? [`${plural(chats.length, 'chat')}: ${chats.map((c) => c.name).join(', ')}`] : []),
  ];
  return {
    title: `Disable “${name}”?`,
    message: `${name} is in use, so it will be disabled instead of erased. Those chats and stages keep a frozen snapshot and keep running; it disappears from pickers and new bindings.`,
    impact,
    confirmLabel: 'Disable agent',
    force: true,
  };
}
