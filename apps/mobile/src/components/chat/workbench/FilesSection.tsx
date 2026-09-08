// ────────────────────────────────────────────────────────────────
// Workbench › Files.
//
// The web pane is a collapsible folder tree. A tree on a phone spends most of
// its width on indentation, so this is a BREADCRUMB browser instead: one
// level at a time, folders first, with a search field that flattens the whole
// repo when it has any text. Same information, a third of the taps.
//
// Preview: markdown rendered (with a source toggle), text through the
// shared `CodeBlock` (highlighted, wrap toggle, copy) or a virtualised line
// list past its budget, images through RN `Image` when the server can hand
// back bytes, and everything else as size + Share.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Share, Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { File as FsFile, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  File,
  FileDiff,
  Folder,
  FolderTree,
  Home,
  RefreshCw,
  Share2,
  WrapText,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Touchable } from '../../ui/Touchable';
import { Button, IconButton } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { SearchField } from '../../ui/Form';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { Markdown } from '../../markdown/Markdown';
import { CodeBlock } from '../../markdown/CodeBlock';
import { HIGHLIGHT_MAX_BYTES, HIGHLIGHT_MAX_LINES } from '../../markdown/highlight';
import { setCodeWrap, useCodeWrap } from '../../markdown/codeWrapStore';
import { useApi } from '../../../api/useApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { Toolbar, formatBytes, languageForPath, splitPath } from '../../changes';
import { crumbsFor, isMarkdownPath, levelEntries, parentPrefix, prefixOf, searchEntries, type TreeEntry } from './fileTree';

export interface FilesSectionProps {
  workspaceId: string;
  active?: boolean;
  /** Open this file on mount, or when it changes (from the Changes pane). */
  focusPath?: string | null;
  focusAlias?: string | null;
  /** Hand a changed file back to the Changes pane. */
  onOpenInChanges?: (path: string, alias?: string) => void;
  /** Controlled detail (legacy Workbench contract). */
  detail?: { path: string; alias?: string } | null;
  onOpenFile?: (path: string, alias?: string) => void;
}

