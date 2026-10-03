// Workflow (MWorkflowDetail, MWorkflowDetailMore; `/workflows/[id]`; M8-01): breadcrumb "Workflows" (the only real
// ancestor; the project is a Setup row),
// More (Duplicate as draft, Export JSON | Delete…); the neutral version chip ("Published v7" / "Draft · rev 13",
// MD-25) with the revision and the last save; migration notes; the description; facts (stages, approval gates,
// tags); the mini graph (one button with the graph in words → `/workflows/[id]/graph`); the 30-day strip
// (succeeded, median run, runs — each only when the server has it); Recent runs (MB-49 RunRow, "View all");
// Setup (project, codebases, worktree per run, default session, post-processing, workflow hooks, automations);
// Variables (type, required, default). NewAction "Run" / "Test run" (a draft runs its working graph) opens the
// run sheet; a device without `runStart` gets the scope request card instead.
import React, { useMemo } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { toEpochMs } from '@generatorai/client-core';

import { RunGraph } from '../../blocks/RunGraph';
import { RunRow } from '../../blocks/RunRow';
import { ScopeRequestCard } from '../../blocks/ScopeRequestCard';
import { WORKFLOWS_HREF, automationHref, runSheetHref, workflowGraphHref, workflowHref, workflowRunsHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { formatDurationShort, formatRate } from '../../blocks/StatsCards';
import { FEATURE_REQUIREMENTS, checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { StatStrip } from '../../ui/layout/StatStrip';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Callout } from '../../ui/primitives/Callout';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { definitionFacts, duplicateGraph, hooksLine, postProcessingLine, sessionLine, variableRows, versionChip, versionLabels } from './model/workflowsModel';
import { useDefinitionVersions, useLinkedAutomations, useProjectsList, useWorkflow, useWorkflowRuns, useWorkflowStats, useWorkflowWrites } from './queries';

type Href = Parameters<typeof router.push>[0];
type MenuId = 'duplicate' | 'export' | 'delete';
const RECENT_RUNS = 5;
const dateOf = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export default function WorkflowDetailScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onBack = useHeaderBack();
  const scopes = useGrantedScopes();
  const canEdit = scopes.includes('write:workflows');
  const runStart = checkFeature('runStart', scopes);
  const workflow = useWorkflow(id);
  const versions = useDefinitionVersions(id);
  const runs = useWorkflowRuns(id, { limit: 50 });
  const stats = useWorkflowStats(id);
  const projects = useProjectsList();
  const { linked } = useLinkedAutomations(id);
  const writes = useWorkflowWrites();
  const record = workflow.data;
  const graph = record?.graph;
  const projectId = graph?.workflow.projectId ?? null;
  const projectName = projectId ? (projects.data ?? []).find((p) => p.id === projectId)?.name : undefined;
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Workflows', href: WORKFLOWS_HREF }], []));
  const labels = useMemo(() => versionLabels(versions.data), [versions.data]);
  const isDraft = record?.status === 'draft';

  const act = (mid: MenuId): void => {
    if (!record || !graph) return;
    switch (mid) {
      case 'duplicate':
        writes
          .create(duplicateGraph(graph))
          .then((copy) => {
            haptic('success');
            router.push(workflowHref(copy.id) as Href);
          })
          .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        return;
      case 'export':
        writes
          .exportText(record.id)
          .then((text) => Share.share({ title: graph.workflow.name, message: text }))
          .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        return;
      case 'delete':
        void confirm({
          title: `Delete ${graph.workflow.name}?`,
          message: (runs.data?.length ?? 0) > 0 ? 'It has runs, so it is archived instead: the runs stay and it can no longer be run.' : 'The workflow and its versions are removed for good.',
          confirmLabel: 'Delete workflow',
          icon: 'trash',
        }).then((ok) => {
          if (!ok) return;
          writes
            .remove(record.id)
            .then(() => {
              if (router.canGoBack()) router.back();
              else router.replace(WORKFLOWS_HREF as Href);
            })
            .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
        });
    }
  };
  const menu: MenuEntry[] = [
    ...(canEdit ? [{ id: 'duplicate', label: 'Duplicate as draft', icon: 'copy' as const }] : []),
    { id: 'export', label: 'Export JSON', icon: 'download' },
    ...(canEdit ? [{ type: 'separator' as const }, { id: 'delete', label: 'Delete workflow', icon: 'trash' as const, destructive: true }] : []),
  ];

  const header = (
    <Header
      role="detail"
      title={graph?.workflow.name ?? 'Workflow'}
      breadcrumb={breadcrumb}
      onBack={onBack}
      actions={record ? [{ id: 'more', icon: 'more', label: 'Workflow actions', menu, onMenuSelect: (mid: string) => act(mid as MenuId), testID: 'workflow-more' }] : []}
    />
  );
  const state = workflow.isLoading
    ? { kind: 'loading' as const }
    : workflow.isError || !record
      ? { kind: 'error' as const, error: workflow.error, onRetry: () => void workflow.refetch(), title: "Couldn't load this workflow" }
      : { kind: 'ready' as const };

  const chip = record ? versionChip(record, versions.data) : null;
  const updated = record ? toEpochMs(record.updatedAt) : null;
  const facts = graph ? definitionFacts(graph) : [];
  const runRows = runs.data ?? [];
  const s = stats.data?.runs;
  const strip = s
    ? [
        ...(s.successRate !== undefined ? [{ id: 'success', value: formatRate(s.successRate), label: 'Succeeded' }] : []),
        ...(s.medianDurationMs !== undefined ? [{ id: 'median', value: formatDurationShort(s.medianDurationMs), label: 'Median run' }] : []),
        { id: 'runs', value: s.total, label: 'Runs · 30d' },
      ]
    : [];
  const hooks = graph ? hooksLine(graph) : null;
  const variables = graph ? variableRows(graph.workflow.variables) : [];
  const lifecycle = graph?.workflow.lifecycle;

  return (
    <Screen
      header={header}
      state={state}
      onRefresh={async () => void (await Promise.all([workflow.refetch(), runs.refetch(), stats.refetch(), versions.refetch()]))}
      bottomAccessory={record && runStart.available ? <NewAction label={isDraft ? 'Test run' : 'Run'} icon="play" onPress={() => router.push(runSheetHref(record.id) as Href)} testID="workflow-run" /> : undefined}
      testID="workflow-detail"
    >
      {record && graph ? (
        <View className="gap-5 pb-28 pt-2">
          <View className="gap-3 px-4">
            <View className="flex-row flex-wrap items-center gap-2">
              {chip ? <Badge label={chip.label} {...(chip.suffix ? { suffix: chip.suffix } : {})} icon={isDraft ? 'edit' : 'status-succeeded'} testID="workflow-version" /> : null}
              {record.hasUnpublishedChanges && !isDraft ? <Badge label="Unpublished changes" tone="outline" /> : null}
              <Text role="footnote" tone="fg-3">
                {[`revision ${record.revision}`, updated ? dateOf.format(updated) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {record.archivedAt ? <Callout tone="info" title="Archived" body="This workflow has runs, so it was archived instead of deleted. It can no longer be run." /> : null}
            {record.needsAttention.length ? <Callout tone="warn" title="Needs attention" body={record.needsAttention.join('\n')} /> : null}
            {graph.workflow.description ? (
              <Text role="body" tone="fg-2" selectable>
                {graph.workflow.description}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {facts.map((f) => (
                <Badge key={f.id} label={f.label} icon={f.icon} tone="outline" />
              ))}
            </View>
            {graph.stages.length ? (
              <RunGraph variant="mini" graph={graph} caption={chip ? `${chip.label}${chip.suffix ? ` ${chip.suffix}` : ''} · read-only` : undefined} onPress={() => router.push(workflowGraphHref(record.id) as Href)} testID="workflow-mini-graph" />
            ) : null}
            {strip.length ? <StatStrip variant="strip" items={strip} testID="workflow-stats" /> : null}
            {!runStart.available && !record.archivedAt ? <ScopeRequestCard verb="start runs" scopes={FEATURE_REQUIREMENTS.runStart.scopes} body={FEATURE_REQUIREMENTS.runStart.reason} /> : null}
          </View>

          <ListSection title="Recent runs" {...(runRows.length ? { count: runRows.length } : {})} {...(runRows.length > RECENT_RUNS ? { action: { label: 'View all', onPress: () => router.push(workflowRunsHref(record.id) as Href) } } : {})}>
            {runs.isLoading ? <ListRow kind="info" title="Loading runs…" /> : null}
            {!runs.isLoading && runRows.length === 0 ? <ListRow kind="info" icon="play" title="Never run" subtitle={runStart.available ? 'Start the first run with Run.' : 'Runs appear here once it has run.'} /> : null}
            {runRows.slice(0, RECENT_RUNS).map((run) => (
              <RunRow key={run.id} run={run as never} context="workflow" versionLabel={labels.get((run as { definitionVersionId?: string }).definitionVersionId ?? '') ?? null} />
            ))}
          </ListSection>

          <ListSection title="Setup">
            <ListRow kind="value" icon="projects" title="Project" value={projectName ?? (projectId ? 'Project' : 'No project')} />
            <ListRow kind="value" icon="branch" title="Codebases" value={lifecycle?.codebaseAliases.length ? lifecycle.codebaseAliases.join(', ') : 'None'} mono={Boolean(lifecycle?.codebaseAliases.length)} {...(lifecycle?.requiresCodebase ? { subtitle: 'A run needs at least one' } : {})} />
            <ListRow kind="value" icon="layers" title="Worktree per run" value={lifecycle?.useWorktree ? 'Isolated' : 'In place'} />
            <ListRow kind="value" icon="model" title="Default session" value={sessionLine(graph.workflow.session) ?? 'Server default'} />
            <ListRow kind="value" icon="commit" title="Post-processing" value={postProcessingLine(graph) ?? 'None'} />
            <ListRow kind="value" icon="hook" title="Workflow hooks" value={hooks?.title ?? 'None'} {...(hooks ? { subtitle: hooks.detail, mono: true } : {})} />
            {linked.map((a) => (
              <ListRow key={a.id} kind="navigation" icon="automations" title="Automation" value={a.name} {...(a.cronExpression ? { subtitle: a.cronExpression } : {})} onPress={() => router.push(automationHref(a.id) as Href)} />
            ))}
          </ListSection>

          <ListSection title="Variables" {...(variables.length ? { count: variables.length } : {})} footer="Asked for at launch. Change setup and variables in the builder, then publish.">
            {variables.length === 0 ? <ListRow kind="info" icon="variable" title="No variables" subtitle="Runs start without inputs." /> : null}
            {variables.map((v) => (
              <ListRow key={v.name} kind="value" icon="variable" title={v.name} subtitle={v.detail} value={v.defaultText ? `default ${v.defaultText}` : '—'} testID={`workflow-variable-${v.name}`} />
            ))}
          </ListSection>
          {!graph.stages.length ? (
            <View className="flex-row items-center gap-2 px-4">
              <Icon concept="info" size={14} tone="fg-3" />
              <Text role="footnote" tone="fg-3">
                No stages yet. Add stages in the builder.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
