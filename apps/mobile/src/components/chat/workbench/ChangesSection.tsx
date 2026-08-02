// ────────────────────────────────────────────────────────────────
// Workbench › Changes.
//
// The web surface is a two-pane file tree plus diff. Here it is a list that
// pushes a diff in place. Both views are virtualised: a generated change set
// routinely runs to thousands of hunk lines, and a plain ScrollView renders
// every one of them up front.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { FileDiff } from 'lucide-react-native';
import {
  parseUnifiedDiff,
  queryKeys,
  toDiffList,
  type ChangeFileEntry,
  type DiffListItem,
} from '@generatorai/client-core';

import { Touchable } from '../../ui/Touchable';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { useApi } from '../../../api/useApi';
import { useTheme } from '../../../theme/ThemeProvider';

const STATUS_TONE: Record<ChangeFileEntry['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
};

const STATUS_LETTER: Record<ChangeFileEntry['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

type Row = ChangeFileEntry & { alias: string };

export function ChangesSection({
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

  const changes = useQuery({
    queryKey: queryKeys.changes(workspaceId),
    queryFn: () => api.workspaces.changes(workspaceId),
    staleTime: 10_000,
  });

  const rows = useMemo<Row[]>(
    () =>
      (changes.data?.repos ?? []).flatMap((repo) =>
        repo.files.map((file) => ({ ...file, alias: repo.alias })),
      ),
    [changes.data],
  );

  if (detail) {
    const entry = rows.find((r) => r.path === detail.path);
    return (
      <DiffView
        workspaceId={workspaceId}
        path={detail.path}
        {...(detail.alias ? { alias: detail.alias } : {})}
        {...(entry?.oldBlob ? { oldBlob: entry.oldBlob } : {})}
        {...(entry?.newBlob ? { newBlob: entry.newBlob } : {})}
      />
    );
  }

  if (changes.isLoading) return <View className="p-4"><SkeletonList rows={4} /></View>;
  if (changes.isError) {
    return <ErrorState message="Could not load changes." onRetry={() => void changes.refetch()} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No changes yet"
        message="Files the agent creates or edits show up here as it works."
        icon={<FileDiff size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  const stats = changes.data?.stats;

  return (
    <View className="flex-1">
      {stats ? (
        <View className="flex-row items-center gap-3 border-b border-border-muted px-4 pb-2.5">
          <Text className="text-sm text-muted-foreground">
            {stats.files} file{stats.files === 1 ? '' : 's'}
          </Text>
          <Text className="font-mono text-sm text-success">+{stats.additions}</Text>
          <Text className="font-mono text-sm text-danger">−{stats.deletions}</Text>
        </View>
      ) : null}

      <LegendList
        data={rows}
        keyExtractor={(row) => `${row.alias}:${row.path}`}
        estimatedItemSize={56}
        // Rows are cheap and stateless, so recycling is a straight win here.
        recycleItems
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <Touchable
            accessibilityLabel={item.path}
            haptic="tap"
            scale="large"
            onPress={() => onOpenFile(item.path, item.alias)}
            className="min-h-14 flex-row items-center gap-3 px-4 py-2.5"
          >
            <Text className={`w-4 font-mono text-sm font-bold ${STATUS_TONE[item.status]}`}>
              {STATUS_LETTER[item.status]}
            </Text>
            <View className="flex-1">
              <Text numberOfLines={1} className="text-sm text-foreground">
                {item.path.slice(item.path.lastIndexOf('/') + 1)}
              </Text>
              <Text numberOfLines={1} className="text-xs text-muted-foreground">
                {item.path}
              </Text>
            </View>
            {item.isBinary ? (
              <Text className="text-xs text-muted-foreground">binary</Text>
            ) : (
              <View className="flex-row gap-1.5">
                <Text className="font-mono text-xs text-success">+{item.additions}</Text>
                <Text className="font-mono text-xs text-danger">−{item.deletions}</Text>
              </View>
            )}
          </Touchable>
        )}
      />
    </View>
  );
}

/**
 * One file's unified diff.
 *
 * The query key carries the blob pair, not just the path: with a path-only
 * key and any staleTime, editing a file leaves the previous diff on screen
 * because the key never changed.
 */
function DiffView({
  workspaceId,
  path,
  alias,
  oldBlob,
  newBlob,
}: {
  workspaceId: string;
  path: string;
  alias?: string;
  oldBlob?: string;
  newBlob?: string;
}): React.ReactElement {
  const api = useApi();

  const patch = useQuery({
    queryKey: queryKeys.changeFile(workspaceId, path, oldBlob, newBlob),
    queryFn: () =>
      api.workspaces.filePatch(workspaceId, {
        path,
        ...(alias ? { alias } : {}),
        ...(oldBlob ? { oldBlob } : {}),
        ...(newBlob ? { newBlob } : {}),
      }),
  });

  const lines = useMemo<DiffListItem[]>(
    () => (patch.data?.patch ? toDiffList(parseUnifiedDiff(patch.data.patch)) : []),
    [patch.data],
  );

  if (patch.isLoading) return <LoadingState label="Loading diff…" />;
  if (patch.isError) {
    return <ErrorState message="Could not load this diff." onRetry={() => void patch.refetch()} />;
  }
  if (lines.length === 0) {
    return <EmptyState title="Nothing to show" message="This file has no textual diff." />;
  }

  return (
    <LegendList
      data={lines}
      keyExtractor={(line) => line.key}
      estimatedItemSize={18}
      recycleItems
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
      renderItem={({ item }) =>
        item.type === 'hunk' ? (
          <Text className="bg-subtle px-3 font-mono text-xs leading-code text-info">
            {`@@ -${item.hunk.oldStart},${item.hunk.oldLines} +${item.hunk.newStart},${item.hunk.newLines} @@`}
            {item.hunk.section ? ` ${item.hunk.section}` : ''}
          </Text>
        ) : (
          <View className="flex-row">
            {/* Line numbers are what makes a diff quotable in a follow-up
                prompt, which is most of why anyone reads one on a phone. */}
            <Text className="w-10 px-1 text-right font-mono text-xs leading-code text-muted-foreground">
              {item.row.newNumber ?? item.row.oldNumber ?? ''}
            </Text>
            <Text
              numberOfLines={1}
              className={`flex-1 pr-3 font-mono text-xs leading-code ${
                item.row.kind === 'add'
                  ? 'bg-success-muted text-success'
                  : item.row.kind === 'del'
                    ? 'bg-danger-muted text-danger'
                    : 'text-muted-foreground'
              }`}
            >
              {item.row.content || ' '}
            </Text>
          </View>
        )
      }
    />
  );
}
