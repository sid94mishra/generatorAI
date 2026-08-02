// ────────────────────────────────────────────────────────────────
// Changes — file list for a workspace.
//
// Summary-first, matching the server's design: the list carries per-file
// stats and blob SHAs, and a file's actual diff is fetched only when opened.
// A run touching 300 files must not pull 300 patches to render a list.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { queryKeys, type ChangeFileEntry } from '@generatorai/client-core';

import { useApi } from '../../../src/api/useApi';
import { Card } from '../../../src/components/ui/primitives';
import { Touchable } from '../../../src/components/ui/Touchable';
import { SkeletonList } from '../../../src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../src/components/ui/States';
import { useTheme } from '../../../src/theme/ThemeProvider';

const STATUS_MARK: Record<ChangeFileEntry['status'], [string, string]> = {
  added: ['A', 'text-success'],
  modified: ['M', 'text-info'],
  deleted: ['D', 'text-danger'],
  renamed: ['R', 'text-done'],
};

export default function ChangesScreen(): React.ReactElement {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const id = String(workspaceId);
  const api = useApi();
  const { colors } = useTheme();

  const changes = useQuery({
    queryKey: queryKeys.changes(id),
    queryFn: () => api.workspaces.changes(id),
  });

  if (changes.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={6} />
      </View>
    );
  }
  if (changes.error) {
    return <ErrorState message={String(changes.error)} onRetry={() => void changes.refetch()} />;
  }

  const data = changes.data;
  if (!data) return <ErrorState title="No change data" />;

  if (!data.hasGit) {
    return (
      <EmptyState
        title="Not a git repository"
        message="This workspace has no git history, so there is nothing to diff."
      />
    );
  }

  return (
    <ScrollView
      contentContainerClassName="gap-4 px-4 py-4 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={changes.isFetching}
          onRefresh={() => void changes.refetch()}
          tintColor={colors['muted-foreground']}
        />
      }
    >
      <View className="flex-row gap-4">
        <Text className="text-sm text-muted-foreground">
          {data.stats.files} {data.stats.files === 1 ? 'file' : 'files'}
        </Text>
        <Text className="font-mono text-sm text-success">+{data.stats.additions}</Text>
        <Text className="font-mono text-sm text-danger">−{data.stats.deletions}</Text>
      </View>

      {data.repos.length === 0 || data.stats.files === 0 ? (
        <EmptyState
          title="No changes yet"
          message="Files the agent creates or edits appear here as it works."
        />
      ) : (
        data.repos.map((repo) => (
          <View key={repo.alias} className="gap-2">
            {data.repos.length > 1 ? (
              <Text className="text-xs uppercase tracking-wide text-muted-foreground">
                {repo.alias === '.' ? 'workspace' : repo.alias}
              </Text>
            ) : null}
            {repo.files.map((file) => {
              const [mark, colour] = STATUS_MARK[file.status];
              const unopenable = file.isBinary || file.isTooLarge;
              return (
                <Touchable
                  key={`${repo.alias}:${file.path}`}
                  accessibilityLabel={file.path}
                  disabled={unopenable}
                  haptic="tap"
                  scale="large"
                  onPress={() =>
                    router.push({
                      pathname: '/changes/[workspaceId]/file',
                      params: {
                        workspaceId: id,
                        path: file.path,
                        alias: repo.alias,
                        oldBlob: file.oldBlob ?? '',
                        newBlob: file.newBlob ?? '',
                      },
                    })
                  }
                >
                  <Card className="flex-row items-center gap-3 p-3.5">
                    <Text className={`w-4 font-mono text-sm font-bold ${colour}`}>{mark}</Text>
                    <View className="flex-1">
                      {/* Head-truncate: the filename matters far more than the
                          leading directories on a narrow screen. */}
                      <Text
                        className="text-sm text-foreground"
                        numberOfLines={1}
                        ellipsizeMode="head"
                      >
                        {file.path}
                      </Text>
                      {file.isBinary ? (
                        <Text className="text-xs text-muted-foreground">Binary file</Text>
                      ) : file.isTooLarge ? (
                        <Text className="text-xs text-muted-foreground">Too large to display</Text>
                      ) : null}
                    </View>
                    {!unopenable ? (
                      <View className="flex-row gap-2">
                        <Text className="font-mono text-xs text-success">+{file.additions}</Text>
                        <Text className="font-mono text-xs text-danger">−{file.deletions}</Text>
                      </View>
                    ) : null}
                  </Card>
                </Touchable>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}
