// Run (MWorkflowRun, MWorkflowRunMenu, MRunLoop; `/workflows/[id]/runs/[runId]`, MD-80; M8-03). Header `workspace`
// (MD-18): breadcrumb Workflows › <workflow>, "Run · <start time>" (no "#n" until MG-29), the StatusLine, the pane
// toggle (the run's workspace) and the run menu — Pause run ▸ (Finish current turns · drain / Interrupt now ·
// interrupt) or Resume | Retry failed (a fork) · Copy run ID | Cancel run… · Delete run… (MDF: destructive last).
// Body: the meta line (version, trigger, elapsed), the permission chip (the run's live mode; loosening asks first),
// the usage line against the budget, the lifecycle strip (Setup · Stages k/n · Finalize), what needs you (a bordered
// card with the hand glyph — reviews, in-turn gates and approval waits open the approval sheet MB-50; a parked loop
// is the decision card MB-34 in place; an event wait says what it waits for), the stage timeline (MB-33), and what
// post-processing did once the run finalized. Live through the `run` stream scope; polling is the safety net.
import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { newIdempotencyKey } from '@generatorai/client-core';
import { resolveStatus } from '@generatorai/shared';
import type { RunCommand, StageSpec } from '@generatorai/workflow-spec';

import { DecisionCard } from '../../blocks/DecisionCard';
import { PERMISSION_MODE_LABEL, PermissionModePicker, isLoosening, isRunPermissionMode, type RunPermissionMode } from '../../blocks/PermissionModePicker';
import { triggerLabel } from '../../blocks/RunRow';
import { WORKFLOWS_HREF, approvalHref, runHref, stageHref, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { PaneTabBody, usePaneToggle, useWorkspacePaneClaim, type MobilePaneTab, type PaneTabContext } from '../../blocks/WorkspacePane';
import { isActive, isTerminal } from '../../services/api/runActivity';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { useRunStream } from '../../services/stream/useRunStream';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Chip } from '../../ui/primitives/Chip';
import { Icon } from '../../ui/primitives/Icon';
import { ProgressBar } from '../../ui/primitives/ProgressBar';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { RunTimeline, type StageMenuId } from './components/RunTimeline';
import { runControlsFor } from './model/runModel';
import type { RunStage } from './model/runStages';
import { lifecycleView, needsYou, postProcessingResults, pullRequestOf, runName, usageView, type NeedsYouItem, type PhaseState } from './model/runView';
import { versionLabels } from './model/workflowsModel';
import { useDefinitionVersions, useRun, useRunCommands, useRunGraph, useRunPendingDecisions, useRunPermissionMode, useWorkflow } from './queries';

type Href = Parameters<typeof router.push>[0];
type RunMenuId = 'pause-drain' | 'pause-interrupt' | 'resume' | 'retry' | 'copy-id' | 'cancel' | 'delete';

const PHASE_ICON: Record<PhaseState, { concept: 'status-succeeded' | 'status-running' | 'status-queued' | 'status-failed'; tone: 'ok' | 'run' | 'fg-3' | 'err'; word: string }> = {
  done: { concept: 'status-succeeded', tone: 'ok', word: 'done' },
  running: { concept: 'status-running', tone: 'run', word: 'running' },
  pending: { concept: 'status-queued', tone: 'fg-3', word: 'pending' },
  failed: { concept: 'status-failed', tone: 'err', word: 'failed' },
};

function Phase({ label, state, detail }: { label: string; state: PhaseState; detail?: string }): React.ReactElement {
  const p = PHASE_ICON[state];
  return (
    <View className="flex-row items-center gap-1.5" accessible accessibilityLabel={`${label}, ${detail ?? p.word}`}>
      <Icon concept={p.concept} size={14} tone={p.tone} spinning={state === 'running'} />
      <Text role="subhead" weight={600}>
        {label}
      </Text>
      <Text role="monoSm" tone="fg-3">
        {detail ?? p.word}
      </Text>
    </View>
  );
}

