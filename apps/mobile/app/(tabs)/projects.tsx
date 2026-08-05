// ────────────────────────────────────────────────────────────────
// Projects.
//
// Read-only by design, and the reason is structural rather than a missing
// scope: linking a codebase means pointing at a folder on the machine running
// GeneratorAI, and a phone cannot browse that filesystem. Granting
// `write:projects` would not change that, so the screen says so plainly
// instead of offering an "Add" button that could never work.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2 } from 'lucide-react-native';
import { queryKeys, type ProjectSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { relativeTime } from '../../src/components/runs/formatTime';
import { Card } from '../../src/components/ui/primitives';
import { Touchable } from '../../src/components/ui/Touchable';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function ProjectsScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const listRef = useRef<never>(null);

  useScrollToTop('projects', scrollerToTop(listRef));

  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.projects.list(),
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [projects.data, query]);

  const empty = projects.isLoading ? (
    <SkeletonList rows={4} />
  ) : projects.isError ? (
    <ErrorState message="Could not load projects." onRetry={() => void projects.refetch()} />
  ) : query ? (
    <EmptyState title="No matches" message="Nothing here matches that search." />
  ) : (
    <EmptyState
      title="No projects"
      message="Projects group codebases on the machine running GeneratorAI. Create one there and it appears here."
      icon={<FolderGit2 size={22} color={colors['muted-foreground']} />}
    />
  );

  return (
    <Screen title="Projects" trailing={<SettingsButton />} scroll={false}>
      <LegendList
        ref={listRef as never}
        data={visible}
        keyExtractor={(project: ProjectSummary) => project.id}
        estimatedItemSize={66}
        recycleItems
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 10 }}
        ListHeaderComponent={
          <View className="pb-3">
            <SearchField value={query} onChangeText={setQuery} placeholder="Search projects" />
          </View>
        }
        ListEmptyComponent={empty}
        refreshing={projects.isFetching}
        onRefresh={() => void projects.refetch()}
        renderItem={({ item: project }: { item: ProjectSummary }) => (
          <Touchable
            accessibilityLabel={project.name}
            accessibilityHint={project.description ?? undefined}
            haptic="tap"
            scale="large"
            onPress={() => router.push(`/projects/${project.id}`)}
          >
            <Card className="flex-row items-center gap-3 p-3.5">
              <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
                <FolderGit2 size={16} color={colors['muted-foreground']} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text numberOfLines={2} className="text-md font-medium text-foreground">
                  {project.name}
                </Text>
                <Text numberOfLines={2} className="text-xs text-muted-foreground">
                  {project.description ?? `Created ${relativeTime(project.createdAt)}`}
                </Text>
              </View>
            </Card>
          </Touchable>
        )}
      />
    </Screen>
  );
}
