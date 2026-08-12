// ────────────────────────────────────────────────────────────────
// WorkflowBuilderPage — Full workflow builder with DAG canvas,
// stage properties panel, toolbar, validation, save/run actions
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Save,
  Play,
  Undo2,
  Redo2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Settings2,
  ChevronRight,
  PanelRightClose,
  PanelRight,
  ArrowLeft,
} from 'lucide-react';

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
  useUpdateWorkflowDefinition,
  useAddStage,
  useUpdateStage,
  useDeleteStage,
  useAddEdge,
  useDeleteEdge,
  useCreateWorkflowRun,
  useStartWorkflowRun,
  useStartOrchestratedRun,
  useUploadRunFiles,
} from '@/hooks/workflowQueries.js';
import { cn } from '@/lib/utils.js';
import { Button, Spinner } from '@/components/ui/index.js';
import { useResizable } from '@/hooks/useResizable.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import type { StageDefinition, VariableDefinition, CreateWorkflowRunParams, GitRepositoryConfig } from '@generatorai/shared';

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  // ── Zustand store ──
  const store = useWorkflowBuilderStore();

  // ── Server queries ──
  const { data: definition, isLoading: isLoadingDef } = useWorkflowDefinition(id);
  const createDefinition = useCreateWorkflowDefinition();
  const updateDefinition = useUpdateWorkflowDefinition();
  const addStageMutation = useAddStage();
  const updateStageMutation = useUpdateStage();
  const deleteStageMutation = useDeleteStage();
  const addEdgeMutation = useAddEdge();
  const deleteEdgeMutation = useDeleteEdge();
  const createRun = useCreateWorkflowRun();
  const startRun = useStartWorkflowRun();
  const startOrchestratedRun = useStartOrchestratedRun();
  const uploadRunFiles = useUploadRunFiles();

  // ── Local UI state ──
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(true);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [variableModalOpen, setVariableModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  // ── Project codebases (for auto-filling git variables in run dialog) ──
  const { data: projectCodebases } = useProjectCodebases(store.projectId ?? undefined);

  const linkedCodebases = useMemo((): LinkedCodebaseInfo[] | undefined => {
    if (!store.projectId || store.selectedCodebases.length === 0 || !projectCodebases) return undefined;
    return store.selectedCodebases
      .map((alias) => {
        const cb = projectCodebases.find((c) => c.alias === alias);
        if (!cb) return null;
        return { alias: cb.alias, url: cb.url ?? cb.localPath ?? '', branch: cb.defaultBranch ?? 'main' };
      })
      .filter((x): x is LinkedCodebaseInfo => x !== null);
  }, [store.projectId, store.selectedCodebases, projectCodebases]);

  // ── Resizable properties panel ──
  const { width: propertiesPanelWidth, isDragging: isResizingProps, handleProps: propsHandleProps } = useResizable({
    initialWidth: 320,
    minWidth: 280,
    maxWidth: 600,
    side: 'left',
  });

  // ── Load definition into builder store ──
  useEffect(() => {
    if (definition) {
      store.loadDefinition(definition);
    } else if (isNew) {
      store.resetBuilder();
    }
  }, [definition, isNew]);

  // ── Unsaved changes blocker ──
  // Read isDirty directly from Zustand getState() to avoid stale closure
  // values — the save handler calls markSaved() + navigate() in the same
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
    const stageId = `stage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newStage: StageDefinition = {
      id: stageId,
      workflowDefinitionId: store.definitionId ?? '',
      name: `Stage ${store.nodes.length + 1}`,
      order: store.nodes.length,
      prompts: [],
      variables: {},
      hooks: [],
      createdAt: new Date(),
    };
    store.addStage(newStage);
    store.selectNode(stageId);
  }, [store]);

  // ── Validate ──
  const handleValidate = useCallback(() => {
    const errors = store.validate();
    if (errors.length === 0) {
      setSaveSuccess(false);
    }
    return errors;
  }, [store]);

  // ── Save ──
  const buildOrchestratorConfig = useCallback(() => {
    const hasCodebases = store.selectedCodebases.length > 0;
    const hasGitRepos = store.gitRepositories.length > 0;
    if (!hasCodebases && !hasGitRepos) return undefined;
    return {
      category: 'custom' as const,
      gitRepositories: store.gitRepositories,
      // No preprocessingSteps needed — worktree creation is handled by the orchestrator
      // when projectId + selectedCodebases are present
      preprocessingSteps: [] as Array<{ type: 'clone_repo'; name: string; config: { type: 'clone_repo'; repoAlias: string }; failOnError: boolean; order: number }>,
      postProcessingSteps: [],
      resultValidations: [],
      requiresCodebase: true,
      autoCommit: store.autoCommit,
      autoCreatePR: store.autoCreatePR,
    };
  }, [store.selectedCodebases, store.gitRepositories, store.autoCommit, store.autoCreatePR]);

  const handleSave = useCallback(async () => {
    const errors = handleValidate();
    if (errors.length > 0) return;

    store.markSaving(true);
    try {
      if (isNew || !store.definitionId) {
        // Create new definition
        const created = await createDefinition.mutateAsync({
          name: store.name || 'Untitled Workflow',
          description: store.description || undefined,
          sessionMode: store.sessionMode,
          harnessConfig: store.harnessConfig,
          variables: store.variables,
          tags: store.tags,
          projectId: store.projectId ?? undefined,
          orchestratorConfig: buildOrchestratorConfig(),
          // Workflow-level hooks must be sent on create too — otherwise hooks
          // configured in the builder before the first save are silently
          // dropped (they only persisted via the later update path).
          hooks: store.hooks.length > 0 ? store.hooks : undefined,
        });

        store.setDefinitionId(created.id);

        // Persist stages — track local→server ID mapping for edges
        const localToServerId = new Map<string, string>();
        for (const node of store.nodes) {
          const stage = node.data.stage;
          const serverStage = await addStageMutation.mutateAsync({
            definitionId: created.id,
            params: {
              name: stage.name,
              description: stage.description,
              templateId: stage.templateId,
              order: stage.order,
              prompts: stage.prompts,
              harnessConfigOverrides: stage.harnessConfigOverrides,
              agentRef: stage.agentRef ?? null,
              variables: stage.variables,
              hooks: stage.hooks,
              retryPolicy: stage.retryPolicy,
              timeoutMs: stage.timeoutMs,
              condition: stage.condition,
            },
          });
          localToServerId.set(node.id, serverStage.id);
        }

        // Persist edges — remap local stage IDs to server-generated IDs
        for (const edge of store.edges) {
          if (edge.data) {
            const fromId = localToServerId.get(edge.source) ?? edge.source;
            const toId = localToServerId.get(edge.target) ?? edge.target;
            await addEdgeMutation.mutateAsync({
              definitionId: created.id,
              params: {
                fromStageId: fromId,
                toStageId: toId,
                edgeType: edge.data.edgeType,
              },
            });
          }
        }

        store.markSaved();
        setSaveSuccess(true);
        setSaveError(null);
        setTimeout(() => setSaveSuccess(false), 3000);
        navigate(`/workflows/${created.id}/edit`, { replace: true });
      } else {
        // Update existing definition — metadata + diff stages & edges
        await updateDefinition.mutateAsync({
          id: store.definitionId,
          params: {
            name: store.name,
            description: store.description || undefined,
            sessionMode: store.sessionMode,
            harnessConfig: store.harnessConfig,
            variables: store.variables,
            tags: store.tags,
            projectId: store.projectId ?? undefined,
            orchestratorConfig: buildOrchestratorConfig(),
            hooks: store.hooks.length > 0 ? store.hooks : undefined,
          },
        });

        // Diff stages & edges against server state
        if (definition) {
          const serverStageIds = new Set(definition.stages.map((s) => s.id));
          const localStageIds = new Set(store.nodes.map((n) => n.id));

          // Delete removed stages
          for (const sid of serverStageIds) {
            if (!localStageIds.has(sid)) {
              await deleteStageMutation.mutateAsync({ definitionId: store.definitionId!, stageId: sid });
            }
          }

          // Add new stages / update existing
          for (const node of store.nodes) {
            const stage = node.data.stage;
            const stageParams = {
              name: stage.name,
              description: stage.description,
              templateId: stage.templateId,
              order: stage.order,
              prompts: stage.prompts,
              harnessConfigOverrides: stage.harnessConfigOverrides,
              // Nullable, not optional: clearing the picker must actually
              // unbind the agent rather than leave the previous ref in place.
              agentRef: stage.agentRef ?? null,
              variables: stage.variables,
              hooks: stage.hooks,
              retryPolicy: stage.retryPolicy,
              timeoutMs: stage.timeoutMs,
              condition: stage.condition,
              resultValidation: stage.resultValidation,
              contextFilter: stage.contextFilter,
            };
            if (serverStageIds.has(node.id)) {
              await updateStageMutation.mutateAsync({
                definitionId: store.definitionId!,
                stageId: node.id,
                params: stageParams,
              });
            } else {
              await addStageMutation.mutateAsync({
                definitionId: store.definitionId!,
                params: stageParams,
              });
            }
          }

          // Diff edges
          const serverEdgeIds = new Set(definition.edges.map((e) => e.id));
          const localEdgeIds = new Set(store.edges.map((e) => e.id));

          // Delete removed edges
          for (const eid of serverEdgeIds) {
            if (!localEdgeIds.has(eid)) {
              await deleteEdgeMutation.mutateAsync({ definitionId: store.definitionId!, edgeId: eid });
            }
          }

          // Add new edges
          for (const edge of store.edges) {
            if (!serverEdgeIds.has(edge.id) && edge.data) {
              await addEdgeMutation.mutateAsync({
                definitionId: store.definitionId!,
                params: {
                  fromStageId: edge.source,
                  toStageId: edge.target,
                  edgeType: edge.data.edgeType,
                },
              });
            }
          }
        }

        store.markSaved();
        setSaveSuccess(true);
        setSaveError(null);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Save failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setTimeout(() => setSaveError(null), 5000);
      store.markSaving(false);
    }
  }, [
    handleValidate,
    isNew,
    store,
    definition,
    createDefinition,
    updateDefinition,
    addStageMutation,
    updateStageMutation,
    deleteStageMutation,
    addEdgeMutation,
    deleteEdgeMutation,
    buildOrchestratorConfig,
    navigate,
  ]);

  // ── Run workflow ──
  const handleRun = useCallback(() => {
    const errors = handleValidate();
    if (errors.length > 0) return;

    if (!store.definitionId) {
      setSaveError('Please save the workflow before running it.');
      return;
    }

    setVariableModalOpen(true);
  }, [handleValidate, store.definitionId]);

  const executeRun = useCallback(
    async (variables: Record<string, unknown>, uploads?: UploadedFileSet) => {
      if (!store.definitionId) return;
      setIsRunning(true);

      const isOrchestrated = !!store.projectId || store.gitRepositories.length > 0;

      // Helper to upload files for each category
      const uploadAllFiles = async (runId: string) => {
        if (!uploads) return;
        for (const category of ['prompts', 'skills', 'agents'] as const) {
          if (uploads[category].length > 0) {
            await uploadRunFiles.mutateAsync({ runId, category, files: uploads[category] });
          }
        }
      };

      try {
        if (isOrchestrated) {
          const context = await startOrchestratedRun.mutateAsync({
            workflowDefinitionId: store.definitionId,
            variables,
            projectId: store.projectId ?? undefined,
            selectedCodebases: store.selectedCodebases.length > 0 ? store.selectedCodebases : undefined,
          });

          await uploadAllFiles(context.workflowRunId);

          setVariableModalOpen(false);
          navigate(`/workflows/${store.definitionId}/runs/${context.workflowRunId}`);
        } else {
          const params: CreateWorkflowRunParams = {
            workflowDefinitionId: store.definitionId,
            variables,
          };
          const run = await createRun.mutateAsync(params);

          await uploadAllFiles(run.id);

          await startRun.mutateAsync(run.id);
          setVariableModalOpen(false);
          navigate(`/workflows/${store.definitionId}`);
        }
      } catch (err) {
        console.error('Run failed:', err);
      } finally {
        setIsRunning(false);
      }
    },
    [store.definitionId, store.projectId, store.selectedCodebases, store.gitRepositories, createRun, startRun, startOrchestratedRun, uploadRunFiles, navigate],
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

      {/* ── Toolbar ── */}
      <div className="bg-background border-b border-border flex flex-wrap items-center justify-between gap-y-1 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(store.definitionId ? `/workflows/${store.definitionId}` : '/workflows')}
            aria-label="Back to workflow list"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="h-5 w-px bg-border" />

          {/* Workflow name inline */}
          <input
            type="text"
            value={store.name}
            onChange={(e) => store.setName(e.target.value)}
            placeholder="Untitled Workflow"
            className="bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground border-b border-transparent focus:border-primary transition-colors duration-200 max-w-[300px]"
          />

          {store.isDirty && (
            <span className="text-xs text-muted-foreground">(unsaved)</span>
          )}
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {saveError && (
            <span className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> {saveError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Undo/Redo */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => store.undo()}
            disabled={!store.canUndo()}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => store.redo()}
            disabled={!store.canRedo()}
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
            onClick={() => handleValidate()}
            title="Validate DAG"
            leftIcon={<AlertTriangle className="h-4 w-4" />}
          >
            Validate
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

          {/* Save */}
          <Button
            variant="secondary"
            onClick={handleSave}
            disabled={store.isSaving}
            loading={store.isSaving}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Save
          </Button>

          {/* Run */}
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={isRunning || !store.definitionId}
            loading={isRunning}
            leftIcon={<Play className="h-4 w-4" />}
          >
            Run
          </Button>
        </div>
      </div>

      {/* ── Validation Errors Banner ── */}
      {store.validationErrors.length > 0 && (
        <div className="border-b border-warning/30 bg-warning-muted px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-sm">
              <span className="font-medium text-warning">
                {store.validationErrors.length} validation {store.validationErrors.length === 1 ? 'error' : 'errors'}
              </span>
              <ul className="mt-1 space-y-0.5 text-warning">
                {store.validationErrors.map((err, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3" />
                    {err.message}
                  </li>
                ))}
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
        variables={store.variables}
        workflowName={store.name || 'Untitled Workflow'}
        isSubmitting={isRunning}
        linkedCodebases={linkedCodebases}
      />
    </div>
  );
}

export default WorkflowBuilderPage;
