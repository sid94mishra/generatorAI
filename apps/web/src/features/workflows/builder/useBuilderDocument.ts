// ────────────────────────────────────────────────────────────────
// useBuilderDocument — the builder page's document logic (the Overhaul's
// WorkflowBuilderPage behaviour, moved off the JSX):
//   • load the definition into the store; reset when the URL names another
//     definition (never A's content under B's URL); reload query data only
//     on first arrival or a newer revision with nothing local to lose (D-3);
//   • live validation 300 ms after a document change (inline markers,
//     D-25) and the server's validation 1.5 s after (agents, models,
//     capabilities, child workflows);
//   • the server's check-command allow-list for check stages;
//   • save (POST the first time, then PUT with the loaded revision; a 409
//     offers "Reload theirs" / "Overwrite", a 422 shows its issues),
//     publish (saves first; an agent draft that replaces a workflow opens
//     that workflow), export, the Run button's mode and run preparation;
//   • the shell's unsaved-work flag.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  InvocationRequest,
  WorkflowDefinitionRecord,
  WorkflowGraph,
} from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useUnsavedWorkStore } from '@/stores/unsavedWorkStore.js';
import {
  useCreateWorkflowDefinition,
  usePublishDefinition,
  useSaveDefinitionGraph,
  useWorkflowDefinition,
} from '@/hooks/workflowQueries.js';
import {
  saveFailure,
  useExportDefinition,
  useSetDefinitionCache,
  useValidateDefinitionGraph,
} from '@/hooks/workflowBuilderQueries.js';
import { useScriptAllowlist } from '@/hooks/scriptQueries.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';
import { exportFileName } from '@/utils/workflowExport.js';

/**
 * What the Run button does for the current definition state:
 * - `test`: a draft (or an unsaved new workflow) runs only as a test run;
 * - `save-run`: a published workflow with unsaved edits is saved, published, then run (D-17);
 * - `publish-run`: saved but unpublished changes are published, then run;
 * - `run`: the published version runs as is.
 */
export type RunMode = 'test' | 'save-run' | 'publish-run' | 'run';

export const RUN_LABELS: Record<RunMode, string> = {
  test: 'Test run',
  'save-run': 'Save and run',
  'publish-run': 'Publish and run',
  run: 'Run',
};

/** How long the "Saved" / "Workflow is valid" notes stay. */
const NOTE_MS = 3000;
const ERROR_MS = 6000;

export interface BuilderDocument {
  definition: WorkflowDefinitionRecord | undefined;
  isLoading: boolean;
  loadError: unknown;
  refetch: () => void;
  runMode: RunMode;
  isPublishing: boolean;
  saveSuccess: boolean;
  saveError: string | null;
  validateOk: boolean;
  /** Problems panel: shown after Validate / a failed save; `checkedAt` is the last explicit check. */
  problemsOpen: boolean;
  setProblemsOpen: (open: boolean) => void;
  checkedAt: Date | null;
  conflict: WorkflowDefinitionRecord | null;
  dismissConflict: () => void;
  reloadTheirs: () => void;
  overwrite: () => void;
  /** Validate now; true when there is no error. `announce` shows the "valid" note and opens the problems panel. */
  validate: (announce?: boolean) => boolean;
  save: () => void;
  saveGraph: (expectedRevision?: number) => Promise<WorkflowDefinitionRecord | null>;
  publish: () => void;
  exportJson: () => void;
  runTarget: InvocationRequest['target'] | undefined;
  prepareRunTarget: () => Promise<InvocationRequest['target'] | null>;
}

