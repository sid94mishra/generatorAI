// ────────────────────────────────────────────────────────────────
// WorkflowBuilderPage — Full workflow builder with DAG canvas,
// stage properties panel, toolbar, validation, save/run actions
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
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
import type { UploadedFileSet, LinkedCodebaseInfo, StageOverrideEntry } from '@/components/workflow/VariableInputModal.js';
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
import { useUnsavedWorkStore } from '@/stores/unsavedWorkStore.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import type { StageDefinition, VariableDefinition, CreateWorkflowRunParams } from '@generatorai/shared';
import { encodeStageOverrides } from '@generatorai/client-core';

/**
 * The stage payload sent to the server, from the builder's own stage object.
 *
 * Both save paths — creating a definition for the first time, and updating an
 * existing one — go through this. They used to carry two hand-written copies
 * of the mapping, and they had drifted: the create path silently dropped
 * `resultValidation`, `contextFilter` and `approvalRequired`, so a validation
 * rule or an approval gate configured before the very first Save vanished
 * while the same edit on a saved workflow persisted fine. Anything the
 * properties panel can edit belongs here, once.
 */
function toStageParams(stage: StageDefinition) {
  return {
    name: stage.name,
    description: stage.description,
    order: stage.order,
    prompts: stage.prompts,
    harnessConfigOverrides: stage.harnessConfigOverrides,
    // Nullable, not optional: clearing the picker must actually unbind the
    // agent rather than leave the previous ref in place.
    agentRef: stage.agentRef ?? null,
    hooks: stage.hooks,
    retryPolicy: stage.retryPolicy,
    timeoutMs: stage.timeoutMs,
    condition: stage.condition,
    resultValidation: stage.resultValidation,
    contextFilter: stage.contextFilter,
    approvalRequired: stage.approvalRequired ?? false,
  };
}

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  // ── Zustand store ──
  //
  // W-render — this used to be `useWorkflowBuilderStore()` with no selector,
  // subscribing to the entire ~700-line store: every field, so every drag of
  // a node and every keystroke in the properties panel (which edits
  // `nodes`) re-rendered the whole toolbar, banners and modals along with
  // it. Below, DISPLAY-only fields the page's own JSX actually reads are
  // selected individually (or via `useShallow` for grouped/derived values);
  // everything the save/run handlers need is read from a fresh
  // `getState()` snapshot INSIDE those handlers instead, so editing the
  // canvas does not re-render this page at all just because a future Save
  // would need that data.
  const name = useWorkflowBuilderStore((s) => s.name);
  const isDirty = useWorkflowBuilderStore((s) => s.isDirty);
  const isSaving = useWorkflowBuilderStore((s) => s.isSaving);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const projectId = useWorkflowBuilderStore((s) => s.projectId);
  const selectedCodebases = useWorkflowBuilderStore(useShallow((s) => s.selectedCodebases));
  const variables = useWorkflowBuilderStore((s) => s.variables);
  const validationErrors = useWorkflowBuilderStore((s) => s.validationErrors);
  const canUndo = useWorkflowBuilderStore((s) => s.canUndo());
  const canRedo = useWorkflowBuilderStore((s) => s.canRedo());
  // Only the stage NAMES, shallow-compared — so dragging a node (which only
  // changes `position`) does not re-render the Run dialog's stage list.
  const stageNames = useWorkflowBuilderStore(useShallow((s) => s.nodes.map((n) => n.data.stage.name)));
  // Actions are referentially stable for the store's lifetime, so grouping
  // them in one `useShallow` selector never itself causes a re-render.
  const actions = useWorkflowBuilderStore(
    useShallow((s) => ({
      loadDefinition: s.loadDefinition,
      resetBuilder: s.resetBuilder,
      addStage: s.addStage,
      selectNode: s.selectNode,
      setName: s.setName,
      undo: s.undo,
      redo: s.redo,
      markSaving: s.markSaving,
      markSaved: s.markSaved,
      validate: s.validate,
    })),
  );

  // ── Server queries ──
  const { data: definition, isLoading: isLoadingDef, error: definitionError, refetch: refetchDefinition } = useWorkflowDefinition(id);
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
  // A passing validation used to render nothing at all, so the button was
  // indistinguishable from a broken one. Errors already surface in their own
  // banner; this is the "it passed" half.
  const [validateOk, setValidateOk] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  // ── Project codebases (for auto-filling git variables in run dialog) ──
  const { data: projectCodebases } = useProjectCodebases(projectId ?? undefined);

  const linkedCodebases = useMemo((): LinkedCodebaseInfo[] | undefined => {
    if (!projectId || selectedCodebases.length === 0 || !projectCodebases) return undefined;
    return selectedCodebases
      .map((alias) => {
        const cb = projectCodebases.find((c) => c.alias === alias);
        if (!cb) return null;
        return { alias: cb.alias, url: cb.url ?? cb.localPath ?? '', branch: cb.defaultBranch ?? 'main' };
      })
      .filter((x): x is LinkedCodebaseInfo => x !== null);
  }, [projectId, selectedCodebases, projectCodebases]);

  // ── Resizable properties panel ──
  const { width: propertiesPanelWidth, isDragging: isResizingProps, handleProps: propsHandleProps } = useResizable({
    initialWidth: 320,
    minWidth: 280,
    maxWidth: 600,
    side: 'left',
  });

  // ── Load definition into builder store ──
  //
  // Reset on EVERY `id` change (not only for a new workflow) — otherwise
  // navigating from workflow A to workflow B, when B fails to load, left A's
  // content in the store: `definition` stays `undefined` while loading AND
  // on error, so neither branch of the old `if (definition) load() else if
  // (isNew) reset()` ever fired, and the canvas kept showing A under B's URL.
  // Resetting immediately on every id change means the canvas is blank while
  // B loads, then `loadDefinition` (below) fills it in once B's data
  // arrives — or the error view further down renders instead.
  useEffect(() => {
    actions.resetBuilder();
    // `actions` is a stable, referentially unchanging selector result (see
    // the grouped selector above), so this effectively only re-runs on `id`.
  }, [id, actions]);

  useEffect(() => {
    if (definition) {
      actions.loadDefinition(definition);
    }
  }, [definition, actions]);

  usePageTitle(name || 'Untitled Workflow');

  // The shell's close/quit guard needs the same answer the route blocker gives.
  const setDirtyForShell = useUnsavedWorkStore((s) => s.setDirty);
  useEffect(() => {
    setDirtyForShell('workflow-builder', isDirty);
    return () => setDirtyForShell('workflow-builder', false);
  }, [isDirty, setDirtyForShell]);

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
    // Fresh snapshot rather than a reactive dependency — this only needs the
    // CURRENT node count/definitionId at the moment of the click.
    const { nodes, definitionId: defId } = useWorkflowBuilderStore.getState();
    const stageId = `stage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newStage: StageDefinition = {
      id: stageId,
      workflowDefinitionId: defId ?? '',
      name: `Stage ${nodes.length + 1}`,
      order: nodes.length,
      prompts: [],
      hooks: [],
      createdAt: new Date(),
    };
    actions.addStage(newStage);
    actions.selectNode(stageId);
  }, [actions]);

  // ── Validate ──
  const handleValidate = useCallback((announce = false) => {
    const errors = actions.validate();
    if (errors.length === 0) {
      setSaveSuccess(false);
      if (announce) {
        setValidateOk(true);
        setTimeout(() => setValidateOk(false), 3000);
      }
    } else if (announce) {
      setValidateOk(false);
    }
    return errors;
  }, [actions]);

  // ── Save ──
  const buildOrchestratorConfig = useCallback(() => {
    // Fresh snapshot — these are only needed at Save/Run time, not reactively.
    const { selectedCodebases: codebases, autoCommit, autoPush, autoCreatePR } = useWorkflowBuilderStore.getState();
    if (codebases.length === 0) return undefined;
    return {
      category: 'custom' as const,
      // The project codebases the run checks out as worktrees.
      codebaseAliases: codebases,
      // No preprocessingSteps needed — worktree creation is handled by the orchestrator
      // when projectId + selectedCodebases are present
      preprocessingSteps: [] as Array<{ type: 'clone_repo'; name: string; config: { type: 'clone_repo'; repoAlias: string }; failOnError: boolean; order: number }>,
      postProcessingSteps: [],
      resultValidations: [],
      requiresCodebase: true,
      autoCommit,
      autoPush,
      autoCreatePR,
    };
  }, []);

  const handleSave = useCallback(async () => {
    const errors = handleValidate();
    if (errors.length > 0) return;

    // Fresh snapshot for the whole save — an imperative action, not display
    // state, so it reads the CURRENT store rather than depending on it
    // reactively (which would rebuild this callback on every keystroke).
    const store = useWorkflowBuilderStore.getState();
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
            params: toStageParams(stage),
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
            const stageParams = toStageParams(stage);
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
          const serverEdges = new Map(definition.edges.map((e) => [e.id, e]));
          const localEdgeIds = new Set(store.edges.map((e) => e.id));

          // An edge whose condition changed has to be re-created: the API
          // exposes add/delete only, and edge identity is not user-visible.
          const retypedEdgeIds = new Set(
            store.edges
              .filter((e) => {
                const server = serverEdges.get(e.id);
                return Boolean(server && e.data && server.edgeType !== e.data.edgeType);
              })
              .map((e) => e.id),
          );

          // Delete removed edges — and the ones being re-typed.
          for (const eid of serverEdges.keys()) {
            if (!localEdgeIds.has(eid) || retypedEdgeIds.has(eid)) {
              await deleteEdgeMutation.mutateAsync({ definitionId: store.definitionId!, edgeId: eid });
            }
          }

          // Add new edges — and re-add the re-typed ones.
          for (const edge of store.edges) {
            if ((!serverEdges.has(edge.id) || retypedEdgeIds.has(edge.id)) && edge.data) {
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

    if (!useWorkflowBuilderStore.getState().definitionId) {
      setSaveError('Please save the workflow before running it.');
      return;
    }

    setVariableModalOpen(true);
  }, [handleValidate]);

  const executeRun = useCallback(
    async (
      variables: Record<string, unknown>,
      uploads?: UploadedFileSet,
      stageOverrides?: StageOverrideEntry[],
    ) => {
      // Fresh snapshot — imperative action, not display state.
      const store = useWorkflowBuilderStore.getState();
      if (!store.definitionId) return;
      setIsRunning(true);

      const isOrchestrated = !!store.projectId;

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
          const encoded = encodeStageOverrides(variables, stageOverrides, { orchestrated: true });
          const context = await startOrchestratedRun.mutateAsync({
            workflowDefinitionId: store.definitionId,
            ...encoded,
            uploads,
            projectId: store.projectId ?? undefined,
            selectedCodebases: store.selectedCodebases.length > 0 ? store.selectedCodebases : undefined,
          });

          setVariableModalOpen(false);
          navigate(`/workflows/${store.definitionId}/runs/${context.workflowRunId}`);
        } else {
          const params: CreateWorkflowRunParams = {
            workflowDefinitionId: store.definitionId,
            variables: encodeStageOverrides(variables, stageOverrides, { orchestrated: false }).variables,
          };
          const run = await createRun.mutateAsync(params);

          await uploadAllFiles(run.id);

          await startRun.mutateAsync(run.id);
          setVariableModalOpen(false);
          // Land on the run that was just started, the way every other run
          // entry point does — this used to drop the user on the definition
          // page with no indication that anything had begun.
          navigate(`/workflows/${store.definitionId}/runs/${run.id}`);
        }
      } catch (err) {
        console.error('Run failed:', err);
      } finally {
        setIsRunning(false);
      }
    },
    [createRun, startRun, startOrchestratedRun, uploadRunFiles, navigate],
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
            className="bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground border-b border-transparent focus:border-primary transition-colors duration-200 max-w-[300px]"
          />

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

          {/* Run */}
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={isRunning || !definitionId}
            loading={isRunning}
            leftIcon={<Play className="h-4 w-4" />}
          >
            Run
          </Button>
        </div>
      </div>

      {/* ── Validation Errors Banner ── */}
      {validationErrors.length > 0 && (
        <div className="border-b border-warning/30 bg-warning-muted px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-sm">
              <span className="font-medium text-warning">
                {validationErrors.length} validation {validationErrors.length === 1 ? 'error' : 'errors'}
              </span>
              <ul className="mt-1 space-y-0.5 text-warning">
                {validationErrors.map((err, i) => (
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
        variables={variables}
        workflowName={name || 'Untitled Workflow'}
        isSubmitting={isRunning}
        linkedCodebases={linkedCodebases}
        stageNames={stageNames}
      />
    </div>
  );
}

export default WorkflowBuilderPage;
