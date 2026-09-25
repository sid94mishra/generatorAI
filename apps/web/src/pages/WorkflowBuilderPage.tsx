// ────────────────────────────────────────────────────────────────
// WorkflowBuilderPage — Full workflow builder with DAG canvas,
// stage properties panel, toolbar, validation, save/run actions
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ReactFlowProvider } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Save,
  Play,
  Undo2,
  Redo2,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  ChevronRight,
  PanelRightClose,
  PanelRight,
  ArrowLeft,
  Download,
  Upload,
} from 'lucide-react';
import type { ValidationIssue, WorkflowDefinitionRecord, WorkflowGraph } from '@generatorai/workflow-spec';

import { DAGCanvas } from '@/components/workflow/DAGCanvas.js';
import { StagePropertiesPanel } from '@/components/workflow/StagePropertiesPanel.js';
import { WorkflowConfigPanel } from '@/components/workflow/WorkflowConfigPanel.js';
import { VariableInputModal } from '@/components/workflow/VariableInputModal.js';
import type { UploadedFileSet, LinkedCodebaseInfo } from '@/components/workflow/VariableInputModal.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import {
  useWorkflowDefinition,
  useCreateWorkflowDefinition,
  useSaveDefinitionGraph,
  usePublishDefinition,
  useCreateWorkflowRun,
  useStartWorkflowRun,
  useStartOrchestratedRun,
  useUploadRunFiles,
  workflowKeys,
} from '@/hooks/workflowQueries.js';
import { cn } from '@/lib/utils.js';
import { Badge, Button, Modal, Spinner } from '@/components/ui/index.js';
import { useResizable } from '@/hooks/useResizable.js';
import { useUnsavedWorkStore } from '@/stores/unsavedWorkStore.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { ApiError } from '@/platform/apiFetch.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';
import { exportFileName } from '@/utils/workflowExport.js';
import type { CreateWorkflowRunParams } from '@generatorai/shared';
import { encodeStageOverrides, needsOrchestratedStart, type StageOverrideDraft } from '@generatorai/client-core';

/**
 * What the Run button does for the current definition state:
 * - `test`: a draft (or an unsaved new workflow) runs only as a test run;
 * - `save-run`: a published workflow with unsaved edits is saved, published, then run (D-17);
 * - `publish-run`: saved but unpublished changes are published, then run;
 * - `run`: the published version runs as is.
 */
type RunMode = 'test' | 'save-run' | 'publish-run' | 'run';

