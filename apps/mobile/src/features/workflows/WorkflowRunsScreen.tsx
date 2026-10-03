// Run history (`/workflows/[id]/runs`, 04 §2.11 "View all"; M8-01): every run of the workflow, newest first, as
// MB-49 RunRows with their version, paged by 50 ("Show more" raises the limit); a status filter (All / Active /
// Finished / Failed).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { RunRow } from '../../blocks/RunRow';
import { WORKFLOWS_HREF, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { isActive } from '../../services/api/runActivity';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { versionLabels } from './model/workflowsModel';
import { useDefinitionVersions, useWorkflow, useWorkflowRuns } from './queries';

type Filter = 'all' | 'active' | 'finished' | 'failed';
const PAGE = 50;

export default function WorkflowRunsScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onBack = useHeaderBack();
  const workflow = useWorkflow(id);
  const name = workflow.data?.graph.workflow.name ?? 'Workflow';
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Workflows', href: WORKFLOWS_HREF }, { label: name, href: workflowHref(id) }], [name, id]));
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilter] = useState<Filter>('all');
  const runs = useWorkflowRuns(id, { limit });
  const versions = useDefinitionVersions(id);
  const labels = useMemo(() => versionLabels(versions.data), [versions.data]);
  const rows = (runs.data ?? []).filter((r) => (filter === 'all' ? true : filter === 'active' ? isActive(r.status) : filter === 'failed' ? r.status === 'failed' : !isActive(r.status)));
  const state = runs.isLoading ? { kind: 'loading' as const } : runs.isError ? { kind: 'error' as const, error: runs.error, onRetry: () => void runs.refetch(), title: "Couldn't load the runs" } : { kind: 'ready' as const };

  return (
    <Screen header={<Header role="detail" title="Runs" breadcrumb={breadcrumb} onBack={onBack} />} state={state} onRefresh={async () => void (await runs.refetch())} testID="workflow-runs">
      <View className="gap-4 pb-8 pt-2">
        <View className="px-4">
          <SegmentedControl<Filter>
            accessibilityLabel="Filter runs"
            value={filter}
            onValueChange={setFilter}
            segments={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'finished', label: 'Finished' },
              { value: 'failed', label: 'Failed' },
            ]}
            fullWidth
            testID="workflow-runs-filter"
          />
        </View>
        {rows.length === 0 ? (
          <EmptyState copyKey={filter === 'all' ? 'runs' : 'searchResults'} />
        ) : (
          <ListSection count={rows.length}>
            {rows.map((run) => (
              <RunRow key={run.id} run={run as never} context="workflow" versionLabel={labels.get((run as { definitionVersionId?: string }).definitionVersionId ?? '') ?? null} />
            ))}
          </ListSection>
        )}
        {(runs.data?.length ?? 0) >= limit ? <Button label="Show more" variant="ghost" loading={runs.isFetching} onPress={() => setLimit((n) => n + PAGE)} testID="workflow-runs-more" /> : null}
      </View>
    </Screen>
  );
}
