// ────────────────────────────────────────────────────────────────
// WorkflowRunPage — the run panel.
//
// Drives the run data sources (useWorkflowRun, useWorkflowDefinition,
// useWorkflowRunStore, useStreamStore, connectWorkflowRun) and feeds
// the run components through the pure `deriveRunView`.
//
// A stage is a compact chat (P03b): the focused stage gets the shared
// composer, its gates the chat's cards, and a "…" menu whose items go
// through the commands API. No control fails silently (D-13): every
// mutation toasts its refusal, and destructive ones ask first.
//
// Cost (D-21, D-24): every stage stream of the mounted run is protected
// from eviction; the one ticking clock is the header's; unchanged stages
// keep their StageView (memoised rows); the workspace is polled only while
// the run is live, and the Inspector's files are the focused stage's own.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import {
  AlertCircle, ListTree, FolderOpen, FileText, TerminalSquare, LayoutGrid, Gauge,
} from 'lucide-react';
import { Modal, EmptyState, Button, Spinner, useConfirm } from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';

import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { useEditorTarget } from '@/stores/editorTargetStore.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { protectStream, useStreamStore } from '@/stores/streamStore.js';
import { useShallow } from 'zustand/react/shallow';
import {
  useWorkflowRun, useWorkflowDefinition, useWorkflowDefinitionVersion,
  useRunCommand, useInvokeWorkflow,
  useRunWorkspace,
  useResolveStageInteraction,
  useSetRunPermissionMode,
  useLoopEventRefetch,
  usePendingDecisions,
} from '@/hooks/workflowQueries.js';
import { useWorkspaceChangeSummary, useWorkspaceCheckpoints } from '@/hooks/queries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { connectWorkflowRun } from '@/stores/sseManager.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import type { WorkflowRunPermissionMode } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';

import { RunHeaderBar } from '@/components/workflow/redesign/RunHeaderBar.js';
import { PipelineFlow } from '@/components/workflow/redesign/PipelineFlow.js';
import {
  StageTimelineItem,
  type StageGateResolution,
  type StageMenuActions,
} from '@/components/workflow/redesign/StageTimelineItem.js';
import { StageComposer } from '@/components/workflow/redesign/StageComposer.js';
import { type RenderStage } from '@/components/workflow/redesign/LoopTimelineItem.js';
import { ControlFlowNode } from '@/components/workflow/redesign/ControlFlowNode.js';
import {
  CompensationBadge,
  CompensationBanner,
  NeedsDecisionPanel,
  RunDecisionsContext,
  type RunDecisionsValue,
} from '@/components/workflow/redesign/ControlFlowCards.js';
import { RightInspector } from '@/components/workflow/redesign/RightInspector.js';
import { RunUsagePanel } from '@/components/workflow/redesign/RunUsagePanel.js';
import { createStageViewCache, deriveRunView, pickStageStreams } from '@/components/workflow/redesign/deriveRunView.js';
import type { FileChange, StageView } from '@/components/workflow/redesign/types.js';

// Re-use existing panels behind the new chrome
import { RuntimeDAGCanvas } from '@/components/workflow/RuntimeDAGCanvas.js';
import { RunTimeline } from '@/components/workflow/RunTimeline.js';
import { ChangesSurface } from '@/components/diff/ChangesSurface.js';
import { useFileTabs } from '@/components/diff/useFileTabs.js';
import { BrowserPanel, BrowserTabIcon, type BrowserTabState } from '@/components/chat/BrowserPanel.js';
import { TerminalPanel, type TerminalWorktreeOption } from '@/components/terminal/TerminalPanel.js';
import { WidgetHost } from '@/components/widgets/WidgetHost.js';
import { Breadcrumb } from '@/components/layout/Breadcrumb.js';
import { RightPane, useRightPaneOpen } from '@/components/layout/RightPane.js';
import { clearBrowserTabUrl } from '@/lib/browserTabUrls.js';
import { openMultiplexedStream } from '@/platform/muxStream.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { runTitle } from '@generatorai/client-core';

