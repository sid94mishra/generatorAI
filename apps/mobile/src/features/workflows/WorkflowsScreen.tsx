// Workflows (MWorkflows; `/workflows`; M8-01): header "Workflows N" (top) with Import JSON; SearchInput; All /
// Published / Drafts with counts; "212 runs in 30 days · 93.4% succeeded" and the sort menu (Updated / Name / Last
// run); one row per workflow — name, the last run (glyph + word + when, NG-04), the project, a neutral Draft /
// Agent draft badge and the tags, the 30-day success rate (absent when it never ran). Swipe "Run" (a neutral tile:
// it opens the run sheet, never starts, MD-52) and the row menu: Run… · Open | Export JSON | Delete…. NewAction
// "New workflow" (`new-workflow`). No run numbers until MG-29; no version on the row (the list carries none).
import React, { useDeferredValue, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';
import { resolveStatus, type StatsByDefinitionRow } from '@generatorai/shared';
import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';

import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { NEW_WORKFLOW_HREF, runSheetHref, workflowHref } from '../../blocks/shell/hrefs';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { LargeTitle } from '../../ui/layout/LargeTitle';
import { IOS_GROUP_CORNERS, rowPosition } from '../../ui/layout/ListSection/listSectionModel';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { SwipeRow, closeOpenSwipeRow } from '../../ui/layout/SwipeRow';
import { cn } from '../../ui/lib/cn';
import { errorText, formatRelativeShort } from '../../ui/lib/format';
import { projectLabelRole } from '../../ui/lib/projectLabel';
import { LegendList } from '../../ui/lib/styled';
import { confirm } from '../../ui/native/AlertDialog';
import { Menu } from '../../ui/native/Menu';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { nativePlatform } from '../../ui/platform/geometry';
import { useInsets } from '../../ui/platform/insets';
import { Badge } from '../../ui/primitives/Badge';
import { Chip } from '../../ui/primitives/Chip';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Separator } from '../../ui/primitives/Separator';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { SORT_LABEL, filterWorkflows, listSummary, percent, scopeCounts, type WorkflowScope, type WorkflowSort } from './model/workflowsModel';
import { useDefinitionStats, useProjectsList, useWorkflowWrites, useWorkflows } from './queries';

type Href = Parameters<typeof router.push>[0];
type RowAction = 'run' | 'open' | 'export' | 'delete';

const LIST_BOTTOM_GAP = 96;

function rowMenu(w: WorkflowDefinitionSummary, canRun: boolean, canEdit: boolean): MenuEntry[] {
  return [
    ...(canRun ? [{ id: 'run', label: w.status === 'draft' ? 'Test run…' : 'Run…', icon: 'play' as const }] : []),
    { id: 'open', label: 'Open', icon: 'workflows' },
    { type: 'separator' },
    { id: 'export', label: 'Export JSON', icon: 'download' },
    ...(canEdit ? [{ type: 'separator' as const }, { id: 'delete', label: 'Delete…', icon: 'trash' as const, destructive: true }] : []),
  ];
}

function LastRun({ stats }: { stats: StatsByDefinitionRow | undefined }): React.ReactElement {
  const run = stats?.lastRun;
  if (!run) {
    return (
      <Text role="footnote" tone="fg-3">
        Never run
      </Text>
    );
  }
  const status = resolveStatus('workflowRun', run.status);
  return (
    <View className="flex-row items-center gap-1">
      {status ? <Icon concept={status.def.glyph as never} size={12} tone={status.def.tone} /> : null}
      <Text role="footnote" tone="fg-3" numberOfLines={1}>
        {[status?.label, run.startedAt ? formatRelativeShort(run.startedAt) : null].filter(Boolean).join(' ')}
      </Text>
    </View>
  );
}

