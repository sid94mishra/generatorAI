// ────────────────────────────────────────────────────────────────
// Workflow — what it does, how it went, and a way to run it.
//
// A stage OUTLINE, not a DAG: a node graph needs pan, zoom and edge routing
// to be legible and at phone width it is a smear, so the stages are listed
// in order with their prerequisites spelled out. Editing stays on the
// desktop; STARTING a run is a phone action and gets the sticky bar.
// Workflow-level hooks are listed read-only; deleting the definition lives
// in the header menu behind a confirmation.
//
// The definition is a v2 record (`WorkflowDefinitionRecord`,
// @generatorai/workflow-spec): everything shown comes from `record.graph`,
// stages are identified by key. A draft (never published) only starts test
// runs, so it wears a Draft badge and the action reads "Test run".
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Lock, MoreHorizontal, Play, Trash2, Webhook, Workflow as WorkflowIcon } from 'lucide-react-native';
import { epochOr, queryKeys } from '@generatorai/client-core';

import type { AgentStage } from '@generatorai/workflow-spec';

import { incomingStages } from '../../src/components/work/workflowGraph';
import { Sheet, SheetSection } from '../../src/components/ui/Sheet';
import { Touchable } from '../../src/components/ui/Touchable';
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

const RECENT_RUNS = 5;

