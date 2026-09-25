// ────────────────────────────────────────────────────────────────
// WorkflowRunPage — the run panel.
//
// Drives the run data sources (useWorkflowRun, useWorkflowDefinition,
// useWorkflowRunStore, useStreamStore, connectWorkflowRun) and feeds
// the run components through the pure `deriveRunView`.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import {
  AlertCircle, ListTree, FolderOpen, FileText, TerminalSquare, LayoutGrid,
} from 'lucide-react';
import { Modal, EmptyState, Button, Spinner } from '@/components/ui/index.js';

import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { useEditorTarget } from '@/stores/editorTargetStore.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { useShallow } from 'zustand/react/shallow';
import {
  useWorkflowRun, useWorkflowDefinition,
  usePauseWorkflowRun, useResumeWorkflowRun, useCancelWorkflowRun, useRetryWorkflowRun,
  useRetryStageRun,
  useWakeStageRun,
  useRunWorkspace,
  useRunScratchpad,
} from '@/hooks/workflowQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { connectWorkflowRun } from '@/stores/sseManager.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import type { WorkflowRunPermissionMode } from '@generatorai/shared';

import { RunHeaderBar } from '@/components/workflow/redesign/RunHeaderBar.js';
import { PipelineFlow } from '@/components/workflow/redesign/PipelineFlow.js';
import { StageTimelineItem } from '@/components/workflow/redesign/StageTimelineItem.js';
import { RightInspector } from '@/components/workflow/redesign/RightInspector.js';
import { deriveRunView, pickStageStreams } from '@/components/workflow/redesign/deriveRunView.js';
import type { FileChange } from '@/components/workflow/redesign/types.js';
import type { RunWorkspaceInfo } from '@generatorai/shared';

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
  const { data: workspace } = useRunWorkspace(runId);
  // Per-run scratchpad — full stage output text lives here (the DB StageRun
  // only stores `summary` and `outputData`). Poll while the run is active.
  // NOTE: `awaiting_input` is a *StageRun* status, not a WorkflowRunStatus —
  // a run whose stage is parked on a HITL gate stays `running`, so it is
  // already covered by the `running` check below.
  const runIsActive = runData?.status === 'running' || runData?.status === 'starting' || runData?.status === 'created';
  const { data: scratchpad } = useRunScratchpad(runId, { isRunning: runIsActive });

  // ── Store bindings ───────────────────────────────────────────

  const storeRun = useWorkflowRunStore((s) => s.run);
  const elapsedMs = useWorkflowRunStore((s) => s.elapsedMs);
  const setRun = useWorkflowRunStore((s) => s.setRun);
  const clearRun = useWorkflowRunStore((s) => s.clearRun);

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

  // ── Mutations ────────────────────────────────────────────────

  const pauseRun = usePauseWorkflowRun();
  const resumeRun = useResumeWorkflowRun();
  const cancelRun = useCancelWorkflowRun();
  const retryRun = useRetryWorkflowRun();
  const retryStageMutation = useRetryStageRun();
  const wakeStageMutation = useWakeStageRun();

  // ── UI state ─────────────────────────────────────────────────

  const [focusedStageId, setFocusedStageId] = useState<string | null>(null);
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
  const [permissionMode, setPermissionMode] = useState<WorkflowRunPermissionMode | undefined>(undefined);
  const scrollHostRef = useRef<HTMLDivElement>(null);

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

  // Cleanup
  useEffect(() => () => { clearRun(); }, [clearRun]);

  // Fetch permission mode for HitlBanner / RunHeaderBar
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    platform.getPermissionMode(runId).then((res) => {
      if (!cancelled) setPermissionMode(res.mode);
    }).catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [runId, platform]);

  // ── Derived RunView ──────────────────────────────────────────

  const runView = useMemo(() => {
    if (!storeRun) return null;
    return deriveRunView({
      run: storeRun,
      stageDefs: definition?.stages ?? [],
      edges: definition?.edges ?? [],
      elapsedMs,
      streams,
      permissionMode,
    });
  }, [storeRun, definition?.stages, definition?.edges, elapsedMs, streams, permissionMode]);

  // Breadcrumb label for this run. Once the epoch suffix is stripped a run is
  // usually named exactly like its definition, which would render the trail as
  // "… › Desktop audit flow › Desktop audit flow". When the two match, the
  // start time is the thing that actually identifies this run among its
  // siblings.
  const runCrumb = useMemo(() => {
    const title = runTitle(runView?.name);
    if (definition?.name && title === definition.name) {
      const started = runView?.startedAt;
      return started
        ? `Run · ${new Date(started).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
        : 'Run';
    }
    return title;
  }, [runView?.name, runView?.startedAt, definition?.name]);

  // Focused stage — auto-select awaiting > running > first
  useEffect(() => {
    if (!runView || focusedStageId) return;
    const next =
      runView.stages.find((s) => s.status === 'awaiting_input')?.id ??
      runView.stages.find((s) => s.status === 'running')?.id ??
      runView.stages[0]?.id ??
      null;
    if (next) setFocusedStageId(next);
  }, [runView, focusedStageId]);

  // If focused stage disappears (retry sequence, etc.)
  useEffect(() => {
    if (!runView || !focusedStageId) return;
    if (!runView.stages.some((s) => s.id === focusedStageId)) {
      setFocusedStageId(runView.stages[0]?.id ?? null);
    }
  }, [runView, focusedStageId]);

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
  }, []);

  const handlePause = useCallback(() => { if (runId) void pauseRun.mutateAsync(runId); }, [runId, pauseRun]);
  const handleResume = useCallback(() => { if (runId) void resumeRun.mutateAsync(runId); }, [runId, resumeRun]);
  const handleCancel = useCallback(() => { if (runId) void cancelRun.mutateAsync(runId); }, [runId, cancelRun]);
  // Retry produces a NEW run (the failed one stays terminal), so follow the
  // user to it — staying put on the ancestor is what made retry look inert.
  const handleRetry = useCallback(() => {
    if (!runId) return;
    void retryRun.mutateAsync(runId).then((res) => {
      if (res?.runId && res.runId !== runId && definitionId) {
        navigate(`/workflows/${definitionId}/runs/${res.runId}`);
      }
    });
  }, [runId, retryRun, navigate, definitionId]);

  const handleApproveHitl = useCallback(async (stageId: string, followUp?: string) => {
    if (!runId) return;
    try {
      await platform.resumeStage(runId, stageId, {
        outcome: 'approved',
        reason: followUp ? 'approved with follow-up' : 'approved via UI',
        followUpPrompt: followUp,
      });
    } catch (e) {
      console.error('HITL approve failed:', e);
    }
  }, [runId, platform]);

  const handleRejectHitl = useCallback(async (stageId: string, feedback?: string) => {
    if (!runId) return;
    try {
      await platform.resumeStage(runId, stageId, {
        outcome: 'changes_requested',
        reason: feedback ?? 'changes requested via UI',
        followUpPrompt: feedback,
      });
    } catch (e) {
      console.error('HITL request-changes failed:', e);
    }
  }, [runId, platform]);

  /**
   * Terminal rejection: fails the stage so the DAG blocks every downstream
   * stage and the run stops. Distinct from "request changes", which loops.
   */
  const handleTerminalRejectHitl = useCallback(async (stageId: string, reason?: string) => {
    if (!runId) return;
    try {
      await platform.resumeStage(runId, stageId, {
        outcome: 'rejected',
        reason: reason ?? 'rejected via UI',
      });
    } catch (e) {
      console.error('HITL reject failed:', e);
    }
  }, [runId, platform]);

  const handleRetryStage = useCallback((stageId: string) => {
    if (!runId) return;
    void retryStageMutation.mutateAsync({ runId, stageId });
  }, [runId, retryStageMutation]);

  const handleWakeStage = useCallback((stageId: string) => {
    if (!runId) return;
    // A 409 here just means the sweeper's timer beat the click; the stream
    // pushes the resulting status either way, so there is nothing to report.
    void wakeStageMutation.mutateAsync({ runId, stageId }).catch(() => undefined);
  }, [runId, wakeStageMutation]);

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
   * The stage a review batch can be delivered to. A run only accepts
   * feedback while a stage is parked in `awaiting_input` (HITL); at any other
   * time comments are still recorded, but there is no live conversation to
   * inject them into.
   */
  const awaitingStageId =
    runView.stages.find((s) => s.status === 'awaiting_input')?.id ?? null;
  const parallelCount = runView.stages.filter((s) => (s.parallelWith?.length ?? 0) > 0 && s.status === 'running').length;

  // Enrich focused stage with global workspace files if it has none of its own
  // AND with the scratchpad's stage-output text (which lives on disk, not on
  // the DB StageRun row). The scratchpad is keyed by `stageRunId` and
  // `StageView.id === stageRun.id`.
  const scratchpadForFocused = focusedStage && scratchpad
    ? scratchpad.entries.find((e) => e.stageRunId === focusedStage.id)
    : undefined;
  const focusedStageEnriched = focusedStage ? {
    ...focusedStage,
    // If this stage has no artifactManifest, fall back to run-level workspace
    // so the Files tab shows *something* useful when the SDK didn't emit
    // per-stage manifests.
    files: focusedStage.files ?? workspaceFilesFromRun(workspace),
    outputText: typeof scratchpadForFocused?.output === 'string'
      ? scratchpadForFocused.output
      : undefined,
    outputData: focusedStage.outputData ?? (
      scratchpadForFocused && typeof scratchpadForFocused.output === 'object' && scratchpadForFocused.output !== null
        ? (scratchpadForFocused.output as Record<string, unknown>)
        : undefined
    ),
  } : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Breadcrumb */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-1.5">
        <Breadcrumb
          items={[
            { label: 'Workflows', href: '/workflows' },
            { label: definition?.name ?? 'Workflow', href: definitionId ? `/workflows/${definitionId}` : undefined },
            { label: runCrumb },
          ]}
        />
      </div>

      {/* Header bar */}
      <RunHeaderBar
        run={runView}
        awaitingCount={awaitingCount}
        parallelCount={parallelCount}
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onOpenGraph={() => setGraphOpen((v) => !v)}
        graphOpen={graphOpen}
        pipelineOpen={pipelineOpen}
        onTogglePipeline={() => setPipelineOpen((v) => !v)}
      />

      {/* Collapsible inline DAG graph (below the header, above the 3-pane) */}
      {graphOpen && (
        <div className="h-[320px] shrink-0 border-b border-[var(--color-border)] bg-[var(--color-background)]">
          <ReactFlowProvider>
            <RuntimeDAGCanvas definitionEdges={definition?.edges} />
          </ReactFlowProvider>
        </div>
      )}

      {/* Horizontal pipeline flow — toggleable */}
      {pipelineOpen && (
        <PipelineFlow
          stages={runView.stages}
          focusedId={focusedStageId}
          onFocus={focusStage}
          className="shrink-0"
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
            {runView.stages.map((s, i) => (
              <StageTimelineItem
                key={s.id}
                stage={s}
                focused={focusedStageId === s.id}
                // A finished run keeps its last stage open: that is the result
                // the user came for, and collapsing it left the page blank.
                autoCollapse={runIsActive}
                openWhenFinished={i === runView.stages.length - 1}
                showConnector={i < runView.stages.length - 1}
                onFocus={selectStage}
                onApproveHitl={handleApproveHitl}
                onRejectHitl={handleRejectHitl}
                onTerminalRejectHitl={handleTerminalRejectHitl}
                onRetry={handleRetryStage}
                onWake={handleWakeStage}
                onSelectFiles={selectStage}
                onSelectOutput={selectStage}
                onOpenInspector={(id) => {
                  setFocusedStageId(id);
                  setRightPaneOpen(true);
                  // Ask RightPane to switch to the Inspector tab so the user
                  // actually sees the stage's Output / Files / Timeline. Without
                  // this, the pane stays on whatever tab was previously active
                  // (usually Changes) and clicking Details appears to do nothing.
                  setBrowserTabFocusRequest({ type: 'inspector', token: Date.now() });
                }}
              />
            ))}

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
            addableTabTypes={['files', 'inspector', 'browser', 'terminal', 'widget']}
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
                    // A run only accepts feedback while a stage is parked in
                    // `awaiting_input`; otherwise comments are recorded but
                    // there is nowhere to deliver them.
                    {...(runId && awaitingStageId
                      ? {
                          reviewTarget: {
                            kind: 'stage_followup' as const,
                            runId,
                            stageId: awaitingStageId,
                          },
                        }
                      : {
                          reviewDisabledReason:
                            'Comments are saved. Sending requires a stage awaiting input.',
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
              render: () => <RightInspector stage={focusedStageEnriched} runId={runId} />,
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

      {/* Run settings dialog removed — permission mode is always
          bypassPermissions and the per-stage `approvalRequired` flag drives
          the only HITL flow that remains. */}
    </div>
  );
}

/** Map a run workspace listing → generic FileChange rows so the inspector
 *  can show something useful when a stage doesn't ship its own manifest.
 *  Filters out generated / vendored noise (node_modules, .git, dist, build,
 *  stream logs) so the file list stays a curated view of what the run
 *  actually produced. */
function workspaceFilesFromRun(workspace: RunWorkspaceInfo | undefined): FileChange[] | undefined {
  if (!workspace) return undefined;
  const isNoise = (p: string) => {
    const norm = p.replace(/\\/g, '/');
    return (
      /(^|\/)node_modules\//.test(norm) ||
      /(^|\/)\.git\//.test(norm) ||
      /(^|\/)(dist|build|coverage|\.next|\.turbo|\.cache)\//.test(norm) ||
      // Legacy fabricated files from pre-fix runs — kept out of the file list
      // so they don't pollute the Inspector view.
      /(^|\/)extracted\//.test(norm) ||
      /stream-log\.jsonl$/.test(norm) ||
      /\.workspace\.json$/.test(norm)
    );
  };
  const seen = new Set<string>();
  const out: FileChange[] = [];
  for (const p of workspace.workspaceFiles ?? []) {
    if (seen.has(p) || isNoise(p)) continue;
    seen.add(p);
    out.push({ path: p, kind: 'added', source: 'workspace' });
  }
  for (const p of workspace.artifactFiles ?? []) {
    if (seen.has(p) || isNoise(p)) continue;
    seen.add(p);
    out.push({ path: p, kind: 'added', source: 'artifacts' });
  }
  // Sort by depth (shallow first) then alpha for a stable, readable listing.
  out.sort((a, b) => {
    const da = a.path.split(/[\\/]/).length;
    const db = b.path.split(/[\\/]/).length;
    if (da !== db) return da - db;
    return a.path.localeCompare(b.path);
  });
  return out.length > 0 ? out : undefined;
}

export default WorkflowRunPage;
