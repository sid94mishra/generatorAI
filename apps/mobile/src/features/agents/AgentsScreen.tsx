// Agents (MAgents; 04 §2.7; M7-03): header "Agents N" (top) with Sort and ⋯ (Import .agent.md); SearchInput; All /
// Built-in / Global / Project with counts; "Role: Any" Select and the sort; one EntityRow per agent — name, role badge,
// model · effort (mono, when the row carries it), scope · "2 skills · 1 MCP" / "team of 3"; disabled dimmed. Long-press
// / ⋯: Edit, Duplicate, Export .agent.md | Delete (built-ins: Duplicate · Export, MDF-104). NewAction "New agent".
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';

import { agentHref } from '../../blocks/shell/hrefs';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { LargeTitle } from '../../ui/layout/LargeTitle';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { LegendList } from '../../ui/lib/styled';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { useInsets } from '../../ui/platform/insets';
import { Badge } from '../../ui/primitives/Badge';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import {
  ROLE_LABEL,
  SCOPE_ICON,
  SCOPE_LABEL,
  agentFacts,
  agentMenu,
  filterAgents,
  modelLine,
  scopeCounts,
  type AgentListItem,
  type AgentMenuId,
  type AgentRoleFilter,
  type AgentScopeFilter,
  type AgentSort,
} from './model/agentsModel';
import { useAgents } from './queries';
import { useAgentActions } from './useAgentActions';

type Href = Parameters<typeof router.push>[0];

function AgentRow({ agent, canEdit }: { agent: AgentListItem; canEdit: boolean }): React.ReactElement {
  const act = useAgentActions();
  const model = modelLine(agent.runtime);
  const menu = agentMenu(agent, canEdit) as MenuEntry[];
  const facts = agentFacts(agent);
  return (
    <EntityRow
      title={agent.name}
      leading={{ icon: 'agents' }}
      meta={[
        <Badge key="r" label={ROLE_LABEL[agent.role]} icon={agent.role === 'orchestrator' ? 'users' : 'agents'} size="sm" />,
        ...(agent.enabled ? [] : ['Disabled']),
        ...(model
          ? [
              <Text key="m" role="monoSm" tone="fg-2" numberOfLines={1}>
                {model}
              </Text>,
            ]
          : []),
      ]}
      metaLabel={[ROLE_LABEL[agent.role], agent.enabled ? '' : 'disabled', model ?? '', SCOPE_LABEL[agent.scope], ...facts].filter(Boolean).join(', ')}
      footer={
        <>
          <Icon concept={SCOPE_ICON[agent.scope]} size={12} tone="fg-3" />
          <Text role="footnote" tone="fg-3" numberOfLines={1}>
            {[SCOPE_LABEL[agent.scope], ...facts].join(' · ')}
          </Text>
        </>
      }
      menu={menu}
      onMenuSelect={(id) => act(id as AgentMenuId, agent, { afterDelete: () => undefined })}
      onPress={() => router.push(agentHref(agent.id) as Href)}
      testID={`agent-row-${agent.slug}`}
    />
  );
}

export default function AgentsScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const insets = useInsets();
  const scrollY = useSharedValue(0);
  const canEdit = checkFeature('capabilityAdmin', useGrantedScopes()).available;
  const agents = useAgents();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [scope, setScope] = useState<AgentScopeFilter>('all');
  const [role, setRole] = useState<AgentRoleFilter>('any');
  const [sort, setSort] = useState<AgentSort>('name');
  const all = useMemo(() => agents.data ?? [], [agents.data]);
  const counts = scopeCounts(all);
  const rows = useMemo(() => filterAgents(all, { scope, role, query, sort }), [all, scope, role, query, sort]);
  const titleCount = agents.data ? all.length : null;

  const header = (
    <Header
      role="top"
      title="Agents"
      count={titleCount}
      scroll={scrollY}
      onSidebarToggle={sidebar.onSidebarToggle}
      sidebarToggleState={sidebar.sidebarToggleState}
      actions={[
        {
          id: 'sort',
          icon: 'sort',
          label: 'Sort',
          testID: 'agents-sort',
          menu: [
            { id: 'name', label: 'Name', checked: sort === 'name' },
            { id: 'updated', label: 'Last updated', checked: sort === 'updated' },
          ],
          onMenuSelect: (id) => setSort(id as AgentSort),
        },
        ...(canEdit ? [{ id: 'more', icon: 'more' as const, label: 'More', menu: [{ id: 'import', label: 'Import .agent.md', icon: 'upload' as const }], onMenuSelect: () => router.push('/agents/import' as Href), testID: 'agents-more' }] : []),
      ]}
    />
  );

  const listHeader = (
    <View className="gap-3 pb-2">
      <LargeTitle title="Agents" count={titleCount} />
      <View className="gap-3 px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search agents" testID="agents-search" />
        <SegmentedControl<AgentScopeFilter>
          accessibilityLabel="Scope"
          value={scope}
          onValueChange={setScope}
          segments={(['all', 'system', 'global', 'project'] as const).map((s) => ({ value: s, label: s === 'all' ? 'All' : SCOPE_LABEL[s], ...(agents.data ? { count: counts[s] } : {}) }))}
          fullWidth
          testID="agents-scope"
        />
        <View className="flex-row items-center gap-3">
          <View className="min-w-0 flex-1">
            <Select
              label="Role"
              value={role}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'agent', label: 'Worker' },
                { value: 'orchestrator', label: 'Orchestrator' },
              ]}
              onValueChange={(v) => setRole(v as AgentRoleFilter)}
              presentation="field"
              testID="agents-role"
            />
          </View>
          {agents.data ? (
            <Text role="footnote" tone="fg-3">
              {`${rows.length} agent${rows.length === 1 ? '' : 's'}`}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  const empty = agents.isLoading ? (
    <View className="px-4 pt-2">
      <Skeleton preset="list" count={5} />
    </View>
  ) : agents.isError ? (
    <ErrorState title="Couldn't load agents" error={agents.error} onRetry={() => void agents.refetch()} />
  ) : query.trim() || scope !== 'all' || role !== 'any' ? (
    <EmptyState copyKey="searchResults" action={{ label: 'Clear filters', onPress: () => { setSearch(''); setScope('all'); setRole('any'); } }} />
  ) : (
    <EmptyState copyKey="agents" {...(canEdit ? { action: { label: 'New agent', icon: 'plus' as const, onPress: () => router.push('/agents/new' as Href) } } : {})} />
  );

  return (
    <Screen
      header={header}
      scroll="list"
      bottomAccessory={canEdit ? <NewAction label="New agent" icon="plus" onPress={() => router.push('/agents/new' as Href)} testID="agents-new" /> : undefined}
      testID="agents"
    >
      <LegendList
        data={rows}
        keyExtractor={(a: AgentListItem) => a.id}
        renderItem={({ item }: { item: AgentListItem }) => <AgentRow agent={item} canEdit={canEdit} />}
        estimatedItemSize={92}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => scrollY.set(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        refreshing={agents.isRefetching}
        onRefresh={() => void agents.refetch()}
        testID="agents-list"
      />
    </Screen>
  );
}
