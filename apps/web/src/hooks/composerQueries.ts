// ────────────────────────────────────────────────────────────────
// Composer data hooks — slash commands (prompts + skills + builtins)
// and the @-mention file index. Both are cached via TanStack Query so
// the menus stay cheap even with many artifacts / files.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { COMPUTER_USE_SKILL_ID } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import { useSystemArtifacts, useAvailableArtifacts } from './projectQueries.js';
import { useCatalogPrefsStore } from '../stores/catalogPrefsStore.js';
import {
  BUILTIN_COMMANDS,
  computerUseSkillToCommand,
  skillToCommand,
  promptToCommand,
} from '../components/chat/composer/builtins.js';
import type { SlashCommand, MentionFile } from '../components/chat/composer/types.js';
import type { ComputerUseSettings } from '../platform/HttpPlatformClient.js';

interface ArtifactLike {
  id: string;
  name: string;
  description?: string;
  source?: 'system' | 'project';
}

/**
 * Server-side Computer Use enablement (Settings → Computer Use). Server-owned
 * rather than a client preference because it gates whether the agent gets the
 * `computer_*` tools at all — a localStorage flag could not do that.
 */
export function useComputerUseSettings() {
  const platform = usePlatform();
  return useQuery<ComputerUseSettings>({
    queryKey: ['computer-use-settings'],
    queryFn: () => platform.getComputerUseSettings(),
    staleTime: 30_000,
  });
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
  // Computer Use is off by default; offering `/computer-use` while the server
  // has no computer_* tools registered would produce a command that silently
  // does nothing.
  const computerUse = useComputerUseSettings();
  const computerUseEnabled = computerUse.data?.enabled === true;

  return useMemo(() => {
    const commands: SlashCommand[] = [...BUILTIN_COMMANDS];

    for (const s of skills ?? []) {
      if (disabledSkills.includes(s.id)) continue;
      if (s.id === COMPUTER_USE_SKILL_ID) {
        if (!computerUseEnabled) continue;
        commands.push(
          computerUseSkillToCommand({ id: s.id, name: s.name, description: s.description }),
        );
        continue;
      }
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
  }, [prompts, skills, platform, projectId, disabledSkills, computerUseEnabled]);
}

/**
 * Flatten a workspace's file listing into a deduplicated `MentionFile[]` for
 * the `@` mention menu.
 *
 * Under the mount model `worktrees` carries ONE entry per mount — in-place
 * mounts included, despite the legacy field name — with repo-relative paths,
 * and `sourceFiles` is always empty (the `source/<alias>` layout is gone).
 * The mount alias is the badge, so a file picked from the menu says which of
 * the chat's sources it came from.
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
    const aliases = new Set<string>();
    // Mounts first: they are the code, and the menu is ranked by insertion.
    for (const mount of data.worktrees ?? []) {
      aliases.add(mount.alias);
      for (const f of mount.files ?? []) push(f, 'worktree', mount.alias);
    }
    // Legacy servers still send `sourceFiles`; skip anything a mount already
    // listed so a file cannot appear twice in the menu.
    for (const f of data.sourceFiles ?? []) {
      const top = f.split('/')[0] ?? '';
      if (aliases.has(top)) continue;
      push(f, 'source');
    }
    // Managed scratch + plans, then artifacts: supporting material, offered
    // after the code rather than mixed into it.
    for (const f of data.workspaceFiles ?? []) push(f, 'workspace');
    for (const f of data.artifactFiles ?? []) push(f, 'artifacts');
    return out;
  }, [query.data]);

  return { files, isLoading: query.isLoading };
}
