// ────────────────────────────────────────────────────────────────
// Agent presentation helpers.
//
// `packages/core` deliberately emits machine-readable ResolutionWarning
// objects and NEVER user-facing English (layering rule — core must stay
// free of presentation concerns). This module is the web app's copy table.
// ────────────────────────────────────────────────────────────────

import type { ResolutionWarning, AgentToolPolicy, AgentScope, AgentRole } from '@generatorai/shared';

const COPY: Record<ResolutionWarning['code'], (p: Record<string, string | number>) => string> = {
  FIELD_UNSUPPORTED_BY_PROVIDER: (p) =>
    `"${p['field']}" is not supported by the ${p['provider'] ?? 'selected'} provider and will be ignored.`,
  SKILL_NOT_FOUND: (p) => `Skill "${p['id']}" was not found in the catalog and will be skipped.`,
  MCP_SERVER_NOT_FOUND: (p) =>
    `MCP server "${p['id']}" was not found in the registry and will be skipped.`,
  AGENT_NOT_FOUND: (p) => `Agent "${p['ref']}" no longer exists — running without an agent.`,
  AGENT_DISABLED: (p) => `Agent "${p['ref']}" is disabled — running without an agent.`,
  STAGING_BUDGET_EXCEEDED: (p) =>
    `Skill staging budget exceeded (${p['limit']}); some skills were not staged.`,
  INSTRUCTIONS_LARGE: (p) =>
    `Instructions are ${p['bytes']} bytes — long instructions consume context on every turn.`,
  TEAM_AGENT_DISABLED: (p) => `Team member "${p['ref']}" is disabled and cannot be delegated to.`,
  TEAM_AGENT_NOT_FOUND: (p) => `Team member "${p['ref']}" was not found and will be skipped.`,
};

/** Render a resolution warning as user-facing copy. */
export function warningText(w: ResolutionWarning): string {
  const fn = COPY[w.code];
  return fn ? fn(w.params ?? {}) : w.code;
}

/** Warnings that indicate the binding silently lost something. */
export function isBlockingWarning(w: ResolutionWarning): boolean {
  return w.code === 'AGENT_NOT_FOUND' || w.code === 'AGENT_DISABLED';
}

export const TOOL_GROUP_LABELS: Record<keyof AgentToolPolicy, string> = {
  browser: 'Integrated browser',
  widgets: 'Widgets & canvas',
  extensionAuthoring: 'Extension authoring',
  orchestration: 'Orchestration (spawn workers)',
  fileRead: 'Read files',
  fileWrite: 'Write files',
  shell: 'Run shell commands',
  web: 'Web fetch & search',
};

export const TOOL_GROUP_HINTS: Record<keyof AgentToolPolicy, string> = {
  browser: 'Navigate, click, screenshot and inspect pages in the integrated browser.',
  widgets: 'Render and drive interactive widgets on the canvas.',
  extensionAuthoring: 'Write and hot-reload GeneratorAI extensions.',
  orchestration: 'Spawn and supervise background worker agents. Always on for orchestrators.',
  fileRead: 'Read files in the workspace.',
  fileWrite: 'Create and edit files in the workspace.',
  shell: 'Execute terminal commands.',
  web: 'Fetch URLs and run web searches.',
};

export const SCOPE_LABELS: Record<AgentScope, string> = {
  system: 'Built-in',
  global: 'Global',
  project: 'Project',
};

export const ROLE_LABELS: Record<AgentRole, string> = {
  agent: 'Agent',
  orchestrator: 'Orchestrator',
};

/** Tone for a scope badge. Built-ins are read-only, so they read as neutral. */
export function scopeTone(scope: AgentScope): 'neutral' | 'info' | 'success' {
  if (scope === 'system') return 'neutral';
  if (scope === 'project') return 'success';
  return 'info';
}
