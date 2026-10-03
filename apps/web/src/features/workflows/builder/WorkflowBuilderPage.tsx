// ────────────────────────────────────────────────────────────────
// WorkflowBuilderPage — /workflows/:id/edit on L-04
// CanvasEditor (WorkflowBuilder, WorkflowStage*, WorkflowSettingsPanel,
// WorkflowValidate, WorkflowLoopBuilder, WorkflowAgentDraft boards).
//
//   header     BuilderHeader (name, version state, undo/redo/history,
//              Save/Validate/Publish/Run, More, inspector toggle)
//   banner     the agent-draft banner and the migration notes
//   canvas     BuilderCanvas (@xyflow, restyled on tokens)
//   problems   the problems panel (WF-03), after Validate or a failed save
//   inspector  version history (WF-10) when open, else BuilderInspector:
//              the selected stage / edge, or the workflow's settings
//
// Document logic lives in useBuilderDocument. The route forces the rail
// (06 §2.5) and blocks leaving with unsaved changes — except for an overlay
// navigation (Settings opened over the builder, D-26/D-75).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { ReactFlowProvider } from '@xyflow/react';
import type { InvocationResult, StageKind, WorkflowDefinitionVersionSummary, WorkflowGraph } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { isOverlayNavigation } from '@/lib/overlayNavigation.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { RunDialog, VersionChip } from '@/blocks/workflow/index.js';
import { CanvasEditor } from '@/ui/templates/CanvasEditor/CanvasEditor.js';
import { AlertDialog, useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { BuilderHeader } from './BuilderHeader.js';
import { BuilderCanvas } from './canvas/BuilderCanvas.js';
import { AgentDraftBanner, useDraftNodeTags } from './draft/AgentDraftBanner.js';
import { VersionHistoryInspector } from './history/VersionHistoryInspector.js';
import { BuilderInspector } from './inspector/BuilderInspector.js';
import { BuilderInspectorContext, type BuilderInspectorApi, type SettingsTab } from './inspector/InspectorShell.js';
import { BuilderProblems } from './problems/BuilderProblems.js';
import { useBuilderDocument, RUN_LABELS } from './useBuilderDocument.js';
import { formatWhen } from '@/lib/formatWhen.js';

export function WorkflowBuilderPage() {
  // New workflow creates the draft on the server first, so the builder always edits a saved definition.
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const doc = useBuilderDocument(id);
  const { definition } = doc;

  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const needsAttention = useWorkflowBuilderStore((s) => s.needsAttention);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
  const codebaseAliases = useWorkflowBuilderStore(useShallow((s) => s.workflow.lifecycle.codebaseAliases));
  const lifecycleUseWorktree = useWorkflowBuilderStore((s) => s.workflow.lifecycle.useWorktree);
  const variables = useWorkflowBuilderStore((s) => s.workflow.variables);
  // Only the stage keys and NAMES, shallow-compared — dragging a node (which
  // only changes `position`) does not re-render the Run dialog.
  const stageKeys = useWorkflowBuilderStore(useShallow((s) => s.nodes.map((n) => n.id)));
  const stageNames = useWorkflowBuilderStore(useShallow((s) => s.nodes.map((n) => n.data.stage.name)));
  const stages = useMemo(() => stageKeys.map((key, i) => ({ key, name: stageNames[i] ?? key })), [stageKeys, stageNames]);
  const runLifecycle = useMemo(() => ({ codebaseAliases, useWorktree: lifecycleUseWorktree }), [codebaseAliases, lifecycleUseWorktree]);

  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const { confirm: askConfirm, dialog: confirmDialog } = useConfirm();

  usePageTitle(name || 'Untitled Workflow');

  // Selecting a stage or an edge shows the inspector (and leaves history).
  useEffect(
    () =>
      useWorkflowBuilderStore.subscribe((s, prev) => {
        if ((s.selectedNodeId && s.selectedNodeId !== prev.selectedNodeId) || (s.selectedEdgeId && s.selectedEdgeId !== prev.selectedEdgeId)) {
          setInspectorOpen(true);
          setHistoryOpen(false);
        }
      }),
    [],
  );

  // ── Unsaved changes blocker ──
  // Reads isDirty from getState(): the save handler updates the store and
  // navigates in the same tick. Settings opened over the builder keeps it
  // mounted, so that is not a navigation away (D-26).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      useWorkflowBuilderStore.getState().isDirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      !isOverlayNavigation(currentLocation, nextLocation),
  );
  useEffect(() => {
    if (blocker.state === 'blocked') setLeaveOpen(true);
  }, [blocker]);

  // ── Ctrl/Cmd+S saves (also while typing: it is the editor's save) ──
  const { save } = doc;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  // ── Inspector API for the panels ──
  const openSettings = useCallback((tab?: SettingsTab) => {
    const store = useWorkflowBuilderStore.getState();
    store.selectNode(null);
    store.selectEdge(null);
    if (tab) setSettingsTab(tab);
    setHistoryOpen(false);
    setInspectorOpen(true);
  }, []);
  const inspectorApi = useMemo<BuilderInspectorApi>(() => ({ close: () => setInspectorOpen(false), openSettings }), [openSettings]);

  // ── Stages ──
  const handleAddStage = useCallback((kind?: StageKind) => {
    const store = useWorkflowBuilderStore.getState();
    const key = store.addStage(undefined, { kind });
    store.selectNode(key);
  }, []);
  const handleAddedTemplate = useCallback((key: string) => {
    useWorkflowBuilderStore.getState().selectNode(key);
    setInspectorOpen(true);
  }, []);

  // ── Version history: restore a version as the draft ──
  const handleRestoreVersion = useCallback(
    (graph: WorkflowGraph, version: WorkflowDefinitionVersionSummary) => {
      const restore = () => {
        useWorkflowBuilderStore.getState().replaceGraph(graph);
        setHistoryOpen(false);
      };
      if (!useWorkflowBuilderStore.getState().isDirty) {
        restore();
        return;
      }
      void askConfirm({
        title: `Restore version ${version.version}?`,
        description:
          'It replaces what the editor holds now, unsaved changes included. Undo brings the stages back; save to keep the restored version.',
        confirmLabel: 'Restore',
        tone: 'danger',
      }).then((ok) => {
        if (ok) restore();
      });
    },
    [askConfirm],
  );

  // ── Run ──
  const { validate } = doc;
  const handleRun = useCallback(() => {
    if (!validate()) return;
    setRunDialogOpen(true);
  }, [validate]);
  const handleRunStarted = useCallback(
    (result: InvocationResult) => {
      setRunDialogOpen(false);
      navigate(`/workflows/${result.workflowDefinitionId}/runs/${result.runId}`);
    },
    [navigate],
  );

  // ── Agent draft: nodes it adds or changes against the workflow it replaces ──
  const isAgentDraft = !!definition?.authoredBy && definition.id === definitionId;
  const nodeTags = useDraftNodeTags(isAgentDraft ? definition : undefined);

  // ── Loading / failed load ──
  if (doc.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={16} label="Loading workflow" />
      </div>
    );
  }
  // A failed load never falls through to an editable, saveable empty canvas.
  if (doc.loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          tone="error"
          icon="warning"
          title="Failed to load this workflow."
          description={doc.loadError instanceof Error ? doc.loadError.message : 'The workflow definition could not be loaded.'}
          action={
            <div className="flex items-center gap-2">
              <Button onClick={doc.refetch}>Retry</Button>
              <Button variant="ghost" onClick={() => navigate('/workflows')}>
                Back to workflows
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const banner =
    isAgentDraft || needsAttention.length > 0 ? (
      <div className="flex flex-col gap-2">
        {isAgentDraft && definition ? (
          <AgentDraftBanner record={definition} graph={definition.graph} onPublish={doc.publish} publishing={doc.isPublishing} />
        ) : null}
        {needsAttention.length > 0 ? (
          <Callout tone="info" title="This workflow was upgraded">
            <ul className="flex flex-col gap-0.5">
              {needsAttention.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </div>
    ) : undefined;

  return (
    <BuilderInspectorContext.Provider value={inspectorApi}>
      <ReactFlowProvider>
        <CanvasEditor
          data-testid="workflow-builder"
          header={
            <BuilderHeader
              loading={!definition}
              isAgentDraft={isAgentDraft}
              runMode={doc.runMode}
              isPublishing={doc.isPublishing}
              saveSuccess={doc.saveSuccess}
              saveError={doc.saveError}
              validateOk={doc.validateOk}
              historyOpen={historyOpen}
              inspectorOpen={inspectorOpen && !historyOpen}
              onSave={doc.save}
              onValidate={() => doc.validate(true)}
              onPublish={doc.publish}
              onRun={handleRun}
              onExport={doc.exportJson}
              onOpenSettings={() => openSettings()}
              onToggleHistory={() => setHistoryOpen((o) => !o)}
              onToggleInspector={() => {
                if (historyOpen) {
                  setHistoryOpen(false);
                  setInspectorOpen(true);
                } else setInspectorOpen((o) => !o);
              }}
            />
          }
          banner={banner}
          canvas={
            <BuilderCanvas
              onAddStage={handleAddStage}
              onAddedTemplate={handleAddedTemplate}
              nodeTags={nodeTags}
            />
          }
          problems={
            doc.problemsOpen ? (
              <BuilderProblems checkedAt={doc.checkedAt ?? undefined} onCheckAgain={() => doc.validate(true)} onClose={() => doc.setProblemsOpen(false)} />
            ) : undefined
          }
          inspector={
            historyOpen && definitionId ? (
              <VersionHistoryInspector
                definitionId={definitionId}
                currentGraph={() => useWorkflowBuilderStore.getState().toGraph()}
                onRestore={handleRestoreVersion}
                onClose={() => setHistoryOpen(false)}
              />
            ) : inspectorOpen ? (
              <BuilderInspector settingsTab={settingsTab} onSettingsTabChange={setSettingsTab} />
            ) : undefined
          }
        />
      </ReactFlowProvider>

      <AlertDialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (!open) {
            setLeaveOpen(false);
            if (blocker.state === 'blocked') blocker.reset();
          }
        }}
        title="Unsaved changes"
        description="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        tone="danger"
        onConfirm={() => {
          setLeaveOpen(false);
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />

      {/* Revision conflict (409): someone saved this workflow after it was loaded here */}
      <Dialog
        open={doc.conflict !== null}
        onOpenChange={(open) => {
          if (!open) doc.dismissConflict();
        }}
        size="sm"
        title="This workflow changed elsewhere"
      >
        <DialogBody>
          <p className="text-ui text-fg-2">
            {doc.conflict
              ? `It was saved again (revision ${doc.conflict.revision}, ${formatWhen(doc.conflict.updatedAt)}) after you opened it. `
              : null}
            <strong className="text-fg">Reload theirs</strong> discards your unsaved edits and loads the saved version.{' '}
            <strong className="text-fg">Overwrite</strong> replaces it with what you see here.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={doc.dismissConflict}>
            Cancel
          </Button>
          <Button onClick={doc.reloadTheirs}>Reload theirs</Button>
          <Button variant="danger" onClick={doc.overwrite}>
            Overwrite
          </Button>
        </DialogFooter>
      </Dialog>

      {confirmDialog}

      <RunDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        workflowName={name || 'Untitled Workflow'}
        badge={<VersionChip status={doc.runMode === 'test' ? 'draft' : 'published'} />}
        variables={variables}
        stages={stages}
        projectId={projectId}
        lifecycle={runLifecycle}
        target={doc.runTarget}
        submitLabel={RUN_LABELS[doc.runMode]}
        {...(doc.testRunTarget ? { testRunTarget: doc.testRunTarget } : {})}
        prepareTarget={doc.prepareRunTarget}
        hint={
          doc.runMode === 'test'
            ? 'A draft runs its working graph as a test run.'
            : doc.runMode === 'run'
              ? 'Runs use the published version.'
              : 'Run saves and publishes your changes first. Test run runs the working graph without publishing.'
        }
        onStarted={handleRunStarted}
      />
    </BuilderInspectorContext.Provider>
  );
}

export default WorkflowBuilderPage;
