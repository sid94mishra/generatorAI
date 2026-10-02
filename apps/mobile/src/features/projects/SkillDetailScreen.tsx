// Skill (or prompt / agent file) detail (MSkillDetail; `/projects/[id]/skills/[configId]?source=&kind=`): breadcrumb
// "Projects › <project> › Customization"; Project / System, the kind, "1 file · 2.1 KB · Sep 20" and the file path;
// "Enabled in this project" (G-19); the file chip (one file until MG-35 lists a skill's others); the markdown rendered,
// or its source; Delete… · View source · Edit (→ the full-screen editor). System items are read-only.
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { toEpochMs } from '@generatorai/client-core';

import { AssistantText } from '../../blocks/AssistantText';
import { FileContentView } from '../../blocks/FilePreview';
import { PROJECTS_HREF, projectHref, projectTabHref, skillEditHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { BottomToolbar } from '../../ui/layout/BottomToolbar';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { errorText, formatBytes } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { Header } from '../../ui/native/router/Header';
import { Badge } from '../../ui/primitives/Badge';
import { Card } from '../../ui/primitives/Card';
import { Chip } from '../../ui/primitives/Chip';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { KIND_PARAM, KIND_SINGULAR, codebaseFileContent, prefKey, toggleDisabled, type ArtifactKind } from './model/projectsModel';
import { useArtifactPrefs, useConfigWrites, useProject, useProjectConfig, useSetArtifactEnabled, useSystemArtifact } from './queries';

type Href = Parameters<typeof router.replace>[0];
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export default function SkillDetailScreen(): React.ReactElement {
  const { id = '', configId = '', source = 'project', kind: kindParam = 'skill' } = useLocalSearchParams<{ id: string; configId: string; source?: string; kind?: string }>();
  const kind: ArtifactKind = kindParam === 'prompt' || kindParam === 'agent' ? kindParam : 'skill';
  const system = source === 'system';
  const onBack = useHeaderBack();
  const canEditProject = checkFeature('projectEdit', useGrantedScopes()).available;
  const canEdit = canEditProject && !system;
  const project = useProject(id);
  const projectConfig = useProjectConfig(id, system ? '' : configId);
  const systemArtifact = useSystemArtifact(configId, kind, system);
  const prefs = useArtifactPrefs(id);
  const setPrefs = useSetArtifactEnabled(id);
  const writes = useConfigWrites(id);
  const [source_, setSource] = useState(false);

  const config = projectConfig.config;
  const name = system ? (systemArtifact.artifact?.name ?? 'Skill') : (config?.name ?? 'Skill');
  const filePath = system ? (systemArtifact.artifact?.path ?? '') : (config?.filePath ?? '');
  const content = system ? systemArtifact.content : projectConfig.content;
  const text = content.data?.content ?? '';
  const updated = config ? toEpochMs(config.updatedAt as unknown as string) : null;
  const disabled = prefs.data?.disabled ?? [];
  const enabled = !disabled.some((d) => prefKey(d.type, d.id) === prefKey(kind, configId));
  const breadcrumb = useBreadcrumb(
    useMemo(
      () => [
        { label: 'Projects', href: PROJECTS_HREF },
        { label: project.data?.name ?? 'Project', href: projectHref(id) },
        { label: 'Customization', href: projectTabHref(id, 'customization', `kind=${KIND_PARAM[kind]}`) },
      ],
      [project.data?.name, id, kind],
    ),
  );
  const fileName = filePath.split('/').pop() || 'SKILL.md';

  const remove = (): void =>
    void confirm({ title: `Delete ${name}?`, message: `The ${KIND_SINGULAR[kind]} is removed from this project for every chat and run.`, confirmLabel: `Delete ${KIND_SINGULAR[kind]}`, icon: 'trash' }).then((ok) => {
      if (!ok) return;
      writes
        .remove(configId)
        .then(() => (router.canGoBack() ? router.back() : router.replace(projectTabHref(id, 'customization') as Href)))
        .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
    });

  const state = content.isLoading
    ? { kind: 'loading' as const }
    : content.isError
      ? { kind: 'error' as const, error: content.error, onRetry: () => void content.refetch(), title: `Couldn't load this ${KIND_SINGULAR[kind]}` }
      : { kind: 'ready' as const };

  return (
    <Screen
      header={<Header role="detail" title={name} breadcrumb={breadcrumb} onBack={onBack} />}
      state={state}
      bottomAccessory={
        <BottomToolbar
          actions={[
            ...(canEdit ? [{ label: 'Delete', icon: 'trash' as const, variant: 'ghost' as const, onPress: remove, testID: 'skill-delete' }] : []),
            { label: source_ ? 'View rendered' : 'View source', icon: 'braces' as const, onPress: () => setSource((v) => !v), testID: 'skill-source' },
          ]}
          {...(canEdit ? { primary: { label: 'Edit', icon: 'edit' as const, onPress: () => router.push(skillEditHref(id, configId) as never), testID: 'skill-edit' } } : {})}
        />
      }
      testID="skill-detail"
    >
      <View className="gap-4 pb-8 pt-2">
        <View className="gap-1.5 px-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge label={system ? 'System' : 'Project'} icon={system ? 'shield' : 'folder-open'} tone="outline" size="sm" />
            <Text role="subhead" tone="fg-2">
              {KIND_SINGULAR[kind][0]!.toUpperCase() + KIND_SINGULAR[kind].slice(1)}
            </Text>
            <Text role="monoSm" tone="fg-3">
              {['1 file', text ? formatBytes(new TextEncoder().encode(text).length) : null, updated ? dateFormat.format(new Date(updated)) : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {filePath ? (
            <Text role="monoSm" tone="fg-3" selectable>
              {filePath}
            </Text>
          ) : null}
        </View>
        <ListSection>
          <ListRow
            kind="toggle"
            title="Enabled in this project"
            subtitle={`Agents in ${project.data?.name ?? 'this project'} can load it`}
            switchValue={enabled}
            disabled={!canEditProject}
            onValueChange={(v) => setPrefs.mutate({ disabled: toggleDisabled(disabled, kind, configId, v) }, { onError: (e) => toast({ kind: 'error', message: errorText(e) }) })}
            testID="skill-enabled"
          />
        </ListSection>
        <View className="flex-row px-4">
          <Chip label={fileName} icon="file" selected />
        </View>
        <View className="px-4">
          {source_ ? (
            <View className="h-96 overflow-hidden rounded-card">
              <FileContentView path={`${fileName}.txt`} file={{ ...content, data: content.data ? codebaseFileContent(text) : undefined }} />
            </View>
          ) : (
            <Card radius="group">
              <ScrollView scrollEnabled={false}>
                <AssistantText text={text} />
              </ScrollView>
            </Card>
          )}
        </View>
      </View>
    </Screen>
  );
}
