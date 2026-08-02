// ────────────────────────────────────────────────────────────────
// Composer data hooks — slash commands (prompts + skills + builtins)
// and the @-mention file index. Both are cached via TanStack Query so
// the menus stay cheap even with many artifacts / files.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import { useSystemArtifacts, useAvailableArtifacts } from './projectQueries.js';
import { useCatalogPrefsStore } from '../stores/catalogPrefsStore.js';
import {
  BUILTIN_COMMANDS,
  skillToCommand,
  promptToCommand,
} from '../components/chat/composer/builtins.js';
import type { SlashCommand, MentionFile } from '../components/chat/composer/types.js';

interface ArtifactLike {
  id: string;
  name: string;
  description?: string;
  source?: 'system' | 'project';
}

/**
 * Merge built-in commands with prompt + skill artifacts (project-scoped when a
 * project is linked, otherwise system-scoped) into a single slash-command list.
 */
export function useSlashCommands(projectId?: string): SlashCommand[] {
  const platform = usePlatform();

  const sysPrompts = useSystemArtifacts(projectId ? undefined : 'prompt');
  const sysSkills = useSystemArtifacts(projectId ? undefined : 'skill');
  const projPrompts = useAvailableArtifacts(projectId, 'prompt');
  const projSkills = useAvailableArtifacts(projectId, 'skill');

  const prompts = (projectId ? projPrompts.data : sysPrompts.data) as ArtifactLike[] | undefined;
  const skills = (projectId ? projSkills.data : sysSkills.data) as ArtifactLike[] | undefined;

  // Skills disabled in Settings → Skills are hidden from the `/` menu.
  const disabledSkills = useCatalogPrefsStore((s) => s.disabledSkills);

  return useMemo(() => {
    const commands: SlashCommand[] = [...BUILTIN_COMMANDS];

    for (const s of skills ?? []) {
      if (disabledSkills.includes(s.id)) continue;
      const source = (s.source ?? 'system') as 'system' | 'project';
      commands.push(skillToCommand({ id: s.id, name: s.name, description: s.description, source }));
    }

    for (const p of prompts ?? []) {
      const source = (p.source ?? 'system') as 'system' | 'project';
      const loadTemplate = () =>
        source === 'system'
          ? platform.getSystemArtifactContent(p.id)
          : platform.getProjectConfigContent(projectId!, p.id);
      commands.push(
        promptToCommand({ id: p.id, name: p.name, description: p.description, source }, loadTemplate),
      );
    }

    return commands;
  }, [prompts, skills, platform, projectId, disabledSkills]);
}

/**
 * Flatten a workspace's file listing into a deduplicated `MentionFile[]` for
 * the `@` mention menu. Source files + workspace outputs + per-worktree files
 * are merged; filtering happens client-side in the menu.
 */
export function useWorkspaceFileIndex(workspaceId?: string): {
  files: MentionFile[];
  isLoading: boolean;
} {
  const platform = usePlatform();
  const query = useQuery({
    queryKey: ['workspace-file-index', workspaceId],
    queryFn: () => platform.getWorkspaceFiles(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const files = useMemo<MentionFile[]>(() => {
    const data = query.data;
    if (!data) return [];
    const out: MentionFile[] = [];
    const seen = new Set<string>();
    const push = (path: string, source: MentionFile['source'], worktreeAlias?: string) => {
      const key = `${source}:${worktreeAlias ?? ''}:${path}`;
      if (seen.has(key)) return;
      seen.add(key);
      const label = path.split('/').pop() || path;
      out.push({ path, source, worktreeAlias, label });
    };
    for (const wt of data.worktrees ?? []) {
      for (const f of wt.files ?? []) push(f, 'worktree', wt.alias);
    }
    for (const f of data.sourceFiles ?? []) push(f, 'source');
    for (const f of data.workspaceFiles ?? []) push(f, 'workspace');
    for (const f of data.artifactFiles ?? []) push(f, 'artifacts');
    return out;
  }, [query.data]);

  return { files, isLoading: query.isLoading };
}
