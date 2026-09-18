// ────────────────────────────────────────────────────────────────
// Workflow — what it does, how it went, and a way to run it.
//
// A stage OUTLINE, not a DAG: a node graph needs pan, zoom and edge routing
// to be legible and at phone width it is a smear, so the stages are listed
// in order with their prerequisites spelled out. Editing stays on the
// desktop; STARTING a run is a phone action and gets the sticky bar.
// Workflow-level hooks are listed read-only; deleting the definition lives
// in the header menu behind a confirmation.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Lock, MoreHorizontal, Play, Trash2, Webhook, Workflow as WorkflowIcon } from 'lucide-react-native';
import { epochOr, queryKeys } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAdminApi } from '../../src/api/useAdminApi';
import { parseWorkflowHooks } from '../../src/components/work/workflowHooks';
import { ActionSheet, ConfirmSheet, type MenuAction } from '../../src/components/ui/ActionSheet';
import { ListItem } from '../../src/components/ui/ListItem';
import { haptics } from '../../src/components/ui/haptics';
import { relativeTime } from '../../src/components/runs/formatTime';
import { FlatRows, RunRow } from '../../src/components/runs/RunRow';
import { StatusGlyph } from '../../src/components/runs/StatusGlyph';
import { useFeature } from '../../src/components/runs/useFeature';
import { usePullRefresh } from '../../src/components/runs/usePullRefresh';
import { STICKY_BAR_SPACE, StickyActionBar } from '../../src/components/work/StickyActionBar';
import { StartRunSheet } from '../../src/components/work/StartRunSheet';
import { parseVariables } from '../../src/components/work/variableForm';
import { Badge, Card, SectionHeader } from '../../src/components/ui/primitives';
import { Button, IconButton } from '../../src/components/ui/Button';
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
  sourceStageId?: string;
  targetStageId?: string;
}

const RECENT_RUNS = 5;

