// The runtime graph (MRunGraph; `/workflows/[id]/runs/[runId]/graph`; MB-35; M8-04): the run's pinned graph on the
// read-only canvas (MD-04) — each top-level stage with its status glyph + word and its duration (a loop or map node
// carries its instance's status), traversed edges thicker (MD-25); what needs you on top with Review (MB-50); a node
// opens that stage's chat (or its approval while it waits on you); "List" returns to the run's timeline (MD-28).
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { resolveStatus } from '@generatorai/shared';

import { RunGraph, type StageNodeStatus } from '../../blocks/RunGraph';
import { WORKFLOWS_HREF, approvalHref, runHref, stageHref, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { useRunStream } from '../../services/stream/useRunStream';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { effectiveStageStatus } from './model/runModel';
import type { RunStage } from './model/runStages';
import { needsYou, runName, stageRowView } from './model/runView';
import { useRun, useRunGraph, useWorkflow } from './queries';

type Href = Parameters<typeof router.push>[0];

export default function RunGraphScreen(): React.ReactElement {
  const { id = '', runId = '' } = useLocalSearchParams<{ id: string; runId: string }>();
  const focused = useIsFocused();
  const onBack = useHeaderBack();
  const { connected } = useRunStream(runId, focused);
  const run = useRun(runId, focused, connected);
  const data = run.data as (typeof run.data & { definitionVersionId?: string }) | undefined;
  const workflowId = data?.workflowDefinitionId ?? id;
  const workflow = useWorkflow(workflowId);
  const graph = useRunGraph(workflowId, data?.definitionVersionId);
  const stages = useMemo(() => (data?.stageRuns ?? []) as RunStage[], [data?.stageRuns]);
  const top = useMemo(() => stages.filter((s) => !s.scopeId), [stages]);
  const workflowName = workflow.data?.graph.workflow.name ?? 'Workflow';
  const runTitle = data ? runName(data) : 'Run';
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Workflows', href: WORKFLOWS_HREF }, { label: workflowName, href: workflowHref(workflowId) }, { label: runTitle, href: runHref(workflowId, runId) }], [workflowName, workflowId, runTitle, runId]));
  const statuses = useMemo(() => {
    const map = new Map<string, StageNodeStatus>();
    for (const s of top) {
      const status = resolveStatus('stageRun', effectiveStageStatus(s, data?.status) as never);
      if (!status) continue;
      const row = stageRowView(s, graph.data?.graph.stages.find((g) => g.key === s.stageKey));
      map.set(s.stageKey, { state: status.state, label: status.label, instanceId: s.id, ...(row.duration && status.state !== 'queued' ? { detail: row.duration } : {}) });
    }
    return map;
  }, [top, data?.status, graph.data]);
  const waiting = data ? needsYou(runId, stages).filter((i) => i.sheet) : [];
  const first = waiting[0];
  const state = run.isLoading || graph.isLoading ? { kind: 'loading' as const } : run.isError || !data || !graph.data ? { kind: 'error' as const, error: run.error ?? graph.error, onRetry: () => void Promise.all([run.refetch(), graph.refetch()]), title: "Couldn't load the graph" } : { kind: 'ready' as const };
  const openNode = (key: string): void => {
    const instance = top.find((s) => s.stageKey === key);
    if (!instance) return;
    if (instance.status === 'awaiting_input') router.push(approvalHref(workflowId, runId, instance.id) as Href);
    else if (instance.sessionId) router.push(stageHref(workflowId, runId, instance.id) as Href);
  };

  return (
    <Screen header={<Header role="detail" title="Graph" breadcrumb={breadcrumb} onBack={onBack} />} scroll="none" state={state} testID="run-graph">
      {graph.data ? (
        <View className="flex-1">
          {first ? (
            <View className="mx-4 mb-2 flex-row items-center gap-3 rounded-card-lg border border-line bg-raised p-3" testID="run-graph-needs-you">
              <Icon concept="hand" size={20} tone="warn" />
              <View className="flex-1">
                <Text role="subhead" weight={600} numberOfLines={1}>{`${first.name} needs you`}</Text>
                <Text role="footnote" tone="fg-2" numberOfLines={1}>
                  {first.detail}
                </Text>
              </View>
              <Button label="Review" variant="primary" size="sm" onPress={() => router.push(approvalHref(workflowId, runId, first.instanceId) as Href)} />
            </View>
          ) : null}
          <RunGraph
            variant="canvas"
            graph={graph.data.graph}
            statuses={statuses}
            {...(first?.stage ? { focusKey: first.stage.stageKey } : {})}
            onNodePress={openNode}
            onList={() => (router.canGoBack() ? router.back() : router.replace(runHref(workflowId, runId) as Href))}
            testID="run-graph-canvas"
          />
        </View>
      ) : null}
    </Screen>
  );
}