export function useBuilderDocument(id: string | undefined): BuilderDocument {
  const navigate = useNavigate();
  const isNew = !id;
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const status = useWorkflowBuilderStore((s) => s.status);
  const isDirty = useWorkflowBuilderStore((s) => s.isDirty);
  const hasUnpublishedChanges = useWorkflowBuilderStore((s) => s.hasUnpublishedChanges);
  const name = useWorkflowBuilderStore((s) => s.workflow.name);

  const { data: definition, isLoading, error: loadError, refetch } = useWorkflowDefinition(id);
  const createDefinition = useCreateWorkflowDefinition();
  const saveDefinition = useSaveDefinitionGraph();
  const publishDefinition = usePublishDefinition();
  const validateOnServer = useValidateDefinitionGraph();
  const exportDefinition = useExportDefinition();
  const setDefinitionCache = useSetDefinitionCache();
  // Check commands are validated against the server's effective allow-list
  // (defaults plus the operator's extras), as the server does on save.
  const { data: scriptAllowlist } = useScriptAllowlist();

  const [isPublishing, setIsPublishing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validateOk, setValidateOk] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  /** The record a save lost to (409): offered as "Reload theirs" or "Overwrite". */
  const [conflict, setConflict] = useState<WorkflowDefinitionRecord | null>(null);

  const runMode: RunMode =
    status !== 'published' ? 'test' : isDirty ? 'save-run' : hasUnpublishedChanges ? 'publish-run' : 'run';

  // ── Load ──
  // Reset whenever the URL names a different definition than the store holds.
  // The first save of a new workflow navigates to its own id; the store holds
  // it then, so the canvas, selection and undo history survive.
  useEffect(() => {
    if (useWorkflowBuilderStore.getState().definitionId !== (id ?? null)) useWorkflowBuilderStore.getState().resetBuilder();
  }, [id]);

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

  // ── Live validation (client, then server) ──
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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = 0;
    const check = () => {
      const graph = useWorkflowBuilderStore.getState().toGraph();
      const mine = ++latest;
      validateOnServer(graph).then(
        (result) => {
          if (mine === latest) useWorkflowBuilderStore.getState().setServerIssues(result.issues, graph);
        },
        () => undefined,
      );
    };
    const unsubscribe = useWorkflowBuilderStore.subscribe((s, prev) => {
      if (s.nodes === prev.nodes && s.edges === prev.edges && s.workflow === prev.workflow) return;
      clearTimeout(timer);
      timer = setTimeout(check, 1500);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
      latest++;
    };
  }, [validateOnServer]);

  useEffect(() => {
    const commands = scriptAllowlist?.commands;
    const store = useWorkflowBuilderStore.getState();
    // An empty list means "not known" (nothing to offer), not "nothing allowed".
    store.setCommandAllowlist(commands && commands.length > 0 ? commands : null);
    if (store.nodes.some((n) => n.data.stage.kind === 'check')) store.validate();
  }, [scriptAllowlist]);

  // The shell's close/quit guard needs the same answer the route blocker gives.
  const setDirtyForShell = useUnsavedWorkStore((s) => s.setDirty);
  useEffect(() => {
    setDirtyForShell('workflow-builder', isDirty);
    return () => setDirtyForShell('workflow-builder', false);
  }, [isDirty, setDirtyForShell]);

  // ── Validate ──
  const validate = useCallback((announce = false) => {
    const found = useWorkflowBuilderStore.getState().validate();
    const ok = !found.some((i) => i.severity === 'error');
    if (!ok) setProblemsOpen(true);
    if (announce) {
      setCheckedAt(new Date());
      setProblemsOpen(found.length > 0);
      setValidateOk(ok);
      if (ok) setTimeout(() => setValidateOk(false), NOTE_MS);
    }
    return ok;
  }, []);

  const flashSaved = useCallback(() => {
    setSaveSuccess(true);
    setSaveError(null);
    setTimeout(() => setSaveSuccess(false), NOTE_MS);
  }, []);

  const showError = useCallback((message: string) => {
    setSaveError(message);
    setTimeout(() => setSaveError(null), ERROR_MS);
  }, []);

  // ── Save ──
  const saveGraph = useCallback(
    async (expectedRevision?: number): Promise<WorkflowDefinitionRecord | null> => {
      const store = useWorkflowBuilderStore.getState();
      if (!store.workflow.name.trim()) store.setName('Untitled Workflow');
      if (!validate()) {
        showError('Fix the errors before saving.');
        return null;
      }
      const graph: WorkflowGraph = useWorkflowBuilderStore.getState().toGraph();
      const existingId = store.definitionId;
      store.markSaving(true);
      try {
        const record = existingId
          ? await saveDefinition.mutateAsync({ id: existingId, graph, expectedRevision: expectedRevision ?? store.revision ?? 1 })
          : await createDefinition.mutateAsync(graph);
        useWorkflowBuilderStore.getState().applySaved(record, graph);
        flashSaved();
        // The first save switches to update mode: the URL now names the new
        // definition, and the next save is a PUT rather than a second POST (D-5).
        if (!existingId) navigate(`/workflows/${record.id}/edit`, { replace: true });
        return record;
      } catch (err) {
        useWorkflowBuilderStore.getState().markSaving(false);
        const failure = saveFailure(err);
        if (failure.status === 409 && failure.current) {
          setConflict(failure.current);
          return null;
        }
        if (failure.status === 422 && failure.issues) {
          useWorkflowBuilderStore.getState().setIssues(failure.issues, graph);
          setProblemsOpen(true);
        }
        showError(err instanceof Error ? err.message : 'Save failed');
        return null;
      }
    },
    [validate, saveDefinition, createDefinition, flashSaved, showError, navigate],
  );

  const save = useCallback(() => void saveGraph(), [saveGraph]);

  /** Publish the saved graph (saving first when needed). Resolves with the published record. */
  const publishRecord = useCallback(async (): Promise<WorkflowDefinitionRecord | null> => {
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
      if (record.id !== defId) {
        // An agent draft that replaces a workflow was published into it (and deleted): open that workflow.
        navigate(`/workflows/${record.id}/edit`, { replace: true });
        return record;
      }
      useWorkflowBuilderStore.getState().applySaved(record, graph);
      return record;
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Publish failed');
      return null;
    } finally {
      setIsPublishing(false);
    }
  }, [saveGraph, publishDefinition, showError, navigate]);

  const publish = useCallback(() => {
    void publishRecord().then((record) => {
      if (record) flashSaved();
    });
  }, [publishRecord, flashSaved]);

  // ── Conflict (409) ──
  const reloadTheirs = useCallback(() => {
    if (!conflict) return;
    setDefinitionCache(conflict);
    useWorkflowBuilderStore.getState().loadRecord(conflict);
    setConflict(null);
  }, [conflict, setDefinitionCache]);

  const overwrite = useCallback(() => {
    if (!conflict) return;
    const revision = conflict.revision;
    setConflict(null);
    void saveGraph(revision);
  }, [conflict, saveGraph]);

  // ── Export (the canonical document of the SAVED graph) ──
  const exportJson = useCallback(() => {
    const defId = useWorkflowBuilderStore.getState().definitionId;
    if (!defId) return;
    exportDefinition(defId)
      .then((text) => downloadBlobAsFile(new Blob([text], { type: 'application/json' }), exportFileName(name)))
      .catch((err: unknown) => showError(err instanceof Error ? err.message : 'Export failed'));
  }, [exportDefinition, name, showError]);

  // ── Run ──
  // What the dialog previews: the saved definition (a draft as a test run).
  const runTarget = useMemo(
    (): InvocationRequest['target'] | undefined =>
      definitionId
        ? { kind: 'definition', workflowDefinitionId: definitionId, ...(runMode === 'test' ? { testRun: true } : {}) }
        : undefined,
    [definitionId, runMode],
  );

  // On Start: bring the server up to what the canvas shows, then run that.
  const prepareRunTarget = useCallback(async (): Promise<InvocationRequest['target'] | null> => {
    const mode = runMode;
    if (mode === 'save-run' || mode === 'publish-run') {
      if (!(await publishRecord())) return null;
    } else {
      const current = useWorkflowBuilderStore.getState();
      if (current.isDirty || !current.definitionId) {
        if (!(await saveGraph())) return null;
      }
    }
    // Fresh snapshot — the save above may have created the definition.
    const defId = useWorkflowBuilderStore.getState().definitionId;
    if (!defId) return null;
    return { kind: 'definition', workflowDefinitionId: defId, ...(mode === 'test' ? { testRun: true } : {}) };
  }, [runMode, publishRecord, saveGraph]);

  return {
    definition: isNew ? undefined : definition,
    isLoading: !isNew && isLoading,
    loadError: isNew ? null : loadError,
    refetch: () => void refetch(),
    runMode,
    isPublishing,
    saveSuccess,
    saveError,
    validateOk,
    problemsOpen,
    setProblemsOpen,
    checkedAt,
    conflict,
    dismissConflict: () => setConflict(null),
    reloadTheirs,
    overwrite,
    validate,
    save,
    saveGraph,
    publish,
    exportJson,
    runTarget,
    prepareRunTarget,
  };
}
