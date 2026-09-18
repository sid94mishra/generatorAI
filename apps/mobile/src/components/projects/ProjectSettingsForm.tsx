// ────────────────────────────────────────────────────────────────
// Project › Settings — name, description, worktree retention and the
// codebase limit (web: ProjectSettingsForm). `PUT /projects/:id` merges
// `settings` server-side, so only changed fields are sent (`settingsPatch`).
//
// Without `write:projects` the same facts render read-only with a
// Request access line, so the phone never shows a Save that would 403.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Check, Minus, Plus } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Form';
import { ListGroup, ListRow } from '../ui/ListRow';
import { SectionHeader } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { relativeTime } from '../runs/formatTime';
import { useFeature } from '../runs/useFeature';
import { useTheme } from '../../theme/ThemeProvider';
import type { ProjectDetailWire } from './api';
import { ProjectActions, messageOf } from './ProjectActions';
import { useProjectsApi } from './useProjectsApi';
import {
  MAX_CODEBASES_LIMIT,
  RETENTION_OPTIONS,
  clampMaxCodebases,
  isArchived,
  settingsDraftFrom,
  settingsPatch,
  type ProjectSettingsDraft,
} from './projectEditModel';

export function ProjectSettingsForm({
  project,
  onDeleted,
}: {
  project: ProjectDetailWire;
  onDeleted: () => void;
}): React.ReactElement {
  const api = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const feature = useFeature('projectEdit');
  const editable = feature.available;

  const saved = useMemo(
    () => settingsDraftFrom(project),
    // Re-derive when the persisted values change (after a save refetches).
    [project.name, project.description, project.settings?.worktreeRetention, project.settings?.maxCodebases],
  );
  const [draft, setDraft] = useState<ProjectSettingsDraft>(saved);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setDraft(saved), [saved]);

  const patch = settingsPatch(saved, draft);
  const nameMissing = !draft.name.trim();

  const save = useMutation({
    mutationFn: () => api.update(project.id, patch ?? {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      toast({ message: 'Settings saved.', variant: 'success' });
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not save the settings.'), variant: 'danger' }),
  });

  const set = (partial: Partial<ProjectSettingsDraft>): void => setDraft((d) => ({ ...d, ...partial }));

  return (
    <View className="gap-1">
      <SectionHeader title="General" className="pt-0" />
      {editable ? (
        <View className="gap-3">
          <Field
            label="Name"
            value={draft.name}
            onChangeText={(name) => set({ name })}
            maxLength={120}
            error={nameMissing ? 'A project needs a name.' : null}
          />
          <Field
            label="Description"
            value={draft.description}
            onChangeText={(description) => set({ description })}
            placeholder="Optional"
            multiline
            style={{ minHeight: 64, textAlignVertical: 'top' }}
          />
        </View>
      ) : (
        <ListGroup>
          <ListRow title="Name" trailing={<Value text={project.name} />} />
          <ListRow title="Description" subtitle={project.description || 'None'} />
        </ListGroup>
      )}

      <SectionHeader title="Worktree cleanup" />
      <ListGroup>
        {RETENTION_OPTIONS.map((option) => {
          const selected = draft.worktreeRetention === option.value;
          return (
            <ListRow
              key={option.value}
              title={option.label}
              subtitle={option.detail}
              selected={selected}
              disabled={!editable}
              chevron={false}
              accessibilityLabel={`${option.label}${selected ? ', selected' : ''}`}
              {...(selected ? { trailing: <Check size={18} color={colors.primary} /> } : {})}
              {...(editable ? { onPress: () => set({ worktreeRetention: option.value }) } : {})}
            />
          );
        })}
      </ListGroup>

      <SectionHeader title="Limits" />
      <ListGroup>
        <ListRow
          title="Maximum codebases"
          subtitle={`Between 1 and ${MAX_CODEBASES_LIMIT}`}
          trailing={
            <View className="flex-row items-center gap-1">
              {editable ? (
                <IconButton
                  accessibilityLabel="Fewer codebases"
                  compact
                  disabled={draft.maxCodebases <= 1}
                  icon={<Minus size={16} color={colors.foreground} />}
                  onPress={() => set({ maxCodebases: clampMaxCodebases(draft.maxCodebases - 1) })}
                />
              ) : null}
              <Text
                accessibilityLabel={`${draft.maxCodebases} codebases`}
                className="min-w-8 text-center text-md font-semibold text-foreground"
              >
                {draft.maxCodebases}
              </Text>
              {editable ? (
                <IconButton
                  accessibilityLabel="More codebases"
                  compact
                  disabled={draft.maxCodebases >= MAX_CODEBASES_LIMIT}
                  icon={<Plus size={16} color={colors.foreground} />}
                  onPress={() => set({ maxCodebases: clampMaxCodebases(draft.maxCodebases + 1) })}
                />
              ) : null}
            </View>
          }
        />
      </ListGroup>

      {editable ? (
        <View className="flex-row gap-2 pt-3">
          <Button
            label="Discard"
            variant="secondary"
            grow
            haptic="tap"
            disabled={!patch || save.isPending}
            onPress={() => setDraft(saved)}
          />
          <Button
            label="Save"
            grow
            loading={save.isPending}
            disabled={!patch || nameMissing || save.isPending}
            onPress={() => save.mutate()}
          />
        </View>
      ) : feature.grantable ? (
        <View className="flex-row items-center gap-3 pt-3">
          <Text className="flex-1 text-sm text-muted-foreground">{feature.reason}</Text>
          <Button label="Request access" variant="ghost" size="sm" haptic="tap" onPress={feature.requestAccess} />
        </View>
      ) : null}

      <SectionHeader title="About" />
      <ListGroup>
        {project.rootPath ? (
          <ListRow
            title="Folder"
            subtitle={project.rootPath}
            chevron={false}
            accessibilityHint="Long-press to copy the path"
            onLongPress={() =>
              void Clipboard.setStringAsync(project.rootPath ?? '').then(() =>
                toast({ message: 'Path copied.', variant: 'success' }),
              )
            }
          />
        ) : null}
        <ListRow title="Created" trailing={<Value text={relativeTime(project.createdAt)} />} />
        <ListRow title="Status" trailing={<Value text={isArchived(project) ? 'Archived' : 'Active'} />} />
      </ListGroup>

      <View className="pt-4">
        <Button
          label={isArchived(project) ? 'Restore, rename or delete…' : 'Archive, rename or delete…'}
          variant="secondary"
          haptic="tap"
          onPress={() => setMenuOpen(true)}
        />
      </View>

      <ProjectActions project={menuOpen ? project : null} onClose={() => setMenuOpen(false)} onDeleted={onDeleted} />
    </View>
  );
}

function Value({ text }: { text: string }): React.ReactElement {
  return (
    <Text numberOfLines={1} className="max-w-[60%] text-right text-sm text-muted-foreground">
      {text}
    </Text>
  );
}
