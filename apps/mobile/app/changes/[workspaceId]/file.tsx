// ────────────────────────────────────────────────────────────────
// File diff — the flagship "review from the sofa" surface.
//
// Two things make this work on a phone:
//   1. The diff is VIRTUALIZED. A refactor touching 5,000 lines is ordinary,
//      and rendering it eagerly drops frames for seconds.
//   2. The query key includes the BLOB PAIR, not just the path. With a
//      path-only key and any staleTime, editing a file leaves the previous
//      diff on screen — the query looks fresh because the key did not change.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LegendList } from '@legendapp/list/react-native';
import { parseUnifiedDiff, queryKeys, toDiffList, type DiffListItem } from '@generatorai/client-core';

import { useApi } from '../../../src/api/useApi';
import { DiffHunkHeader, DiffRowView } from '../../../src/components/diff/DiffRowView';
import { ErrorState, LoadingState } from '../../../src/components/common/States';

export default function FileDiffScreen(): React.ReactElement {
  const params = useLocalSearchParams<{
    workspaceId: string;
    path: string;
    alias?: string;
    oldBlob?: string;
    newBlob?: string;
  }>();

  const workspaceId = String(params.workspaceId);
  const path = String(params.path);
  const alias = params.alias ? String(params.alias) : undefined;
  const oldBlob = params.oldBlob ? String(params.oldBlob) : undefined;
  const newBlob = params.newBlob ? String(params.newBlob) : undefined;

  const api = useApi();

  const patch = useQuery({
    // Content identity, not just path — see the header note.
    queryKey: queryKeys.changeFile(workspaceId, path, oldBlob, newBlob),
    queryFn: () =>
      api.workspaces.filePatch(workspaceId, {
        path,
        ...(alias ? { alias } : {}),
        ...(oldBlob ? { oldBlob } : {}),
        ...(newBlob ? { newBlob } : {}),
      }),
    // A diff for a specific blob pair is immutable by definition.
    staleTime: Infinity,
  });

  const parsed = useMemo(
    () => (patch.data ? parseUnifiedDiff(patch.data.patch) : null),
    [patch.data],
  );
  const items = useMemo(() => (parsed ? toDiffList(parsed) : []), [parsed]);

  if (patch.isLoading) return <LoadingState />;
  if (patch.error) return <ErrorState message={String(patch.error)} />;
  if (!parsed) return <ErrorState message="No diff available." />;

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 border-b border-border px-3 py-2">
        <Text className="flex-1 font-mono text-xs text-foreground" numberOfLines={1} ellipsizeMode="head">
          {path}
        </Text>
        <Text className="text-xs text-success">+{parsed.additions}</Text>
        <Text className="text-xs text-danger">−{parsed.deletions}</Text>
      </View>

      {(patch.data?.truncated || parsed.truncated) ? (
        <View className="border-b border-warning bg-warning-muted px-3 py-2">
          <Text className="text-xs text-foreground">
            This diff was truncated by the server because the file is very large. Open it on
            desktop to see the rest.
          </Text>
        </View>
      ) : null}

      {items.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-muted-foreground">No textual changes.</Text>
        </View>
      ) : (
        // Horizontal scroll wraps the list so code lines can extend past the
        // screen without wrapping, which would destroy diff alignment.
        <ScrollView horizontal contentContainerStyle={{ minWidth: '100%' }}>
          <View className="flex-1">
            <LegendList
              data={items}
              keyExtractor={(item: DiffListItem) => item.key}
              recycleItems
              estimatedItemSize={18}
              renderItem={({ item }: { item: DiffListItem }) =>
                item.type === 'hunk' ? (
                  <DiffHunkHeader hunk={item.hunk} />
                ) : (
                  <DiffRowView row={item.row} />
                )
              }
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}
