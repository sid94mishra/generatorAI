// ────────────────────────────────────────────────────────────────
// agentMarkdown — `.agent.md` parse / serialise
//
// Interoperable with GitHub's `.github/agents/<name>.agent.md` and close to
// Claude's `.claude/agents/*.md`, so an agent authored here can be checked
// into a repo and consumed by either tool.
//
// SECURITY: the document is untrusted (imported from a repo, an upload or a
// paste). Frontmatter is allow-listed field by field; anything not on the list
// is discarded. `x-generatorai` may never set the harness, the scope, the
// enabled flag, or inline MCP server definitions.
// ────────────────────────────────────────────────────────────────

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  Agent,
  AgentProjectionMode,
  AgentRole,
  AgentRuntimePolicy,
  AgentToolPolicy,
} from '@generatorai/shared';
import { ValidationError, AGENT_TOOL_GROUPS, REASONING_EFFORTS, type ReasoningEffort } from '@generatorai/shared';

/** Hard cap. A `.agent.md` is a prompt, not a payload. */
export const AGENT_MARKDOWN_MAX_BYTES = 256 * 1024;

export interface ParsedAgentMarkdown {
  name: string;
  description: string;
  instructions: string;
  slug?: string;
  role: AgentRole;
  projection: AgentProjectionMode;
  icon?: string;
  color?: string;
  tags: string[];
  /** Skill NAMES declared in the document; resolved to ids by the caller. */
  skillNames: string[];
  /** MCP server NAMES declared in the document; resolved to ids by the caller. */
  mcpServerNames: string[];
  tools: Partial<AgentToolPolicy>;
  runtime: AgentRuntimePolicy;
  teamAgentRefs: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function asStringArray(value: unknown, cap = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * The GitHub `tools:` frontmatter uses coarse verbs (`read`, `edit`, `search`).
 * Map them onto our capability groups so an imported agent lands with a
 * meaningful policy instead of an empty one.
 */
function toolVerbsToPolicy(verbs: string[]): Partial<AgentToolPolicy> {
  if (verbs.length === 0) return {};
  const set = new Set(verbs.map((v) => v.toLowerCase()));
  return {
    fileRead: set.has('read') || set.has('search') || set.has('view'),
    fileWrite: set.has('edit') || set.has('write') || set.has('create'),
    shell: set.has('bash') || set.has('shell') || set.has('terminal') || set.has('run'),
    web: set.has('web') || set.has('fetch') || set.has('websearch'),
    browser: set.has('browser'),
  };
}

/** Parse a `.agent.md` document. Throws ValidationError on malformed input. */
export function parseAgentMarkdown(raw: string): ParsedAgentMarkdown {
  if (Buffer.byteLength(raw, 'utf-8') > AGENT_MARKDOWN_MAX_BYTES) {
    throw new ValidationError(
      `Agent document exceeds the ${AGENT_MARKDOWN_MAX_BYTES / 1024} KB limit`,
    );
  }

  const match = FRONTMATTER_RE.exec(raw.replace(/^\uFEFF/, ''));
  if (!match) {
    throw new ValidationError('Agent document must start with a YAML frontmatter block delimited by ---');
  }

  let front: unknown;
  try {
    front = parseYaml(match[1] ?? '', { maxAliasCount: 0 });
  } catch (err) {
    throw new ValidationError(
      `Invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!front || typeof front !== 'object' || Array.isArray(front)) {
    throw new ValidationError('Agent frontmatter must be a YAML mapping');
  }
  const fm = front as Record<string, unknown>;
  const body = (match[2] ?? '').trim();

  const name = asString(fm['name'], 120);
  const description = asString(fm['description'], 2000);
  if (!name) throw new ValidationError('Agent frontmatter is missing `name`');
  if (!description) throw new ValidationError('Agent frontmatter is missing `description`');
  if (!body) throw new ValidationError('Agent document has no instructions body');

  // Extension block. Deliberately narrow — see the SECURITY note above.
  const ext = (fm['x-generatorai'] && typeof fm['x-generatorai'] === 'object' && !Array.isArray(fm['x-generatorai'])
    ? (fm['x-generatorai'] as Record<string, unknown>)
    : {});

  const rawCapabilities =
    ext['capabilities'] && typeof ext['capabilities'] === 'object' && !Array.isArray(ext['capabilities'])
      ? (ext['capabilities'] as Record<string, unknown>)
      : {};
  const capabilities: Partial<AgentToolPolicy> = {};
  for (const group of AGENT_TOOL_GROUPS) {
    const v = rawCapabilities[group];
    if (typeof v === 'boolean') capabilities[group] = v;
  }

  const tools: Partial<AgentToolPolicy> = {
    ...toolVerbsToPolicy(asStringArray(fm['tools'], 40)),
    ...capabilities,
  };

  const runtime: AgentRuntimePolicy = {};
  const model = asString(fm['model'], 200);
  if (model) runtime.model = model;
  const effort = asString(ext['reasoningEffort'], 20);
  if (REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
    runtime.reasoningEffort = effort as ReasoningEffort;
  }
  const permissionMode = asString(ext['permissionMode'], 30);
  if (
    permissionMode === 'default' ||
    permissionMode === 'acceptEdits' ||
    permissionMode === 'bypassPermissions' ||
    permissionMode === 'plan' ||
    permissionMode === 'dontAsk'
  ) {
    runtime.permissionMode = permissionMode;
  }
  const agentMode = asString(ext['defaultAgentMode'], 20);
  if (agentMode === 'auto' || agentMode === 'plan') runtime.defaultAgentMode = agentMode;
  const maxTurns = ext['maxTurns'];
  if (typeof maxTurns === 'number' && Number.isInteger(maxTurns) && maxTurns > 0) {
    runtime.maxTurns = Math.min(maxTurns, 1000);
  }

  const role = asString(ext['role'], 20) === 'orchestrator' ? 'orchestrator' : 'agent';
  const projection = asString(ext['projection'], 20) === 'replace' ? 'replace' : 'append';

  const result: ParsedAgentMarkdown = {
    name,
    description,
    instructions: body,
    role,
    projection,
    tags: asStringArray(ext['tags'], 20),
    skillNames: asStringArray(ext['skills'], 200),
    mcpServerNames: asStringArray(ext['mcpServers'], 100),
    tools,
    runtime,
    teamAgentRefs: role === 'orchestrator' ? asStringArray(ext['team'], 50) : [],
  };
  const slug = asString(ext['slug'], 64);
  if (slug) result.slug = slug;
  const icon = asString(ext['icon'], 64);
  if (icon) result.icon = icon;
  const color = asString(ext['color'], 32);
  if (color) result.color = color;
  return result;
}

/**
 * Serialise an agent back to `.agent.md`. `skillNames` / `mcpServerNames` are
 * supplied by the caller because the entity stores ids, and a file must carry
 * portable names.
 */
export function serialiseAgentMarkdown(
  agent: Agent,
  resolved: { skillNames: string[]; mcpServerNames: string[] },
): string {
  const front: Record<string, unknown> = {
    name: agent.name,
    description: agent.description,
  };
  if (agent.runtime.model) front['model'] = agent.runtime.model;

  const ext: Record<string, unknown> = {
    slug: agent.slug,
    role: agent.role,
    projection: agent.projection,
  };
  if (agent.tags.length) ext['tags'] = agent.tags;
  if (resolved.skillNames.length) ext['skills'] = resolved.skillNames;
  if (resolved.mcpServerNames.length) ext['mcpServers'] = resolved.mcpServerNames;
  if (Object.keys(agent.tools).length) ext['capabilities'] = agent.tools;
  if (agent.runtime.reasoningEffort) ext['reasoningEffort'] = agent.runtime.reasoningEffort;
  if (agent.runtime.permissionMode) ext['permissionMode'] = agent.runtime.permissionMode;
  if (agent.runtime.defaultAgentMode) ext['defaultAgentMode'] = agent.runtime.defaultAgentMode;
  if (agent.runtime.maxTurns) ext['maxTurns'] = agent.runtime.maxTurns;
  if (agent.icon) ext['icon'] = agent.icon;
  if (agent.color) ext['color'] = agent.color;
  if (agent.orchestration?.teamAgentRefs.length) ext['team'] = agent.orchestration.teamAgentRefs;
  front['x-generatorai'] = ext;

  return `---\n${stringifyYaml(front).trimEnd()}\n---\n\n${agent.instructions.trim()}\n`;
}
