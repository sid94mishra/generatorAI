// Run workflow (MWorkflowLaunch, MWorkflowLaunchAdvanced, MWorkflowLaunchPlan; `/workflows/[id]/run`, a route sheet,
// MD-21; M8-01/M8-02). Page "Run options": the declared inputs (MB-36 VariableForm); Stages — a checkbox to skip each
// (its own 44 / 48 target) and the row opens that stage's overrides as a page inside the sheet (model, variables;
// MD-62); Advanced — run-wide model and effort, run name, "Stop after" (a wall-clock budget), the permission mode
// (MB-47; Bypass needs admin), the project's codebases with their base branch. Page "Plan preview": what the
// server would do with exactly this request (layers with approval gates and skipped stages, setup, risks,
// warnings), nothing written. Footer (MD-85): Review plan / ‹ Options, Test run (secondary when a published
// workflow has unpublished changes), and the one filled Run (Test run for a draft, MD-22). Every start carries
// one idempotency key per intent; success replaces the sheet with the run (MD-80). Uploads are not offered (the
// app has no document picker; skills / agents / prompts files are a desktop act).
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { blankStageOverrides, codebaseDrafts, type CodebaseDraft, type StageOverrideDraft } from '@generatorai/client-core';
import { REASONING_EFFORTS, type InvocationPlan } from '@generatorai/workflow-spec';

import { PERMISSION_MODE_LABEL, PermissionModePicker, canBypass, type RunPermissionMode } from '../../blocks/PermissionModePicker';
import { stageNeedsApproval } from '../../blocks/RunGraph';
import { runHref, workflowHref } from '../../blocks/shell/hrefs';
import { useModelPickerCatalog } from '../../blocks/TurnSheet';
import { VariableForm, buildVariables, firstMissing, initialDraft, parseVariables, type Draft } from '../../blocks/VariableForm';
import { useIdempotencyKey } from '../../services/api/useIdempotencyKey';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText } from '../../ui/lib/format';
import { RouteSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Checkbox } from '../../ui/primitives/Checkbox';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Field } from '../../ui/primitives/Field';
import { Icon } from '../../ui/primitives/Icon';
import { Input } from '../../ui/primitives/Input';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { EMPTY_OPTIONS, invocationBody, issueLines, planCodebases, planHeadline, planLayers, runActions, stagesIncluded, type RunOptions } from './model/runSheetModel';
import { formatStageVariables, parseStageVariables } from './model/stageOverrideModel';
import { postProcessingLine, versionChip } from './model/workflowsModel';
import { useCodebaseBranches, useDefinitionVersions, useInvokeWorkflow, usePlanInvocation, useProjectCodebases, useWorkflow } from './queries';

type Href = Parameters<typeof router.replace>[0];
type Page = { kind: 'options' } | { kind: 'stage'; key: string } | { kind: 'plan' };
const DEFAULT = '';

