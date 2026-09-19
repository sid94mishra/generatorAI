// ────────────────────────────────────────────────────────────────
// CreateProjectSheet — name, optional description, optional repositories.
//
// Repositories are added by git URL only: the host clones them, so nothing
// about the phone's filesystem is involved. The project is created first and
// each repository linked after it; a repository that fails to link does not
// undo the project — the toast names it and the project opens anyway, where
// the codebase list shows what did land.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { useProjectsApi } from './useProjectsApi';
import {
  aliasFromGitUrl,
  gitCodebaseBodies,
  repoDraftErrors,
  validateProjectName,
  type RepoDraft,
} from './projectEditModel';

export function CreateProjectSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const api = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repos, setRepos] = useState<RepoDraft[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setDescription('');
    setRepos([]);
    setTouched(false);
  }, [visible]);

  const nameError = validateProjectName(name);
  const repoErrors = useMemo(() => repoDraftErrors(repos), [repos]);
  const blocked = Boolean(nameError) || Object.keys(repoErrors).length > 0;

  const create = useMutation({
    mutationFn: async () => {
      const project = await api.create({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      const failed: string[] = [];
      for (const body of gitCodebaseBodies(repos)) {
        try {
          await api.linkGit(project.id, body);
        } catch (err) {
          failed.push(`${body.alias}: ${err instanceof Error ? err.message : 'could not be added'}`);
        }
      }
      return { project, failed };
    },
    onSuccess: ({ project, failed }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      onClose();
      if (failed.length > 0) {
        toast({ message: `Project created, but ${failed.join('; ')}`, variant: 'warning', duration: 6000 });
      } else {
        toast({ message: repos.some((r) => r.url.trim()) ? 'Project created. Cloning…' : 'Project created.', variant: 'success' });
      }
      router.push(`/projects/${project.id}`);
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Could not create the project.', variant: 'danger' }),
  });

  const updateRepo = (index: number, patch: Partial<RepoDraft>): void =>
    setRepos((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="New project"
      detents={[0.95]}
      footer={
        <Button
          label="Create project"
          full
          size="lg"
          loading={create.isPending}
          disabled={blocked || create.isPending}
          onPress={() => {
            setTouched(true);
            if (!blocked) create.mutate();
          }}
        />
      }
    >
      <View className="gap-4 px-4 pb-6 pt-2">
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched(true)}
          placeholder="Payments service"
          autoFocus
          maxLength={120}
          returnKeyType="next"
          error={touched ? nameError : null}
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Optional"
          multiline
          style={{ minHeight: 64, textAlignVertical: 'top' }}
        />

        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="text-sm font-semibold text-muted-foreground">
              Repositories
            </Text>
            <Button
              label="Add repository"
              variant="ghost"
              size="sm"
              haptic="tap"
              icon={<Plus size={16} color={colors.primary} />}
              onPress={() => setRepos((prev) => [...prev, { url: '' }])}
            />
          </View>
          {repos.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              Optional. Add a repository by its git URL and the machine running GeneratorAI clones it.
            </Text>
          ) : (
            repos.map((repo, index) => (
              <View key={index} className="gap-2 rounded-2xl border border-border-muted p-3">
                <View className="flex-row items-start gap-2">
                  <View className="flex-1">
                    <Field
                      label={`Repository ${index + 1} URL`}
                      value={repo.url}
                      onChangeText={(url) => updateRepo(index, { url })}
                      placeholder="https://github.com/owner/repo.git"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      error={repoErrors[index] ?? null}
                    />
                  </View>
                  <View className="pt-6">
                    <IconButton
                      accessibilityLabel={`Remove repository ${index + 1}`}
                      icon={<X size={18} color={colors['muted-foreground']} />}
                      onPress={() => setRepos((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Field
                      label="Alias"
                      value={repo.alias ?? ''}
                      onChangeText={(alias) => updateRepo(index, { alias })}
                      placeholder={aliasFromGitUrl(repo.url) || 'repo'}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <View className="flex-1">
                    <Field
                      label="Branch"
                      value={repo.branch ?? ''}
                      onChangeText={(branch) => updateRepo(index, { branch })}
                      placeholder="Default"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

      </View>
    </Sheet>
  );
}
