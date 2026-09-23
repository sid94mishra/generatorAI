// ────────────────────────────────────────────────────────────────
// Projects · Agents.
//
// One mounted scene that renders whichever catalogue the navigation drawer
// asked for (`/projects?segment=agents`) — two desktop sidebar pages. No
// switcher of its own: the drawer is the way between them, as on desktop.
//
// Projects can be created (with repositories by git URL), renamed, archived
// and deleted from here when the device holds `write:projects`: the header
// "+" opens the create sheet and a long-press on a row opens its actions.
// Linking a LOCAL folder stays off the phone for a structural reason — it
// points at a path on the machine running GeneratorAI, which a phone cannot
// browse (`codebaseLinkLocal` in featureGate). Archived projects sit in
// their own section at the end so they can be restored.
//
// Agents moved here from Settings (plan §6.2): they are authoring, not
// preferences. Read-only on the phone — tap a row for the detail sheet.
// They are grouped by scope (Built-in / Global / Project), which is the
// question that decides whether an agent is usable in a given chat.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Archive, Bot, FolderGit2, Plus } from 'lucide-react-native';
import { queryKeys, type AgentSummary, type ProjectSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { duplicateNames, isDuplicateName, shortId } from '../../src/components/common/disambiguate';
import { relativeTime } from '../../src/components/runs/formatTime';
import { AgentCard, agentScopeLabel } from '../../src/components/work/cards';
import { AgentDetailSheet } from '../../src/components/work/AgentDetailSheet';
import { CreateProjectSheet } from '../../src/components/projects/CreateProjectSheet';
import { ProjectActions, type ProjectActionTarget } from '../../src/components/projects/ProjectActions';
import { partitionProjects } from '../../src/components/projects/projectEditModel';
import { useFeature } from '../../src/components/runs/useFeature';
import { ActionSheet } from '../../src/components/ui/ActionSheet';
import { IconButton } from '../../src/components/ui/Button';
import { ListItem, ListSectionHeader } from '../../src/components/ui/ListItem';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { usePullToRefresh } from '../../src/components/ui/usePullToRefresh';
import { TabHeaderActions } from '../../src/navigation/TabHeaderActions';
import { Chip } from '../../src/components/ui/Chip';
import { MenuButton } from '../../src/navigation/shell/MenuButton';
import { useShellStore } from '../../src/navigation/shell/shellStore';
import { useTabShell } from '../../src/navigation/tabShell';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

type Segment = 'projects' | 'agents';
type RoleFilter = 'all' | 'agent' | 'orchestrator';
const ROLE_FILTERS: ReadonlyArray<{ value: RoleFilter; label: string }> = [
  { value: 'all', label: 'All roles' },
  { value: 'agent', label: 'Agents' },
  { value: 'orchestrator', label: 'Orchestrators' },
];

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'project'; item: ProjectSummary; duplicate: boolean }
  | { kind: 'agent'; item: AgentSummary };

const SCOPE_ORDER: AgentSummary['scope'][] = ['project', 'global', 'system'];

