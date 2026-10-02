// ────────────────────────────────────────────────────────────────
// Workflows — the legacy catalogue scene (Automations and Scripts moved to
// features/ in M7-04); M8 replaces it.
//
// There is no runs list here. As on desktop a run lives under its workflow:
// open a workflow to see its runs and start a new one. Runs that are moving or
// waiting on a person surface on Home.
//
// Creating: the header "+" on Workflows starts one from a template (a phone
// cannot host the DAG builder); shown only when the device may create.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useWorkflowRuns, useWorkflows } from '../../../src/features/workflows/queries';
import { Workflow as WorkflowIcon } from 'lucide-react-native';
import { type WorkflowSummary } from '@generatorai/client-core';

import { useFeature } from '../../../src/components/runs/useFeature';
import { TemplatePickerSheet } from '../../../src/components/work/TemplatePickerSheet';
import { WorkflowCard } from '../../../src/components/work/cards';
import { usePullToRefresh } from '../../../src/components/ui/usePullToRefresh';
import { SearchField } from '../../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../../src/components/ui/States';
import { SkeletonList } from '../../../src/components/ui/Skeleton';
import { Screen } from '../../../src/components/ui/Screen';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openSearch } from '../../../src/blocks/shell/navigation';

export default function WorkScreen(): React.ReactElement {
  const workflowEdit = useFeature('workflowEdit');
  const [templates, setTemplates] = useState(false);
  const { legacyColors: colors } = useTheme();
  const [query, setQuery] = useState('');
  const listRef = useRef<never>(null);
  const listBottom = useSafeAreaInsets().bottom + 24;
  // `/workflows/new` links (command/workflow.new) arrive as `?new=1`: the template picker (MD-145).
  const { new: createParam } = useLocalSearchParams<{ new?: string }>();
  const [handledCreate, setHandledCreate] = useState<string | undefined>(undefined);
  if (createParam === '1' && handledCreate !== createParam) {
    setHandledCreate(createParam);
    if (workflowEdit.available) setTemplates(true);
  }

  const runs = useWorkflowRuns();
  const workflows = useWorkflows();

  const rows = useMemo<WorkflowSummary[]>(() => {
    const q = query.trim().toLowerCase();
    return (workflows.data ?? []).filter((w) => !q || w.name.toLowerCase().includes(q));
  }, [query, workflows.data]);

  const refetchAll = useCallback(() => Promise.all([runs.refetch(), workflows.refetch()]), [runs, workflows]);
  const pull = usePullToRefresh(refetchAll, runs.isFetching || workflows.isFetching);

  const header = (
    <View className="gap-3 px-4 pb-1">
      {query || (workflows.data?.length ?? 0) > 0 ? <SearchField value={query} onChangeText={setQuery} placeholder="Search workflows" /> : null}
    </View>
  );

  const empty = workflows.isLoading ? (
    <SkeletonList rows={5} variant="flat" />
  ) : workflows.isError ? (
    <ErrorState message="Could not load this list." onRetry={() => void workflows.refetch()} />
  ) : query ? (
    <EmptyState title="No matches" message="Nothing here matches that search." />
  ) : (
    <EmptyState
      title="No workflows yet"
      message={workflowEdit.available ? 'Start one from a template, or build it on desktop or web.' : 'Workflows you build on desktop or web show up here.'}
      icon={<WorkflowIcon size={22} color={colors['muted-foreground']} />}
      {...(workflowEdit.available ? { action: { label: 'Start from template', onPress: () => setTemplates(true) } } : {})}
    />
  );

  return (
    <View className="flex-1 bg-background">
      <Screen
        title="Workflows"
        actions={[{ id: 'search', icon: 'search', label: 'Search', onPress: () => openSearch(), testID: 'header-search' }]}
        {...(workflowEdit.available ? { newAction: { label: 'New workflow', icon: 'plus' as const, onPress: () => setTemplates(true), testID: 'new-workflow' } } : {})}
        scroll={false}
      >
        <View className="flex-1">
          <LegendList
            ref={listRef as never}
            data={rows}
            keyExtractor={(w: WorkflowSummary) => w.id}
            estimatedItemSize={64}
            recycleItems
            contentContainerStyle={{ paddingBottom: listBottom }}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            renderItem={({ item }: { item: WorkflowSummary }) => <WorkflowCard workflow={item} runs={runs.data ?? []} />}
          />
        </View>
      </Screen>
      <TemplatePickerSheet visible={templates} onClose={() => setTemplates(false)} />
    </View>
  );
}
