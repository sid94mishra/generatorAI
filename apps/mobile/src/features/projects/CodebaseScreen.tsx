// Codebase (MCodebase, MCodebaseFiles; `/projects/[id]/codebases/[cid]` and `…/files`): breadcrumb "Projects ›
// <project>", the alias; Logs and ⋯ (Fetch, Logs, Copy path). Meta card — source, health, the remote / path (copy),
// default branch (a Select of the codebase's branches, saved at once), last fetched + Fetch. Worktrees / Files.
// Worktrees (G-17): All / Active / Orphaned / Completed, "1.27 GB on disk", "Clean up orphans" (a confirmation sheet
// listing them with sizes, "Remove · frees 385 MB", MDF-29), rows with the branch, a neutral state badge (MD-25), the
// chat or run it serves, the time, size and expiry; ⋯ Open linked, Remove…
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { toEpochMs } from '@generatorai/client-core';
import type { WorktreeListItem } from '@generatorai/shared';

import { PROJECTS_HREF, chatHref, codebaseLogsHref, projectHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { errorText, formatBytes, formatRelativeShort } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { Menu } from '../../ui/native/Menu';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { useSheet } from '../../ui/native/Sheet';
import { overflowIcon } from '../../ui/platform/overflow';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Card } from '../../ui/primitives/Card';
import { ChipGroup } from '../../ui/primitives/ChipGroup';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { IconButton } from '../../ui/primitives/IconButton';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { CodebaseFilesTab } from './components/CodebaseFilesTab';
import {
  canRemoveWorktree,
  cleanupSummary,
  codebaseHealth,
  codebaseTypeLabel,
  filterWorktrees,
  orphanCleanup,
  worktreeCounts,
  worktreeStatusLabel,
  type WorktreeFilter,
} from './model/projectsModel';
import { useCodebaseBranches, useCodebaseWorktrees, useCodebaseWrites, useProject } from './queries';

type Href = Parameters<typeof router.push>[0];
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function linkHref(item: WorktreeListItem): string | null {
  if (!item.link) return null;
  return item.link.entity === 'chat' ? chatHref(item.link.id) : null;
}

