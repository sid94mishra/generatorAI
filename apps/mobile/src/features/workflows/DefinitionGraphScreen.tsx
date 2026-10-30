// The definition graph (`/workflows/[id]/graph`, 04 §2.11; M8-01): the workflow's stages on MB-35 RunGraph,
// read-only (MD-04) — pinch, pan, double-tap, + − Fit; "List" returns to the workflow, whose stage list is the
// equivalent reading (MD-28). No statuses: this is the definition, not a run.
import React, { useMemo } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { RunGraph } from '../../blocks/RunGraph';
import { WORKFLOWS_HREF, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { useWorkflow } from './queries';

export default function DefinitionGraphScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onBack = useHeaderBack();
  const workflow = useWorkflow(id);
  const graph = workflow.data?.graph;
  const name = graph?.workflow.name ?? 'Workflow';
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Workflows', href: WORKFLOWS_HREF }, { label: name, href: workflowHref(id) }], [name, id]));
  const state = workflow.isLoading
    ? { kind: 'loading' as const }
    : workflow.isError || !graph
      ? { kind: 'error' as const, error: workflow.error, onRetry: () => void workflow.refetch(), title: "Couldn't load this workflow" }
      : graph.stages.length === 0
        ? { kind: 'empty' as const, empty: <EmptyState copyKey="builderEmpty" /> }
        : { kind: 'ready' as const };
  return (
    <Screen header={<Header role="detail" title="Graph" breadcrumb={breadcrumb} onBack={onBack} />} scroll="none" state={state} testID="workflow-graph">
      {graph?.stages.length ? <RunGraph variant="canvas" graph={graph} onList={() => (router.canGoBack() ? router.back() : router.replace(workflowHref(id) as never))} testID="workflow-graph-canvas" /> : null}
    </Screen>
  );
}