export function WorkflowRunPage() {
  const { id: definitionId, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();
  const platform = usePlatform() as HttpPlatformClient;

  // ── Data sources ─────────────────────────────────────────────

  const { data: runData, isLoading: runLoading, error: runError } = useWorkflowRun(runId);
  const { data: definition } = useWorkflowDefinition(definitionId);
  // The graph this run executes: the version it pinned, not the live
  // definition (which may have been edited since the run started).
  const { data: pinnedVersion } = useWorkflowDefinitionVersion(definitionId, runData?.definitionVersionId);
  const pinnedGraph = pinnedVersion?.graph;
  const definitionName = definition?.graph.workflow.name;
  // NOTE: `awaiting_input` is a *StageRun* status, not a WorkflowRunStatus —
  // a run whose stage is parked on a HITL gate stays `running`.
  const runIsActive = runData?.status === 'running' || runData?.status === 'starting' || runData?.status === 'created';
  const runIsTerminal =
    runData?.status === 'failed' || runData?.status === 'cancelled' || runData?.status === 'completed';
  // A finished run's workspace no longer changes: stop polling it (D-24).
  const { data: workspace } = useRunWorkspace(runId, { live: !!runData && !runIsTerminal });

  // ── Store bindings ───────────────────────────────────────────

  const storeRun = useWorkflowRunStore((s) => s.run);
  const setRun = useWorkflowRunStore((s) => s.setRun);
  const clearRun = useWorkflowRunStore((s) => s.clearRun);
  // ONE focus for the page, the graph and the event timeline (D-20).
  const focusedStageId = useWorkflowRunStore((s) => s.selectedStageRunId);
  const setFocusedStageId = useWorkflowRunStore((s) => s.selectStageRun);
  // Instances waiting for a launch slot (P07 WP-7.2), from the run stream.
  const admission = useWorkflowRunStore((s) => s.admission);

  // P0-49 fix: Subscribe ONLY to the stage streams for this run — not the
  // whole `streams` record. Without this, ANY change to ANY chat's stream
  // (a live chat in a different tab, background SSE events, etc.) triggers a
  // full re-render of this page and 20 × 500 × 3 block visits per frame.
  //
  // Implementation: `useShallow` compares the selector result shallowly so
  // the component only re-renders when a stream value for *this run* changes.
  // Capturing `stageRunIds` in the selector closure is intentional — the
  // selector is cheap to re-create and Zustand uses the equality function on
  // the RESULT, not the selector reference.
  const stageRunIds = useMemo(
    () => (storeRun?.stageRuns.map((s) => s.id)) ?? [],
    [storeRun?.stageRuns],
  );
  const streams = useStreamStore(
    useShallow((s) => pickStageStreams(s.streams, stageRunIds)),
  );

  // D-21: the stage streams of the run on screen are exempt from the
  // stream store's LRU eviction while the page is mounted.
  const stageRunIdsKey = stageRunIds.join(',');
  useEffect(() => {
    const releases = stageRunIdsKey ? stageRunIdsKey.split(',').map((id) => protectStream(`stageRun:${id}`)) : [];
    return () => { for (const release of releases) release(); };
  }, [stageRunIdsKey]);

  // ── Mutations ────────────────────────────────────────────────

  const runCommand = useRunCommand();
  const invokeWorkflow = useInvokeWorkflow({ errorTitle: 'Could not re-run' });
  const resolveGate = useResolveStageInteraction();
  const setRunPermissionMode = useSetRunPermissionMode();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // ── UI state ─────────────────────────────────────────────────

  const [graphOpen, setGraphOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  /**
   * Right-side pane state — now delegated to the shared `RightPane` component.
   * We only track whether the pane is open here; tab management (Changes /
   * Inspector / Browser) lives inside `RightPane` and is persisted per-page
   * via localStorage.
   */
  const [rightPaneOpen, setRightPaneOpen, toggleRightPane] = useRightPaneOpen('generatorai:rightPane:workflow-run', false);
  // Bridge the pane toggle up to the global Header's side-pane icon.
  const setRightPaneController = useRightPaneStore((s) => s.setController);
  useEffect(() => {
    setRightPaneController({ open: rightPaneOpen, toggle: toggleRightPane });
    return () => setRightPaneController(null);
  }, [rightPaneOpen, toggleRightPane, setRightPaneController]);
  /**
   * Imperative "focus this tab" token — bumped when the workspace signals
   * `browser.session_created` so the Browser tab pops open live during
   * a run (Phase 2 of the built-in browser tools plan).
   */
  const [browserTabFocusRequest, setBrowserTabFocusRequest] = useState<{ type: string; token: number; tabId?: string } | null>(null);
  // Per-instance browser tab state keyed by the RightPane tab id.
  const [browserTabs, setBrowserTabs] = useState<Record<string, BrowserTabState>>({});
  // Right-pane tabs are scoped to THIS run, so browser tabs opened while
  // watching one run never show up in another.
  const rightPaneStorageKey = `generatorai:rightPane:workflow-run:${runId ?? 'unknown'}`;
  // Namespace for each browser tab's remembered URL (see `browserTabUrls`).
  const browserUrlScopeKey = `workflow-run:${runId ?? 'unknown'}`;
  // Files tab + per-file tabs. Opening a file expands the pane first, so the
  // gesture works even when the user has it collapsed. Declared before the
  // close handler because that handler has to forget this tab's selection.
  const fileTabs = useFileTabs({
    workspaceId: runData?.workspaceId,
    requestFocus: setBrowserTabFocusRequest,
    openPane: () => setRightPaneOpen(true),
  });

  // Closing a tab for good drops whatever that tab remembered.
  const forgetFileTab = fileTabs.forgetTab;
  const handleRightPaneTabClose = useCallback(
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
  // The run's effective permission mode as the server resolves it (re-read when the run's own mode changes).
  const [fetchedPermissionMode, setFetchedPermissionMode] = useState<WorkflowRunPermissionMode | undefined>(undefined);
  /** The stage whose gate answer or approval is in flight (its buttons disable, D-13). */
  const [gateBusyStage, setGateBusyStage] = useState<string | null>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  const viewCache = useRef(createStageViewCache());

  // Draggable right pane width is managed by `RightPane` itself.

  // ── Effects ──────────────────────────────────────────────────

  // Sync run data → store
  useEffect(() => {
    if (runData) setRun(runData);
  }, [runData, setRun]);

  // Phase 2 of built-in browser tools — auto-open the Browser tab in
  // the right pane when the run's workspace signals `browser.session_created`.
  // This lets the user watch the agent's browser without a manual click.
  const runWorkspaceId = runData?.workspaceId;

  // "Open in editor" opens the run's workspace root: a run's stages share one
  // checkout, so the root IS the thing a user wants in front of them.
  const { data: runWorkspaceInfo } = useWorkspaceInfo(runWorkspaceId);
  useEditorTarget(
    runWorkspaceInfo?.workingDirectory ?? runWorkspaceInfo?.rootPath,
    runTitle(runData?.name),
  );
  useEffect(() => {
    if (!runWorkspaceId) return;
    let cancelled = false;
    // On-mount probe first (covers the case where the session started
    // before we subscribed to SSE).
    void fetch(`/api/workspaces/${runWorkspaceId}/browser/descriptor`)
      .then((r) => (r.ok ? r.json() : null))
      .then((desc: { ready?: boolean; config?: { visibility?: string } } | null) => {
        if (cancelled || !desc?.ready) return;
        if (desc.config?.visibility === 'visible') {
          setRightPaneOpen(true);
          setBrowserTabFocusRequest({ type: 'browser', token: Date.now() });
        }
      })
      .catch(() => undefined);
    // Live SSE.
    const es = openMultiplexedStream(
      'session',
      `browser:${runWorkspaceId}`,
      {
        onMessage: (e) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse(e.data) as { kind?: string };
            if (payload.kind !== 'browser.session_created') return;
            void fetch(`/api/workspaces/${runWorkspaceId}/browser/descriptor`)
              .then((r) => (r.ok ? r.json() : null))
              .then((desc: { config?: { visibility?: string } } | null) => {
                if (cancelled || !desc) return;
                const v = desc.config?.visibility;
                if (v === 'visible' || v === undefined) {
                  setRightPaneOpen(true);
                  setBrowserTabFocusRequest({ type: 'browser', token: Date.now() });
                }
              })
              .catch(() => undefined);
          } catch { /* ignore */ }
        },
      },
      ['browser.session_created'],
    );
    return () => {
      cancelled = true;
      try { es.close(); } catch { /* noop */ }
    };
  }, [runWorkspaceId, setRightPaneOpen]);

  // Connect SSE
  useEffect(() => {
    if (!runId) return;
    const disconnect = connectWorkflowRun(runId, platform);
    return () => { disconnect(); };
  }, [runId, platform]);

  // Loops (P05): every `loop.*` event refetches the run and the iterations.
  // Subscribed after the run stream so it joins that scope's subscription.
  useLoopEventRefetch(runId, !!runData && !runIsTerminal);
  // Every decision the run waits on, its sub-workflow children's mirrored (P05).
  const { data: pendingDecisions } = usePendingDecisions(runId, { live: !!runData && !runIsTerminal });

  // Cleanup: on unmount AND when the page moves to another run (a fork), so
  // nothing of the previous run stays focused or merged (CONVINV-R20).
  useEffect(() => () => { clearRun(); }, [clearRun, runId]);

  // Permission mode for HitlBanner / RunHeaderBar: the run's own, never a
  // local copy (another client may change it); the server's effective mode
  // fills in when the run leaves it to its definition (CONVINV-R20).
  const runPermissionMode = runData?.permissionMode;
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    platform.getPermissionMode(runId).then((res) => {
      if (!cancelled) setFetchedPermissionMode(res.mode);
    }).catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [runId, platform, runPermissionMode]);
  const permissionMode = runPermissionMode ?? fetchedPermissionMode;

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

  // Breadcrumb label for this run. Once the epoch suffix is stripped a run is
  // usually named exactly like its definition, which would render the trail as
  // "… › Desktop audit flow › Desktop audit flow". When the two match, the
  // start time is the thing that actually identifies this run among its
  // siblings.
  const runCrumb = useMemo(() => {
    const title = runTitle(runView?.name);
    if (definitionName && title === definitionName) {
      const started = runView?.startedAt;
      return started
        ? `Run · ${new Date(started).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
        : 'Run';
    }
    return title;
  }, [runView?.name, runView?.startedAt, definitionName]);

  // The store picks the initial focus (awaiting > running > first) and keeps
  // it valid when a poll brings the stages in; the page only reads it.
  const focusedStage = useMemo(
    () => (runView && focusedStageId) ? (runView.stages.find((s) => s.id === focusedStageId) ?? null) : null,
    [runView, focusedStageId],
  );

  // ── Handlers ─────────────────────────────────────────────────

  /** Set the focused stage AND scroll it into view. Use this for clicks
   *  from outside the stage row (pipeline pills, chips, keyboard nav). */
  const focusStage = useCallback((id: string) => {
    setFocusedStageId(id);
    const host = scrollHostRef.current;
    if (!host) return;
    const el = host.querySelector<HTMLElement>(`[data-stage-id="${id}"]`);
    if (!el) return;
    // Manual scroll on the host so we don't accidentally scroll the parent
    // container (which happens with scrollIntoView in nested overflow trees).
    const hostRect = host.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target = host.scrollTop + (elRect.top - hostRect.top) - 16;
    host.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, []);

  /** Set the focused stage WITHOUT scrolling. Use for row-header clicks —
   *  the user already sees the row; scrolling it out from under them is
   *  disorienting. */
  const selectStage = useCallback((id: string) => {
    setFocusedStageId(id);
  }, [setFocusedStageId]);

  // D-13: a refused command is toasted by the mutation (`useRunCommand`'s
  // meta) with the server's reason; the promise settles either way.
  const runCommandAsync = runCommand.mutateAsync;
  const sendCommand = useCallback((command: RunCommand) => {
    if (!runId) return Promise.resolve();
    return runCommandAsync({ runId, command }).then(() => undefined, () => undefined);
  }, [runId, runCommandAsync]);
  // A mirrored decision is the child run's: its command goes there.
  const decisionsValue = useMemo<RunDecisionsValue | null>(
    () =>
      runId
        ? {
            runId,
            decisions: pendingDecisions ?? [],
            commandTo: (target, command) => runCommandAsync({ runId: target, command }).then(() => undefined, () => undefined),
          }
        : null,
    [runId, pendingDecisions, runCommandAsync],
  );

  // Pause in `interrupt` mode: in-flight stages pause too, not just new launches.
  const handlePause = useCallback(() => { void sendCommand({ command: 'pause', mode: 'interrupt' }); }, [sendCommand]);
  const handleResume = useCallback(() => { void sendCommand({ command: 'resume' }); }, [sendCommand]);
  // A run paused by its exhausted budget: add half of each limit (WP-7.3); the engine resumes it when it is under.
  const runBudget = runData?.budget;
  const handleRaiseBudget = useCallback(() => {
    // Turns, tokens and ms round up to whole units; cost rounds up to the cent.
    // (toFixed trims float noise such as 0.07 * 100 = 7.000000000000001 before the ceil).
    const half = (k: string, perUnit = 1) => {
      const v = runBudget?.[k];
      return typeof v === 'number' && v > 0 ? Math.ceil(Number(((v / 2) * perUnit).toFixed(6))) / perUnit : undefined;
    };
    const deltas = { maxTurns: half('maxTurns'), maxTokens: half('maxTokens'), maxCostUsd: half('maxCostUsd', 100), maxWallClockMs: half('maxWallClockMs') };
    const command = { command: 'raise_budget' as const, ...Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== undefined)) };
    void sendCommand(command as RunCommand);
  }, [runBudget, sendCommand]);
  const handleCancel = useCallback(() => {
    void confirm({
      title: 'Cancel this run?',
      description: 'Every stage still running or waiting is cancelled. A cancelled run can only be re-run as a new run.',
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep running',
      variant: 'destructive',
    }).then((ok) => { if (ok) void sendCommand({ command: 'cancel' }); });
  }, [confirm, sendCommand]);

  const setRunMode = setRunPermissionMode.mutateAsync;
  const handlePermissionModeChange = useCallback((mode: WorkflowRunPermissionMode) => {
    if (!runId) return;
    // The mutation refetches the run: the control shows the mode the run has.
    void setRunMode({ runId, mode }).then(() => undefined, () => undefined);
  }, [runId, setRunMode]);

  // A terminal run is never mutated: "Retry failed" forks a NEW run that
  // re-runs every instance that did not complete (completed ones are
  // memoized), and `rerunFrom` re-runs one stage and everything downstream.
  // Follow the user to the fork — staying on the ancestor looks inert.
  const forkAndOpen = useCallback((rerunFrom?: string[]) => {
    if (!runId) return;
    // A refusal is toasted by the mutation (`useInvokeWorkflow`'s meta).
    void invokeWorkflow.mutateAsync({
      request: {
        target: {
          kind: 'fork',
          sourceRunId: runId,
          ...(rerunFrom ? { rerunFrom } : {}),
          definition: 'pinned',
          workspace: 'fresh',
        },
        variables: {},
        client: 'web',
      },
    }).then(
      (fork) => {
        if (fork.runId !== runId) navigate(`/workflows/${fork.workflowDefinitionId}/runs/${fork.runId}`);
      },
      () => undefined,
    );
  }, [runId, invokeWorkflow, navigate]);
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

  // An approval answers the gate on screen only: it carries the instance's
  // version, so a stale click never approves a later round or gate (ENGINE-R11).
  const storeRunRef = useRef(storeRun);
  storeRunRef.current = storeRun;
  const versionOf = useCallback((stageId: string) => {
    const v = storeRunRef.current?.stageRuns.find((sr) => sr.id === stageId)?.version;
    return v !== undefined ? { expectedVersion: v } : {};
  }, []);

  // The completion review is the `approve` command on the parked instance.
  const handleApproveHitl = useCallback((stageId: string) => {
    void withGateBusy(stageId, () => sendCommand({ command: 'approve', instanceId: stageId, outcome: 'approved', ...versionOf(stageId) }));
  }, [sendCommand, withGateBusy, versionOf]);

  // A stage's permission / question / plan-review card answers its in-turn
  // gate through the stage conversation API (the chat's body shapes).
  const resolveGateAsync = resolveGate.mutateAsync;
  const handleResolveGate = useCallback((stageId: string, resolution: StageGateResolution) => {
    if (!runId) return;
    const { interactionId, ...answer } = resolution;
    void withGateBusy(stageId, () => resolveGateAsync({ runId, instanceId: stageId, interactionId, answer }));
  }, [runId, resolveGateAsync, withGateBusy]);

  const handleRejectHitl = useCallback((stageId: string, feedback?: string) => {
    void withGateBusy(stageId, () => sendCommand({
      command: 'approve',
      instanceId: stageId,
      outcome: 'changes_requested',
      ...(feedback ? { feedback } : {}),
      ...versionOf(stageId),
    }));
  }, [sendCommand, withGateBusy, versionOf]);

  /**
   * Terminal rejection: fails the stage so the DAG blocks every downstream
   * stage and the run stops. Distinct from "request changes", which loops.
   */
  const handleTerminalRejectHitl = useCallback((stageId: string, reason?: string) => {
    void withGateBusy(stageId, () => sendCommand({
      command: 'approve',
      instanceId: stageId,
      outcome: 'rejected',
      ...(reason ? { feedback: reason } : {}),
      ...versionOf(stageId),
    }));
  }, [sendCommand, withGateBusy, versionOf]);

  // Re-running a stage of a finished run is a fork from that instance
  // (its successors re-run too; everything else is memoized).
  const stageRunsRef = useRef(runData?.stageRuns);
  stageRunsRef.current = runData?.stageRuns;
  const handleRetryStage = useCallback((stageId: string) => {
    const instancePath = stageRunsRef.current?.find((sr) => sr.id === stageId)?.instancePath;
    if (instancePath) forkAndOpen([instancePath]);
  }, [forkAndOpen]);

  const handleOpenInspector = useCallback((id: string) => {
    setFocusedStageId(id);
    setRightPaneOpen(true);
    // Ask RightPane to switch to the Inspector tab so the user actually sees
    // the stage's Output / Files / Timeline.
    setBrowserTabFocusRequest({ type: 'inspector', token: Date.now() });
  }, [setFocusedStageId, setRightPaneOpen]);

  // The stage "…" menu (D-18): commands through the commands API; a stage
  // cancel asks first.
  const handleStageCommand = useCallback((stageId: string, command: RunCommand) => {
    if (command.command !== 'cancel') {
      void sendCommand(command);
      return;
    }
    const name = stageRunsRef.current?.find((sr) => sr.id === stageId)?.name ?? 'this stage';
    void confirm({
      title: `Cancel ${name}?`,
      description: 'The stage stops and ends cancelled; routing decides what the run does next.',
      confirmLabel: 'Cancel stage',
      cancelLabel: 'Keep it',
      variant: 'destructive',
    }).then((ok) => { if (ok) void sendCommand(command); });
  }, [confirm, sendCommand]);

  const handleCopyOutput = useCallback((stageId: string) => {
    const sr = stageRunsRef.current?.find((s) => s.id === stageId);
    const text = sr?.outputText ?? (sr?.outputData ? JSON.stringify(sr.outputData, null, 2) : '');
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => toast({ variant: 'success', title: 'Output copied' }),
      () => toast({ variant: 'error', title: 'Could not copy the output' }),
    );
  }, []);

  const stageMenu = useMemo<StageMenuActions>(() => ({
    runLive: !runIsTerminal,
    onCommand: handleStageCommand,
    onCopyOutput: handleCopyOutput,
    onRerunFrom: handleRetryStage,
  }), [runIsTerminal, handleStageCommand, handleCopyOutput, handleRetryStage]);

  // D-22: the Inspector's Files are the focused stage's own changes, from
  // its checkpoint to the next checkpoint of the run (or the workspace now).
  const inspectorFiles = useStageFiles(runData?.workspaceId, focusedStage, rightPaneOpen);

  // The focused stage's composer (a stage is a compact chat).
  // Only an agent stage is a conversation: a loop, a map, a wait, a
  // sub-workflow, a check or an expansion is not (their decisions are their cards').
  const focusedComposer = useMemo(
    () => (runId && focusedStage && focusedStage.kind === 'agent' && focusedStage.status !== 'skipped' && focusedStage.status !== 'cancelled'
      ? <StageComposer runId={runId} stage={focusedStage} workspaceId={runData?.workspaceId} />
      : null),
    [runId, focusedStage, runData?.workspaceId],
  );

  // One renderer for every row: top-level stages, a loop's own row and its
  // body instances (LoopTimelineItem), so they all focus, answer gates and
  // open the "…" menu the same way.
  const renderStage = useCallback<RenderStage>((s, opts) => (
    <StageTimelineItem
      key={s.id}
      stage={s}
      focused={focusedStageId === s.id}
      // A finished run keeps its last stage open: that is the result
      // the user came for, and collapsing it left the page blank.
      autoCollapse={runIsActive}
      openWhenFinished={opts.openWhenFinished ?? false}
      showConnector={opts.showConnector}
      onFocus={selectStage}
      onApproveHitl={handleApproveHitl}
      onRejectHitl={handleRejectHitl}
      onTerminalRejectHitl={handleTerminalRejectHitl}
      onResolveGate={handleResolveGate}
      gateBusy={gateBusyStage === s.id}
      menu={stageMenu}
      composer={focusedStageId === s.id ? focusedComposer : undefined}
      onRetry={runIsTerminal ? handleRetryStage : undefined}
      onSelectFiles={selectStage}
      onSelectOutput={selectStage}
      onOpenInspector={handleOpenInspector}
      {...(opts.headerExtra || s.compensates
        ? { headerExtra: <>{opts.headerExtra}{s.compensates && <CompensationBadge />}</> }
        : {})}
      {...(opts.body ? { body: opts.body } : {})}
      {...(opts.preamble ? { preamble: opts.preamble } : {})}
      {...(opts.hidePrompt ? { hidePrompt: true } : {})}
    />
  ), [
    focusedStageId, runIsActive, runIsTerminal, selectStage, handleApproveHitl, handleRejectHitl,
    handleTerminalRejectHitl, handleResolveGate, gateBusyStage, stageMenu, focusedComposer,
    handleRetryStage, handleOpenInspector,
  ]);

  // ── Loading / error ─────────────────────────────────────────

  if (runLoading || !runView) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-[var(--color-muted-foreground)]" label="Loading workflow run" />
      </div>
    );
  }

  if (runError || !runData) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {runError ? 'Failed to load workflow run' : 'Run not found'}
        </p>
        <Button
          variant="ghost"
          onClick={() => navigate(definitionId ? `/workflows/${definitionId}` : '/workflows')}
          className="h-auto rounded-none bg-transparent p-0 text-sm text-[var(--color-primary)] underline hover:bg-transparent hover:text-[var(--color-primary)]"
        >
          Back to workflow
        </Button>
      </div>
    );
  }

  const awaitingCount = runView.stages.filter((s) => s.status === 'awaiting_input').length;
  /**
   * The stage a review batch goes to: a stage parked on its completion
   * review (the batch requests changes), else the focused stage when it can
   * take a message (the stage conversation API: its next turn, an amendment
   * of a completed stage, a retry of a paused one).
   */
  const conversable = (s: StageView) =>
    ['starting', 'running', 'validating', 'completed', 'paused'].includes(s.rawStatus);
  const reviewStageId =
    runView.stages.find((s) => s.status === 'awaiting_input' && !!s.interrupt)?.id ??
    (focusedStage && conversable(focusedStage) ? focusedStage.id : null);
  const parallelCount = runView.stages.filter((s) => (s.parallelWith?.length ?? 0) > 0 && s.status === 'running').length;

  const focusedStageEnriched = focusedStage
    ? { ...focusedStage, ...(inspectorFiles.files ? { files: inspectorFiles.files } : {}) }
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Breadcrumb */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-1.5">
        <Breadcrumb
          items={[
            { label: 'Workflows', href: '/workflows' },
            { label: definitionName ?? 'Workflow', href: definitionId ? `/workflows/${definitionId}` : undefined },
            { label: runCrumb },
          ]}
        />
      </div>

      {/* Header bar */}
      <RunHeaderBar
        // A loop counts once in the progress; its iterations are inside it.
        run={{ ...runView, stages: runView.topLevel }}
        awaitingCount={awaitingCount}
        parallelCount={parallelCount}
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onPermissionModeChange={handlePermissionModeChange}
        permissionBusy={setRunPermissionMode.isPending}
        usage={runData.usage}
        budget={runData.budget}
        statusReason={runData.statusReason}
        onRaiseBudget={handleRaiseBudget}
        onOpenGraph={() => setGraphOpen((v) => !v)}
        graphOpen={graphOpen}
        pipelineOpen={pipelineOpen}
        onTogglePipeline={() => setPipelineOpen((v) => !v)}
      />

      {/* Collapsible inline DAG graph (below the header, above the 3-pane) */}
      {graphOpen && (
        <div className="h-[320px] shrink-0 border-b border-[var(--color-border)] bg-[var(--color-background)]">
          <ReactFlowProvider>
            <RuntimeDAGCanvas definitionEdges={pinnedGraph?.edges} definitionStages={pinnedGraph?.stages} />
          </ReactFlowProvider>
        </div>
      )}

      {/* Horizontal pipeline flow — toggleable */}
      {pipelineOpen && (
        <PipelineFlow
          stages={runView.topLevel}
          focusedId={focusedStageId}
          onFocus={focusStage}
          className="shrink-0"
        />
      )}

      {/* Compensation (P05 WP-5B.4): the finalize phase of a failed or cancelled run */}
      {runView.compensation && (
        <CompensationBanner
          compensation={runView.compensation}
          count={runView.stages.filter((s) => s.compensates && s.status === 'completed').length}
        />
      )}

      {/* Run-level error banner */}
      {runView.error && (
        <div className="border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)]/[0.06] px-4 py-2 text-sm text-[var(--color-danger)]">
          <span className="font-medium">Error:</span> {runView.error}
        </div>
      )}

      {/* Layout: center content + (optional) shared RightPane on the right.
          The RightPane is a tabbed dock that hosts Changes (default), the
          per-stage Inspector, and the integrated Browser. Tabs can be added
          / removed from the pane's "+" popover; the Changes tab is always
          present. The parent controls only open/close via RunHeaderBar's
          Inspector toggle button. */}
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={scrollHostRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="relative px-6 py-4">
            <RunDecisionsContext.Provider value={decisionsValue}>
            {runId && (
              <NeedsDecisionPanel decisions={pendingDecisions ?? []} runId={runId} onFocus={focusStage} />
            )}
            {runView.topLevel.map((s, i) => {
              const showConnector = i < runView.topLevel.length - 1;
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
                  openWhenFinished={i === runView.topLevel.length - 1}
                />
              ) : (
                renderStage(s, { showConnector, openWhenFinished: i === runView.topLevel.length - 1 })
              );
            })}
            </RunDecisionsContext.Provider>

            {/* Bottom control row: timeline toggle */}
            <div className="mt-6 flex items-center justify-center gap-2 pb-6">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTimelineOpen(true)}
                className="text-muted-foreground hover:text-foreground"
                leftIcon={<ListTree className="h-3.5 w-3.5" />}
              >
                Show event timeline
              </Button>
            </div>
          </div>
        </div>

        <RightPane
          open={rightPaneOpen}
          onOpenChange={setRightPaneOpen}
          storageKey={rightPaneStorageKey}
          widthStorageKey="generatorai:rightPane:workflow-run:width"
          defaultTabType="changes"
            addableTabTypes={['files', 'inspector', 'usage', 'browser', 'terminal', 'widget']}
          focusTabRequest={browserTabFocusRequest}
          onTabClose={handleRightPaneTabClose}
          tabs={{
            changes: {
              label: 'Changes',
              description: 'Run files & artifacts',
              icon: <FolderOpen className="h-3.5 w-3.5" />,
              render: () => (
                runData?.workspaceId ? (
                  <ChangesSurface
                    embedded
                    workspaceId={runData.workspaceId}
                    {...(runData.name ? { scmHint: runData.name } : {})}
                    enableReview
                    reviewScope={{ scope: 'run', scopeId: runId ?? '' }}
                    // A review batch goes to the stage parked on its review, or
                    // to the focused stage as a message (W-55).
                    {...(runId && reviewStageId
                      ? {
                          reviewTarget: {
                            kind: 'stage_followup' as const,
                            runId,
                            stageId: reviewStageId,
                          },
                        }
                      : {
                          reviewDisabledReason:
                            'Comments are saved. Focus a running, paused or completed stage to send them to it.',
                        })}
                  />
                ) : (
                  // Runs created before per-run workspaces existed have no
                  // workspace on disk (`/workspace` and `/diff` both 404), so
                  // there is nothing to diff or browse. Say so in the current
                  // design instead of falling back to the retired artifacts
                  // panel, which rendered its own older toggle-based chrome.
                  <EmptyState
                    icon={<FolderOpen className="h-8 w-8" />}
                    title="No workspace for this run"
                    hint={
                      runData?.status === 'created' || runData?.status === 'starting'
                        ? 'The workspace is still being provisioned — changes appear here once a stage starts.'
                        : 'This run predates per-run workspaces, so its file changes were never captured.'
                    }
                  />
                )
              ),
            },
            files: fileTabs.filesTab,
            file: fileTabs.fileTab,
            inspector: {
              label: 'Inspector',
              description: 'Per-stage files, output, hooks & tools',
              icon: <FileText className="h-3.5 w-3.5" />,
              render: () => (
                <RightInspector
                  stage={focusedStageEnriched}
                  runId={runId}
                  definitionId={runData.workflowDefinitionId}
                  filesNote={inspectorFiles.note}
                />
              ),
            },
            usage: {
              label: 'Usage',
              description: 'Turns, tokens and reported cost, per stage',
              icon: <Gauge className="h-3.5 w-3.5" />,
              render: () => <RunUsagePanel run={runData} onFocusStage={focusStage} />,
            },
            browser: {
              label: 'Browser',
              description: 'Integrated browser for this run',
              icon: <BrowserTabIcon state={null} />,
              allowMultiple: true,
              maxInstances: 5,
              getTabLabel: ({ id, index }) => {
                const t = (browserTabs[id]?.title ?? '').trim();
                return t || (index <= 1 ? 'Browser' : `Browser ${index}`);
              },
              getTabIcon: ({ id }) => <BrowserTabIcon state={browserTabs[id] ?? null} />,
              disabled: !runData?.workspaceId,
              disabledReason: 'This run has no workspace yet',
              render: (ctx) => (
                runData?.workspaceId ? (
                  <BrowserPanel
                    embedded
                    workspaceId={runData.workspaceId}
                    tabId={ctx.id}
                    urlScopeKey={browserUrlScopeKey}
                    open={true}
                    // P1-50 — see ChatPage: hidden tabs hold no live socket.
                    visible={ctx.active}
                    onClose={() => setRightPaneOpen(false)}
                    onTabStateChange={(s) => setBrowserTabs((prev) => {
                      const cur = prev[ctx.id];
                      if (cur && cur.loading === s.loading && cur.title === s.title && cur.favicon === s.favicon && cur.url === s.url) return prev;
                      return { ...prev, [ctx.id]: s };
                    })}
                    agentBusy={runData?.status === 'starting' || runData?.status === 'created'}
                  />
                ) : (
                  <div className="p-4 text-xs text-[var(--color-muted-foreground)]">
                    Browser is not available until the run has a workspace.
                  </div>
                )
              ),
            },
            terminal: {
              label: 'Terminal',
              description: 'Integrated shell in the run workspace',
              icon: <TerminalSquare className="h-3.5 w-3.5" />,
              allowMultiple: true,
              // P2-54 — see ChatPage: one WebGL context and one PTY per tab.
              maxInstances: 4,
              disabled: !runData?.workspaceId,
              disabledReason: 'This run has no workspace yet',
              render: (ctx) => {
                const worktreeOptions: TerminalWorktreeOption[] | undefined = workspace?.worktrees?.map((w) => ({
                  alias: w.alias,
                  path: w.worktreePath,
                }));
                return (
                  <TerminalPanel
                    embedded
                    workspaceId={runData?.workspaceId}
                    tabId={ctx.id}
                    {...(worktreeOptions ? { worktrees: worktreeOptions } : {})}
                    agentBusy={runData?.status === 'starting' || runData?.status === 'created'}
                  />
                );
              },
            },
            widget: {
              label: 'Widget',
              description: 'Agent-rendered interactive widgets for the focused stage',
              icon: <LayoutGrid className="h-3.5 w-3.5" />,
              allowMultiple: false,
              disabled: !focusedStageId,
              disabledReason: 'Select a stage first',
              render: () => (
                focusedStageId
                  ? <WidgetHost sessionId={`stageRun:${focusedStageId}`} />
                  : <div className="p-4 text-xs text-[var(--color-muted-foreground)]">No stage selected.</div>
              ),
            },
          }}
        />
      </div>

      {/* Timeline overlay */}
      {timelineOpen && (
        <Modal
          open
          onClose={() => setTimelineOpen(false)}
          size="xl"
          title={
            <span className="flex items-center gap-2">
              <ListTree className="h-4 w-4 text-primary" />
              Event timeline
            </span>
          }
        >
          <RunTimeline />
        </Modal>
      )}

      {confirmDialog}
    </div>
  );
}

/**
 * The focused stage's own file changes (D-22): its "before" checkpoint to
 * the next checkpoint of another stage (the state it left behind), or to
 * the workspace now when nothing ran after it. Fetched only while the pane
 * is open.
 */
function useStageFiles(
  workspaceId: string | undefined,
  stage: StageView | null,
  paneOpen: boolean,
): { files?: FileChange[]; note?: string } {
  const enabled = paneOpen && !!workspaceId && !!stage;
  const { data: cps } = useWorkspaceCheckpoints(workspaceId, {}, enabled);
  const own = useMemo(() => {
    if (!stage || !cps) return undefined;
    const mine = cps.checkpoints
      .filter((c) => c.stageRunId === stage.id && c.phase !== 'after')
      .sort((a, b) => a.seq - b.seq)[0];
    if (!mine) return null;
    const next = cps.checkpoints
      .filter((c) => c.repoAlias === mine.repoAlias && c.seq > mine.seq && c.stageRunId && c.stageRunId !== stage.id)
      .sort((a, b) => a.seq - b.seq)[0];
    return { base: `stage:${stage.id}`, head: next ? `checkpoint:${next.id}` : 'working', toNext: !!next };
  }, [stage, cps]);
  const { data: summary } = useWorkspaceChangeSummary(
    workspaceId,
    own ? { base: own.base, head: own.head } : {},
    enabled && !!own,
  );
  if (!stage) return {};
  if (own === null) {
    return { files: [], note: 'This stage has no checkpoint: it cannot change files, or it has not started.' };
  }
  if (!own || !summary) return {};
  const multi = summary.repos.length > 1;
  const files: FileChange[] = summary.repos.flatMap((r) =>
    r.files.map((f) => ({
      path: multi && r.alias !== '.' ? `${r.alias}/${f.path}` : f.path,
      kind: f.status,
      source: 'workspace' as const,
    })),
  );
  const parallel = (stage.parallelWith?.length ?? 0) > 0 ? ' Stages that ran alongside it are included.' : '';
  return {
    files,
    note: `Changed from this stage’s checkpoint to ${own.toNext ? 'the next stage’s' : 'the workspace now'}.${parallel}`,
  };
}

export default WorkflowRunPage;
