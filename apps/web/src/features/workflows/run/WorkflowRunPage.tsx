// ────────────────────────────────────────────────────────────────
// WorkflowRunPage — the run workspace (`/workflows/:id/runs/:runId`) on T-04
// Workspace (boards WorkflowRun, WorkflowRunLoop; D-27, D-35, D-81).
//
//   header   RunHeader: breadcrumb, pinned version, D-18 status, clock, run
//            controls (Pause/Resume/Cancel/Retry failed), More (graph, event
//            timeline, Open in editor), dock toggle; subbar with the
//            permission mode and the WF-06 BudgetMeter
//   main     the run graph (toggle), compensation / error banners, pending
//            decisions, the stage table (every row through StageRow, control
//            flow through ControlFlowNode), the focused stage's composer (pinned under the stages)
//   dock     blocks/dock Dock at 440 px (`generatorai:dock:run:*`): Inspector,
//            Changes, Files, Terminal, Browser pinned; Usage and Widget from
//            "+"; extra Terminal / Browser instances and file tabs
//
// The run's data sources feed the pure `deriveRunView`. A stage is a compact
// chat (P03b): the focused agent stage gets the composer's `stage` variant,
// its gates the chat's cards, and a "…" menu whose items go through the
// commands API. No control fails silently (D-13): mutations toast their
// refusal and destructive ones ask first. Cost (D-21, D-24): every stage
// stream of the run is protected from eviction; the header owns the one
// ticking clock; unchanged stages keep their StageView (memoised rows).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useStickToBottom } from '@/hooks/useStickToBottom.js';
import { useShallow } from 'zustand/react/shallow';
import type { WorkflowRunPermissionMode } from '@generatorai/shared';
import { dockStorageKeys, DOCK_TAB_CAPS, type DockLinkTab } from '@generatorai/shared/ui-contract';
import type { RunCommand } from '@generatorai/workflow-spec';
import { newIdempotencyKey, runTitle } from '@generatorai/client-core';
import {
  useInvokeWorkflow,
  useLoopEventRefetch,
  usePendingDecisions,
  useResolveStageInteraction,
  useRunPermissionRules,
  useClearRunPermissionRules,
  useRunCommand,
  useRunWorkspace,
  useSetRunPermissionMode,
  useWorkflowDefinition,
  useWorkflowDefinitionVersion,
  useWorkflowRun,
} from '@/hooks/workflowQueries.js';
import { useRunPermissionMode, useWorkflowRunConnection } from '@/hooks/workflowRunQueries.js';
import { useBrowserSessionEvents } from '@/hooks/chatSessionQueries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { clearBrowserTabUrl } from '@/lib/browserTabUrls.js';
import { useEditorTarget } from '@/stores/editorTargetStore.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { protectStream, useStreamStore } from '@/stores/streamStore.js';
import { useDockStore } from '@/stores/dockStore.js';
import { ChangesDockContext, ChangesDockPanel } from '@/blocks/changes/ChangesDockPanel.js';
import type { ChangesPanelProps } from '@/blocks/changes/ChangesPanel.js';
import { Dock, useDockLinkParam, useDockOpen, useSurfaceDockTabs, type DockFocusRequest, type DockRegistry } from '@/blocks/dock/index.js';
import { FileDockPanel, FilesDockPanel, FilesDockProvider, useFileTabs } from '@/blocks/files/useFileTabs.js';
import { SourcesBlock } from '@/blocks/files/SourcesBlock.js';
import { TerminalDockPanel, TerminalDockProvider, terminalTabLabel, type TerminalDockContextValue } from '@/blocks/terminal/terminalDock.js';
import { BrowserDockPanel, BrowserDockProvider, browserDockTabLabel, type BrowserDockContextValue } from '@/blocks/browser/browserDock.js';
import type { BrowserTabState } from '@/blocks/browser/useBrowserTabState.js';
import { Workspace } from '@/ui/templates/Workspace/Workspace.js';
import { Banner } from '@/ui/patterns/Banner/Banner.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { RunPullRequestBanner } from './RunPullRequestBanner.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody } from '@/ui/primitives/Dialog/Dialog.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { RunHeader } from './header/RunHeader.js';
import { StageRow, type StageGateResolution, type StageMenuActions } from './stages/StageRow.js';
import { StageComposer } from './stages/StageComposer.js';
import { ControlFlowNode } from './controlFlow/ControlFlowNode.js';
import {
  CompensationBadge,
  CompensationBanner,
  NeedsDecisionPanel,
  RunDecisionsContext,
  type RunDecisionsValue,
} from './controlFlow/ControlFlowCards.js';
import { RunEventTimeline } from './inspector/RunEventTimeline.js';
import { RunGraph } from './graph/RunGraph.js';
import { RunDockContext, RunInspectorDockPanel, RunUsageDockPanel, RunWidgetDockPanel, type RunDockContextValue } from './dock/runDockPanels.js';
import { createStageViewCache, deriveRunView, pickStageStreams } from './model/deriveRunView.js';
import type { RenderStage } from './model/renderStage.js';
import type { StageView } from './model/types.js';
import { heldByPausedStages } from './model/pausedStages.js';
import { useStageFiles } from './useStageFiles.js';
import { formatWhen } from '@/lib/formatWhen.js';

