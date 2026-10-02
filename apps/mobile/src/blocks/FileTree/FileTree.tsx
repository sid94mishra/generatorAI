// MB-25 FileTree (MPaneFiles): the pane's Files tab — SourcesCard (MB-45) on top, the filter bar ("Filter files…" +
// the sources Select), then per mount a header (alias, "Worktree · <branch>", "N files") and its tree: rows indented
// 16 per level, chevrons on folders, a warn dot on folders holding changes ("has changes"), the change letter on files,
// virtualised as one flattened list. Tap a file → FilePreview (pushed); long-press or the row's actions → Open,
// Mention in chat, Copy path, Share (written to a temp file, then the share sheet).
import React, { useCallback, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { File as FsFile, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import type { WorkspaceTreeRepo } from '@generatorai/client-core';

import { useComposerCapture } from '../Composer/model/captureContext';
import { useWorkspaceMounts } from '../ChangesPanel/ChangesPanel.queries';
import { changeLetter, changeRows, changeTone } from '../ChangesPanel/model/changeKinds';
import { workspaceFileHref } from '../shell/hrefs';
import { MOUNT_MODE_LABEL, SourcesCard } from '../SourcesCard';
import { useChangesSummary } from '../WorkspacePane/WorkspacePane.queries';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { LegendList } from '../../ui/lib/styled';
import { Select } from '../../ui/native/Select';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { useWorkspaceFile, useWorkspaceTree } from './FileTree.queries';
import { flattenTree, searchRows, type TreeRow } from './model/fileTree';

export interface FileTreeProps {
  workspaceId: string | null;
  chatId?: string | null;
  active?: boolean;
  testID?: string;
}

type Item = { type: 'mount'; key: string; repo: WorkspaceTreeRepo; mode?: string; branch?: string } | { type: 'row'; key: string; alias: string; row: TreeRow };

const INDENT = 16;

export function FileTree({ workspaceId, chatId = null, active = true, testID = 'file-tree' }: FileTreeProps): React.ReactElement {
  const sheet = useSheet();
  const capture = useComposerCapture();
  const tree = useWorkspaceTree(workspaceId, active);
  const mounts = useWorkspaceMounts(workspaceId);
  const changes = useChangesSummary(workspaceId);
  const fetchFile = useWorkspaceFile(workspaceId);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const repos = useMemo(() => tree.data?.repos ?? [], [tree.data]);
  const changedByAlias = useMemo(() => {
    const map = new Map<string, Map<string, TreeRow['status']>>();
    for (const row of changeRows(changes.data)) {
      if (!map.has(row.alias)) map.set(row.alias, new Map());
      map.get(row.alias)!.set(row.path, row.status);
    }
    return map;
  }, [changes.data]);
  const mountInfo = useMemo(() => new Map((mounts.data ?? []).map((m) => [m.alias, m])), [mounts.data]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const shown = source === 'all' ? repos : repos.filter((r) => r.alias === source);
    for (const repo of shown) {
      const info = mountInfo.get(repo.alias) as { mode?: string; git?: { branch?: string } | null } | undefined;
      if (shown.length > 1 || repos.length > 1 || info) out.push({ type: 'mount', key: `m:${repo.alias}`, repo, ...(info?.mode ? { mode: info.mode } : {}), ...(info?.git?.branch ? { branch: info.git.branch } : {}) });
      const changed = changedByAlias.get(repo.alias) ?? new Map();
      const rows = query.trim()
        ? searchRows(repo.paths, query, changed)
        : flattenTree(repo.paths, new Set([...expanded].filter((k) => k.startsWith(`${repo.alias}:`)).map((k) => k.slice(repo.alias.length + 1))), changed);
      for (const row of rows) out.push({ type: 'row', key: `${repo.alias}:${row.key}`, alias: repo.alias, row });
    }
    return out;
  }, [repos, source, mountInfo, changedByAlias, query, expanded]);

  const open = useCallback(
    (alias: string, path: string) => {
      if (!workspaceId) return;
      router.push(workspaceFileHref(workspaceId, { path, alias, chat: chatId }) as never);
    },
    [workspaceId, chatId],
  );
  const share = useCallback(
    async (alias: string, path: string) => {
      try {
        const file = await fetchFile(alias, path);
        if (file.contents === null) {
          toast({ kind: 'error', message: 'This file is binary or too large to share from here.' });
          return;
        }
        const name = path.split('/').pop() ?? path;
        const target = new FsFile(Paths.cache, name);
        target.write(file.contents);
        await Share.share({ url: target.uri, title: name });
      } catch {
        toast({ kind: 'error', message: "Couldn't share that file. It may have moved or been deleted." });
      }
    },
    [fetchFile],
  );
  const menu = useCallback(
    (alias: string, row: TreeRow) => {
      haptic('longPress');
      const shownPath = alias !== '.' && repos.length > 1 ? `${alias}/${row.path}` : row.path;
      const after = (run: () => void) => () => {
        sheet.dismiss();
        run();
      };
      sheet.present(
        <ListSection>
          <ListRow kind="navigation" icon="file" title="Open" onPress={after(() => open(alias, row.path))} />
          {capture ? <ListRow kind="navigation" icon="mention" title="Mention in chat" onPress={after(() => capture.mentionPath(shownPath))} /> : null}
          <ListRow kind="navigation" icon="copy" title="Copy path" onPress={after(() => void Clipboard.setStringAsync(row.path))} />
          <ListRow kind="navigation" icon="upload" title="Share" onPress={after(() => void share(alias, row.path))} />
        </ListSection>,
        { title: row.name.split('/').pop() ?? row.name, detents: ['content'] },
      );
    },
    [sheet, open, capture, share, repos.length],
  );
  const toggle = useCallback((key: string) => {
    haptic('selection');
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }): React.ReactElement => {
      if (item.type === 'mount') {
        return (
          <View className="min-h-row flex-row items-center gap-3 px-4 pt-3" accessibilityRole="header" accessible accessibilityLabel={`${item.repo.alias}, ${item.repo.paths.length} files`}>
            <Icon concept="folder-open" size={18} tone="fg-2" />
            <View className="flex-1 gap-0.5">
              <Text role="mono" weight={500} numberOfLines={1}>
                {item.repo.alias === '.' ? 'workspace' : item.repo.alias}
              </Text>
              {item.mode || item.branch ? (
                <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                  {[item.mode ? (MOUNT_MODE_LABEL[item.mode] ?? item.mode) : null, item.branch].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Text role="monoSm" tone="fg-3">{`${item.repo.paths.length}${item.repo.truncated ? '+' : ''} files`}</Text>
          </View>
        );
      }
      const { row, alias } = item;
      return (
        <Pressable
          testID="file-row"
          frame="none"
          onPress={() => (row.isDir ? toggle(`${alias}:${row.path}`) : open(alias, row.path))}
          onLongPress={row.isDir ? undefined : () => menu(alias, row)}
          accessibilityRole="button"
          accessibilityLabel={[row.name, row.isDir ? `folder, ${row.count ?? 0} files` : null, row.dirty ? (row.isDir ? 'has changes' : row.status) : null].filter(Boolean).join(', ')}
          {...(row.isDir ? { accessibilityState: { expanded: row.expanded } } : { accessibilityActions: [{ name: 'menu', label: 'More actions' }], onAccessibilityAction: () => menu(alias, row) })}
          className="min-h-item flex-row items-center gap-2 pe-4"
          style={{ paddingStart: 16 + row.depth * INDENT }}
        >
          {row.isDir ? <Icon concept={row.expanded ? 'chevron-down' : 'chevron-right'} size={14} tone="fg-3" /> : <View className="w-3.5" />}
          <Icon concept={row.isDir ? 'folder-open' : 'file'} size={16} tone="fg-3" />
          <Text role="mono" numberOfLines={1} ellipsizeMode="middle" className="flex-1">
            {row.name}
          </Text>
          {row.isDir && row.dirty ? <View className="size-1.5 rounded-full bg-warn" /> : null}
          {!row.isDir && row.status ? (
            <Text role="monoSm" weight={600} tone={changeTone(row.status)}>
              {changeLetter(row.status)}
            </Text>
          ) : null}
        </Pressable>
      );
    },
    [toggle, open, menu],
  );

  if (!workspaceId) return <EmptyState icon="files" title="No workspace yet" description="A workspace is created the first time the agent runs here." />;

  const header = (
    <View className="gap-3 pb-1 pt-2">
      <SourcesCard mounts={mounts.data ?? []} />
      <View className="flex-row items-center gap-2 px-4">
        <View className="flex-1">
          <SearchInput value={query} onChangeText={setQuery} placeholder="Filter files…" size="compact" testID="file-tree-filter" />
        </View>
        {repos.length > 1 ? (
          <View className="max-w-1/2">
            <Select label="Sources" presentation="field" value={source} onValueChange={setSource} options={[{ value: 'all', label: `All sources ${repos.length}` }, ...repos.map((r) => ({ value: r.alias, label: r.alias === '.' ? 'workspace' : r.alias }))]} testID="file-tree-source" />
          </View>
        ) : null}
      </View>
    </View>
  );

  if (tree.isLoading) {
    return (
      <View testID={testID} className="flex-1">
        {header}
        <View className="px-4" accessibilityLabel="Loading files">
          <Skeleton preset="list" count={6} />
        </View>
      </View>
    );
  }
  if (tree.isError) {
    return (
      <View testID={testID} className="flex-1">
        <ErrorState title="Couldn't load the files" error={tree.error} onRetry={() => void tree.refetch()} />
      </View>
    );
  }

  return (
    <View testID={testID} className="flex-1">
      <LegendList
        data={items}
        keyExtractor={(item: Item) => item.key}
        getItemType={(item: Item) => item.type}
        renderItem={renderItem}
        estimatedItemSize={44}
        recycleItems
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={query.trim() ? <EmptyState copyKey="searchResults" compact action={{ label: 'Clear filter', onPress: () => setQuery('') }} /> : <EmptyState icon="files" title="No files yet" description="This source is empty." compact />}
        contentContainerClassName="pb-8"
        className="flex-1"
      />
    </View>
  );
}
