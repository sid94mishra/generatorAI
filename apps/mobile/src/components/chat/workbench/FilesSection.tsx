// ────────────────────────────────────────────────────────────────
// Workbench › Files.
//
// The web pane is a collapsible folder tree. A tree on a phone spends most of
// its width on indentation, so this is a BREADCRUMB browser instead: one
// level at a time, folders first, with a search field that flattens the whole
// repo when it has any text. Same information, a third of the taps.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, File, Folder, Home } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Touchable } from '../../ui/Touchable';
import { Field } from '../../ui/Form';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { useApi } from '../../../api/useApi';
import { crumbsFor, levelEntries, type TreeEntry } from './fileTree';
import { useTheme } from '../../../theme/ThemeProvider';

export function FilesSection({
  workspaceId,
  detail,
  onOpenFile,
}: {
  workspaceId: string;
  detail: { path: string; alias?: string } | null;
  onOpenFile: (path: string, alias?: string) => void;
}): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const [prefix, setPrefix] = useState('');
  const [query, setQuery] = useState('');

  const tree = useQuery({
    queryKey: queryKeys.workspaceTree(workspaceId),
    queryFn: () => api.workspaces.tree(workspaceId),
    // The path set only moves when files are created or deleted, so this can
    // be cached far more aggressively than the change summary.
    staleTime: 60_000,
  });

  const repo = tree.data?.repos[0];
  const paths = repo?.paths ?? [];

  const entries = useMemo<TreeEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return paths
        .filter((p) => p.toLowerCase().includes(q))
        .slice(0, 200)
        .map((p) => ({ name: p, path: p, isDir: false }));
    }
    return levelEntries(paths, prefix);
  }, [paths, prefix, query]);

  if (detail) {
    return (
      <FileView
        workspaceId={workspaceId}
        path={detail.path}
        {...(detail.alias ?? repo?.alias ? { alias: detail.alias ?? repo!.alias } : {})}
      />
    );
  }

  if (tree.isLoading) return <View className="p-4"><SkeletonList rows={5} /></View>;
  if (tree.isError) {
    return <ErrorState message="Could not list files." onRetry={() => void tree.refetch()} />;
  }

  const crumbs = crumbsFor(prefix);

  return (
    <View className="flex-1">
      <View className="gap-2 border-b border-border-muted px-4 pb-2.5">
        <Field
          placeholder={`Search ${paths.length} files`}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search files"
        />
        {!query ? (
          <View className="flex-row flex-wrap items-center gap-1">
            <Touchable
              accessibilityLabel="Repository root"
              haptic="select"
              onPress={() => setPrefix('')}
              className="h-7 flex-row items-center gap-1 rounded-full bg-subtle px-2"
            >
              <Home size={12} color={colors['muted-foreground']} />
              <Text className="text-xs text-muted-foreground">{repo?.alias ?? 'root'}</Text>
            </Touchable>
            {crumbs.map((crumb, i) => (
              <View key={`${crumb}-${i}`} className="flex-row items-center gap-1">
                <ChevronRight size={12} color={colors['muted-foreground']} />
                <Touchable
                  accessibilityLabel={crumb}
                  haptic="select"
                  onPress={() => setPrefix(`${crumbs.slice(0, i + 1).join('/')}/`)}
                  className="h-7 justify-center rounded-full bg-subtle px-2"
                >
                  <Text className="text-xs text-muted-foreground">{crumb}</Text>
                </Touchable>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {entries.length === 0 ? (
        <EmptyState title="No files" message={query ? 'Nothing matches that search.' : undefined} />
      ) : (
        <LegendList
          data={entries}
          keyExtractor={(entry) => entry.path}
          estimatedItemSize={48}
          recycleItems
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Touchable
              accessibilityLabel={item.name}
              haptic="tap"
              scale="large"
              onPress={() =>
                item.isDir ? setPrefix(item.path) : onOpenFile(item.path, repo?.alias)
              }
              className="min-h-12 flex-row items-center gap-3 px-4 py-2"
            >
              {item.isDir ? (
                <Folder size={16} color={colors.primary} />
              ) : (
                <File size={16} color={colors['muted-foreground']} />
              )}
              <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                {item.name}
              </Text>
              {item.isDir ? <ChevronRight size={16} color={colors['muted-foreground']} /> : null}
            </Touchable>
          )}
        />
      )}
    </View>
  );
}

/**
 * File contents, read-only.
 *
 * Mobile holds no `write:files` scope, so this is a viewer and says so rather
 * than presenting an editor that would 403 on save. Line numbers are rendered
 * because the whole point of reading a file here is to quote it back to the
 * agent in the next prompt.
 */
function FileView({
  workspaceId,
  path,
  alias,
}: {
  workspaceId: string;
  path: string;
  alias?: string;
}): React.ReactElement {
  const api = useApi();

  const file = useQuery({
    queryKey: queryKeys.workspaceFile(workspaceId, path, alias),
    queryFn: () => api.workspaces.treeFile(workspaceId, { path, ...(alias ? { alias } : {}) }),
  });

  const lines = useMemo(
    () =>
      (file.data?.contents ?? '')
        .split('\n')
        .map((text, i) => ({ key: String(i + 1), number: i + 1, text })),
    [file.data],
  );

  if (file.isLoading) return <LoadingState label="Loading file…" />;
  if (file.isError) {
    return <ErrorState message="Could not read this file." onRetry={() => void file.refetch()} />;
  }
  if (file.data?.isBinary) {
    return <EmptyState title="Binary file" message="There is nothing to display for this type." />;
  }
  if (file.data?.isTooLarge) {
    return (
      <EmptyState
        title="File is too large"
        message="Open it on desktop — sending it to a phone would not be readable anyway."
      />
    );
  }

  return (
    <LegendList
      data={lines}
      keyExtractor={(line) => line.key}
      estimatedItemSize={18}
      recycleItems
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
      renderItem={({ item }) => (
        <View className="flex-row">
          <Text className="w-10 px-1 text-right font-mono text-xs leading-code text-muted-foreground">
            {item.number}
          </Text>
          <Text className="flex-1 pr-3 font-mono text-xs leading-code text-foreground">
            {item.text || ' '}
          </Text>
        </View>
      )}
    />
  );
}
