// ────────────────────────────────────────────────────────────────
// Workflow definition.
//
// A stage LIST, not a DAG. A node graph needs pan, zoom and edge routing to
// be legible, and at 393pt wide it is a smear — so the stages are shown in
// dependency order with their edges spelled out in text instead.
//
// Read-only. Editing a workflow is a desktop action; this screen exists so
// you can see what a run is about to do and jump into its history.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Workflow as WorkflowIcon } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { relativeTime } from '../../src/components/runs/formatTime';
import { isActive, needsAttention, statusLabel } from '../../src/components/runs/statusStyle';
import { Badge, Card, SectionHeader, StatusDot, type Tone } from '../../src/components/ui/primitives';
import { Touchable } from '../../src/components/ui/Touchable';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { PlainScroll } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

/** The stage shape as the definition endpoint serialises it. */
interface StageNode {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  dependsOn?: string[];
}

interface EdgeNode {
  from?: string;
  to?: string;
  source?: string;
  target?: string;
}

function runTone(status: string): Tone {
  if (needsAttention(status)) return status === 'failed' ? 'danger' : 'warning';
  if (isActive(status)) return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

export default function WorkflowScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const navigation = useNavigation();
  const { colors } = useTheme();

  const workflow = useQuery({
    queryKey: ['workflows', id],
    queryFn: () => api.workflows.get(id!),
  });

  const runs = useQuery({
    queryKey: queryKeys.runs(id!),
    queryFn: () => api.runs.list({ definitionId: id! }),
  });

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: workflow.data?.name ?? 'Workflow' });
  }, [navigation, workflow.data?.name]);

  const stages = (workflow.data?.stages ?? []) as StageNode[];
  const edges = (workflow.data?.edges ?? []) as EdgeNode[];

  // Incoming edges per stage, so each row can state its own prerequisites
  // rather than relying on a picture of the graph.
  const incoming = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
      const from = edge.from ?? edge.source;
      const to = edge.to ?? edge.target;
      if (!from || !to) continue;
      map.set(to, [...(map.get(to) ?? []), from]);
    }
    return map;
  }, [edges]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of stages) if (stage.id) map.set(stage.id, stage.name ?? stage.id);
    return map;
  }, [stages]);

  if (workflow.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={5} />
      </View>
    );
  }

  if (workflow.isError) {
    return <ErrorState message="Could not load this workflow." onRetry={() => void workflow.refetch()} />;
  }

  return (
    <PlainScroll
      onRefresh={() => {
        void workflow.refetch();
        void runs.refetch();
      }}
      refreshing={workflow.isFetching || runs.isFetching}
    >
      {workflow.data?.description ? (
        <Text className="px-1 text-sm leading-relaxed text-muted-foreground">
          {workflow.data.description}
        </Text>
      ) : null}

      <SectionHeader title={`Stages (${stages.length})`} />
      {stages.length === 0 ? (
        <EmptyState title="No stages" message="This definition has no stages yet." />
      ) : (
        <View className="gap-2.5">
          {stages.map((stage, index) => {
            const deps = (stage.id ? incoming.get(stage.id) : undefined) ?? stage.dependsOn ?? [];
            return (
              <Card key={stage.id ?? `${index}`} className="gap-1.5 p-3.5">
                <View className="flex-row items-center gap-2.5">
                  <View className="h-7 w-7 items-center justify-center rounded-xl bg-subtle">
                    <Text className="text-xs font-semibold text-muted-foreground">{index + 1}</Text>
                  </View>
                  <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
                    {stage.name ?? stage.id ?? `Stage ${index + 1}`}
                  </Text>
                  {stage.type ? <Badge label={stage.type} tone="neutral" /> : null}
                </View>
                {stage.description ? (
                  <Text numberOfLines={3} className="text-xs leading-relaxed text-muted-foreground">
                    {stage.description}
                  </Text>
                ) : null}
                {deps.length > 0 ? (
                  <View className="flex-row items-center gap-1.5">
                    <GitBranch size={12} color={colors['muted-foreground']} />
                    <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
                      after {deps.map((d) => nameOf.get(d) ?? d).join(', ')}
                    </Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}

      <SectionHeader title={`Runs (${runs.data?.length ?? 0})`} />
      {(runs.data ?? []).length === 0 ? (
        <EmptyState
          title="Never run"
          message="Start this workflow from the desktop or web app."
          icon={<WorkflowIcon size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        <View className="gap-2.5">
          {(runs.data ?? []).map((run) => (
            <Touchable
              key={run.id}
              accessibilityLabel={`${run.name ?? 'Run'}, ${statusLabel(run.status)}`}
              haptic="tap"
              scale="large"
              onPress={() => router.push(`/runs/${run.id}`)}
            >
              <Card className="flex-row items-center gap-3 p-3.5">
                <StatusDot tone={runTone(run.status)} />
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-sm text-foreground">
                    {run.name ?? 'Workflow run'}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {relativeTime(run.updatedAt)}
                  </Text>
                </View>
                <Badge label={statusLabel(run.status)} tone={runTone(run.status)} />
              </Card>
            </Touchable>
          ))}
        </View>
      )}

      <Text className="px-1 pt-2 text-xs leading-relaxed text-muted-foreground">
        Workflows are edited on the desktop or web app — a node graph is not usable at this width.
      </Text>
    </PlainScroll>
  );
}
