// Project (MProjectDetail, MProjectSettings, MProjectCustomization; `/projects/[id]` and `/projects/[id]/[tab]`, R-3):
// detail header "Projects › <name>" with New chat, Run workflow and ⋯ (Add codebase, Settings, Archive, Delete…);
// description, root path and the facts line (created · retention · max codebases); the Needs-you banner (neutral
// card + warn glyph, MD-25); the tab row Codebases · Chats · Runs · Pull requests (MD-36) · Customization · Settings.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { toEpochMs } from '@generatorai/client-core';

import { useOpenAttentionItem } from '../../blocks/AttentionList';
import { NEEDS_YOU_HREF, NEW_CHAT_HREF, PROJECTS_HREF } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { pickTextFile } from '../../services/native/pickTextFile';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { TabRow } from '../../ui/layout/TabRow';
import { errorText } from '../../ui/lib/format';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { Button } from '../../ui/primitives/Button';
import { Card } from '../../ui/primitives/Card';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { ChatsTab } from './components/ChatsTab';
import { CodebasesTab } from './components/CodebasesTab';
import { CustomizationTab } from './components/CustomizationTab';
import { PullRequestsTab } from './components/PullRequestsTab';
import { RunsTab } from './components/RunsTab';
import { SettingsTab, useProjectSettingsForm } from './components/SettingsTab';
import {
  KIND_PARAM,
  PROJECT_TABS,
  PROJECT_TAB_LABEL,
  isArchived,
  kindFromParam,
  projectMenu,
  projectTab,
  retentionShort,
  uploadPlan,
  type CustomizationKind,
  type ProjectMenuId,
  type ProjectTab,
} from './model/projectsModel';
import { useConfigWrites, useProject, useProjectAttention } from './queries';
import { useProjectActions } from './useProjectActions';

type Href = Parameters<typeof router.push>[0];

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const UPLOAD_MAX = 10 * 1024 * 1024;
const UPLOAD_LABEL = { skill: 'Upload skill', prompt: 'Add prompt', agent: 'Add agent' } as const;

