// The project actions shared by the list's long-press menu and the detail's ⋯ menu (MProjects, MProjectDetail):
// navigation, copy the root path, archive / unarchive with an undo snackbar (MD-26) and delete with its impact (MD-29).
import { useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { ProjectSummary } from '@generatorai/client-core';

import { NEW_CHAT_HREF, PROJECTS_HREF, addCodebaseHref, projectHref, projectTabHref } from '../../blocks/shell/hrefs';
import { confirm } from '../../ui/native/AlertDialog';
import { toast } from '../../ui/primitives/Toast';
import { errorText } from '../../ui/lib/format';
import type { ProjectMenuId } from './model/projectsModel';
import { useProjectWrites } from './queries';

type Href = Parameters<typeof router.push>[0];

export function deleteImpact(project: Pick<ProjectSummary, 'summary'>, needsYou: number): string[] {
  const s = project.summary;
  const counts = [
    ...(s?.codebases !== undefined ? [`${s.codebases} codebase${s.codebases === 1 ? '' : 's'}`] : []),
    ...(s?.worktrees ? [`${s.worktrees.active + s.worktrees.orphaned} worktrees`] : []),
  ];
  return [...(counts.length ? [counts.join(' · ')] : []), ...(needsYou > 0 ? [`${needsYou} item${needsYou === 1 ? '' : 's'} in this project need${needsYou === 1 ? 's' : ''} you`] : [])];
}

export function useProjectActions(): (id: ProjectMenuId, project: ProjectSummary, opts?: { needsYou?: number; afterDelete?: () => void }) => void {
  const writes = useProjectWrites();
  return useCallback(
    (id, project, opts = {}) => {
      switch (id) {
        case 'open':
          router.push(projectHref(project.id) as Href);
          return;
        case 'new-chat':
          router.push(`${NEW_CHAT_HREF}?project=${encodeURIComponent(project.id)}` as Href);
          return;
        case 'run-workflow':
          router.push(`/workflows?project=${encodeURIComponent(project.id)}` as Href);
          return;
        case 'add-codebase':
          router.push(addCodebaseHref(project.id) as Href);
          return;
        case 'settings':
          router.push(projectTabHref(project.id, 'settings') as Href);
          return;
        case 'copy-path':
          if (project.rootPath) void Clipboard.setStringAsync(project.rootPath);
          return;
        case 'archive':
        case 'unarchive': {
          const archive = id === 'archive';
          writes
            .setArchived(project.id, archive)
            .then(() =>
              toast({
                kind: 'undo',
                message: archive ? `Archived ${project.name}` : `Restored ${project.name}`,
                undo: { onUndo: () => void writes.setArchived(project.id, !archive).catch(() => undefined) },
              }),
            )
            .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
          return;
        }
        case 'delete':
          void confirm({
            title: `Delete ${project.name}?`,
            message: "This permanently deletes the project and all its codebases, configs and worktrees. It can't be undone.",
            impact: deleteImpact(project, opts.needsYou ?? project.summary?.needsYou ?? 0),
            confirmLabel: 'Delete project',
            icon: 'trash',
          }).then((ok) => {
            if (!ok) return;
            writes
              .remove(project.id)
              .then(() => {
                if (opts.afterDelete) opts.afterDelete();
                else if (router.canGoBack()) router.back();
                else router.replace(PROJECTS_HREF as Href);
              })
              .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
          });
          return;
      }
    },
    [writes],
  );
}
