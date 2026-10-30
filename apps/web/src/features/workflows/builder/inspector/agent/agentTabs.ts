// ────────────────────────────────────────────────────────────────
// The agent-stage inspector's tabs (WorkflowStage* boards): Prompt ·
// Session · Tools · Output · Policy · Hooks, and which stage fields each
// tab edits — so a tab shows the error dot of the issues it can fix
// (WorkflowValidate board).
// ────────────────────────────────────────────────────────────────

import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';

export const AGENT_TABS = ['prompt', 'session', 'tools', 'output', 'policy', 'hooks'] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

export const AGENT_TAB_LABELS: Record<AgentTab, string> = {
  prompt: 'Prompt',
  session: 'Session',
  tools: 'Tools',
  output: 'Output',
  policy: 'Policy',
  hooks: 'Hooks',
};

/** Session fields the Tools tab edits (skills, MCP servers, platform toggles). */
export const TOOL_SESSION_FIELDS = [
  '/session/skills',
  '/session/mcp',
  '/session/browser',
  '/session/computerUse',
  '/session/widgets',
  '/session/agentOverrides/addSkillIds',
] as const;

/** The stage fields (JSON pointers) each tab edits; a field under one of them belongs to the tab. */
const TAB_FIELDS: Record<AgentTab, readonly string[]> = {
  prompt: ['/name', '/key', '/description', '/parentKey', '/context', '/prompts', '/followUpPrompts', '/sessionReuse', '/compactAfter'],
  session: ['/session', '/sessionGroup'],
  tools: TOOL_SESSION_FIELDS,
  output: ['/output', '/repair'],
  policy: ['/approval', '/join', '/guard', '/expands', '/timeouts', '/budget', '/retry', '/onExhausted', '/compensate'],
  hooks: ['/hooks'],
};

function under(field: string, prefix: string): boolean {
  return field === prefix || field.startsWith(`${prefix}/`);
}

/** Whether a field pointer is a tool-tab session field. */
export function isToolField(field: string | undefined): boolean {
  return !!field && TOOL_SESSION_FIELDS.some((p) => under(field, p));
}

/** The tab whose controls edit `field` (Tools wins over Session for the tool toggles). */
export function tabOfField(field: string | undefined): AgentTab | undefined {
  if (!field) return undefined;
  if (isToolField(field)) return 'tools';
  return AGENT_TABS.find((tab) => tab !== 'tools' && TAB_FIELDS[tab].some((p) => under(field, p)));
}

/** Tabs with at least one error issue. */
export function tabsWithErrors(issues: readonly BuilderIssue[]): Set<AgentTab> {
  const out = new Set<AgentTab>();
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    const tab = tabOfField(issue.field);
    if (tab) out.add(tab);
  }
  return out;
}

export function isAgentTab(tab: string | undefined): tab is AgentTab {
  return (AGENT_TABS as readonly string[]).includes(tab ?? '');
}