function WorktreesTab({ projectId, codebaseId, canEdit }: { projectId: string; codebaseId: string; canEdit: boolean }): React.ReactElement {
  const sheet = useSheet();
  const worktrees = useCodebaseWorktrees(projectId, codebaseId);
  const writes = useCodebaseWrites(projectId);
  const [filter, setFilter] = useState<WorktreeFilter>('all');
  const items = useMemo(() => worktrees.data?.items ?? [], [worktrees.data]);
  const counts = worktreeCounts(items);
  const shown = filterWorktrees(items, filter);
  const orphans = orphanCleanup(items);

  const cleanUp = (): void =>
    sheet.present(
      <View className="gap-4 pb-4">
        <Text role="body" tone="fg-2">
          They have no live chat or run. Their folders are deleted; uncommitted changes in them are lost.
        </Text>
        <ListSection>
          {orphans.items.map((w) => (
            <EntityRow key={w.id} title={w.branchName} titleMono leading={{ icon: 'branch' }} trailing={w.sizeBytes !== undefined ? <Text role="monoSm" tone="fg-3">{formatBytes(w.sizeBytes)}</Text> : undefined} onPress={() => undefined} />
          ))}
        </ListSection>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="Cancel" size="lg" fullWidth onPress={() => sheet.dismiss()} />
          </View>
          <View className="flex-1">
            <Button
              label={orphans.bytes !== null ? `Remove · frees ${formatBytes(orphans.bytes)}` : 'Remove'}
              variant="destructive"
              size="lg"
              fullWidth
              onPress={() => {
                sheet.dismiss();
                writes
                  .cleanupWorktrees(codebaseId)
                  .then((r) => toast({ kind: 'background', message: cleanupSummary(r) }))
                  .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
              }}
              testID="worktrees-cleanup-confirm"
            />
          </View>
        </View>
      </View>,
      { title: `Remove ${orphans.items.length} orphaned worktree${orphans.items.length === 1 ? '' : 's'}?`, detents: ['content'] },
    );

  if (worktrees.isLoading) return <Skeleton preset="list" count={4} />;
  if (worktrees.isError) return <ErrorState title="Couldn't load worktrees" error={worktrees.error} onRetry={() => void worktrees.refetch()} />;
  return (
    <View className="gap-3">
      <ChipGroup
        accessibilityLabel="Filter worktrees"
        selection="single"
        value={filter}
        onValueChange={(v) => setFilter(v as WorktreeFilter)}
        items={(['all', 'active', 'orphaned', 'completed'] as const).map((f) => ({ id: f, label: f === 'all' ? 'All' : worktreeStatusLabel(f), count: counts[f] }))}
        testID="worktrees-filter"
      />
      <View className="min-h-hit flex-row items-center justify-between px-4">
        <Text role="monoSm" tone="fg-3">
          {worktrees.data?.totalBytes !== undefined ? `${formatBytes(worktrees.data.totalBytes)} on disk` : ''}
        </Text>
        {canEdit && orphans.items.length > 0 ? <Button label="Clean up orphans" icon="trash" size="sm" onPress={cleanUp} testID="worktrees-cleanup" /> : null}
      </View>
      {shown.length === 0 ? (
        <EmptyState copyKey="worktrees" compact />
      ) : (
        <ListSection>
          {shown.map((w, i) => {
            const linked = linkHref(w);
            const menu: MenuEntry[] = [
              ...(linked ? [{ id: 'open', label: `Open ${w.link!.entity === 'chat' ? 'chat' : 'run'}`, icon: 'external-link' as const }] : []),
              { id: 'copy', label: 'Copy path', icon: 'copy' },
              ...(canEdit && canRemoveWorktree(w.status) ? [{ type: 'separator' as const }, { id: 'remove', label: 'Remove…', icon: 'trash' as const, destructive: true }] : []),
            ];
            const onMenu = (id: string): void => {
              if (id === 'open' && linked) router.push(linked as Href);
              else if (id === 'copy') void Clipboard.setStringAsync(w.worktreePath);
              else if (id === 'remove')
                void confirm({ title: `Remove ${w.branchName}?`, message: 'The worktree folder is deleted; uncommitted changes in it are lost.', confirmLabel: 'Remove worktree', icon: 'trash' }).then((ok) => {
                  if (ok) writes.removeWorktree(codebaseId, w.id).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
                });
            };
            const created = toEpochMs(w.createdAt as unknown as string);
            const expires = w.expiresAt ? `expires ${formatRelativeShort(w.expiresAt)}` : null;
            return (
              <EntityRow
                key={w.id}
                title={w.branchName}
                titleMono
                leading={{ icon: 'branch' }}
                trailing={<Badge label={worktreeStatusLabel(w.status)} size="sm" />}
                meta={w.link ? [w.link.title] : []}
                footer={
                  <Text role="monoSm" tone="fg-3">
                    {[created ? clock.format(new Date(created)) : null, w.sizeBytes !== undefined ? formatBytes(w.sizeBytes) : null, expires].filter(Boolean).join(' · ')}
                  </Text>
                }
                menu={menu}
                onMenuSelect={onMenu}
                onPress={() => (linked ? router.push(linked as Href) : onMenu('copy'))}
                position={shown.length === 1 ? 'only' : i === 0 ? 'first' : i === shown.length - 1 ? 'last' : 'middle'}
                testID={`worktree-row-${w.id}`}
              />
            );
          })}
        </ListSection>
      )}
    </View>
  );
}

