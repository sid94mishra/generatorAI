// ────────────────────────────────────────────────────────────────
// Projects · Agents.
//
// Projects are read-only by design, and the reason is structural rather
// than a missing scope: linking a codebase means pointing at a folder on
// the machine running GeneratorAI, and a phone cannot browse that
// filesystem. The screen says so plainly instead of offering an "Add"
// button that could never work.
//
// Agents moved here from Settings (plan §6.2): they are authoring, not
// preferences. Read-only on the phone — tap a row for the detail sheet.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, FolderGit2 } from 'lucide-react-native';
import { queryKeys, type AgentSummary, type ProjectSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { relativeTime } from '../../src/components/runs/formatTime';
import { AgentCard } from '../../src/components/work/cards';
import { AgentDetailSheet } from '../../src/components/work/AgentDetailSheet';
import { Card } from '../../src/components/ui/primitives';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { haptics } from '../../src/components/ui/haptics';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

type Segment = 'projects' | 'agents';

type Row = { kind: 'project'; item: ProjectSummary } | { kind: 'agent'; item: AgentSummary };

export default function ProjectsScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  // `?segment=agents` deep link (Home quick actions, pushes) mirrors the Work tab.
  const params = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState<Segment>(params.segment === 'agents' ? 'agents' : 'projects');
  const [query, setQuery] = useState('');
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const listRef = useRef<never>(null);

  useScrollToTop('projects', scrollerToTop(listRef));

  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.projects.list(),
  });

  const agents = useQuery({
    queryKey: ['agents', 'all'] as const,
    queryFn: () => api.agents.list(),
  });

  const active = segment === 'projects' ? projects : agents;

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (segment === 'projects') {
      return (projects.data ?? [])
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .map((item) => ({ kind: 'project', item }));
    }
    return (agents.data ?? [])
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q))
      .map((item) => ({ kind: 'agent', item }));
  }, [segment, query, projects.data, agents.data]);

  const empty = active.isLoading ? (
    <SkeletonList rows={4} />
  ) : active.isError ? (
    <ErrorState
      message={segment === 'projects' ? 'Could not load projects.' : 'Could not load agents.'}
      onRetry={() => void active.refetch()}
    />
  ) : query ? (
    <EmptyState title="No matches" message="Nothing here matches that search." />
  ) : segment === 'projects' ? (
    <EmptyState
      title="No projects"
      message="Projects group codebases on the machine running GeneratorAI. Create one there and it appears here."
      icon={<FolderGit2 size={22} color={colors['muted-foreground']} />}
    />
  ) : (
    <EmptyState
      title="No agents"
      message="Reusable agents are defined on the desktop or web app. They appear here and can be picked when starting a chat."
      icon={<Bot size={22} color={colors['muted-foreground']} />}
    />
  );

  return (
    <View className="flex-1 bg-background">
      <Screen title="Projects" trailing={<SettingsButton />} scroll={false}>
        <LegendList
          ref={listRef as never}
          data={rows}
          keyExtractor={(row: Row) => `${row.kind}:${row.item.id}`}
          estimatedItemSize={66}
          recycleItems
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 160, gap: 10 }}
          ListHeaderComponent={
            <View className="gap-3 pb-3">
              <SegmentedControl
                segments={[
                  { value: 'projects', label: 'Projects', count: projects.data?.length ?? 0 },
                  { value: 'agents', label: 'Agents', count: agents.data?.length ?? 0 },
                ]}
                value={segment}
                onChange={setSegment}
                accessibilityLabel="Projects or agents"
              />
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder={segment === 'projects' ? 'Search projects' : 'Search agents'}
              />
            </View>
          }
          ListEmptyComponent={empty}
          refreshing={active.isFetching}
          onRefresh={() => {
            haptics.tap();
            void active.refetch();
          }}
          renderItem={({ item: row }: { item: Row }) =>
            row.kind === 'agent' ? (
              <AgentCard agent={row.item} onPress={() => setAgent(row.item)} />
            ) : (
              <Touchable
                accessibilityLabel={row.item.name}
                accessibilityHint={row.item.description ?? undefined}
                haptic="tap"
                scale="large"
                onPress={() => router.push(`/projects/${row.item.id}`)}
              >
                <Card className="flex-row items-center gap-3 p-3.5">
                  <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
                    <FolderGit2 size={16} color={colors['muted-foreground']} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text numberOfLines={2} className="text-md font-medium text-foreground">
                      {row.item.name}
                    </Text>
                    <Text numberOfLines={2} className="text-xs text-muted-foreground">
                      {row.item.description ?? `Created ${relativeTime(row.item.createdAt)}`}
                    </Text>
                  </View>
                </Card>
              </Touchable>
            )
          }
        />
      </Screen>

      <AgentDetailSheet agent={agent} onClose={() => setAgent(null)} />
    </View>
  );
}
