// A stage as a compact chat (MRunStageChat; `/workflows/[id]/runs/[runId]/stages/[stageRunId]`; P03b; M8-03). Header
// `detail`: breadcrumb Workflows › <workflow> › Run · <time>, the stage name, the StatusLine (status · agent), the
// run pane toggle and the stage menu (MDF-74, ≤ 3 groups, from the server's command availability: Pause · Resume ·
// Retry ▸ Resume keeps turns / Restart · Skip as completed · Re-run from here | Copy output · Open the run |
// Cancel stage…). Body: MB-07 TranscriptView over the stage session's persisted messages and its live stream
// (`stageRun:<id>`, rebuilt from the run scope by useStageLive); a completion review is the ReviewCard (signed);
// an in-turn gate or approval wait pins its card in the composer's dock. The composer is MB-01 variant `stage`: no
// model chip (WF-17), the next message's mode; a message between turns queues as the next turn, one to a completed
// stage amends it, one to a paused stage retries it; "Decide the review first" while a gate waits.
import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ApiError, newIdempotencyKey, type AgentMode, type ChatMessage } from '@generatorai/client-core';
import { resolveStatus } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';

import { Composer } from '../../blocks/Composer/Composer';
import { readAllAttachmentBytes } from '../../blocks/Composer/model/attachmentPickers';
import type { ComposerSendPayload } from '../../blocks/Composer/model/types';
import { useComposerController } from '../../blocks/Composer/useComposerController';
import { DecisionCard, ReviewCard, reviewView } from '../../blocks/DecisionCard';
import { WORKFLOWS_HREF, runHref, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { TranscriptView, type TranscriptActions } from '../../blocks/TranscriptView';
import { usePaneStore } from '../../blocks/WorkspacePane';
import { isActive } from '../../services/api/runActivity';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { useRunStream } from '../../services/stream/useRunStream';
import { stageStreamKey, useStageLive } from '../../services/stream/useStageLive';
import { useTwoPhaseStop } from '../../services/stream/useTwoPhaseStop';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { haptic } from '../../ui/platform/haptics';
import { useInsets } from '../../ui/platform/insets';
import { useKeyboardOverlap } from '../../ui/platform/keyboard';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { toast } from '../../ui/primitives/Toast';
import { stageMenu, type StageMenuId } from './components/RunTimeline';
import { ApprovalWaitCard, InTurnGateCard } from './components/StageGates';
import { effectiveStageStatus } from './model/runModel';
import { waitOf, type RunStage } from './model/runStages';
import { runName } from './model/runView';
import { stageGateOf } from './model/stageGate';
import { useRun, useRunCommands, useRunGraph, useStageConversation, useStageTranscript, useWorkflow } from './queries';
import { useRunPane, type RunPaneInput } from './useRunPane';
import { useStageDecision } from './useStageDecision';

type Href = Parameters<typeof router.push>[0];

/** What a message does here, once taken (the server decides). */
const SEND_OUTCOME: Record<'queued' | 'amending' | 'retrying', string> = {
  queued: 'Sent — the stage takes it as its next turn.',
  amending: 'Amending this stage’s output. Later stages keep what they already used.',
  retrying: 'The stage resumes with your message.',
};

/** Why the field is shut, when it is. */
function closedReason(status: string): string | null {
  switch (status) {
    case 'pending':
    case 'ready':
    case 'retry_wait':
    case 'waiting':
      return 'The stage has not started its conversation yet.';
    case 'failed':
    case 'skipped':
    case 'cancelled':
      return 'This stage is final. Re-run it from here to continue its work.';
    default:
      return null;
  }
}

function ReviewDock({ runId, stage, agent, approval }: { runId: string; stage: RunStage; agent: string | null; approval: { maxRounds?: number; prompt?: string; allowChanges?: boolean } | null }): React.ReactElement {
  const { signer, decide } = useStageDecision(runId, stage.id);
  const name = stage.name ?? stage.stageKey;
  return (
    <ReviewCard
      view={reviewView({ ...stage, name }, approval)}
      agent={agent}
      allowChanges={approval?.allowChanges !== false}
      approval={{ risky: true, readiness: signer.readiness, noun: signer.noun, onRegister: signer.register, registering: signer.registering, error: signer.error }}
      onDecide={(outcome, feedback) => decide({ outcome, name, ...(feedback ? { feedback } : {}), ...(stage.version !== undefined ? { expectedVersion: stage.version } : {}) })}
    />
  );
}

export default function StageChatScreen(): React.ReactElement {
  const { id = '', runId = '', stageRunId = '' } = useLocalSearchParams<{ id: string; runId: string; stageRunId: string }>();
  const focused = useIsFocused();
  const onBack = useHeaderBack();
  const insets = useInsets();
  const keyboard = useKeyboardOverlap();
  const scopes = useGrantedScopes();
  const runControl = checkFeature('runControl', scopes);
  const runStart = checkFeature('runStart', scopes);
  const { connected } = useRunStream(runId, focused);
  const run = useRun(runId, focused, connected);
  const data = run.data as (typeof run.data & { definitionVersionId?: string }) | undefined;
  const workflowId = data?.workflowDefinitionId ?? id;
  const workflow = useWorkflow(workflowId);
  const graph = useRunGraph(workflowId, data?.definitionVersionId);
  const stage = (data?.stageRuns ?? []).find((s) => s.id === stageRunId) as RunStage | undefined;
  const spec = graph.data?.graph.stages.find((s) => s.key === stage?.stageKey);
  const agentSpec = spec?.kind === 'agent' ? spec : null;
  const agent = agentSpec?.session?.agentRef?.split(':').pop() ?? null;
  const live = stage ? isActive(stage.status) : false;
  const [amendingSince, setAmendingSince] = useState<string | null>(null);
  const amending = amendingSince !== null && String(stage?.amendedAt ?? '') === amendingSince;
  const liveState = useStageLive(runId, stageRunId, live || amending);
  const streaming = (live || amending) && (liveState?.status === 'pending' || liveState?.status === 'streaming' || liveState?.status === 'thinking');
  const transcript = useStageTranscript(runId, stageRunId, stage?.sessionId ?? null, true, focused, live, connected);
  const conversation = useStageConversation(runId, stageRunId);
  const { command, fork } = useRunCommands(runId);
  const [mode, setMode] = useState<AgentMode>('auto');

  const workflowName = workflow.data?.graph.workflow.name ?? 'Workflow';
  const runTitle = data ? runName(data) : 'Run';
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Workflows', href: WORKFLOWS_HREF }, { label: workflowName, href: workflowHref(workflowId) }, { label: runTitle, href: runHref(workflowId, runId) }], [workflowName, workflowId, runTitle, runId]));

  // The run's pane, claimed here too, focused on this stage (the stage works in the run's workspace).
  const workspaceId = data?.workspaceId ?? null;
  const stages = useMemo(() => (data?.stageRuns ?? []) as RunStage[], [data?.stageRuns]);
  const extra = data as { variables?: Record<string, unknown>; runOverrides?: RunPaneInput['runOverrides']; stageOverrides?: RunPaneInput['stageOverrides'] } | undefined;
  const [focusedId, setFocusedId] = useState<string | null>(stageRunId);
  const paneToggle = useRunPane({
    runId,
    workflowId,
    title: runTitle,
    workspaceId,
    stages,
    graph: graph.data?.graph,
    variables: extra?.variables,
    runOverrides: extra?.runOverrides ?? null,
    stageOverrides: extra?.stageOverrides ?? null,
    focusedId,
    onFocus: setFocusedId,
    agentBusy: streaming,
    agentName: agent,
    scopes,
    live: focused,
  });

  const gate = stage?.status === 'awaiting_input' ? stageGateOf(stage.interruptData) : null;
  const wait = stage?.status === 'waiting' ? waitOf(stage) : null;
  const closed = stage ? closedReason(stage.status) : null;
  const disabledReason = !runControl.available ? 'Messaging a stage needs workflow permission on this device.' : (closed ?? (gate ? 'Decide the review first.' : undefined));

  const onSend = async (payload: ComposerSendPayload): Promise<void> => {
    try {
      const files = await readAllAttachmentBytes(payload.attachments);
      const result = await conversation.send.mutateAsync({ message: payload.text.trim(), mode: payload.mode ?? mode, files });
      haptic('success');
      toast({ kind: 'background', message: SEND_OUTCOME[result.outcome] });
      if (result.outcome === 'amending') setAmendingSince(String(stage?.amendedAt ?? ''));
    } catch (err) {
      // The controller restores the draft; say why in the server's words.
      toast({ kind: 'error', message: err instanceof ApiError && err.status === 409 ? err.message : 'Could not send that. Your text has been restored.' });
      throw err;
    }
  };
  const composer = useComposerController({ chatId: `stage:${stageRunId}`, scopes, workspaceId, onSend, disabled: Boolean(disabledReason) });
  const stop = useTwoPhaseStop({ isLive: streaming, onCancel: (options) => conversation.stop.mutate({ force: options.force === true }) });
  const dockStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.value, insets.bottom) }), [insets.bottom]);

  const fail = (e: unknown): void => {
    haptic('error');
    toast({ kind: 'error', message: errorText(e) });
  };
  const send = (body: RunCommand): void => command.mutate(body, { onSuccess: () => haptic('success'), onError: fail });
  const menu: MenuEntry[] = stage
    ? stageMenu(stage, data?.status ?? '', { control: runControl.available, fork: runStart.available }).map((e) => ('id' in e && e.id === 'open-chat' ? { ...e, id: 'open-run', label: 'Open the run', icon: 'workflows' as const } : e))
    : [];
  const onMenu = (mid: string): void => {
    if (!stage) return;
    const name = stage.name ?? stage.stageKey;
    switch (mid as StageMenuId | 'open-run') {
      case 'pause':
        send({ command: 'pause', instanceId: stage.id, mode: 'interrupt' });
        return;
      case 'resume':
        send({ command: 'resume', instanceId: stage.id });
        return;
      case 'retry-resume':
      case 'retry-restart':
        send({ command: 'retry', instanceId: stage.id, mode: mid === 'retry-resume' ? 'resume' : 'restart' });
        return;
      case 'skip':
        send({ command: 'skip', instanceId: stage.id, as: 'completed' });
        return;
      case 'rerun':
        fork.mutate(
          { rerunFrom: [stage.instancePath ?? stage.stageKey], idempotencyKey: newIdempotencyKey() },
          { onSuccess: (r) => router.replace(runHref(workflowId, r.runId) as Href), onError: fail },
        );
        return;
      case 'copy-output':
        void Clipboard.setStringAsync(stage.outputText ?? stage.summary ?? '').then(() => haptic('success'));
        return;
      case 'open-run':
        router.push(runHref(workflowId, runId) as Href);
        return;
      case 'open-pane':
        setFocusedId(stage.id);
        usePaneStore.getState().openTab('output');
        return;
      case 'cancel':
        void confirm({ title: `Cancel ${name}?`, message: 'The agent stops. Stages after it will not start.', confirmLabel: 'Cancel stage', icon: 'status-failed' }).then((ok) => {
          if (ok) send({ command: 'cancel', instanceId: stage.id });
        });
    }
  };

  const status = stage ? resolveStatus('stageRun', effectiveStageStatus(stage, data?.status) as never) : null;
  const actions = useMemo<TranscriptActions>(() => ({ agent: agent ? { name: agent } : null, model: agentSpec?.session?.model ?? null }), [agent, agentSpec?.session?.model]);
  const header = (
    <Header
      role="workspace"
      title={stage?.name ?? 'Stage'}
      breadcrumb={breadcrumb}
      onBack={onBack}
      {...(status ? { status: { state: status.state, label: status.label, ...(agent ? { detail: agent } : {}) } } : {})}
      paneToggle={paneToggle}
      actions={menu.length ? [{ id: 'stage-menu', icon: 'more', label: 'Stage actions', menu, onMenuSelect: onMenu, testID: 'stage-menu' }] : []}
    />
  );

  let dock: React.ReactNode = null;
  if (stage && gate?.kind === 'review') dock = <ReviewDock runId={runId} stage={stage} agent={agent} approval={agentSpec?.approval ?? null} />;
  else if (stage && gate?.kind === 'loop') dock = <DecisionCard runId={runId} stage={{ ...stage, name: stage.name ?? null }} canDecide={runStart.available} />;
  else if (stage && gate && gate.kind !== 'review' && gate.kind !== 'loop') dock = <InTurnGateCard runId={runId} instanceId={stage.id} gate={gate} />;
  else if (stage && wait?.type === 'approval') dock = <ApprovalWaitCard runId={runId} instanceId={stage.id} name={wait.label ?? stage.name ?? stage.stageKey} wait={wait} {...(stage.version !== undefined ? { version: stage.version } : {})} />;

  let body: React.ReactNode;
  if (run.isLoading) body = <View className="flex-1 justify-end px-4 pb-4"><Skeleton preset="transcript" /></View>;
  else if (run.isError) body = <ErrorState title="Couldn't load this run" error={run.error} onRetry={() => void run.refetch()} />;
  else if (!stage) body = <EmptyState icon="status-skipped" title="Stage not found" description="It may belong to a run that was retried." action={{ label: 'Open the run', onPress: () => router.replace(runHref(workflowId, runId) as Href) }} />;
  else if (!stage.sessionId) body = <EmptyState icon="message" title={live ? 'Not started yet' : 'No conversation'} description={stage.kind === 'check' ? 'A check stage runs a command, not an agent.' : 'The conversation appears once the stage starts.'} />;
  else if (transcript.isError) body = <ErrorState title="Couldn't load the transcript" error={transcript.error} onRetry={() => void transcript.refetch()} />;
  else
    body = (
      <TranscriptView
        chatId=""
        streamKey={stageStreamKey(stageRunId)}
        messages={transcript.data as ChatMessage[] | undefined}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
        actions={actions}
        blocked={Boolean(gate)}
        empty={<EmptyState compact icon="message" title="No messages yet" {...(live ? { description: 'The agent is starting up.' } : {})} />}
        testID="stage-transcript"
      />
    );

  return (
    <View className="flex-1 bg-surface" testID="stage-chat">
      {header}
      <Animated.View className="flex-1" style={dockStyle}>
        {body}
        {stage ? (
          <Composer
            {...composer.props}
            variant="stage"
            placeholder={agent ? `Message ${agent} in this stage…` : 'Message this stage…'}
            dock={dock ? <View className="px-3 pt-2">{dock}</View> : null}
            onStop={stop.press}
            stopState={stop}
            isStreaming={streaming}
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
            mode={mode}
            onModeChange={setMode}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}
