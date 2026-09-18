// ────────────────────────────────────────────────────────────────
// AddCodebaseSheet — link a repository to a project by git URL.
//
// `POST /projects/:id/codebases` with `type: 'git-remote'` answers as soon
// as the row exists; the clone runs on the host afterwards. The project
// screen polls while the codebase is `pending`/`cloning` and reports the
// outcome (see `cloneEvents`), so this sheet closes immediately.
//
// A local folder is deliberately not offered: see `codebaseLinkLocal`.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { checkFeature } from '../../auth/featureGate';
import { useProjectsApi } from './useProjectsApi';
import { aliasFromGitUrl, gitCodebaseBodies, validateGitUrl } from './projectEditModel';

export function AddCodebaseSheet({
  visible,
  onClose,
  projectId,
  existingAliases,
}: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  existingAliases: readonly string[];
}): React.ReactElement {
  const api = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [branch, setBranch] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setUrl('');
    setAlias('');
    setBranch('');
    setTouched(false);
  }, [visible]);

  const urlError = validateGitUrl(url);

  const link = useMutation({
    mutationFn: () => {
      const [body] = gitCodebaseBodies([{ url, alias, branch }], existingAliases);
      if (!body) throw new Error('Paste the repository URL.');
      return api.linkGit(projectId, body);
    },
    onSuccess: (codebase) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      onClose();
      toast({ message: `Adding ${codebase.alias}. Cloning on your computer…`, variant: 'info' });
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Could not add the repository.', variant: 'danger' }),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Add repository" detents={[0.6, 0.9]}>
      <View className="gap-4 px-4 pb-6 pt-2">
        <Field
          label="Git URL"
          value={url}
          onChangeText={setUrl}
          onBlur={() => setTouched(true)}
          placeholder="https://github.com/owner/repo.git"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={touched && url ? urlError : null}
        />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Field
              label="Alias"
              value={alias}
              onChangeText={setAlias}
              placeholder={aliasFromGitUrl(url) || 'repo'}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View className="flex-1">
            <Field
              label="Branch"
              value={branch}
              onChangeText={setBranch}
              placeholder="Default"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
        <Text className="text-sm leading-relaxed text-muted-foreground">
          {checkFeature('codebaseLinkLocal', []).reason}
        </Text>
        <Button
          label="Add repository"
          full
          size="lg"
          loading={link.isPending}
          disabled={Boolean(urlError) || link.isPending}
          onPress={() => link.mutate()}
        />
      </View>
    </Sheet>
  );
}