function WorkflowRow({ w, stats, projectName, index, count, canRun, canEdit, onAction }: { w: WorkflowDefinitionSummary; stats: StatsByDefinitionRow | undefined; projectName: string; index: number; count: number; canRun: boolean; canEdit: boolean; onAction: (id: RowAction, w: WorkflowDefinitionSummary) => void }): React.ReactElement {
  const position = rowPosition(index, count);
  const status = stats?.lastRun ? resolveStatus('workflowRun', stats.lastRun.status) : null;
  const badges = [...(w.agentAuthored ? [<Badge key="agent" label="Agent draft" icon="wand" size="sm" />] : w.status === 'draft' ? [<Badge key="draft" label="Draft" icon="edit" size="sm" />] : []), ...w.tags.slice(0, 2).map((t) => <Badge key={`t-${t}`} label={t} tone="outline" size="sm" />), ...(w.tags.length > 2 ? [<Badge key="more" label={`+${w.tags.length - 2}`} tone="outline" size="sm" />] : [])];
  const entity = (
    <EntityRow
      title={w.name}
      leading={status ? { status: status.state } : { icon: w.status === 'draft' ? 'edit' : 'workflows' }}
      meta={[<LastRun key="run" stats={stats} />, <Text key="p" role={projectLabelRole(projectName)} tone="fg-3" numberOfLines={1} className="shrink">{projectName}</Text>]}
      metaLabel={[status ? `last run ${status.label}` : 'never run', projectName, w.status === 'draft' ? 'draft' : null, ...w.tags].filter(Boolean).join(', ')}
      {...(badges.length ? { footer: <>{badges}</> } : {})}
      trailing={
        stats?.successRate !== undefined ? (
          <View className="items-end">
            <Text role="monoSm" tone="fg">
              {percent(stats.successRate)}
            </Text>
            <Text role="caption" tone="fg-3">
              success
            </Text>
          </View>
        ) : (
          <Text role="monoSm" tone="fg-3" accessibilityLabel="No success rate yet">
            —
          </Text>
        )
      }
      menu={rowMenu(w, canRun, canEdit)}
      onMenuSelect={(id) => onAction(id as RowAction, w)}
      onPress={() => onAction('open', w)}
      testID={`workflow-row-${w.id}`}
    />
  );
  const body = canRun ? (
    <SwipeRow trailing={[{ id: 'run', label: w.status === 'draft' ? 'Test run' : 'Run', icon: 'play', tone: 'neutral', onPress: () => onAction('run', w) }]} fullSwipe={false} grouped>
      {entity}
    </SwipeRow>
  ) : (
    entity
  );
  if (nativePlatform === 'android') return body;
  return (
    <View className={cn('overflow-hidden', IOS_GROUP_CORNERS[position])}>
      {position === 'middle' || position === 'last' ? <Separator inset={48} /> : null}
      {body}
    </View>
  );
}

