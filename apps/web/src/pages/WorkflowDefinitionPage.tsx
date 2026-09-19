// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionPage — Read-only view of a saved definition
// Shows DAG visualisation, metadata, run history, action buttons
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Edit3,
  Play,
  Trash2,
  Calendar,
  GitBranch,
  Clock,
  Tag,
  AlertCircle,
  Globe,
  MoreHorizontal,
  ChevronDown,
} from 'lucide-react';

import { DAGCanvas } from '@/components/workflow/DAGCanvas.js';
import { VariableInputModal } from '@/components/workflow/VariableInputModal.js';
import type { UploadedFileSet, LinkedCodebaseInfo, StageOverrideEntry } from '@/components/workflow/VariableInputModal.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import {
  useWorkflowDefinition,
  useDeleteWorkflowDefinition,
  useWorkflowRunsByDefinition,
  useCreateWorkflowRun,
  useStartWorkflowRun,
  useStartOrchestratedRun,
  useUploadRunFiles,
} from '@/hooks/workflowQueries.js';
import { cn } from '@/lib/utils.js';
import {
  Button,
  Badge,
  Spinner,
  StatusBadge,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/index.js';
import { EntityListRow } from '@/components/data/index.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import type { WorkflowRun, CreateWorkflowRunParams } from '@generatorai/shared';
import { encodeStageOverrides } from '@generatorai/client-core';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { runTitle } from '@generatorai/client-core';

/** How many runs the sidebar shows before "Show more". */
const RUNS_PAGE_SIZE = 5;

export function WorkflowDefinitionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: definition, isLoading, error } = useWorkflowDefinition(id);

  usePageTitle(definition?.name);
  const { data: runs } = useWorkflowRunsByDefinition(id);
  const deleteDefinition = useDeleteWorkflowDefinition();
  const createRun = useCreateWorkflowRun();
  const startRun = useStartWorkflowRun();
  const startOrchestratedRun = useStartOrchestratedRun();
  const uploadRunFiles = useUploadRunFiles();

  // Only `loadDefinition` is used on this read-only page — a single,
  // referentially-stable action selector rather than subscribing to the
  // whole (~700-line) builder store, which used to re-render this page on
  // every field the *editor* touches (nodes/edges drag, keystrokes, etc.)
  // even though this page never reads any of that state itself.
  const loadDefinition = useWorkflowBuilderStore((s) => s.loadDefinition);

  const [variableModalOpen, setVariableModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [visibleRunCount, setVisibleRunCount] = useState(RUNS_PAGE_SIZE);

  const isOrchestrated = !!definition?.orchestratorConfig;

  // ── Project codebases for auto-filling git variables in run dialog ──
  const { data: projectCodebases } = useProjectCodebases(definition?.projectId ?? undefined);

  const linkedCodebases = React.useMemo((): LinkedCodebaseInfo[] | undefined => {
    if (!definition?.projectId || !definition?.orchestratorConfig?.gitRepositories?.length || !projectCodebases) return undefined;
    const selectedAliases = definition.orchestratorConfig.gitRepositories.map(r => r.alias);
    return selectedAliases
      .map((alias) => {
        const cb = projectCodebases.find((c) => c.alias === alias);
        if (!cb) return null;
        return { alias: cb.alias, url: cb.url ?? cb.localPath ?? '', branch: cb.defaultBranch ?? 'main' };
      })
      .filter((x): x is LinkedCodebaseInfo => x !== null);
  }, [definition?.projectId, definition?.orchestratorConfig?.gitRepositories, projectCodebases]);

  /**
   * Newest run first. The API returns rows ordered by `createdAt` ASC, so
   * slicing it directly used to surface the *oldest* runs in "Recent Runs".
   */
  const sortedRuns = React.useMemo(() => {
    if (!runs) return [] as WorkflowRun[];
    return [...runs].sort((a, b) => {
      const at = new Date(a.startedAt ?? a.createdAt).getTime();
      const bt = new Date(b.startedAt ?? b.createdAt).getTime();
      return bt - at;
    });
  }, [runs]);

  // Load definition into store for the read-only DAG view
  React.useEffect(() => {
    if (definition) {
      loadDefinition(definition);
    }
  }, [definition, loadDefinition]);

  const executeRun = useCallback(
    async (variables: Record<string, unknown>, uploads?: UploadedFileSet, stageOverrides?: StageOverrideEntry[]) => {
      if (!id) return;
      setIsRunning(true);

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
          const orchParams: Record<string, unknown> = {
            workflowDefinitionId: id,
            variables,
          };

          if (definition?.projectId) {
            orchParams['projectId'] = definition.projectId;
            // Use selectedCodebases from orchestratorConfig.codebaseAliases if available,
            // fallback to gitRepositories aliases for backward compat with existing definitions
            orchParams['selectedCodebases'] =
              definition.orchestratorConfig?.codebaseAliases?.length
                ? definition.orchestratorConfig.codebaseAliases
                : definition.orchestratorConfig?.gitRepositories?.map(r => r.alias) ?? [];
          }

          // Pass stage overrides if any are active (shared encoding: a
          // top-level array on the orchestrated route).
          const encoded = encodeStageOverrides(variables, stageOverrides, { orchestrated: true });
          if (encoded.stageOverrides) orchParams['stageOverrides'] = encoded.stageOverrides;

          const context = await startOrchestratedRun.mutateAsync(orchParams as any);

          // Upload files to the run (orchestrator will scan them at Phase 3)
          await uploadAllFiles(context.workflowRunId);

          setVariableModalOpen(false);
          navigate(`/workflows/${id}/runs/${context.workflowRunId}`);
        } else {
          // Stage overrides used to be forwarded only on the orchestrated
          // path, so a plain definition rendered the "SKIP" toggles and then
          // ignored every one of them. `WorkflowRunService.findStageOverride`
          // reads them from the run's own `__stageOverrides` variable, which
          // is also how the script-run route passes them through.
          const params: CreateWorkflowRunParams = {
            workflowDefinitionId: id,
            variables: encodeStageOverrides(variables, stageOverrides, { orchestrated: false }).variables,
          };
          const run = await createRun.mutateAsync(params);

          // Upload files before starting the run
          await uploadAllFiles(run.id);

          await startRun.mutateAsync(run.id);
          setVariableModalOpen(false);
          navigate(`/workflows/${id}/runs/${run.id}`);
        }
      } catch (err) {
        console.error('Run failed:', err);
      } finally {
        setIsRunning(false);
      }
    },
    [id, isOrchestrated, createRun, startRun, startOrchestratedRun, uploadRunFiles, navigate],
  );

  const handleRun = useCallback(() => {
    if (!definition) return;
    setVariableModalOpen(true);
  }, [definition]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setDeleteDialogOpen(true);
  }, [id]);

  const confirmDelete = useCallback(async () => {
    if (!id) return;
    await deleteDefinition.mutateAsync(id);
    setDeleteDialogOpen(false);
    navigate('/workflows');
  }, [id, deleteDefinition, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (error || !definition) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="text-sm text-muted-foreground">
          {error ? 'Failed to load workflow' : 'Workflow not found'}
        </p>
        <button
          onClick={() => navigate('/workflows')}
          className="text-sm text-primary underline"
        >
          Back to workflows
        </button>
      </div>
    );
  }

  const visibleRuns = sortedRuns.slice(0, visibleRunCount);
  const hasMoreRuns = sortedRuns.length > visibleRuns.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Workflow Definition"
        description="Delete this workflow definition? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6">
        <div className="flex items-start gap-3">
          {/* Identity — owns all the flexible width and truncates instead of
              pushing the action cluster off screen. */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                {definition.name}
              </h1>
              {isOrchestrated && (
                <Badge tone="warning" size="sm" className="shrink-0">
                  <Globe className="h-3 w-3" />
                  Orchestrated
                </Badge>
              )}
            </div>

            {definition.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {definition.description}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <MetaChip
                icon={<GitBranch className="h-3 w-3" />}
                label={`${definition.stages?.length ?? 0} ${(definition.stages?.length ?? 0) === 1 ? 'stage' : 'stages'}`}
              />
              <MetaChip
                icon={<Clock className="h-3 w-3" />}
                label={`${definition.sessionMode} mode`}
                title="Session mode"
              />
              <MetaChip
                icon={<Calendar className="h-3 w-3" />}
                label={new Date(definition.createdAt).toLocaleDateString()}
                title={`Created ${new Date(definition.createdAt).toLocaleString()}`}
              />
              {definition.tags.length > 0 && (
                <MetaChip
                  icon={<Tag className="h-3 w-3" />}
                  label={definition.tags.join(', ')}
                  title={`Tags: ${definition.tags.join(', ')}`}
                  className="max-w-[14rem]"
                />
              )}
            </div>
          </div>

          {/* Actions — full labels when there is room, primary + overflow menu
              once the header gets tight. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={handleRun}
              disabled={isRunning}
              loading={isRunning}
              leftIcon={isRunning ? undefined : <Play className="h-3.5 w-3.5" />}
              title="Run workflow"
            >
              <span className="hidden sm:inline">Run</span>
            </Button>

            {/* Wide: inline secondary actions */}
            <div className="hidden items-center gap-1.5 lg:flex">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/workflows/${id}/edit`)}
                leftIcon={<Edit3 className="h-3.5 w-3.5" />}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                className="hover:bg-danger-muted hover:text-danger"
                title="Delete workflow"
                aria-label="Delete workflow"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Narrow: overflow menu */}
            <div className="lg:hidden">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="icon-sm" title="More actions" aria-label="More actions">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  <MenuItem
                    icon={<Edit3 className="h-3.5 w-3.5" />}
                    label="Edit workflow"
                    onClick={() => navigate(`/workflows/${id}/edit`)}
                  />
                  <MenuItem
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    label="Delete workflow"
                    onClick={handleDelete}
                    destructive
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* DAG Preview */}
        <div className="flex-1 border-r border-border">
          <ReactFlowProvider>
            <DAGCanvas readonly />
          </ReactFlowProvider>
        </div>

        {/* Runs sidebar */}
        <div className="flex w-80 shrink-0 flex-col overflow-y-auto bg-card xl:w-96">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Recent Runs</h2>
            {sortedRuns.length > 0 && (
              <Badge tone="neutral" size="sm">
                {sortedRuns.length}
              </Badge>
            )}
          </div>

          {sortedRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Play className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run this workflow to see execution history
              </p>
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {visibleRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}

              {(hasMoreRuns || visibleRunCount > RUNS_PAGE_SIZE) && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  {hasMoreRuns && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setVisibleRunCount((n) => n + 10)}
                      className="text-primary hover:text-primary"
                      leftIcon={<ChevronDown className="h-3.5 w-3.5" />}
                    >
                      Show more ({sortedRuns.length - visibleRuns.length})
                    </Button>
                  )}
                  {visibleRunCount > RUNS_PAGE_SIZE && (
                    <Button variant="ghost" size="sm" onClick={() => setVisibleRunCount(RUNS_PAGE_SIZE)}>
                      Show less
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Variable Input Modal */}
      <VariableInputModal
        open={variableModalOpen}
        onClose={() => setVariableModalOpen(false)}
        onSubmit={executeRun}
        variables={definition.variables ?? []}
        workflowName={definition.name}
        isSubmitting={isRunning}
        linkedCodebases={linkedCodebases}
        stageNames={definition.stages?.map((s: { name: string }) => s.name) ?? []}
      />
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  const navigate = useNavigate();
  return (
    <EntityListRow
      size="sm"
      href={`/workflows/${run.workflowDefinitionId}/runs/${run.id}`}
      leading={<StatusBadge status={run.status} size="sm" />}
      title={<span className="truncate">{runTitle(run.name)}</span>}
      description={
        run.startedAt
          ? `Started ${new Date(run.startedAt).toLocaleString()}`
          : `Created ${new Date(run.createdAt).toLocaleString()}`
      }
    />
  );
}

/** Compact metadata pill used in the definition header. */
function MetaChip({
  icon,
  label,
  title,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title ?? label}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-subtle px-2 py-0.5 text-[11px] text-muted-foreground',
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Row inside the header overflow popover. */
function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        destructive
          ? 'text-danger hover:bg-danger-muted'
          : 'text-foreground hover:bg-subtle',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

export default WorkflowDefinitionPage;
