// MB-06 New chat model (pure): the sheet's draft (the shared `CreateChatDraft` vocabulary, with the mobile source
// drafts and per-chat agent overrides), what the footer says, why Create is off, and the create body.
import { chatNameFromPrompt, type ChatCreateWho } from '@generatorai/shared/ui-contract';
import { DEFAULT_AGENT_TOOL_POLICY, type AgentToolPolicy } from '@generatorai/shared';

import type { BrowserVisibility } from './browserConfig';
import { buildCreateChatBody, isEmptyOverrides, type AgentOverrides, type CreateChatBody } from './newChatModel';
import type { DraftSource } from './sourceModel';

export interface NewChatDraft {
  /** The task, sent as the first message (MNewChat). */
  prompt: string;
  /** Empty = named from the task. */
  name: string;
  description: string;
  who: ChatCreateWho;
  agentRef?: string;
  /** '' = the server default. */
  model: string;
  effort?: string;
  projectId?: string;
  sources: DraftSource[];
  primaryAlias?: string;
  overrides: AgentOverrides;
  tags: string[];
  browser: BrowserVisibility;
}

export const EMPTY_NEW_CHAT_DRAFT: NewChatDraft = {
  prompt: '',
  name: '',
  description: '',
  who: 'agent',
  model: '',
  sources: [],
  overrides: {},
  tags: [],
  browser: 'headless',
};

/** Create is off with a reason until the task exists (MNewChat validation: "Describe the task"). */
export function createBlocker(draft: Pick<NewChatDraft, 'prompt' | 'who' | 'agentRef'>): string | null {
  if (!draft.prompt.trim()) return 'Describe the task';
  if (draft.who !== 'model' && !draft.agentRef) return draft.who === 'orchestrator' ? 'Choose an orchestrator' : 'Choose an agent';
  return null;
}

/** "1 worktree and 1 branch will be created" — what the server will make for the sources. */
export function sourcesFootnote(sources: readonly Pick<DraftSource, 'mode' | 'branchMode'>[]): string | null {
  const worktrees = sources.filter((s) => s.mode === 'worktree').length;
  const branches = sources.filter((s) => s.branchMode === 'new').length;
  const parts = [worktrees ? `${worktrees} worktree${worktrees === 1 ? '' : 's'}` : null, branches ? `${branches} branch${branches === 1 ? '' : 'es'}` : null].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join(' and ')} will be created`;
}

/** "Bug Fixer · Sonnet 5" / "Sonnet 5" — the footer's summary. */
export function whoSummary(agentName: string | null, modelLabel: string | null): string {
  return [agentName, modelLabel].filter(Boolean).join(' · ') || 'Default model';
}

export function createBody(draft: NewChatDraft): CreateChatBody & { harnessConfig?: { reasoningEffort: string } } {
  const name = draft.name.trim() || chatNameFromPrompt(draft.prompt) || 'New chat';
  const body = buildCreateChatBody({
    name,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    ...(draft.who !== 'model' && draft.agentRef ? { agentRef: draft.agentRef } : {}),
    ...(draft.who === 'orchestrator' ? { orchestratorMode: true } : {}),
    ...(draft.who !== 'model' && !isEmptyOverrides(draft.overrides) ? { agentOverrides: draft.overrides } : {}),
    ...(draft.tags.length ? { tags: draft.tags } : {}),
    ...(draft.sources.length ? { sources: draft.sources } : {}),
    ...(draft.primaryAlias ? { primaryAlias: draft.primaryAlias } : {}),
    browser: { visibility: draft.browser },
  });
  // The chosen effort applies from the first turn (`CreateChatSchema.harnessConfig`).
  return draft.effort ? { ...body, harnessConfig: { reasoningEffort: draft.effort } } : body;
}

/** The 8 per-chat capabilities (MAgentPickerCaps) in board order. */
export const CAPABILITIES: ReadonlyArray<{ key: Exclude<keyof AgentToolPolicy, 'workflows'>; label: string }> = [
  { key: 'fileRead', label: 'Read files' },
  { key: 'fileWrite', label: 'Write files' },
  { key: 'shell', label: 'Run shell commands' },
  { key: 'browser', label: 'Integrated browser' },
  { key: 'web', label: 'Web fetch & search' },
  { key: 'widgets', label: 'Widgets & canvas' },
  { key: 'extensionAuthoring', label: 'Extension authoring' },
  { key: 'orchestration', label: 'Orchestration' },
];

/** The agent's own value for a capability (its partial policy over the default). */
export function agentTool(tools: Partial<AgentToolPolicy> | undefined, key: keyof AgentToolPolicy): boolean {
  return tools?.[key] ?? DEFAULT_AGENT_TOOL_POLICY[key];
}

/** Sets a per-chat capability: kept only when it differs from the agent's own value (so Reset is "remove"). */
export function setToolOverride(overrides: AgentOverrides, key: keyof AgentToolPolicy, value: boolean, base: boolean): AgentOverrides {
  const tools = { ...(overrides.tools ?? {}) };
  if (value === base) delete tools[key];
  else tools[key] = value;
  const next: AgentOverrides = { ...overrides };
  if (Object.keys(tools).length) next.tools = tools;
  else delete next.tools;
  return next;
}

/** "5 skills · 2 MCP · 5 of 8 capabilities" (the caps page footer). */
export function capabilitiesSummary(skills: number, mcp: number, on: number): string {
  return `${skills} skill${skills === 1 ? '' : 's'} · ${mcp} MCP · ${on} of ${CAPABILITIES.length} capabilities`;
}