const RUN_LABELS: Record<RunMode, string> = {
  test: 'Test run',
  'save-run': 'Save and run',
  'publish-run': 'Publish and run',
  run: 'Run',
};

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const platform = usePlatform();
  const isNew = !id;

  // ── Zustand store ──
  //
  // DISPLAY-only fields the page's own JSX reads are selected individually
  // (or via `useShallow` for grouped/derived values); everything the
  // save/run handlers need is read from a fresh `getState()` snapshot INSIDE
  // those handlers, so editing the canvas does not re-render this page just
  // because a future Save would need that data.
  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const isDirty = useWorkflowBuilderStore((s) => s.isDirty);
  const isSaving = useWorkflowBuilderStore((s) => s.isSaving);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const status = useWorkflowBuilderStore((s) => s.status);
  const hasUnpublishedChanges = useWorkflowBuilderStore((s) => s.hasUnpublishedChanges);
  const needsAttention = useWorkflowBuilderStore((s) => s.needsAttention);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
  const codebaseAliases = useWorkflowBuilderStore(useShallow((s) => s.workflow.lifecycle.codebaseAliases));
  const variables = useWorkflowBuilderStore((s) => s.workflow.variables);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const canUndo = useWorkflowBuilderStore((s) => s.canUndo());
  const canRedo = useWorkflowBuilderStore((s) => s.canRedo());
  // Only the stage keys and NAMES, shallow-compared — so dragging a node
  // (which only changes `position`) does not re-render the Run dialog.
  const stageKeys = useWorkflowBuilderStore(useShallow((s) => s.nodes.map((n) => n.id)));
  const stageNames = useWorkflowBuilderStore(useShallow((s) => s.nodes.map((n) => n.data.stage.name)));
  const stages = useMemo(
    () => stageKeys.map((key, i) => ({ key, name: stageNames[i] ?? key })),
    [stageKeys, stageNames],
  );
  // Actions are referentially stable for the store's lifetime, so grouping
  // them in one `useShallow` selector never itself causes a re-render.
  const actions = useWorkflowBuilderStore(
    useShallow((s) => ({
      resetBuilder: s.resetBuilder,
      addStage: s.addStage,
      selectNode: s.selectNode,
      setName: s.setName,
      undo: s.undo,
      redo: s.redo,
      validate: s.validate,
    })),
  );

  // ── Server queries ──
  const { data: definition, isLoading: isLoadingDef, error: definitionError, refetch: refetchDefinition } = useWorkflowDefinition(id);
  const createDefinition = useCreateWorkflowDefinition();
  const saveDefinition = useSaveDefinitionGraph();
  const publishDefinition = usePublishDefinition();
  const createRun = useCreateWorkflowRun();
  const startRun = useStartWorkflowRun();
  const startOrchestratedRun = useStartOrchestratedRun();
  const uploadRunFiles = useUploadRunFiles();

  // ── Local UI state ──
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(true);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [variableModalOpen, setVariableModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The issue banner appears once the user asked for validation (Validate,
  // Save, Run); inline node and field markers are live all the time.
  const [showIssues, setShowIssues] = useState(false);
  // A passing validation used to render nothing at all, so the button was
  // indistinguishable from a broken one.
  const [validateOk, setValidateOk] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  /** The record a save lost to (409): offered as "Reload theirs" or "Overwrite". */
  const [conflict, setConflict] = useState<WorkflowDefinitionRecord | null>(null);

  const runMode: RunMode =
    status !== 'published' ? 'test' : isDirty ? 'save-run' : hasUnpublishedChanges ? 'publish-run' : 'run';
  const errorIssues = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues]);

  // ── Project codebases (for auto-filling git variables in run dialog) ──
  const { data: projectCodebases } = useProjectCodebases(projectId ?? undefined);

  const linkedCodebases = useMemo((): LinkedCodebaseInfo[] | undefined => {
    if (!projectId || codebaseAliases.length === 0 || !projectCodebases) return undefined;
    return codebaseAliases
      .map((alias) => {
        const cb = projectCodebases.find((c) => c.alias === alias);
        if (!cb) return null;
        return { alias: cb.alias, url: cb.url ?? cb.localPath ?? '', branch: cb.defaultBranch ?? 'main' };
      })
      .filter((x): x is LinkedCodebaseInfo => x !== null);
  }, [projectId, codebaseAliases, projectCodebases]);

  // ── Resizable properties panel ──
  const { width: propertiesPanelWidth, isDragging: isResizingProps, handleProps: propsHandleProps } = useResizable({
    initialWidth: 320,
    minWidth: 280,
    maxWidth: 600,
    side: 'left',
  });

  // ── Load definition into builder store ──
  //
  // Reset whenever the URL names a different definition than the store holds
  // — navigating from workflow A to workflow B must never leave A's content
  // under B's URL, even when B fails to load. The first save of a new
  // workflow navigates to its own id; the store already holds it then, so
  // the canvas, selection and undo history survive.
  useEffect(() => {
    if (useWorkflowBuilderStore.getState().definitionId !== (id ?? null)) actions.resetBuilder();
  }, [id, actions]);

  // Query data is loaded on first arrival, and afterwards only when it is a
  // newer revision AND there is nothing local to lose: never while a save is
  // in flight or while there are unsaved edits (D-3). Our own saves write
  // the response into the cache with the revision the store already holds,
  // so they never reload the canvas either.
  useEffect(() => {
    if (!definition) return;
    const s = useWorkflowBuilderStore.getState();
    const load = () => {
      s.loadRecord(definition);
      // Mark what a loaded (e.g. migrated) definition needs fixing right away.
      useWorkflowBuilderStore.getState().validate();
    };
    if (s.definitionId !== definition.id) {
      load();
      return;
    }
    if (s.isSaving || s.isDirty) return;
    if (s.revision !== definition.revision) load();
  }, [definition]);

  // Live validation: re-run the spec validator shortly after any document
  // change, so nodes and fields show their issues inline (D-25).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useWorkflowBuilderStore.subscribe((s, prev) => {
      if (s.nodes === prev.nodes && s.edges === prev.edges && s.workflow === prev.workflow) return;
      clearTimeout(timer);
      timer = setTimeout(() => useWorkflowBuilderStore.getState().validate(), 300);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  usePageTitle(name || 'Untitled Workflow');

  // The shell's close/quit guard needs the same answer the route blocker gives.
  const setDirtyForShell = useUnsavedWorkStore((s) => s.setDirty);
  useEffect(() => {
    setDirtyForShell('workflow-builder', isDirty);
    return () => setDirtyForShell('workflow-builder', false);
  }, [isDirty, setDirtyForShell]);

  // ── Unsaved changes blocker ──
  // Read isDirty directly from Zustand getState() to avoid stale closure
  // values — the save handler updates the store and navigates in the same
  // tick, so the blocker callback must see the latest store state.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      useWorkflowBuilderStore.getState().isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowLeaveDialog(true);
    }
  }, [blocker]);

  // ── Add new stage ──
  const handleAddStage = useCallback(() => {
    const key = actions.addStage();
    actions.selectNode(key);
  }, [actions]);

  // ── Validate ──
  /** Validate the current graph; true when there is no error-severity issue. */
  const handleValidate = useCallback((announce = false) => {
    const found = actions.validate();
    const ok = !found.some((i) => i.severity === 'error');
    setShowIssues(!ok);
    if (announce) {
      setValidateOk(ok);
      if (ok) setTimeout(() => setValidateOk(false), 3000);
    }
    return ok;
  }, [actions]);

  const flashSaved = useCallback(() => {
    setSaveSuccess(true);
    setSaveError(null);
    setTimeout(() => setSaveSuccess(false), 3000);
  }, []);

  const showError = useCallback((message: string) => {
    setSaveError(message);
    setTimeout(() => setSaveError(null), 6000);
  }, []);

  // ── Save ──
  /**
   * Save the whole graph: `POST` for a workflow that does not exist yet,
   * then `PUT /:id/graph` with the revision the canvas was loaded from.
   * Resolves with the saved record, or null when nothing was saved (errors
   * are shown; a 409 opens the conflict dialog).
   */
  const saveGraph = useCallback(async (expectedRevision?: number): Promise<WorkflowDefinitionRecord | null> => {
    const store = useWorkflowBuilderStore.getState();
    if (!store.workflow.name.trim()) store.setName('Untitled Workflow');
    if (!handleValidate()) {
      showError('Fix the errors below before saving.');
      return null;
    }
    const graph: WorkflowGraph = useWorkflowBuilderStore.getState().toGraph();
    const existingId = store.definitionId;
    store.markSaving(true);
    try {
      const record = existingId
        ? await saveDefinition.mutateAsync({
            id: existingId,
            graph,
            expectedRevision: expectedRevision ?? store.revision ?? 1,
          })
        : await createDefinition.mutateAsync(graph);
      useWorkflowBuilderStore.getState().applySaved(record, graph);
      flashSaved();
      // The first save switches to update mode: the URL now names the new
      // definition, and the next save is a PUT rather than a second POST (D-5).
      if (!existingId) navigate(`/workflows/${record.id}/edit`, { replace: true });
      return record;
    } catch (err) {
      useWorkflowBuilderStore.getState().markSaving(false);
      const details = err instanceof ApiError
        ? (err.details as { current?: WorkflowDefinitionRecord; issues?: ValidationIssue[] } | undefined)
        : undefined;
      if (err instanceof ApiError && err.status === 409 && details?.current) {
        setConflict(details.current);
        return null;
      }
      if (err instanceof ApiError && err.status === 422 && details?.issues) {
        useWorkflowBuilderStore.getState().setIssues(details.issues, graph);
        setShowIssues(true);
      }
      showError(err instanceof Error ? err.message : 'Save failed');
      return null;
    }
  }, [handleValidate, saveDefinition, createDefinition, flashSaved, showError, navigate]);

  const handleSave = useCallback(() => {
    void saveGraph();
  }, [saveGraph]);

  /** Publish the saved graph (saving first when needed). Resolves with the published record. */
  const publish = useCallback(async (): Promise<WorkflowDefinitionRecord | null> => {
    const store = useWorkflowBuilderStore.getState();
    if (store.isDirty || !store.definitionId) {
      const saved = await saveGraph();
      if (!saved) return null;
    }
    const defId = useWorkflowBuilderStore.getState().definitionId;
    if (!defId) return null;
    setIsPublishing(true);
    try {
      const graph = useWorkflowBuilderStore.getState().toGraph();
      const record = await publishDefinition.mutateAsync(defId);
      useWorkflowBuilderStore.getState().applySaved(record, graph);
      return record;
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Publish failed');
      return null;
    } finally {
      setIsPublishing(false);
    }
  }, [saveGraph, publishDefinition, showError]);

  const handlePublish = useCallback(() => {
    void publish().then((record) => {
      if (record) flashSaved();
    });
  }, [publish, flashSaved]);

  // ── Conflict (409) ──
  const reloadTheirs = useCallback(() => {
    if (!conflict) return;
    queryClient.setQueryData(workflowKeys.definition(conflict.id), conflict);
    useWorkflowBuilderStore.getState().loadRecord(conflict);
    setConflict(null);
  }, [conflict, queryClient]);

  const overwrite = useCallback(() => {
    if (!conflict) return;
    const revision = conflict.revision;
    setConflict(null);
    void saveGraph(revision);
  }, [conflict, saveGraph]);

  // ── Export ──
  const handleExport = useCallback(async () => {
    const defId = useWorkflowBuilderStore.getState().definitionId;
    if (!defId) return;
    try {
      const text = await platform.exportDefinition(defId);
      await downloadBlobAsFile(new Blob([text], { type: 'application/json' }), exportFileName(name));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [platform, name, showError]);

  // ── Run workflow ──
  const handleRun = useCallback(() => {
    if (!handleValidate()) return;
    setVariableModalOpen(true);
  }, [handleValidate]);

  const executeRun = useCallback(
    async (
      runVariables: Record<string, unknown>,
      uploads?: UploadedFileSet,
      stageOverrides?: StageOverrideDraft[],
    ) => {
      setIsRunning(true);
      try {
        // Bring the server up to what the canvas shows before running it.
        const mode = runMode;
        if (mode === 'save-run' || mode === 'publish-run') {
          if (!(await publish())) return;
        } else {
          const current = useWorkflowBuilderStore.getState();
          if (current.isDirty || !current.definitionId) {
            if (!(await saveGraph())) return;
          }
        }
        // Fresh snapshot — the save above may have created the definition.
        const store = useWorkflowBuilderStore.getState();
        const defId = store.definitionId;
        if (!defId) return;
        const testRun = mode === 'test';
        const projectForRun = store.workflow.projectId ?? undefined;

        if (needsOrchestratedStart(store.workflow)) {
          const encoded = encodeStageOverrides(runVariables, stageOverrides, { orchestrated: true });
          const aliases = store.workflow.lifecycle.codebaseAliases;
          const context = await startOrchestratedRun.mutateAsync({
            workflowDefinitionId: defId,
            ...encoded,
            uploads,
            projectId: projectForRun,
            selectedCodebases: aliases.length > 0 ? aliases : undefined,
            ...(testRun ? { testRun: true } : {}),
          });
          setVariableModalOpen(false);
          navigate(`/workflows/${defId}/runs/${context.workflowRunId}`);
        } else {
          const params: CreateWorkflowRunParams = {
            workflowDefinitionId: defId,
            variables: encodeStageOverrides(runVariables, stageOverrides, { orchestrated: false }).variables,
            ...(testRun ? { testRun: true } : {}),
          };
          const run = await createRun.mutateAsync(params);
          if (uploads) {
            for (const category of ['prompts', 'skills', 'agents'] as const) {
              if (uploads[category].length > 0) {
                await uploadRunFiles.mutateAsync({ runId: run.id, category, files: uploads[category] });
              }
            }
          }
          await startRun.mutateAsync(run.id);
          setVariableModalOpen(false);
          navigate(`/workflows/${defId}/runs/${run.id}`);
        }
      } catch (err) {
        showError(err instanceof Error ? `Run failed: ${err.message}` : 'Run failed');
      } finally {
        setIsRunning(false);
      }
    },
    [runMode, publish, saveGraph, createRun, startRun, startOrchestratedRun, uploadRunFiles, navigate, showError],
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // ── Loading state ──
  if (!isNew && isLoadingDef) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  // ── Error state ──
  // Previously a failed load fell straight through to the editor below —
  // `useWorkflowDefinition` only destructured `{ data, isLoading }`, so the
  // canvas rendered fully editable with nothing loaded into it. The
  // reset-on-every-id-change effect above already cleared whatever the PREVIOUS
  // workflow left behind, so what would otherwise show is an empty, saveable
  // canvas that silently overwrites the workflow the user meant to open.
  if (!isNew && definitionError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm font-medium text-foreground">Failed to load this workflow.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {definitionError instanceof Error ? definitionError.message : 'The workflow definition could not be loaded.'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void refetchDefinition()}>
            Retry
          </Button>
          <Button variant="ghost" onClick={() => navigate('/workflows')}>
            Back to workflows
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        open={showLeaveDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowLeaveDialog(false);
            blocker.reset?.();
          }
        }}
        title="Unsaved Changes"
        description="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        variant="warning"
        onConfirm={() => {
          setShowLeaveDialog(false);
          blocker.proceed?.();
        }}
      />

      {/* Revision conflict (409): someone saved this workflow after it was loaded here */}
      <Modal
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title="This workflow changed elsewhere"
        description={
          conflict
            ? `It was saved again (revision ${conflict.revision}, ${new Date(conflict.updatedAt).toLocaleString()}) after you opened it.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(null)}>Cancel</Button>
            <Button variant="secondary" onClick={reloadTheirs}>Reload theirs</Button>
            <Button variant="danger" onClick={overwrite}>Overwrite</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Reload theirs</strong> discards your unsaved edits and loads the saved
          version. <strong className="text-foreground">Overwrite</strong> replaces it with what you see here.
        </p>
      </Modal>

      {/* ── Toolbar ── */}
      <div className="bg-background border-b border-border flex flex-wrap items-center justify-between gap-y-1 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(definitionId ? `/workflows/${definitionId}` : '/workflows')}
            aria-label="Back to workflow list"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="h-5 w-px bg-border" />

          {/* Workflow name inline */}
          <input
            type="text"
            value={name}
            onChange={(e) => actions.setName(e.target.value)}
            placeholder="Untitled Workflow"
            aria-label="Workflow name"
            className="bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground border-b border-transparent focus:border-primary transition-colors duration-200 max-w-[300px]"
          />

          {status && (
            <Badge
              tone={status === 'published' ? 'success' : 'warning'}
              size="sm"
              title={
                status === 'published'
                  ? hasUnpublishedChanges
                    ? 'Runs use the published version; saved changes are not published yet'
                    : 'Runs use this version'
                  : 'A draft runs only as a test run'
              }
            >
              {status === 'published' ? (hasUnpublishedChanges ? 'Published · changes' : 'Published') : 'Draft'}
            </Badge>
          )}

          {isDirty && (
            <span className="text-xs text-muted-foreground">(unsaved)</span>
          )}
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {validateOk && (
            <span role="status" className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Workflow is valid
            </span>
          )}
          {saveError && (
            <span role="alert" className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> {saveError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Undo/Redo */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.undo()}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.redo()}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="h-4 w-4" />
          </Button>

          <div className="h-5 w-px bg-border" />

          {/* Config */}
          <Button
            variant="ghost"
            onClick={() => setConfigPanelOpen(true)}
            title="Workflow settings"
            leftIcon={<Settings2 className="h-4 w-4" />}
          >
            Settings
          </Button>

          {/* Validate */}
          <Button
            variant="ghost"
            onClick={() => handleValidate(true)}
            title="Validate the workflow"
            leftIcon={<AlertTriangle className="h-4 w-4" />}
          >
            Validate
          </Button>

          {/* Export — the canonical document of the SAVED graph */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleExport()}
            disabled={!definitionId}
            title={isDirty ? 'Export the saved version (unsaved edits are not included)' : 'Export as JSON'}
            aria-label="Export workflow"
          >
            <Download className="h-4 w-4" />
          </Button>

          <div className="h-5 w-px bg-border" />

          {/* Toggle properties panel */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPropertiesPanelOpen((p) => !p)}
            title={propertiesPanelOpen ? 'Hide properties' : 'Show properties'}
          >
            {propertiesPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
          </Button>

          <div className="h-5 w-px bg-border" />

          {/* Save — also disabled while an existing workflow's definition
              has not finished loading yet, so a race between the reset and
              the fetch can never save a blank canvas over real content. */}
          <Button
            variant="secondary"
            onClick={handleSave}
            disabled={isSaving || (!isNew && !definition)}
            loading={isSaving}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Save
          </Button>

          {/* Publish — makes the saved graph the version runs use */}
          <Button
            variant="secondary"
            onClick={handlePublish}
            disabled={isSaving || isPublishing || (!isNew && !definition) || (status === 'published' && !isDirty && !hasUnpublishedChanges)}
            loading={isPublishing}
            leftIcon={<Upload className="h-4 w-4" />}
            title="Publish: runs use the published version"
          >
            Publish
          </Button>

          {/* Run — a draft runs as a test run; a dirty published workflow saves, publishes and runs */}
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={isRunning || isSaving || (!isNew && !definition)}
            loading={isRunning}
            leftIcon={<Play className="h-4 w-4" />}
          >
            {RUN_LABELS[runMode]}
          </Button>
        </div>
      </div>

      {/* ── Migration notes: left on the definition by the upgrade, cleared by the next save ── */}
      {needsAttention.length > 0 && (
        <div className="border-b border-info/30 bg-info-muted px-4 py-2 text-sm text-info">
          <ul className="space-y-0.5">
            {needsAttention.map((note, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Validation Errors Banner ── */}
      {showIssues && errorIssues.length > 0 && (
        <div className="border-b border-warning/30 bg-warning-muted px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-sm">
              <span className="font-medium text-warning">
                {errorIssues.length} validation {errorIssues.length === 1 ? 'error' : 'errors'}
              </span>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-warning">
                {errorIssues.map((issue, i) => {
                  const stageName = issue.stageKey ? stages.find((s) => s.key === issue.stageKey)?.name : undefined;
                  return (
                    <li key={i} className="flex items-center gap-1.5">
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      {issue.stageKey ? (
                        <Button
                          variant="unstyled"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => {
                            actions.selectNode(issue.stageKey!);
                            setPropertiesPanelOpen(true);
                          }}
                        >
                          {stageName ?? issue.stageKey}: {issue.message}
                        </Button>
                      ) : (
                        <span>{issue.message}</span>
                      )}
                      {issue.hint && <span className="text-xs opacity-80">— {issue.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* DAG Canvas */}
        <div className="flex-1">
          <ReactFlowProvider>
            <DAGCanvas onAddStage={handleAddStage} />
          </ReactFlowProvider>
        </div>

        {/* Properties Panel — resizable with drag handle */}
        <div
          className={cn(
            'shrink-0 flex',
            'overflow-hidden',
            'transition-[width,opacity] ease-[cubic-bezier(0.16,1,0.3,1)]',
            isResizingProps ? 'duration-0' : 'duration-300',
            propertiesPanelOpen
              ? 'opacity-100'
              : 'w-0 opacity-0 pointer-events-none',
            // Mobile: full overlay
            'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50',
            propertiesPanelOpen && 'max-md:w-full max-md:max-w-sm',
          )}
          style={propertiesPanelOpen ? { width: `${propertiesPanelWidth}px` } : undefined}
        >
          {/* Drag handle */}
          <div
            {...propsHandleProps}
            className={cn(
              'w-1.5 shrink-0 bg-transparent hover:bg-primary/30 transition-colors relative group',
              isResizingProps && 'bg-primary/40',
            )}
          >
            <div className={cn(
              'absolute inset-y-0 -left-1 -right-1',
              'group-hover:bg-primary/10',
              isResizingProps && 'bg-primary/10',
            )} />
            {/* Grip dots */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-60 transition-opacity">
              <div className="w-1 h-1 rounded-full bg-muted-foreground" />
              <div className="w-1 h-1 rounded-full bg-muted-foreground" />
              <div className="w-1 h-1 rounded-full bg-muted-foreground" />
            </div>
          </div>
          <div
            className={cn(
              'flex-1 min-w-0 border-l border-border',
              'bg-card',
              'shadow-[-2px_0_8px_rgba(0,0,0,0.04)]',
            )}
          >
            <div className="h-full">
              <StagePropertiesPanel onClose={() => setPropertiesPanelOpen(false)} />
            </div>
          </div>
        </div>

        {/* Mobile backdrop */}
        {propertiesPanelOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setPropertiesPanelOpen(false)}
            role="presentation"
            aria-hidden="true"
          />
        )}
      </div>

      {/* ── Modals ── */}
      <WorkflowConfigPanel open={configPanelOpen} onClose={() => setConfigPanelOpen(false)} />

      <VariableInputModal
        open={variableModalOpen}
        onClose={() => setVariableModalOpen(false)}
        onSubmit={executeRun}
        variables={variables}
        workflowName={name || 'Untitled Workflow'}
        isSubmitting={isRunning}
        linkedCodebases={linkedCodebases}
        stages={stages}
        submitLabel={RUN_LABELS[runMode]}
      />
    </div>
  );
}

export default WorkflowBuilderPage;