export default function ProjectsScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const shell = useTabShell();
  // `?segment=agents` deep link (pushes, other screens) mirrors the Work tab.
  const params = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegmentState] = useState<Segment>(params.segment === 'agents' ? 'agents' : 'projects');
  const reportSegment = useShellStore((st) => st.setProjectsSegment);
  const setSegment = useCallback(
    (next: Segment) => {
      setSegmentState(next);
      reportSegment(next);
    },
    [reportSegment],
  );
  // The drawer addresses a segment (`?segment=agents`) while this scene is
  // already mounted, so the param is applied whenever it arrives, then cleared
  // so it does not re-apply each time the scene regains focus.
  useEffect(() => {
    if (params.segment !== 'agents' && params.segment !== 'projects') return;
    setSegment(params.segment);
    router.setParams({ segment: undefined });
  }, [params.segment, setSegment]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [locked, setLocked] = useState(false);
  const [menuFor, setMenuFor] = useState<ProjectActionTarget | null>(null);
  const projectEdit = useFeature('projectEdit');
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
      const all = projects.data ?? [];
      // Computed over the WHOLE list, not the filtered one: a search that
      // happens to hide one of two "V project"s must not make the other look
      // unique while its twin is a keystroke away.
      const dupes = duplicateNames(all, (p) => p.name);
      const matches = all.filter(
        (p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
      );
      const { active: activeProjects, archived } = partitionProjects(matches);
      const toRow = (item: ProjectSummary): Row => ({ kind: 'project', item, duplicate: isDuplicateName(dupes, item.name) });
      const out: Row[] = activeProjects.map(toRow);
      if (archived.length > 0) {
        out.push({ kind: 'header', key: 'archived', label: `Archived (${archived.length})` });
        out.push(...archived.map(toRow));
      }
      return out;
    }
    const found = (agents.data ?? []).filter(
      (a) =>
        (role === 'all' || (role === 'orchestrator' ? a.role === 'orchestrator' : a.role !== 'orchestrator')) &&
        (!q || a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q)),
    );
    const out: Row[] = [];
    for (const scope of SCOPE_ORDER) {
      const inScope = found.filter((a) => a.scope === scope);
      if (inScope.length === 0) continue;
      out.push({ kind: 'header', key: `scope:${scope}`, label: agentScopeLabel(scope) });
      for (const item of inScope) out.push({ kind: 'agent', item });
    }
    return out;
  }, [segment, query, role, projects.data, agents.data]);

  const pull = usePullToRefresh(() => active.refetch(), active.isFetching);

  const empty = active.isLoading ? (
    <SkeletonList rows={4} variant="flat" />
  ) : active.isError ? (
    <ErrorState
      message={segment === 'projects' ? 'Could not load projects.' : 'Could not load agents.'}
      onRetry={() => void active.refetch()}
    />
  ) : query ? (
    <EmptyState title="No matches" message="Nothing here matches that search." />
  ) : segment === 'projects' ? (
    <EmptyState
      title="No projects yet"
      message="A project groups repositories, chats and workflows."
      icon={<FolderGit2 size={22} color={colors['muted-foreground']} />}
      {...(projectEdit.available ? { action: { label: 'New project', onPress: () => setCreating(true) } } : {})}
    />
  ) : (
    <EmptyState
      title="No agents yet"
      message="Agents you define on desktop or web show up here."
      icon={<Bot size={22} color={colors['muted-foreground']} />}
    />
  );

  return (
    <View className="flex-1 bg-background">
      <Screen
        title={segment === 'agents' ? 'Agents' : 'Projects'}
        variant="compact"
        leading={<MenuButton />}
        trailing={
          <TabHeaderActions>
            {segment === 'projects' ? (
              <IconButton
                accessibilityLabel="New project"
                icon={<Plus size={22} color={colors.foreground} />}
                onPress={() => (projectEdit.available ? setCreating(true) : setLocked(true))}
              />
            ) : null}
          </TabHeaderActions>
        }
        scroll={false}
      >
          <View className="flex-1">
            <LegendList
              ref={listRef as never}
              data={rows}
              keyExtractor={(row: Row) => (row.kind === 'header' ? row.key : `${row.kind}:${row.item.id}`)}
              getItemType={(row: Row) => row.kind}
              estimatedItemSize={64}
              recycleItems
              contentContainerStyle={{ paddingBottom: shell?.listBottom(false) ?? 48 }}
              ListHeaderComponent={
                <View className="gap-3 px-4 pb-1">
                  <SearchField
                    value={query}
                    onChangeText={setQuery}
                    placeholder={segment === 'projects' ? 'Search projects' : 'Search agents'}
                  />
                  {/* Desktop's "Filter by role". Scope is already the list's
                      grouping here, so it needs no second filter. */}
                  {segment === 'agents' ? (
                    <View className="flex-row gap-2">
                      {ROLE_FILTERS.map((f) => (
                        <Chip
                          key={f.value}
                          label={f.label}
                          size="sm"
                          tone="accent"
                          selected={role === f.value}
                          onPress={() => setRole(f.value)}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              }
              ListEmptyComponent={empty}
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              renderItem={({ item: row }: { item: Row }) =>
                row.kind === 'header' ? (
                  <ListSectionHeader label={row.label} />
                ) : row.kind === 'agent' ? (
                  <AgentCard agent={row.item} showScope={false} onPress={() => setAgent(row.item)} />
                ) : (
                  <ProjectRow project={row.item} duplicate={row.duplicate} onMenu={() => setMenuFor(row.item)} />
                )
              }
            />
          </View>
      </Screen>

      <AgentDetailSheet agent={agent} onClose={() => setAgent(null)} />
      <CreateProjectSheet visible={creating} onClose={() => setCreating(false)} />
      <ProjectActions project={menuFor} onClose={() => setMenuFor(null)} />
      <ActionSheet
        visible={locked}
        onClose={() => setLocked(false)}
        title="Creating projects is off on this device"
        {...(projectEdit.reason ? { message: projectEdit.reason } : {})}
        actions={[{ label: 'Request access', onPress: projectEdit.requestAccess }]}
      />
    </View>
  );
}

function ProjectRow({
  project,
  duplicate,
  onMenu,
}: {
  project: ProjectSummary;
  duplicate: boolean;
  onMenu: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const created = `Created ${relativeTime(project.createdAt)}`;
  // The list payload has no codebase count, so a same-named project is told
  // apart by what does differ: creation time and a short id.
  const subtitle = duplicate
    ? [project.description, created, `#${shortId(project.id)}`].filter(Boolean).join(' · ')
    : (project.description ?? created);

  return (
    <ListItem
      title={project.name}
      subtitle={subtitle}
      avatar={{
        icon:
          project.status === 'archived' ? (
            <Archive size={17} color={colors['muted-foreground']} />
          ) : (
            <FolderGit2 size={17} color={colors['muted-foreground']} />
          ),
        tone: 'neutral',
      }}
      accessibilityLabel={duplicate ? `${project.name}, ${created}` : project.name}
      accessibilityHint={[project.description, 'Long-press for rename, archive and delete'].filter(Boolean).join('. ')}
      onPress={() => router.push(`/projects/${project.id}`)}
      onLongPress={onMenu}
    />
  );
}