export function FilesSection({
  workspaceId,
  active = true,
  focusPath = null,
  focusAlias = null,
  onOpenInChanges,
  detail: controlledDetail,
  onOpenFile,
}: FilesSectionProps): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const [prefix, setPrefix] = useState('');
  const [query, setQuery] = useState('');
  const [aliasFilter, setAliasFilter] = useState<string | null>(null);
  const [ownDetail, setOwnDetail] = useState<{ path: string; alias: string } | null>(null);

  const tree = useQuery({
    queryKey: queryKeys.workspaceTree(workspaceId),
    queryFn: () => api.workspaces.tree(workspaceId),
    // The path set only moves when files are created or deleted, so this can
    // be cached far more aggressively than the change summary.
    staleTime: 60_000,
    subscribed: active,
  });

  const repos = tree.data?.repos ?? [];
  const repo = repos.find((r) => r.alias === aliasFilter) ?? repos[0];
  const paths = repo?.paths ?? [];

  const openFile = useCallback(
    (path: string, alias: string) => {
      if (onOpenFile) onOpenFile(path, alias);
      else setOwnDetail({ path, alias });
    },
    [onOpenFile],
  );

  useEffect(() => {
    if (!focusPath) return;
    const alias = focusAlias ?? repo?.alias ?? '.';
    setAliasFilter(alias);
    setPrefix(prefixOf(focusPath));
    openFile(focusPath, alias);
  }, [focusPath, focusAlias, openFile, repo?.alias]);

  const entries = useMemo<TreeEntry[]>(
    () => (query.trim() ? searchEntries(paths, query) : levelEntries(paths, prefix)),
    [paths, prefix, query],
  );

  const detail = controlledDetail
    ? { path: controlledDetail.path, alias: controlledDetail.alias ?? repo?.alias ?? '.' }
    : ownDetail;

  if (detail) {
    return (
      <View className="flex-1">
        {!controlledDetail ? (
          <Touchable
            accessibilityLabel="Back to the file list"
            haptic="tap"
            onPress={() => setOwnDetail(null)}
            className="h-9 flex-row items-center gap-1 px-2"
          >
            <ChevronLeft size={18} color={colors.primary} />
            <Text className="text-sm text-primary">{crumbsFor(prefix).at(-1) ?? repo?.alias ?? 'Files'}</Text>
          </Touchable>
        ) : null}
        <FileView
          workspaceId={workspaceId}
          path={detail.path}
          alias={detail.alias}
          onOpenInChanges={onOpenInChanges}
        />
      </View>
    );
  }

  if (tree.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={5} />
      </View>
    );
  }
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
        {repo?.truncated ? <Text className="text-xs text-warning">truncated</Text> : null}
        <View className="flex-1" />
        <IconButton
          accessibilityLabel="Refresh files"
          compact
          icon={<RefreshCw size={16} color={tree.isFetching ? colors.primary : colors['muted-foreground']} />}
          onPress={() => void tree.refetch()}
          disabled={tree.isFetching}
        />
      </Toolbar>

      {repos.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 8, alignItems: 'center' }}
        >
          {repos.map((r) => (
            <Chip
              key={r.alias}
              label={r.alias === '.' ? 'workspace root' : r.alias}
              size="sm"
              selected={r.alias === repo?.alias}
              tone={r.alias === repo?.alias ? 'accent' : 'neutral'}
              onPress={() => {
                setAliasFilter(r.alias);
                setPrefix('');
              }}
            />
          ))}
        </ScrollView>
      ) : null}

      <View className="gap-2 border-b border-border-muted px-4 py-2.5">
        <SearchField placeholder={`Search ${paths.length} files`} value={query} onChangeText={setQuery} />
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
          data={prefix && !query ? [{ name: '..', path: parentPrefix(prefix), isDir: true }, ...entries] : entries}
          keyExtractor={(entry) => `${entry.isDir ? 'd' : 'f'}:${entry.path}`}
          estimatedItemSize={48}
          recycleItems
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Touchable
              accessibilityLabel={item.name === '..' ? 'Up one level' : item.name}
              haptic="tap"
              scale="large"
              onPress={() => (item.isDir ? setPrefix(item.path) : openFile(item.path, repo?.alias ?? '.'))}
              className="min-h-12 flex-row items-center gap-3 px-4 py-2"
            >
              {item.isDir ? (
                <Folder size={16} color={colors.primary} />
              ) : (
                <File size={16} color={colors['muted-foreground']} />
              )}
              <Text numberOfLines={1} ellipsizeMode={query ? 'head' : 'tail'} className="flex-1 text-sm text-foreground">
                {item.name}
              </Text>
              {item.isDir && item.count ? <Text className="text-xs text-muted-foreground">{item.count}</Text> : null}
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
 * than presenting an editor that would 403 on save.
 */
