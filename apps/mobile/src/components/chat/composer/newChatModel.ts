// ────────────────────────────────────────────────────────────────
// New chat — the values the sheet collects and the body they become.
//
// `buildCreateChatBody` mirrors web's `CreateChatDialog` param assembly
// exactly: `sources` supersedes `codebaseIds`/`useWorktree` (never both),
// `primary` only with sources, browser config only when it differs from the
// server default, `agentOverrides` only when non-empty.
//
// The body is a superset of client-core's `chats.create` input type
// (which predates `sources` / `browserConfig` / `agentOverrides`); the
// server's `CreateChatSchema` accepts all of it.
// ────────────────────────────────────────────────────────────────

import type { AgentMode } from '@generatorai/client-core';
import type { ChatSourceControlOptions } from '@generatorai/shared';

import { pickerValueToBrowserConfig, type BrowserPickerValue } from './browserConfig';
import { draftsToSources, resolvePrimary, type DraftSource } from './sourceModel';

/** `AgentOverridesSchema` — the additive delta on the bound agent. */
export interface AgentOverrides {
  addSkillIds?: string[];
  removeSkillIds?: string[];
  addMcpServerIds?: string[];
  removeMcpServerIds?: string[];
  appendInstructions?: string;
}

export interface NewChatFormValues {
  name: string;
  description?: string;
  model?: string;
  projectId?: string;
  defaultAgentMode?: AgentMode;
  permissionMode?: string;
  orchestratorMode?: boolean;
  /** Portable `scope:slug` ref of the agent driving the chat. */
  agentRef?: string;
  agentOverrides?: AgentOverrides;
  tags?: string[];
  sources?: DraftSource[];
  primaryAlias?: string;
  browser?: BrowserPickerValue;
  /** Agent-native source control: commit / push / PR after every turn. */
  sourceControl?: ChatSourceControlOptions;
}

export interface CreateChatBody {
  name: string;
  description?: string;
  model?: string;
  projectId?: string;
  tags?: string[];
  defaultAgentMode?: AgentMode;
  permissionMode?: string;
  orchestratorMode?: boolean;
  agentRef?: string;
  agentOverrides?: AgentOverrides;
  sources?: ReturnType<typeof draftsToSources>;
  primary?: string;
  browserConfig?: Record<string, unknown>;
  sourceControl?: ChatSourceControlOptions;
}

/** The switches all off — nothing is committed unless the user asks. */
export const NO_SOURCE_CONTROL: ChatSourceControlOptions = {
  autoCommit: false,
  autoPush: false,
  autoPullRequest: false,
};

/**
 * Close the implications and drop the option entirely when nothing commits.
 *
 * A pull request needs a push needs a commit, so turning the last one on
 * turns the earlier ones on rather than sending a combination the server
 * would have to repair. `base` and `draft` only mean something for a PR, so
 * they are not sent without one, and an autoCommit-less object is omitted
 * from the body altogether — absence is how the server reads "manual".
 */
export function normalizeSourceControl(
  options: ChatSourceControlOptions | undefined,
): ChatSourceControlOptions | undefined {
  if (!options) return undefined;
  const autoPullRequest = options.autoPullRequest === true;
  const autoPush = options.autoPush === true || autoPullRequest;
  const autoCommit = options.autoCommit === true || autoPush;
  if (!autoCommit) return undefined;
  const base = options.base?.trim();
  return {
    autoCommit: true,
    autoPush,
    autoPullRequest,
    ...(autoPullRequest && base ? { base } : {}),
    ...(autoPullRequest && options.draft ? { draft: true } : {}),
  };
}

/** The one-line value shown on the picker row. */
export function sourceControlSummary(options: ChatSourceControlOptions | undefined): string {
  const normalized = normalizeSourceControl(options);
  if (!normalized) return 'Off';
  if (normalized.autoPullRequest) return normalized.draft ? 'Commit, push, draft PR' : 'Commit, push, PR';
  if (normalized.autoPush) return 'Commit and push';
  return 'Commit';
}

export function isEmptyOverrides(o: AgentOverrides | undefined): boolean {
  if (!o) return true;
  return Object.values(o).every((v) =>
    Array.isArray(v) ? v.length === 0 : v === undefined || v === '',
  );
}

export function buildCreateChatBody(values: NewChatFormValues): CreateChatBody {
  const name = values.name.trim();
  const sources = draftsToSources(values.sources ?? [], name);
  const primary = resolvePrimary(values.sources ?? [], values.primaryAlias);
  const browserConfig = values.browser ? pickerValueToBrowserConfig(values.browser) : undefined;
  const sourceControl = normalizeSourceControl(values.sourceControl);

  return {
    name,
    ...(values.description?.trim() ? { description: values.description.trim() } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values.projectId ? { projectId: values.projectId } : {}),
    ...(values.tags && values.tags.length > 0 ? { tags: values.tags } : {}),
    ...(values.defaultAgentMode ? { defaultAgentMode: values.defaultAgentMode } : {}),
    ...(values.permissionMode ? { permissionMode: values.permissionMode } : {}),
    ...(values.orchestratorMode ? { orchestratorMode: true } : {}),
    ...(values.agentRef ? { agentRef: values.agentRef } : {}),
    ...(!isEmptyOverrides(values.agentOverrides) ? { agentOverrides: values.agentOverrides } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(sources.length > 0 && primary ? { primary } : {}),
    ...(browserConfig ? { browserConfig } : {}),
    ...(sourceControl ? { sourceControl } : {}),
  };
}

/** Tag entry rules from web: trimmed, unique, ≤ 20 tags, ≤ 50 chars. */
export function addTag(tags: readonly string[], raw: string): string[] {
  const tag = raw.trim().slice(0, 50);
  if (!tag || tags.includes(tag) || tags.length >= 20) return [...tags];
  return [...tags, tag];
}

/** Toggle an id in an add/remove pair, keeping the two lists disjoint. */
export function toggleOverrideId(
  overrides: AgentOverrides,
  field: 'skill' | 'mcp',
  id: string,
  /** Whether the bound agent already includes it. */
  inBase: boolean,
  /** Whether it should be included after the tap. */
  wanted: boolean,
): AgentOverrides {
  const addKey = field === 'skill' ? 'addSkillIds' : 'addMcpServerIds';
  const removeKey = field === 'skill' ? 'removeSkillIds' : 'removeMcpServerIds';
  const add = new Set(overrides[addKey] ?? []);
  const remove = new Set(overrides[removeKey] ?? []);
  add.delete(id);
  remove.delete(id);
  if (wanted && !inBase) add.add(id);
  if (!wanted && inBase) remove.add(id);
  const next: AgentOverrides = { ...overrides };
  if (add.size) next[addKey] = [...add];
  else delete next[addKey];
  if (remove.size) next[removeKey] = [...remove];
  else delete next[removeKey];
  return next;
}

/** Whether `id` is effectively on after overrides are applied. */
export function overrideIncludes(
  overrides: AgentOverrides,
  field: 'skill' | 'mcp',
  id: string,
  inBase: boolean,
): boolean {
  const addKey = field === 'skill' ? 'addSkillIds' : 'addMcpServerIds';
  const removeKey = field === 'skill' ? 'removeSkillIds' : 'removeMcpServerIds';
  if (overrides[addKey]?.includes(id)) return true;
  if (overrides[removeKey]?.includes(id)) return false;
  return inBase;
}