/** The run dock's persistence keys (D-27): open + layout global to runs, the tab list per run. */
export const RUN_DOCK_KEYS = dockStorageKeys('run');
/** D-27: the run dock opens at 440 px (the chat's is 480). */
const RUN_DOCK_WIDTH = 440;

/** A stage that takes a review batch or a message (the stage conversation API). */
const CONVERSABLE = new Set(['starting', 'running', 'validating', 'completed', 'paused']);

function RunLoading() {
  return (
    <div className="flex h-full items-center justify-center text-fg-3">
      <Spinner size={16} label="Loading workflow run" />
    </div>
  );
}

export function WorkflowRunPage() {
  const { id: definitionId, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();

  // ── Data sources ─────────────────────────────────────────────
  const { data: runData, isLoading: runLoading, error: runError } = useWorkflowRun(runId);
  const { data: definition } = useWorkflowDefinition(definitionId);
  // The graph this run executes: the version it pinned, not the live definition.
  const { data: pinnedVersion } = useWorkflowDefinitionVersion(definitionId, runData?.definitionVersionId);
  const pinnedGraph = pinnedVersion?.graph;
  const definitionName = definition?.graph.workflow.name;
  // `awaiting_input` is a StageRun status: a run parked on a gate stays running/waiting.
  const runIsActive = runData?.status === 'running' || runData?.status === 'starting' || runData?.status === 'created';
  const runIsTerminal = runData?.status === 'failed' || runData?.status === 'cancelled' || runData?.status === 'completed';
  // A finished run's workspace no longer changes: stop polling it (D-24).
  const { data: workspace } = useRunWorkspace(runId, { live: !!runData && !runIsTerminal });

  const storeRun = useWorkflowRunStore((s) => s.run);
  const setRun = useWorkflowRunStore((s) => s.setRun);
  const clearRun = useWorkflowRunStore((s) => s.clearRun);
  // ONE focus for the page, the graph, the inspector and the event timeline (D-20).
  const focusedStageId = useWorkflowRunStore((s) => s.selectedStageRunId);
  const setFocusedStageId = useWorkflowRunStore((s) => s.selectStageRun);
  const admission = useWorkflowRunStore((s) => s.admission);

  // Subscribe ONLY to this run's stage streams (P0-49): any other chat's
  // tokens must not re-render the page.
  const stageRunIds = useMemo(() => storeRun?.stageRuns.map((s) => s.id) ?? [], [storeRun?.stageRuns]);
  const streams = useStreamStore(useShallow((s) => pickStageStreams(s.streams, stageRunIds)));
  // D-21: the run's stage streams are exempt from LRU eviction while mounted.
  const stageRunIdsKey = stageRunIds.join(',');
  useEffect(() => {
    const releases = stageRunIdsKey ? stageRunIdsKey.split(',').map((id) => protectStream(`stageRun:${id}`)) : [];
    return () => {
      for (const release of releases) release();
    };
  }, [stageRunIdsKey]);

  useEffect(() => {
    if (runData) setRun(runData);
  }, [runData, setRun]);
  useWorkflowRunConnection(runId);
  // Loops (P05): every `loop.*` event refetches the run and the iterations.
  useLoopEventRefetch(runId, !!runData && !runIsTerminal);
  const { data: pendingDecisions } = usePendingDecisions(runId, { live: !!runData && !runIsTerminal });
  // On unmount AND when the page moves to another run (a fork) (CONVINV-R20).
  useEffect(() => () => clearRun(), [clearRun, runId]);

  // The run's own permission mode; the server's effective one fills in (CONVINV-R20).
  const permissionMode = useRunPermissionMode(runId, runData?.permissionMode);

  // "Open in editor" opens the run's workspace root (its stages share one checkout).
  const runWorkspaceId = runData?.workspaceId;
  const { data: runWorkspaceInfo } = useWorkspaceInfo(runWorkspaceId);
  useEditorTarget(runWorkspaceInfo?.workingDirectory ?? runWorkspaceInfo?.rootPath, runTitle(runData?.name));

  // ── Mutations ────────────────────────────────────────────────
  const runCommand = useRunCommand();
  const invokeWorkflow = useInvokeWorkflow({ errorTitle: 'Could not re-run' });
  const resolveGate = useResolveStageInteraction();
  // U-16 (D-147): what "Allow for this run" remembered (the header's "N rules · Clear").
  const runPermissionRules = useRunPermissionRules(runId);
  const clearRunPermissionRules = useClearRunPermissionRules();
  const setRunPermissionMode = useSetRunPermissionMode();
  const confirmer = useConfirm();
  const confirmAction = confirmer.confirm;

  // ── Dock (D-27) ──────────────────────────────────────────────
  const [dockOpen, setDockOpen, toggleDock] = useDockOpen(RUN_DOCK_KEYS.open, false);
  const setDockController = useDockStore((s) => s.setController);
  useEffect(() => {
    setDockController({ open: dockOpen, toggle: toggleDock });
    return () => setDockController(null);
  }, [dockOpen, toggleDock, setDockController]);
  const [focusRequest, setFocusRequest] = useState<DockFocusRequest | null>(null);
  useEffect(() => setFocusRequest(null), [runId]);
  const focusDockTab = useCallback(
    (type: string) => {
      setDockOpen(true);
      setFocusRequest({ type, token: Date.now() });
    },
    [setDockOpen],
  );
  // `?dock=<tab>` deep links (R-4).
  useDockLinkParam((tab: DockLinkTab) => focusDockTab(tab));
  // Watch the agent's browser: a visible session opens the Browser tab.
  useBrowserSessionEvents(runWorkspaceId, {
    onInitialDescriptor: (descriptor) => {
      if (descriptor.ready && descriptor.config?.visibility === 'visible') focusDockTab('browser');
    },
    onSessionCreated: (descriptor) => {
      const visibility = descriptor.config?.visibility;
      if (visibility === 'visible' || visibility === undefined) focusDockTab('browser');
    },
  });

  const dockStorageKey = RUN_DOCK_KEYS.tabs(runId ?? 'unknown');
  const browserUrlScopeKey = `workflow-run:${runId ?? 'unknown'}`;
  const [browserTabs, setBrowserTabs] = useState<Record<string, BrowserTabState>>({});
  const openDock = useCallback(() => setDockOpen(true), [setDockOpen]);
  const filesSources = useMemo(() => <SourcesBlock embedded workspaceId={runWorkspaceId} />, [runWorkspaceId]);
  const fileTabs = useFileTabs({ workspaceId: runWorkspaceId, requestFocus: setFocusRequest, openPane: openDock, sources: filesSources });
  const forgetFileTab = fileTabs.forgetTab;
  const handleDockTabClose = useCallback(
    (tab: { id: string; type: string }) => {
      if (tab.type === 'files') {
        forgetFileTab(tab.id);
        return;
      }
      if (tab.type !== 'browser') return;
      clearBrowserTabUrl(browserUrlScopeKey, tab.id);
      setBrowserTabs((prev) => {
        if (!(tab.id in prev)) return prev;
        const next = { ...prev };
        delete next[tab.id];
        return next;
      });
    },
    [browserUrlScopeKey, forgetFileTab],
  );
  const onBrowserTabState = useCallback((tabId: string, s: BrowserTabState) => {
    setBrowserTabs((prev) => {
      const cur = prev[tabId];
      if (cur && cur.loading === s.loading && cur.title === s.title && cur.favicon === s.favicon && cur.url === s.url) return prev;
      return { ...prev, [tabId]: s };
    });
  }, []);
  const provisioning = runData?.status === 'starting' || runData?.status === 'created';
  const browserDock = useMemo<BrowserDockContextValue>(
    () => ({ workspaceId: runWorkspaceId, urlScopeKey: browserUrlScopeKey, agentBusy: provisioning, onTabStateChange: onBrowserTabState }),
    [runWorkspaceId, browserUrlScopeKey, provisioning, onBrowserTabState],
  );
  const terminalDock = useMemo<TerminalDockContextValue>(
    () => ({
      workspaceId: runWorkspaceId,
      agentBusy: provisioning,
      ...(workspace?.worktrees ? { worktrees: workspace.worktrees.map((w) => ({ alias: w.alias, path: w.worktreePath })) } : {}),
    }),
    [runWorkspaceId, provisioning, workspace?.worktrees],
  );

  // ── UI state ─────────────────────────────────────────────────
  const [graphOpen, setGraphOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  /** The stage whose gate answer or approval is in flight (its buttons disable, D-13). */
  const [gateBusyStage, setGateBusyStage] = useState<string | null>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  const viewCache = useRef(createStageViewCache());

  // ── Derived RunView ──────────────────────────────────────────
  const runView = useMemo(() => {
    if (!storeRun) return null;
    return deriveRunView({
      run: storeRun,
      stageDefs: pinnedGraph?.stages ?? [],
      edges: pinnedGraph?.edges ?? [],
      streams,
      permissionMode,
      admission,
      cache: viewCache.current,
    });
  }, [storeRun, pinnedGraph, streams, permissionMode, admission]);
  // A reader at the end of a streaming stage stays with its output (D-91). Bound once the
  // run view exists, i.e. once the scroll host below is mounted (the page renders a skeleton until then).
  useStickToBottom(runLoading || !runData || !runView ? null : runId, { ref: scrollHostRef, initiallyPinned: false });

  // A run named exactly like its workflow is identified by its start time.
  const runCrumb = useMemo(() => {
    const title = runTitle(runView?.name);
    if (definitionName && title === definitionName) {
      const started = runView?.startedAt;
      return started ? `Run · ${formatWhen(started)}` : 'Run';
    }
    return title;
  }, [runView?.name, runView?.startedAt, definitionName]);

  // The store picks the initial focus (awaiting > running > first); the page only reads it.
  const focusedStage = useMemo(
    () => (runView && focusedStageId ? (runView.stages.find((s) => s.id === focusedStageId) ?? null) : null),
    [runView, focusedStageId],
  );

  // ── Handlers ─────────────────────────────────────────────────
  /** Focus a stage AND scroll it into view (pills, decisions, the usage panel). */
  const focusStage = useCallback(
    (id: string) => {
      setFocusedStageId(id);
      const host = scrollHostRef.current;
      const el = host?.querySelector<HTMLElement>(`[data-stage-id="${id}"]`);
      if (!host || !el) return;
      const target = host.scrollTop + (el.getBoundingClientRect().top - host.getBoundingClientRect().top) - 16;
      host.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    },
    [setFocusedStageId],
  );
  /** Focus without scrolling (a row header the user already sees). */
  const selectStage = useCallback((id: string) => setFocusedStageId(id), [setFocusedStageId]);

  // D-13: a refused command is toasted by the mutation; the promise settles either way.
  const runCommandAsync = runCommand.mutateAsync;
  const sendCommand = useCallback(
    (command: RunCommand) => (runId ? runCommandAsync({ runId, command }).then(() => undefined, () => undefined) : Promise.resolve()),
    [runId, runCommandAsync],
  );
  // A mirrored decision is the child run's: its command goes there.
  const decisionsValue = useMemo<RunDecisionsValue | null>(
    () =>
      runId
        ? {
            runId,
            decisions: pendingDecisions ?? [],
            commandTo: (target: string, command: RunCommand) =>
              runCommandAsync({ runId: target, command }).then(() => undefined, () => undefined),
          }
        : null,
    [runId, pendingDecisions, runCommandAsync],
  );

  // Pause in `interrupt` mode: in-flight stages pause too, not just new launches.
  const handlePause = useCallback(() => void sendCommand({ command: 'pause', mode: 'interrupt' }), [sendCommand]);
  // A paused run resumes as a whole; a live run held only by paused stages (U-32) resumes those stages.
  const heldStageIds = useMemo(() => (runView ? heldByPausedStages(runView).join(',') : ''), [runView]);
  const handleResume = useCallback(() => {
    if (!heldStageIds) return void sendCommand({ command: 'resume' });
    for (const instanceId of heldStageIds.split(',')) void sendCommand({ command: 'resume', instanceId });
  }, [sendCommand, heldStageIds]);
  // A run paused by its exhausted budget: add half of each limit (WP-7.3).
  const runBudget = runData?.budget;
  const handleRaiseBudget = useCallback(() => {
    // Turns, tokens and ms round up to whole units; cost up to the cent
    // (toFixed trims float noise such as 0.07 * 100 = 7.000000000000001 first).
    const half = (k: string, perUnit = 1) => {
      const v = runBudget?.[k];
      return typeof v === 'number' && v > 0 ? Math.ceil(Number(((v / 2) * perUnit).toFixed(6))) / perUnit : undefined;
    };
    const deltas = { maxTurns: half('maxTurns'), maxTokens: half('maxTokens'), maxCostUsd: half('maxCostUsd', 100), maxWallClockMs: half('maxWallClockMs') };
    const command = { command: 'raise_budget' as const, ...Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== undefined)) };
    void sendCommand(command as RunCommand);
  }, [runBudget, sendCommand]);
  const handleCancel = useCallback(() => {
    void confirmAction({
      title: 'Cancel this run?',
      description: 'Every stage still running or waiting is cancelled. A cancelled run can only be re-run as a new run.',
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep running',
      tone: 'danger',
    }).then((ok) => {
      if (ok) void sendCommand({ command: 'cancel' });
    });
  }, [confirmAction, sendCommand]);

  const setRunMode = setRunPermissionMode.mutateAsync;
  const handlePermissionModeChange = useCallback(
    (mode: WorkflowRunPermissionMode) => {
      // The mutation refetches the run: the control shows the mode the run has.
      if (runId) void setRunMode({ runId, mode }).then(() => undefined, () => undefined);
    },
    [runId, setRunMode],
  );

  // A terminal run is never mutated: "Retry failed" forks a NEW run that
  // re-runs every instance that did not complete; `rerunFrom` re-runs one
  // stage and everything downstream. Follow the user to the fork; one fork
  // per action at a time, under its own key (CONVINV-R17).
  const forksInFlight = useRef(new Set<string>());
  const invokeAsync = invokeWorkflow.mutateAsync;
  const forkAndOpen = useCallback(
    (rerunFrom?: string[]) => {
      if (!runId) return;
      const action = (rerunFrom ?? []).join('\n');
      if (forksInFlight.current.has(action)) return;
      forksInFlight.current.add(action);
      void invokeAsync({
        idempotencyKey: newIdempotencyKey(),
        request: {
          target: { kind: 'fork', sourceRunId: runId, ...(rerunFrom ? { rerunFrom } : {}), definition: 'pinned', workspace: 'fresh' },
          variables: {},
          client: 'web',
        },
      })
        .then(
          (fork) => {
            if (fork.runId !== runId) navigate(`/workflows/${fork.workflowDefinitionId}/runs/${fork.runId}`);
          },
          () => undefined,
        )
        .finally(() => forksInFlight.current.delete(action));
    },
    [runId, invokeAsync, navigate],
  );
  const handleRetry = useCallback(() => forkAndOpen(), [forkAndOpen]);

  /** One verdict at a time per stage; its buttons stay disabled until it settles. */
  const withGateBusy = useCallback(async (stageId: string, work: () => Promise<unknown>) => {
    setGateBusyStage(stageId);
    try {
      await work();
    } catch {
      /* toasted by the mutation */
    } finally {
      setGateBusyStage((cur) => (cur === stageId ? null : cur));
    }
  }, []);

  // An approval carries the instance's version: a stale click never approves a later round (ENGINE-R11).
  const storeRunRef = useRef(storeRun);
  storeRunRef.current = storeRun;
  const versionOf = useCallback((stageId: string) => {
    const v = storeRunRef.current?.stageRuns.find((sr) => sr.id === stageId)?.version;
    return v !== undefined ? { expectedVersion: v } : {};
  }, []);

  const handleApproveHitl = useCallback(
    (stageId: string) =>
      void withGateBusy(stageId, () => sendCommand({ command: 'approve', instanceId: stageId, outcome: 'approved', ...versionOf(stageId) })),
    [sendCommand, withGateBusy, versionOf],
  );
  const handleRejectHitl = useCallback(
    (stageId: string, feedback?: string) =>
      void withGateBusy(stageId, () =>
        sendCommand({ command: 'approve', instanceId: stageId, outcome: 'changes_requested', ...(feedback ? { feedback } : {}), ...versionOf(stageId) }),
      ),
    [sendCommand, withGateBusy, versionOf],
  );
  /** Terminal rejection: fails the stage, so the graph blocks every downstream stage. */
  const handleTerminalRejectHitl = useCallback(
    (stageId: string, reason?: string) =>
      void withGateBusy(stageId, () =>
        sendCommand({ command: 'approve', instanceId: stageId, outcome: 'rejected', ...(reason ? { feedback: reason } : {}), ...versionOf(stageId) }),
      ),
    [sendCommand, withGateBusy, versionOf],
  );
  // A stage's permission / question / plan card answers its in-turn gate through the stage conversation API.
  const resolveGateAsync = resolveGate.mutateAsync;
  const handleResolveGate = useCallback(
    (stageId: string, resolution: StageGateResolution) => {
      if (!runId) return;
      const { interactionId, ...answer } = resolution;
      void withGateBusy(stageId, () => resolveGateAsync({ runId, instanceId: stageId, interactionId, answer }));
    },
    [runId, resolveGateAsync, withGateBusy],
  );

  // Re-running a stage of a finished run is a fork from that instance.
  const stageRunsRef = useRef(runData?.stageRuns);
  stageRunsRef.current = runData?.stageRuns;
  const handleRetryStage = useCallback(
    (stageId: string) => {
      const instancePath = stageRunsRef.current?.find((sr) => sr.id === stageId)?.instancePath;
      if (instancePath) forkAndOpen([instancePath]);
    },
    [forkAndOpen],
  );

  const handleOpenInspector = useCallback(
    (id: string) => {
      setFocusedStageId(id);
      focusDockTab('inspector');
    },
    [setFocusedStageId, focusDockTab],
  );

  // The stage "…" menu (D-18): a stage cancel asks first.
  const handleStageCommand = useCallback(
    (stageId: string, command: RunCommand) => {
      if (command.command !== 'cancel') {
        void sendCommand(command);
        return;
      }
      const name = stageRunsRef.current?.find((sr) => sr.id === stageId)?.name ?? 'this stage';
      void confirmAction({
        title: `Cancel ${name}?`,
        description: 'The stage stops and ends cancelled; routing decides what the run does next.',
        confirmLabel: 'Cancel stage',
        cancelLabel: 'Keep it',
        tone: 'danger',
      }).then((ok) => {
        if (ok) void sendCommand(command);
      });
    },
    [confirmAction, sendCommand],
  );
  // D-30: no success toast; a failed copy says so.
  const handleCopyOutput = useCallback((stageId: string) => {
    const sr = stageRunsRef.current?.find((s) => s.id === stageId);
    const text = sr?.outputText ?? (sr?.outputData ? JSON.stringify(sr.outputData, null, 2) : '');
    if (!text) return;
    void navigator.clipboard.writeText(text).catch(() => toast.error('Could not copy the output'));
  }, []);
  const stageMenu = useMemo<StageMenuActions>(
    () => ({ runLive: !runIsTerminal, onCommand: handleStageCommand, onCopyOutput: handleCopyOutput, onRerunFrom: handleRetryStage }),
    [runIsTerminal, handleStageCommand, handleCopyOutput, handleRetryStage],
  );

  // D-22: the Inspector's Files are the focused stage's own changes.
  const inspectorFiles = useStageFiles(runWorkspaceId, focusedStage, dockOpen);

  // Only an agent stage is a conversation (loops, maps, waits, sub-workflows, checks decide through their cards).
  const focusedComposer = useMemo(
    () =>
      runId && focusedStage && focusedStage.kind === 'agent' && focusedStage.status !== 'skipped' && focusedStage.status !== 'cancelled' ? (
        <StageComposer runId={runId} stage={focusedStage} workspaceId={runWorkspaceId} docked />
      ) : null,
    [runId, focusedStage, runWorkspaceId],
  );

  // What approving a stage's review starts: the stages that depend on it.
  const successorsOf = useCallback(
    (id: string) => {
      const names = (runView?.stages ?? []).filter((s) => s.dependsOn.includes(id)).map((s) => s.stageKey);
      return names.length > 0 ? names.join(', ') : undefined;
    },
    [runView?.stages],
  );

  // One renderer for every row (top level, a loop's own row, body instances).
  const renderStage = useCallback<RenderStage>(
    (s, opts) => (
      <StageRow
        key={s.id}
        stage={s}
        focused={focusedStageId === s.id}
        depth={opts.depth ?? 0}
        // A finished run keeps its last stage open: that is the result the user came for.
        autoCollapse={runIsActive}
        openWhenFinished={opts.openWhenFinished ?? false}
        showConnector={opts.showConnector}
        onFocus={selectStage}
        onApproveHitl={handleApproveHitl}
        onRejectHitl={handleRejectHitl}
        onTerminalRejectHitl={handleTerminalRejectHitl}
        onResolveGate={handleResolveGate}
        gateBusy={gateBusyStage === s.id}
        inProject={!!runData?.projectId}
        menu={stageMenu}
        {...(runIsTerminal ? { onRetry: handleRetryStage } : {})}
        onOpenInspector={handleOpenInspector}
        approveStarts={s.status === 'awaiting_input' ? successorsOf(s.id) : undefined}
        {...(opts.headerExtra || s.compensates
          ? {
              headerExtra: (
                <>
                  {opts.headerExtra}
                  {s.compensates ? <CompensationBadge /> : null}
                </>
              ),
            }
          : {})}
        {...(opts.body ? { body: opts.body } : {})}
        {...(opts.preamble ? { preamble: opts.preamble } : {})}
        {...(opts.hidePrompt ? { hidePrompt: true } : {})}
      />
    ),
    [
      focusedStageId,
      runIsActive,
      runIsTerminal,
      selectStage,
      handleApproveHitl,
      handleRejectHitl,
      handleTerminalRejectHitl,
      handleResolveGate,
      gateBusyStage,
      runData?.projectId,
      stageMenu,
      handleRetryStage,
      handleOpenInspector,
      successorsOf,
    ],
  );

  // ── Dock registry ────────────────────────────────────────────
  const surfaceTabs = useSurfaceDockTabs({ isOrchestrator: false, computerUseEnabled: false });
  const surfaceTypes = surfaceTabs.types;
  const tabs = useMemo<DockRegistry>(() => {
    const noWorkspace = { disabled: !runWorkspaceId, disabledReason: 'This run has no workspace yet' };
    const shared: DockRegistry = {
      changes: { label: 'Changes', description: 'Files & changes of this run', icon: 'changes', pinned: true, Component: ChangesDockPanel },
      files: {
        label: 'Files',
        description: 'Browse every file in the run workspace',
        icon: 'files',
        pinned: true,
        getTabLabel: fileTabs.filesTabLabel,
        Component: FilesDockPanel,
      },
      terminal: {
        label: 'Terminal',
        description: 'Integrated shell in the run workspace',
        icon: 'terminal',
        pinned: true,
        allowMultiple: true,
        maxInstances: DOCK_TAB_CAPS.terminal,
        getTabLabel: terminalTabLabel,
        ...noWorkspace,
        Component: TerminalDockPanel,
      },
      browser: {
        label: 'Browser',
        description: 'Integrated browser for this run',
        icon: 'browser',
        pinned: true,
        allowMultiple: true,
        maxInstances: DOCK_TAB_CAPS.browser,
        getTabLabel: ({ id, index }) => browserDockTabLabel(browserTabs[id], index),
        getTabDot: ({ id }) => (browserTabs[id]?.loading ? { tone: 'run', label: 'Loading' } : undefined),
        ...noWorkspace,
        Component: BrowserDockPanel,
      },
      widget: {
        label: 'Widget',
        description: 'Agent-rendered interactive widgets of the focused stage',
        icon: 'widgets',
        Component: RunWidgetDockPanel,
      },
      file: {
        label: 'File',
        icon: 'file',
        allowMultiple: true,
        maxInstances: DOCK_TAB_CAPS.file,
        getTabLabel: fileTabs.fileTabLabel,
        Component: FileDockPanel,
      },
    };
    return {
      // Run-only panels first (board WorkflowRun: Inspector · Changes · Terminal · +).
      inspector: {
        label: 'Inspector',
        description: 'The focused stage: output, files, tools, hooks, events, history',
        icon: 'info',
        pinned: true,
        Component: RunInspectorDockPanel,
      },
      ...Object.fromEntries(surfaceTypes.flatMap((type) => (shared[type] ? [[type, shared[type]]] : []))),
      usage: {
        label: 'Usage',
        description: 'Turns, tokens and reported cost, per stage',
        icon: 'activity',
        Component: RunUsageDockPanel,
      },
    };
  }, [surfaceTypes, runWorkspaceId, fileTabs.filesTabLabel, fileTabs.fileTabLabel, browserTabs]);
  const addableTabTypes = useMemo(() => ['usage', ...surfaceTabs.addable], [surfaceTabs.addable]);

  const focusedStageEnriched = useMemo(
    () => (focusedStage ? { ...focusedStage, ...(inspectorFiles.files ? { files: inspectorFiles.files } : {}) } : null),
    [focusedStage, inspectorFiles.files],
  );
  const runDock = useMemo<RunDockContextValue>(
    () => ({
      runId,
      definitionId: runData?.workflowDefinitionId,
      run: runData,
      stage: focusedStageEnriched,
      filesNote: inspectorFiles.note,
      onFocusStage: focusStage,
    }),
    [runId, runData, focusedStageEnriched, inspectorFiles.note, focusStage],
  );

  const awaitingCount = runView?.stages.filter((s) => s.status === 'awaiting_input').length ?? 0;
  /**
   * Where a Changes review batch goes: the stage parked on its completion
   * review (the batch requests changes), else the focused stage when it can
   * take a message (W-55).
   */
  const reviewStageId =
    runView?.stages.find((s) => s.status === 'awaiting_input' && !!s.interrupt)?.id ??
    (focusedStage && CONVERSABLE.has(focusedStage.rawStatus) ? focusedStage.id : null);
  const changesProps = useMemo<ChangesPanelProps>(
    () => ({
      ...(runWorkspaceId ? { workspaceId: runWorkspaceId } : {}),
      ...(runData?.name ? { scmHint: runData.name } : {}),
      enableReview: true,
      reviewScope: { scope: 'run', scopeId: runId ?? '' },
      ...(runId && reviewStageId
        ? { reviewTarget: { kind: 'stage_followup' as const, runId, stageId: reviewStageId } }
        : { reviewDisabledReason: 'Comments are saved. Focus a running, paused or completed stage to send them to it.' }),
    }),
    [runWorkspaceId, runData?.name, runId, reviewStageId],
  );

  // ── Loading / error ─────────────────────────────────────────
  if (runError || (!runLoading && !runData)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          tone="error"
          icon="warning"
          title={runError ? 'Failed to load workflow run' : 'Run not found'}
          {...(runError instanceof Error ? { description: runError.message } : {})}
          action={
            <Button onClick={() => navigate(definitionId ? `/workflows/${definitionId}` : '/workflows')}>Back to workflow</Button>
          }
        />
      </div>
    );
  }
  if (runLoading || !runView || !runData) return <RunLoading />;

  const parallelCount = runView.stages.filter((s) => (s.parallelWith?.length ?? 0) > 0 && s.status === 'running').length;

  const main = (
    <div className="flex min-h-0 flex-1 flex-col">
      {graphOpen ? (
        <div className="h-2/5 min-h-64 shrink-0 border-b border-line-soft bg-sunken" data-testid="run-graph">
          <RunGraph definitionEdges={pinnedGraph?.edges} definitionStages={pinnedGraph?.stages} onSelectStage={focusStage} />
        </div>
      ) : null}
      <div ref={scrollHostRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="run-scroll">
        <div className="mx-auto flex w-full max-w-240 flex-col gap-3 px-5 py-4">
          {runView.compensation ? (
            <CompensationBanner
              compensation={runView.compensation}
              count={runView.stages.filter((s) => s.compensates && s.status === 'completed').length}
            />
          ) : null}
          {runView.error ? <Banner tone="err" lead="Error" detail={runView.error} /> : null}
          {(runData?.systemVars?.warnings ?? []).map((warning) => (
            <Callout key={warning} tone="warn" title="Toolchain" data-testid="run-warning">
              {warning}
            </Callout>
          ))}
          <RunPullRequestBanner projectId={runData?.projectId} systemVars={runData?.systemVars} />
          <RunDecisionsContext.Provider value={decisionsValue}>
            {runId ? <NeedsDecisionPanel decisions={pendingDecisions ?? []} runId={runId} onFocus={focusStage} /> : null}
            <section aria-label="Stages" className="overflow-hidden rounded-panel border border-line bg-surface">
              <div
                aria-hidden
                className="flex h-th items-center gap-1 border-b border-line-soft bg-sunken pr-8 pl-13 text-small text-fg-3"
              >
                <span className="min-w-0 flex-1">Stage</span>
                <span className="hidden w-32 md:inline">Key</span>
                <span className="w-16 text-right">Time</span>
              </div>
              {runView.topLevel.map((s, i) => {
                const showConnector = i < runView.topLevel.length - 1;
                const openWhenFinished = i === runView.topLevel.length - 1;
                return runId ? (
                  <ControlFlowNode
                    key={s.id}
                    runId={runId}
                    stage={s}
                    bodies={runView.loopBodies}
                    focusedId={focusedStageId}
                    showConnector={showConnector}
                    renderStage={renderStage}
                    onCommand={sendCommand}
                    openWhenFinished={openWhenFinished}
                  />
                ) : (
                  renderStage(s, { showConnector, openWhenFinished })
                );
              })}
            </section>
          </RunDecisionsContext.Provider>
        </div>
      </div>
    </div>
  );

  return (
    <RunDockContext.Provider value={runDock}>
      <ChangesDockContext.Provider value={changesProps}>
        <FilesDockProvider value={fileTabs.dockContext}>
          <TerminalDockProvider value={terminalDock}>
            <BrowserDockProvider value={browserDock}>
              <Workspace
                bare
                data-testid="run-workspace"
                header={
                  <RunHeader
                    run={{ ...runView, stages: runView.topLevel }}
                    definitionId={definitionId}
                    definitionName={definitionName}
                    runCrumb={runCrumb}
                    version={pinnedVersion?.version}
                    triggerKind={runData.trigger?.kind}
                    awaitingCount={awaitingCount}
                    parallelCount={parallelCount}
                    usage={runData.usage}
                    budget={runData.budget}
                    statusReason={runData.statusReason}
                    focusedContext={
                      focusedStage && (focusedStage.contextUsage || focusedStage.usage)
                        ? { snapshot: focusedStage.contextUsage, usage: focusedStage.usage }
                        : null
                    }
                    onPause={handlePause}
                    onResume={handleResume}
                    onCancel={handleCancel}
                    onRetry={handleRetry}
                    retryBusy={invokeWorkflow.isPending}
                    onRaiseBudget={handleRaiseBudget}
                    onPermissionModeChange={handlePermissionModeChange}
                    permissionBusy={setRunPermissionMode.isPending}
                    permissionRules={{
                      matches: (runPermissionRules.data ?? []).map((r) => r.match),
                      onClear: () => {
                        if (runId) clearRunPermissionRules.mutate(runId);
                      },
                      busy: clearRunPermissionRules.isPending,
                    }}
                    graphOpen={graphOpen}
                    onToggleGraph={() => setGraphOpen((v) => !v)}
                    onOpenTimeline={() => setTimelineOpen(true)}
                    dockOpen={dockOpen}
                    onToggleDock={toggleDock}
                  />
                }
                main={main}
                bottom={focusedComposer}
                dockHost={(column) => (
                  <Dock
                    open={dockOpen}
                    onOpenChange={setDockOpen}
                    storageKey={dockStorageKey}
                    layoutStorageKey={RUN_DOCK_KEYS.layout}
                    defaultTabType="inspector"
                    addableTabTypes={addableTabTypes}
                    focusTabRequest={focusRequest}
                    onTabClose={handleDockTabClose}
                    tabs={tabs}
                    main={column}
                    defaultSize={RUN_DOCK_WIDTH}
                  />
                )}
              />
            </BrowserDockProvider>
          </TerminalDockProvider>
        </FilesDockProvider>
      </ChangesDockContext.Provider>
      <Dialog open={timelineOpen} onOpenChange={setTimelineOpen} size="xl" title="Event timeline">
        <DialogBody>
          <RunEventTimeline />
        </DialogBody>
      </Dialog>
      {confirmer.dialog}
    </RunDockContext.Provider>
  );
}

export type { StageView };