export default function CodebaseScreen(): React.ReactElement {
  const { id = '', cid = '', tab: tabParam } = useLocalSearchParams<{ id: string; cid: string; tab?: string }>();
  const onBack = useHeaderBack();
  const canEdit = checkFeature('projectEdit', useGrantedScopes()).available;
  const project = useProject(id);
  const codebase = project.data?.codebases.find((c) => c.id === cid);
  const writes = useCodebaseWrites(id);
  const git = codebase?.type !== 'local-dir';
  const branches = useCodebaseBranches(id, cid, Boolean(codebase) && git);
  const [tab, setTab] = useState<'worktrees' | 'files'>(tabParam === 'files' ? 'files' : 'worktrees');
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Projects', href: PROJECTS_HREF }, { label: project.data?.name ?? 'Project', href: projectHref(id) }], [project.data?.name, id]));
  const health = codebaseHealth(codebase?.status);
  const fetched = toEpochMs(codebase?.lastFetchedAt ?? null);
  const location = codebase?.url ?? codebase?.localPath ?? '';
  const remote = codebase?.type === 'git-remote';

  const fetchNow = (): void => {
    writes
      .fetch(cid)
      .then(() => router.push(codebaseLogsHref(id, cid) as Href))
      .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
  };
  const menu: MenuEntry[] = [
    ...(remote && canEdit ? [{ id: 'fetch', label: 'Fetch', icon: 'refresh' as const }] : []),
    { id: 'logs', label: 'Logs', icon: 'file-text' },
    ...(location ? [{ id: 'copy', label: 'Copy path', icon: 'copy' as const }] : []),
  ];
  const onMenu = (mid: string): void => {
    if (mid === 'fetch') fetchNow();
    else if (mid === 'logs') router.push(codebaseLogsHref(id, cid) as Href);
    else if (mid === 'copy') void Clipboard.setStringAsync(location);
  };
  const branchOptions = (branches.data ?? []).filter((b) => !b.startsWith('origin/HEAD')).map((b) => b.replace(/^origin\//, ''));
  const uniqueBranches = [...new Set([...(codebase?.defaultBranch ? [codebase.defaultBranch] : []), ...branchOptions])];

  const header = (
    <Header
      role="detail"
      title={codebase?.alias ?? 'Codebase'}
      breadcrumb={breadcrumb}
      onBack={onBack}
      actions={[
        { id: 'logs', icon: 'file-text', label: 'Logs', onPress: () => router.push(codebaseLogsHref(id, cid) as Href) },
        { id: 'more', icon: 'more', label: 'More', menu, onMenuSelect: onMenu },
      ]}
    />
  );
  const state = project.isLoading
    ? { kind: 'loading' as const }
    : project.isError || !codebase
      ? { kind: 'error' as const, error: project.error ?? new Error('This codebase no longer exists.'), onRetry: () => void project.refetch(), title: "Couldn't load this codebase" }
      : { kind: 'ready' as const };

  return (
    <Screen header={header} state={state} onRefresh={async () => void (await project.refetch())} testID="codebase">
      {codebase ? (
        <View className="gap-4 pb-8 pt-2">
          <View className="px-4">
            <Card radius="group" testID="codebase-meta">
              <View className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text role="footnote" tone="fg-2">
                    {codebaseTypeLabel(codebase.type)}
                  </Text>
                  <View className="flex-row items-center gap-1.5">
                    <StatusDot health={health.tone} size="sm" />
                    <Text role="footnote" tone="fg-2">
                      {health.label}
                    </Text>
                  </View>
                </View>
                {location ? (
                  <View className="flex-row items-center gap-2">
                    <Text role="mono" numberOfLines={1} selectable className="flex-1">
                      {location}
                    </Text>
                    <IconButton icon="copy" size="sm" label="Copy path" onPress={() => void Clipboard.setStringAsync(location)} />
                  </View>
                ) : null}
                <View className="flex-row items-end gap-3">
                  {git ? (
                    <View className="flex-1">
                      <Select
                        label="Default branch"
                        value={codebase.defaultBranch ?? null}
                        placeholder="Not set"
                        options={uniqueBranches.map((b) => ({ value: b, label: b }))}
                        searchable={uniqueBranches.length > 20}
                        disabled={!canEdit || uniqueBranches.length === 0}
                        onValueChange={(b) => writes.setDefaultBranch(cid, b).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }))}
                        presentation="field"
                        testID="codebase-default-branch"
                      />
                    </View>
                  ) : null}
                  {remote ? (
                    <View className="flex-1 gap-0.5">
                      <Text role="caption" tone="fg-3">
                        Last fetched
                      </Text>
                      <Text role="subhead" weight={600}>
                        {fetched ? `${formatRelativeShort(new Date(fetched).toISOString())} ago` : 'Never'}
                      </Text>
                    </View>
                  ) : null}
                  {remote && canEdit ? <Button label="Fetch" icon="refresh" size="sm" onPress={fetchNow} testID="codebase-fetch" /> : null}
                </View>
                {codebase.status === 'error' && codebase.lastError ? (
                  <Text role="footnote" tone="err">
                    {codebase.lastError}
                  </Text>
                ) : null}
              </View>
            </Card>
          </View>
          <View className="px-4">
            <SegmentedControl<'worktrees' | 'files'>
              accessibilityLabel="Codebase view"
              value={tab}
              onValueChange={setTab}
              segments={[
                { value: 'worktrees', label: 'Worktrees' },
                { value: 'files', label: 'Files' },
              ]}
              fullWidth
              testID="codebase-tab"
            />
          </View>
          {tab === 'worktrees' ? <WorktreesTab projectId={id} codebaseId={cid} canEdit={canEdit} /> : <CodebaseFilesTab projectId={id} codebaseId={cid} />}
        </View>
      ) : null}
    </Screen>
  );
}