export default function WorkflowsScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const insets = useInsets();
  const scrollY = useSharedValue(0);
  const scopes = useGrantedScopes();
  const canEdit = scopes.includes('write:workflows');
  const canRun = checkFeature('runStart', scopes).available;
  const workflows = useWorkflows();
  const { summary, byId } = useDefinitionStats();
  const projects = useProjectsList();
  const writes = useWorkflowWrites();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [scope, setScope] = useState<WorkflowScope>('all');
  const [sort, setSort] = useState<WorkflowSort>('updated');
  const all = useMemo(() => workflows.data ?? [], [workflows.data]);
  const rows = useMemo(() => filterWorkflows(all, scope, query, sort, byId), [all, scope, query, sort, byId]);
  const counts = scopeCounts(all);
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const titleCount = workflows.data ? counts.all : null;
  const line = listSummary(summary.data);

  const create = (): void => router.push(NEW_WORKFLOW_HREF as Href);
  const act = (id: RowAction, w: WorkflowDefinitionSummary): void => {
    switch (id) {
      case 'run':
        router.push(runSheetHref(w.id) as Href);
        return;
      case 'open':
        router.push(workflowHref(w.id) as Href);
        return;
      case 'export':
        writes
          .exportText(w.id)
          .then((text) => Share.share({ title: w.name, message: text }))
          .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        return;
      case 'delete':
        void confirm({
          title: `Delete ${w.name}?`,
          message: 'A workflow that has runs is archived instead, so its run history stays.',
          confirmLabel: 'Delete workflow',
          icon: 'trash',
        }).then((ok) => {
          if (!ok) return;
          writes
            .remove(w.id)
            .then((r) => toast({ kind: 'background', message: 'archived' in r ? `${w.name} archived (it has runs)` : `${w.name} deleted` }))
            .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        });
    }
  };

  const header = (
    <Header
      role="top"
      title="Workflows"
      count={titleCount}
      scroll={scrollY}
      onSidebarToggle={sidebar.onSidebarToggle}
      sidebarToggleState={sidebar.sidebarToggleState}
      actions={canEdit ? [{ id: 'import', icon: 'download', label: 'Import JSON', onPress: () => router.push(`${NEW_WORKFLOW_HREF}?start=import` as Href), testID: 'workflows-import' }] : []}
    />
  );
  const listHeader = (
    <View className="gap-3 pb-2">
      <LargeTitle title="Workflows" count={titleCount} />
      <View className="gap-3 px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search workflows" testID="workflows-search" />
        <SegmentedControl<WorkflowScope>
          accessibilityLabel="Filter workflows"
          value={scope}
          onValueChange={setScope}
          segments={[
            { value: 'all', label: 'All', ...(workflows.data ? { count: counts.all } : {}) },
            { value: 'published', label: 'Published', ...(workflows.data ? { count: counts.published } : {}) },
            { value: 'drafts', label: 'Drafts', ...(workflows.data ? { count: counts.drafts } : {}) },
          ]}
          fullWidth
          testID="workflows-scope"
        />
        <View className="flex-row items-center gap-2">
          <Text role="footnote" tone="fg-3" numberOfLines={1} className="flex-1">
            {line ?? ' '}
          </Text>
          <Menu
            items={(Object.keys(SORT_LABEL) as WorkflowSort[]).map((s) => ({ id: s, label: SORT_LABEL[s], checked: s === sort }))}
            onSelect={(id) => setSort(id as WorkflowSort)}
            accessibilityLabel={`Sort: ${SORT_LABEL[sort]}`}
            trigger={<Chip label={SORT_LABEL[sort]} variant="dropdown" testID="workflows-sort" />}
          />
        </View>
      </View>
    </View>
  );
  const empty = workflows.isLoading ? (
    <View className="px-4 pt-2">
      <Skeleton preset="list" count={6} />
    </View>
  ) : workflows.isError ? (
    <ErrorState title="Couldn't load workflows" error={workflows.error} onRetry={() => void workflows.refetch()} />
  ) : query.trim() || scope !== 'all' ? (
    <EmptyState copyKey="searchResults" action={{ label: 'Show all', onPress: () => { setSearch(''); setScope('all'); } }} />
  ) : (
    <EmptyState copyKey="workflows" {...(canEdit ? { action: { label: 'New workflow', icon: 'plus' as const, onPress: create } } : {})} />
  );

  return (
    <Screen header={header} scroll="list" bottomAccessory={canEdit ? <NewAction label="New workflow" icon="plus" onPress={create} testID="new-workflow" /> : undefined} testID="workflows">
      <LegendList
        data={rows}
        keyExtractor={(w: WorkflowDefinitionSummary) => w.id}
        renderItem={({ item, index }: { item: WorkflowDefinitionSummary; index: number }) => (
          <WorkflowRow
            w={item}
            stats={byId.get(item.id)}
            projectName={item.projectId ? (projectNames.get(item.projectId) ?? 'Project') : 'No project'}
            index={index}
            count={rows.length}
            canRun={canRun}
            canEdit={canEdit}
            onAction={act}
          />
        )}
        extraData={`${rows.length}:${byId.size}`}
        estimatedItemSize={88}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={closeOpenSwipeRow}
        onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => scrollY.set(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + LIST_BOTTOM_GAP }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        refreshing={workflows.isRefetching}
        onRefresh={() => void Promise.all([workflows.refetch(), summary.refetch()])}
        testID="workflows-list"
      />
    </Screen>
  );
}