function NeedsYouCard({ item, runId, workflowId, canDecide }: { item: NeedsYouItem; runId: string; workflowId: string; canDecide: boolean }): React.ReactElement {
  if (item.kind === 'loop' && item.stage) return <DecisionCard runId={runId} stage={{ ...item.stage, name: item.stage.name ?? null }} canDecide={canDecide} />;
  return (
    <View className="flex-row items-center gap-3 rounded-card-lg border border-line bg-raised p-3.5" testID={`needs-you-${item.instanceId}`}>
      <Icon concept={item.kind === 'event_wait' ? 'hourglass' : 'hand'} size={20} tone={item.kind === 'event_wait' ? 'fg-2' : 'warn'} />
      <View className="flex-1 gap-0.5">
        <Text role="subhead" weight={600} numberOfLines={2}>
          {item.kind === 'event_wait' ? item.name : `${item.name} needs you`}
        </Text>
        <Text role="footnote" tone="fg-2" numberOfLines={2}>
          {[item.detail, item.via ? `via ${item.via}` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {item.sheet ? <Button label="Review" variant="primary" size="sm" onPress={() => router.push(approvalHref(workflowId, runId, item.instanceId) as Href)} testID={`needs-you-review-${item.instanceId}`} /> : null}
    </View>
  );
}

export default function RunScreen(): React.ReactElement {
  const { id = '', runId = '' } = useLocalSearchParams<{ id: string; runId: string }>();
  const focused = useIsFocused();
  const onBack = useHeaderBack();
  const sheet = useSheet();
  const scopes = useGrantedScopes();
  const runControl = checkFeature('runControl', scopes);
  const runStart = checkFeature('runStart', scopes);
  const { connected } = useRunStream(runId, focused);
  const run = useRun(runId, focused, connected);
  const data = run.data as (typeof run.data & { definitionVersionId?: string; trigger?: { kind: string; [k: string]: unknown }; systemVars?: never; ancestorRunId?: string | null }) | undefined;
  const workflowId = data?.workflowDefinitionId ?? id;
  const workflow = useWorkflow(workflowId);
  const versions = useDefinitionVersions(workflowId);
  const graph = useRunGraph(workflowId, data?.definitionVersionId);
  const stages = useMemo(() => (data?.stageRuns ?? []) as RunStage[], [data?.stageRuns]);
  const hasChildren = stages.some((s) => s.kind === 'subworkflow' && s.status === 'running');
  const pending = useRunPendingDecisions(runId, hasChildren, focused);
  const { command, fork, remove } = useRunCommands(runId);
  const live = Boolean(data) && !isTerminal(data?.status ?? '');
  const { mode, setMode } = useRunPermissionMode(runId, live);
  const workflowName = workflow.data?.graph.workflow.name ?? 'Workflow';
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Workflows', href: WORKFLOWS_HREF }, { label: workflowName, href: workflowHref(workflowId) }], [workflowName, workflowId]));
  const specs = useMemo(() => new Map<string, StageSpec>((graph.data?.graph.stages ?? []).map((s) => [s.key, s])), [graph.data]);
  const title = data ? runName(data) : 'Run';

  // The run's pane (MB-42 `scope: 'run'`): the workspace tabs through the bodies a chat pane uses.
  const workspaceId = data?.workspaceId ?? null;
  const paneContext = useMemo<PaneTabContext>(() => ({ workspaceId, chatId: null, agentBusy: data?.status === 'running' }), [workspaceId, data?.status]);
  const renderTab = useCallback((type: MobilePaneTab, ctx: { active: boolean }) => <PaneTabBody type={type} active={ctx.active} ctx={paneContext} />, [paneContext]);
  useWorkspacePaneClaim({ kind: 'run', id: workspaceId ? runId : undefined, title, path: runHref(workflowId, runId), workspaceId, chatId: null, scopes, live: focused, renderTab });
  const paneToggle = usePaneToggle();

  const fail = (e: unknown): void => {
    haptic('error');
    toast({ kind: 'error', message: errorText(e) });
  };
  const send = (body: RunCommand): void => command.mutate(body, { onSuccess: () => haptic('success'), onError: fail });
  const forkFrom = (rerunFrom?: string[]): void =>
    fork.mutate(
      { ...(rerunFrom ? { rerunFrom } : {}), idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: (r) => {
          haptic('success');
          router.push(runHref(workflowId, r.runId) as Href);
        },
        onError: fail,
      },
    );

  const controls = runControlsFor(data?.status ?? '');
  const runMenu: MenuEntry[] = [
    ...(controls.pause && runControl.available
      ? [{ id: 'pause', label: 'Pause run', icon: 'pause' as const, children: [{ id: 'pause-drain', label: 'Finish current turns', subtitle: 'drain', icon: 'pause' as const }, { id: 'pause-interrupt', label: 'Interrupt now', subtitle: 'interrupt', icon: 'stop' as const }] }]
      : []),
    ...(controls.resume && runControl.available ? [{ id: 'resume', label: 'Resume run', icon: 'play' as const }] : []),
    { type: 'separator' },
    ...(controls.retry && runStart.available ? [{ id: 'retry', label: 'Retry failed', subtitle: 'a new run', icon: 'retry' as const }] : []),
    { id: 'copy-id', label: 'Copy run ID', icon: 'copy' },
    { type: 'separator' },
    ...(controls.cancel && runControl.available ? [{ id: 'cancel', label: 'Cancel run…', icon: 'status-failed' as const, destructive: true }] : []),
    ...(runControl.available ? [{ id: 'delete', label: 'Delete run…', icon: 'trash' as const, destructive: true }] : []),
  ];
  const onRunMenu = (mid: RunMenuId): void => {
    switch (mid) {
      case 'pause-drain':
        send({ command: 'pause', mode: 'drain' });
        return;
      case 'pause-interrupt':
        send({ command: 'pause', mode: 'interrupt' });
        return;
      case 'resume':
        send({ command: 'resume' });
        return;
      case 'retry':
        forkFrom();
        return;
      case 'copy-id':
        void Clipboard.setStringAsync(runId).then(() => haptic('success'));
        return;
      case 'cancel':
        void confirm({ title: 'Cancel this run?', message: 'Running stages stop and nothing after them starts. You can retry it later as a new run.', confirmLabel: 'Cancel run', icon: 'status-failed' }).then((ok) => {
          if (ok) send({ command: 'cancel' });
        });
        return;
      case 'delete':
        void confirm({ title: 'Delete this run?', message: isActive(data?.status ?? '') ? 'It is still running — it is cancelled first. Its stages and history are removed for good.' : 'Its stages and history are removed for good. The workflow is kept.', confirmLabel: 'Delete run', icon: 'trash' }).then((ok) => {
          if (!ok) return;
          remove.mutate(undefined, {
            onSuccess: () => (router.canGoBack() ? router.back() : router.replace(workflowHref(workflowId) as Href)),
            onError: fail,
          });
        });
    }
  };
  const onStageAction = (stage: RunStage, action: StageMenuId): void => {
    const name = stage.name ?? stage.stageKey;
    switch (action) {
      case 'pause':
        send({ command: 'pause', instanceId: stage.id, mode: 'interrupt' });
        return;
      case 'resume':
        send({ command: 'resume', instanceId: stage.id });
        return;
      case 'retry-resume':
      case 'retry-restart':
        send({ command: 'retry', instanceId: stage.id, mode: action === 'retry-resume' ? 'resume' : 'restart' });
        return;
      case 'skip':
        send({ command: 'skip', instanceId: stage.id, as: 'completed' });
        return;
      case 'rerun':
        forkFrom([stage.instancePath ?? stage.stageKey]);
        return;
      case 'copy-output':
        void Clipboard.setStringAsync(stage.outputText ?? stage.summary ?? '').then(() => haptic('success'));
        return;
      case 'open-chat':
        router.push(stageHref(workflowId, runId, stage.id) as Href);
        return;
      case 'cancel':
        void confirm({ title: `Cancel ${name}?`, message: 'The agent stops. Stages after it will not start.', confirmLabel: 'Cancel stage', icon: 'status-failed' }).then((ok) => {
          if (ok) send({ command: 'cancel', instanceId: stage.id });
        });
    }
  };

  const currentMode = isRunPermissionMode(mode.data) ? mode.data : null;
  const changeMode = (): void => {
    if (!currentMode) return;
    sheet.present(
      <PermissionModePicker
        value={currentMode}
        canBypass={scopes.includes('admin:settings')}
        title="Permission for this run"
        footer="Applies from the next tool call. Loosening asks first."
        onValueChange={(next: RunPermissionMode) => {
          const apply = (): void => {
            sheet.dismiss();
            setMode.mutate(next, { onSuccess: () => haptic('success'), onError: fail });
          };
          if (!isLoosening(currentMode, next)) apply();
          else
            void confirm({ title: `Switch to ${PERMISSION_MODE_LABEL[next]}?`, message: 'Running agents will act with fewer prompts from now on.', confirmLabel: 'Switch' }).then((ok) => {
              if (ok) apply();
            });
        }}
      />,
      { title: 'Permission mode', detents: ['medium', 'large'], scrollable: true },
    );
  };

  const status = data ? resolveStatus('workflowRun', data.status) : null;
  const header = (
    <Header
      role={workspaceId ? 'workspace' : 'detail'}
      title={title}
      breadcrumb={breadcrumb}
      onBack={onBack}
      {...(status ? { status: { state: status.state, label: status.label, ...(isActive(data?.status ?? '') && data?.startedAt ? { elapsedSince: String(data.startedAt) } : {}) } } : {})}
      {...(workspaceId ? { paneToggle } : {})}
      actions={data ? [{ id: 'run-menu', icon: 'more', label: 'Run actions', menu: runMenu, onMenuSelect: (mid: string) => onRunMenu(mid as RunMenuId), testID: 'run-menu' }] : []}
    />
  );
  const state = run.isLoading
    ? { kind: 'loading' as const }
    : run.isError || !data
      ? { kind: 'error' as const, error: run.error, onRetry: () => void run.refetch(), title: "Couldn't load this run" }
      : { kind: 'ready' as const };

  const version = data?.definitionVersionId ? versionLabels(versions.data).get(data.definitionVersionId) : undefined;
  const trigger = data ? triggerLabel(data.trigger ?? null, data.ancestorRunId ?? null) : null;
  const usage = data ? usageView(data as never) : null;
  const lifecycle = data ? lifecycleView(data as never, stages) : null;
  const decisions = data ? needsYou(runId, stages, pending.data ?? []) : [];
  const results = data ? postProcessingResults(data as never) : [];
  const pr = pullRequestOf(results);

  return (
    <Screen header={header} state={state} onRefresh={async () => void (await run.refetch())} testID="run-screen">
      {data && lifecycle ? (
        <View className="gap-4 pb-10 pt-2">
          <View className="gap-2.5 px-4">
            <Text role="footnote" tone="fg-2">
              {[version, trigger, data.name && !/Run \d{10,}$/.test(data.name) ? data.name : null].filter(Boolean).join(' · ') || ' '}
            </Text>
            {live && currentMode ? (
              <View className="flex-row flex-wrap gap-2">
                <Chip label={`Permission: ${PERMISSION_MODE_LABEL[currentMode]}`} variant="dropdown" icon="shield" disabled={!runControl.available || setMode.isPending} onPress={changeMode} testID="run-permission" />
              </View>
            ) : null}
            {usage ? (
              <View className="gap-1.5">
                <Text role="monoSm" tone="fg-2">
                  {usage.line}
                </Text>
                {usage.fraction !== null ? <ProgressBar value={usage.fraction} tone="neutral" accessibilityLabel={`Budget ${Math.round(usage.fraction * 100)} percent used`} /> : null}
              </View>
            ) : null}
            <View className="gap-1.5 rounded-card border border-line-soft bg-raised p-3" testID="run-lifecycle">
              <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                <Phase label="Setup" state={lifecycle.setup} {...(lifecycle.setupDetail ? { detail: lifecycle.setupDetail } : {})} />
                <Text role="footnote" tone="fg-3">—</Text>
                <Phase label="Stages" state={lifecycle.total && lifecycle.done === lifecycle.total ? 'done' : lifecycle.setup === 'done' && live ? 'running' : lifecycle.done ? 'done' : 'pending'} detail={`${lifecycle.done}/${lifecycle.total}`} />
                <Text role="footnote" tone="fg-3">—</Text>
                <Phase label="Finalize" state={lifecycle.finalize} {...(lifecycle.finalizeDetail ? { detail: lifecycle.finalizeDetail } : {})} />
              </View>
            </View>
            {data.error ? <Callout tone="err" title={status?.label ?? 'Failed'} body={data.error} /> : null}
            {decisions.map((d) => (
              <NeedsYouCard key={d.instanceId} item={d} runId={runId} workflowId={workflowId} canDecide={runStart.available} />
            ))}
            {controls.resume && runControl.available ? <Button label="Resume run" icon="play" variant="primary" fullWidth onPress={() => send({ command: 'resume' })} testID="run-resume" /> : null}
            {controls.retry && runStart.available && !decisions.length ? <Button label="Retry failed" icon="retry" variant="primary" fullWidth loading={fork.isPending} onPress={() => forkFrom()} testID="run-retry" /> : null}
          </View>

          {stages.length ? (
            <RunTimeline
              title={`Stages ${lifecycle.done} of ${lifecycle.total} done`}
              stages={stages}
              runStatus={data.status}
              specs={specs}
              canControl={runControl.available}
              canFork={runStart.available}
              onOpenStage={(s) => router.push(stageHref(workflowId, runId, s.id) as Href)}
              onStageAction={onStageAction}
            />
          ) : (
            <Text role="footnote" tone="fg-3" className="px-4">
              Stages appear as the run reaches them.
            </Text>
          )}

          {results.length ? (
            <ListSection title="After the stages">
              {results.map((r) => (
                <ListRow key={r.stepName} kind="info" icon={r.success ? 'status-succeeded' : 'status-failed'} title={r.stepName} subtitle={r.error ?? r.output ?? (r.success ? 'Done' : 'Failed')} value={`${Math.round(r.durationMs / 100) / 10}s`} />
              ))}
            </ListSection>
          ) : null}
          {pr ? (
            <View className="px-4">
              <Button label="Open pull request" icon="pr" fullWidth onPress={() => void WebBrowser.openBrowserAsync(pr).catch(() => undefined)} testID="run-open-pr" />
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
