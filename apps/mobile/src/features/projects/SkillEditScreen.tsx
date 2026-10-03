// Skill file editor (MSkillDetail "Edit", MDF-102; `/projects/[id]/skills/[configId]/edit`, full-screen modal, MD-21):
// the listed file in a mono editor; Cancel (guarded while dirty) and the text confirm Save.
import React, { useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { skillHref } from '../../blocks/shell/hrefs';
import { FullScreenEditor } from '../../ui/layout/FullScreenEditor';
import { errorText } from '../../ui/lib/format';
import { haptic } from '../../ui/platform/haptics';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { useConfigWrites, useProjectConfig } from './queries';

type Href = Parameters<typeof router.replace>[0];

export default function SkillEditScreen(): React.ReactElement {
  const { id = '', configId = '' } = useLocalSearchParams<{ id: string; configId: string }>();
  const navigation = useNavigation();
  const { config, content } = useProjectConfig(id, configId);
  const writes = useConfigWrites(id);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const original = content.data?.content ?? '';
  const value = draft ?? original;
  const dirty = draft !== null && draft !== original;
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(skillHref(id, configId) as Href);
  };
  const save = (): void => {
    setSaving(true);
    writes
      .save(configId, value)
      .then(() => {
        haptic('success');
        setDraft(null);
        close();
      })
      .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }))
      .finally(() => setSaving(false));
  };
  return (
    <FullScreenEditor
      title={config?.filePath.split('/').pop() ?? 'Edit'}
      primary={{ label: 'Save', onPress: save, disabled: !dirty, loading: saving }}
      onCancel={close}
      dirty={dirty}
      navigation={navigation as never}
      testID="skill-edit-screen"
    >
      {content.isLoading ? (
        <Skeleton preset="list" count={8} />
      ) : content.isError ? (
        <ErrorState title="Couldn't load the file" error={content.error} onRetry={() => void content.refetch()} />
      ) : (
        <Textarea label={config?.filePath ?? 'File'} value={value} onChangeText={setDraft} mono minRows={16} maxRows={40} testID="skill-edit-text" />
      )}
    </FullScreenEditor>
  );
}
