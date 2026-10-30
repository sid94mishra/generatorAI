// MB-50 ApprovalSheet for a stage gate (MRunApproval; `/workflows/[id]/runs/[runId]/approval/[stageRunId]`, a route
// sheet, MD-21; the target of the run banner, the stage chat, chat run cards, pushes and links). What it holds
// follows the gate: a completion review — the summary, facts, the reviewer's question, the output (structured
// fields when there are any), the files, the feedback field and the footer (MD-85): the one `lg` Approve over
// [Request changes] [Reject]; every one signed with the approval key ("<Face ID> required", MD-31; registration
// first when the key is missing); an in-turn gate — the chat's card (a risky permission signed); an approval wait —
// its prompt and form; a parked loop — the decision card. Success: `success` haptic after the server confirms and
// the sheet closes, no toast (MD-26). Answered elsewhere: "Already handled" + Open the run.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';

import { DecisionCard, reviewView } from '../../blocks/DecisionCard';
import { riskyActionState } from '../../blocks/GateCard';
import { runHref, stageHref } from '../../blocks/shell/hrefs';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { useRunStream } from '../../services/stream/useRunStream';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Field } from '../../ui/primitives/Field';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { ApprovalWaitCard, InTurnGateCard } from './components/StageGates';
import { waitOf, type RunStage } from './model/runStages';
import { runName } from './model/runView';
import { stageGateOf } from './model/stageGate';
import { useRun, useRunGraph, useRunPendingDecisions } from './queries';
import { useStageDecision, type StageOutcome } from './useStageDecision';

type Href = Parameters<typeof router.replace>[0];

function ReviewBody({ runId, stage, approval, onDone }: { runId: string; stage: RunStage; approval?: { maxRounds?: number; prompt?: string; allowChanges?: boolean } | null; onDone: () => void }): React.ReactElement {
  const { signer, decide } = useStageDecision(runId, stage.id);
  const view = reviewView({ ...stage, name: stage.name ?? stage.stageKey }, approval ?? null);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<StageOutcome | null>(null);
  const risk = riskyActionState(signer.readiness, signer.noun);
  const allowChanges = approval?.allowChanges !== false;
  const files = (stage.artifactManifest ?? []).filter((f) => !/^unnamed\.[A-Za-z0-9]+$/.test(f.path));
  const output = stage.outputData && Object.keys(stage.outputData).length ? Object.entries(stage.outputData) : [];
  const send = (outcome: StageOutcome): void => {
    setPending(outcome);
    void decide({ outcome, name: stage.name ?? stage.stageKey, ...(feedback.trim() ? { feedback: feedback.trim() } : {}), ...(stage.version !== undefined ? { expectedVersion: stage.version } : {}) })
      .then(onDone)
      .catch(() => undefined)
      .finally(() => setPending(null));
  };
  const off = pending !== null || !risk.canAnswer;
  return (
    <View className="gap-4">
      <View className="gap-2 px-4">
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label="Needs you" icon="hand" size="sm" />
          <Text role="footnote" tone="fg-2">
            {stage.name ?? stage.stageKey}
          </Text>
          <Text role="monoSm" tone="fg-3">
            {stage.stageKey}
          </Text>
        </View>
        <Text role="headline" weight={600} selectable>
          {view.summary.split('\n')[0]}
        </Text>
        {view.summary.includes('\n') ? (
          <Text role="body" tone="fg-2" selectable>
            {view.summary.split('\n').slice(1).join('\n').trim()}
          </Text>
        ) : null}
        <Text role="footnote" tone="fg-3">
          {[view.round ? view.round.replace(/^r/, 'R') : null, ...view.facts].filter(Boolean).join(' · ')}
        </Text>
        {view.question ? (
          <Text role="footnote" tone="fg-2">
            {view.question}
          </Text>
        ) : null}
      </View>
      {output.length ? (
        <ListSection title="Output">
          {output.slice(0, 20).map(([k, v]) => (
            <ListRow key={k} kind="value" title={k} value={typeof v === 'string' ? v : JSON.stringify(v)} mono copyable />
          ))}
        </ListSection>
      ) : stage.outputText && stage.outputText.trim() !== view.summary ? (
        <View className="mx-4 rounded-card bg-sunken p-3">
          <Text role="footnote" selectable numberOfLines={30}>
            {stage.outputText.trim()}
          </Text>
        </View>
      ) : null}
      {files.length ? (
        <ListSection title="Files" count={files.length}>
          {files.map((f) => (
            <ListRow key={f.path} kind="value" icon="file" title={f.path.split(/[\\/]/).pop() ?? f.path} subtitle={f.path} value={f.action} mono />
          ))}
        </ListSection>
      ) : null}
      {allowChanges ? (
        <View className="px-4">
          <Field help="Sent with Request changes">
            <Textarea label="Feedback" value={feedback} onChangeText={setFeedback} minRows={3} placeholder="What should change?" testID="approval-feedback" />
          </Field>
        </View>
      ) : null}
      <View className="gap-2 px-4 pb-2">
        {risk.needsRegistration ? (
          <Button label="Register approval key" icon="key" variant="primary" size="lg" fullWidth loading={signer.registering} onPress={signer.register} testID="approval-register" />
        ) : (
          <Button label="Approve" icon="scan" variant="primary" size="lg" fullWidth loading={pending === 'approved'} disabled={off} onPress={() => send('approved')} testID="approval-approve" />
        )}
        <View className="flex-row gap-2">
          {allowChanges ? (
            <View className="flex-1">
              <Button label="Request changes" fullWidth loading={pending === 'changes_requested'} disabled={off || !feedback.trim()} disabledReason="Write the changes you want first" onPress={() => send('changes_requested')} testID="approval-changes" />
            </View>
          ) : null}
          <View className="flex-1">
            <Button label="Reject" variant="destructive" fullWidth loading={pending === 'rejected'} disabled={off} onPress={() => send('rejected')} testID="approval-reject" />
          </View>
        </View>
        <Text role="caption" tone="fg-3" align="center">
          {signer.error ?? risk.note}
        </Text>
      </View>
    </View>
  );
}

