// ────────────────────────────────────────────────────────────────
// useAgentCatalog — the browser-side view of what an agent may reference.
//
// An agent can only reference VETTED catalog entries by id (never an inline
// MCP server definition), so this hook is the single place the pickers get
// their options from. `projectId` widens the catalog with project-scoped
// skills and MCP servers.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { ArtifactWithSource, McpServerEntry } from '@generatorai/shared';
import {
  useSystemArtifacts,
  useAvailableArtifacts,
  useSystemMcpServers,
  useProjectMcpServers,
} from '@/hooks/projectQueries.js';

export interface CatalogEntry {
  id: string;
  name: string;
  description?: string;
  source: 'system' | 'project';
}

export function useAgentCatalog(projectId?: string) {
  const systemSkills = useSystemArtifacts('skill');
  const projectSkills = useAvailableArtifacts(projectId, 'skill');
  const systemMcp = useSystemMcpServers();
  const projectMcp = useProjectMcpServers(projectId);

  const skills = useMemo<CatalogEntry[]>(() => {
    const seen = new Set<string>();
    const out: CatalogEntry[] = [];
    // `available-artifacts` already merges system + project with project
    // shadowing system, so anything already seen by id is skipped.
    const merged = [
      ...((systemSkills.data ?? []) as ArtifactWithSource[]),
      ...((projectSkills.data ?? []) as ArtifactWithSource[]),
    ];
    for (const s of merged) {
      if (!s?.id || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({
        id: s.id,
        ...(s.description ? { description: s.description } : {}),
        name: s.name,
        source: s.source === 'project' ? 'project' : 'system',
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [systemSkills.data, projectSkills.data]);

  const mcpServers = useMemo<CatalogEntry[]>(() => {
    const seen = new Set<string>();
    const out: CatalogEntry[] = [];
    const merged = [
      ...((systemMcp.data ?? []) as McpServerEntry[]),
      ...((projectMcp.data ?? []) as McpServerEntry[]),
    ];
    for (const m of merged) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({
        id: m.id,
        ...(m.description ? { description: m.description } : {}),
        name: m.name ?? m.id,
        source: m.source === 'project' ? 'project' : 'system',
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [systemMcp.data, projectMcp.data]);

  return {
    skills,
    mcpServers,
    isLoading:
      systemSkills.isLoading ||
      systemMcp.isLoading ||
      (!!projectId && (projectSkills.isLoading || projectMcp.isLoading)),
  };
}