export default function ProjectDetailScreen(): React.ReactElement {
  const { id = '', tab: tabParam, kind: kindParam } = useLocalSearchParams<{ id: string; tab?: string; kind?: string }>();
  const onBack = useHeaderBack();
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Projects', href: PROJECTS_HREF }], []));
  const canEdit = checkFeature('projectEdit', useGrantedScopes()).available;
  const project = useProject(id);
  const needsYou = useProjectAttention(id);
  const openItem = useOpenAttentionItem();
  const act = useProjectActions();
  const configs = useConfigWrites(id);
  const [tab, setTab] = useState<ProjectTab>(projectTab(tabParam));
  const [kind, setKind] = useState<CustomizationKind>(kindFromParam(kindParam));
  const form = useProjectSettingsForm(project.data);
  const p = project.data;
  const name = p?.name ?? 'Project';

  const upload = async (): Promise<void> => {
    if (kind === 'mcp') return;
    const picked = await pickTextFile(UPLOAD_MAX);
    if (picked.status === 'cancelled') return;
    if (picked.status === 'too-large') return void toast({ kind: 'error', message: `${picked.name} is over 10 MB.` });
    if (picked.status === 'error') return void toast({ kind: 'error', message: picked.reason });
    const plan = uploadPlan(kind, picked.file.name, picked.file.text);
    configs.upload(kind, plan.name, plan.filePath, picked.file.text).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
  };

  const menu = p ? (projectMenu(p, canEdit).filter((e) => !('id' in e) || !['open', 'new-chat', 'run-workflow'].includes(e.id)) as MenuEntry[]) : [];
  const header = (
    <Header
      role="detail"
      title={name}
      breadcrumb={breadcrumb}
      onBack={onBack}
      actions={[
        { id: 'new-chat', icon: 'edit', label: 'New chat in this project', onPress: () => router.push(`${NEW_CHAT_HREF}?project=${encodeURIComponent(id)}` as Href) },
        { id: 'run', icon: 'play', label: 'Run a workflow', onPress: () => router.push(`/workflows?project=${encodeURIComponent(id)}` as Href) },
        ...(form.dirty && tab === 'settings' ? [{ id: 'save', icon: 'check' as const, label: 'Save settings', onPress: form.save, testID: 'project-settings-save' }] : []),
        ...(p ? [{ id: 'more', icon: 'more' as const, label: 'More', menu, onMenuSelect: (mid: string) => act(mid as ProjectMenuId, p, { needsYou: needsYou.length }) }] : []),
      ]}
    />
  );

  const select = (next: string): void => {
    setTab(next as ProjectTab);
    router.setParams({ tab: next === 'codebases' ? undefined : next } as never);
  };
  const created = p ? toEpochMs(p.createdAt) : null;
  const facts = p
    ? [created ? `created ${dateFormat.format(new Date(created))}` : null, `retention ${retentionShort(p.settings?.worktreeRetention)}`, p.settings?.maxCodebases ? `max ${p.settings.maxCodebases} codebases` : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  const state = project.isLoading
    ? { kind: 'loading' as const }
    : project.isError || !p
      ? { kind: 'error' as const, error: project.error, onRetry: () => void project.refetch(), title: "Couldn't load this project" }
      : { kind: 'ready' as const };

  let body: React.ReactNode = null;
  if (p) {
    switch (tab) {
      case 'codebases':
        body = <CodebasesTab projectId={id} codebases={p.codebases} canEdit={canEdit && !isArchived(p)} />;
        break;
      case 'chats':
        body = <ChatsTab projectId={id} />;
        break;
      case 'runs':
        body = <RunsTab projectId={id} />;
        break;
      case 'pull-requests':
        body = <PullRequestsTab projectId={id} />;
        break;
      case 'customization':
        body = <CustomizationTab projectId={id} projectName={p.name} kind={kind} onKind={(k) => { setKind(k); router.setParams({ kind: KIND_PARAM[k] } as never); }} canEdit={canEdit} />;
        break;
      case 'settings':
        body = <SettingsTab project={p} codebases={p.codebases} needsYou={needsYou.length} canEdit={canEdit} form={form} />;
        break;
    }
  }

  return (
    <Screen
      header={header}
      state={state}
      onRefresh={async () => void (await project.refetch())}
      bottomAccessory={tab === 'customization' && canEdit && kind !== 'mcp' ? <NewAction label={UPLOAD_LABEL[kind]} icon="upload" onPress={() => void upload()} testID="customization-upload" /> : undefined}
      testID="project-detail"
    >
      {p ? (
        <View className="gap-4 pb-8 pt-2">
          <View className="gap-1.5 px-4">
            {p.description ? (
              <Text role="body" tone="fg-2">
                {p.description}
              </Text>
            ) : null}
            {p.rootPath ? (
              <View className="flex-row items-center gap-1.5">
                <Icon concept="folder-open" size={14} tone="fg-3" />
                <Text role="monoSm" tone="fg-3" numberOfLines={1} selectable className="shrink">
                  {p.rootPath}
                </Text>
              </View>
            ) : null}
            <Text role="monoSm" tone="fg-3">
              {facts}
            </Text>
          </View>
          {needsYou.length > 0 ? (
            <View className="px-4">
              <Card radius="gate" outlined testID="project-needs-you">
                <View className="flex-row items-center gap-3">
                  <Icon concept="hand" size={20} tone="warn" />
                  <View className="flex-1 gap-0.5">
                    <Text role="subhead" weight={600}>
                      {`${needsYou.length} need${needsYou.length === 1 ? 's' : ''} you`}
                    </Text>
                    <Text role="footnote" tone="fg-2" numberOfLines={1}>
                      {needsYou.map((i) => i.title).join(' · ')}
                    </Text>
                  </View>
                  <Button label="Review" size="sm" variant="tonal" onPress={() => (needsYou.length === 1 ? openItem(needsYou[0]!) : router.push(NEEDS_YOU_HREF as Href))} testID="project-needs-you-review" />
                </View>
              </Card>
            </View>
          ) : null}
          <TabRow
            tabs={PROJECT_TABS.map((t) => ({
              id: t,
              label: PROJECT_TAB_LABEL[t],
              ...(t === 'codebases' ? { count: p.codebases.length } : t === 'chats' && p.summary?.activeChats !== undefined ? { count: p.summary.activeChats } : t === 'runs' && p.summary?.runs !== undefined ? { count: p.summary.runs } : {}),
            }))}
            active={tab}
            onSelect={select}
            accessibilityLabel="Project sections"
            testID="project-tab"
          />
          {body}
        </View>
      ) : null}
    </Screen>
  );
}