function FileView({
  workspaceId,
  path,
  alias,
  onOpenInChanges,
}: {
  workspaceId: string;
  path: string;
  alias: string;
  onOpenInChanges?: ((path: string, alias?: string) => void) | undefined;
}): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const toast = useToast();
  const wrap = useCodeWrap();
  const [rendered, setRendered] = useState(true);

  const file = useQuery({
    queryKey: queryKeys.workspaceFile(workspaceId, path, alias),
    queryFn: () => api.workspaces.treeFile(workspaceId, { path, ...(alias ? { alias } : {}) }),
  });

  const isMarkdown = isMarkdownPath(path);
  const contents = file.data?.contents ?? '';
  const withinBudget = contents.length <= HIGHLIGHT_MAX_BYTES && contents.split('\n').length <= HIGHLIGHT_MAX_LINES;
  const { name } = splitPath(path);

  const share = useCallback(async () => {
    if (!file.data?.contents) return;
    try {
      if (Platform.OS === 'ios') {
        const target = new FsFile(Paths.cache, name);
        target.write(file.data.contents);
        await Share.share({ url: target.uri, title: name });
      } else {
        await Share.share({ message: file.data.contents, title: name });
      }
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Could not share', tone: 'error' });
    }
  }, [file.data, name, toast]);

  const body = ((): React.ReactElement => {
    if (file.isLoading) return <LoadingState label="Loading…" />;
    if (file.isError) {
      return <ErrorState message="Could not read this file." onRetry={() => void file.refetch()} />;
    }
    if (file.data?.isBinary) {
      return (
        <EmptyState
          title={`${name} is a binary file`}
          message={`${formatBytes(file.data.size)}. The server only serves text through this route, so there is no preview.`}
          icon={<File size={22} color={colors['muted-foreground']} />}
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
          <Markdown content={contents} />
        </ScrollView>
      );
    }
    if (withinBudget) {
      return (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
          <CodeBlock code={contents} language={languageForPath(path, file.data?.lang)} meta={path} />
        </ScrollView>
      );
    }
    return <PlainLines contents={contents} wrap={wrap} />;
  })();

  return (
    <View className="flex-1">
      <Toolbar>
        <File size={14} color={colors['muted-foreground']} />
        <Text numberOfLines={1} ellipsizeMode="head" className="flex-1 font-mono text-xs text-muted-foreground">
          {path}
        </Text>
        {file.data ? <Text className="text-xs text-muted-foreground">{formatBytes(file.data.size)}</Text> : null}
        <IconButton
          accessibilityLabel="Copy path"
          compact
          icon={<Copy size={15} color={colors['muted-foreground']} />}
          onPress={() => {
            void Clipboard.setStringAsync(path);
            toast({ message: 'Path copied', tone: 'success' });
          }}
        />
        {isMarkdown ? (
          <IconButton
            accessibilityLabel={rendered ? 'Show source' : 'Show rendered preview'}
            compact
            selected={rendered}
            icon={rendered ? <Code2 size={16} color={colors['muted-foreground']} /> : <Eye size={16} color={colors['muted-foreground']} />}
            onPress={() => setRendered((v) => !v)}
          />
        ) : null}
        {(!isMarkdown || !rendered) && !withinBudget ? (
          <IconButton
            accessibilityLabel={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            compact
            selected={wrap}
            icon={<WrapText size={16} color={wrap ? colors.primary : colors['muted-foreground']} />}
            onPress={() => setCodeWrap(!wrap)}
          />
        ) : null}
        {file.data?.contents ? (
          <IconButton
            accessibilityLabel="Share file"
            compact
            icon={<Share2 size={16} color={colors['muted-foreground']} />}
            onPress={() => void share()}
          />
        ) : null}
      </Toolbar>
      {body}
      {onOpenInChanges ? (
        <View className="border-t border-border-muted bg-card px-3 py-2">
          <Button
            label="Show changes to this file"
            size="sm"
            variant="ghost"
            icon={<FileDiff size={14} color={colors.primary} />}
            onPress={() => onOpenInChanges(path, alias)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Past the highlight budget: plain, virtualised, numbered lines. */
function PlainLines({ contents, wrap }: { contents: string; wrap: boolean }): React.ReactElement {
  const lines = useMemo(
    () => contents.split('\n').map((text, i) => ({ key: String(i + 1), number: i + 1, text })),
    [contents],
  );
  const longest = useMemo(() => lines.reduce((n, l) => Math.max(n, l.text.length), 0), [lines]);
  const list = (
    <LegendList
      data={lines}
      keyExtractor={(line) => line.key}
      estimatedItemSize={18}
      recycleItems
      extraData={wrap}
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
      renderItem={({ item }) => (
        <View className="flex-row">
          <Text className="w-12 px-1 text-right font-mono text-xs leading-code text-muted-foreground">{item.number}</Text>
          <Text {...(wrap ? {} : { numberOfLines: 1 })} className="flex-1 pr-3 font-mono text-xs leading-code text-foreground">
            {item.text || ' '}
          </Text>
        </View>
      )}
    />
  );
  // Unwrapped, the whole list scrolls sideways as one surface, sized to the
  // longest line, so the gutter cannot drift out of alignment with its code.
  return wrap ? (
    list
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ width: Math.max(360, 60 + longest * 7.2), flex: 1 }}>{list}</View>
    </ScrollView>
  );
}
