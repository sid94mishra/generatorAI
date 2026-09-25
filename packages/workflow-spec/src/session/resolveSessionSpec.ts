// ────────────────────────────────────────────────────────────────
// resolveSessionSpec: the one merge of session layers (G2 §5.2), from
// least to most specific (workflow session, stage session, run overrides).
//
// - scalars: the most specific defined value wins;
// - exclusion lists (tools.excluded, mcp.excludedIds, skills.disabled) and
//   additive lists (skills.directories, agentOverrides add/remove lists,
//   extraAllow/extraDeny) are unioned;
// - mcp.servers and customAgents are merged by key (most specific wins);
// - browser, agentOverrides.tools and agentOverrides.runtime are merged
//   field by field.
// ────────────────────────────────────────────────────────────────

import type { AgentOverrides, SessionSpec } from '../schemas/session.js';

type Layer = SessionSpec | null | undefined;

const SCALARS = [
  'model',
  'harnessType',
  'reasoningEffort',
  'contextTier',
  'maxTurns',
  'provider',
  'agentRef',
  'systemMessage',
  'systemPromptAppend',
  'planModeInstructions',
  'permissionMode',
  'defaultAgentMode',
  'computerUse',
  'widgets',
  'orchestrator',
] as const satisfies ReadonlyArray<keyof SessionSpec>;

function union<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] | undefined {
  if (!a && !b) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

function mergeObjects<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  const out = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (v !== undefined) out[k] = v;
  return out as T;
}

function mergeOverrides(a: AgentOverrides | undefined, b: AgentOverrides | undefined): AgentOverrides | undefined {
  if (!a || !b) return a ?? b ? { ...(a ?? b) } : undefined;
  const out: AgentOverrides = {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)),
  };
  for (const k of ['addSkillIds', 'removeSkillIds', 'addMcpServerIds', 'removeMcpServerIds', 'extraAllow', 'extraDeny'] as const) {
    const u = union(a[k], b[k]);
    if (u) out[k] = u;
  }
  const tools = mergeObjects(a.tools, b.tools);
  if (tools) out.tools = tools;
  const runtime = mergeObjects(a.runtime, b.runtime);
  if (runtime) out.runtime = runtime;
  return out;
}

function mergeTwo(a: SessionSpec, b: SessionSpec): SessionSpec {
  const out: SessionSpec = { ...a };
  for (const k of SCALARS) {
    if (b[k] !== undefined) (out as Record<string, unknown>)[k] = b[k];
  }
  if (a.tools || b.tools) {
    const available = b.tools?.available ?? a.tools?.available;
    const excluded = union(a.tools?.excluded, b.tools?.excluded);
    out.tools = { ...(available ? { available } : {}), ...(excluded ? { excluded } : {}) };
  }
  if (a.mcp || b.mcp) {
    const servers = mergeObjects(a.mcp?.servers, b.mcp?.servers);
    const excludedIds = union(a.mcp?.excludedIds, b.mcp?.excludedIds);
    out.mcp = { ...(servers ? { servers } : {}), ...(excludedIds ? { excludedIds } : {}) };
  }
  if (a.skills || b.skills) {
    const directories = union(a.skills?.directories, b.skills?.directories);
    const disabled = union(a.skills?.disabled, b.skills?.disabled);
    out.skills = { ...(directories ? { directories } : {}), ...(disabled ? { disabled } : {}) };
  }
  if (a.customAgents || b.customAgents) {
    const byName = new Map((a.customAgents ?? []).map((c) => [c.name, c]));
    for (const c of b.customAgents ?? []) byName.set(c.name, c);
    out.customAgents = [...byName.values()];
  }
  const browser = mergeObjects(a.browser, b.browser);
  if (browser) out.browser = browser;
  const overrides = mergeOverrides(a.agentOverrides, b.agentOverrides);
  if (overrides) out.agentOverrides = overrides;
  return out;
}

export function resolveSessionSpec(...layers: Layer[]): SessionSpec {
  let out: SessionSpec = {};
  for (const l of layers) if (l) out = mergeTwo(out, l);
  return out;
}
