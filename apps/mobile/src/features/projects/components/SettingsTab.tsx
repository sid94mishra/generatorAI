// Project › Settings (MProjectSettings): Worktrees — retention (Select) and max codebases (stepper), saved by the
// header's Save (one save model, MD-30 / MD-85); Location — root path (copyable), created; Project — Archive /
// Unarchive (undo snackbar, MD-26) and Delete project… (AlertDialog with the impact: codebases · worktrees · size and
// what needs you, MD-29).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { CodebaseSummary, ProjectSummary } from '@generatorai/client-core';
import { toEpochMs } from '@generatorai/client-core';

import { PROJECTS_HREF } from '../../../blocks/shell/hrefs';
import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { errorText, formatBytes } from '../../../ui/lib/format';
import { confirm } from '../../../ui/native/AlertDialog';
import { toast } from '../../../ui/primitives/Toast';
import { MAX_CODEBASES_LIMIT, RETENTION_OPTIONS, settingsChangeCount, settingsDraftFrom, settingsPatch, isArchived, type ProjectSettingsDraft } from '../model/projectsModel';
import { useProjectFootprint, useProjectWrites, useUpdateProject } from '../queries';
import { useProjectActions } from '../useProjectActions';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function useProjectSettingsForm(project: ProjectSummary | undefined) {
  const saved = useMemo(() => settingsDraftFrom(project ?? {}), [project]);
  const [draft, setDraft] = useState<ProjectSettingsDraft | null>(null);
  const update = useUpdateProject(project?.id ?? '');
  const current = draft ?? saved;
  const count = settingsChangeCount(saved, current);
  return {
    draft: current,
    setDraft,
    dirty: count > 0,
    count,
    saving: update.isPending,
    save: () => {
      const patch = settingsPatch(saved, current);
      if (!patch) return;
      update.mutate(patch, {
        onSuccess: () => setDraft(null),
        onError: (e) => toast({ kind: 'error', message: errorText(e) }),
      });
    },
  };
}

export function SettingsTab({ project, codebases, needsYou, canEdit, form }: { project: ProjectSummary; codebases: readonly CodebaseSummary[]; needsYou: number; canEdit: boolean; form: ReturnType<typeof useProjectSettingsForm> }): React.ReactElement {
  const act = useProjectActions();
  const writes = useProjectWrites();
  const footprint = useProjectFootprint(project.id);
  const created = toEpochMs(project.createdAt);
  const archived = isArchived(project);
  const retention = RETENTION_OPTIONS.find((o) => o.value === form.draft.worktreeRetention)!;

  const deleteProject = async (): Promise<void> => {
    const f = await footprint(codebases.map((c) => c.id)).catch(() => null);
    const counts = [`${codebases.length} codebase${codebases.length === 1 ? '' : 's'}`, ...(f ? [`${f.worktrees} worktree${f.worktrees === 1 ? '' : 's'}`] : []), ...(f?.bytes ? [formatBytes(f.bytes)] : [])];
    const ok = await confirm({
      title: `Delete ${project.name}?`,
      message: "This permanently deletes the project and all its codebases, configs and worktrees. It can't be undone.",
      impact: [counts.join(' · '), ...(needsYou > 0 ? [`${needsYou} item${needsYou === 1 ? '' : 's'} in this project need${needsYou === 1 ? 's' : ''} you`] : [])],
      confirmLabel: 'Delete project',
      icon: 'trash',
    });
    if (!ok) return;
    writes
      .remove(project.id)
      .then(() => router.replace(PROJECTS_HREF as Parameters<typeof router.replace>[0]))
      .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
  };

  return (
    <View className="gap-6">
      <ListSection title="Worktrees" footer={retention.hint}>
        <ListRow
          kind="picker"
          title="Retention"
          picker={{
            value: form.draft.worktreeRetention,
            options: RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            onValueChange: (v) => form.setDraft({ ...form.draft, worktreeRetention: v as ProjectSettingsDraft['worktreeRetention'] }),
            disabled: !canEdit,
            testID: 'project-settings-retention',
          }}
        />
        <ListRow
          kind="stepper"
          title="Max codebases"
          stepper={{ value: form.draft.maxCodebases, onValueChange: (v) => form.setDraft({ ...form.draft, maxCodebases: v }), min: Math.max(1, codebases.length), max: MAX_CODEBASES_LIMIT, disabled: !canEdit, testID: 'project-settings-max' }}
        />
      </ListSection>
      <ListSection title="Location">
        {project.rootPath ? <ListRow kind="value" title="Root path" value={project.rootPath} mono copyable /> : null}
        {created ? <ListRow kind="value" title="Created" value={dateFormat.format(new Date(created))} /> : null}
      </ListSection>
      {canEdit ? (
        <ListSection title="Project">
          <ListRow
            kind="navigation"
            icon="archive"
            title={archived ? 'Unarchive project' : 'Archive project'}
            subtitle={archived ? 'Moves it back to Active' : 'Moves it to Archived; codebases and worktrees stay'}
            onPress={() => act(archived ? 'unarchive' : 'archive', project)}
            testID="project-settings-archive"
          />
          <ListRow kind="destructive" icon="trash" title="Delete project…" subtitle="Removes codebases, configs and worktrees" onPress={() => void deleteProject()} testID="project-settings-delete" />
        </ListSection>
      ) : null}
    </View>
  );
}
