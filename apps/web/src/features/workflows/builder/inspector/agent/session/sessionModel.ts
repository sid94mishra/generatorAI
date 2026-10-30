// ────────────────────────────────────────────────────────────────
// What the session editor reads besides the session itself: the skill and
// MCP catalogs (system + project; system MCP servers turned off in
// Settings › MCP servers are hidden, as before), the bound agent (its own
// skills and servers show locked, "From agent"), the effective session (a
// stage over its workflow session), and the copy shared by its controls.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { Agent } from '@generatorai/shared';
import { resolveSessionSpec, type SessionSpec } from '@generatorai/workflow-spec';
import { useAgentCatalog, useSelectableAgents, type CatalogEntry } from '@/hooks/agentQueries.js';
import { useCatalogPrefsStore } from '@/stores/catalogPrefsStore.js';

export type SessionScope = 'chat' | 'workflow' | 'stage';

export type SessionSpecSection = 'runtime' | 'mode' | 'agent' | 'skills' | 'mcp' | 'platform' | 'warnings';

export const ALL_SESSION_SECTIONS: readonly SessionSpecSection[] = ['runtime', 'mode', 'agent', 'skills', 'mcp', 'platform', 'warnings'];

/** The empty choice of a picker: what an unset field falls back to. */
export function inheritsLabel(scope: SessionScope): string {
  return scope === 'stage' ? 'Workflow default' : scope === 'workflow' ? 'Provider default' : 'Default';
}

/** The session the composer will see: a stage over its workflow session. */
export function effectiveSession(value: SessionSpec | undefined, inherited: SessionSpec | undefined): SessionSpec {
  return inherited ? resolveSessionSpec(inherited, value) : (value ?? {});
}

export interface SessionCatalog {
  skills: CatalogEntry[];
  mcpServers: CatalogEntry[];
  isLoading: boolean;
}

/** Skills and MCP servers a session may add (system + project). */
export function useSessionCatalog(projectId: string | undefined): SessionCatalog {
  const { skills, mcpServers, isLoading } = useAgentCatalog(projectId);
  const disabledMcp = useCatalogPrefsStore((s) => s.disabledMcp);
  const visibleMcp = useMemo(
    () => mcpServers.filter((m) => m.source !== 'system' || !disabledMcp.includes(m.id)),
    [mcpServers, disabledMcp],
  );
  return { skills, mcpServers: visibleMcp, isLoading };
}

/** The agent bound by `agentRef` (among the selectable agents), if any. */
export function useBoundAgent(agentRef: string | undefined, projectId: string | undefined): Agent | undefined {
  const { data: agents } = useSelectableAgents(projectId);
  return useMemo(() => (agentRef ? (agents ?? []).find((a) => a.ref === agentRef) : undefined), [agents, agentRef]);
}

/** Skill ids the session adds (`agentOverrides.addSkillIds`). */
export function addedSkillIds(session: SessionSpec | undefined): string[] {
  return session?.agentOverrides?.addSkillIds ?? [];
}

/** MCP server ids the session turned off (`mcp.excludedIds`); every listed server is on by default. */
export function excludedMcpIds(session: SessionSpec | undefined): string[] {
  return session?.mcp?.excludedIds ?? [];
}

/**
 * The skills patch that makes `next` the added skill ids: removals of a
 * re-added skill and `skills.disabled` entries of a re-added name are
 * dropped with it (a selected skill is never also disabled).
 */
export function skillsPatch(session: SessionSpec | undefined, next: ReadonlySet<string>, catalog: readonly CatalogEntry[]): Partial<SessionSpec> {
  const selectedNames = new Set(catalog.filter((skill) => next.has(skill.id)).map((skill) => skill.name));
  const overrides: NonNullable<SessionSpec['agentOverrides']> = { ...session?.agentOverrides };
  if (next.size > 0) overrides.addSkillIds = [...next];
  else delete overrides.addSkillIds;
  const removed = session?.agentOverrides?.removeSkillIds?.filter((id) => !next.has(id));
  if (removed?.length) overrides.removeSkillIds = removed;
  else delete overrides.removeSkillIds;
  const disabled = session?.skills?.disabled?.filter((name) => !selectedNames.has(name));
  const skills = session?.skills ? { ...session.skills, disabled: disabled?.length ? disabled : undefined } : undefined;
  if (skills && skills.disabled === undefined) delete skills.disabled;
  return {
    agentOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    skills: skills && Object.keys(skills).length > 0 ? skills : undefined,
  };
}

/** The MCP patch that turns off exactly `ids`. */
export function mcpPatch(session: SessionSpec | undefined, ids: readonly string[]): Partial<SessionSpec> {
  const next = { ...session?.mcp };
  if (ids.length > 0) next.excludedIds = [...ids];
  else delete next.excludedIds;
  return { mcp: Object.keys(next).length > 0 ? next : undefined };
}

/** The platform toggles on in the effective session (browser and widgets are on unless turned off). */
export function platformToggles(effective: SessionSpec, scope: SessionScope): { browser: boolean; computerUse: boolean; widgets: boolean } {
  return {
    browser: effective.browser?.enabled !== false,
    computerUse: scope !== 'chat' && effective.computerUse === true,
    widgets: scope !== 'chat' && effective.widgets !== false,
  };
}

/**
 * The Tools tab count: skills on (added, plus the agent's own not removed),
 * MCP servers not turned off and platform toggles on.
 */
export function enabledToolCount(args: {
  session: SessionSpec | undefined;
  effective: SessionSpec;
  scope: SessionScope;
  catalog: SessionCatalog;
  agent: Agent | undefined;
}): number {
  const { session, effective, scope, catalog, agent } = args;
  const removedSkills = new Set(session?.agentOverrides?.removeSkillIds ?? []);
  const skillsOn = new Set([...addedSkillIds(session), ...(agent?.skillIds ?? []).filter((id) => !removedSkills.has(id))]);
  const excluded = new Set(excludedMcpIds(session));
  const mcpOn = catalog.mcpServers.filter((m) => !excluded.has(m.id)).length;
  const platform = Object.values(platformToggles(effective, scope)).filter(Boolean).length;
  return catalog.skills.filter((s) => skillsOn.has(s.id)).length + mcpOn + platform;
}
