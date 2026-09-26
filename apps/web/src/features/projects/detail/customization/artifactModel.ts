// ────────────────────────────────────────────────────────────────
// Customization tab model (P5-04; F-projects-07; G-19). Pure helpers.
//
// The catalog lists every candidate — including the ones this project has
// switched off — so it cannot read `/available-artifacts`, which drops
// disabled entries (G-19). It rebuilds the same precedence merge the server
// does (SystemArtifactService.getAvailableArtifacts: a project artifact with
// the same type + name shadows the system one) from the unfiltered system and
// project lists.
// ────────────────────────────────────────────────────────────────

import type { ArtifactWithSource, ConfigType, ProjectArtifactPrefEntry, ProjectConfig, SystemConfig } from '@generatorai/shared';

export type ArtifactKind = 'skill' | 'prompt' | 'agent';
export type CustomizationKind = ArtifactKind | 'mcp';

/** `?kind=` values (R-3) ↔ config types. */
export const KIND_PARAM: Record<CustomizationKind, string> = { skill: 'skills', prompt: 'prompts', agent: 'agents', mcp: 'mcp' };
export const KIND_LABEL: Record<CustomizationKind, string> = { skill: 'Skills', prompt: 'Prompts', agent: 'Agents', mcp: 'MCP' };

export function kindFromParam(param: string | null): CustomizationKind {
  const hit = (Object.keys(KIND_PARAM) as CustomizationKind[]).find((k) => KIND_PARAM[k] === param);
  return hit ?? 'skill';
}

/** System + project artifacts of one kind; a project entry shadows a system one with the same name. */
export function mergeArtifacts(
  system: readonly SystemConfig[],
  project: readonly ProjectConfig[],
  kind: ArtifactKind,
): ArtifactWithSource[] {
  const byKey = new Map<string, ArtifactWithSource>();
  for (const s of system) {
    if (s.type !== kind) continue;
    byKey.set(s.name.toLowerCase(), {
      id: s.id,
      type: s.type,
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
      filePath: s.filePath,
      source: 'system',
      metadata: s.metadata,
    });
  }
  for (const p of project) {
    if (p.type !== kind) continue;
    byKey.set(p.name.toLowerCase(), {
      id: p.id,
      type: p.type,
      name: p.name,
      ...(p.description ? { description: p.description } : {}),
      filePath: p.filePath,
      source: 'project',
      metadata: p.metadata,
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'project' ? -1 : 1,
  );
}

export const prefKey = (type: ConfigType, id: string) => `${type}:${id}`;

/** The disabled set after switching one entry on or off (G-19 PUT replaces the whole set). */
export function toggleDisabled(
  disabled: readonly ProjectArtifactPrefEntry[],
  type: ConfigType,
  id: string,
  enabled: boolean,
): ProjectArtifactPrefEntry[] {
  const rest = disabled.filter((d) => !(d.type === type && d.id === id));
  return enabled ? rest : [...rest, { type, id }];
}

/** A skill folder must contain SKILL.md (any case) at some depth. */
export function skillFolderProblem(files: readonly File[]): string | null {
  if (files.length === 0) return 'No files selected.';
  const hasSkillMd = files.some((f) => (f.webkitRelativePath?.split('/').pop() ?? f.name).toLowerCase() === 'skill.md');
  return hasSkillMd ? null : 'A skill folder must contain a SKILL.md file.';
}
