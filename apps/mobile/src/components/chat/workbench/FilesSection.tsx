// ────────────────────────────────────────────────────────────────
// Workbench › Files.
//
// The web pane is a collapsible folder tree. A tree on a phone spends most of
// its width on indentation, so this is a BREADCRUMB browser instead: one
// level at a time, folders first, with a search field that flattens the whole
// repo when it has any text. Same information, a third of the taps.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  Code2,
  Eye,
  File,
  Folder,
  FolderTree,
  Home,
  RefreshCw,
  WrapText,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Touchable } from '../../ui/Touchable';
import { IconButton } from '../../ui/Button';
import { SearchField } from '../../ui/Form';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { Markdown } from '../../markdown/Markdown';
import { useApi } from '../../../api/useApi';
import { crumbsFor, levelEntries, type TreeEntry } from './fileTree';
import { Toolbar } from './ChangesSection';
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
  const [aliasFilter, setAliasFilter] = useState<string | null>(null);

  const tree = useQuery({
    queryKey: queryKeys.workspaceTree(workspaceId),
    queryFn: () => api.workspaces.tree(workspaceId),
    // The path set only moves when files are created or deleted, so this can
    // be cached far more aggressively than the change summary.
    staleTime: 60_000,
  });

  const repos = tree.data?.repos ?? [];
  const repo = repos.find((r) => r.alias === aliasFilter) ?? repos[0];
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
      <Toolbar>
        <FolderTree size={14} color={colors['muted-foreground']} />
        <Text className="text-sm font-medium text-foreground">
          {paths.length} file{paths.length === 1 ? '' : 's'}
        </Text>
        {repo?.truncated ? (
          <Text className="text-xs text-warning">truncated</Text>
        ) : null}
        <View className="flex-1" />
        <IconButton
          accessibilityLabel="Refresh files"
          icon={
            <RefreshCw
              size={16}
              color={tree.isFetching ? colors.primary : colors['muted-foreground']}
            />
          }
          onPress={() => void tree.refetch()}
          disabled={tree.isFetching}
        />
      </Toolbar>

      {repos.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{
            gap: 6,
            paddingHorizontal: 12,
            paddingTop: 8,
            alignItems: 'center',
          }}
        >
          {repos.map((r) => {
            const selected = r.alias === repo?.alias;
            return (
              <Touchable
                key={r.alias}
                accessibilityLabel={r.alias === '.' ? 'Workspace root' : r.alias}
                accessibilityState={{ selected }}
                haptic="select"
                onPress={() => {
                  setAliasFilter(r.alias);
                  setPrefix('');
                }}
                className={`min-h-8 justify-center rounded-full border px-2.5 ${
                  selected ? 'border-primary bg-accent' : 'border-border bg-raised'
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    selected ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {r.alias === '.' ? 'workspace root' : r.alias}
                </Text>
              </Touchable>
            );
          })}
        </ScrollView>
      ) : null}

      <View className="gap-2 border-b border-border-muted px-4 py-2.5">
        <SearchField
          placeholder={`Search ${paths.length} files`}
          value={query}
          onChangeText={setQuery}
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
  const { colors } = useTheme();
  const [wrap, setWrap] = useState(false);
  const [rendered, setRendered] = useState(true);

  const file = useQuery({
    queryKey: queryKeys.workspaceFile(workspaceId, path, alias),
    queryFn: () => api.workspaces.treeFile(workspaceId, { path, ...(alias ? { alias } : {}) }),
  });

  const isMarkdown = /\.(md|mdx|markdown)$/i.test(path);

  const lines = useMemo(
    () =>
      (file.data?.contents ?? '')
        .split('\n')
        .map((text, i) => ({ key: String(i + 1), number: i + 1, text })),
    [file.data],
  );

  const body = ((): React.ReactElement => {
    if (file.isLoading) return <LoadingState label="Loading…" />;
    if (file.isError) {
      return <ErrorState message="Could not read this file." onRetry={() => void file.refetch()} />;
    }
    if (file.data?.isBinary) {
      return (
        <EmptyState
          title="Binary file"
          message={`${formatBytes(file.data.size)} — there is nothing to display for this type.`}
        />
      );
    }
    if (file.data?.isTooLarge) {
      return (
        <EmptyState
          title="File is too large to preview"
          message={`${formatBytes(file.data.size)}. Open it on desktop — it would not be readable at this width anyway.`}
        />
      );
    }
    if (isMarkdown && rendered) {
      return (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Markdown content={file.data?.contents ?? ''} />
        </ScrollView>
      );
    }

    const list = (
      <LegendList
        data={lines}
        keyExtractor={(line) => line.key}
        estimatedItemSize={18}
        contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View className="flex-row">
            <Text className="w-10 px-1 text-right font-mono text-xs leading-code text-muted-foreground">
              {item.number}
            </Text>
            <Text
              {...(wrap ? {} : { numberOfLines: 1 })}
              className="flex-1 pr-3 font-mono text-xs leading-code text-foreground"
            >
              {item.text || ' '}
            </Text>
          </View>
        )}
      />
    );

    // Unwrapped, the whole list scrolls sideways as one surface so the gutter
    // cannot drift out of alignment with its code.
    return wrap ? (
      list
    ) : (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: 760 }} className="flex-1">
          {list}
        </View>
      </ScrollView>
    );
  })();

  return (
    <View className="flex-1">
      <Toolbar>
        <File size={14} color={colors['muted-foreground']} />
        <Text numberOfLines={1} className="flex-1 font-mono text-xs text-muted-foreground">
          {path}
        </Text>
        {isMarkdown ? (
          <IconButton
            accessibilityLabel={rendered ? 'Show source' : 'Show rendered preview'}
            selected={rendered}
            icon={
              rendered ? (
                <Code2 size={16} color={colors['muted-foreground']} />
              ) : (
                <Eye size={16} color={colors['muted-foreground']} />
              )
            }
            onPress={() => setRendered((v) => !v)}
          />
        ) : null}
        {!isMarkdown || !rendered ? (
          <IconButton
            accessibilityLabel={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            selected={wrap}
            icon={<WrapText size={16} color={wrap ? colors.primary : colors['muted-foreground']} />}
            onPress={() => setWrap((w) => !w)}
          />
        ) : null}
      </Toolbar>
      {body}
    </View>
  );
}

function formatBytes(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}
