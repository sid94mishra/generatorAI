// Automations (MAutomations; 04 §2.5; M7-04): header "Automations N" (top); SearchInput; All / Enabled / Disabled with
// counts; the zone note ("<tz> · schedules need <server> running"); one row per automation — name, project, the
// Enabled Switch (own hit target, MD-28), trigger · workflows, dataset · permission, the last execution (status word)
// and the next run; disabled rows get a neutral "Disabled" badge (no dimmed text, MDF-91). Long-press / ⋯: Run now ·
// Run with dataset… | Edit · Duplicate · Enable / Disable | Delete…. NewAction "New automation".
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';
import type { Automation } from '@generatorai/shared';

import { useConnectionHealth } from '../../blocks/ConnectionStatus';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { LargeTitle } from '../../ui/layout/LargeTitle';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { errorText, formatRelativeShort } from '../../ui/lib/format';
import { projectLabelRole } from '../../ui/lib/projectLabel';
import { LegendList } from '../../ui/lib/styled';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Switch } from '../../ui/native/Switch';
import { useInsets } from '../../ui/platform/insets';
import { Badge } from '../../ui/primitives/Badge';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { nextRunLabel } from './model';
import { PERMISSION_LABEL, TRIGGER_ICON, automationMenu, datasetLine, filterAutomations, triggerLine, type AutomationMenuId, type AutomationScope } from './model/automationsModel';
import { useAutomationWrites, useAutomations, useProjectsList, useWorkflowNames } from './queries';
import { useAutomationActions } from './useAutomationActions';

type Href = Parameters<typeof router.push>[0];

function AutomationRow({ a, projectName, workflowNames, canEdit, canRun }: { a: Automation; projectName: string; workflowNames: string; canEdit: boolean; canRun: boolean }): React.ReactElement {
  const act = useAutomationActions();
  const writes = useAutomationWrites();
  const menu = automationMenu(a, canEdit, canRun) as MenuEntry[];
  const next = a.enabled ? nextRunLabel(a.nextRunAt as unknown as string) : null;
  const last = a.lastRunAt ? formatRelativeShort(String(a.lastRunAt)) : null;
  return (
    <EntityRow
      title={a.name}
      leading={{ icon: TRIGGER_ICON[a.triggerType] }}
      meta={[
        <Text key="p" role={projectLabelRole(projectName)} tone="fg-3" numberOfLines={1} className="shrink">
          {projectName}
        </Text>,
        ...(a.enabled ? [] : [<Badge key="d" label="Disabled" size="sm" />]),
      ]}
      metaLabel={a.enabled ? projectName : `${projectName}, disabled`}
      description={[triggerLine(a), workflowNames].filter(Boolean).join(' · ')}
      footer={
        <>
          <Icon concept="database" size={12} tone="fg-3" />
          <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink">
            {[datasetLine(a), PERMISSION_LABEL[a.permissionMode], last ? `last ${last}` : null, next].filter(Boolean).join(' · ')}
          </Text>
        </>
      }
      trailing={
        <Switch
          value={a.enabled}
          onValueChange={(v) => writes.setEnabled(a.id, v).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }))}
          label={`${a.name} enabled`}
          disabled={!canEdit}
          testID={`automation-switch-${a.id}`}
        />
      }
      menu={menu}
      onMenuSelect={(id) => act(id as AutomationMenuId, a)}
      onPress={() => router.push(`/automations/${encodeURIComponent(a.id)}` as Href)}
      testID={`automation-row-${a.id}`}
    />
  );
}

export default function AutomationsScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const insets = useInsets();
  const scrollY = useSharedValue(0);
  const scopes = useGrantedScopes();
  const canEdit = scopes.includes('write:workflows');
  const canRun = checkFeature('runStart', scopes).available;
  const automations = useAutomations();
  const projects = useProjectsList();
  const { byId } = useWorkflowNames();
  const { address } = useConnectionHealth();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [scope, setScope] = useState<AutomationScope>('all');
  const all = useMemo(() => automations.data ?? [], [automations.data]);
  const rows = useMemo(() => filterAutomations(all, scope, query), [all, scope, query]);
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const counts = { all: all.length, enabled: all.filter((a) => a.enabled).length, disabled: all.filter((a) => !a.enabled).length };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const titleCount = automations.data ? all.length : null;
  const create = (): void => router.push('/automations/new' as Href);

  const header = <Header role="top" title="Automations" count={titleCount} scroll={scrollY} onSidebarToggle={sidebar.onSidebarToggle} sidebarToggleState={sidebar.sidebarToggleState} />;
  const listHeader = (
    <View className="gap-3 pb-2">
      <LargeTitle title="Automations" count={titleCount} />
      <View className="gap-3 px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search automations" testID="automations-search" />
        <SegmentedControl<AutomationScope>
          accessibilityLabel="Filter automations"
          value={scope}
          onValueChange={setScope}
          segments={[
            { value: 'all', label: 'All', ...(automations.data ? { count: counts.all } : {}) },
            { value: 'enabled', label: 'Enabled', ...(automations.data ? { count: counts.enabled } : {}) },
            { value: 'disabled', label: 'Disabled', ...(automations.data ? { count: counts.disabled } : {}) },
          ]}
          fullWidth
          testID="automations-scope"
        />
        <View className="flex-row items-center gap-1.5">
          <Icon concept="info" size={12} tone="fg-3" />
          <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink">
            {`${zone} · schedules need ${address ?? 'the server'} running`}
          </Text>
        </View>
      </View>
    </View>
  );
  const empty = automations.isLoading ? (
    <View className="px-4 pt-2">
      <Skeleton preset="list" count={5} />
    </View>
  ) : automations.isError ? (
    <ErrorState title="Couldn't load automations" error={automations.error} onRetry={() => void automations.refetch()} />
  ) : query.trim() ? (
    <EmptyState copyKey="searchResults" action={{ label: 'Clear search', onPress: () => setSearch('') }} />
  ) : (
    <EmptyState copyKey="automations" {...(canEdit ? { action: { label: 'New automation', icon: 'plus' as const, onPress: create } } : {})} />
  );

  return (
    <Screen header={header} scroll="list" bottomAccessory={canEdit ? <NewAction label="New automation" icon="plus" onPress={create} testID="automations-new" /> : undefined} testID="automations">
      <LegendList
        data={rows}
        keyExtractor={(a: Automation) => a.id}
        renderItem={({ item }: { item: Automation }) => (
          <AutomationRow
            a={item}
            projectName={item.projectId ? (projectNames.get(item.projectId) ?? 'Project') : 'All projects'}
            workflowNames={item.workflowIds.map((w) => byId.get(w)?.name).filter(Boolean).join(', ')}
            canEdit={canEdit}
            canRun={canRun}
          />
        )}
        estimatedItemSize={104}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => scrollY.set(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        refreshing={automations.isRefetching}
        onRefresh={() => void automations.refetch()}
        testID="automations-list"
      />
    </Screen>
  );
}
