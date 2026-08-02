// ────────────────────────────────────────────────────────────────
// Project detail.
//
// The codebases linked to a project, and their sync state. Read-only for a
// structural reason rather than a missing permission: linking a codebase
// means naming a folder on the machine running GeneratorAI, and a phone
// cannot browse that filesystem. Granting `write:projects` would not change
// that, so the screen says so instead of offering an "Add" button.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2, GitBranch, HardDrive, Info } from 'lucide-react-native';
import { queryKeys, type CodebaseSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { relativeTime } from '../../src/components/runs/formatTime';
import { Badge, Card, SectionHeader, type Tone } from '../../src/components/ui/primitives';
import { PlainScroll } from '../../src/components/ui/Screen';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { useTheme } from '../../src/theme/ThemeProvider';

function statusTone(status: string | undefined): Tone {
  if (status === 'ready' || status === 'synced') return 'success';
  if (status === 'error' || status === 'failed') return 'danger';
  if (status === 'syncing' || status === 'cloning') return 'info';
  return 'neutral';
}

export default function ProjectDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const navigation = useNavigation();
  const { colors } = useTheme();

  const project = useQuery({
    queryKey: queryKeys.project(id!),
    queryFn: () => api.projects.get(id!),
  });

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: project.data?.name ?? 'Project' });
  }, [navigation, project.data?.name]);

  if (project.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={3} />
      </View>
    );
  }
  if (project.isError) {
    return <ErrorState message="Could not load this project." onRetry={() => void project.refetch()} />;
  }

  const codebases = project.data?.codebases ?? [];

  return (
    <PlainScroll onRefresh={() => void project.refetch()} refreshing={project.isFetching}>
      <Card className="gap-2 p-4">
        <View className="flex-row items-center gap-2.5">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-subtle">
            <FolderGit2 size={18} color={colors.primary} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-lg font-semibold text-foreground">{project.data?.name}</Text>
            <Text className="text-xs text-muted-foreground">
              Created {relativeTime(project.data?.createdAt)}
            </Text>
          </View>
        </View>
        {project.data?.description ? (
          <Text className="text-sm leading-relaxed text-muted-foreground">
            {project.data.description}
          </Text>
        ) : null}
      </Card>

      <SectionHeader title={`Codebases (${codebases.length})`} />
      {codebases.length === 0 ? (
        <EmptyState
          title="No codebases linked"
          message="Link one from the machine running GeneratorAI — it points at a folder or remote there."
        />
      ) : (
        <View className="gap-2">
          {codebases.map((codebase) => (
            <CodebaseCard key={codebase.id} codebase={codebase} />
          ))}
        </View>
      )}

      <View className="mt-2 flex-row gap-2.5 rounded-3xl border border-border bg-subtle p-3.5">
        <Info size={16} color={colors['muted-foreground']} />
        <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
          Linking a codebase means naming a folder on the host machine, which this device cannot
          browse. That is a limit of the device, not a permission you can grant.
        </Text>
      </View>
    </PlainScroll>
  );
}

function CodebaseCard({ codebase }: { codebase: CodebaseSummary }): React.ReactElement {
  const { colors } = useTheme();
  const remote = codebase.type === 'git-remote';

  return (
    <Card className="gap-1.5 p-3.5">
      <View className="flex-row items-center gap-2.5">
        {remote ? (
          <GitBranch size={16} color={colors['muted-foreground']} />
        ) : (
          <HardDrive size={16} color={colors['muted-foreground']} />
        )}
        <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
          {codebase.alias}
        </Text>
        {codebase.status ? (
          <Badge label={codebase.status} tone={statusTone(codebase.status)} />
        ) : null}
      </View>
      <Text numberOfLines={2} className="font-mono text-xs text-muted-foreground">
        {codebase.url ?? codebase.localPath ?? codebase.type}
      </Text>
      <Text className="text-xs text-muted-foreground">
        {codebase.defaultBranch ? `${codebase.defaultBranch} · ` : ''}
        {codebase.lastFetchedAt ? `fetched ${relativeTime(codebase.lastFetchedAt)}` : 'never fetched'}
      </Text>
    </Card>
  );
}
