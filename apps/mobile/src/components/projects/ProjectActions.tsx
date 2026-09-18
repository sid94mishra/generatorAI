// ────────────────────────────────────────────────────────────────
// ProjectActions — rename, archive / restore and delete one project.
//
// Shared by the Projects tab (long-press a row) and the project screen's
// header menu, so both behave identically. Archive is reversible and runs
// straight away with an Undo toast; delete removes the project's folder and
// codebases on the host and therefore confirms first.
//
// Without `write:projects` the menu still opens: the actions are shown
// disabled with the reason, plus "Request access".
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, KeyRound, Pencil, Trash2 } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { ActionSheet, ConfirmSheet, type MenuAction } from '../ui/ActionSheet';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { useFeature } from '../runs/useFeature';
import { useTheme } from '../../theme/ThemeProvider';
import { useProjectsApi } from './useProjectsApi';
import { isArchived, validateProjectName } from './projectEditModel';

export interface ProjectActionTarget {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
}

export function ProjectActions({
  project,
  onClose,
  onDeleted,
}: {
  /** The project whose menu is open, or null when closed. */
  project: ProjectActionTarget | null;
  onClose: () => void;
  onDeleted?: () => void;
}): React.ReactElement {
  const api = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const feature = useFeature('projectEdit');
  const [renaming, setRenaming] = useState<ProjectActionTarget | null>(null);
  const [deleting, setDeleting] = useState<ProjectActionTarget | null>(null);

  const invalidate = (id: string): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(id) });
  };

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: 'active' | 'archived' }) => api.update(vars.id, { status: vars.status }),
    onSuccess: (_data, vars) => {
      invalidate(vars.id);
      if (vars.status === 'archived') {
        toast({
          message: 'Project archived.',
          variant: 'success',
          action: { label: 'Undo', onPress: () => setStatus.mutate({ id: vars.id, status: 'active' }) },
        });
      } else {
        toast({ message: 'Project restored.', variant: 'success' });
      }
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not change the project.'), variant: 'danger' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.project(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      toast({ message: 'Project deleted.', variant: 'success' });
      onDeleted?.();
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not delete the project.'), variant: 'danger' }),
  });

  const disabledDetail = feature.available ? undefined : (feature.reason ?? undefined);
  const archived = project ? isArchived(project) : false;

  const actions: MenuAction[] = project
    ? [
        {
          label: 'Rename',
          icon: <Pencil size={18} color={colors.foreground} />,
          disabled: !feature.available,
          ...(disabledDetail ? { detail: disabledDetail } : {}),
          onPress: () => setRenaming(project),
        },
        archived
          ? {
              label: 'Restore',
              icon: <ArchiveRestore size={18} color={colors.foreground} />,
              disabled: !feature.available,
              onPress: () => setStatus.mutate({ id: project.id, status: 'active' }),
            }
          : {
              label: 'Archive',
              icon: <Archive size={18} color={colors.foreground} />,
              detail: 'Hidden from pickers; restore it any time',
              disabled: !feature.available,
              onPress: () => setStatus.mutate({ id: project.id, status: 'archived' }),
            },
        {
          label: 'Delete',
          icon: <Trash2 size={18} color={feature.available ? colors.danger : colors['muted-foreground']} />,
          destructive: true,
          disabled: !feature.available,
          onPress: () => setDeleting(project),
        },
        ...(!feature.available && feature.grantable
          ? [
              {
                label: 'Request access',
                icon: <KeyRound size={18} color={colors.foreground} />,
                onPress: feature.requestAccess,
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      <ActionSheet
        visible={project !== null}
        onClose={onClose}
        title={project?.name ?? ''}
        actions={actions}
      />
      <RenameProjectSheet
        project={renaming}
        onClose={() => setRenaming(null)}
        onSaved={(id) => invalidate(id)}
      />
      <ConfirmSheet
        visible={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this project'}?`}
        message="Its codebases, worktrees and project files are removed from your computer. Chats and runs stay, but lose their project. This cannot be undone — archive it instead to keep everything."
        confirmLabel="Delete project"
        onConfirm={() => {
          const id = deleting?.id;
          setDeleting(null);
          if (id) remove.mutate(id);
        }}
      />
    </>
  );
}

function RenameProjectSheet({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectActionTarget | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}): React.ReactElement {
  const api = useProjectsApi();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description ?? '');
  }, [project]);

  const error = validateProjectName(name);
  const save = useMutation({
    mutationFn: (id: string) => api.update(id, { name: name.trim(), description: description.trim() }),
    onSuccess: (_data, id) => {
      onSaved(id);
      onClose();
      toast({ message: 'Project renamed.', variant: 'success' });
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not rename the project.'), variant: 'danger' }),
  });

  return (
    <Sheet visible={project !== null} onClose={onClose} title="Rename project" detents={[0.5, 0.9]}>
      <View className="gap-4 px-4 pb-6 pt-2">
        <Field label="Name" value={name} onChangeText={setName} autoFocus maxLength={120} error={error} />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Optional"
          multiline
          style={{ minHeight: 64, textAlignVertical: 'top' }}
        />
        <Button
          label="Save"
          full
          size="lg"
          loading={save.isPending}
          disabled={Boolean(error) || save.isPending}
          onPress={() => project && save.mutate(project.id)}
        />
      </View>
    </Sheet>
  );
}

export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
