// Project › Codebases (MProjectDetail): "Add codebase", one row per codebase — alias, health word (Ready / Cloning /
// Error …), the remote or path in mono · the default branch, "fetched 4m ago"; a cloning codebase shows the clone's
// progress from its log (G-16). ⋯ menu: Fetch, Logs, Worktrees, Copy path | Remove codebase… (confirmed).
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { CodebaseSummary } from '@generatorai/client-core';
import { toEpochMs } from '@generatorai/client-core';

import { addCodebaseHref, codebaseHref, codebaseLogsHref } from '../../../blocks/shell/hrefs';
import { EntityRow } from '../../../ui/layout/EntityRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { formatRelativeShort, errorText } from '../../../ui/lib/format';
import { confirm } from '../../../ui/native/AlertDialog';
import { Menu } from '../../../ui/native/Menu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { overflowIcon } from '../../../ui/platform/overflow';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { IconButton } from '../../../ui/primitives/IconButton';
import { ProgressBar } from '../../../ui/primitives/ProgressBar';
import { StatusDot } from '../../../ui/primitives/StatusDot';
import { Text } from '../../../ui/primitives/Text';
import { toast } from '../../../ui/primitives/Toast';
import { codebaseHealth, codebaseLocation, logProgress } from '../model/projectsModel';
import { useCodebaseLogs, useCodebaseWrites } from '../queries';

type Href = Parameters<typeof router.push>[0];

function CloneProgress({ projectId, codebaseId }: { projectId: string; codebaseId: string }): React.ReactElement {
  const logs = useCodebaseLogs(projectId, codebaseId);
  const progress = logProgress(logs.data?.lines ?? []);
  return <ProgressBar {...(progress ? { value: progress.percent / 100, label: progress.phase, valueText: `${progress.percent}%` } : { accessibilityLabel: 'Cloning' })} />;
}

function CodebaseRow({ projectId, codebase, canEdit, position }: { projectId: string; codebase: CodebaseSummary; canEdit: boolean; position: 'first' | 'middle' | 'last' | 'only' }): React.ReactElement {
  const writes = useCodebaseWrites(projectId);
  const health = codebaseHealth(codebase.status);
  const location = codebaseLocation(codebase);
  const fetched = toEpochMs(codebase.lastFetchedAt ?? null);
  const remote = codebase.type === 'git-remote';
  const menu: MenuEntry[] = [
    ...(remote && canEdit ? [{ id: 'fetch', label: 'Fetch', icon: 'refresh' as const }] : []),
    { id: 'logs', label: 'Logs', icon: 'file-text' },
    { id: 'worktrees', label: 'Worktrees', icon: 'branch' },
    ...(location ? [{ id: 'copy', label: 'Copy path', icon: 'copy' as const }] : []),
    ...(canEdit ? [{ type: 'separator' as const }, { id: 'remove', label: 'Remove codebase…', icon: 'trash' as const, destructive: true }] : []),
  ];
  const onMenu = (id: string): void => {
    switch (id) {
      case 'fetch':
        writes
          .fetch(codebase.id)
          .then(() => router.push(codebaseLogsHref(projectId, codebase.id) as Href))
          .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        return;
      case 'logs':
        router.push(codebaseLogsHref(projectId, codebase.id) as Href);
        return;
      case 'worktrees':
        router.push(codebaseHref(projectId, codebase.id) as Href);
        return;
      case 'copy':
        void Clipboard.setStringAsync(codebase.url ?? codebase.localPath ?? location);
        return;
      case 'remove':
        void confirm({
          title: `Remove ${codebase.alias}?`,
          message: remote ? 'The clone and its worktrees are deleted from the server. The remote repository is not touched.' : 'The codebase is unlinked from this project. The folder on the server stays.',
          confirmLabel: 'Remove codebase',
          icon: 'trash',
        }).then((ok) => {
          if (ok) writes.unlink(codebase.id).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        });
    }
  };
  return (
    <EntityRow
      title={codebase.alias}
      leading={{ icon: remote ? 'branch' : 'folder-open' }}
      meta={[
        <View key="h" className="flex-row items-center gap-1">
          <StatusDot health={health.tone} size="sm" />
          <Text role="footnote" tone="fg-2">
            {health.label}
          </Text>
        </View>,
        ...(fetched && remote ? [`fetched ${formatRelativeShort(new Date(fetched).toISOString())} ago`] : []),
      ]}
      metaLabel={health.label}
      footer={
        health.busy ? (
          <View className="flex-1">
            <CloneProgress projectId={projectId} codebaseId={codebase.id} />
          </View>
        ) : codebase.status === 'error' && codebase.lastError ? (
          <Text role="footnote" tone="err" numberOfLines={2}>
            {codebase.lastError}
          </Text>
        ) : (
          <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
            {[location, codebase.defaultBranch].filter(Boolean).join(' · ')}
          </Text>
        )
      }
      trailing={<Menu items={menu} onSelect={onMenu} accessibilityLabel={`More for ${codebase.alias}`} trigger={<IconButton icon={overflowIcon} label={`More for ${codebase.alias}`} size="sm" onPress={() => undefined} />} />}
      menu={menu}
      onMenuSelect={onMenu}
      onPress={() => router.push((health.busy ? codebaseLogsHref(projectId, codebase.id) : codebaseHref(projectId, codebase.id)) as Href)}
      position={position}
      testID={`codebase-row-${codebase.id}`}
    />
  );
}

export function CodebasesTab({ projectId, codebases, canEdit }: { projectId: string; codebases: readonly CodebaseSummary[]; canEdit: boolean }): React.ReactElement {
  return (
    <View className="gap-3">
      {canEdit ? (
        <View className="flex-row justify-end px-4">
          <Button label="Add codebase" icon="plus" size="sm" onPress={() => router.push(addCodebaseHref(projectId) as Href)} testID="project-add-codebase" />
        </View>
      ) : null}
      {codebases.length === 0 ? (
        <EmptyState copyKey="codebases" {...(canEdit ? { action: { label: 'Add codebase', icon: 'plus' as const, onPress: () => router.push(addCodebaseHref(projectId) as Href) } } : {})} />
      ) : (
        <ListSection footer="Repositories are cloned under the project root. Every chat and run works in its own worktree.">
          {codebases.map((c, i) => (
            <CodebaseRow key={c.id} projectId={projectId} codebase={c} canEdit={canEdit} position={codebases.length === 1 ? 'only' : i === 0 ? 'first' : i === codebases.length - 1 ? 'last' : 'middle'} />
          ))}
        </ListSection>
      )}
    </View>
  );
}
