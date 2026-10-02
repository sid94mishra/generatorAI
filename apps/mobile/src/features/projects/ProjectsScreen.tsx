// Projects (MProjects; 04 §2.6; M7-02): header "Projects N" (top) with Sort; SearchInput; Active / Archived segments
// with counts; one EntityRow per project — name, description, "2 codebases · 3 chats · 1 needs you", the last run
// (StatusBadge + name) and the updated time; long-press / ⋯ menu (Open, New chat, Run workflow…, Add codebase… |
// Copy root path, Settings | Archive, Delete…). NewAction "New project" (→ the full-screen create, MD-21).
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';
import { epochOr, type ProjectSummary } from '@generatorai/client-core';
import { resolveStatus } from '@generatorai/shared';

import { NEW_PROJECT_HREF, projectHref } from '../../blocks/shell/hrefs';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { LargeTitle } from '../../ui/layout/LargeTitle';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { LegendList } from '../../ui/lib/styled';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { useInsets } from '../../ui/platform/insets';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { filterProjects, isArchived, projectCounts, projectMenu, type ProjectMenuId, type ProjectScope } from './model/projectsModel';
import { useProjects } from './queries';
import { useProjectActions } from './useProjectActions';

type Sort = 'updated' | 'name';
type Href = Parameters<typeof router.push>[0];

const updatedAt = (p: ProjectSummary): number => epochOr((p as { updatedAt?: string }).updatedAt ?? p.createdAt, 0);

function ProjectRow({ project, canEdit }: { project: ProjectSummary; canEdit: boolean }): React.ReactElement {
  const act = useProjectActions();
  const s = project.summary;
  const last = s?.lastRun ? resolveStatus('workflowRun', s.lastRun.status) : null;
  const menu = projectMenu(project, canEdit) as MenuEntry[];
  return (
    <EntityRow
      title={project.name}
      leading={{ icon: 'folder-open' }}
      {...(project.description ? { description: project.description } : {})}
      meta={[
        ...projectCounts(s),
        ...(s?.needsYou
          ? [
              <Text key="n" role="footnote" tone="warn">
                {`${s.needsYou} needs you`}
              </Text>,
            ]
          : []),
      ]}
      metaLabel={[s?.needsYou ? `${s.needsYou} needs you` : '', last && s?.lastRun ? `last run ${s.lastRun.name}, ${last.label}` : ''].filter(Boolean).join(', ')}
      archived={isArchived(project)}
      {...(last && s?.lastRun
        ? {
            footer: (
              <>
                <StatusBadge state={last.state} label={last.label} size="sm" />
                <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink">
                  {s.lastRun.name}
                </Text>
              </>
            ),
          }
        : {})}
      time={new Date(updatedAt(project)).toISOString()}
      onPress={() => router.push(projectHref(project.id) as Href)}
      menu={menu}
      onMenuSelect={(id) => act(id as ProjectMenuId, project, { afterDelete: () => undefined })}
      testID={`project-row-${project.id}`}
    />
  );
}

export default function ProjectsScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const insets = useInsets();
  const scrollY = useSharedValue(0);
  const canEdit = checkFeature('projectEdit', useGrantedScopes()).available;
  const projects = useProjects();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [scope, setScope] = useState<ProjectScope>('active');
  const [sort, setSort] = useState<Sort>('updated');

  const all = useMemo(() => projects.data ?? [], [projects.data]);
  const counts = useMemo(() => ({ active: all.filter((p) => !isArchived(p)).length, archived: all.filter(isArchived).length }), [all]);
  const rows = useMemo(() => {
    const list = filterProjects(all, scope, query);
    return sort === 'name' ? list.sort((a, b) => a.name.localeCompare(b.name)) : list.sort((a, b) => updatedAt(b) - updatedAt(a));
  }, [all, scope, query, sort]);
  const titleCount = projects.data ? counts.active : null;

  const header = (
    <Header
      role="top"
      title="Projects"
      count={titleCount}
      scroll={scrollY}
      onSidebarToggle={sidebar.onSidebarToggle}
      sidebarToggleState={sidebar.sidebarToggleState}
      actions={[
        {
          id: 'sort',
          icon: 'sort',
          label: 'Sort',
          testID: 'projects-sort',
          menu: [
            { id: 'updated', label: 'Last update', checked: sort === 'updated' },
            { id: 'name', label: 'Name', checked: sort === 'name' },
          ],
          onMenuSelect: (id) => setSort(id as Sort),
        },
      ]}
    />
  );

  const listHeader = (
    <View className="gap-3 pb-2">
      <LargeTitle title="Projects" count={titleCount} />
      <View className="gap-3 px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search projects" testID="projects-search" />
        <SegmentedControl<ProjectScope>
          accessibilityLabel="Filter projects"
          value={scope}
          onValueChange={setScope}
          segments={[
            { value: 'active', label: 'Active', count: projects.data ? counts.active : undefined },
            { value: 'archived', label: 'Archived', count: projects.data ? counts.archived : undefined },
          ]}
          fullWidth
          testID="projects-scope"
        />
      </View>
    </View>
  );

  const empty = projects.isLoading ? (
    <View className="px-4 pt-2">
      <Skeleton preset="list" count={5} />
    </View>
  ) : projects.isError ? (
    <ErrorState title="Couldn't load projects" error={projects.error} onRetry={() => void projects.refetch()} />
  ) : query.trim() ? (
    <EmptyState copyKey="searchResults" action={{ label: 'Clear search', onPress: () => setSearch('') }} />
  ) : scope === 'archived' ? (
    <EmptyState icon="archive" title="No archived projects" description="Archived projects keep their codebases and worktrees until deleted." />
  ) : (
    <EmptyState copyKey="projects" {...(canEdit ? { action: { label: 'New project', icon: 'plus' as const, onPress: () => router.push(NEW_PROJECT_HREF as Href) } } : {})} />
  );

  return (
    <Screen
      header={header}
      scroll="list"
      bottomAccessory={canEdit ? <NewAction label="New project" icon="plus" onPress={() => router.push(NEW_PROJECT_HREF as Href)} testID="projects-new" /> : undefined}
      testID="projects"
    >
      <LegendList
        data={rows}
        keyExtractor={(p: ProjectSummary) => p.id}
        renderItem={({ item }: { item: ProjectSummary }) => <ProjectRow project={item} canEdit={canEdit} />}
        estimatedItemSize={96}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => scrollY.set(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={
          rows.length ? (
            <Text role="footnote" tone="fg-3" className="px-4 pt-3">
              {sort === 'name' ? 'Sorted by name.' : 'Sorted by last update.'} Archived projects keep their codebases and worktrees until deleted.
            </Text>
          ) : null
        }
        refreshing={projects.isRefetching}
        onRefresh={() => void projects.refetch()}
        testID="projects-list"
      />
    </Screen>
  );
}
