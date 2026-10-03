// The run pane's own tabs (MWorkflowRunPane; MG-28; M8-04), rendered by the run screen into MB-42 beside the shared
// workspace tabs: Output — the focused stage (a picker over the run's stages, "stage i of n"), its status, the review
// it waits on ("Review" opens the approval sheet: one approval surface, MD-21), its structured output (table / tree,
// MG-32 hints absent), summary or text, its files (open in the workspace preview; "View diff" → Changes) and usage;
// Hooks — the workflow's and the stage's configured hooks (phase, type, failure policy, on / off); no run results
// (the server lists none, MD-27); Variables — the run's inputs with their declared labels, the run-wide overrides
// and the focused stage's overrides.
import React from 'react';
import { ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { resolveStatus } from '@generatorai/shared';
import type { StageSpec, WorkflowGraph } from '@generatorai/workflow-spec';

import { usageLine } from '../../../blocks/DecisionCard';
import { approvalHref, workspaceFileHref } from '../../../blocks/shell/hrefs';
import { usePaneStore } from '../../../blocks/WorkspacePane';
import { KeyValueList } from '../../../ui/layout/KeyValueList';
import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { haptic } from '../../../ui/platform/haptics';
import { Badge } from '../../../ui/primitives/Badge';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { Link } from '../../../ui/primitives/Link';
import { StatusBadge } from '../../../ui/primitives/StatusBadge';
import { Text } from '../../../ui/primitives/Text';
import type { RunStage } from '../model/runStages';
import { stageGateOf } from '../model/stageGate';
import { StructuredOutputView } from './StructuredOutputView';

type Href = Parameters<typeof router.push>[0];

export interface RunPaneData {
  runId: string;
  workflowId: string;
  workspaceId: string | null;
  stages: readonly RunStage[];
  graph: WorkflowGraph | undefined;
  /** The run's inputs and overrides. */
  variables: Record<string, unknown>;
  runOverrides?: { model?: string; harnessType?: string; reasoningEffort?: string } | null;
  stageOverrides?: Array<{ stageKey: string; skip?: boolean; variables?: Record<string, unknown>; model?: string }> | null;
  focusedId: string | null;
  onFocus: (stageId: string) => void;
}

const visibleFiles = (stage: RunStage | undefined) => (stage?.artifactManifest ?? []).filter((f) => !/^unnamed\.[A-Za-z0-9]+$/.test(f.path));

/** The stage the Output tab opens on: one that needs you, else the running one, else the last that finished. */
export function focusStage(stages: readonly RunStage[]): RunStage | undefined {
  return stages.find((s) => s.status === 'awaiting_input') ?? stages.find((s) => s.status === 'running' || s.status === 'starting') ?? [...stages].reverse().find((s) => s.status === 'completed' || s.status === 'failed') ?? stages[0];
}

export function OutputTab({ data }: { data: RunPaneData }): React.ReactElement {
  const stage = data.stages.find((s) => s.id === data.focusedId) ?? focusStage(data.stages);
  if (!stage) return <EmptyState compact icon="activity" title="No stages yet" description="Output appears as the run reaches its stages." />;
  const index = data.stages.indexOf(stage);
  const status = resolveStatus('stageRun', stage.status as never);
  const review = stage.status === 'awaiting_input' && stageGateOf(stage.interruptData).kind !== 'loop';
  const files = visibleFiles(stage);
  const usage = usageLine(stage.usage);
  const output = stage.outputData && Object.keys(stage.outputData).length ? stage.outputData : null;
  const text = stage.summary?.trim() || stage.outputText?.trim() || null;
  return (
    <ScrollView contentContainerClassName="gap-4 pb-8 pt-2" testID="run-pane-output">
      <ListSection>
        <ListRow
          kind="picker"
          title="Stage"
          subtitle={`stage ${index + 1} of ${data.stages.length}`}
          picker={{ value: stage.id, options: data.stages.map((s) => ({ value: s.id, label: s.name ?? s.stageKey, description: s.instancePath ?? s.stageKey })), onValueChange: data.onFocus, searchable: data.stages.length > 12, testID: 'run-pane-stage' }}
        />
      </ListSection>
      <View className="gap-3 px-4">
        <View className="flex-row flex-wrap items-center gap-2">
          {status ? <StatusBadge state={status.state} label={status.label} size="sm" /> : null}
          <Text role="monoSm" tone="fg-3">
            {stage.stageKey}
          </Text>
          {usage ? (
            <Text role="monoSm" tone="fg-3">
              {usage}
            </Text>
          ) : null}
        </View>
        {review ? <Button label="Review" icon="hand" variant="primary" fullWidth onPress={() => router.push(approvalHref(data.workflowId, data.runId, stage.id) as Href)} testID="run-pane-review" /> : null}
        {output ? <StructuredOutputView value={output} /> : null}
        {text ? (
          <View className="gap-1 rounded-card bg-sunken p-3">
            <Text role="footnote" weight={600}>
              {stage.summary ? 'Summary' : 'Output'}
            </Text>
            <Text role="footnote" selectable>
              {text}
            </Text>
          </View>
        ) : null}
        {!output && !text ? (
          <Text role="footnote" tone="fg-3">
            {stage.status === 'running' ? 'Output appears when the stage finishes.' : 'This stage recorded no output.'}
          </Text>
        ) : null}
        {stage.error ? (
          <Text role="footnote" tone="err" selectable>
            {stage.error}
          </Text>
        ) : null}
      </View>
      {files.length ? (
        <ListSection title="Files" count={files.length} action={data.workspaceId ? { label: 'View diff', onPress: () => usePaneStore.getState().select('changes') } : undefined}>
          {files.map((f) => (
            <ListRow
              key={f.path}
              kind={data.workspaceId ? 'navigation' : 'value'}
              icon="file"
              title={f.path.split(/[\\/]/).pop() ?? f.path}
              subtitle={f.path}
              value={f.action}
              {...(data.workspaceId ? { onPress: () => router.push(workspaceFileHref(data.workspaceId!, { path: f.path }) as Href) } : {})}
            />
          ))}
        </ListSection>
      ) : null}
    </ScrollView>
  );
}

function hookRows(hooks: ReadonlyArray<{ id: string; name: string; phase: string; type: string; enabled: boolean; failurePolicy: string }>): React.ReactElement[] {
  return hooks.map((h) => <ListRow key={h.id} kind="value" icon="hook" title={h.name} subtitle={`${h.phase} · ${h.type} · on failure ${h.failurePolicy}`} value={h.enabled ? 'On' : 'Off'} mono />);
}

export function HooksTab({ data }: { data: RunPaneData }): React.ReactElement {
  const stage = data.stages.find((s) => s.id === data.focusedId) ?? focusStage(data.stages);
  const spec: StageSpec | undefined = data.graph?.stages.find((s) => s.key === stage?.stageKey);
  const stageHooks = spec?.kind === 'agent' ? spec.hooks : [];
  const workflowHooks = data.graph?.workflow.hooks ?? [];
  if (!stageHooks.length && !workflowHooks.length) return <EmptyState compact icon="hook" title="No hooks" description="This workflow runs no hooks." />;
  return (
    <ScrollView contentContainerClassName="gap-4 pb-8 pt-2" testID="run-pane-hooks">
      {stageHooks.length ? (
        <ListSection title={`${stage?.name ?? 'Stage'} hooks`} count={stageHooks.length}>
          {hookRows(stageHooks)}
        </ListSection>
      ) : null}
      {workflowHooks.length ? (
        <ListSection title="Workflow hooks" count={workflowHooks.length} footer="Configured hooks; their run results are on desktop.">
          {hookRows(workflowHooks)}
        </ListSection>
      ) : null}
    </ScrollView>
  );
}

export function VariablesTab({ data }: { data: RunPaneData }): React.ReactElement {
  const stage = data.stages.find((s) => s.id === data.focusedId) ?? focusStage(data.stages);
  const labels = new Map((data.graph?.workflow.variables ?? []).map((v) => [v.name, v.label]));
  const inputs = Object.entries(data.variables).filter(([k]) => !k.startsWith('__'));
  const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
  const overrides = Object.entries(data.runOverrides ?? {}).filter(([, v]) => v);
  const stageOverride = data.stageOverrides?.find((o) => o.stageKey === stage?.stageKey);
  return (
    <ScrollView contentContainerClassName="gap-4 pb-8 pt-2" testID="run-pane-variables">
      {inputs.length ? (
        <ListSection title="Inputs" count={inputs.length}>
          {inputs.map(([k, v]) => (
            <ListRow key={k} kind="value" icon="variable" title={k} subtitle={labels.get(k) ?? undefined} value={show(v)} mono copyable />
          ))}
        </ListSection>
      ) : (
        <Text role="footnote" tone="fg-3" className="px-4">
          This run took no inputs.
        </Text>
      )}
      {overrides.length ? (
        <View className="gap-2 px-4">
          <Text role="subhead" weight={600}>
            Run overrides
          </Text>
          <KeyValueList items={overrides.map(([k, v]) => ({ label: k, value: String(v), mono: true }))} />
        </View>
      ) : null}
      {stageOverride && stage ? (
        <View className="gap-2 px-4">
          <View className="flex-row items-center gap-2">
            <Text role="subhead" weight={600}>
              {`${stage.name ?? stage.stageKey} overrides`}
            </Text>
            {stageOverride.skip ? <Badge label="Skipped" size="sm" /> : null}
          </View>
          <KeyValueList
            items={[
              ...(stageOverride.model ? [{ label: 'model', value: stageOverride.model, mono: true }] : []),
              ...Object.entries(stageOverride.variables ?? {}).map(([k, v]) => ({ label: k, value: show(v), mono: true })),
            ]}
          />
        </View>
      ) : null}
      {inputs.length ? (
        <View className="px-4">
          <Link label="Copy inputs as JSON" onPress={() => void Clipboard.setStringAsync(JSON.stringify(Object.fromEntries(inputs), null, 2)).then(() => haptic('success'))} standalone />
        </View>
      ) : null}
    </ScrollView>
  );
}