export default function StageApprovalSheet(): React.ReactElement {
  const { id = '', runId = '', stageRunId = '' } = useLocalSearchParams<{ id: string; runId: string; stageRunId: string }>();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const scopes = useGrantedScopes();
  const { connected } = useRunStream(runId, focused);
  const run = useRun(runId, focused, connected);
  const workflowId = run.data?.workflowDefinitionId ?? id;
  const graph = useRunGraph(workflowId, (run.data as { definitionVersionId?: string } | undefined)?.definitionVersionId);
  const stage = (run.data?.stageRuns ?? []).find((s) => s.id === stageRunId) as RunStage | undefined;
  const pending = useRunPendingDecisions(runId, Boolean(run.data) && !stage, focused);
  const mirrored = (pending.data ?? []).find((d) => d.instanceId === stageRunId);
  const spec = useMemo(() => graph.data?.graph.stages.find((s) => s.key === stage?.stageKey), [graph.data, stage?.stageKey]);
  const approval = spec?.kind === 'agent' && spec.approval ? spec.approval : null;

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(runHref(workflowId, runId) as Href);
  };
  const openRun = (): void => router.replace(runHref(workflowId, runId) as Href);

  const gate = stage?.status === 'awaiting_input' ? stageGateOf(stage.interruptData) : null;
  const wait = stage?.status === 'waiting' ? waitOf(stage) : null;
  let title = 'Needs you';
  let body: React.ReactNode;
  if (run.isLoading) body = <Skeleton preset="card" />;
  else if (run.isError || !run.data) body = <ErrorState title="Couldn't load this run" error={run.error} onRetry={() => void run.refetch()} />;
  else if (gate?.kind === 'review') {
    title = 'Completion review';
    body = <ReviewBody runId={runId} stage={stage!} approval={approval} onDone={close} />;
  } else if (gate?.kind === 'loop') {
    title = 'Needs decision';
    body = (
      <View className="px-4">
        <DecisionCard runId={runId} stage={{ ...stage!, name: stage!.name ?? null }} canDecide={checkFeature('runStart', scopes).available} />
      </View>
    );
  } else if (gate) {
    body = (
      <View className="px-4">
        <InTurnGateCard runId={runId} instanceId={stageRunId} gate={gate} onDone={close} onOpenStage={() => router.replace(stageHref(workflowId, runId, stageRunId) as Href)} />
      </View>
    );
  } else if (wait?.type === 'approval') {
    title = 'Approval';
    body = (
      <View className="px-4">
        <ApprovalWaitCard runId={runId} instanceId={stageRunId} name={wait.label ?? stage!.name ?? stage!.stageKey} wait={wait} {...(stage!.version !== undefined ? { version: stage!.version } : {})} onDone={close} />
      </View>
    );
  } else if (mirrored) {
    // A sub-workflow child's decision, answered through this run (P05 §4.2).
    const child = { id: mirrored.instanceId, stageKey: mirrored.stageKey, name: mirrored.name, status: 'awaiting_input', interruptData: mirrored.interruptData, version: mirrored.version, workflowRunId: mirrored.runId } as unknown as RunStage;
    title = 'Completion review';
    body = (
      <View className="gap-2">
        <Text role="footnote" tone="fg-3" className="px-4">{`via ${mirrored.via.map((v) => v.name).join(' › ')}`}</Text>
        <ReviewBody runId={runId} stage={child} onDone={close} />
      </View>
    );
  } else {
    body = <EmptyState icon="status-succeeded" title="Already handled" description="It was decided on another device, or the run moved on." action={{ label: 'Open the run', onPress: openRun }} />;
  }

  return (
    <RouteSheet title={title} subtitle={run.data ? `${stage?.name ?? mirrored?.name ?? 'Stage'} · ${runName(run.data)}` : undefined} onDismiss={close} scrollable navigation={navigation as never} testID="approval-sheet">
      <View className="gap-3 pb-4">
        {body}
        {stage || mirrored ? <Button label="Open the run instead" variant="ghost" size="sm" onPress={openRun} testID="approval-open-run" /> : null}
      </View>
    </RouteSheet>
  );
}