function StageRow({ draft, approval, modelName, onToggle, onOpen }: { draft: StageOverrideDraft; approval: boolean; modelName: string | null; onToggle: (run: boolean) => void; onOpen: () => void }): React.ReactElement {
  const vars = Object.keys(draft.variables).length;
  return (
    <View className="min-h-row-2 flex-row items-center gap-2 ps-2 pe-4">
      <Checkbox checked={!draft.skip} onValueChange={onToggle} accessibilityLabel={`Run ${draft.stageName}`} testID={`run-stage-${draft.stageKey}-run`} />
      <Pressable onPress={onOpen} frame="none" accessibilityRole="button" accessibilityLabel={`${draft.stageName}${draft.skip ? ', skipped' : ''}. Overrides`} className="min-h-row flex-1 flex-row items-center gap-2" testID={`run-stage-${draft.stageKey}`}>
        <View className="flex-1 gap-0.5">
          <Text role="body" tone={draft.skip ? 'fg-3' : 'fg'} numberOfLines={1}>
            {draft.stageName}
          </Text>
          <Text role="monoSm" tone="fg-3" numberOfLines={1}>
            {draft.stageKey}
          </Text>
        </View>
        {approval ? <Icon concept="hand" size={14} tone="fg-3" accessibilityLabel="Approval gate" /> : null}
        <Text role="footnote" tone="fg-2" numberOfLines={1}>
          {draft.skip ? 'Skipped' : [modelName, vars ? `${vars} var${vars === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'Defaults'}
        </Text>
        <Icon concept="chevron-right" size={14} tone="fg-3" />
      </Pressable>
    </View>
  );
}

function CodebaseRow({ draft, projectId, codebaseId, onChange }: { draft: CodebaseDraft; projectId: string; codebaseId: string; onChange: (d: CodebaseDraft) => void }): React.ReactElement {
  const branches = useCodebaseBranches(draft.selected ? projectId : null, codebaseId);
  return (
    <>
      <ListRow kind="check" title={draft.alias} mono subtitle={draft.mode === 'in_place' ? 'in place' : 'worktree'} selected={draft.selected} onValueChange={(v) => onChange({ ...draft, selected: v })} testID={`run-codebase-${draft.alias}`} />
      {draft.selected ? (
        <ListRow
          kind="picker"
          title={`${draft.alias} branch`}
          icon="branch"
          picker={{ value: draft.baseRef, options: [{ value: DEFAULT, label: 'Default branch' }, ...(branches.data ?? []).map((b) => ({ value: b, label: b }))], onValueChange: (baseRef) => onChange({ ...draft, baseRef }), searchable: (branches.data?.length ?? 0) > 12, testID: `run-codebase-${draft.alias}-branch` }}
        />
      ) : null}
    </>
  );
}

function PlanPage({ plan, loading, error, onRetry }: { plan: InvocationPlan | undefined; loading: boolean; error: unknown; onRetry: () => void }): React.ReactElement {
  if (loading) return <Skeleton preset="list" count={5} />;
  if (!plan) return <ErrorState title="Couldn't preview the run" error={error} onRetry={onRetry} />;
  const layers = planLayers(plan);
  const skipped = plan.stages.filter((s) => s.skipped);
  const codebases = planCodebases(plan);
  return (
    <View className="gap-4">
      <ListSection title="Layers" footer={planHeadline(plan)}>
        {layers.map((l) => (
          <View key={l.layer} className="min-h-row flex-row items-center gap-3 px-4 py-2" accessible accessibilityLabel={`Layer ${l.layer + 1}: ${l.stages.map((s) => `${s.key}${s.skipped ? ', skipped' : ''}${s.approvalRequired ? ', approval' : ''}`).join('; ')}`}>
            <Text role="monoSm" tone="fg-3">{`L${l.layer + 1}`}</Text>
            <View className="flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1">
              {l.stages.map((s, i) => (
                <View key={s.key} className="flex-row items-center gap-1">
                  {i > 0 ? (
                    <Text role="monoSm" tone="fg-3">
                      ‖
                    </Text>
                  ) : null}
                  <Text role="mono" tone={s.skipped ? 'fg-3' : 'fg'}>
                    {s.key}
                  </Text>
                  {s.approvalRequired ? <Icon concept="hand" size={12} tone="fg-3" /> : null}
                  {s.skipped ? <Badge label={s.skipReason === 'guard_false' ? 'Guard false' : 'Skipped'} size="sm" /> : null}
                </View>
              ))}
            </View>
          </View>
        ))}
      </ListSection>
      {skipped.length ? (
        <Text role="footnote" tone="fg-3" className="px-4">
          {`${skipped.map((s) => s.key).join(', ')} ${skipped.length === 1 ? 'is' : 'are'} skipped. Guards that depend on stage results are decided during the run.`}
        </Text>
      ) : null}
      <ListSection title="Setup">
        <ListRow kind="value" icon="branch" title="Codebases" value={codebases ?? 'None'} mono={Boolean(codebases)} />
        <ListRow kind="value" icon="shield" title="Permission" value={PERMISSION_MODE_LABEL[plan.permissionMode]} />
        {plan.prepare.length ? <ListRow kind="value" icon="layers" title="Prepares" value={plan.prepare.join(' → ')} /> : null}
        <ListRow kind="value" icon="commit" title="Post-processing" value={plan.postProcessing.length ? plan.postProcessing.join(' → ') : 'None'} />
      </ListSection>
      {plan.risks.map((r) => (
        <View key={r.code} className="px-4">
          <Callout tone="warn" title="Runs repository code" body={`${r.message} (${r.stageKeys.join(', ')})`} />
        </View>
      ))}
      {plan.warnings.length ? (
        <ListSection title="Warnings" count={plan.warnings.length} footer="Warnings don't block the run.">
          {plan.warnings.map((w, i) => (
            <ListRow key={`${w.code}-${i}`} kind="info" icon="warning" title={w.message} subtitle={[w.code, w.path.join('.')].filter(Boolean).join(' · ')} />
          ))}
        </ListSection>
      ) : null}
    </View>
  );
}

export default function RunSheet(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const scopes = useGrantedScopes();
  const workflow = useWorkflow(id);
  const versions = useDefinitionVersions(id);
  const invoke = useInvokeWorkflow(id);
  const plan = usePlanInvocation();
  const catalog = useModelPickerCatalog();
  const idempotency = useIdempotencyKey();
  const record = workflow.data;
  const graph = record?.graph;
  const projectId = graph?.workflow.projectId ?? null;
  const codebases = useProjectCodebases(projectId);
  const defs = useMemo(() => parseVariables(graph?.workflow.variables), [graph]);
  const top = useMemo(() => (graph?.stages ?? []).filter((s) => !s.parentKey), [graph]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [options, setOptions] = useState<RunOptions | null>(null);
  const [page, setPage] = useState<Page>({ kind: 'options' });
  const [stageVars, setStageVars] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const values = draft ?? initialDraft(defs);
  const base = useMemo<RunOptions>(
    () => ({
      ...EMPTY_OPTIONS,
      projectId,
      stages: blankStageOverrides(top),
      codebases: codebaseDrafts((codebases.data ?? []).map((c) => c.alias), graph?.workflow.lifecycle),
    }),
    [projectId, top, codebases.data, graph],
  );
  const opts = options ?? base;
  const setOpts = (patch: Partial<RunOptions>): void => setOptions({ ...opts, ...patch });
  const built = buildVariables(defs, values);
  const missing = firstMissing(defs, values);
  const stageVarError = Object.entries(stageVars)
    .map(([key, text]) => ({ key, error: parseStageVariables(text).error }))
    .find((x) => x.error);
  const blocked = missing ? `${missing} is required` : stageVarError ? `Fix the variables of ${stageVarError.key}` : null;
  const actions = record ? runActions(record) : null;
  const chip = record ? versionChip(record, versions.data) : null;
  const modelName = (mid: string | undefined): string | null => (mid ? (catalog.catalog?.models.find((m) => m.id === mid)?.name ?? mid) : null);
  const body = (test: boolean) => invocationBody(id, { variables: built.variables, test, options: opts });

  // Leaving the plan page for an option change drops the stale preview.
  useEffect(() => {
    if (page.kind !== 'plan') plan.reset();
  }, [page.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(workflowHref(id) as Href);
  };
  const start = (test: boolean): void => {
    setSubmitted(true);
    if (!built.valid || blocked) return;
    invoke.mutate(
      { body: body(test), idempotencyKey: idempotency.get() },
      {
        onSettled: (_r, e) => idempotency.settle(e ?? undefined),
        onSuccess: (r) => {
          haptic('success');
          router.replace(runHref(id, r.runId) as Href);
        },
      },
    );
  };
  const review = (): void => {
    setSubmitted(true);
    if (!built.valid || blocked) return;
    setPage({ kind: 'plan' });
    plan.mutate(body(actions?.primary === 'test'));
  };

  const stage = page.kind === 'stage' ? opts.stages.find((s) => s.stageKey === page.key) : undefined;
  const patchStage = (key: string, patch: Partial<StageOverrideDraft>): void => setOpts({ stages: opts.stages.map((s) => (s.stageKey === key ? { ...s, ...patch } : s)) });
  const issues = invoke.error ? issueLines(invoke.error) : [];
  const modelOptions = (fallback: string) => [{ value: DEFAULT, label: fallback }, ...(catalog.catalog?.models ?? []).map((m) => ({ value: m.id, label: m.name, description: m.provider }))];
  const codebaseIds = new Map((codebases.data ?? []).map((c) => [c.alias, c.id]));

  const footer =
    actions && page.kind !== 'stage' ? (
      <View className="gap-2">
        <View className="flex-row gap-2">
          {page.kind === 'plan' ? (
            <Button label="Options" icon="chevron-left" size="lg" onPress={() => setPage({ kind: 'options' })} testID="run-sheet-options" />
          ) : (
            <Button label="Review plan" size="lg" disabled={Boolean(blocked)} onPress={review} testID="run-sheet-review" />
          )}
          {actions.secondaryTest ? (
            <View className="flex-1">
              <Button label="Test run" size="lg" fullWidth disabled={invoke.isPending || Boolean(blocked)} onPress={() => start(true)} testID="run-sheet-test" />
            </View>
          ) : null}
          <View className="flex-1">
            <Button
              label={actions.primary === 'test' ? 'Test run' : 'Run'}
              icon="play"
              variant="primary"
              size="lg"
              fullWidth
              loading={invoke.isPending}
              disabled={invoke.isPending || Boolean(blocked)}
              {...(blocked ? { disabledReason: blocked } : {})}
              onPress={() => start(actions.primary === 'test')}
              testID="run-sheet-run"
            />
          </View>
        </View>
        <View className="flex-row items-center justify-center gap-1">
          <Icon concept="info" size={12} tone="fg-3" />
          <Text role="caption" tone="fg-3" numberOfLines={2}>
            {blocked ? `${blocked}.` : actions.primary === 'test' ? 'A draft runs its current graph as a test run.' : `Test run is for drafts. Published workflows run ${chip?.suffix ?? 'the published version'}.`}
          </Text>
        </View>
      </View>
    ) : undefined;

  const title = page.kind === 'plan' ? 'Plan preview' : stage ? stage.stageName : actions?.primary === 'test' ? 'Test run' : 'Run workflow';
  const back = page.kind === 'options' ? undefined : { label: page.kind === 'plan' ? 'Run options' : 'Run options', onPress: () => setPage({ kind: 'options' }) };

  return (
    <RouteSheet
      title={title}
      {...(graph ? { subtitle: `${graph.workflow.name}${chip?.suffix ? ` · ${chip.suffix}` : ''}` } : {})}
      onDismiss={close}
      {...(back ? { back } : {})}
      scrollable
      dirty={(draft !== null || options !== null) && !invoke.isSuccess}
      navigation={navigation as never}
      {...(footer ? { footer } : {})}
      testID="run-sheet"
    >
      <View className="gap-4 pb-4">
        {workflow.isLoading ? (
          <Skeleton preset="list" count={4} />
        ) : !record || !graph ? (
          <ErrorState title="Couldn't load this workflow" error={workflow.error} onRetry={() => void workflow.refetch()} />
        ) : page.kind === 'plan' ? (
          <PlanPage plan={plan.data} loading={plan.isPending} error={plan.error} onRetry={review} />
        ) : stage ? (
          <View className="gap-4" testID="run-stage-page">
            <ListSection footer="Overrides apply to this run only.">
              <ListRow kind="toggle" title="Run this stage" subtitle={stage.skip ? 'Skipped in this run' : stage.stageKey} switchValue={!stage.skip} onValueChange={(v) => patchStage(stage.stageKey, { skip: !v })} testID="run-stage-run" />
              <ListRow kind="picker" title="Model" icon="model" picker={{ value: stage.model ?? DEFAULT, options: modelOptions("Stage's own"), onValueChange: (model) => patchStage(stage.stageKey, { model }), searchable: (catalog.catalog?.models.length ?? 0) > 12, testID: 'run-stage-model' }} />
            </ListSection>
            <View className="px-4">
              <Field help="One key=value per line. Numbers and true / false are sent typed." {...(stageVars[stage.stageKey] !== undefined && parseStageVariables(stageVars[stage.stageKey]!).error ? { error: parseStageVariables(stageVars[stage.stageKey]!).error! } : {})}>
                <Textarea
                  label="Stage variables"
                  value={stageVars[stage.stageKey] ?? formatStageVariables(stage.variables)}
                  onChangeText={(text) => {
                    setStageVars({ ...stageVars, [stage.stageKey]: text });
                    const parsed = parseStageVariables(text);
                    if (!parsed.error) patchStage(stage.stageKey, { variables: parsed.variables });
                  }}
                  mono
                  minRows={3}
                  placeholder="focus=checkout"
                  testID="run-stage-variables"
                />
              </Field>
            </View>
            <View className="px-4">
              <Button label="Done" size="lg" fullWidth onPress={() => setPage({ kind: 'options' })} testID="run-stage-done" />
            </View>
          </View>
        ) : (
          <>
            {invoke.isError ? <Callout tone="err" title="The run didn't start" body={issues.length ? issues.join('\n') : errorText(invoke.error)} /> : null}
            {defs.length ? (
              <VariableForm variables={defs} draft={values} onChange={(name, value) => setDraft({ ...values, [name]: value })} errors={submitted ? built.errors : {}} footer={`${defs.length} typed`} testIDPrefix="run-var" />
            ) : null}
            {opts.stages.length ? (
              <ListSection title={`Stages ${stagesIncluded(opts.stages)}`} footer="Clear to skip · tap for overrides" dividers="inset">
                {opts.stages.map((s) => {
                  const spec = top.find((t) => t.key === s.stageKey);
                  return <StageRow key={s.stageKey} draft={s} approval={spec ? stageNeedsApproval(spec) : false} modelName={modelName(s.model)} onToggle={(run) => patchStage(s.stageKey, { skip: !run })} onOpen={() => setPage({ kind: 'stage', key: s.stageKey })} />;
                })}
              </ListSection>
            ) : null}
            <ListSection title="Advanced" footer="Run options; empty fields keep the workflow's.">
              <ListRow kind="picker" title="Model" icon="model" picker={{ value: opts.model, options: modelOptions('Workflow default'), onValueChange: (model) => setOpts({ model }), searchable: (catalog.catalog?.models.length ?? 0) > 12, testID: 'run-model' }} />
              <ListRow kind="picker" title="Effort" icon="think" picker={{ value: opts.effort, options: [{ value: DEFAULT, label: 'Default' }, ...REASONING_EFFORTS.map((e) => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))], onValueChange: (effort) => setOpts({ effort }), testID: 'run-effort' }} />
              <Input label="Run name" value={opts.name} onChangeText={(name) => setOpts({ name })} placeholder={graph.workflow.name} maxLength={200} testID="run-name" />
              <ListRow kind="stepper" title="Stop after (min)" subtitle={opts.stopAfterMinutes ? 'The run is cancelled after this' : 'No time limit'} stepper={{ value: opts.stopAfterMinutes, onValueChange: (stopAfterMinutes) => setOpts({ stopAfterMinutes }), min: 0, max: 1440, step: 5, format: (v) => (v ? `${v} min` : 'Off'), testID: 'run-stop-after' }} />
            </ListSection>
            <PermissionModePicker value={opts.permission} onValueChange={(permission: RunPermissionMode) => setOpts({ permission })} canBypass={canBypass(scopes)} footer="Default: the workflow's mode, then the server's." testIDPrefix="run-permission" />
            {opts.codebases.length ? (
              <ListSection title="Codebases" footer="Sent with the run; each mounts as its own worktree.">
                {opts.codebases.map((c) => (
                  <CodebaseRow key={c.alias} draft={c} projectId={projectId!} codebaseId={codebaseIds.get(c.alias) ?? ''} onChange={(next) => setOpts({ codebases: opts.codebases.map((x) => (x.alias === c.alias ? next : x)) })} />
                ))}
              </ListSection>
            ) : null}
            {postProcessingLine(graph) ? (
              <View className="flex-row items-center gap-2 px-4">
                <Icon concept="commit" size={14} tone="fg-3" />
                <Text role="footnote" tone="fg-3">
                  {`After the stages: ${postProcessingLine(graph)}`}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </RouteSheet>
  );
}