export default function WorkflowScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workflowId = String(id);
  const api = useApi();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const runControl = useFeature('runControl');
  const workflowEdit = useFeature('workflowEdit');
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);

  const workflow = useQuery({
    queryKey: [...queryKeys.workflows(), 'detail', workflowId],
    queryFn: () => api.workflows.get(workflowId),
  });

  const runs = useQuery({
    queryKey: queryKeys.runs(workflowId),
    queryFn: () => api.runs.list({ definitionId: workflowId }),
  });

  const pull = usePullRefresh(() => Promise.all([workflow.refetch(), runs.refetch()]));

  const loaded = Boolean(workflow.data);
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: workflow.data?.name ?? 'Workflow',
      headerRight: () =>
        loaded ? (
          <IconButton
            icon={<MoreHorizontal size={20} color={colors.foreground} />}
            accessibilityLabel="Workflow actions"
            onPress={() => setMenu(true)}
          />
        ) : null,
    });
  }, [navigation, workflow.data?.name, loaded, colors.foreground]);

  const remove = useMutation({
    // Runs reference the definition (409 without force); the confirmation
    // says they go too, so the delete is forced only when there are any.
    mutationFn: () => admin.definitions.remove(workflowId, (runs.data?.length ?? 0) > 0),
    onSuccess: () => {
      haptics.commit();
      queryClient.removeQueries({ queryKey: [...queryKeys.workflows(), 'detail', workflowId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/runs');
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not delete the workflow', err instanceof Error ? err.message : String(err));
    },
  });

  const stages = (workflow.data?.stages ?? []) as StageNode[];
  const edges = (workflow.data?.edges ?? []) as EdgeNode[];
  const detail = workflow.data as (Record<string, unknown> & { variables?: unknown }) | undefined;
  const inputs = useMemo(() => parseVariables(detail?.variables), [detail?.variables]);
  const hooks = useMemo(() => parseWorkflowHooks(detail?.['hooks']), [detail]);
  const stageNames = useMemo(
    () => stages.map((stage, index) => stage.name ?? stage.id ?? `Stage ${index + 1}`),
    [stages],
  );

  const incoming = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
      const from = edge.from ?? edge.source ?? edge.sourceStageId;
      const to = edge.to ?? edge.target ?? edge.targetStageId;
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

  const sortedRuns = useMemo(
    () => [...(runs.data ?? [])].sort((a, b) => epochOr(b.updatedAt) - epochOr(a.updatedAt)),
    [runs.data],
  );

  if (workflow.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={5} />
      </View>
    );
  }

  if (workflow.isError || !workflow.data) {
    return <ErrorState message="Could not load this workflow." onRetry={() => void workflow.refetch()} />;
  }

  const latest = sortedRuns[0];
  const visibleRuns = showAllRuns ? sortedRuns : sortedRuns.slice(0, RECENT_RUNS);

  return (
    <View className="flex-1 bg-background">
      <PlainScroll onRefresh={pull.onRefresh} refreshing={pull.refreshing}>
        <Card className="gap-2 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-emphasis">
              <WorkflowIcon size={18} color={colors['muted-foreground']} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text numberOfLines={2} className="text-lg font-semibold text-foreground">
                {workflow.data.name}
              </Text>
              <Text className="text-sm text-muted-foreground">
                {stages.length} stage{stages.length === 1 ? '' : 's'}
                {inputs.length > 0 ? ` · ${inputs.length} input${inputs.length === 1 ? '' : 's'}` : ''}
                {latest ? ` · last run ${relativeTime(latest.updatedAt)}` : ' · never run'}
              </Text>
            </View>
            {latest ? <StatusGlyph status={latest.status} size={28} /> : null}
          </View>
          {workflow.data.description ? (
            <Text className="text-sm leading-relaxed text-muted-foreground">{workflow.data.description}</Text>
          ) : null}
        </Card>

        <SectionHeader title={`Stages (${stages.length})`} />
        {stages.length === 0 ? (
          <EmptyState title="No stages" message="This workflow has no stages yet." />
        ) : (
          <Card className="px-4 py-1">
            {stages.map((stage, index) => {
              const deps = (stage.id ? incoming.get(stage.id) : undefined) ?? stage.dependsOn ?? [];
              return (
                <View
                  key={stage.id ?? `${index}`}
                  className={`flex-row gap-3 py-3 ${index > 0 ? 'border-t border-border-muted' : ''}`}
                >
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-emphasis">
                    <Text className="text-sm font-semibold text-muted-foreground">{index + 1}</Text>
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="min-h-7 flex-row items-center gap-2">
                      <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
                        {stage.name ?? stage.id ?? `Stage ${index + 1}`}
                      </Text>
                      {stage.type && stage.type !== 'agent' ? <Badge label={stage.type} tone="neutral" /> : null}
                    </View>
                    {stage.description ? (
                      <Text numberOfLines={3} className="text-sm leading-relaxed text-muted-foreground">
                        {stage.description}
                      </Text>
                    ) : null}
                    {deps.length > 0 ? (
                      <View className="flex-row items-center gap-1.5">
                        <GitBranch size={12} color={colors['muted-foreground']} />
                        <Text numberOfLines={1} className="flex-1 text-sm text-muted-foreground">
                          after {deps.map((d) => nameOf.get(d) ?? d).join(', ')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        {hooks.length > 0 ? (
          <>
            <SectionHeader title={`Hooks (${hooks.length})`} />
            <FlatRows>
              {hooks.map((hook) => (
                <ListItem
                  key={hook.id}
                  title={hook.name}
                  subtitle={hook.subtitle}
                  avatar={{ icon: <Webhook size={17} color={colors['muted-foreground']} />, tone: 'neutral' }}
                  badge={hook.enabled ? null : { label: 'Off', tone: 'neutral' }}
                  separator={false}
                  accessibilityLabel={`${hook.name}, ${hook.subtitle}${hook.enabled ? '' : ', off'}`}
                />
              ))}
            </FlatRows>
          </>
        ) : null}

        <SectionHeader
          title={`Runs (${sortedRuns.length})`}
          action={
            sortedRuns.length > RECENT_RUNS ? (
              <Button
                label={showAllRuns ? 'Show fewer' : 'Show all'}
                variant="ghost"
                size="sm"
                onPress={() => setShowAllRuns((v) => !v)}
              />
            ) : undefined
          }
        />
        {runs.isLoading ? (
          <SkeletonList rows={3} />
        ) : sortedRuns.length === 0 ? (
          <EmptyState
            title="Never run"
            message={runControl.available ? 'Start the first run below.' : 'Runs appear here once it has run.'}
            icon={<Play size={22} color={colors['muted-foreground']} />}
          />
        ) : (
          <FlatRows>
            {visibleRuns.map((run) => (
<RunRow key={run.id} run={run} />
            ))}
          </FlatRows>
        )}

        <View style={{ height: STICKY_BAR_SPACE }} />
      </PlainScroll>

      <StickyActionBar>
        {runControl.available ? (
          <Button
            label={inputs.length > 0 ? 'Run…' : 'Run workflow'}
            size="lg"
            full
            haptic="commit"
            icon={<Play size={18} color={colors['primary-foreground']} />}
            onPress={() => setSheet(true)}
            accessibilityHint="Choose inputs and start a new run"
          />
        ) : (
          <View className="flex-row items-center gap-3">
            <Lock size={16} color={colors['muted-foreground']} />
            <Text className="flex-1 text-sm text-muted-foreground">
              Starting runs needs workflow permission on this device.
            </Text>
            <Button label="Request access" variant="secondary" size="sm" onPress={runControl.requestAccess} />
          </View>
        )}
      </StickyActionBar>

      <StartRunSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        workflow={{
          id: workflowId,
          name: workflow.data.name,
          projectId: workflow.data.projectId ?? null,
          variables: detail?.variables,
          orchestratorConfig: detail?.['orchestratorConfig'],
          stageNames,
        }}
      />

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={workflow.data.name}
        actions={
          workflowEdit.available
            ? ([
                {
                  label: 'Delete workflow',
                  destructive: true,
                  icon: <Trash2 size={18} color={colors.danger} />,
                  onPress: () => {
                    haptics.warn();
                    setConfirmDelete(true);
                  },
                },
              ] satisfies MenuAction[])
            : [
                {
                  label: 'Request access',
                  detail: 'Deleting workflows needs workflow-edit permission on this device.',
                  icon: <Lock size={18} color={colors['muted-foreground']} />,
                  onPress: workflowEdit.requestAccess,
                },
              ]
        }
      />
      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this workflow?"
        message={
          sortedRuns.length > 0
            ? `The definition, its stages and its ${sortedRuns.length} run${sortedRuns.length === 1 ? '' : 's'} are removed for good. This cannot be undone.`
            : 'The definition and its stages are removed for good. This cannot be undone.'
        }
        confirmLabel="Delete workflow"
        onConfirm={() => remove.mutate()}
      />
    </View>
  );
}