export default function WorkflowScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workflowId = String(id);
  const api = useApi();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const runStart = useFeature('runStart');
  const workflowEdit = useFeature('workflowEdit');
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [selectedStage, setSelectedStage] = useState<AgentStage | null>(null);

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
      title: workflow.data?.graph.workflow.name ?? 'Workflow',
      headerRight: () =>
        loaded ? (
          <IconButton
            icon={<MoreHorizontal size={20} color={colors.foreground} />}
            accessibilityLabel="Workflow actions"
            onPress={() => setMenu(true)}
          />
        ) : null,
    });
  }, [navigation, workflow.data?.graph.workflow.name, loaded, colors.foreground]);

  const remove = useMutation({
    // The server deletes an unused definition and archives one that runs
    // pin (the runs are kept); the confirmation says which.
    mutationFn: () => admin.definitions.remove(workflowId),
    onSuccess: () => {
      haptics.commit();
      queryClient.removeQueries({ queryKey: [...queryKeys.workflows(), 'detail', workflowId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/runs?segment=workflows' as never);
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not delete the workflow', err instanceof Error ? err.message : String(err));
    },
  });

  const graph = workflow.data?.graph;
  const stages = useMemo(() => graph?.stages ?? [], [graph]);
  const inputs = useMemo(() => parseVariables(graph?.workflow.variables), [graph]);
  const hooks = useMemo(() => parseWorkflowHooks(graph?.workflow.hooks), [graph]);
  const stageList = useMemo(() => stages.map((stage) => ({ key: stage.key, name: stage.name })), [stages]);

  const incoming = useMemo(() => incomingStages(graph?.edges ?? []), [graph]);

  const nameOf = useMemo(() => new Map(stages.map((stage) => [stage.key, stage.name])), [stages]);

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

  const record = workflow.data;
  const spec = record.graph.workflow;
  const isDraft = record.status === 'draft';
  const latest = sortedRuns[0];
  const visibleRuns = showAllRuns ? sortedRuns : sortedRuns.slice(0, RECENT_RUNS);

  return (
    <View className="flex-1 bg-background">
      <PlainScroll onRefresh={pull.onRefresh} refreshing={pull.refreshing}>
        <Card className="gap-2 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-control">
              <WorkflowIcon size={18} color={colors['muted-foreground']} />
            </View>
            <View className="flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                <Text numberOfLines={2} className="shrink text-lg font-semibold text-foreground">
                  {spec.name}
                </Text>
                {isDraft ? <Badge label="Draft" tone="neutral" /> : null}
              </View>
              <Text className="text-sm text-muted-foreground">
                {stages.length} stage{stages.length === 1 ? '' : 's'}
                {inputs.length > 0 ? ` · ${inputs.length} input${inputs.length === 1 ? '' : 's'}` : ''}
                {latest ? ` · last run ${relativeTime(latest.updatedAt)}` : ' · never run'}
              </Text>
            </View>
            {latest ? <StatusGlyph status={latest.status} size={28} /> : null}
          </View>
          {spec.description ? (
            <Text className="text-sm leading-relaxed text-muted-foreground">{spec.description}</Text>
          ) : null}
          {isDraft ? (
            <Text className="text-sm text-muted-foreground">
              Not published yet: runs from here are test runs of the current graph.
            </Text>
          ) : null}
        </Card>

        {/* Runs first: on a phone this page is where a workflow's runs live
            (there is no separate runs list, as on desktop), so they sit right
            under the summary, ahead of the definition's stages and hooks. */}
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
            message={runStart.available ? 'Start the first run below.' : 'Runs appear here once it has run.'}
            icon={<Play size={22} color={colors['muted-foreground']} />}
          />
        ) : (
          <FlatRows>
            {visibleRuns.map((run) => (
<RunRow key={run.id} run={run} />
            ))}
          </FlatRows>
        )}

        <SectionHeader title={`Stages (${stages.length})`} />
        {stages.length === 0 ? (
          <EmptyState title="No stages" message="This workflow has no stages yet." />
        ) : (
          <Card className="px-4 py-1">
            {stages.map((stage, index) => {
              const deps = incoming.get(stage.key) ?? [];
              return (
                <Touchable
                  key={stage.key}
                  accessibilityLabel={`Inspect ${stage.name}`}
                  accessibilityHint="Shows instructions, model and review requirements"
                  onPress={() => setSelectedStage(stage)}
                  scale="none"
                  className="flex-row gap-3"
                >
                  {/* The same connected rail as a run's step list, so a
                      definition and its runs read as one shape. */}
                  <View className="w-7 items-center">
                    <View className={`h-3 w-px ${index === 0 ? 'bg-transparent' : 'bg-border'}`} />
                    <View className="h-7 w-7 items-center justify-center rounded-full bg-control">
                      <Text className="text-sm font-semibold text-muted-foreground">{index + 1}</Text>
                    </View>
                    <View className={`w-px flex-1 ${index === stages.length - 1 ? 'bg-transparent' : 'bg-border'}`} />
                  </View>
                  <View
                    className={`flex-1 gap-1 py-3 ${index < stages.length - 1 ? 'border-b border-border-muted' : ''}`}
                  >
                    <View className="min-h-7 flex-row items-center gap-2">
                      <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
                        {stage.name}
                      </Text>
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
                </Touchable>
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

        <View style={{ height: STICKY_BAR_SPACE }} />
      </PlainScroll>

      <StickyActionBar>
        {runStart.available ? (
          <Button
            label={isDraft ? (inputs.length > 0 ? 'Test run…' : 'Test run') : inputs.length > 0 ? 'Run…' : 'Run workflow'}
            size="lg"
            full
            haptic="commit"
            icon={<Play size={18} color={colors['primary-foreground']} />}
            onPress={() => setSheet(true)}
            accessibilityHint={isDraft ? 'Choose inputs and start a test run of this draft' : 'Choose inputs and start a new run'}
          />
        ) : (
          <View className="flex-row items-center gap-3">
            <Lock size={16} color={colors['muted-foreground']} />
            <Text className="flex-1 text-sm text-muted-foreground">
              Starting runs needs agent permission on this device.
            </Text>
            <Button label="Request access" variant="secondary" size="sm" onPress={runStart.requestAccess} />
          </View>
        )}
      </StickyActionBar>

      <StartRunSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        workflow={{
          id: workflowId,
          name: spec.name,
          projectId: spec.projectId ?? null,
          variables: spec.variables,
          draft: isDraft,
          stages: stageList,
          lifecycle: spec.lifecycle,
        }}
      />

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={spec.name}
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
      <Sheet visible={selectedStage !== null} onClose={() => setSelectedStage(null)} title={selectedStage?.name ?? 'Stage'} detents={[0.6, 0.92]}>
        <View className="gap-3 px-5 pb-6">
          <Text className="text-sm text-muted-foreground">{selectedStage?.description ?? 'Workflow stage'}</Text>
          <SheetSection title="Execution" />
          <Text className="text-md text-foreground">
            {selectedStage?.session?.model ?? 'Workflow default model'}
            {selectedStage?.session?.reasoningEffort ? ` · ${selectedStage.session.reasoningEffort}` : ''}
          </Text>
          {selectedStage?.session?.agentRef ? <Text className="text-sm text-foreground">Agent: {selectedStage.session.agentRef}</Text> : null}
          <Text className="text-sm text-muted-foreground">{selectedStage?.approval ? 'Pauses for your review before continuing.' : 'Continues when the stage finishes.'}</Text>
          <SheetSection title="Instructions" />
          {(selectedStage?.prompts ?? []).map((prompt, i) => (
            <View key={i} className="gap-1 rounded-xl border border-border p-3">
              <Text className="text-sm font-semibold text-foreground">{prompt.label}</Text>
              <Text selectable className="text-md leading-relaxed text-foreground">{prompt.text}</Text>
            </View>
          ))}
          {selectedStage && selectedStage.prompts.length === 0 ? <Text className="text-sm text-muted-foreground">No inline instructions.</Text> : null}
        </View>
      </Sheet>
      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this workflow?"
        message={
          sortedRuns.length > 0
            ? `It has ${sortedRuns.length} run${sortedRuns.length === 1 ? '' : 's'}, so it is archived rather than removed: the runs stay, and it can no longer be run.`
            : 'The definition and its stages are removed for good. This cannot be undone.'
        }
        confirmLabel="Delete workflow"
        onConfirm={() => remove.mutate()}
      />
    </View>
  );
}
